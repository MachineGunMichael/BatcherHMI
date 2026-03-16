// server/routes/machine.js
// Machine control endpoints (start/pause/stop) and active recipes management

const express = require('express');
const router = express.Router();
const machineState = require('../services/machineState');
const eventBus = require('../lib/eventBus');
const db = require('../db/sqlite');
const log = require('../lib/logger');
const { verifyToken } = require('../utils/authMiddleware');
const orderRepo = require('../repositories/orderRepo');

/**
 * GET /api/machine/state
 * Get current machine state
 */
router.get('/state', (req, res) => {
  try {
    const state = machineState.getState();
    res.json(state);
  } catch (error) {
    log.error('system', 'get_machine_state_error', error);
    res.status(500).json({ error: 'Failed to get machine state' });
  }
});

/**
 * POST /api/machine/control
 * Control machine (start/pause/stop)
 * Body: { action: 'start' | 'pause' | 'stop' }
 */
router.post('/control', verifyToken, async (req, res) => {
  try {
    const { action } = req.body;
    const currentState = machineState.getState();
    const user = req.user?.username || 'system';
    
    log.machineControl(action, user, { currentState: currentState.state });
    
    switch (action) {
      case 'start':
        return handleStart(currentState, res, user);
      
      case 'pause':
        return handlePause(currentState, res, user);
      
      case 'stop':
        return await handleStop(currentState, res, user);
      
      default:
        return res.status(400).json({ error: `Invalid action: ${action}` });
    }
  } catch (error) {
    log.error('system', 'machine_control_error', error);
    res.status(500).json({ error: 'Failed to control machine' });
  }
});

/**
 * Update order statuses to "in-production" when they become active
 */
function updateOrdersToInProduction(recipes) {
  for (const recipe of recipes) {
    if (recipe.orderId) {
      try {
        const order = orderRepo.getOrderById(recipe.orderId);
        if (order && order.status === orderRepo.ORDER_STATUS.ASSIGNED) {
          orderRepo.updateOrderStatus(recipe.orderId, orderRepo.ORDER_STATUS.IN_PRODUCTION);
          orderRepo.updateOrderGates(recipe.orderId, recipe.gates);
          log.operations('order_production_started', `Order ${recipe.orderId} started production`, {
            orderId: recipe.orderId,
            gates: recipe.gates,
            customerId: recipe.customerId,
          });
        }
      } catch (e) {
        log.error('system', 'update_order_status_error', e, { orderId: recipe.orderId });
      }
    }
  }
}

/**
 * Update order statuses to "halted" when they are removed from production
 */
function updateOrdersToHalted(recipes) {
  for (const recipe of recipes) {
    if (recipe.orderId) {
      try {
        const order = orderRepo.getOrderById(recipe.orderId);
        if (order && (order.status === orderRepo.ORDER_STATUS.IN_PRODUCTION || order.status === orderRepo.ORDER_STATUS.ASSIGNED)) {
          orderRepo.updateOrderStatus(recipe.orderId, orderRepo.ORDER_STATUS.HALTED);
          orderRepo.updateOrderGates(recipe.orderId, []);
          log.operations('order_production_halted', `Order ${recipe.orderId} halted, gates cleared`, {
            orderId: recipe.orderId,
            completedBatches: order.completed_batches,
          });
        }
      } catch (e) {
        log.error('system', 'update_order_halted_error', e, { orderId: recipe.orderId });
      }
    }
  }
}

/**
 * Handle START action
 */
function handleStart(currentState, res, user) {
  if (currentState.state === 'idle') {
    // Start from idle: create new program
    if (currentState.activeRecipes.length === 0) {
      return res.status(400).json({ error: 'No active recipes to start' });
    }
    
    // Create new program
    const startTime = new Date().toISOString();
    const programName = `program_${startTime.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')}`;
    const insertProgram = db.prepare('INSERT INTO programs (name) VALUES (?)');
    const result = insertProgram.run(programName);
    const programId = result.lastInsertRowid;
    
    // Create program_stats row with start time
    try {
      db.prepare(`
        INSERT INTO program_stats (program_id, start_ts, end_ts)
        VALUES (?, ?, NULL)
      `).run(programId, startTime);
      log.programStatsCreated(programId, programName);
    } catch (e) {
      log.error('system', 'create_program_stats_error', e, { programId });
    }
    
    // Create recipe_stats rows for each active recipe
    const activeRecipes = currentState.activeRecipes;
    for (const recipe of activeRecipes) {
      const gatesAssigned = (recipe.gates || []).join(',');
      const orderId = recipe.orderId || null; // Include order_id for composite key
      try {
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, order_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0)
        `).run(programId, recipe.recipeId, orderId, gatesAssigned);
      } catch (e) {
        log.error('system', 'create_recipe_stats_error', e, { programId, recipeId: recipe.recipeId, orderId });
      }
    }
    
    // Update order statuses to "in-production" for any orders in active recipes
    updateOrdersToInProduction(activeRecipes);
    
    // Update state to running and snapshot recipes
    machineState.updateState({
      state: 'running',
      currentProgramId: programId,
    });
    machineState.snapshotRecipes();
    
    // Log program start with gate assignments
    log.programStarted(programId, programName, activeRecipes);
    
    // Broadcast program change event
    eventBus.broadcast('program_change', { 
      action: 'start', 
      programId, 
      ts: new Date().toISOString() 
    });
    
    return res.json({
      success: true,
      action: 'start_new_program',
      programId,
      programName,
      state: machineState.getState(),
    });
    
  } else if (currentState.state === 'paused') {
    // Start from paused: check if recipes changed
    const changed = machineState.recipesChanged();
    const alreadyTransitioning = machineState.hasTransitioningGates();
    const existingTransitionOldProgramId = machineState.getTransitionOldProgramId();
    const isInTransitionPeriod = machineState.isInTransitionPeriod();
    
    // BATCH LIMIT TRANSITION RESUME: If recipes changed only due to batch limit transitions
    // (not manual edits), just resume running - the batch limit system manages its own lifecycle
    const hasBatchLimitTransitions = currentState.activeRecipes.some(r => 
      r.batchLimitTransitioning || r.isFinishing || r._isIncomingFromQueue
    );
    
    if (hasBatchLimitTransitions && !existingTransitionOldProgramId) {
      // Check if there are ALSO manual recipe changes (non-batch-limit transitions)
      // Manual transitions would be in transitioningGates but NOT belonging to batch limit recipes
      const batchLimitGateSet = new Set();
      currentState.activeRecipes.forEach(r => {
        if (r.batchLimitTransitioning || r.isFinishing || r._isIncomingFromQueue) {
          (r.gates || []).forEach(g => batchLimitGateSet.add(g));
        }
      });
      const manualTransitionGates = (currentState.transitioningGates || []).filter(g => !batchLimitGateSet.has(g));
      const hasManualChanges = manualTransitionGates.length > 0;
      
      if (!hasManualChanges) {
        // Pure batch limit transition - just resume
        log.operations('batch_limit_resume', `Resuming from pause during batch limit transition`, {
          programId: currentState.currentProgramId,
          batchLimitRecipes: currentState.activeRecipes
            .filter(r => r.batchLimitTransitioning || r.isFinishing)
            .map(r => r.recipeName),
          transitioningGates: currentState.transitioningGates,
        });
        
        const transitioningGates = machineState.getTransitioningGates();
        const currentRegisteredGates = currentState.registeredTransitioningGates || [];
        const newRegisteredGates = [...new Set([...currentRegisteredGates, ...transitioningGates])];
        
        machineState.updateState({ 
          state: 'running',
          registeredTransitioningGates: newRegisteredGates,
        });
        
        return res.json({
          success: true,
          action: 'resume_batch_limit_transition',
          state: machineState.getState(),
        });
      }
    }
    
    if (changed || alreadyTransitioning) {
      
      // MERGED TRANSITIONS: If we're already in a transition period, DON'T create a new program
      if (isInTransitionPeriod && existingTransitionOldProgramId) {
        const currentProgramId = currentState.currentProgramId;
        
        log.operations('merged_transition_resume', `Resuming merged transition from program ${existingTransitionOldProgramId}`, {
          oldProgramId: existingTransitionOldProgramId,
          currentProgramId,
        });
        
        // Update recipe_stats for current program
        db.prepare(`DELETE FROM recipe_stats WHERE program_id = ?`).run(currentProgramId);
        
        const activeRecipes = machineState.getActiveRecipes();
        for (const recipe of activeRecipes) {
          const gatesAssigned = (recipe.gates || []).join(',');
          const orderId = recipe.orderId || null;
          db.prepare(`
            INSERT INTO recipe_stats (
              program_id, recipe_id, order_id, gates_assigned,
              total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
              total_items_batched, total_items_rejected
            ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0)
          `).run(currentProgramId, recipe.recipeId, orderId, gatesAssigned);
        }
        
        const transitioningGates = machineState.getTransitioningGates();
        const currentRegisteredGates = currentState.registeredTransitioningGates || [];
        const newRegisteredGates = [...new Set([...currentRegisteredGates, ...transitioningGates])];
        
        machineState.updateState({ 
          state: 'running',
          registeredTransitioningGates: newRegisteredGates,
        });
        
        eventBus.broadcast('program_change', {
          action: 'recipes_updated', 
          programId: currentProgramId,
          activeRecipes: activeRecipes.map(r => ({ recipeId: r.recipeId, recipeName: r.recipeName, gates: r.gates })),
          ts: new Date().toISOString() 
        });
        
        return res.json({
          success: true,
          action: 'merged_transition_resume',
          recipesChanged: true,
          oldProgramId: existingTransitionOldProgramId,
          currentProgramId: currentProgramId,
          transitioningGates: transitioningGates,
          completedTransitionGates: machineState.getCompletedTransitionGates(),
          state: machineState.getState(),
        });
      }
      
      // FIRST TRANSITION: Create NEW program
      const oldProgramId = currentState.currentProgramId;
      machineState.setTransitionOldProgramId(oldProgramId);
      
      const transitionTime = new Date().toISOString();
      db.prepare(`UPDATE program_stats SET end_ts = ? WHERE program_id = ?`).run(transitionTime, oldProgramId);
      
      const startTime = transitionTime;
      const programName = `program_${startTime.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')}`;
      const insertProgram = db.prepare('INSERT INTO programs (name) VALUES (?)');
      const result = insertProgram.run(programName);
      const newProgramId = result.lastInsertRowid;
      
      // Log new program creation
      log.programCreated(newProgramId, programName);
      log.transitionStarted(oldProgramId, newProgramId, machineState.getTransitioningGates());
      
      db.prepare(`
        INSERT INTO program_stats (program_id, start_ts, end_ts)
        VALUES (?, ?, NULL)
      `).run(newProgramId, startTime);
      
      const activeRecipes = machineState.getActiveRecipes();
      for (const recipe of activeRecipes) {
        const gatesAssigned = (recipe.gates || []).join(',');
        const orderId = recipe.orderId || null;
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, order_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0)
        `).run(newProgramId, recipe.recipeId, orderId, gatesAssigned);
      }
      
      const transitioningGates = machineState.getTransitioningGates();
      
      if (transitioningGates.length === 0) {
        calculateAndWriteProgramStats(oldProgramId);
        machineState.clearTransitionOldProgramId();
      }
      
      machineState.updateState({ 
        state: 'running',
        currentProgramId: newProgramId,
        registeredTransitioningGates: transitioningGates.slice(),
      });
      
      if (transitioningGates.length === 0) {
        machineState.snapshotRecipes();
      }
      
      eventBus.broadcast('program_change', { 
        action: 'recipe_change', 
        programId: newProgramId, 
        ts: new Date().toISOString() 
      });
      
      return res.json({
        success: true,
        action: 'new_program_with_transitions',
        recipesChanged: true,
        oldProgramId,
        newProgramId,
        programName,
        transitioningGates: transitioningGates,
        completedTransitionGates: machineState.getCompletedTransitionGates(),
        state: machineState.getState(),
      });
      
    } else {
      // No change: just resume
      log.operations('program_resumed', `Program ${currentState.currentProgramId} resumed`, { programId: currentState.currentProgramId });
      machineState.updateState({ state: 'running' });
      
      return res.json({
        success: true,
        action: 'resume',
        recipesChanged: false,
        state: machineState.getState(),
      });
    }
    
  } else {
    return res.status(400).json({ 
      error: `Cannot start from state: ${currentState.state}` 
    });
  }
}

/**
 * Handle PAUSE action
 */
function handlePause(currentState, res, user) {
  if (currentState.state !== 'running') {
    return res.status(400).json({ 
      error: `Cannot pause from state: ${currentState.state}` 
    });
  }
  
  log.operations('machine_paused', `Machine paused for program ${currentState.currentProgramId}`, { programId: currentState.currentProgramId });
  machineState.updateState({ state: 'paused' });
  
  return res.json({
    success: true,
    action: 'pause',
    state: machineState.getState(),
  });
}

/**
 * Calculate and update recipe/program stats from batch_completions
 */
function calculateAndWriteProgramStats(programId) {
  const startTime = Date.now();
  
  try {
    const programInfo = db.prepare(`
      SELECT start_ts, end_ts FROM program_stats WHERE program_id = ?
    `).get(programId);
    
    // Group by both recipe_id and order_id to support composite keys
    // (same recipe can run as order vs regular recipe simultaneously)
    const batchStats = db.prepare(`
      SELECT 
        recipe_id,
        order_id,
        COUNT(*) as total_batches,
        SUM(pieces) as total_items_batched,
        SUM(weight_g) as total_batched_weight_g
      FROM batch_completions
      WHERE program_id = ?
      GROUP BY recipe_id, order_id
    `).all(programId);
    
    for (const stats of batchStats) {
      const recipe = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(stats.recipe_id);
      
      let giveawayWeightG = 0;
      if (recipe && recipe.batch_min_weight_g) {
        const targetWeight = recipe.batch_min_weight_g * stats.total_batches;
        giveawayWeightG = Math.max(0, stats.total_batched_weight_g - targetWeight);
      }
      
      // UPSERT: try UPDATE first, INSERT if row doesn't exist
      const updateResult = db.prepare(`
        UPDATE recipe_stats 
        SET 
          total_batches = ?,
          total_items_batched = ?,
          total_batched_weight_g = ?,
          total_giveaway_weight_g = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE program_id = ? AND recipe_id = ? AND COALESCE(order_id, 0) = COALESCE(?, 0)
      `).run(
        stats.total_batches,
        stats.total_items_batched,
        stats.total_batched_weight_g,
        giveawayWeightG,
        programId,
        stats.recipe_id,
        stats.order_id
      );

      if (updateResult.changes === 0) {
        // Row didn't exist (initial INSERT failed or was never created) - create it now
        const gatesStr = db.prepare(`
          SELECT GROUP_CONCAT(DISTINCT gate) as gates
          FROM batch_completions
          WHERE program_id = ? AND recipe_id = ? AND gate > 0
        `).get(programId, stats.recipe_id);

        try {
          db.prepare(`
            INSERT INTO recipe_stats (
              program_id, recipe_id, order_id, gates_assigned,
              total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
              total_items_batched, total_items_rejected
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
          `).run(
            programId,
            stats.recipe_id,
            stats.order_id || null,
            gatesStr?.gates || '',
            stats.total_batches,
            stats.total_batched_weight_g,
            giveawayWeightG,
            stats.total_items_batched
          );
        } catch (insertErr) {
          log.error('system', 'recipe_stats_upsert_error', insertErr, { programId, recipeId: stats.recipe_id });
        }
      }
    }
    
    // Get reject totals
    let rejectCount = 0;
    let rejectWeightG = 0;
    
    if (programInfo && programInfo.start_ts) {
      const endTs = programInfo.end_ts || new Date().toISOString();
      
      const rejectData = db.prepare(`
        SELECT 
          MAX(total_rejects_count) as reject_count,
          MAX(total_rejects_weight_g) as reject_weight
        FROM kpi_minute_combined
        WHERE timestamp >= ? AND timestamp <= ?
      `).get(programInfo.start_ts, endTs);
      
      if (rejectData) {
        rejectCount = rejectData.reject_count || 0;
        rejectWeightG = rejectData.reject_weight || 0;
      }
    }
    
    // Update program_stats totals
    const programTotals = db.prepare(`
      SELECT 
        SUM(total_batches) as total_batches,
        SUM(total_items_batched) as total_items_batched,
        SUM(total_batched_weight_g) as total_batched_weight_g,
        SUM(total_giveaway_weight_g) as total_giveaway_weight_g
      FROM recipe_stats
      WHERE program_id = ?
    `).get(programId);
    
    if (programTotals) {
      db.prepare(`
        UPDATE program_stats 
        SET 
          total_batches = ?,
          total_items_batched = ?,
          total_batched_weight_g = ?,
          total_giveaway_weight_g = ?,
          total_items_rejected = ?,
          total_reject_weight_g = ?
        WHERE program_id = ?
      `).run(
        programTotals.total_batches || 0,
        programTotals.total_items_batched || 0,
        programTotals.total_batched_weight_g || 0,
        programTotals.total_giveaway_weight_g || 0,
        rejectCount,
        rejectWeightG,
        programId
      );
    }
    
    log.programStatsFinalized(programId, { 
      batches: programTotals?.total_batches || 0,
      items: programTotals?.total_items_batched || 0,
      weightG: programTotals?.total_batched_weight_g || 0,
      giveawayG: programTotals?.total_giveaway_weight_g || 0,
      rejects: rejectCount,
      rejectWeightG
    });
    
    return true;
  } catch (e) {
    log.error('system', 'stats_calculation_error', e, { programId });
    return false;
  }
}

/**
 * Handle completion of all gate transitions
 */
function handleAllTransitionsComplete() {
  try {
    const oldProgramId = machineState.getTransitionOldProgramId();
    
    if (!oldProgramId) {
      machineState.finalizeTransitions();
      return { success: true, message: 'No pending transition' };
    }
    
    calculateAndWriteProgramStats(oldProgramId);
    machineState.clearTransitionOldProgramId();
    machineState.finalizeTransitions();
    // Note: transition_completed is already logged in ingest.js before calling this
    
    const currentState = machineState.getState();
    eventBus.broadcast('program_change', {
      action: 'recipe_change',
      programId: currentState.currentProgramId,
      programStartTime: new Date().toISOString(),
      ts: new Date().toISOString()
    });
    
    return { 
      success: true, 
      oldProgramId,
      message: 'Old program stats saved successfully'
    };
  } catch (error) {
    log.error('system', 'transition_finalize_error', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle STOP action
 */
async function handleStop(currentState, res, user) {
  if (currentState.state === 'idle') {
    return res.status(400).json({ 
      error: 'Machine is already stopped' 
    });
  }
  
  // Before resetting, sync batch counts from active recipes to queue items
  // This ensures batch progress is preserved even if the frontend doesn't handle it
  const currentQueue = machineState.getOrderQueue();
  const activeRecipesForSync = currentState.activeRecipes || [];
  if (currentQueue.length > 0 && activeRecipesForSync.length > 0) {
    const updatedQueue = currentQueue.map(q => {
      const matchingActive = activeRecipesForSync.find(r => {
        if (q.orderId) return r.orderId === q.orderId;
        return r.recipeName === q.recipeName && !r.orderId && !q.orderId;
      });
      if (matchingActive && (matchingActive.completedBatches || 0) > (q.completedBatches || 0)) {
        return { ...q, completedBatches: matchingActive.completedBatches };
      }
      return q;
    });
    machineState.setOrderQueue(updatedQueue);
  }
  
  // Recipes stay in activeRecipes for operator to finish/skip individually
  // Don't clear gate assignments or order statuses yet
  
  const gates = require('../state/gates');
  gates.resetAll();
  machineState.reset(true); // keepRecipes=true so operator can finish/skip each one
  
  // Give Python worker time to detect state change and flush KPIs
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Finalize program if one was running
  if (currentState.currentProgramId) {
    const endTime = new Date().toISOString();
    const programId = currentState.currentProgramId;
    
    try {
      calculateAndWriteProgramStats(programId);

      // Manual stop: all recipes are completed (program terminated)
      db.prepare(`UPDATE recipe_stats SET completed = 1 WHERE program_id = ?`).run(programId);
      
      const updateResult = db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(endTime, programId);
      
      if (updateResult.changes === 0) {
        db.prepare(`
          INSERT OR REPLACE INTO program_stats (program_id, start_ts, end_ts)
          VALUES (?, ?, ?)
        `).run(programId, endTime, endTime);
      }
      
      log.programStopped(programId, { endTime });
      
    } catch (e) {
      log.error('system', 'program_finalize_error', e, { programId });
    }
  }
  
  eventBus.broadcast('program_change', { 
    action: 'stop', 
    ts: new Date().toISOString() 
  });
  
  return res.json({
    success: true,
    action: 'stopped',
    state: machineState.getState(),
  });
}

/**
 * POST /api/machine/transition-complete
 * Called by Python worker when batch completion is done during transition
 */
router.post('/transition-complete', async (req, res) => {
  try {
    const { programId, action } = req.body;
    const currentState = machineState.getState();
    
    log.operations('transition_notification', `Transition notification: ${action} for program ${programId}`, { programId, action });
    
    if (action === 'stop') {
      calculateAndWriteProgramStats(programId);
      db.prepare(`UPDATE recipe_stats SET completed = 1 WHERE program_id = ?`).run(programId);
      
      const endTime = new Date().toISOString();
      db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(endTime, programId);
      
      machineState.reset();
      
      eventBus.broadcast('program_change', { 
        action: 'stop', 
        ts: new Date().toISOString() 
      });
      
      return res.json({
        success: true,
        action: 'stopped',
        state: machineState.getState(),
      });
      
    } else if (action === 'recipe_change') {
      return res.json({
        success: true,
        action: 'recipe_change_acknowledged',
        message: 'Recipe change handled by ingest.js flow',
        programId: currentState.currentProgramId,
        state: machineState.getState(),
      });
      
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
  } catch (error) {
    log.error('system', 'transition_complete_error', error);
    res.status(500).json({ error: 'Failed to complete transition' });
  }
});

/**
 * GET /api/machine/recipes
 * Get active recipes
 */
router.get('/recipes', (req, res) => {
  try {
    const recipes = machineState.getActiveRecipes();
    res.json({ recipes });
  } catch (error) {
    log.error('system', 'get_recipes_error', error);
    res.status(500).json({ error: 'Failed to get active recipes' });
  }
});

/**
 * POST /api/machine/recipes
 * Update active recipes
 */
router.post('/recipes', verifyToken, (req, res) => {
  try {
    const { recipes, autoAssign, immediateRemoval } = req.body;
    const currentState = machineState.getState();
    const user = req.user?.username || 'system';
    
    if (currentState.state === 'running') {
      // Allow auto-assign (adding to empty gates) while running
      // Block manual recipe modifications while running
      if (!autoAssign) {
        return res.status(400).json({ 
          error: 'Cannot update recipes while machine is running. Please pause first.' 
        });
      }
      
      // For auto-assign, verify we're only ADDING to empty gates, not modifying existing
      const currentRecipes = currentState.activeRecipes || [];
      const currentGatesUsed = currentRecipes.flatMap(r => r.gates || []);
      const newGatesUsed = recipes.flatMap(r => r.gates || []);
      
      // Check if any current gates are being modified (removed or reassigned)
      for (const gate of currentGatesUsed) {
        if (!newGatesUsed.includes(gate)) {
          return res.status(400).json({ 
            error: 'Cannot remove recipes from gates while machine is running. Use pause first.' 
          });
        }
      }
      
      log.operations('auto_assign_while_running', 'Auto-assigning recipes to empty gates during run', {
        user,
        addedGates: newGatesUsed.filter(g => !currentGatesUsed.includes(g)),
      });
    }
    
    if (!Array.isArray(recipes)) {
      return res.status(400).json({ error: 'Recipes must be an array' });
    }
    
    for (const recipe of recipes) {
      if (!recipe.recipeName || !recipe.gates || !recipe.params) {
        return res.status(400).json({ 
          error: 'Invalid recipe structure. Each recipe must have recipeName, gates, and params' 
        });
      }
      delete recipe.isRemovedTransitioning;
    }
    
    // Ensure all recipes exist in database
    for (const recipe of recipes) {
      const recipeName = recipe.recipeName;
      const params = recipe.params;
      
      let existing = db.prepare('SELECT id FROM recipes WHERE name = ?').get(recipeName);
      
      if (!existing) {
        log.recipeCreated(recipeName, { gates: recipe.gates, autoCreated: true }, user);
        
        let minPieces = null;
        let maxPieces = null;
        if (params.countType === 'min') {
          minPieces = params.countValue;
        } else if (params.countType === 'max') {
          maxPieces = params.countValue;
        } else if (params.countType === 'exact') {
          minPieces = params.countValue;
          maxPieces = params.countValue;
        }
        
        const result = db.prepare(`
          INSERT INTO recipes (
            name, 
            piece_min_weight_g, 
            piece_max_weight_g, 
            batch_min_weight_g, 
            batch_max_weight_g, 
            min_pieces_per_batch, 
            max_pieces_per_batch
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          recipeName,
          params.pieceMinWeight || 0,
          params.pieceMaxWeight || 0,
          params.batchMinWeight || null,
          params.batchMaxWeight || null,
          minPieces,
          maxPieces
        );
        
        existing = { id: result.lastInsertRowid };
      }
      
      if (existing && recipe.recipeId !== existing.id) {
        recipe.recipeId = existing.id;
      }
    }
    
    // Track transitioning gates if paused
    const isTransitioning = currentState.state === 'paused' && currentState.currentProgramId;
    
    // Immediate removal: skip transition tracking and clear batch limit transition state.
    // Used when a finishing recipe with empty gates is removed directly to queue.
    if (immediateRemoval && isTransitioning) {
      log.operations('immediate_removal', 'Immediate removal of finishing recipe - clearing batch limit transition state', { user });
      machineState.clearBatchLimitTransitions();
    }
    
    if (isTransitioning && !immediateRemoval) {
      const affectedGates = [];
      const originalRecipes = {};
      const recipeChanges = []; // For logging
      
      const oldGateToRecipe = {};
      // First, map from programStartRecipes (original recipes at program start)
      for (const recipe of currentState.programStartRecipes) {
        for (const gate of recipe.gates || []) {
          oldGateToRecipe[gate] = {
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            displayName: recipe.displayName || recipe.display_name || null,
            params: recipe.params,
            gates: recipe.gates || [],
            orderId: recipe.orderId || null,
            completedBatches: recipe.completedBatches || 0,
            requestedBatches: recipe.requestedBatches || 0,
          };
        }
      }
      // Also include dynamically-added recipes (e.g., auto-assigned from queue after program start)
      // These are in activeRecipes but NOT in programStartRecipes.
      // Use activeRecipes as override source for completedBatches (more up-to-date).
      for (const recipe of (currentState.activeRecipes || [])) {
        for (const gate of recipe.gates || []) {
          if (!oldGateToRecipe[gate]) {
            oldGateToRecipe[gate] = {
              recipeId: recipe.recipeId,
              recipeName: recipe.recipeName,
              displayName: recipe.displayName || recipe.display_name || null,
              params: recipe.params,
              gates: recipe.gates || [],
              orderId: recipe.orderId || null,
              completedBatches: recipe.completedBatches || 0,
              requestedBatches: recipe.requestedBatches || 0,
            };
          } else {
            // Update batch counts from active recipes (they have the latest values)
            oldGateToRecipe[gate].completedBatches = recipe.completedBatches || oldGateToRecipe[gate].completedBatches || 0;
            oldGateToRecipe[gate].requestedBatches = recipe.requestedBatches || oldGateToRecipe[gate].requestedBatches || 0;
          }
        }
      }
      
      const newGateToRecipe = {};
      for (const recipe of recipes) {
        for (const gate of recipe.gates || []) {
          newGateToRecipe[gate] = {
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            displayName: recipe.displayName || recipe.display_name || null,
            params: recipe.params,
          };
        }
      }
      
      // Track recipe changes (edits/removals on existing gates)
      for (const gate of Object.keys(oldGateToRecipe)) {
        const gateNum = Number(gate);
        const oldRecipe = oldGateToRecipe[gate];
        const newRecipe = newGateToRecipe[gate];
        
        const existingTransitioning = machineState.getTransitioningGates();
        const recipeChanged = !newRecipe || newRecipe.recipeName !== oldRecipe.recipeName;
        
        if (recipeChanged && !existingTransitioning.includes(gateNum)) {
          affectedGates.push(gateNum);
          originalRecipes[gateNum] = oldRecipe;
          recipeChanges.push({
            gate: gateNum,
            from: oldRecipe.recipeName,
            to: newRecipe?.recipeName || '(removed)'
          });
        }
      }
      
      // Track new gates (additions to previously empty gates)
      const addedGates = [];
      for (const gate of Object.keys(newGateToRecipe)) {
        const gateNum = Number(gate);
        if (!oldGateToRecipe[gate]) {
          addedGates.push(gateNum);
        }
      }
      
      // Log changes and additions
      if (recipeChanges.length > 0) {
        log.transitionRecipeChanges(recipeChanges, currentState.currentProgramId, null);
      }
      
      if (addedGates.length > 0) {
        log.recipesAdded(addedGates, recipes, currentState.currentProgramId);
      }
      
      if (affectedGates.length > 0) {
        machineState.startGateTransition(affectedGates, originalRecipes);
      }
      
      // Check for orders that are being removed and mark them as halted
      const currentOrderIds = new Set(currentState.activeRecipes.filter(r => r.orderId).map(r => r.orderId));
      const newOrderIds = new Set(recipes.filter(r => r.orderId).map(r => r.orderId));
      const removedOrders = currentState.activeRecipes.filter(r => r.orderId && !newOrderIds.has(r.orderId));
      if (removedOrders.length > 0) {
        updateOrdersToHalted(removedOrders);
      }
    } else {
      // Not transitioning - just log recipe configuration normally
      log.recipesConfigured(recipes, currentState.currentProgramId);
      
      // Sync order statuses/gates with what's in active recipes
      const currentOrderIds = new Set((currentState.activeRecipes || []).filter(r => r.orderId).map(r => r.orderId));
      const newOrderIds = new Set(recipes.filter(r => r.orderId).map(r => r.orderId));
      
      // Orders being removed from active -> halted
      const removedOrders = (currentState.activeRecipes || []).filter(r => r.orderId && !newOrderIds.has(r.orderId));
      if (removedOrders.length > 0) {
        updateOrdersToHalted(removedOrders);
      }
      
      // All orders now in active recipes -> in-production with current gates
      for (const recipe of recipes) {
        if (!recipe.orderId) continue;
        try {
          const order = orderRepo.getOrderById(recipe.orderId);
          if (order && order.status !== orderRepo.ORDER_STATUS.IN_PRODUCTION) {
            orderRepo.updateOrderStatus(recipe.orderId, orderRepo.ORDER_STATUS.IN_PRODUCTION);
          }
          if (order) {
            orderRepo.updateOrderGates(recipe.orderId, recipe.gates || []);
          }
        } catch (e) {
          log.error('system', 'update_order_in_production_error', e, { orderId: recipe.orderId });
        }
      }
    }
    
    machineState.setActiveRecipes(recipes);
    
    // After updating active recipes, check if any recipe should start batch limit transitioning.
    // This handles the case where a recipe is activated from queue while paused and already
    // at or past the batch limit threshold (e.g., 9/10 completed with 2 gates).
    const updatedRecipes = machineState.getActiveRecipes();
    for (const r of updatedRecipes) {
      if (!r.batchLimitTransitioning && machineState.shouldStartBatchLimitTransition(r)) {
        log.queue('recipes_update_triggered_transition', `Recipe ${r.recipeName} at batch limit threshold after recipes update - starting transition`, {
          recipeName: r.recipeName,
          completedBatches: r.completedBatches,
          requestedBatches: r.requestedBatches,
          gates: r.gates,
        });
        machineState.startBatchLimitTransition(r);
      }
    }
    
    return res.json({
      success: true,
      recipes: machineState.getActiveRecipes(),
      transitioningGates: machineState.getTransitioningGates(),
    });
    
  } catch (error) {
    log.error('system', 'update_recipes_error', error);
    res.status(500).json({ error: 'Failed to update active recipes' });
  }
});

/**
 * GET /api/machine/stream
 * Server-Sent Events stream for real-time machine state updates
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const initialState = machineState.getState();
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  
  const stateListener = (state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  
  // Listen for order batch updates
  const orderBatchListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'order_batch_update', ...data })}\n\n`);
  };
  
  // Listen for order completion
  const orderCompletedListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'order_completed', ...data })}\n\n`);
  };

  // Listen for recipe batch updates (per-recipe batch counts)
  const recipeBatchListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'recipe_batch_update', ...data })}\n\n`);
  };

  // Listen for recipe completion
  const recipeCompletedListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'recipe_completed', ...data })}\n\n`);
  };

  // Listen for batch limit transition start
  const batchLimitTransitionListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'batch_limit_transition_started', ...data })}\n\n`);
  };

  // Listen for gate handoffs (gate freed → assigned to next queue item)
  const gateHandoffListener = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'gate_handoff', ...data })}\n\n`);
  };
  
  eventBus.bus.on('machine:state-changed', stateListener);
  eventBus.bus.on('order_batch_update', orderBatchListener);
  eventBus.bus.on('order_completed', orderCompletedListener);
  eventBus.bus.on('recipe_batch_update', recipeBatchListener);
  eventBus.bus.on('recipe_completed', recipeCompletedListener);
  eventBus.bus.on('batch_limit_transition_started', batchLimitTransitionListener);
  eventBus.bus.on('gate_handoff', gateHandoffListener);
  
  const clientId = Math.random().toString(36).substring(7);
  log.sseClientConnected(clientId);
  
  req.on('close', () => {
    eventBus.bus.off('machine:state-changed', stateListener);
    eventBus.bus.off('order_batch_update', orderBatchListener);
    eventBus.bus.off('order_completed', orderCompletedListener);
    eventBus.bus.off('recipe_batch_update', recipeBatchListener);
    eventBus.bus.off('recipe_completed', recipeCompletedListener);
    eventBus.bus.off('batch_limit_transition_started', batchLimitTransitionListener);
    eventBus.bus.off('gate_handoff', gateHandoffListener);
    log.sseClientDisconnected(clientId);
  });
});

/**
 * POST /api/machine/skip-transition
 * Force-complete a batch on a transitioning gate
 */
router.post('/skip-transition', async (req, res) => {
  try {
    const { gate } = req.body;
    const user = req.user?.username || 'system';
    
    if (!gate || gate < 1 || gate > 8) {
      return res.status(400).json({ error: 'Invalid gate number' });
    }
    
    const transitioningGates = machineState.getTransitioningGates();
    if (!transitioningGates.includes(gate)) {
      return res.status(400).json({ error: `Gate ${gate} is not transitioning` });
    }
    
    const gatesModule = require('../state/gates');
    const snapshot = gatesModule.getSnapshot();
    const gateState = snapshot.find(g => g.gate === gate);
    const pieces = gateState?.pieces || 0;
    const grams = gateState?.grams || 0;
    
    log.gateSkipped(gate, pieces, grams);
    
    const state = machineState.getState();
    const originalRecipeInfo = state.transitionStartRecipes?.[gate];
    const recipeIdForStats = originalRecipeInfo?.recipeId || null;
    const recipeName = originalRecipeInfo?.recipeName || 'unknown';
    
    const oldProgramId = machineState.getTransitionOldProgramId();
    const tsIso = new Date().toISOString();
    let programIdForBatch;
    
    try {
      if (oldProgramId) {
        programIdForBatch = oldProgramId;
      } else {
        const programRow = db.prepare(`
          SELECT p.id FROM programs p
          JOIN program_stats ps ON p.id = ps.program_id
          WHERE ps.end_ts IS NULL
          ORDER BY ps.start_ts DESC
          LIMIT 1
        `).get();
        programIdForBatch = programRow?.id || null;
      }
      
      if (programIdForBatch && pieces > 0) {
        db.prepare(`
          INSERT INTO batch_completions (gate, completed_at, pieces, weight_g, recipe_id, program_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(gate, tsIso, pieces, grams, recipeIdForStats, programIdForBatch);
      }
    } catch (err) {
      log.error('system', 'skip_batch_write_error', err, { gate });
    }
    
    // Reset gate counters (pieces/grams)
    gatesModule.resetGate(gate);
    
    eventBus.bus.emit('broadcast', { type: 'gate', data: { gate, pieces: 0, grams: 0, ts: tsIso } });
    
    const influx = require('../services/influx');
    influx.writeGateState({
      gate,
      pieces_in_gate: 0,
      weight_sum_g: 0,
      ts: tsIso,
    }).catch(err => log.error('system', 'm2_reset_write_error', err));
    
    // Check if this gate belongs to a batch-limit-transitioning recipe
    // If so, use handleBatchLimitGateComplete which handles gate handoff to incoming recipe
    const activeRecipes = machineState.getActiveRecipes();
    const batchLimitRecipe = activeRecipes.find(r => 
      (r.batchLimitTransitioning || r.isFinishing) && (r.gates || []).includes(gate)
    );
    
    if (batchLimitRecipe) {
      // BATCH LIMIT TRANSITION: use the full handoff logic
      // handleBatchLimitGateComplete internally calls completeGateTransition(gate)
      log.operations('skip_batch_limit_gate', `Skip: Gate ${gate} batch limit handoff for ${batchLimitRecipe.recipeName}`, {
        gate,
        recipeName: batchLimitRecipe.recipeName,
        remainingGates: (batchLimitRecipe.gates || []).filter(g => g !== gate),
      });
      
      const handoffResult = machineState.handleBatchLimitGateComplete(gate, batchLimitRecipe);
      
      if (handoffResult) {
        eventBus.broadcast("gate_handoff", {
          gate,
          fromRecipe: batchLimitRecipe.recipeName,
          fromRecipeKey: batchLimitRecipe.orderId 
            ? `order_${batchLimitRecipe.orderId}` 
            : `recipe_${(batchLimitRecipe.gates || []).sort().join('_')}`,
          toRecipe: handoffResult.recipe?.recipeName || null,
          handoffType: handoffResult.type,
          assigned: handoffResult.assigned,
          needed: handoffResult.needed,
          ts: tsIso,
        });
      }
      
      // Check if the finishing recipe is now fully done (no gates left)
      const currentRecipes = machineState.getActiveRecipes();
      const stillExists = currentRecipes.some(r => {
        if (batchLimitRecipe.orderId) {
          return r.orderId === batchLimitRecipe.orderId && r.batchLimitTransitioning;
        }
        return r.recipeName === batchLimitRecipe.recipeName && r.batchLimitTransitioning && (r.gates || []).length > 0;
      });
      
      if (!stillExists) {
        // Recipe fully completed - all gates freed
        log.operations('recipe_completed', `Recipe ${batchLimitRecipe.recipeName} completed (skipped) - all gates freed`, {
          recipeName: batchLimitRecipe.recipeName,
          completedBatches: batchLimitRecipe.requestedBatches,
          requestedBatches: batchLimitRecipe.requestedBatches,
          orderId: batchLimitRecipe.orderId || null,
        });
        
        // Remove from order queue
        const currentQueue = machineState.getOrderQueue();
        const updatedQueue = currentQueue.filter(qItem => {
          if (batchLimitRecipe.orderId) {
            return qItem.orderId !== batchLimitRecipe.orderId;
          }
          return qItem.recipeName !== batchLimitRecipe.recipeName;
        });
        
        if (updatedQueue.length < currentQueue.length) {
          machineState.setOrderQueue(updatedQueue);
          log.queue('queue_item_removed_on_skip_completion', `Removed skipped recipe from queue: ${batchLimitRecipe.recipeName}`, {
            recipeName: batchLimitRecipe.recipeName,
          });
        }
        
        // Update order status if it's an order
        if (batchLimitRecipe.orderId) {
          try {
            db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', batchLimitRecipe.orderId);
          } catch (orderErr) {
            log.error('system', 'order_status_update_error', orderErr, { orderId: batchLimitRecipe.orderId });
          }
        }
        
        // Broadcast recipe completion
        eventBus.broadcast("recipe_completed", {
          recipeKey: batchLimitRecipe.orderId 
            ? `order_${batchLimitRecipe.orderId}` 
            : `recipe_${batchLimitRecipe.recipeName}`,
          recipeName: batchLimitRecipe.recipeName,
          completedBatches: batchLimitRecipe.requestedBatches,
          requestedBatches: batchLimitRecipe.requestedBatches,
          orderId: batchLimitRecipe.orderId || null,
          gate,
          gates: [],
          ts: tsIso,
        });
      }
    } else {
      // REGULAR TRANSITION: just complete the gate transition
      machineState.completeGateTransition(gate);
    }
    
    const recipeManager = require('../lib/recipeManager');
    recipeManager.loadGateAssignments();
    
    if (!machineState.hasTransitioningGates()) {
      const finalizeResult = handleAllTransitionsComplete();
      eventBus.bus.emit('broadcast', { type: 'transition_complete', data: { ts: tsIso } });
    }
    
    const fullSnapshot = gatesModule.getSnapshot();
    eventBus.bus.emit('broadcast', { type: 'overlay', data: { ts: tsIso, overlay: fullSnapshot } });
    
    res.json({ 
      success: true, 
      message: `Gate ${gate} transition skipped`,
      pieces,
      grams: parseFloat(grams.toFixed(1))
    });
    
  } catch (error) {
    log.error('system', 'skip_transition_error', error);
    res.status(500).json({ error: 'Failed to skip transition' });
  }
});

/**
 * GET /api/machine/queue
 * Get current order queue
 */
router.get('/queue', (req, res) => {
  try {
    const queue = machineState.getOrderQueue();
    log.queueLoaded(queue.length, queue);
    res.json({ queue });
  } catch (error) {
    log.error('system', 'get_order_queue_error', error);
    res.status(500).json({ error: 'Failed to get order queue' });
  }
});

/**
 * POST /api/machine/pause-recipe
 * Pause or resume a specific recipe/order
 * Body: { recipeName, orderId, paused: boolean }
 */
router.post('/pause-recipe', verifyToken, (req, res) => {
  try {
    const { recipeName, orderId, paused } = req.body;
    const updated = machineState.toggleRecipePause(recipeName, orderId || null, paused);
    res.json({ success: true, paused, activeRecipes: updated });
  } catch (error) {
    log.error('system', 'pause_recipe_error', error);
    res.status(500).json({ error: 'Failed to pause recipe' });
  }
});

/**
 * POST /api/machine/pause-gate
 * Pause or resume a specific gate
 * Body: { gate: number, paused: boolean }
 */
router.post('/pause-gate', verifyToken, (req, res) => {
  try {
    const { gate, paused } = req.body;
    const pausedGates = machineState.toggleGatePause(gate, paused);
    res.json({ success: true, gate, paused, pausedGates });
  } catch (error) {
    log.error('system', 'pause_gate_error', error);
    res.status(500).json({ error: 'Failed to pause gate' });
  }
});

/**
 * POST /api/machine/queue
 * Update order queue
 * Body: { queue: [...], source: string }
 */
router.post('/queue', verifyToken, (req, res) => {
  try {
    const { queue, source = 'unknown' } = req.body;
    const user = req.user?.username || 'system';
    
    if (!Array.isArray(queue)) {
      return res.status(400).json({ error: 'Queue must be an array' });
    }
    
    // Get current queue to check for emptying
    const currentQueue = machineState.getOrderQueue();
    const previousLength = currentQueue.length;
    
    // Log if queue is being emptied (critical for debugging)
    if (queue.length === 0 && previousLength > 0) {
      log.queueEmptied(previousLength, source, new Error().stack);
    }
    
    machineState.setOrderQueue(queue);
    log.queueSaved(queue.length, queue, source);

    // Sync order statuses: queued orders → 'assigned', halted orders → 'halted'
    for (const item of queue) {
      if (!item.orderId) continue;
      try {
        const order = orderRepo.getOrderById(item.orderId);
        if (!order) continue;
        const isHalted = item.status === 'halted';
        const targetStatus = isHalted ? orderRepo.ORDER_STATUS.HALTED : orderRepo.ORDER_STATUS.ASSIGNED;
        if (order.status !== targetStatus && order.status !== orderRepo.ORDER_STATUS.IN_PRODUCTION) {
          orderRepo.updateOrderStatus(item.orderId, targetStatus);
        }
      } catch (e) {
        log.error('system', 'queue_sync_order_status_error', e, { orderId: item.orderId });
      }
    }
    
    // Also log to audit for tracking user actions
    log.audit('queue_updated', `Order queue updated: ${previousLength} → ${queue.length} items`, {
      previousLength,
      newLength: queue.length,
      source,
    }, user);
    
    res.json({ success: true, queue: machineState.getOrderQueue() });
  } catch (error) {
    log.error('system', 'update_order_queue_error', error);
    res.status(500).json({ error: 'Failed to update order queue' });
  }
});

/**
 * POST /api/machine/recover-orders
 * Recover orphaned orders (status assigned/in-production but not in active/queue)
 * This is called automatically on page load and can be triggered manually
 */
router.post('/recover-orders', (req, res) => {
  try {
    const recoveredCount = machineState.recoverOrphanedOrders();
    res.json({ success: true, recoveredCount });
  } catch (error) {
    log.error('system', 'recover_orders_error', error);
    res.status(500).json({ error: 'Failed to recover orders' });
  }
});

/**
 * Handle automatic program transition when a recipe is swapped via batch limit.
 * Ends the current program (saves stats, sets end_ts) and creates a new one
 * so that each distinct recipe configuration is captured in its own program.
 */
function handleBatchLimitProgramTransition(completedRecipeName) {
  try {
    const currentState = machineState.getState();
    const oldProgramId = currentState.currentProgramId;

    if (!oldProgramId) {
      log.warn('system', 'batch_limit_program_transition_no_program', 'No current program to transition');
      return null;
    }

    const transitionTime = new Date().toISOString();

    // 1. Calculate and save stats for the ending program
    calculateAndWriteProgramStats(oldProgramId);

    // 2. Mark the completed recipe and set others as not completed in the old program
    // The completed recipe is the one that triggered this transition
    db.prepare(`UPDATE recipe_stats SET completed = 0 WHERE program_id = ?`).run(oldProgramId);
    const completedRecipe = db.prepare(`
      SELECT r.id FROM recipes r WHERE r.name = ?
    `).get(completedRecipeName);
    if (completedRecipe) {
      db.prepare(`UPDATE recipe_stats SET completed = 1 WHERE program_id = ? AND recipe_id = ?`)
        .run(oldProgramId, completedRecipe.id);
    }

    // 3. End the old program
    db.prepare(`UPDATE program_stats SET end_ts = ? WHERE program_id = ?`).run(transitionTime, oldProgramId);

    // 4. Create a new program
    const programName = `program_${transitionTime.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')}`;
    const result = db.prepare('INSERT INTO programs (name) VALUES (?)').run(programName);
    const newProgramId = result.lastInsertRowid;

    log.programCreated(newProgramId, programName);

    // 4. Create program_stats row
    db.prepare(`
      INSERT INTO program_stats (program_id, start_ts, end_ts)
      VALUES (?, ?, NULL)
    `).run(newProgramId, transitionTime);

    // 6. Create recipe_stats rows for current active recipes (completed=0, still running)
    const activeRecipes = machineState.getActiveRecipes();
    for (const recipe of activeRecipes) {
      if (recipe.batchLimitTransitioning || recipe.isFinishing) continue;
      const gatesAssigned = (recipe.gates || []).join(',');
      const orderId = recipe.orderId || null;
      try {
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, order_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected, completed
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
        `).run(newProgramId, recipe.recipeId, orderId, gatesAssigned);
      } catch (e) {
        log.error('system', 'batch_limit_create_recipe_stats_error', e, { newProgramId, recipeId: recipe.recipeId });
      }
    }

    // 7. Update machine state with new program ID and snapshot
    machineState.updateState({ currentProgramId: newProgramId });
    machineState.snapshotRecipes();

    log.operations('batch_limit_program_transition', `Program transitioned: ${oldProgramId} → ${newProgramId} (recipe ${completedRecipeName} completed)`, {
      oldProgramId,
      newProgramId,
      completedRecipe: completedRecipeName,
      activeRecipes: activeRecipes.filter(r => !r.batchLimitTransitioning).map(r => r.recipeName),
    });

    eventBus.broadcast('program_change', {
      action: 'batch_limit_transition',
      oldProgramId,
      programId: newProgramId,
      completedRecipe: completedRecipeName,
      ts: transitionTime,
    });

    return { oldProgramId, newProgramId, programName };
  } catch (error) {
    log.error('system', 'batch_limit_program_transition_error', error);
    return null;
  }
}

// Export router and helper functions
module.exports = router;
module.exports.handleAllTransitionsComplete = handleAllTransitionsComplete;
module.exports.handleBatchLimitProgramTransition = handleBatchLimitProgramTransition;
