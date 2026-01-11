/**
 * Frontend Logging Service
 * 
 * Sends user activity logs to the backend for centralized logging.
 * In production, all logs are sent to the server.
 * In development, logs are also printed to console for debugging.
 */

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
const IS_DEV = process.env.NODE_ENV === 'development';

// Buffer for batch logging (reduces network overhead)
let logBuffer = [];
let flushTimeout = null;
const FLUSH_INTERVAL_MS = 5000; // Flush every 5 seconds
const MAX_BUFFER_SIZE = 20; // Flush if buffer reaches this size

/**
 * Get auth token from localStorage
 */
function getAuthToken() {
  return localStorage.getItem('token');
}

/**
 * Send logs to backend
 */
async function sendToBackend(entries) {
  const token = getAuthToken();
  if (!token) return; // Not logged in, skip

  try {
    await fetch(`${API_BASE}/api/logs/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ entries }),
    });
  } catch (err) {
    // Silently fail - don't disrupt user experience for logging failures
    if (IS_DEV) {
      console.warn('[LogService] Failed to send logs:', err.message);
    }
  }
}

/**
 * Flush buffered logs to backend
 */
function flushBuffer() {
  if (logBuffer.length === 0) return;
  
  const entries = [...logBuffer];
  logBuffer = [];
  clearTimeout(flushTimeout);
  flushTimeout = null;
  
  sendToBackend(entries);
}

/**
 * Schedule buffer flush
 */
function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
}

/**
 * Add log entry to buffer
 */
function bufferLog(action, details = {}) {
  logBuffer.push({
    action,
    details,
    timestamp: new Date().toISOString(),
  });
  
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
  } else {
    scheduleFlush();
  }
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushBuffer);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushBuffer();
    }
  });
}

// =====================================================
// PUBLIC LOGGING API
// =====================================================

const log = {
  /**
   * Log page view
   */
  pageViewed(page, details = {}) {
    bufferLog('page_viewed', { page, ...details });
  },

  /**
   * Log dashboard legend toggle
   */
  legendToggled(series, visible) {
    bufferLog('legend_toggled', { series, visible });
  },

  /**
   * Log stats program selection
   */
  statsProgramSelected(programId, programName) {
    bufferLog('stats_program_selected', { programId, programName });
  },

  /**
   * Log stats recipe toggle
   */
  statsRecipeToggled(recipeId, recipeName, visible) {
    bufferLog('stats_recipe_toggled', { recipeId, recipeName, visible });
  },

  /**
   * Log simulation selection
   */
  simulationSelected(simulationId) {
    bufferLog('simulation_selected', { simulationId });
  },

  /**
   * Log settings change
   */
  settingsChanged(setting, oldValue, newValue) {
    bufferLog('settings_changed', { setting, oldValue, newValue });
  },

  /**
   * Log machine control action (start/pause/stop)
   */
  machineControl(action, details = {}) {
    // Send immediately for important actions
    const entries = [{
      action: 'machine_control',
      details: { machineAction: action, ...details },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Log recipe creation
   */
  recipeCreated(recipeName, details = {}) {
    const entries = [{
      action: 'recipe_created',
      details: { recipeName, ...details },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Log recipe edit
   */
  recipeEdited(recipeName, changes = {}) {
    const entries = [{
      action: 'recipe_edited',
      details: { recipeName, changes },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Log recipe removal
   */
  recipeRemoved(recipeName) {
    const entries = [{
      action: 'recipe_removed',
      details: { recipeName },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Log program assignment
   */
  programAssigned(programId, programName) {
    const entries = [{
      action: 'program_assigned',
      details: { programId, programName },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Log program activation
   */
  programActivated(programId, programName) {
    const entries = [{
      action: 'program_activated',
      details: { programId, programName },
      timestamp: new Date().toISOString(),
    }];
    sendToBackend(entries);
  },

  /**
   * Generic log method for custom actions
   */
  custom(action, details = {}) {
    bufferLog(action, details);
  },

  /**
   * Force flush all buffered logs
   */
  flush() {
    flushBuffer();
  },
};

export default log;

