// server/routes/ts.js
const express = require('express');
const router = express.Router();

const influx = require('../services/influx');
const { verifyToken } = require('../utils/authMiddleware');
const kpiRepo = require('../repositories/kpiRepo'); // for SQLite snapshots

// Public health
router.get('/health', async (_req, res) => {
  const ok = await influx.ping().catch(() => false);
  res.json({ ok, host: influx.host, database: influx.database });
});

// NOTE: Query isn't available on your local Influx build.
router.get('/query', verifyToken, (_req, res) => {
  res.status(501).json({
    message:
      'Query is not available on this local Influx build. Use SSE/REST (SQLite snapshots) for history, or point env to InfluxDB Cloud to enable queries.',
  });
});

/**
 * M1: pieces
 * body: { piece_id, weight_g, ts? }
 */
router.post('/piece', verifyToken, async (req, res) => {
  try {
    const { piece_id, weight_g, ts } = req.body || {};
    if (!piece_id || typeof weight_g !== 'number') {
      return res.status(400).json({ message: 'piece_id and weight_g are required' });
    }
    await influx.writePiece({ piece_id, weight_g, ts });
    return res.json({ ok: true });
  } catch (e) {
    console.error('writePiece error:', e);
    return res.status(500).json({ message: 'writePiece failed' });
  }
});

/**
 * M5 (assignments) REMOVED - now stored in SQLite only.
 * Use /api/settings routes to change active configuration,
 * which updates run_config_assignments and settings_history tables.
 */

/**
 * M2: gate_state
 * body: { gate, pieces_in_gate, weight_sum_g, ts? }
 * (Renamed from piece_count/total_weight_g to match services/influx.js.)
 */
router.post('/gate-state', verifyToken, async (req, res) => {
  try {
    const { gate, pieces_in_gate, weight_sum_g, ts } = req.body || {};
    if (
      gate === undefined ||
      typeof pieces_in_gate !== 'number' ||
      typeof weight_sum_g !== 'number'
    ) {
      return res
        .status(400)
        .json({ message: 'gate, pieces_in_gate, weight_sum_g are required' });
    }
    await influx.writeGateState({ gate, pieces_in_gate, weight_sum_g, ts });
    return res.json({ ok: true });
  } catch (e) {
    console.error('writeGateState error:', e);
    return res.status(500).json({ message: 'writeGateState failed' });
  }
});

/**
 * M3: kpi_minute (per recipe)
 * body: { recipe, batches_min, giveaway_pct, rejects_per_min?, ts? }
 * Also writes a SQLite snapshot so you can serve /api/kpi/history.
 */
router.post('/kpi-minute', verifyToken, async (req, res) => {
  try {
    const { recipe, batches_min, giveaway_pct, rejects_per_min, ts } = req.body || {};
    if (!recipe || typeof batches_min !== 'number' || typeof giveaway_pct !== 'number') {
      return res
        .status(400)
        .json({ message: 'recipe, batches_min, giveaway_pct are required' });
    }

    await influx.writeKpiMinute({ recipe, batches_min, giveaway_pct, rejects_per_min, ts });

    // snapshot to SQLite (rounded to minute)
    await kpiRepo.upsertMinute({
      ts: ts ?? Date.now(),
      recipe,
      batches_min,
      giveaway_pct,
      rejects_per_min: rejects_per_min ?? null,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('writeKpiMinute error:', e);
    return res.status(500).json({ message: 'writeKpiMinute failed' });
  }
});

/**
 * M3 (combined): convenience endpoint for the white "sum/avg" line
 * body: { batches_min, giveaway_pct, rejects_per_min?, ts? }
 * Writes as recipe="__combined" in both Influx and SQLite snapshots.
 */
router.post('/kpi-minute/combined', verifyToken, async (req, res) => {
  try {
    const { batches_min, giveaway_pct, rejects_per_min, ts } = req.body || {};
    if (typeof batches_min !== 'number' || typeof giveaway_pct !== 'number') {
      return res
        .status(400)
        .json({ message: 'batches_min and giveaway_pct are required' });
    }

    await influx.writeKpiMinuteCombined({ batches_min, giveaway_pct, rejects_per_min, ts });

    await kpiRepo.upsertMinute({
      ts: ts ?? Date.now(),
      recipe: '__combined',
      batches_min,
      giveaway_pct,
      rejects_per_min: rejects_per_min ?? null,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('writeKpiMinuteCombined error:', e);
    return res.status(500).json({ message: 'writeKpiMinuteCombined failed' });
  }
});

/**
 * M4: kpi_totals (per recipe)
 * body: { recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg, ts? }
 * Also snapshots in SQLite.
 */
router.post('/kpi-totals', verifyToken, async (req, res) => {
  try {
    const { recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg, ts } =
      req.body || {};
    if (
      !recipe ||
      typeof total_batches !== 'number' ||
      typeof giveaway_g_per_batch !== 'number' ||
      typeof giveaway_pct_avg !== 'number'
    ) {
      return res.status(400).json({
        message: 'recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg are required',
      });
    }

    await influx.writeKpiTotals({
      recipe,
      total_batches,
      giveaway_g_per_batch,
      giveaway_pct_avg,
      ts,
    });

    await kpiRepo.upsertTotals({
      ts: ts ?? Date.now(),
      recipe,
      total_batches,
      giveaway_g_per_batch,
      giveaway_pct_avg,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('writeKpiTotals error:', e);
    return res.status(500).json({ message: 'writeKpiTotals failed' });
  }
});

module.exports = router;