// server/services/machineState.js
// Manages machine state (singleton) and active recipes

const db = require('../db/sqlite');
const eventBus = require('../lib/eventBus');

/**
 * Get current machine state
 * @returns {Object} { state, currentProgramId, activeRecipes, programStartRecipes, transitioningGates, transitionStartRecipes, transitionOldProgramId, lastUpdated }
 */
function getState() {
  const row = db.prepare(`
    SELECT 
      state,
      current_program_id as currentProgramId,
      active_recipes as activeRecipes,
      program_start_recipes as programStartRecipes,
      transitioning_gates as transitioningGates,
      transition_start_recipes as transitionStartRecipes,
      transition_old_program_id as transitionOldProgramId,
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
    transitioningGates: JSON.parse(row.transitioningGates || '[]'),
    transitionStartRecipes: JSON.parse(row.transitionStartRecipes || '{}'),
  };
  
  // Removed verbose logging - getState is called frequently
  
  return state;
}

/**
 * Update machine state
 * @param {Object} updates - Partial state updates
 */
function updateState(updates) {
  const allowed = ['state', 'currentProgramId', 'activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes'];
  const jsonFields = ['activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes'];
  const sets = [];
  const params = { id: 1 };
  
  Object.keys(updates).forEach(key => {
    if (allowed.includes(key)) {
      if (jsonFields.includes(key)) {
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
  
  // Clear the transition old program ID
  clearTransitionOldProgramId();
  
  updateState({
    state: 'idle',
    currentProgramId: null,
    activeRecipes: [],
    programStartRecipes: [],
    transitioningGates: [],
    transitionStartRecipes: {},
  });
}

/**
 * Get the old program ID that's being transitioned from
 * Now persisted to database for reliability
 * @returns {Number|null}
 */
function getTransitionOldProgramId() {
  const row = db.prepare(`SELECT transition_old_program_id FROM machine_state WHERE id = 1`).get();
  return row?.transition_old_program_id || null;
}

/**
 * Set the old program ID when starting a transition
 * Now persisted to database for reliability
 * @param {Number} programId
 */
function setTransitionOldProgramId(programId) {
  db.prepare(`UPDATE machine_state SET transition_old_program_id = ? WHERE id = 1`).run(programId);
  console.log(`[MachineState] Set transition old program ID: ${programId} (persisted to DB)`);
}

/**
 * Clear the old program ID after transition completes
 */
function clearTransitionOldProgramId() {
  db.prepare(`UPDATE machine_state SET transition_old_program_id = NULL WHERE id = 1`).run();
  console.log(`[MachineState] Cleared transition old program ID`);
}

/**
 * Start per-gate transition
 * Called when user edits/removes recipes while paused
 * @param {Array} affectedGates - Gates that need to complete their current batch
 * @param {Object} originalRecipes - Map of gate -> recipe at transition start {gate: {recipeId, recipeName, ...}}
 */
function startGateTransition(affectedGates, originalRecipes) {
  const state = getState();
  
  // Merge with existing transitioning gates (if any)
  const existingGates = new Set(state.transitioningGates);
  const existingRecipes = { ...state.transitionStartRecipes };
  
  affectedGates.forEach(gate => {
    if (!existingGates.has(gate)) {
      // Only add if not already transitioning
      existingGates.add(gate);
      existingRecipes[gate] = originalRecipes[gate];
    }
  });
  
  updateState({
    transitioningGates: Array.from(existingGates),
    transitionStartRecipes: existingRecipes,
  });
  
  console.log(`[MachineState] Started gate transition for gates: ${affectedGates.join(', ')}`);
}

/**
 * Complete transition for a specific gate
 * Called when a batch completes on a transitioning gate
 * @param {Number} gate - Gate number
 * @returns {Object|null} The original recipe for stats, or null if gate wasn't transitioning
 */
function completeGateTransition(gate) {
  const state = getState();
  
  if (!state.transitioningGates.includes(gate)) {
    return null;
  }
  
  const originalRecipe = state.transitionStartRecipes[gate];
  
  // Remove gate from transitioning list
  const newTransitioningGates = state.transitioningGates.filter(g => g !== gate);
  const newTransitionStartRecipes = { ...state.transitionStartRecipes };
  delete newTransitionStartRecipes[gate];
  
  updateState({
    transitioningGates: newTransitioningGates,
    transitionStartRecipes: newTransitionStartRecipes,
  });
  
  console.log(`[MachineState] Completed transition for gate ${gate}, ${newTransitioningGates.length} gates still transitioning`);
  
  return originalRecipe;
}

/**
 * Check if any gates are transitioning
 * @returns {Boolean}
 */
function hasTransitioningGates() {
  const state = getState();
  return state.transitioningGates.length > 0;
}

/**
 * Get transitioning gates
 * @returns {Array}
 */
function getTransitioningGates() {
  const state = getState();
  return state.transitioningGates;
}

/**
 * Clear all transitions (on stop or when all transitions complete)
 */
function clearTransitions() {
  updateState({
    transitioningGates: [],
    transitionStartRecipes: {},
  });
  console.log('[MachineState] Cleared all transitions');
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
  startGateTransition,
  completeGateTransition,
  hasTransitioningGates,
  getTransitioningGates,
  clearTransitions,
  getTransitionOldProgramId,
  setTransitionOldProgramId,
  clearTransitionOldProgramId,
};

