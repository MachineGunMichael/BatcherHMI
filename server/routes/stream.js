// server/routes/stream.js
const express = require("express");
const router = express.Router();

let verifyToken = (_req, _res, next) => next(); // fallback if auth not present
try {
  ({ verifyToken } = require("../utils/authMiddleware"));
} catch { /* auth is optional here */ }

const { bus } = require("../lib/eventBus");
const assignmentsRepo = require("../repositories/assignmentsRepo");
const influx = require("../services/influx");

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
router.get("/dashboard", verifyToken, async (req, res) => {
  openSSE(res);

  // forward real-time piece events (for the scatter plot)
  const onPiece = (payload) => send(res, "piece", payload);
  bus.on("piece", onPiece);

  // keepalive so proxies don’t kill the connection
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 30_000);

  // once per second, push legend + overlay snapshot
  const poll = setInterval(async () => {
    try {
      const now = new Date();
      const tsISO = now.toISOString();

      // from SQLite: which recipe is active per gate at this moment
      const legend = assignmentsRepo.getAssignmentsSnapshotAt(tsISO);

      // from Influx (M2): pieces and grams per gate over a small window
      const overlay = await influx.queryM2GateOverlay({
        ts: tsISO,
        windowSec: 10,
      });

      send(res, "tick", { ts: tsISO, legend, overlay });
    } catch (e) {
      console.error("SSE tick error:", e);
      // don’t crash the stream; next tick will try again
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clearInterval(poll);
    bus.off("piece", onPiece);
  });
});

module.exports = router;