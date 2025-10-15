// server/routes/ingest.js
const express = require("express");
const router = express.Router();

const { broadcast } = require("../lib/eventBus");
const influx = require("../services/influx");

// Simple shared-secret for PLCs (machines don’t send JWTs)
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

    // outbox → notify any listeners (e.g., the SSE stream)
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
    if (!arr.length) {
      return res.status(400).json({ message: "Array of points required" });
    }

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

module.exports = router;