/**
 * Frontend Logging Endpoint
 * 
 * Receives log entries from the frontend and writes them to the audit log.
 * This allows capturing user activities like page views, legend toggles, etc.
 */

const express = require('express');
const router = express.Router();
const log = require('../lib/logger');
const { verifyToken } = require('../utils/authMiddleware');

/**
 * POST /api/logs
 * Receive log entries from frontend
 * Body: { action: string, details: object }
 */
router.post('/', verifyToken, (req, res) => {
  try {
    const { action, details = {} } = req.body;
    const user = req.user?.username || 'anonymous';

    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    // Map frontend actions to appropriate log methods
    switch (action) {
      case 'page_viewed':
        log.pageViewed(details.page, user, details);
        break;
      
      case 'legend_toggled':
        log.legendToggled(details.series, details.visible, user);
        break;
      
      case 'stats_program_selected':
        log.statsProgramSelected(details.programId, details.programName, user);
        break;
      
      case 'stats_recipe_toggled':
        log.statsRecipeToggled(details.recipeId, details.recipeName, details.visible, user);
        break;
      
      case 'simulation_selected':
        log.simulationSelected(details.simulationId, user);
        break;
      
      case 'settings_changed':
        log.settingsChanged(details.setting, details.oldValue, details.newValue, user);
        break;
      
      default:
        // Generic audit log for unspecified actions
        log.audit(action, `User action: ${action}`, details, user);
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('system', 'frontend_log_error', err);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

/**
 * POST /api/logs/batch
 * Receive multiple log entries at once (for buffered logging)
 * Body: { entries: [{ action, details, timestamp }] }
 */
router.post('/batch', verifyToken, (req, res) => {
  try {
    const { entries = [] } = req.body;
    const user = req.user?.username || 'anonymous';

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' });
    }

    for (const entry of entries) {
      const { action, details = {} } = entry;
      if (action) {
        // Use appropriate log methods for known actions
        switch (action) {
          case 'page_viewed':
            log.pageViewed(details.page, user, details);
            break;
          case 'legend_toggled':
            log.legendToggled(details.series, details.visible, user);
            break;
          case 'stats_program_selected':
            log.statsProgramSelected(details.programId, details.programName, user);
            break;
          case 'stats_recipe_toggled':
            log.statsRecipeToggled(details.recipeId, details.recipeName, details.visible, user);
            break;
          case 'simulation_selected':
            log.simulationSelected(details.simulationId, user);
            break;
          case 'settings_changed':
            log.settingsChanged(details.setting, details.oldValue, details.newValue, user);
            break;
          default:
            log.audit(action, `User action: ${action}`, details, user);
        }
      }
    }

    res.json({ ok: true, count: entries.length });
  } catch (err) {
    log.error('system', 'frontend_batch_log_error', err);
    res.status(500).json({ error: 'Failed to log events' });
  }
});

module.exports = router;

