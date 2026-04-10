// server/routes/stream.js
const express = require("express");
const router = express.Router();

let verifyToken = (_req, _res, next) => next();
try {
  ({ verifyToken } = require("../utils/authMiddleware"));
} catch {}

const { bus } = require("../lib/eventBus");
const recipeManager = require("../lib/recipeManager");
const gates = require("../state/gates");
const machineState = require("../services/machineState");
const db = require("../db/sqlite");

// --- SSE helpers ---
function openSSE(res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
}
function send(res, event, payload) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get active gate assignments from recipeManager (machine state)
 * For transitioning gates, returns the ORIGINAL recipe (what's actually running on that gate)
 * Returns [{ gate, recipe_name }] for gate annotations
 */
function getActiveLegend() {
  const legend = [];
  const state = machineState.getState();
  const transitioningGates = state.transitioningGates || [];
  const transitionStartRecipes = state.transitionStartRecipes || {};
  
  // Get gate assignments
  for (let gate = 1; gate <= 8; gate++) {
    // For transitioning gates, use the ORIGINAL recipe (what's actually running)
    if (transitioningGates.includes(gate) && transitionStartRecipes[gate]) {
      legend.push({ gate, recipe_name: transitionStartRecipes[gate].recipeName });
    } else {
      const recipe = recipeManager.getRecipeForGate(gate);
      if (recipe) {
        legend.push({ gate, recipe_name: recipe.name });
      }
    }
  }
  
  return legend;
}

/**
 * Get current program start time from program_stats
 * Returns ISO timestamp or null if no active program
 */
function getCurrentProgramStartTime() {
  try {
    const state = machineState.getState();
    if (!state.currentProgramId) return null;
    
    const row = db.prepare(`
      SELECT start_ts FROM program_stats WHERE program_id = ?
    `).get(state.currentProgramId);
    
    return row?.start_ts || null;
  } catch (e) {
    return null;
  }
}

// GET /api/stream/dashboard?mode=live
router.get("/dashboard", async (req, res) => {
  openSSE(res);

  // Initial snapshot immediately (no 1s delay)
  try {
    const tsISO = new Date().toISOString();
    const legend = getActiveLegend(); // from machine state (NEW)
    const overlay = gates.getSnapshot(); // authoritative in-memory
    const state = machineState.getState();
    const programStartTime = getCurrentProgramStartTime();
    send(res, "tick", { 
      ts: tsISO, 
      legend, 
      overlay,
      programId: state.currentProgramId,
      programStartTime,
      machineState: state.state,
      hasBuffer: gates.HAS_BUFFER,
      transitioningGates: state.transitioningGates || [],
      completedTransitionGates: state.completedTransitionGates || [],
      activeRecipes: state.activeRecipes || [],
      transitionStartRecipes: state.transitionStartRecipes || {},
      programStartRecipes: state.programStartRecipes || [],
    });
  } catch (e) {
    console.error("initial tick failed:", e);
  }

  // Cleanup helper to prevent listener leaks
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearInterval(keepAlive);
    clearInterval(poll);
    bus.off("piece", onPiece);
    bus.off("gate", onGate);
    bus.off("overlay", onOverlay);
    bus.off("program_change", onProgramChange);
  }

  // forward real-time events (skip rejects — gate 0 pieces are picked up from InfluxDB)
  const onPiece = (payload) => {
    if (payload.gate === 0 || payload.gate === '0') return;
    if (!send(res, "piece", payload)) cleanup();
  };
  const onGate  = (payload) => { if (!send(res, "gate", payload)) cleanup(); };
  const onOverlay = (payload) => { if (!send(res, "overlay", payload)) cleanup(); };
  const onProgramChange = (payload) => { if (!send(res, "program_change", payload)) cleanup(); };
  bus.on("piece", onPiece);
  bus.on("gate", onGate);
  bus.on("overlay", onOverlay);
  bus.on("program_change", onProgramChange);

  // keepalive
  const keepAlive = setInterval(() => {
    if (res.destroyed || res.writableEnded) { cleanup(); return; }
    try { res.write(": ping\n\n"); } catch { cleanup(); }
  }, 30_000);

  // once per second: legend + overlay snapshot from in-memory
  const poll = setInterval(() => {
    if (res.destroyed || res.writableEnded) { cleanup(); return; }
    if (res.writableLength > 512 * 1024) {
      console.warn('SSE: closing stale connection (buffered %d KB)', Math.round(res.writableLength / 1024));
      cleanup();
      try { res.end(); } catch {}
      return;
    }
    try {
      const tsISO = new Date().toISOString();
      const legend = getActiveLegend();
      const overlay = gates.getSnapshot();
      const state = machineState.getState();
      const programStartTime = getCurrentProgramStartTime();
      if (!send(res, "tick", { 
        ts: tsISO, 
        legend, 
        overlay,
        programId: state.currentProgramId,
        programStartTime,
        machineState: state.state,
        hasBuffer: gates.HAS_BUFFER,
        transitioningGates: state.transitioningGates || [],
        completedTransitionGates: state.completedTransitionGates || [],
        activeRecipes: state.activeRecipes || [],
        transitionStartRecipes: state.transitionStartRecipes || {},
        programStartRecipes: state.programStartRecipes || [],
      })) {
        cleanup();
      }
    } catch (e) {
      console.error("SSE tick error:", e);
      cleanup();
    }
  }, 1000);

  req.on("close", cleanup);
  res.on("error", cleanup);
});

module.exports = router;