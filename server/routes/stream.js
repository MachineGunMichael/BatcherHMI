// server/routes/stream.js
const express = require("express");
const router = express.Router();

let verifyToken = (_req, _res, next) => next();
try {
  ({ verifyToken } = require("../utils/authMiddleware"));
} catch {}

const { bus } = require("../lib/eventBus");
const assignmentsRepo = require("../repositories/assignmentsRepo");
const gates = require("../state/gates");

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
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// GET /api/stream/dashboard?mode=live
router.get("/dashboard", async (req, res) => {
  openSSE(res);

  // Initial snapshot immediately (no 1s delay)
  try {
    const tsISO = new Date().toISOString();
    const legend = assignmentsRepo.getAssignmentsSnapshotAt(tsISO);
    const overlay = gates.getSnapshot(); // authoritative in-memory
    send(res, "tick", { ts: tsISO, legend, overlay });
  } catch (e) {
    console.error("initial tick failed:", e);
  }

  // forward real-time events
  const onPiece = (payload) => send(res, "piece", payload); // for scatter
  const onGate  = (payload) => send(res, "gate", payload);  // per-gate increments + resets
  const onOverlay = (payload) => send(res, "overlay", payload); // full overlay snapshot (for resets)
  bus.on("piece", onPiece);
  bus.on("gate", onGate);
  bus.on("overlay", onOverlay);

  // keepalive
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 30_000);

  // once per second: legend + overlay snapshot from in-memory (no Influx here)
  const poll = setInterval(() => {
    try {
      const tsISO = new Date().toISOString();
      const legend = assignmentsRepo.getAssignmentsSnapshotAt(tsISO);
      const overlay = gates.getSnapshot();
      send(res, "tick", { ts: tsISO, legend, overlay });
    } catch (e) {
      console.error("SSE tick error:", e);
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clearInterval(poll);
    bus.off("piece", onPiece);
    bus.off("gate", onGate);
    bus.off("overlay", onOverlay);
  });
});

module.exports = router;