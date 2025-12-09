// server/routes/assignments.js
// Query assignment history from SQLite (replaces M5 from InfluxDB)

const express = require('express');
const router = express.Router();
const assignmentsRepo = require('../repositories/assignmentsRepo');
const { verifyToken } = require('../utils/authMiddleware');

/**
 * GET /api/assignments/current
 * Get the current active assignments
 */
router.get('/current', verifyToken, (req, res) => {
  try {
    const assignments = assignmentsRepo.getCurrentAssignments();
    return res.json({ ok: true, assignments });
  } catch (e) {
    console.error('Get current assignments error:', e);
    return res.status(500).json({ message: 'Failed to get current assignments' });
  }
});

/**
 * GET /api/assignments/history
 * Get assignment change history
 * Query params:
 *  - limit: number (default 100)
 *  - programId: number (optional filter)
 */
router.get('/history', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const programId = req.query.programId ? parseInt(req.query.programId) : null;
    
    const history = assignmentsRepo.getAssignmentHistory({ limit, programId });
    return res.json({ ok: true, history });
  } catch (e) {
    console.error('Get assignment history error:', e);
    return res.status(500).json({ message: 'Failed to get assignment history' });
  }
});

/**
 * GET /api/assignments/at-time
 * Get assignments that were active at a specific time
 * Query params:
 *  - timestamp: ISO string (required)
 *  - programId: number (optional)
 */
router.get('/at-time', verifyToken, (req, res) => {
  try {
    const { timestamp, programId } = req.query;
    if (!timestamp) {
      return res.status(400).json({ message: 'timestamp query parameter is required' });
    }
    
    // ✨ NEW: Read from machine_state.active_recipes instead of legacy tables
    const recipeManager = require('../lib/recipeManager');
    const assignments = [];
    
    for (let gate = 1; gate <= 8; gate++) {
      const recipe = recipeManager.getRecipeForGate(gate);
      if (recipe) {
        assignments.push({ gate, recipe_name: recipe.name });
      }
    }
    
    return res.json({ ok: true, timestamp, assignments });
  } catch (e) {
    console.error('Get assignments at time error:', e);
    return res.status(500).json({ message: 'Failed to get assignments at time' });
  }
});

/**
 * GET /api/assignments/by-program/:programId
 * Get all assignment changes for a specific program
 */
router.get('/by-program/:programId', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    if (!programId || isNaN(programId)) {
      return res.status(400).json({ message: 'Invalid program ID' });
    }
    
    const assignments = assignmentsRepo.getAssignmentsByProgram(programId);
    return res.json({ ok: true, programId, assignments });
  } catch (e) {
    console.error('Get assignments by program error:', e);
    return res.status(500).json({ message: 'Failed to get assignments by program' });
  }
});

module.exports = router;

