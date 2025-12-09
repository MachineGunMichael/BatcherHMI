// server/services/machineState.js
// Manages machine state (singleton) and active recipes

const db = require('../db/sqlite');
const eventBus = require('../lib/eventBus');

/**
 * Get current machine state
 * @returns {Object} { state, currentProgramId, activeRecipes, programStartRecipes, lastUpdated }
 */
function getState() {
  const row = db.prepare(`
    SELECT 
      state,
      current_program_id as currentProgramId,
      active_recipes as activeRecipes,
      program_start_recipes as programStartRecipes,
      last_updated as lastUpdated
    FROM machine_state 
    WHERE id = 1
  `).get();
  
  if (!row) {
    throw new Error('Machine state not initialized');
  }
  
  const state = {
    ...row,
    activeRecipes: JSON.parse(row.activeRecipes || '[]'),
    programStartRecipes: JSON.parse(row.programStartRecipes || '[]'),
  };
  
  // Removed verbose logging - getState is called frequently
  
  return state;
}

/**
 * Update machine state
 * @param {Object} updates - Partial state updates
 */
function updateState(updates) {
  const allowed = ['state', 'currentProgramId', 'activeRecipes', 'programStartRecipes'];
  const sets = [];
  const params = { id: 1 };
  
  Object.keys(updates).forEach(key => {
    if (allowed.includes(key)) {
      if (key === 'activeRecipes' || key === 'programStartRecipes') {
        // Convert to JSON string for storage
        sets.push(`${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = @${key}`);
        params[key] = JSON.stringify(updates[key]);
      } else {
        sets.push(`${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = @${key}`);
        params[key] = updates[key];
      }
    }
  });
  
  if (sets.length === 0) return;
  
  sets.push('last_updated = datetime(\'now\')');
  
  const sql = `UPDATE machine_state SET ${sets.join(', ')} WHERE id = @id`;
  db.prepare(sql).run(params);
  
  // Log detailed update info
  console.log(`[MachineState] Updated:`, JSON.stringify(updates, null, 2));
  
  // Emit event for SSE
  const newState = getState();
  eventBus.broadcast('machine:state-changed', newState);
  console.log(`[MachineState] Broadcasted state-changed event`);
}

/**
 * Get active recipes
 * @returns {Array} Array of recipe objects
 */
function getActiveRecipes() {
  const state = getState();
  return state.activeRecipes;
}

/**
 * Set active recipes
 * @param {Array} recipes - Array of recipe objects
 */
function setActiveRecipes(recipes) {
  updateState({ activeRecipes: recipes });
}

/**
 * Check if recipes have changed compared to program start snapshot
 * @param {Array} currentRecipes - Current active recipes
 * @returns {Boolean} True if recipes changed
 */
function recipesChanged(currentRecipes = null) {
  const state = getState();
  const current = currentRecipes || state.activeRecipes;
  const snapshot = state.programStartRecipes;
  
  // Deep comparison of recipe arrays
  return JSON.stringify(current) !== JSON.stringify(snapshot);
}

/**
 * Take a snapshot of current recipes (when program starts)
 */
function snapshotRecipes() {
  const state = getState();
  updateState({ programStartRecipes: state.activeRecipes });
  console.log('[MachineState] Snapshotted recipes for program');
}

/**
 * Clear all state (on stop)
 */
function reset() {
  // Reset all gate states to 0
  const gates = require('../state/gates');
  gates.resetAll();
  console.log('[MachineState] Cleared all gate states');
  
  updateState({
    state: 'idle',
    currentProgramId: null,
    activeRecipes: [],
    programStartRecipes: [],
  });
}

/**
 * Validate state transition
 * @param {String} fromState 
 * @param {String} toState 
 * @returns {Boolean}
 */
function isValidTransition(fromState, toState) {
  const validTransitions = {
    'idle': ['running'],
    'running': ['paused', 'transitioning'],
    'paused': ['running', 'transitioning'],
    'transitioning': ['idle', 'running'],
  };
  
  return validTransitions[fromState]?.includes(toState) || false;
}

module.exports = {
  getState,
  updateState,
  getActiveRecipes,
  setActiveRecipes,
  recipesChanged,
  snapshotRecipes,
  reset,
  isValidTransition,
};

