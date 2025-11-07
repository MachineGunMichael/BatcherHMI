// server/routes/history.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../utils/authMiddleware');
const influx = require('../services/influx');
const kpiRepo = require('../repositories/kpiRepo'); // SQLite for M3/M4

// All endpoints require auth
router.use(verifyToken);

/**
 * GET /api/history/m3-all?from=...&to=...&bucket=60s
 * Returns all M3 KPI data in a single call (optimized)
 * {
 *   throughput: { perRecipe, total },
 *   giveaway: { perRecipe, total },
 *   piecesProcessed: { perRecipe, total },
 *   weightProcessed: { perRecipe, total }
 * }
 */
router.get('/m3-all', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    
    if (!from || !to) {
      return res.status(400).json({ error: 'Missing from or to parameter' });
    }
    
    // NOW USES SQLITE instead of InfluxDB for better performance
    const data = kpiRepo.getM3AllCombined({ from, to });
    
    res.json(data);
  } catch (e) {
    console.error('m3-all history error', e);
    res.status(500).json({ error: 'Failed to fetch M3 history' });
  }
});

/**
 * GET /api/history/throughput?from=...&to=...&bucket=60s
 * Returns:
 * {
 *   perRecipe: { "<recipeName>": [{t, v}] },
 *   total: [{t, v}]
 * }
 */
router.get('/throughput', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    const perRecipe = await influx.queryM3ThroughputPerRecipe({ from, to, bucket });
    const total = await influx.queryM3CombinedTotal({ from, to, bucket, field: 'batches_min' });
    res.json({ perRecipe, total });
  } catch (e) {
    console.error('throughput history error', e);
    res.status(500).json({ error: 'Failed to fetch throughput history' });
  }
});

/**
 * GET /api/history/giveaway?from=...&to=...&bucket=60s
 * Returns:
 * {
 *   perRecipe: { "<recipeName>": [{t, v}] },
 *   total: [{t, v}]
 * }
 */
router.get('/giveaway', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    const perRecipe = await influx.queryM3GiveawayPerRecipe({ from, to, bucket });
    const total = await influx.queryM3CombinedTotal({ from, to, bucket, field: 'giveaway_pct' });
    res.json({ perRecipe, total });
  } catch (e) {
    console.error('giveaway history error', e);
    res.status(500).json({ error: 'Failed to fetch giveaway history' });
  }
});

/**
 * GET /api/history/pieces-processed?from=...&to=...&bucket=60s
 * Returns:
 * {
 *   perRecipe: { "<recipeName>": [{t, v}] },
 *   total: [{t, v}]
 * }
 */
router.get('/pieces-processed', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    const perRecipe = await influx.queryM3PiecesProcessedPerRecipe({ from, to, bucket });
    const total = await influx.queryM3CombinedTotal({ from, to, bucket, field: 'pieces_processed' });
    res.json({ perRecipe, total });
  } catch (e) {
    console.error('pieces-processed history error', e);
    res.status(500).json({ error: 'Failed to fetch pieces-processed history' });
  }
});

/**
 * GET /api/history/weight-processed?from=...&to=...&bucket=60s
 * Returns:
 * {
 *   perRecipe: { "<recipeName>": [{t, v}] },
 *   total: [{t, v}]
 * }
 */
router.get('/weight-processed', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    const perRecipe = await influx.queryM3WeightProcessedPerRecipe({ from, to, bucket });
    const total = await influx.queryM3CombinedTotal({ from, to, bucket, field: 'weight_processed_g' });
    res.json({ perRecipe, total });
  } catch (e) {
    console.error('weight-processed history error', e);
    res.status(500).json({ error: 'Failed to fetch weight-processed history' });
  }
});

/**
 * GET /api/history/rejects?from=...&to=...&bucket=60s
 * Returns: [{t, v, total_rejects_count, total_rejects_weight_g}]
 */
router.get('/rejects', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    
    // NOW USES SQLITE instead of InfluxDB
    const result = kpiRepo.getM3CombinedRejects({ from, to });
    
    res.json(result);
  } catch (e) {
    console.error('rejects history error', e);
    res.status(500).json({ error: 'Failed to fetch rejects history' });
  }
});

/**
 * GET /api/history/weights?from=...&to=...&bucket=60s
 * Returns: { "<recipeName>": [{t, weight_g}] }
 * (Client builds distribution)
 */
router.get('/weights', async (req, res) => {
  try {
    const { from, to, bucket = '60s' } = req.query;
    const byRecipe = await influx.queryM1Weights({ from, to, bucket });
    res.json(byRecipe);
  } catch (e) {
    console.error('weights history error', e);
    res.status(500).json({ error: 'Failed to fetch weights history' });
  }
});

/**
 * GET /api/history/pies?from=...&to=...
 * Returns: {
 *   total_batches: number,
 *   giveaway_g_per_batch: number,
 *   giveaway_pct_avg: number
 * }
 */
router.get('/pies', async (req, res) => {
  try {
    const { from, to } = req.query;
    
    // NOW USES SQLITE instead of InfluxDB
    const pies = kpiRepo.getM4Pies({ from, to });
    
    res.json(pies);
  } catch (e) {
    console.error('pies history error', e);
    res.status(500).json({ error: 'Failed to fetch pies history' });
  }
});

/**
 * GET /api/history/overlay?ts=...&windowSec=60
 * Returns gate overlay (pieces and grams per gate)
 * Returns: [{ gate, pieces, grams }]
 */
router.get('/overlay', async (req, res) => {
  try {
    const { ts, windowSec = 60 } = req.query;
    if (!ts) {
      return res.status(400).json({ error: 'ts query parameter is required' });
    }
    const overlay = await influx.queryM2GateOverlay({ ts, windowSec: Number(windowSec) });
    res.json(overlay);
  } catch (e) {
    console.error('overlay history error', e);
    res.status(500).json({ error: 'Failed to fetch overlay history' });
  }
});

module.exports = router;