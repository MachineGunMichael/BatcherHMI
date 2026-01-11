// server/services/machineState.js
// Manages machine state (singleton) and active recipes

const db = require('../db/sqlite');
const eventBus = require('../lib/eventBus');
const log = require('../lib/logger');

/**
 * Get current machine state
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
      completed_transition_gates as completedTransitionGates,
      transition_old_program_id as transitionOldProgramId,
      registered_transitioning_gates as registeredTransitioningGates,
      last_updated as lastUpdated
    FROM machine_state 
    WHERE id = 1
  `).get();
  
  if (!row) {
    throw new Error('Machine state not initialized');
  }
  
  return {
    ...row,
    activeRecipes: JSON.parse(row.activeRecipes || '[]'),
    programStartRecipes: JSON.parse(row.programStartRecipes || '[]'),
    transitioningGates: JSON.parse(row.transitioningGates || '[]'),
    transitionStartRecipes: JSON.parse(row.transitionStartRecipes || '{}'),
    completedTransitionGates: JSON.parse(row.completedTransitionGates || '[]'),
    registeredTransitioningGates: JSON.parse(row.registeredTransitioningGates || '[]'),
  };
}

/**
 * Update machine state
 */
function updateState(updates) {
  const allowed = ['state', 'currentProgramId', 'activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes', 'completedTransitionGates', 'registeredTransitioningGates'];
  const jsonFields = ['activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes', 'completedTransitionGates', 'registeredTransitioningGates'];
  const sets = [];
  const params = { id: 1 };
  
  Object.keys(updates).forEach(key => {
    if (allowed.includes(key)) {
      if (jsonFields.includes(key)) {
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
  
  // Log state changes (compact)
  log.debug('system', 'machine_state_updated', 'State updated', { 
    updates: Object.keys(updates),
    state: updates.state
  });
  
  // Emit event for SSE
  const newState = getState();
  eventBus.broadcast('machine:state-changed', newState);
}

/**
 * Get active recipes
 */
function getActiveRecipes() {
  const state = getState();
  return state.activeRecipes;
}

/**
 * Set active recipes
 */
function setActiveRecipes(recipes) {
  updateState({ activeRecipes: recipes });
}

/**
 * Check if recipes have changed compared to program start snapshot
 */
function recipesChanged(currentRecipes = null) {
  const state = getState();
  const current = currentRecipes || state.activeRecipes;
  const snapshot = state.programStartRecipes;
  return JSON.stringify(current) !== JSON.stringify(snapshot);
}

/**
 * Take a snapshot of current recipes (when program starts)
 */
function snapshotRecipes() {
  const state = getState();
  updateState({ programStartRecipes: state.activeRecipes });
}

/**
 * Clear all transitions AND snapshot recipes atomically
 */
function finalizeTransitions() {
  const state = getState();
  
  updateState({
    transitioningGates: [],
    transitionStartRecipes: {},
    completedTransitionGates: [],
    registeredTransitioningGates: [],
    programStartRecipes: state.activeRecipes,
  });
  
  // Log final recipe configuration with gate assignments (compact format)
  log.transitionsFinalized(state.currentProgramId, state.activeRecipes);
}

/**
 * Clear all state (on stop)
 */
function reset() {
  const gates = require('../state/gates');
  gates.resetAll();
  
  clearTransitionOldProgramId();
  
  updateState({
    state: 'idle',
    currentProgramId: null,
    activeRecipes: [],
    programStartRecipes: [],
    transitioningGates: [],
    transitionStartRecipes: {},
    completedTransitionGates: [],
    registeredTransitioningGates: [],
  });
  
  log.operations('machine_reset', 'Machine state reset to idle');
}

/**
 * Get the old program ID that's being transitioned from
 */
function getTransitionOldProgramId() {
  const row = db.prepare(`SELECT transition_old_program_id FROM machine_state WHERE id = 1`).get();
  return row?.transition_old_program_id || null;
}

/**
 * Set the old program ID when starting a transition
 */
function setTransitionOldProgramId(programId) {
  db.prepare(`UPDATE machine_state SET transition_old_program_id = ? WHERE id = 1`).run(programId);
}

/**
 * Clear the old program ID after transition completes
 */
function clearTransitionOldProgramId() {
  db.prepare(`UPDATE machine_state SET transition_old_program_id = NULL WHERE id = 1`).run();
}

/**
 * Start per-gate transition
 */
function startGateTransition(affectedGates, originalRecipes) {
  const state = getState();
  
  const existingGates = new Set(state.transitioningGates);
  const existingRecipes = { ...state.transitionStartRecipes };
  const completedGates = new Set(state.completedTransitionGates || []);
  
  affectedGates.forEach(gate => {
    if (completedGates.has(gate)) {
      return; // Skip locked gates
    }
    
    if (!existingGates.has(gate)) {
      existingGates.add(gate);
      existingRecipes[gate] = originalRecipes[gate];
    }
  });
  
  updateState({
    transitioningGates: Array.from(existingGates),
    transitionStartRecipes: existingRecipes,
  });
  
  log.operations('gate_transition_started', `Gate transition started for ${affectedGates.length} gates`, { gates: affectedGates });
}

/**
 * Complete transition for a specific gate
 */
function completeGateTransition(gate) {
  const state = getState();
  
  if (!state.transitioningGates.includes(gate)) {
    return null;
  }
  
  const originalRecipe = state.transitionStartRecipes[gate];
  
  const newTransitioningGates = state.transitioningGates.filter(g => g !== gate);
  const newTransitionStartRecipes = { ...state.transitionStartRecipes };
  delete newTransitionStartRecipes[gate];
  
  const newRegisteredTransitioningGates = (state.registeredTransitioningGates || []).filter(g => g !== gate);
  
  const completedGates = new Set(state.completedTransitionGates || []);
  completedGates.add(gate);
  
  updateState({
    transitioningGates: newTransitioningGates,
    transitionStartRecipes: newTransitionStartRecipes,
    completedTransitionGates: Array.from(completedGates),
    registeredTransitioningGates: newRegisteredTransitioningGates,
  });
  
  log.operations('gate_transition_completed', `Gate ${gate} transition completed (${completedGates.size} done, ${newTransitioningGates.length} remaining)`, { 
    gate, 
    remaining: newTransitioningGates.length,
    completed: completedGates.size
  });
  
  return originalRecipe;
}

/**
 * Check if any gates are transitioning
 */
function hasTransitioningGates() {
  const state = getState();
  return state.transitioningGates.length > 0;
}

/**
 * Get transitioning gates
 */
function getTransitioningGates() {
  const state = getState();
  return state.transitioningGates;
}

/**
 * Clear all transitions
 */
function clearTransitions() {
  updateState({
    transitioningGates: [],
    transitionStartRecipes: {},
    completedTransitionGates: [],
  });
}

/**
 * Get gates that have completed their transition
 */
function getCompletedTransitionGates() {
  const state = getState();
  return state.completedTransitionGates || [];
}

/**
 * Check if we're in an active transition period
 */
function isInTransitionPeriod() {
  const state = getState();
  return (state.transitioningGates?.length > 0) || (state.completedTransitionGates?.length > 0);
}

/**
 * Validate state transition
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
  finalizeTransitions,
  reset,
  isValidTransition,
  startGateTransition,
  completeGateTransition,
  hasTransitioningGates,
  getTransitioningGates,
  getCompletedTransitionGates,
  isInTransitionPeriod,
  clearTransitions,
  getTransitionOldProgramId,
  setTransitionOldProgramId,
  clearTransitionOldProgramId,
};
