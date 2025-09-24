// server/routes/stats.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../utils/authMiddleware');
const statsRepo = require('../repositories/statsRepo');

// GET /summary?programId=1
router.get('/summary', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.query.programId, 10);
    if (Number.isNaN(programId)) return res.status(400).json({ message: 'programId is required' });
    const program = statsRepo.getProgramSummary(programId);
    const recipes = statsRepo.getRecipeSummaries(programId);
    res.json({ program, recipes });
  } catch (e) {
    console.error('stats/summary error:', e);
    res.status(500).json({ message: 'Summary fetch failed' });
  }
});

// GET /throughput?programId=1&from=ISO&to=ISO
router.get('/throughput', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.query.programId, 10);
    const from = req.query.from;
    const to = req.query.to;
    if (Number.isNaN(programId) || !from || !to) {
      return res.status(400).json({ message: 'programId, from and to (ISO) are required' });
    }
    const data = statsRepo.getThroughputSeries(programId, from, to);
    res.json(data);
  } catch (e) {
    console.error('stats/throughput error:', e);
    res.status(500).json({ message: 'Throughput fetch failed' });
  }
});

module.exports = router;