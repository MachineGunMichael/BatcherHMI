// server/routes/ingest.js
const express = require("express");
const router = express.Router();

const { broadcast } = require("../lib/eventBus");
const influx = require("../services/influx");
const gates = require("../state/gates");
const recipeManager = require("../lib/recipeManager");
const machineState = require("../services/machineState");
const db = require("../db/sqlite");

// Simple shared-secret for PLCs (machines don't send JWTs)
function verifyPlcSecret(req, res, next) {
  const expected = process.env.PLC_SHARED_SECRET || "";
  const got = req.headers["x-plc-secret"];
  if (!expected) {
    console.warn("PLC_SHARED_SECRET not set; rejecting ingest.");
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
    console.error('Failed to get current program ID:', err);
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
 * Headers: x-plc-secret: <secret>
 * Body: { piece_id?: string, weight_g: number, ts?: number|ISO }
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

    // Scatter update
    broadcast("piece", { piece_id: piece_id ?? null, weight_g: w, ts: tIso });

    res.json({ ok: true });
  } catch (e) {
    console.error("ingest/weight error:", e);
    res.status(500).json({ message: "Ingest failed" });
  }
});

/**
 * POST /api/ingest/weight/batch
 * Headers: x-plc-secret
 * Body: [{ piece_id?, weight_g, ts? }, ...]
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
    console.error("ingest/weight/batch error:", e);
    res.status(500).json({ message: "Batch ingest failed" });
  }
});

// Auto-incrementing piece ID (in-memory; fine for dev)
let nextPieceId = 1;

/**
 * POST /api/ingest/piece
 * For simulator/C# algorithm - receives pieces with gate assignment from simulator
 * Headers: x-plc-secret: <secret>
 * Body: { timestamp?: ISO/string/number, weight_g: number, gate: number (0-8) }
 * 
 * ✨ IMPORTANT: The backend RE-ASSIGNS pieces based on active recipes in machine_state.
 * This ensures pieces only go to gates with active recipes, regardless of what
 * the simulator sends.
 */
router.post("/piece", verifyPlcSecret, async (req, res) => {
  try {
    // ✨ CHECK MACHINE STATE - reject pieces if not running
    const state = machineState.getState();
    if (state.state !== 'running') {
      // Silently drop pieces when machine is not running (don't spam logs)
      return res.json({ ok: true, dropped: true, reason: `machine is ${state.state}` });
    }
    
    const { weight_g, timestamp } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) return res.status(400).json({ message: "weight_g must be a number" });

    const tsIso = normalizeTs(timestamp);
    const piece_id = String(nextPieceId++);

    // ✨ RE-ASSIGN PIECE based on active recipes (ignore simulator's gate)
    // Find all eligible gates where piece weight falls within recipe bounds
    const eligibleGates = [];
    for (let gate = gates.GATE_MIN; gate <= gates.GATE_MAX; gate++) {
      const recipe = recipeManager.getRecipeForGate(gate);
      if (recipe && w >= recipe.pieceMin && w <= recipe.pieceMax) {
        eligibleGates.push(gate);
      }
    }
    
    // Assign to random eligible gate, or gate 0 (reject) if none
    const g = eligibleGates.length > 0 
      ? eligibleGates[Math.floor(Math.random() * eligibleGates.length)]
      : 0;

    // Per-piece scatter update
    broadcast("piece", { piece_id, gate: g, weight_g: w, ts: tsIso });

    // Write M1 to Influx (async)
    influx.writePiece({ piece_id, weight_g: w, gate: g, ts: tsIso }).catch(err =>
      console.error("M1 write error:", err)
    );

    // Update gate state (authoritative in-memory) + check for batch completion
    if (g >= gates.GATE_MIN && g <= gates.GATE_MAX) {
      // ✨ ATOMIC BATCH DETECTION WITH PROMISE QUEUE ✨
      // This ensures pieces are ALWAYS processed sequentially, never lost
      const result = await gates.processPieceAtomic(g, w, (pieces, grams) => {
        return recipeManager.isBatchComplete(g, pieces, grams);
      });
      
      if (result.batchComplete) {
        console.log(`🎉 [BATCH COMPLETE] Gate ${g}: ${result.pieces} pieces, ${result.grams.toFixed(1)}g → RESET`);
        
        // ✅ Check if this gate is transitioning
        const transitioningGates = machineState.getTransitioningGates();
        const isTransitioning = transitioningGates.includes(g);
        
        // ⚠️ IMPORTANT: Capture old program ID BEFORE any transition state changes
        // This ensures the batch goes to the correct (old) program
        const oldProgramIdForBatch = machineState.getTransitionOldProgramId();
        
        // Get the appropriate recipe for stats
        let recipeForStats = recipeManager.getRecipeForGate(g);
        let recipeIdForStats = recipeForStats?.id || null;
        let recipeName = recipeForStats?.name || 'unknown';
        
        // For transitioning gates, also capture the original recipe info BEFORE clearing
        let originalRecipeInfo = null;
        if (isTransitioning) {
          const state = machineState.getState();
          originalRecipeInfo = state.transitionStartRecipes?.[g];
          if (originalRecipeInfo) {
            recipeIdForStats = originalRecipeInfo.recipeId;
            recipeName = originalRecipeInfo.recipeName;
          }
        }
        
        // ✅ FIRST: Write batch completion to SQLite (before any state changes)
        let programIdForBatch;
        try {
          if (isTransitioning && oldProgramIdForBatch) {
            programIdForBatch = oldProgramIdForBatch;
            console.log(`   📝 Writing batch to OLD program ${programIdForBatch} (gate ${g} transitioning, recipe: ${recipeName})`);
          } else {
            programIdForBatch = getCurrentProgramId();
          }
          
          db.prepare(`
            INSERT INTO batch_completions (gate, completed_at, pieces, weight_g, recipe_id, program_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(g, tsIso, result.pieces, result.grams, recipeIdForStats, programIdForBatch);
          
          console.log(`   📝 Batch completion written to SQLite (recipe: ${recipeName}, recipeId: ${recipeIdForStats}, program: ${programIdForBatch})`);
        } catch (err) {
          console.error(`   ❌ Failed to write batch completion to SQLite:`, err);
        }
        
        // ✅ THEN: Complete the gate transition (this clears transition state for this gate)
        if (isTransitioning) {
          console.log(`   🔄 [TRANSITION] Gate ${g} completed batch with original recipe: ${recipeName}`);
          
          // Complete this gate's transition (removes it from transitioning list)
          machineState.completeGateTransition(g);
          
          // Reload recipe manager to update this gate to new recipe
          recipeManager.loadGateAssignments();
          
          // Check if ALL transitions are now complete
          if (!machineState.hasTransitioningGates()) {
            console.log(`   ✅ [TRANSITION COMPLETE] All gates have finished their batches`);
            
            // Finalize the old program's stats
            const { handleAllTransitionsComplete } = require('./machine');
            const finalizeResult = handleAllTransitionsComplete();
            if (finalizeResult.success) {
              console.log(`   ✅ Old program ${oldProgramIdForBatch} finalized with all batch data`);
            } else {
              console.error(`   ❌ Failed to finalize old program:`, finalizeResult.error);
            }
            
            broadcast("transition_complete", { ts: tsIso });
          }
        }
        
        // Broadcast reset (pieces=0, grams=0)
        broadcast("gate", { gate: g, pieces: 0, grams: 0, ts: tsIso });
        
        // Write M2 reset to InfluxDB (async)
        influx.writeGateState({
          gate: g,
          pieces_in_gate: 0,
          weight_sum_g: 0,
          ts: tsIso,
        }).catch(err => console.error("M2 reset write failed:", err.message));
        
        // Broadcast full snapshot for consistency
        const snapshot = gates.getSnapshot();
        broadcast("overlay", { ts: tsIso, overlay: snapshot });
      } else {
        // Normal increment - broadcast updated count
        broadcast("gate", { gate: g, pieces: result.pieces, grams: result.grams, ts: tsIso });
        
        // Write M2 to Influx with rounded values (async)
        influx.writeGateState({
          gate: g,
          pieces_in_gate: Math.floor(result.pieces), // Ensure integer
          weight_sum_g: Math.round(result.grams * 10) / 10, // Round to 1 decimal
          ts: tsIso,
        }).catch(err => console.error("M2 write failed:", err.message));
      }
    }

    res.json({ ok: true, piece_id });
  } catch (e) {
    console.error("ingest/piece error:", e);
    res.status(500).json({ message: "Ingest failed", error: e.message });
  }
});

/**
 * POST /api/ingest/gate/reset
 * Resets the given gate to zero on batch completion (called by live_worker_v2.py)
 * Headers: x-plc-secret: <secret>
 * Body: { gate: number (1-8), timestamp?: ISO/string/number }
 */
router.post("/gate/reset", verifyPlcSecret, async (req, res) => {
  try {
    const { gate, timestamp } = req.body || {};
    const g = Number(gate);
    if (!Number.isFinite(g) || g < gates.GATE_MIN || g > gates.GATE_MAX) {
      return res.status(400).json({ message: "gate must be 1-8" });
    }
    const tsIso = normalizeTs(timestamp);

    console.log(`🔄 [RESET REQUEST] Gate ${g} at ${tsIso}`);
    
    // Reset authoritative state
    const after = gates.resetGate(g);
    console.log(`✅ [RESET DONE] Gate ${g} → pieces: ${after.pieces}, grams: ${after.grams}`);

    // Broadcast reset so UI shows the drop to 0 exactly once
    broadcast("gate", { gate: g, pieces: after.pieces, grams: after.grams, ts: tsIso });
    console.log(`📡 [BROADCAST] gate event for Gate ${g} reset`);

    // Persist reset in M2 as well
    influx.writeGateState({
      gate: g,
      pieces_in_gate: 0,
      weight_sum_g: 0,
      ts: tsIso,
    }).catch(err => console.error("M2 reset write failed:", err.message));
    
    // Also broadcast full snapshot to ensure UI consistency
    const snapshot = gates.getSnapshot();
    broadcast("overlay", { ts: tsIso, overlay: snapshot });
    console.log(`📡 [BROADCAST] overlay snapshot after Gate ${g} reset`);

    res.json({ ok: true });
  } catch (e) {
    console.error("ingest/gate/reset error:", e);
    res.status(500).json({ message: "Reset failed", error: e.message });
  }
});

/**
 * POST /api/ingest/reload-assignments
 * Reload recipe assignments (called by live_worker after program change)
 */
router.post("/reload-assignments", verifyPlcSecret, (req, res) => {
  try {
    console.log('🔄 Reloading recipe assignments via API call...');
    
    // Emit event to trigger auto-reload in recipeManager
    broadcast('program:changed');
    
    // Also broadcast to SSE clients so dashboard refreshes
    broadcast('assignmentsReloaded', { timestamp: new Date().toISOString() });
    
    res.json({ ok: true });
  } catch (e) {
    console.error("ingest/reload-assignments error:", e);
    res.status(500).json({ message: "Reload failed", error: e.message });
  }
});

module.exports = router;