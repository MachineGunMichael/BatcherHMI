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
      order_queue as orderQueue,
      gate_snapshot as gateSnapshot,
      paused_gates as pausedGates,
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
    orderQueue: JSON.parse(row.orderQueue || '[]'),
    gateSnapshot: JSON.parse(row.gateSnapshot || '[]'),
    pausedGates: JSON.parse(row.pausedGates || '[]'),
  };
}

/**
 * Update machine state
 */
function updateState(updates) {
  const allowed = ['state', 'currentProgramId', 'activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes', 'completedTransitionGates', 'registeredTransitioningGates', 'orderQueue', 'pausedGates'];
  const jsonFields = ['activeRecipes', 'programStartRecipes', 'transitioningGates', 'transitionStartRecipes', 'completedTransitionGates', 'registeredTransitioningGates', 'orderQueue', 'pausedGates'];
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
 * Extract only the configuration fields from a recipe for comparison.
 * Ignores runtime fields (completedBatches, transient flags) that change during operation.
 */
function recipeConfigFingerprint(recipe) {
  return {
    recipeName: recipe.recipeName,
    recipeId: recipe.recipeId,
    gates: (recipe.gates || []).slice().sort((a, b) => a - b),
    orderId: recipe.orderId || null,
    requestedBatches: recipe.requestedBatches || 0,
  };
}

/**
 * Check if recipes have changed compared to program start snapshot.
 * Only compares configuration fields (name, gates, order, batch target),
 * ignoring runtime counters like completedBatches and transient flags.
 */
function recipesChanged(currentRecipes = null) {
  const state = getState();
  const current = currentRecipes || state.activeRecipes;
  const snapshot = state.programStartRecipes;
  const currentFp = (current || []).map(recipeConfigFingerprint);
  const snapshotFp = (snapshot || []).map(recipeConfigFingerprint);
  return JSON.stringify(currentFp) !== JSON.stringify(snapshotFp);
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
  
  // Clean up internal/transient flags from recipes before snapshotting
  const cleanedRecipes = state.activeRecipes.map(r => {
    const cleaned = { ...r };
    delete cleaned._isIncomingFromQueue;
    delete cleaned._isReplacementRecipe;
    delete cleaned._queueBatchId;
    delete cleaned._isFromQueue;
    delete cleaned.batchLimitTransitioning;
    delete cleaned.isFinishing;
    return cleaned;
  });
  
  updateState({
    activeRecipes: cleanedRecipes,
    transitioningGates: [],
    transitionStartRecipes: {},
    completedTransitionGates: [],
    registeredTransitioningGates: [],
    programStartRecipes: cleanedRecipes,
  });
  
  // Log final recipe configuration with gate assignments (compact format)
  log.transitionsFinalized(state.currentProgramId, cleanedRecipes);
}

/**
 * Clear all state (on stop)
 * @param {boolean} keepRecipes - If true, keep activeRecipes for operator cleanup
 */
function reset(keepRecipes = false) {
  const gates = require('../state/gates');
  gates.resetAll();
  
  clearTransitionOldProgramId();
  
  updateState({
    state: 'idle',
    currentProgramId: null,
    activeRecipes: keepRecipes ? getState().activeRecipes : [],
    programStartRecipes: [],
    transitioningGates: [],
    transitionStartRecipes: {},
    completedTransitionGates: [],
    registeredTransitioningGates: [],
    pausedGates: [],
  });
  
  // Clear persisted gate snapshot so a fresh start doesn't load stale data
  try {
    db.prepare(`UPDATE machine_state SET gate_snapshot = '[]' WHERE id = 1`).run();
  } catch (e) {
    log.error('system', 'clear_gate_snapshot_error', e);
  }
  
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
    // If gate was previously completed (from another recipe's transition)
    // but is now being re-transitioned (new recipe owns the gate), allow it
    completedGates.delete(gate);
    
    existingGates.add(gate);
    // Always update the recipe mapping to reflect the current owner
    existingRecipes[gate] = originalRecipes[gate];
  });
  
  updateState({
    transitioningGates: Array.from(existingGates),
    transitionStartRecipes: existingRecipes,
    completedTransitionGates: Array.from(completedGates),
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

/**
 * Get order queue
 */
function getOrderQueue() {
  const state = getState();
  return state.orderQueue || [];
}

/**
 * Set order queue
 */
function setOrderQueue(queue) {
  updateState({ orderQueue: queue });
}

/**
 * Increment completed batch count for a recipe on a specific gate
 * Returns the updated recipe info or null if not found
 */
function incrementRecipeBatchCount(gate, recipeName) {
  const activeRecipes = getActiveRecipes();
  let updatedRecipe = null;
  
  const updatedRecipes = activeRecipes.map(recipe => {
    // Find the recipe that owns this gate
    if (recipe.gates && recipe.gates.includes(gate) && recipe.recipeName === recipeName) {
      const newCompletedBatches = (recipe.completedBatches || 0) + 1;
      updatedRecipe = {
        ...recipe,
        completedBatches: newCompletedBatches,
      };
      return updatedRecipe;
    }
    return recipe;
  });
  
  if (updatedRecipe) {
    setActiveRecipes(updatedRecipes);
  }
  
  return updatedRecipe;
}

/**
 * Check if a recipe should start batch limit transitioning
 * Formula: completedBatches >= requestedBatches - numberOfGates
 * @param {Object} recipe - The recipe object with completedBatches, requestedBatches, gates
 * @returns {boolean} - True if should start transitioning
 */
function shouldStartBatchLimitTransition(recipe) {
  if (!recipe || !recipe.requestedBatches || !recipe.gates || recipe.gates.length === 0) {
    return false;
  }
  
  // Don't start if already in batch limit transitioning
  if (recipe.batchLimitTransitioning) {
    return false;
  }
  
  const threshold = recipe.requestedBatches - recipe.gates.length;
  return recipe.completedBatches >= threshold && recipe.completedBatches < recipe.requestedBatches;
}

/**
 * Start batch limit transitioning for a recipe using the existing transition system
 * This integrates with the normal transition mechanism (transitioningGates, etc.)
 * @param {Object} recipe - The recipe to start transitioning
 * @returns {Object} - Info about the transition setup
 */
function startBatchLimitTransition(recipe) {
  const activeRecipes = getActiveRecipes();
  const queue = getOrderQueue();
  const gates = recipe.gates || [];
  
  // Mark recipe as in batch limit transitioning using stable matching
  let updatedRecipes = activeRecipes.map(r => {
    // Match by orderId for orders, or by recipeName + gates for recipes
    const isMatch = recipe.orderId 
      ? r.orderId === recipe.orderId
      : r.recipeName === recipe.recipeName && JSON.stringify(r.gates?.sort()) === JSON.stringify(recipe.gates?.sort());
    
    if (isMatch) {
      const updated = {
        ...r,
        batchLimitTransitioning: true,
        isFinishing: true,
      };
      // If this recipe was previously incoming (being assigned from queue),
      // it's now finishing its own batches. Clear the incoming flag to prevent
      // conflicting states (a recipe cannot be both incoming AND finishing).
      if (updated._isIncomingFromQueue) {
        log.queue('incoming_to_finishing', `Recipe ${r.recipeName} transitioning from incoming → finishing (reached own batch limit)`, {
          recipeName: r.recipeName,
          gates: r.gates,
          completedBatches: r.completedBatches,
          requestedBatches: r.requestedBatches,
        });
      }
      delete updated._isIncomingFromQueue;
      delete updated._queueBatchId;
      return updated;
    }
    return r;
  });
  
  // IMMEDIATELY create the incoming recipe from queue (don't wait for gate completion)
  // This ensures the UI shows the correct recipe name right away
  // IMPORTANT: Skip queue items that ARE the finishing recipe (partially assigned)
  let firstItem = null;
  let firstItemIndex = -1;
  for (let i = 0; i < queue.length; i++) {
    const qItem = queue[i];
    const isSameAsFinishing = recipe.orderId 
      ? qItem.orderId === recipe.orderId
      : qItem.recipeName === recipe.recipeName;
    
    if (!isSameAsFinishing && qItem.status !== 'halted') {
      firstItem = qItem;
      firstItemIndex = i;
      break;
    }
  }
  
  // If the finishing recipe was in the queue (partially assigned), remove it now
  // since it's about to complete all its batches
  let updatedQueue = queue.filter((qItem, idx) => {
    const isSameAsFinishing = recipe.orderId 
      ? qItem.orderId === recipe.orderId
      : qItem.recipeName === recipe.recipeName;
    return !isSameAsFinishing;
  });
  
  if (updatedQueue.length < queue.length) {
    log.queue('finishing_recipe_removed_from_queue', `Removed finishing recipe ${recipe.recipeName} from queue (was partially assigned)`, {
      recipeName: recipe.recipeName,
      orderId: recipe.orderId || null,
      originalQueueLength: queue.length,
      newQueueLength: updatedQueue.length,
    });
  }
  
  if (firstItem) {
    const queueBatchId = `incoming_${firstItem.orderId || firstItem.recipeName}_${firstItem.recipeId || 'q'}`;
    
    // Check if the queue item already has a corresponding active recipe
    // (e.g., it was partially assigned before this transition started)
    const existingActiveForIncoming = updatedRecipes.find(r => {
      if (r.batchLimitTransitioning || r.isFinishing) return false;
      if (firstItem.orderId) return r.orderId === firstItem.orderId;
      return r.recipeName === firstItem.recipeName && !r.orderId;
    });
    
    if (existingActiveForIncoming) {
      // Recipe is already active - mark it as incoming instead of creating a duplicate
      updatedRecipes = updatedRecipes.map(r => {
        const isMatch = firstItem.orderId
          ? r.orderId === firstItem.orderId && !r.batchLimitTransitioning
          : r.recipeName === firstItem.recipeName && !r.orderId && !r.batchLimitTransitioning;
        if (isMatch) {
          return {
            ...r,
            _isIncomingFromQueue: true,
            _queueBatchId: queueBatchId,
          };
        }
        return r;
      });
      
      log.queue('existing_active_marked_as_incoming', `Existing active recipe ${existingActiveForIncoming.recipeName} marked as incoming (already had ${existingActiveForIncoming.gates?.length || 0} gates)`, {
        recipeName: existingActiveForIncoming.recipeName,
        existingGates: existingActiveForIncoming.gates,
        queueBatchId,
        finishingRecipe: recipe.recipeName,
      });
    } else {
      // Create incoming recipe with all properties but NO gates yet
      // Gates will be added one by one as they complete their batches
      const incomingRecipe = {
        type: firstItem.type,
        recipeId: firstItem.recipeId,
        recipeName: firstItem.recipeName || firstItem.displayName || firstItem.name,
        displayName: firstItem.displayName || firstItem.recipeName,
        params: firstItem.params,
        requestedBatches: firstItem.requestedBatches,
        minGates: firstItem.minGates,
        orderId: firstItem.orderId,
        customerName: firstItem.customerName,
        gates: [],
        completedBatches: firstItem.completedBatches || 0,
        gatesAssigned: 0,
        _queueBatchId: queueBatchId,
        _isIncomingFromQueue: true,
      };
      
      updatedRecipes.push(incomingRecipe);
      
      log.queue('incoming_recipe_created_early', `Created incoming recipe at transition start`, {
        recipeName: incomingRecipe.recipeName,
        queueBatchId,
        finishingRecipe: recipe.recipeName,
        skippedSelf: firstItemIndex > 0,
      });
    }
    
    // Update queue with the batch ID on the correct item
    updatedQueue = updatedQueue.map((item) => {
      const isFirstItem = firstItem.orderId 
        ? item.orderId === firstItem.orderId 
        : item.recipeName === firstItem.recipeName;
      if (isFirstItem) {
        return { ...item, _queueBatchId: queueBatchId };
      }
      return item;
    });
  }
  
  setOrderQueue(updatedQueue);
  
  setActiveRecipes(updatedRecipes);
  
  // Build the transition start recipes mapping (store FULL recipe object, not just name)
  // The frontend expects an object with recipeName, params, etc.
  // Mark with _batchLimitTransition so frontend can distinguish from normal transitions
  const transitionStartRecipes = {};
  gates.forEach(gate => {
    transitionStartRecipes[gate] = {
      recipeName: recipe.recipeName,
      recipeId: recipe.recipeId,
      orderId: recipe.orderId,
      displayName: recipe.displayName || recipe.recipeName,
      params: recipe.params,
      gates: recipe.gates, // Original gates for reference
      _batchLimitTransition: true, // Flag to prevent duplicate "removed" rows in frontend
    };
  });
  
  // Start gate transitions using the existing system
  startGateTransition(gates, transitionStartRecipes);
  
  log.operations('batch_limit_transition_started', `Recipe ${recipe.recipeName} entering batch limit transition`, {
    recipeName: recipe.recipeName,
    orderId: recipe.orderId || null,
    completedBatches: recipe.completedBatches,
    requestedBatches: recipe.requestedBatches,
    gates: gates,
    nextQueueItem: firstItem?.recipeName || null,
    incomingRecipeCreated: !!firstItem,
    skippedSelfInQueue: firstItemIndex > 0,
  });
  
  return { gates, nextQueueItem: firstItem || null };
}

/**
 * "Graduate" a fully-assigned incoming recipe: clear its _isIncomingFromQueue flag
 * and prepare the next queue item as the new incoming recipe if the finishing recipe
 * still has remaining gates. This enables cascading assignments.
 * 
 * @param {Array} updatedRecipes - Current active recipes array (mutated in place)
 * @param {string} graduatingBatchId - _queueBatchId of the recipe being graduated
 * @param {Array} remainingFinishingGates - Gates still on the finishing recipe
 * @param {Array} currentQueue - Current working queue
 * @param {string} graduatedName - Name of the graduating recipe (for logging)
 * @returns {Array} - Updated recipes array
 */
function graduateIncomingRecipe(updatedRecipes, graduatingBatchId, remainingFinishingGates, currentQueue, graduatedName) {
  // Clear _isIncomingFromQueue flag from the graduated recipe
  let graduatedGates = [];
  updatedRecipes = updatedRecipes.map(r => {
    if (r._queueBatchId === graduatingBatchId && r._isIncomingFromQueue) {
      const { _isIncomingFromQueue, _queueBatchId, ...graduated } = r;
      graduatedGates = graduated.gates || [];
      log.queue('recipe_graduated', `Recipe ${r.recipeName} graduated from incoming → normal active`, {
        recipeName: r.recipeName,
        gates: r.gates,
        remainingFinishingGates,
      });
      return graduated;
    }
    return r;
  });
  
  // Clear the graduated recipe's gates from completedTransitionGates so the frontend
  // no longer shows the recipe as "LOCKED" or teal-colored after graduation
  if (graduatedGates.length > 0) {
    const state = getState();
    const currentCompleted = new Set(state.completedTransitionGates || []);
    const currentTransitioning = new Set(state.transitioningGates || []);
    let changed = false;
    for (const g of graduatedGates) {
      if (currentCompleted.has(g)) {
        currentCompleted.delete(g);
        changed = true;
      }
      if (currentTransitioning.has(g)) {
        currentTransitioning.delete(g);
        changed = true;
      }
    }
    // Also clean transitionStartRecipes entries for these gates
    const currentStartRecipes = state.transitionStartRecipes || {};
    const cleanedStartRecipes = { ...currentStartRecipes };
    for (const g of graduatedGates) {
      if (cleanedStartRecipes[g]) {
        delete cleanedStartRecipes[g];
        changed = true;
      }
    }
    if (changed) {
      updateState({
        completedTransitionGates: Array.from(currentCompleted),
        transitioningGates: Array.from(currentTransitioning),
        transitionStartRecipes: cleanedStartRecipes,
      });
      log.queue('graduated_gates_cleared', `Cleared transition tracking for graduated recipe gates`, {
        graduatedName,
        gates: graduatedGates,
      });
    }
  }
  
  // If the finishing recipe still has gates remaining, prepare the next queue item
  if (remainingFinishingGates.length > 0) {
    const nextNonHaltedIdx = currentQueue.findIndex(item => item.status !== 'halted');
    if (nextNonHaltedIdx >= 0) {
      const nextItem = currentQueue[nextNonHaltedIdx];
      const nextQueueBatchId = `incoming_${nextItem.orderId || nextItem.recipeName}_${nextItem.recipeId || 'q'}`;
      
      // Check if this queue item already has a corresponding active recipe
      const existingActiveForNext = updatedRecipes.find(r => {
        if (r.batchLimitTransitioning || r.isFinishing) return false;
        if (r._isIncomingFromQueue) return false; // Already handled
        if (nextItem.orderId) return r.orderId === nextItem.orderId;
        return r.recipeName === nextItem.recipeName && !r.orderId;
      });
      
      if (existingActiveForNext) {
        // Mark existing recipe as incoming instead of creating duplicate
        updatedRecipes = updatedRecipes.map(r => {
          const isMatch = nextItem.orderId
            ? r.orderId === nextItem.orderId && !r.batchLimitTransitioning
            : r.recipeName === nextItem.recipeName && !r.orderId && !r.batchLimitTransitioning && !r._isIncomingFromQueue;
          if (isMatch) {
            return { ...r, _isIncomingFromQueue: true, _queueBatchId: nextQueueBatchId };
          }
          return r;
        });
        
        log.queue('next_incoming_existing_active', `Existing active recipe ${existingActiveForNext.recipeName} marked as next incoming after ${graduatedName} graduated`, {
          recipeName: existingActiveForNext.recipeName,
          existingGates: existingActiveForNext.gates,
          nextQueueBatchId,
          remainingFinishingGates,
        });
      } else {
        // Create new incoming recipe (no gates yet - they'll be added as finishing gates free)
        const nextIncoming = {
          type: nextItem.type,
          recipeId: nextItem.recipeId,
          recipeName: nextItem.recipeName || nextItem.displayName || nextItem.name,
          displayName: nextItem.displayName || nextItem.recipeName,
          params: nextItem.params,
          requestedBatches: nextItem.requestedBatches || 0,
          minGates: nextItem.minGates,
          orderId: nextItem.orderId,
          customerName: nextItem.customerName,
          gates: [],
          completedBatches: nextItem.completedBatches || 0,
          gatesAssigned: 0,
          _queueBatchId: nextQueueBatchId,
          _isIncomingFromQueue: true,
        };
        
        updatedRecipes.push(nextIncoming);
        
        log.queue('next_incoming_prepared', `Prepared next queue item as incoming after ${graduatedName} graduated`, {
          nextRecipeName: nextIncoming.recipeName,
          nextQueueBatchId,
          remainingFinishingGates,
        });
      }
      
      // Update queue item with the batch ID
      const updatedQueue = currentQueue.map((item, idx) => {
        if (idx === nextNonHaltedIdx) {
          return { ...item, _queueBatchId: nextQueueBatchId };
        }
        return item;
      });
      setOrderQueue(updatedQueue);
    } else {
      log.queue('no_next_queue_item', `No more non-halted queue items after ${graduatedName} graduated`, {
        remainingFinishingGates,
        queueLength: currentQueue.length,
      });
    }
  }
  
  return updatedRecipes;
}

/**
 * Handle a gate completing its final batch during batch limit transitioning
 * Uses the existing transition completion mechanism
 * @param {number} gate - The gate that completed
 * @param {Object} recipe - The recipe being transitioned
 * @returns {Object|null} - Info about the gate handoff, or null if no handoff
 */
function handleBatchLimitGateComplete(gate, recipe) {
  const activeRecipes = getActiveRecipes();
  const queue = getOrderQueue();
  
  // Use a STABLE key for tracking - orderId for orders, or recipeName + batchLimitTransitioning flag for recipes
  // Don't use gates in the key since gates change during transitioning
  
  // Find the transitioning recipe by matching on stable properties
  let targetRecipe = activeRecipes.find(r => {
    if (r.orderId && recipe.orderId) {
      return r.orderId === recipe.orderId && r.batchLimitTransitioning;
    }
    // For non-order recipes, match by name AND transitioning flag
    return r.recipeName === recipe.recipeName && r.batchLimitTransitioning && r.gates.includes(gate);
  });
  
  if (!targetRecipe) {
    log.queue('batch_limit_gate_complete_no_target', `Gate ${gate} batch complete but no transitioning recipe found`, { gate, recipeName: recipe.recipeName });
    return null;
  }
  
  // Complete the gate transition using existing system
  completeGateTransition(gate);
  
  // Remove this gate from the finishing recipe
  const newGates = (targetRecipe.gates || []).filter(g => g !== gate);
  const recipeFullyDone = newGates.length === 0;
  
  // Find the incoming recipe (if any) - needed for position replacement
  const incomingRecipe = recipeFullyDone 
    ? activeRecipes.find(r => r._isIncomingFromQueue && !r.batchLimitTransitioning)
    : null;
  
  // Update active recipes - use reference matching, not key matching
  let updatedRecipes = activeRecipes.map(r => {
    // Match by reference or by stable identifiers
    const isTarget = (r.orderId && targetRecipe.orderId && r.orderId === targetRecipe.orderId && r.batchLimitTransitioning) ||
                     (r === targetRecipe) ||
                     (r.recipeName === targetRecipe.recipeName && r.batchLimitTransitioning && r.gates.includes(gate));
    
    if (isTarget) {
      if (recipeFullyDone && incomingRecipe) {
        // REPLACE the finishing recipe with the incoming recipe AT THE SAME POSITION
        // This ensures color inheritance (same array index = same color)
        return { ...incomingRecipe, _replacedFinishing: true };
      } else if (recipeFullyDone) {
        // No incoming recipe - just mark for removal
        return { ...r, _toRemove: true, gates: [] };
      }
      return { ...r, gates: newGates };
    }
    return r;
  });
  
  // Remove the incoming recipe from its OLD position (it's now at the finishing recipe's position)
  if (recipeFullyDone && incomingRecipe) {
    updatedRecipes = updatedRecipes.filter(r => {
      // Remove the original incoming recipe entry (not the one that replaced the finishing recipe)
      if (r._isIncomingFromQueue && !r._replacedFinishing && r._queueBatchId === incomingRecipe._queueBatchId) {
        return false;
      }
      return true;
    });
    // Clean up temporary and incoming flags - the recipe is now a normal active recipe
    updatedRecipes = updatedRecipes.map(r => {
      if (r._replacedFinishing) {
        const { _replacedFinishing, _isIncomingFromQueue, _queueBatchId, ...clean } = r;
        return clean;
      }
      return r;
    });
    
    // Clear transition tracking for the graduated recipe's gates
    const replacedRecipe = updatedRecipes.find(r => incomingRecipe && r.recipeName === incomingRecipe.recipeName);
    if (replacedRecipe) {
      const state = getState();
      const completedSet = new Set(state.completedTransitionGates || []);
      const transitioningSet = new Set(state.transitioningGates || []);
      const startRecipes = { ...(state.transitionStartRecipes || {}) };
      let changed = false;
      for (const g of (replacedRecipe.gates || [])) {
        if (completedSet.delete(g)) changed = true;
        if (transitioningSet.delete(g)) changed = true;
        if (startRecipes[g]) { delete startRecipes[g]; changed = true; }
      }
      if (changed) {
        updateState({
          completedTransitionGates: Array.from(completedSet),
          transitioningGates: Array.from(transitioningSet),
          transitionStartRecipes: startRecipes,
        });
      }
    }
  }
  
  // Remove recipes marked for removal (only if no incoming recipe replaced it)
  updatedRecipes = updatedRecipes.filter(r => !r._toRemove);
  
  // Now assign the freed gate to the next queue item (if any)
  // IMPORTANT: Filter out any queue items that match the finishing recipe (safety check)
  let workingQueue = queue.filter(qItem => {
    const isSameAsFinishing = recipe.orderId 
      ? qItem.orderId === recipe.orderId 
      : qItem.recipeName === recipe.recipeName;
    return !isSameAsFinishing;
  });
  
  // If we filtered out the finishing recipe, persist the change
  if (workingQueue.length < queue.length) {
    setOrderQueue(workingQueue);
    log.queue('finishing_recipe_filtered_from_queue', `Filtered finishing recipe ${recipe.recipeName} from queue during gate handoff`, {
      gate,
      recipeName: recipe.recipeName,
    });
  }
  
  let handoffResult = null;
  // Find the first non-halted queue item (halted items require manual re-activation)
  const firstNonHaltedIdx = workingQueue.findIndex(item => item.status !== 'halted');
  if (firstNonHaltedIdx >= 0) {
    const firstItem = workingQueue[firstNonHaltedIdx];
    const minGates = firstItem.minGates || 1;
    
    // Generate a STABLE queue batch ID - use existing one or create one WITHOUT Date.now()
    // The ID must be the same across multiple gate completions
    let queueBatchId = firstItem._queueBatchId;
    if (!queueBatchId) {
      // Create a stable ID based on recipe properties (NOT time-based)
      queueBatchId = `incoming_${firstItem.orderId || firstItem.recipeName}_${firstItem.recipeId || 'q'}`;
      // IMPORTANT: Update the queue item with this ID so subsequent calls can find it
      workingQueue = workingQueue.map((item, idx) => {
        if (idx === firstNonHaltedIdx) {
          return { ...item, _queueBatchId: queueBatchId };
        }
        return item;
      });
      setOrderQueue(workingQueue);
    }
    
    // Find existing incoming recipe by _queueBatchId OR by _isIncomingFromQueue flag
    // Also match already-active recipes that correspond to this queue item
    let replacementRecipe = updatedRecipes.find(r => {
      if (r.batchLimitTransitioning) return false;
      // Match by orderId for orders
      if (firstItem.orderId) {
        return r.orderId === firstItem.orderId;
      }
      // Match by queue batch ID
      if (r._queueBatchId === queueBatchId) {
        return true;
      }
      // Match by _isIncomingFromQueue with same recipeName
      if (r.recipeName === firstItem.recipeName && r._isIncomingFromQueue) {
        return true;
      }
      // Fallback: match already-active recipe by recipeName (not transitioning, not an order)
      return r.recipeName === firstItem.recipeName && !r.orderId;
    });
    
    // If we found an existing active recipe that isn't yet marked as incoming, mark it
    if (replacementRecipe && !replacementRecipe._isIncomingFromQueue) {
      updatedRecipes = updatedRecipes.map(r => {
        if (r === replacementRecipe) {
          return { ...r, _isIncomingFromQueue: true, _queueBatchId: queueBatchId };
        }
        return r;
      });
      replacementRecipe = { ...replacementRecipe, _isIncomingFromQueue: true, _queueBatchId: queueBatchId };
      log.queue('existing_active_promoted_to_incoming', `Existing active recipe ${replacementRecipe.recipeName} promoted to incoming during gate handoff`, {
        recipeName: replacementRecipe.recipeName,
        existingGates: replacementRecipe.gates,
        gate,
      });
    }
    
    if (replacementRecipe) {
      // Add gate to existing replacement recipe
      log.queue('adding_gate_to_replacement', `Adding gate ${gate} to existing incoming recipe`, {
        recipeName: replacementRecipe.recipeName,
        existingGates: replacementRecipe.gates,
        newGate: gate,
      });
      
      updatedRecipes = updatedRecipes.map(r => {
        // Match by queueBatchId, or by orderId/recipeName for already-active recipes
        const isMatch = (r._queueBatchId === queueBatchId) ||
          (firstItem.orderId ? r.orderId === firstItem.orderId && !r.batchLimitTransitioning :
           r.recipeName === firstItem.recipeName && r._isIncomingFromQueue && !r.batchLimitTransitioning);
        if (isMatch) {
          const newGatesForReplacement = [...(r.gates || []), gate].sort((a, b) => a - b);
          return { 
            ...r, // Keep existing properties from the recipe
            gates: newGatesForReplacement,
            gatesAssigned: newGatesForReplacement.length,
            // Ensure critical properties are set (fallback to firstItem)
            recipeName: r.recipeName || firstItem.recipeName,
            displayName: r.displayName || firstItem.displayName || firstItem.recipeName,
            params: r.params || firstItem.params,
            _isIncomingFromQueue: true, // Keep the UI flag
          };
        }
        return r;
      });
      
      const newAssignedCount = (replacementRecipe.gates?.length || 0) + 1;
      const isFullyAssigned = newAssignedCount >= minGates;
      
      if (isFullyAssigned) {
        // Remove from queue
        workingQueue = workingQueue.filter((_, idx) => idx !== firstNonHaltedIdx);
        setOrderQueue(workingQueue);
        log.queue('queue_item_fully_assigned_batch_limit', `Queue item ${firstItem.recipeName} fully assigned during batch limit transition`, {
          recipeName: firstItem.recipeName,
          assignedGates: newAssignedCount,
        });
      } else {
        // Update queue with new assigned count (but don't set status to 'assigned' yet)
        workingQueue = workingQueue.map((item, idx) => {
          if (idx === firstNonHaltedIdx) {
            return { ...item, gatesAssigned: newAssignedCount, _queueBatchId: queueBatchId };
          }
          return item;
        });
        setOrderQueue(workingQueue);
      }
      
      handoffResult = { type: 'added_to_replacement', gate, assigned: newAssignedCount, needed: minGates };
      
      // GRADUATION: If fully assigned and finishing recipe still has remaining gates,
      // "graduate" this recipe (clear incoming flag) and prepare the next queue item
      if (isFullyAssigned) {
        updatedRecipes = graduateIncomingRecipe(updatedRecipes, queueBatchId, newGates, workingQueue, firstItem.recipeName);
        workingQueue = getOrderQueue(); // Re-read queue after graduation may have modified it
      }
    } else {
      // Create new active recipe from queue item with unique batch ID
      const newActive = {
        type: firstItem.type,
        recipeId: firstItem.recipeId,
        recipeName: firstItem.recipeName || firstItem.displayName || firstItem.name,
        displayName: firstItem.displayName || firstItem.recipeName,
        params: firstItem.params,
        requestedBatches: firstItem.requestedBatches || 0,
        minGates: firstItem.minGates,
        orderId: firstItem.orderId,
        customerName: firstItem.customerName,
        gates: [gate],
        completedBatches: firstItem.completedBatches || 0,
        gatesAssigned: 1,
        _queueBatchId: queueBatchId,
        _isIncomingFromQueue: true,
      };
      
      log.queue('new_active_from_queue', `Creating new active recipe from queue item`, {
        recipeName: newActive.recipeName,
        gate,
        queueBatchId,
        minGates: newActive.minGates,
      });
      
      if (!newActive.recipeName) {
        log.error('queue', 'missing_recipe_name', new Error('New active recipe has no recipeName!'), {
          firstItemRecipeName: firstItem.recipeName,
          queueItemKeys: Object.keys(firstItem),
        });
      }
      
      updatedRecipes.push(newActive);
      
      if (minGates <= 1) {
        // Fully assigned with just 1 gate - remove from queue
        workingQueue = workingQueue.filter((_, idx) => idx !== firstNonHaltedIdx);
        setOrderQueue(workingQueue);
        handoffResult = { type: 'activated', gate, assigned: 1, needed: minGates };
        
        // GRADUATION: same logic - if finishing recipe has more gates, prepare next queue item
        updatedRecipes = graduateIncomingRecipe(updatedRecipes, queueBatchId, newGates, workingQueue, firstItem.recipeName);
        workingQueue = getOrderQueue();
      } else {
        // Partially assigned - update queue with batch ID
        workingQueue = workingQueue.map((item, idx) => {
          if (idx === firstNonHaltedIdx) {
            return { ...item, gatesAssigned: 1, _queueBatchId: queueBatchId };
          }
          return item;
        });
        setOrderQueue(workingQueue);
        handoffResult = { type: 'partial', gate, assigned: 1, needed: minGates };
      }
    }
  }
  
  setActiveRecipes(updatedRecipes);
  
  // EDGE CASE: Check if any recipe that just received a gate has now reached
  // its own batch limit transition threshold. This happens when an incoming recipe
  // gets enough gates to change its threshold calculation:
  // e.g., 8/10 completed with 1 gate → threshold=9 (not transitioning)
  //       8/10 completed with 2 gates → threshold=8 (should start transitioning NOW!)
  const postAssignRecipes = getActiveRecipes();
  for (const r of postAssignRecipes) {
    if (!r.batchLimitTransitioning && shouldStartBatchLimitTransition(r)) {
      log.queue('gate_assignment_triggered_transition', `Recipe ${r.recipeName} reached batch limit threshold after receiving gate`, {
        recipeName: r.recipeName,
        completedBatches: r.completedBatches,
        requestedBatches: r.requestedBatches,
        gates: r.gates,
        threshold: r.requestedBatches - r.gates.length,
      });
      startBatchLimitTransition(r);
    }
  }
  
  // Check if all gates of the original recipe are done
  const remainingGates = newGates.length;
  if (remainingGates === 0) {
    log.operations('batch_limit_transition_complete', `Recipe ${recipe.recipeName} fully completed all gates`, {
      recipeName: recipe.recipeName,
      orderId: recipe.orderId || null,
    });
    
    const currentState = getState();
    if (currentState.transitioningGates.length === 0) {
      // No more transitions at all - do a full finalize
      finalizeTransitions();
    } else {
      // New transitions started (e.g., incoming recipe reached its own batch limit).
      // Clear stale completedTransitionGates from the OLD finished transition so the
      // frontend doesn't keep showing "TRANSITIONING" / "Finishing" labels for the
      // now-completed recipe. Only keep completedTransitionGates that belong to the
      // currently active transitions.
      const activeTransitionGates = new Set(currentState.transitioningGates);
      const staleCompleted = (currentState.completedTransitionGates || [])
        .filter(g => !activeTransitionGates.has(g));
      if (staleCompleted.length > 0) {
        const freshCompleted = (currentState.completedTransitionGates || [])
          .filter(g => activeTransitionGates.has(g));
        const freshStartRecipes = { ...(currentState.transitionStartRecipes || {}) };
        for (const g of staleCompleted) {
          delete freshStartRecipes[g];
        }
        updateState({
          completedTransitionGates: freshCompleted,
          transitionStartRecipes: freshStartRecipes,
        });
        log.operations('stale_transition_cleanup', `Cleared ${staleCompleted.length} stale completed gates after batch limit transition`, {
          staleGates: staleCompleted,
          remainingTransitioning: currentState.transitioningGates,
        });
      }

      // Also clean up batchLimitTransitioning/isFinishing flags from recipes that
      // are NOT actually in a batch limit transition (stale flags from the just-completed one)
      const currentRecipes = getActiveRecipes();
      const recipesNeedCleaning = currentRecipes.some(r =>
        (r.batchLimitTransitioning || r.isFinishing) &&
        !(r.gates || []).some(g => activeTransitionGates.has(g))
      );
      if (recipesNeedCleaning) {
        const cleanedRecipes = currentRecipes.map(r => {
          if ((r.batchLimitTransitioning || r.isFinishing) &&
              !(r.gates || []).some(g => activeTransitionGates.has(g))) {
            const c = { ...r };
            delete c.batchLimitTransitioning;
            delete c.isFinishing;
            delete c._isIncomingFromQueue;
            delete c._queueBatchId;
            return c;
          }
          return r;
        });
        setActiveRecipes(cleanedRecipes);
      }
    }
  }
  
  log.operations('batch_limit_gate_freed', `Gate ${gate} freed from ${recipe.recipeName} and handed to queue`, {
    gate,
    recipeName: recipe.recipeName,
    remainingGates: newGates,
    handoff: handoffResult,
  });
  
  return handoffResult;
}

/**
 * Assign a freed gate to the first queue item that can use it
 * NOTE: This is a simplified version - for batch limit transitions, use handleBatchLimitGateComplete instead
 * @param {number} gate - The gate that was freed
 * @returns {Object|null} - Info about the assignment, or null if no assignment made
 */
function assignFreedGateToQueue(gate) {
  const queue = getOrderQueue();
  const activeRecipes = getActiveRecipes();
  
  if (queue.length === 0) {
    log.queue('no_queue_item', `Gate ${gate} freed but queue is empty`, { gate });
    return null;
  }
  
  // Find the first non-halted queue item (halted items require manual re-activation)
  const firstNonHaltedIdx = queue.findIndex(item => item.status !== 'halted');
  if (firstNonHaltedIdx < 0) {
    log.queue('no_queue_item', `Gate ${gate} freed but all queue items are halted`, { gate });
    return null;
  }
  const firstItem = queue[firstNonHaltedIdx];
  const minGates = firstItem.minGates || 1;
  
  // Check if this item is already partially assigned in active recipes
  // Use unique key to find the exact match
  let existingActive = null;
  const firstItemKey = firstItem.orderId 
    ? `order_${firstItem.orderId}` 
    : `recipe_${firstItem.recipeName}_queue_${firstItem.recipeId || 'manual'}`;
  
  for (const r of activeRecipes) {
    if (r.batchLimitTransitioning) continue; // Skip finishing recipes
    
    if (firstItem.orderId && r.orderId === firstItem.orderId) {
      existingActive = r;
      break;
    }
    if (!firstItem.orderId && !r.orderId && r.recipeName === firstItem.recipeName && r._isFromQueue) {
      existingActive = r;
      break;
    }
  }
  
  if (existingActive) {
    // Add gate to existing active recipe
    const updatedRecipes = activeRecipes.map(r => {
      if (r === existingActive) {
        const newGates = [...(r.gates || []), gate].sort((a, b) => a - b);
        return { ...r, gates: newGates };
      }
      return r;
    });
    setActiveRecipes(updatedRecipes);
    
    const newAssignedCount = (existingActive.gates?.length || 0) + 1;
    const isFullyAssigned = newAssignedCount >= minGates;
    
    // Update queue item's gatesAssigned (but NOT status - that's for manual actions only)
    const updatedQueue = queue.map((item, idx) => {
      if (idx === firstNonHaltedIdx) {
        return { ...item, gatesAssigned: newAssignedCount };
      }
      return item;
    });
    
    // Remove from queue if fully assigned
    if (isFullyAssigned) {
      setOrderQueue(updatedQueue.filter((_, idx) => idx !== firstNonHaltedIdx));
      log.queue('queue_item_fully_assigned', `Queue item ${firstItem.recipeName} fully assigned (${newAssignedCount}/${minGates})`, {
        recipeName: firstItem.recipeName,
        gates: [...(existingActive.gates || []), gate],
      });
    } else {
      setOrderQueue(updatedQueue);
      log.queue('queue_item_partial_assign', `Gate ${gate} added to ${firstItem.recipeName} (${newAssignedCount}/${minGates})`, {
        recipeName: firstItem.recipeName,
        gate,
        assigned: newAssignedCount,
        needed: minGates,
      });
    }
    
    return { type: 'added_to_existing', gate, recipe: firstItem, assigned: newAssignedCount, needed: minGates };
  }
  
  // Create new active recipe from queue item
  const newActive = {
    ...firstItem,
    gates: [gate],
    _isFromQueue: true, // Mark as from queue for matching
    completedBatches: firstItem.completedBatches || 0,
    requestedBatches: firstItem.requestedBatches || 0,
  };
  
  // Add to active recipes
  setActiveRecipes([...activeRecipes, newActive]);
  
  // Update queue
  if (minGates <= 1) {
    // Fully assigned, remove from queue
    setOrderQueue(queue.filter((_, idx) => idx !== firstNonHaltedIdx));
    log.queue('queue_item_activated', `Queue item ${firstItem.recipeName} activated on gate ${gate}`, {
      recipeName: firstItem.recipeName,
      gate,
    });
    return { type: 'activated', gate, recipe: firstItem, assigned: 1, needed: minGates };
  } else {
    // Partially assigned, update queue (but NOT status)
    const updatedQueue = queue.map((item, idx) => {
      if (idx === firstNonHaltedIdx) {
        return { ...item, gatesAssigned: 1 };
      }
      return item;
    });
    setOrderQueue(updatedQueue);
    log.queue('queue_item_partial_assign', `Gate ${gate} assigned to ${firstItem.recipeName} (1/${minGates})`, {
      recipeName: firstItem.recipeName,
      gate,
      assigned: 1,
      needed: minGates,
    });
    return { type: 'partial', gate, recipe: firstItem, assigned: 1, needed: minGates };
  }
}

/**
 * Persist gate snapshot (pieces/weight per gate) to the database.
 * Called after each piece is processed so gate data survives restarts.
 */
function persistGateSnapshot() {
  try {
    const gates = require('../state/gates');
    const snapshot = gates.getSnapshot();
    db.prepare(`UPDATE machine_state SET gate_snapshot = ? WHERE id = 1`).run(JSON.stringify(snapshot));
  } catch (e) {
    log.error('system', 'persist_gate_snapshot_error', e);
  }
}

/**
 * Restore gate snapshot from the database on startup.
 */
function restoreGateSnapshot() {
  try {
    const row = db.prepare(`SELECT gate_snapshot FROM machine_state WHERE id = 1`).get();
    if (row && row.gate_snapshot) {
      const snapshot = JSON.parse(row.gate_snapshot);
      if (Array.isArray(snapshot) && snapshot.length > 0) {
        const gates = require('../state/gates');
        gates.loadSnapshot(snapshot);
        log.system('gate_snapshot_restored', `Restored gate snapshot`, {
          gates: snapshot.filter(g => g.pieces > 0 || g.grams > 0).map(g => ({
            gate: g.gate, pieces: g.pieces, grams: Math.round(g.grams * 10) / 10,
          })),
        });
        return true;
      }
    }
    return false;
  } catch (e) {
    log.error('system', 'restore_gate_snapshot_error', e);
    return false;
  }
}

/**
 * Clear all batch limit transition state from active recipes and queue.
 * Used when a finishing recipe is immediately removed (no transition needed).
 */
function clearBatchLimitTransitions() {
  const recipes = getActiveRecipes();
  const cleaned = recipes.map(r => {
    const c = { ...r };
    delete c.batchLimitTransitioning;
    delete c.isFinishing;
    delete c._isIncomingFromQueue;
    delete c._queueBatchId;
    delete c._isReplacementRecipe;
    return c;
  });
  setActiveRecipes(cleaned);
  
  // Also clean queue items' batch limit transition metadata
  const queue = getOrderQueue();
  const cleanedQueue = queue.map(q => {
    const c = { ...q };
    delete c._queueBatchId;
    return c;
  });
  setOrderQueue(cleanedQueue);
  
  log.operations('batch_limit_transitions_cleared', 'All batch limit transition flags cleared from active recipes and queue');
}

/**
 * Toggle pause on a specific gate
 */
function toggleGatePause(gate, paused) {
  const state = getState();
  let pausedGates = state.pausedGates || [];
  if (paused) {
    if (!pausedGates.includes(gate)) pausedGates = [...pausedGates, gate];
  } else {
    pausedGates = pausedGates.filter(g => g !== gate);
  }
  updateState({ pausedGates });
  return pausedGates;
}

/**
 * Get paused gates
 */
function getPausedGates() {
  return getState().pausedGates || [];
}

/**
 * Toggle pause on a recipe (by composite key)
 */
function toggleRecipePause(recipeName, orderId, paused) {
  const recipes = getActiveRecipes();
  const updated = recipes.map(r => {
    const match = orderId
      ? r.orderId === orderId
      : r.recipeName === recipeName && !r.orderId;
    if (match) return { ...r, paused: !!paused };
    return r;
  });
  setActiveRecipes(updated);
  return updated;
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
  getOrderQueue,
  setOrderQueue,
  incrementRecipeBatchCount,
  recoverOrphanedOrders,
  // Batch limit transitioning
  shouldStartBatchLimitTransition,
  startBatchLimitTransition,
  handleBatchLimitGateComplete,
  assignFreedGateToQueue,
  // Batch limit transition management
  clearBatchLimitTransitions,
  // Gate snapshot persistence
  persistGateSnapshot,
  restoreGateSnapshot,
  // Pausing
  toggleGatePause,
  getPausedGates,
  toggleRecipePause,
};

/**
 * Recover orphaned orders on startup
 * Orders with status 'assigned' or 'in-production' that are NOT in activeRecipes or orderQueue
 * should be reset to 'received' so they don't get lost
 */
function recoverOrphanedOrders() {
  try {
    const state = getState();
    const activeRecipes = state.activeRecipes || [];
    const orderQueue = state.orderQueue || [];
    
    // Get all order IDs that are currently in active recipes or queue
    const activeOrderIds = new Set();
    activeRecipes.forEach(r => {
      if (r.orderId) activeOrderIds.add(r.orderId);
    });
    orderQueue.forEach(r => {
      if (r.orderId) activeOrderIds.add(r.orderId);
    });
    
    // Clear stale gate assignments from any order with "received" status
    // (gates should only be set when an order is assigned/in-production)
    db.prepare(`UPDATE orders SET assigned_gates = '[]' WHERE status = 'received' AND assigned_gates != '[]'`).run();
    
    // Find orphaned orders (status is 'assigned' or 'in-production' but not in active/queue)
    const orphanedOrders = db.prepare(`
      SELECT id, status FROM orders 
      WHERE status IN ('assigned', 'in-production') 
    `).all();
    
    let recoveredCount = 0;
    for (const order of orphanedOrders) {
      if (!activeOrderIds.has(order.id)) {
        // This order is orphaned - reset to 'received' and clear gates
        db.prepare('UPDATE orders SET status = ?, assigned_gates = ? WHERE id = ?').run('received', '[]', order.id);
        log.operations('order_recovered', `Orphaned order #${order.id} recovered, gates cleared`, {
          orderId: order.id,
          previousStatus: order.status,
          newStatus: 'received',
        });
        recoveredCount++;
      }
    }
    
    if (recoveredCount > 0) {
      log.system('orders_recovery', `Recovered ${recoveredCount} orphaned order(s)`, { count: recoveredCount });
    }
    
    return recoveredCount;
  } catch (error) {
    log.error('system', 'order_recovery_error', error);
    return 0;
  }
}
