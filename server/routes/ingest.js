// server/routes/ingest.js
const express = require("express");
const router = express.Router();

const { broadcast } = require("../lib/eventBus");
const influx = require("../services/influx");
const gates = require("../state/gates");
const recipeManager = require("../lib/recipeManager");
const machineState = require("../services/machineState");
const db = require("../db/sqlite");
const log = require("../lib/logger");
const orderRepo = require("../repositories/orderRepo");
const pauseTracker = require("../lib/pauseTracker");

// Simple shared-secret for PLCs (machines don't send JWTs)
function verifyPlcSecret(req, res, next) {
  const expected = process.env.PLC_SHARED_SECRET || "";
  const got = req.headers["x-plc-secret"];
  if (!expected) {
    log.warn('system', 'plc_secret_not_set', 'PLC_SHARED_SECRET not configured');
    return res.status(500).json({ message: "Server not configured" });
  }
  if (!got || got !== expected) {
    return res.status(401).json({ message: "Unauthorized (PLC secret invalid)" });
  }
  next();
}

// Get current program ID from machine state
function getCurrentProgramId() {
  try {
    const state = machineState.getState();
    return state.currentProgramId || null;
  } catch (err) {
    log.error('system', 'get_program_id_error', err);
    return null;
  }
}

function normalizeTs(ts) {
  if (ts === undefined || ts === null) return new Date().toISOString();
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts > 1e9 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * POST /api/ingest/weight
 */
router.post("/weight", verifyPlcSecret, async (req, res) => {
  try {
    const { piece_id, weight_g, length_mm, ts } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) {
      return res.status(400).json({ message: "weight_g must be a number" });
    }
    const tIso = normalizeTs(ts);
    const len = length_mm != null ? Number(length_mm) : null;

    await influx.writePiece({
      piece_id: piece_id ? String(piece_id) : undefined,
      weight_g: w,
      length_mm: len,
      ts: tIso,
    });

    broadcast("piece", { piece_id: piece_id ?? null, weight_g: w, length_mm: len, ts: tIso });

    res.json({ ok: true });
  } catch (e) {
    log.error('system', 'ingest_weight_error', e);
    res.status(500).json({ message: "Ingest failed" });
  }
});

/**
 * POST /api/ingest/weight/batch
 */
router.post("/weight/batch", verifyPlcSecret, async (req, res) => {
  try {
    const arr = Array.isArray(req.body) ? req.body : [];
    if (!arr.length) return res.status(400).json({ message: "Array of points required" });

    let count = 0;
    for (const item of arr) {
      const { piece_id, weight_g, length_mm: itemLen, ts } = item || {};
      const w = Number(weight_g);
      if (!Number.isFinite(w)) continue;

      const tIso = normalizeTs(ts);
      const batchLen = itemLen != null ? Number(itemLen) : null;
      await influx.writePiece({
        piece_id: piece_id ? String(piece_id) : undefined,
        weight_g: w,
        length_mm: batchLen,
        ts: tIso,
      });

      broadcast("piece", { piece_id: piece_id ?? null, weight_g: w, length_mm: batchLen, ts: tIso });
      count++;
    }

    res.json({ ok: true, count });
  } catch (e) {
    log.error('system', 'ingest_weight_batch_error', e);
    res.status(500).json({ message: "Batch ingest failed" });
  }
});

// Auto-incrementing piece ID (in-memory; fine for dev)
let nextPieceId = 1;

/**
 * POST /api/ingest/piece
 * For simulator/C# algorithm - receives pieces with gate assignment from simulator
 */
router.post("/piece", verifyPlcSecret, async (req, res) => {
  try {
    // CHECK MACHINE STATE - reject pieces if not running
    const state = machineState.getState();
    if (state.state !== 'running') {
      return res.json({ ok: true, dropped: true, reason: `machine is ${state.state}` });
    }
    
    const { weight_g, length_mm, timestamp } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) return res.status(400).json({ message: "weight_g must be a number" });
    const len = length_mm != null ? Number(length_mm) : null;

    const tsIso = normalizeTs(timestamp);
    const piece_id = String(nextPieceId++);
    const calcStart = process.hrtime.bigint();

    // RE-ASSIGN PIECE based on active recipes
    const eligibleGates = [];
    const transitioningGates = machineState.getTransitioningGates();
    const currentMachineState = machineState.getState();
    const pausedGates = currentMachineState.pausedGates || [];
    const activeRecipes = currentMachineState.activeRecipes || [];

    // Build set of gates belonging to paused recipes
    const pausedRecipeGates = new Set();
    for (const r of activeRecipes) {
      if (r.paused) {
        for (const g of (r.gates || [])) pausedRecipeGates.add(g);
      }
    }
    
    for (let gate = gates.GATE_MIN; gate <= gates.GATE_MAX; gate++) {
      // Skip paused gates and gates belonging to paused recipes
      if (pausedGates.includes(gate) || pausedRecipeGates.has(gate)) continue;

      // Skip gates that are blocked (main full in non-buffer mode, or both full in buffer mode)
      if (gates.isGateBlocked(gate)) continue;

      const recipe = recipeManager.getRecipeForGate(gate);
      if (recipe && w >= recipe.pieceMin && w <= recipe.pieceMax) {
        eligibleGates.push(gate);
        continue;
      }
      
      if (transitioningGates.includes(gate)) {
        const originalRecipe = currentMachineState.transitionStartRecipes?.[gate];
        if (originalRecipe?.params) {
          const pieceMin = originalRecipe.params.pieceMinWeight || 0;
          const pieceMax = originalRecipe.params.pieceMaxWeight || Infinity;
          if (w >= pieceMin && w <= pieceMax) {
            eligibleGates.push(gate);
          }
        }
      }
    }
    
    const g = eligibleGates.length > 0 
      ? eligibleGates[Math.floor(Math.random() * eligibleGates.length)]
      : 0;

    // Per-piece scatter update
    broadcast("piece", { piece_id, gate: g, weight_g: w, length_mm: len, ts: tsIso });

    // Write M1 to Influx (async)
    influx.writePiece({ piece_id, weight_g: w, length_mm: len, gate: g, ts: tsIso }).catch(err =>
      log.error('system', 'm1_write_error', err)
    );

    // Update gate state + check for batch completion
    let pieceResult = null;
    if (g >= gates.GATE_MIN && g <= gates.GATE_MAX) {
      const result = await gates.processPieceAtomic(g, w, (pieces, grams) => {
        const transitioningGates = machineState.getTransitioningGates();
        if (transitioningGates.includes(g)) {
          const state = machineState.getState();
          const originalRecipe = state.transitionStartRecipes?.[g];
          if (originalRecipe?.params) {
            return recipeManager.isBatchCompleteWithParams(g, pieces, grams, originalRecipe.params);
          }
        }
        return recipeManager.isBatchComplete(g, pieces, grams);
      }, tsIso);
      pieceResult = result;
      
      if (result.batchComplete) {
        const transitioningGates = machineState.getTransitioningGates();
        const isTransitioning = transitioningGates.includes(g);
        const oldProgramIdForBatch = machineState.getTransitionOldProgramId();
        
        let recipeForStats = recipeManager.getRecipeForGate(g);
        let recipeIdForStats = recipeForStats?.id || null;
        let recipeName = recipeForStats?.name || 'unknown';
        
        let originalRecipeInfo = null;
        if (isTransitioning) {
          const state = machineState.getState();
          originalRecipeInfo = state.transitionStartRecipes?.[g];
          if (originalRecipeInfo) {
            recipeIdForStats = originalRecipeInfo.recipeId;
            recipeName = originalRecipeInfo.recipeName;
          }
        }
        
        // Write batch completion to SQLite
        let programIdForBatch;
        try {
          if (isTransitioning && oldProgramIdForBatch) {
            programIdForBatch = oldProgramIdForBatch;
          } else {
            programIdForBatch = getCurrentProgramId();
          }
          
          // Get order_id from active recipes (for composite key tracking)
          const activeRecipes = machineState.getActiveRecipes();
          const recipeOnGate = activeRecipes.find(r => r.gates && r.gates.includes(g) && r.recipeName === recipeName);
          const orderIdForBatch = recipeOnGate?.orderId || null;
          
          db.prepare(`
            INSERT INTO batch_completions (gate, completed_at, pieces, weight_g, recipe_id, order_id, program_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(g, tsIso, result.pieces, result.grams, recipeIdForStats, orderIdForBatch, programIdForBatch);
          
          // Log batch completion
          log.batchCompleted(g, recipeName, result.pieces, result.grams, programIdForBatch);
          
          // Always increment recipe batch count in machine state for real-time tracking
          const updatedRecipe = machineState.incrementRecipeBatchCount(g, recipeName);
          if (updatedRecipe) {
            // Create a unique key for this recipe/order to handle duplicates
            // Orders use order_${orderId}, recipes use gates as unique identifier
            const recipeKey = updatedRecipe.orderId 
              ? `order_${updatedRecipe.orderId}` 
              : `recipe_${(updatedRecipe.gates || []).sort().join('_')}`;
            
            // Broadcast recipe batch update for real-time UI updates (all recipes)
            broadcast("recipe_batch_update", {
              recipeKey, // Unique identifier for tracking
              recipeName: updatedRecipe.recipeName,
              completedBatches: updatedRecipe.completedBatches,
              requestedBatches: updatedRecipe.requestedBatches || 0,
              gate: g,
              gates: updatedRecipe.gates || [],
              orderId: updatedRecipe.orderId || null,
              batchLimitTransitioning: updatedRecipe.batchLimitTransitioning || false,
              ts: tsIso,
            });
            
            // ================================================================
            // BATCH LIMIT TRANSITIONING LOGIC
            // When approaching batch limit, start transitioning gates one by one
            // Formula: Start when completedBatches >= requestedBatches - numberOfGates
            // ================================================================
            
            if (updatedRecipe.batchLimitTransitioning) {
              // Recipe is already in batch limit transitioning mode
              // This gate just completed its final batch - free it and assign to queue
              log.operations('batch_limit_gate_complete', `Gate ${g} completing final batch for ${updatedRecipe.recipeName}`, {
                gate: g,
                recipeName: updatedRecipe.recipeName,
                completedBatches: updatedRecipe.completedBatches,
                requestedBatches: updatedRecipe.requestedBatches,
              });
              
              const handoffResult = machineState.handleBatchLimitGateComplete(g, updatedRecipe);
              
              if (handoffResult) {
                // Broadcast gate handoff event
                broadcast("gate_handoff", {
                  gate: g,
                  fromRecipe: updatedRecipe.recipeName,
                  fromRecipeKey: recipeKey,
                  toRecipe: handoffResult.recipe?.recipeName || null,
                  handoffType: handoffResult.type,
                  assigned: handoffResult.assigned,
                  needed: handoffResult.needed,
                  ts: tsIso,
                });
              }
              
              // Check if recipe is now fully complete (all gates freed)
              // Use stable matching - orderId for orders, or recipeName + batchLimitTransitioning flag
              const currentRecipes = machineState.getActiveRecipes();
              const stillExists = currentRecipes.some(r => {
                if (updatedRecipe.orderId) {
                  return r.orderId === updatedRecipe.orderId && r.batchLimitTransitioning;
                }
                // For non-order recipes, match by name AND transitioning flag AND still having gates
                return r.recipeName === updatedRecipe.recipeName && r.batchLimitTransitioning && (r.gates || []).length > 0;
              });
              
              if (!stillExists) {
                // Recipe fully completed - all gates freed
                log.operations('recipe_completed', `Recipe ${updatedRecipe.recipeName} completed all batches (batch limit transitioning)`, {
                  recipeName: updatedRecipe.recipeName,
                  completedBatches: updatedRecipe.requestedBatches,
                  requestedBatches: updatedRecipe.requestedBatches,
                  orderId: updatedRecipe.orderId || null,
                });
                
                // Remove from order queue
                const currentQueue = machineState.getOrderQueue();
                const updatedQueue = currentQueue.filter(qItem => {
                  if (updatedRecipe.orderId) {
                    return qItem.orderId !== updatedRecipe.orderId;
                  }
                  return qItem.recipeName !== updatedRecipe.recipeName;
                });
                
                if (updatedQueue.length < currentQueue.length) {
                  machineState.setOrderQueue(updatedQueue);
                  log.queue('queue_item_removed_on_completion', `Removed completed recipe from queue: ${updatedRecipe.recipeName}`, {
                    recipeName: updatedRecipe.recipeName,
                    removedCount: currentQueue.length - updatedQueue.length,
                    remainingCount: updatedQueue.length,
                  });
                }
                
                // Update order status if it's an order
                if (updatedRecipe.orderId) {
                  try {
                    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', updatedRecipe.orderId);
                    log.operations('order_completed', `Order #${updatedRecipe.orderId} marked as completed`, {
                      orderId: updatedRecipe.orderId,
                    });
                  } catch (orderErr) {
                    log.error('system', 'order_status_update_error', orderErr, { orderId: updatedRecipe.orderId });
                  }
                }
                
                // Broadcast recipe completion
                broadcast("recipe_completed", {
                  recipeKey,
                  recipeName: updatedRecipe.recipeName,
                  completedBatches: updatedRecipe.requestedBatches,
                  requestedBatches: updatedRecipe.requestedBatches,
                  orderId: updatedRecipe.orderId || null,
                  gate: g,
                  gates: [],
                  ts: tsIso,
                });

                // Automatic program transition: end the old program and start a new one
                // so that each distinct recipe configuration is captured in its own program
                const { handleBatchLimitProgramTransition } = require('./machine');
                const transResult = handleBatchLimitProgramTransition(updatedRecipe.recipeName);
                if (transResult) {
                  broadcast("program_change", {
                    action: 'batch_limit_transition',
                    oldProgramId: transResult.oldProgramId,
                    programId: transResult.newProgramId,
                    ts: tsIso,
                  });
                }
              }
            } else if (machineState.shouldStartBatchLimitTransition(updatedRecipe)) {
              // Recipe should start batch limit transitioning
              // This happens when: completedBatches >= requestedBatches - numberOfGates
              log.operations('batch_limit_threshold_reached', `Recipe ${updatedRecipe.recipeName} reached batch limit threshold`, {
                recipeName: updatedRecipe.recipeName,
                completedBatches: updatedRecipe.completedBatches,
                requestedBatches: updatedRecipe.requestedBatches,
                gates: updatedRecipe.gates,
                threshold: updatedRecipe.requestedBatches - updatedRecipe.gates.length,
              });
              
              machineState.startBatchLimitTransition(updatedRecipe);
              
              // Broadcast that transitioning has started
              broadcast("batch_limit_transition_started", {
                recipeKey,
                recipeName: updatedRecipe.recipeName,
                completedBatches: updatedRecipe.completedBatches,
                requestedBatches: updatedRecipe.requestedBatches,
                gates: updatedRecipe.gates,
                ts: tsIso,
              });
            } else if (updatedRecipe.requestedBatches && updatedRecipe.completedBatches === updatedRecipe.requestedBatches) {
              // Fallback: Recipe completed but wasn't in transitioning mode (single gate or edge case)
              log.operations('recipe_completed', `Recipe ${updatedRecipe.recipeName} completed all batches`, {
                recipeName: updatedRecipe.recipeName,
                completedBatches: updatedRecipe.completedBatches,
                requestedBatches: updatedRecipe.requestedBatches,
                orderId: updatedRecipe.orderId || null,
                gate: g,
              });
              
              // AUTO-REMOVE: Server-side removal for reliability
              const currentActiveRecipes = machineState.getActiveRecipes();
              const updatedActiveRecipes = currentActiveRecipes.filter(r => {
                const rKey = r.orderId 
                  ? `order_${r.orderId}` 
                  : `recipe_${(r.gates || []).slice().sort().join('_')}`;
                return rKey !== recipeKey;
              });
              
              if (updatedActiveRecipes.length < currentActiveRecipes.length) {
                machineState.setActiveRecipes(updatedActiveRecipes);
                log.operations('recipe_auto_removed', `Recipe ${updatedRecipe.recipeName} auto-removed after completing ${updatedRecipe.requestedBatches} batches`, {
                  recipeName: updatedRecipe.recipeName,
                  recipeKey,
                  orderId: updatedRecipe.orderId || null,
                });
                
                // Try to assign the freed gate(s) to queue
                for (const freedGate of (updatedRecipe.gates || [])) {
                  machineState.assignFreedGateToQueue(freedGate);
                }
                
                // Remove from order queue
                const currentQueue = machineState.getOrderQueue();
                const updatedQueue = currentQueue.filter(qItem => {
                  if (updatedRecipe.orderId) {
                    return qItem.orderId !== updatedRecipe.orderId;
                  }
                  return qItem.recipeName !== updatedRecipe.recipeName;
                });
                
                if (updatedQueue.length < currentQueue.length) {
                  machineState.setOrderQueue(updatedQueue);
                  log.queue('queue_item_removed_on_completion', `Removed completed recipe from queue: ${updatedRecipe.recipeName}`, {
                    recipeName: updatedRecipe.recipeName,
                    removedCount: currentQueue.length - updatedQueue.length,
                    remainingCount: updatedQueue.length,
                  });
                }
                
                // Update order status if it's an order
                if (updatedRecipe.orderId) {
                  try {
                    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', updatedRecipe.orderId);
                    log.operations('order_completed', `Order #${updatedRecipe.orderId} marked as completed`, {
                      orderId: updatedRecipe.orderId,
                    });
                  } catch (orderErr) {
                    log.error('system', 'order_status_update_error', orderErr, { orderId: updatedRecipe.orderId });
                  }
                }
              }
              
              // Broadcast recipe completion
              broadcast("recipe_completed", {
                recipeKey,
                recipeName: updatedRecipe.recipeName,
                completedBatches: updatedRecipe.completedBatches,
                requestedBatches: updatedRecipe.requestedBatches,
                orderId: updatedRecipe.orderId || null,
                gate: g,
                gates: updatedRecipe.gates || [],
                ts: tsIso,
              });

              // Automatic program transition for non-batch-limit completions too
              if (updatedActiveRecipes.length < currentActiveRecipes.length) {
                const { handleBatchLimitProgramTransition } = require('./machine');
                const transResult = handleBatchLimitProgramTransition(updatedRecipe.recipeName);
                if (transResult) {
                  broadcast("program_change", {
                    action: 'batch_limit_transition',
                    oldProgramId: transResult.oldProgramId,
                    programId: transResult.newProgramId,
                    ts: tsIso,
                  });
                }
              }
            }
          }
          
          // Also increment order batch count if this gate has an associated order
          // (recipeOnGate is already defined above from the order_id lookup)
          if (recipeOnGate && recipeOnGate.orderId) {
            try {
              const order = orderRepo.incrementCompletedBatches(recipeOnGate.orderId);
              if (order) {
                log.operations('order_batch_completed', `Order ${order.id} batch completed`, {
                  orderId: order.id,
                  completedBatches: order.completed_batches,
                  requestedBatches: order.requested_batches,
                  gate: g,
                });
                
                // Broadcast order batch update for real-time UI updates
                broadcast("order_batch_update", {
                  orderId: order.id,
                  completedBatches: order.completed_batches,
                  requestedBatches: order.requested_batches,
                  recipeName: recipeOnGate.recipeName,
                  ts: tsIso,
                });
                
                // Check if order is complete
                if (order.completed_batches >= order.requested_batches) {
                  orderRepo.updateOrderStatus(order.id, orderRepo.ORDER_STATUS.COMPLETED);
                  log.operations('order_completed', `Order ${order.id} completed all batches`, {
                    orderId: order.id,
                    completedBatches: order.completed_batches,
                  });
                  
                  // Broadcast order completion
                  broadcast("order_completed", { 
                    orderId: order.id, 
                    completedBatches: order.completed_batches,
                    ts: tsIso 
                  });
                }
              }
            } catch (orderErr) {
              log.error('system', 'order_batch_increment_error', orderErr, { 
                orderId: recipeOnGate.orderId, 
                gate: g 
              });
            }
          }
          
        } catch (err) {
          log.error('system', 'batch_write_error', err, { gate: g });
        }
        
        // Complete gate transition if needed
        // Re-check current state: batch limit handling above may have already
        // completed this gate via handleBatchLimitGateComplete → completeGateTransition
        if (isTransitioning && machineState.getTransitioningGates().includes(g)) {
          machineState.completeGateTransition(g);
          
          // For normal transitions (not batch limit), assign freed gates to queue items
          // as they become available (gate-by-gate, same as batch limit transitions)
          const assignResult = machineState.assignFreedGateToQueue(g);
          if (assignResult) {
            // Clear the gate from completedTransitionGates so the receiving recipe
            // doesn't appear as "LOCKED" on the frontend
            const currentState = machineState.getState();
            const cleanedCompleted = (currentState.completedTransitionGates || []).filter(cg => cg !== g);
            if (cleanedCompleted.length !== (currentState.completedTransitionGates || []).length) {
              machineState.updateState({ completedTransitionGates: cleanedCompleted });
            }
            
            log.queue('normal_transition_gate_assigned', `Gate ${g} freed during normal transition, assigned to queue item`, {
              gate: g,
              result: assignResult,
            });
            broadcast("gate_handoff", {
              gate: g,
              recipeName: assignResult.recipe?.recipeName,
              type: 'normal_transition',
              ts: tsIso,
            });
          }
          
          recipeManager.loadGateAssignments();
          
          if (!machineState.hasTransitioningGates()) {
            log.transitionCompleted(machineState.getCompletedTransitionGates());
            
            const { handleAllTransitionsComplete } = require('./machine');
            handleAllTransitionsComplete();
            
            broadcast("transition_complete", { ts: tsIso });
          }
        }
        
        // Gate is now in filled state (no auto-reset; waits for operator acknowledgment)
        const filledGateState = gates.getGateState(g);
        broadcast("gate", {
          gate: g,
          main: filledGateState.main,
          buffer: filledGateState.buffer,
          mainFull: filledGateState.mainFull,
          bufferFull: filledGateState.bufferFull,
          pieces: filledGateState.main.pieces + filledGateState.buffer.pieces,
          grams: filledGateState.main.grams + filledGateState.buffer.grams,
          ts: tsIso,
        });

        // Emit event for operator simulator to schedule acknowledgment
        if (result.compartment === 'main') {
          broadcast("gate:main-filled", { gate: g, ts: tsIso });
        }

        const snapshot = gates.getSnapshot();
        broadcast("overlay", { ts: tsIso, overlay: snapshot });
      } else {
        // Normal increment — broadcast current compartment state
        const curGateState = gates.getGateState(g);
        broadcast("gate", {
          gate: g,
          main: curGateState.main,
          buffer: curGateState.buffer,
          mainFull: curGateState.mainFull,
          bufferFull: curGateState.bufferFull,
          pieces: curGateState.main.pieces + curGateState.buffer.pieces,
          grams: curGateState.main.grams + curGateState.buffer.grams,
          ts: tsIso,
        });
        
        influx.writeGateState({
          gate: g,
          pieces_in_gate: Math.floor(curGateState.main.pieces + curGateState.buffer.pieces),
          weight_sum_g: Math.round((curGateState.main.grams + curGateState.buffer.grams) * 10) / 10,
          ts: tsIso,
        }).catch(err => log.error('system', 'm2_write_error', err));
      }
      
      // Persist gate state to survive restarts/crashes
      machineState.persistGateSnapshot();
    }

    // Log piece to SQLite for the Pieces table
    const calcEnd = process.hrtime.bigint();
    const calcTimeMs = Number(calcEnd - calcStart) / 1e6;
    try {
      const pieceStatus = (g === 0) ? 'rejected' : 'batched';
      let isLastPiece = 0;
      let pieceRecipeName = null;
      let pieceOrderId = null;
      if (g >= gates.GATE_MIN && g <= gates.GATE_MAX) {
        const recipeForPiece = recipeManager.getRecipeForGate(g);
        pieceRecipeName = recipeForPiece?.name || null;
        const activeRecipesForPiece = machineState.getActiveRecipes();
        const recipeOnGateForPiece = activeRecipesForPiece.find(r => r.gates && r.gates.includes(g));
        pieceOrderId = recipeOnGateForPiece?.orderId || null;
      }
      if (pieceResult && pieceResult.batchComplete) {
        isLastPiece = 1;
      }
      const programIdForPiece = getCurrentProgramId();
      db.prepare(`
        INSERT INTO piece_log (piece_id, gate, weight_g, length_mm, status, calculation_time_ms, is_last_piece, recipe_name, order_id, program_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(Number(piece_id), g, w, len, pieceStatus, Math.round(calcTimeMs * 100) / 100, isLastPiece, pieceRecipeName, pieceOrderId, programIdForPiece, tsIso);

      // Prune periodically (every ~500 inserts) to keep table bounded
      if (Number(piece_id) % 500 === 0) {
        const count = db.prepare('SELECT COUNT(*) as cnt FROM piece_log').get().cnt;
        if (count > 10000) {
          db.prepare('DELETE FROM piece_log WHERE id <= (SELECT id FROM piece_log ORDER BY id DESC LIMIT 1 OFFSET 10000)').run();
        }
      }
    } catch (pieceLogErr) {
      // Non-critical — don't fail the ingest
    }

    res.json({ ok: true, piece_id });
  } catch (e) {
    log.error('system', 'ingest_piece_error', e);
    res.status(500).json({ message: "Ingest failed", error: e.message });
  }
});

/**
 * POST /api/ingest/gate/reset
 */
router.post("/gate/reset", verifyPlcSecret, async (req, res) => {
  try {
    const { gate, timestamp } = req.body || {};
    const g = Number(gate);
    if (!Number.isFinite(g) || g < gates.GATE_MIN || g > gates.GATE_MAX) {
      return res.status(400).json({ message: "gate must be 1-8" });
    }
    const tsIso = normalizeTs(timestamp);

    log.operations('gate_reset', `Gate ${g} reset`, { gate: g });
    
    const after = gates.resetGate(g);

    broadcast("gate", { gate: g, pieces: after.pieces, grams: after.grams, ts: tsIso });

    influx.writeGateState({
      gate: g,
      pieces_in_gate: 0,
      weight_sum_g: 0,
      ts: tsIso,
    }).catch(err => log.error('system', 'm2_reset_write_error', err));
    
    const snapshot = gates.getSnapshot();
    broadcast("overlay", { ts: tsIso, overlay: snapshot });

    res.json({ ok: true });
  } catch (e) {
    log.error('system', 'gate_reset_error', e);
    res.status(500).json({ message: "Reset failed", error: e.message });
  }
});

/**
 * POST /api/ingest/gate/acknowledge
 * Operator pressed the physical button — gate batch has been removed.
 * In buffer mode: transfers buffer contents to main, checks for immediate completion.
 * In non-buffer mode: resets the gate.
 */
router.post("/gate/acknowledge", verifyPlcSecret, async (req, res) => {
  try {
    const { gate, timestamp } = req.body || {};
    const g = Number(gate);
    if (!Number.isFinite(g) || g < gates.GATE_MIN || g > gates.GATE_MAX) {
      return res.status(400).json({ message: "gate must be 1-8" });
    }
    const tsIso = normalizeTs(timestamp);

    const gateStateBefore = gates.getGateState(g);
    if (!gateStateBefore.mainFull) {
      return res.json({ ok: true, noOp: true, reason: 'main is not full' });
    }

    const checkBatchComplete = (pieces, grams) => {
      return recipeManager.isBatchComplete(g, pieces, grams);
    };

    const ackResult = gates.acknowledgeGate(g, checkBatchComplete, tsIso);

    // Record KPI
    const programId = getCurrentProgramId();
    const recipeForGate = recipeManager.getRecipeForGate(g);
    const recipeId = recipeForGate?.id || recipeForGate?.name || null;
    const activeRecipesNow = machineState.getActiveRecipes();
    const recipeOnGate = activeRecipesNow.find(r => r.gates && r.gates.includes(g));
    const orderId = recipeOnGate?.orderId || null;

    if (ackResult.previousMainFilledAt) {
      const filledAt = new Date(ackResult.previousMainFilledAt);
      const ackedAt = new Date(tsIso);

      // Subtract any time the machine spent paused between fill and ack
      const pausedMs = pauseTracker.getPausedMsBetween(programId, ackResult.previousMainFilledAt, tsIso);
      const responseTimeMs = Math.max(0, (ackedAt - filledAt) - pausedMs);

      const wasBlocked = !!ackResult.previousBothFilledAt;
      const blockedAt = wasBlocked ? ackResult.previousBothFilledAt : null;
      const blockedPausedMs = wasBlocked
        ? pauseTracker.getPausedMsBetween(programId, blockedAt, tsIso)
        : 0;
      const blockedDurationMs = wasBlocked ? Math.max(0, (ackedAt - new Date(blockedAt)) - blockedPausedMs) : null;

      try {
        db.prepare(`
          INSERT INTO gate_acknowledgments (gate, program_id, recipe_id, order_id, batch_filled_at, acknowledged_at, response_time_ms, was_blocked, blocked_at, blocked_duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(g, programId, recipeId, orderId, ackResult.previousMainFilledAt, tsIso, responseTimeMs, wasBlocked ? 1 : 0, blockedAt, blockedDurationMs);
      } catch (kpiErr) {
        log.error('system', 'gate_ack_kpi_write_error', kpiErr, { gate: g });
      }

      log.operations('gate_acknowledged', `Gate ${g} acknowledged by operator`, {
        gate: g,
        responseTimeMs,
        pausedMs,
        wasBlocked,
        blockedDurationMs,
        immediateComplete: ackResult.immediateComplete,
      });
    }

    // If buffer transfer caused an immediate batch completion
    if (ackResult.immediateComplete) {
      const recipeName = recipeForGate?.name || 'unknown';
      try {
        db.prepare(`
          INSERT INTO batch_completions (gate, completed_at, pieces, weight_g, recipe_id, order_id, program_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(g, tsIso, ackResult.mainPieces, ackResult.mainGrams, recipeId, orderId, programId);

        log.batchCompleted(g, recipeName, ackResult.mainPieces, ackResult.mainGrams, programId);

        const updatedRecipe = machineState.incrementRecipeBatchCount(g, recipeName);
        if (updatedRecipe) {
          const recipeKey = updatedRecipe.orderId
            ? `order_${updatedRecipe.orderId}`
            : `recipe_${(updatedRecipe.gates || []).sort().join('_')}`;

          broadcast("recipe_batch_update", {
            recipeKey,
            recipeName: updatedRecipe.recipeName,
            completedBatches: updatedRecipe.completedBatches,
            requestedBatches: updatedRecipe.requestedBatches || 0,
            gate: g,
            gates: updatedRecipe.gates || [],
            orderId: updatedRecipe.orderId || null,
            batchLimitTransitioning: updatedRecipe.batchLimitTransitioning || false,
            ts: tsIso,
          });
        }

        if (recipeOnGate && recipeOnGate.orderId) {
          try {
            const order = orderRepo.incrementCompletedBatches(recipeOnGate.orderId);
            if (order) {
              broadcast("order_batch_update", {
                orderId: order.id,
                completedBatches: order.completed_batches,
                requestedBatches: order.requested_batches,
                recipeName: recipeOnGate.recipeName,
                ts: tsIso,
              });
            }
          } catch (orderErr) {
            log.error('system', 'ack_order_batch_error', orderErr);
          }
        }
      } catch (err) {
        log.error('system', 'ack_batch_write_error', err, { gate: g });
      }

      // Emit gate:main-filled so the simulator can schedule the next acknowledgment
      broadcast("gate:main-filled", { gate: g, ts: tsIso });
    }

    // Write reset to Influx (gate was cleared or buffer transferred)
    const gateStateAfter = gates.getGateState(g);
    influx.writeGateState({
      gate: g,
      pieces_in_gate: Math.floor(gateStateAfter.main.pieces + gateStateAfter.buffer.pieces),
      weight_sum_g: Math.round((gateStateAfter.main.grams + gateStateAfter.buffer.grams) * 10) / 10,
      ts: tsIso,
    }).catch(err => log.error('system', 'm2_ack_write_error', err));

    // Broadcast updated gate state
    broadcast("gate", {
      gate: g,
      main: gateStateAfter.main,
      buffer: gateStateAfter.buffer,
      mainFull: gateStateAfter.mainFull,
      bufferFull: gateStateAfter.bufferFull,
      pieces: gateStateAfter.main.pieces + gateStateAfter.buffer.pieces,
      grams: gateStateAfter.main.grams + gateStateAfter.buffer.grams,
      ts: tsIso,
    });

    const snapshot = gates.getSnapshot();
    broadcast("overlay", { ts: tsIso, overlay: snapshot });

    machineState.persistGateSnapshot();

    res.json({ ok: true, immediateComplete: ackResult.immediateComplete, transferred: ackResult.transferred });
  } catch (e) {
    log.error('system', 'gate_acknowledge_error', e);
    res.status(500).json({ message: "Acknowledge failed", error: e.message });
  }
});

/**
 * POST /api/ingest/reload-assignments
 */
router.post("/reload-assignments", verifyPlcSecret, (req, res) => {
  try {
    log.operations('assignments_reloaded', 'Recipe assignments reloaded');
    
    broadcast('program:changed');
    broadcast('assignmentsReloaded', { timestamp: new Date().toISOString() });
    
    res.json({ ok: true });
  } catch (e) {
    log.error('system', 'reload_assignments_error', e);
    res.status(500).json({ message: "Reload failed", error: e.message });
  }
});

module.exports = router;
