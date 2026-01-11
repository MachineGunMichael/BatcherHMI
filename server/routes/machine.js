// server/routes/machine.js
// Machine control endpoints (start/pause/stop) and active recipes management

const express = require('express');
const router = express.Router();
const machineState = require('../services/machineState');
const eventBus = require('../lib/eventBus');
const db = require('../db/sqlite');
const log = require('../lib/logger');
const { verifyToken } = require('../utils/authMiddleware');

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
      try {
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected
          ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
        `).run(programId, recipe.recipeId, gatesAssigned);
      } catch (e) {
        log.error('system', 'create_recipe_stats_error', e, { programId, recipeId: recipe.recipeId });
      }
    }
    
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
          db.prepare(`
            INSERT INTO recipe_stats (
              program_id, recipe_id, gates_assigned,
              total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
              total_items_batched, total_items_rejected
            ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
          `).run(currentProgramId, recipe.recipeId, gatesAssigned);
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
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected
          ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
        `).run(newProgramId, recipe.recipeId, gatesAssigned);
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
    
    const batchStats = db.prepare(`
      SELECT 
        recipe_id,
        COUNT(*) as total_batches,
        SUM(pieces) as total_items_batched,
        SUM(weight_g) as total_batched_weight_g
      FROM batch_completions
      WHERE program_id = ?
      GROUP BY recipe_id
    `).all(programId);
    
    for (const stats of batchStats) {
      const recipe = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(stats.recipe_id);
      
      let giveawayWeightG = 0;
      if (recipe && recipe.batch_min_weight_g) {
        const targetWeight = recipe.batch_min_weight_g * stats.total_batches;
        giveawayWeightG = Math.max(0, stats.total_batched_weight_g - targetWeight);
      }
      
      db.prepare(`
        UPDATE recipe_stats 
        SET 
          total_batches = ?,
          total_items_batched = ?,
          total_batched_weight_g = ?,
          total_giveaway_weight_g = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE program_id = ? AND recipe_id = ?
      `).run(
        stats.total_batches,
        stats.total_items_batched,
        stats.total_batched_weight_g,
        giveawayWeightG,
        programId,
        stats.recipe_id
      );
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
  
  const gates = require('../state/gates');
  gates.resetAll();
  machineState.reset();
  
  // Give Python worker time to detect state change and flush KPIs
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Finalize program if one was running
  if (currentState.currentProgramId) {
    const endTime = new Date().toISOString();
    const programId = currentState.currentProgramId;
    
    try {
      calculateAndWriteProgramStats(programId);
      
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
    const { recipes } = req.body;
    const currentState = machineState.getState();
    const user = req.user?.username || 'system';
    
    if (currentState.state === 'running') {
      return res.status(400).json({ 
        error: 'Cannot update recipes while machine is running. Please pause first.' 
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
    
    if (isTransitioning) {
      const affectedGates = [];
      const originalRecipes = {};
      const recipeChanges = []; // For logging
      
      const oldGateToRecipe = {};
      for (const recipe of currentState.programStartRecipes) {
        for (const gate of recipe.gates || []) {
          oldGateToRecipe[gate] = {
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            displayName: recipe.displayName || recipe.display_name || null,
            params: recipe.params,
          };
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
    } else {
      // Not transitioning - just log recipe configuration normally
      log.recipesConfigured(recipes, currentState.currentProgramId);
    }
    
    machineState.setActiveRecipes(recipes);
    
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
  
  const listener = (state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  
  eventBus.bus.on('machine:state-changed', listener);
  
  const clientId = Math.random().toString(36).substring(7);
  log.sseClientConnected(clientId);
  
  req.on('close', () => {
    eventBus.bus.off('machine:state-changed', listener);
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
    
    const gates = require('../state/gates');
    const snapshot = gates.getSnapshot();
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
    
    gates.resetGate(gate);
    
    eventBus.bus.emit('broadcast', { type: 'gate', data: { gate, pieces: 0, grams: 0, ts: tsIso } });
    
    const influx = require('../services/influx');
    influx.writeGateState({
      gate,
      pieces_in_gate: 0,
      weight_sum_g: 0,
      ts: tsIso,
    }).catch(err => log.error('system', 'm2_reset_write_error', err));
    
    machineState.completeGateTransition(gate);
    
    const recipeManager = require('../lib/recipeManager');
    recipeManager.loadGateAssignments();
    
    if (!machineState.hasTransitioningGates()) {
      const finalizeResult = handleAllTransitionsComplete();
      eventBus.bus.emit('broadcast', { type: 'transition_complete', data: { ts: tsIso } });
    }
    
    const fullSnapshot = gates.getSnapshot();
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

// Export router and helper functions
module.exports = router;
module.exports.handleAllTransitionsComplete = handleAllTransitionsComplete;
