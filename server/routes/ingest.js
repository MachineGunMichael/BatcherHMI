// server/routes/ingest.js
const express = require('express');
const influx = require('../services/influx');

// Optional SSE broadcast; if you haven't wired stream yet, you can remove these two lines.
let broadcast = () => {};
try {
  ({ broadcast } = require('./stream')); // module exports { router, broadcast }
} catch (_) { /* stream not wired; ignore */ }

const router = express.Router();

// Simple shared-secret check for PLCs (no JWT on machines)
function verifyPlcSecret(req, res, next) {
  const expected = process.env.PLC_SHARED_SECRET || '';
  const got = req.headers['x-plc-secret'];
  if (!expected) {
    console.warn('PLC_SHARED_SECRET is not set; rejecting ingest.');
    return res.status(500).json({ message: 'Server not configured' });
  }
  if (!got || got !== expected) {
    return res.status(401).json({ message: 'Unauthorized (PLC secret invalid)' });
  }
  next();
}

// Normalize ts to ISO or number-of-ms
function normalizeTimestamp(ts) {
  if (ts === undefined || ts === null) return undefined;
  if (typeof ts === 'number') {
    if (ts > 1e12) return ts;             // looks like ms
    if (ts > 1e9)  return ts * 1000;      // looks like seconds
    return ts;                             // best effort
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * POST /api/ingest/weight
 * Headers: x-plc-secret: <secret>
 * Body: { piece_id?: string, weight_g: number, ts?: number|ISO string }
 *
 * Writes M1: pieces (tags: piece_id; fields: weight_g)
 */
router.post('/weight', verifyPlcSecret, async (req, res) => {
  try {
    const { piece_id, weight_g, ts } = req.body || {};
    const w = Number(weight_g);
    if (!Number.isFinite(w)) {
      return res.status(400).json({ message: 'weight_g must be a number' });
    }

    await influx.writePiece({
      piece_id: piece_id ? String(piece_id) : undefined,
      weight_g: w,
      ts: normalizeTimestamp(ts)
    });

    // Optional SSE fan-out to the UI
    broadcast('piece', {
      piece_id: piece_id ?? null,
      weight_g: w,
      ts: (normalizeTimestamp(ts) ?? new Date().toISOString())
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('ingest/weight error:', e);
    return res.status(500).json({ message: 'Ingest failed' });
  }
});

/**
 * POST /api/ingest/weight/batch
 * Headers: x-plc-secret
 * Body: [{ piece_id?, weight_g, ts? }, ...]
 */
router.post('/weight/batch', verifyPlcSecret, async (req, res) => {
  try {
    const arr = Array.isArray(req.body) ? req.body : [];
    if (!arr.length) return res.status(400).json({ message: 'Array of points required' });

    for (const item of arr) {
      const { piece_id, weight_g, ts } = item || {};
      const w = Number(weight_g);
      if (!Number.isFinite(w)) continue;

      await influx.writePiece({
        piece_id: piece_id ? String(piece_id) : undefined,
        weight_g: w,
        ts: normalizeTimestamp(ts)
      });

      broadcast('piece', {
        piece_id: piece_id ?? null,
        weight_g: w,
        ts: (normalizeTimestamp(ts) ?? new Date().toISOString())
      });
    }

    return res.json({ ok: true, count: arr.length });
  } catch (e) {
    console.error('ingest/weight/batch error:', e);
    return res.status(500).json({ message: 'Batch ingest failed' });
  }
});

module.exports = router;