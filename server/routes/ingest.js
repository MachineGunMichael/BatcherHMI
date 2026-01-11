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
    const { piece_id, weight_g, ts } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) {
      return res.status(400).json({ message: "weight_g must be a number" });
    }
    const tIso = normalizeTs(ts);

    await influx.writePiece({
      piece_id: piece_id ? String(piece_id) : undefined,
      weight_g: w,
      ts: tIso,
    });

    broadcast("piece", { piece_id: piece_id ?? null, weight_g: w, ts: tIso });

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
      const { piece_id, weight_g, ts } = item || {};
      const w = Number(weight_g);
      if (!Number.isFinite(w)) continue;

      const tIso = normalizeTs(ts);
      await influx.writePiece({
        piece_id: piece_id ? String(piece_id) : undefined,
        weight_g: w,
        ts: tIso,
      });

      broadcast("piece", { piece_id: piece_id ?? null, weight_g: w, ts: tIso });
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
    
    const { weight_g, timestamp } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) return res.status(400).json({ message: "weight_g must be a number" });

    const tsIso = normalizeTs(timestamp);
    const piece_id = String(nextPieceId++);

    // RE-ASSIGN PIECE based on active recipes
    const eligibleGates = [];
    const transitioningGates = machineState.getTransitioningGates();
    const currentMachineState = machineState.getState();
    
    for (let gate = gates.GATE_MIN; gate <= gates.GATE_MAX; gate++) {
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
    broadcast("piece", { piece_id, gate: g, weight_g: w, ts: tsIso });

    // Write M1 to Influx (async)
    influx.writePiece({ piece_id, weight_g: w, gate: g, ts: tsIso }).catch(err =>
      log.error('system', 'm1_write_error', err)
    );

    // Update gate state + check for batch completion
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
      });
      
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
          
          db.prepare(`
            INSERT INTO batch_completions (gate, completed_at, pieces, weight_g, recipe_id, program_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(g, tsIso, result.pieces, result.grams, recipeIdForStats, programIdForBatch);
          
          // Log batch completion
          log.batchCompleted(g, recipeName, result.pieces, result.grams, programIdForBatch);
          
        } catch (err) {
          log.error('system', 'batch_write_error', err, { gate: g });
        }
        
        // Complete gate transition if needed
        if (isTransitioning) {
          machineState.completeGateTransition(g);
          recipeManager.loadGateAssignments();
          
          if (!machineState.hasTransitioningGates()) {
            log.transitionCompleted(machineState.getCompletedTransitionGates());
            
            const { handleAllTransitionsComplete } = require('./machine');
            handleAllTransitionsComplete();
            
            broadcast("transition_complete", { ts: tsIso });
          }
        }
        
        // Broadcast reset
        broadcast("gate", { gate: g, pieces: 0, grams: 0, ts: tsIso });
        
        // Write M2 reset to InfluxDB
        influx.writeGateState({
          gate: g,
          pieces_in_gate: 0,
          weight_sum_g: 0,
          ts: tsIso,
        }).catch(err => log.error('system', 'm2_reset_write_error', err));
        
        // Broadcast full snapshot
        const snapshot = gates.getSnapshot();
        broadcast("overlay", { ts: tsIso, overlay: snapshot });
      } else {
        // Normal increment
        broadcast("gate", { gate: g, pieces: result.pieces, grams: result.grams, ts: tsIso });
        
        influx.writeGateState({
          gate: g,
          pieces_in_gate: Math.floor(result.pieces),
          weight_sum_g: Math.round(result.grams * 10) / 10,
          ts: tsIso,
        }).catch(err => log.error('system', 'm2_write_error', err));
      }
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
