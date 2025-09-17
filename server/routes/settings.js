const express = require('express');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const settingsRepo = require('../repositories/settingsRepo');
const programRepo = require('../repositories/programRepo');
const stream = require('./stream'); // to broadcast SSE updates

const router = express.Router();

// GET /api/settings
router.get('/', verifyToken, (req, res) => {
  const s = settingsRepo.getSettings();
  const program = s.active_program_id ? programRepo.getProgram(s.active_program_id) : null;
  res.json({ settings: s, activeProgram: program });
});

// PUT /api/settings   (admin/manager)
router.put('/', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  const { mode, active_program_id } = req.body || {};
  if (mode && !['preset', 'manual'].includes(mode)) {
    return res.status(400).json({ message: "mode must be 'preset' or 'manual'" });
  }
  const updated = settingsRepo.updateSettings({ mode, active_program_id });
  const activeProgram = updated.active_program_id ? programRepo.getProgram(updated.active_program_id) : null;

  // notify SSE clients
  stream.broadcast('settings', { settings: updated, activeProgram });

  res.json({ settings: updated, activeProgram });
});

module.exports = router;