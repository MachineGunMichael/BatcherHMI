// server/routes/kpi.js (append or create)
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../utils/authMiddleware');
const kpiRepo = require('../repositories/kpiRepo');

// GET /api/kpi/history?from=ISO&to=ISO&include=all|recipes|combined
router.get('/history', verifyToken, (req, res) => {
  try {
    const { from, to, include } = req.query;
    const rows = kpiRepo.historyMinute({
      from: from || undefined,
      to: to || undefined,
      include: include || 'all',
    });
    res.json({ rows });
  } catch (e) {
    console.error('kpi/history error:', e);
    res.status(500).json({ message: 'History fetch failed' });
  }
});

module.exports = router;