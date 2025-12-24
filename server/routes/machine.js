// server/routes/machine.js
// Machine control endpoints (start/pause/stop) and active recipes management

const express = require('express');
const router = express.Router();
const machineState = require('../services/machineState');
const eventBus = require('../lib/eventBus');
const db = require('../db/sqlite');

/**
 * GET /api/machine/state
 * Get current machine state
 */
router.get('/state', (req, res) => {
  try {
    const state = machineState.getState();
    res.json(state);
  } catch (error) {
    console.error('[Machine API] Error getting state:', error);
    res.status(500).json({ error: 'Failed to get machine state' });
  }
});

/**
 * POST /api/machine/control
 * Control machine (start/pause/stop)
 * Body: { action: 'start' | 'pause' | 'stop' }
 */
router.post('/control', async (req, res) => {
  try {
    const { action } = req.body;
    const currentState = machineState.getState();
    
    console.log(`[Machine API] Control action: ${action}, current state: ${currentState.state}`);
    
    switch (action) {
      case 'start':
        return handleStart(currentState, res);
      
      case 'pause':
        return handlePause(currentState, res);
      
      case 'stop':
        return await handleStop(currentState, res);
      
      default:
        return res.status(400).json({ error: `Invalid action: ${action}` });
    }
  } catch (error) {
    console.error('[Machine API] Error in control:', error);
    res.status(500).json({ error: 'Failed to control machine' });
  }
});

/**
 * Handle START action
 */
function handleStart(currentState, res) {
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
    
    console.log(`[Machine API] Created new program: ${programName} (ID: ${programId})`);
    
    // Create program_stats row with start time
    try {
      db.prepare(`
        INSERT INTO program_stats (program_id, start_ts, end_ts)
        VALUES (?, ?, NULL)
      `).run(programId, startTime);
      console.log(`[Machine API] Created program_stats for program ${programId}`);
    } catch (e) {
      console.error('[Machine API] Failed to create program_stats:', e);
    }
    
    // Create recipe_stats rows for each active recipe (initialized to 0, will be updated on STOP)
    try {
      const activeRecipes = currentState.activeRecipes;
      for (const recipe of activeRecipes) {
        const gatesAssigned = (recipe.gates || []).join(',');
        db.prepare(`
          INSERT INTO recipe_stats (
            program_id, recipe_id, gates_assigned,
            total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
            total_items_batched, total_items_rejected
          ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
        `).run(programId, recipe.recipeId, gatesAssigned);
        console.log(`[Machine API] Created recipe_stats for recipe ${recipe.recipeId} (${recipe.recipeName}) on gates [${gatesAssigned}]`);
      }
    } catch (e) {
      console.error('[Machine API] Failed to create recipe_stats:', e);
    }
    
    // Update state to running and snapshot recipes
    machineState.updateState({
      state: 'running',
      currentProgramId: programId,
    });
    machineState.snapshotRecipes();
    
    // Broadcast program change event so dashboard can reset rejects display
    const programChangeEvent = { 
      action: 'start', 
      programId, 
      ts: new Date().toISOString() 
    };
    console.log('[Machine API] Broadcasting program_change event:', programChangeEvent);
    eventBus.broadcast('program_change', programChangeEvent);
    
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
    
    // Check if there are already gates transitioning (user edited while paused)
    const alreadyTransitioning = machineState.hasTransitioningGates();
    
    // Check if we're already in a transition period (merged transitions)
    const existingTransitionOldProgramId = machineState.getTransitionOldProgramId();
    const isInTransitionPeriod = machineState.isInTransitionPeriod();
    
    if (changed || alreadyTransitioning) {
      
      // MERGED TRANSITIONS: If we're already in a transition period, DON'T create a new program
      if (isInTransitionPeriod && existingTransitionOldProgramId) {
        console.log('[Machine API] 🔄 MERGED TRANSITION: Already in transition period, NOT creating new program');
        console.log(`[Machine API] Old program ${existingTransitionOldProgramId} still being finalized`);
        console.log(`[Machine API] Current program: ${currentState.currentProgramId}`);
        
        const currentProgramId = currentState.currentProgramId;
        
        // UPDATE recipe_stats for current program to reflect the new recipe configuration
        // Delete old recipe_stats and create new ones with current activeRecipes
        console.log(`[Machine API] Updating recipe_stats for program ${currentProgramId} with new recipes`);
        
        // Delete existing recipe_stats for current program
        db.prepare(`DELETE FROM recipe_stats WHERE program_id = ?`).run(currentProgramId);
        
        // Create new recipe_stats with current activeRecipes
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
          console.log(`[Machine API] Updated recipe_stats for recipe ${recipe.recipeId} (${recipe.recipeName}) on gates [${gatesAssigned}]`);
        }
        
        // Get current transitioning gates
        const transitioningGates = machineState.getTransitioningGates();
        console.log(`[Machine API] Transitioning gates: ${transitioningGates.join(', ') || 'none'}`);
        console.log(`[Machine API] Completed transition gates: ${machineState.getCompletedTransitionGates().join(', ') || 'none'}`);
        
        // Register any NEW transitioning gates that weren't registered before
        const currentRegisteredGates = currentState.registeredTransitioningGates || [];
        const newRegisteredGates = [...new Set([...currentRegisteredGates, ...transitioningGates])];
        console.log(`[Machine API] Registered transitioning gates (before: ${currentRegisteredGates.join(', ') || 'none'}, after: ${newRegisteredGates.join(', ') || 'none'})`);
        
        // Just resume running with the existing program
        machineState.updateState({ 
          state: 'running',
          registeredTransitioningGates: newRegisteredGates,
        });
        
        // Broadcast recipe_change event so Python worker reloads its recipe mappings
        const recipeChangeEvent = { 
          action: 'recipes_updated', 
          programId: currentProgramId,
          activeRecipes: activeRecipes.map(r => ({ recipeId: r.recipeId, recipeName: r.recipeName, gates: r.gates })),
          ts: new Date().toISOString() 
        };
        console.log('[Machine API] Broadcasting recipes_updated event for merged transition');
        eventBus.broadcast('program_change', recipeChangeEvent);
        
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
      
      // FIRST TRANSITION: Create NEW program and use per-gate transition
      console.log('[Machine API] Recipes changed, creating new program with per-gate transition');
      
      const oldProgramId = currentState.currentProgramId;
      
      // Store old program ID so we can finalize it when all transitions complete
      machineState.setTransitionOldProgramId(oldProgramId);
      
      // Set end_ts on old program NOW (when transition starts)
      // This is the official end time - we'll only be collecting finishing batches after this
      const transitionTime = new Date().toISOString();
      db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(transitionTime, oldProgramId);
      console.log(`[Machine API] Old program ${oldProgramId} end_ts set to ${transitionTime} (transition start)`);
      
      // 1. Create NEW program (starts at the same moment old program ends)
      const startTime = transitionTime;
      const programName = `program_${startTime.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')}`;
      const insertProgram = db.prepare('INSERT INTO programs (name) VALUES (?)');
      const result = insertProgram.run(programName);
      const newProgramId = result.lastInsertRowid;
      
      console.log(`[Machine API] Created new program: ${programName} (ID: ${newProgramId})`);
      
      // 3. Create program_stats row for new program
      db.prepare(`
        INSERT INTO program_stats (program_id, start_ts, end_ts)
        VALUES (?, ?, NULL)
      `).run(newProgramId, startTime);
      console.log(`[Machine API] Created program_stats for program ${newProgramId}`);
      
      // 4. Create recipe_stats rows for each active recipe in NEW program
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
        console.log(`[Machine API] Created recipe_stats for recipe ${recipe.recipeId} (${recipe.recipeName}) on gates [${gatesAssigned}]`);
      }
      
      // 5. Get gates that are transitioning
      const transitioningGates = machineState.getTransitioningGates();
      
      if (transitioningGates.length > 0) {
        console.log(`[Machine API] Gates in transition: ${transitioningGates.join(', ')}`);
      } else {
        // NO transitioning gates - old program can be finalized immediately
        // This happens when adding recipes to EMPTY gates (no batch to complete)
        console.log(`[Machine API] No transitioning gates - finalizing old program ${oldProgramId} immediately`);
        calculateAndWriteProgramStats(oldProgramId);
        machineState.clearTransitionOldProgramId();
        console.log(`[Machine API] ✅ Old program ${oldProgramId} finalized (no pending batches)`);
      }
      
      // 6. Update state to running with new program
      // Also register all currently transitioning gates as "registered" (can be skipped)
      machineState.updateState({ 
        state: 'running',
        currentProgramId: newProgramId,
        registeredTransitioningGates: transitioningGates.slice(), // Copy current transitioning gates as registered
      });
      
      // 7. Snapshot recipes if no transitions, otherwise keep old programStartRecipes frozen
      if (transitioningGates.length === 0) {
        machineState.snapshotRecipes();
      }
      
      // 8. Broadcast program change event
      const programChangeEvent = { 
        action: 'recipe_change', 
        programId: newProgramId, 
        ts: new Date().toISOString() 
      };
      console.log('[Machine API] Broadcasting program_change event:', programChangeEvent);
      eventBus.broadcast('program_change', programChangeEvent);
      
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
      console.log('[Machine API] Resuming program');
      
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
function handlePause(currentState, res) {
  if (currentState.state !== 'running') {
    return res.status(400).json({ 
      error: `Cannot pause from state: ${currentState.state}` 
    });
  }
  
  console.log('[Machine API] Pausing machine');
  machineState.updateState({ state: 'paused' });
  
  return res.json({
    success: true,
    action: 'pause',
    state: machineState.getState(),
  });
}

/**
 * Calculate and update recipe/program stats from batch_completions
 * Similar to Python worker's calculate_and_write_program_totals
 */
function calculateAndWriteProgramStats(programId) {
  const startTime = Date.now();
  console.log(`[Machine API] 📊 Calculating stats for program ${programId}...`);
  
  try {
    // Get program time range for reject query
    const programInfo = db.prepare(`
      SELECT start_ts, end_ts FROM program_stats WHERE program_id = ?
    `).get(programId);
    
    // Get all batch completions for this program, grouped by recipe
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
    
    console.log(`[Machine API] Found ${batchStats.length} recipes with batch completions`);
    
    // Update recipe_stats for each recipe
    for (const stats of batchStats) {
      // Calculate giveaway: actual_weight - (target_weight_per_batch * batches)
      // For now, we'll just use the batch data we have
      // Giveaway calculation requires knowing target weights which are in the recipe
      
      const recipe = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(stats.recipe_id);
      
      let giveawayWeightG = 0;
      if (recipe && recipe.batch_min_weight_g) {
        // Giveaway = actual weight - (min_batch_weight * batches)
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
      
      console.log(`[Machine API] Updated recipe_stats for recipe ${stats.recipe_id}: ${stats.total_batches} batches, ${stats.total_items_batched} items, ${stats.total_batched_weight_g}g`);
    }
    
    // Get reject totals from kpi_minute_combined (written by Python worker)
    // Rejects are cumulative, so we take the MAX values for this program's time range
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
        console.log(`[Machine API] Found rejects from kpi_minute_combined: ${rejectCount} pieces, ${rejectWeightG}g`);
      }
    }
    
    // Update program_stats totals (including rejects)
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
      
      console.log(`[Machine API] Updated program_stats totals: ${programTotals.total_batches || 0} batches, ${programTotals.total_items_batched || 0} items, ${rejectCount} rejected`);
    }
    
    console.log(`[Machine API] ⏱️ Stats calculation took ${Date.now() - startTime}ms`);
    return true;
  } catch (e) {
    console.error('[Machine API] Failed to calculate stats:', e);
    return false;
  }
}

/**
 * Handle completion of all gate transitions
 * Called from ingest.js when all transitioning gates have completed their batches
 * Creates a new program for the new recipe configuration
 * @returns {Object} { success, newProgramId, programName }
 */
function handleAllTransitionsComplete() {
  const transitionStart = Date.now();
  console.log(`[Machine API] 🎯 All gate transitions complete, finalizing old program stats...`);
  
  try {
    // Get the OLD program ID that we stored when transitions started
    const oldProgramId = machineState.getTransitionOldProgramId();
    
    if (!oldProgramId) {
      console.log('[Machine API] No old program ID stored - transitions may have already completed');
      // Still need to clear transitions and snapshot recipes to clean up UI state
      // Use atomic update to ensure consistent state in one SSE broadcast
      machineState.finalizeTransitions();
      console.log('[Machine API] Finalized transitions (no old program to finalize)');
      return { success: true, message: 'No pending transition' };
    }
    
    // All batches have been captured - calculate and write stats
    // NOTE: end_ts was already set when transition started (that's the official end time)
    console.log(`[Machine API] Calculating final stats for old program ${oldProgramId}...`);
    calculateAndWriteProgramStats(oldProgramId);
    
    console.log(`[Machine API] ✅ Old program ${oldProgramId} stats finalized`);
    
    // Clear the stored old program ID
    machineState.clearTransitionOldProgramId();
    
    // Clear transition state AND snapshot recipes atomically
    // This ensures the frontend gets a consistent state in one SSE broadcast
    machineState.finalizeTransitions();
    
    // Broadcast program_change so dashboard resets rejects display
    const currentState = machineState.getState();
    eventBus.broadcast('program_change', {
      action: 'recipe_change',
      programId: currentState.currentProgramId,
      programStartTime: new Date().toISOString(),
      ts: new Date().toISOString()
    });
    console.log(`[Machine API] Broadcast program_change for new program ${currentState.currentProgramId}`);
    
    console.log(`[Machine API] ⏱️ Transition finalization took ${Date.now() - transitionStart}ms`);
    
    return { 
      success: true, 
      oldProgramId,
      message: 'Old program stats saved successfully'
    };
  } catch (error) {
    console.error('[Machine API] Error finalizing old program after transitions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle STOP action
 * Stops the machine, waits briefly for Python worker to flush KPIs, then calculates stats
 */
async function handleStop(currentState, res) {
  if (currentState.state === 'idle') {
    return res.status(400).json({ 
      error: 'Machine is already stopped' 
    });
  }
  
  console.log('[Machine API] Stopping machine...');
  
  // Set state to idle first so Python worker can detect and flush KPIs
  const gates = require('../state/gates');
  gates.resetAll();
  machineState.reset();
  console.log('[Machine API] Machine state reset to idle, waiting for KPI flush...');
  
  // Give Python worker time to detect state change and flush KPIs (polls every 200ms)
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Finalize program if one was running
  if (currentState.currentProgramId) {
    const endTime = new Date().toISOString();
    const programId = currentState.currentProgramId;
    
    try {
      // Calculate and write program stats from batch_completions
      calculateAndWriteProgramStats(programId);
      
      // Update program_stats end time
      const updateResult = db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(endTime, programId);
      
      if (updateResult.changes > 0) {
        console.log(`[Machine API] ✅ Program ${programId} finalized at ${endTime}`);
      } else {
        console.log(`[Machine API] ⚠️ No program_stats row found for program ${programId}, creating one...`);
        // Create the row if it doesn't exist
        db.prepare(`
          INSERT OR REPLACE INTO program_stats (program_id, start_ts, end_ts)
          VALUES (?, ?, ?)
        `).run(programId, endTime, endTime);
      }
      
      // Log the saved program for verification
      const savedProgram = db.prepare(`
        SELECT p.id, p.name, ps.start_ts, ps.end_ts, ps.total_batches, ps.total_items_batched 
        FROM programs p 
        LEFT JOIN program_stats ps ON ps.program_id = p.id 
        WHERE p.id = ?
      `).get(programId);
      console.log(`[Machine API] 📊 Saved program:`, savedProgram);
      
    } catch (e) {
      console.error('[Machine API] Failed to finalize program:', e);
    }
  }
  
  console.log('[Machine API] ✅ Stop complete');
  
  // Broadcast program change event so dashboard can reset rejects display
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
 * Body: { programId: number, action: 'stop' | 'recipe_change' }
 */
router.post('/transition-complete', async (req, res) => {
  const transitionStart = Date.now();
  try {
    const { programId, action } = req.body;
    const currentState = machineState.getState();
    
    console.log(`[Machine API] Transition complete for program ${programId}, action: ${action}`);
    
    if (action === 'stop') {
      // Calculate and write program stats (including rejects)
      const statsStart = Date.now();
      calculateAndWriteProgramStats(programId);
      console.log(`[Machine API] ⏱️ Stats calculation phase took ${Date.now() - statsStart}ms`);
      
      // Finalize program stats and set to idle
      const endTime = new Date().toISOString();
      db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(endTime, programId);
      
      console.log(`[Machine API] Program ${programId} finalized`);
      
      // Reset to idle (clears recipes and state)
      machineState.reset();
      console.log(`[Machine API] Machine state reset to idle, active recipes cleared`);
      console.log(`[Machine API] ⏱️ Stop transition took ${Date.now() - transitionStart}ms total`);
      
      // Broadcast program change event so dashboard can reset rejects display
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
      // NOTE: This endpoint is now mostly a no-op for recipe_change
      // Stats are saved by handleAllTransitionsComplete() called from ingest.js
      // New program is already created by handleStart
      // Gates should NOT be reset - batches continue until complete
      
      console.log(`[Machine API] recipe_change acknowledged from Python worker`);
      console.log(`[Machine API] Stats already handled by handleAllTransitionsComplete()`);
      
      // Just return success - the real work is done elsewhere
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
    console.error('[Machine API] Error in transition-complete:', error);
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
    console.error('[Machine API] Error getting recipes:', error);
    res.status(500).json({ error: 'Failed to get active recipes' });
  }
});

/**
 * POST /api/machine/recipes
 * Update active recipes
 * Body: { recipes: [...] }
 * 
 * When updated while paused, tracks which gates are affected for per-gate transitions
 */
router.post('/recipes', (req, res) => {
  try {
    const { recipes } = req.body;
    const currentState = machineState.getState();
    
    // Allow updates when paused or idle, but not when running
    if (currentState.state === 'running') {
      return res.status(400).json({ 
        error: 'Cannot update recipes while machine is running. Please pause first.' 
      });
    }
    
    // Validate recipes format
    if (!Array.isArray(recipes)) {
      return res.status(400).json({ error: 'Recipes must be an array' });
    }
    
    // Basic validation of recipe structure
    for (const recipe of recipes) {
      if (!recipe.recipeName || !recipe.gates || !recipe.params) {
        return res.status(400).json({ 
          error: 'Invalid recipe structure. Each recipe must have recipeName, gates, and params' 
        });
      }
      // IMPORTANT: Strip frontend-only flags that should NOT be stored in the database
      delete recipe.isRemovedTransitioning;
    }
    
    // Ensure all recipes exist in database and update recipeId to match recipeName
    // This is critical: when a recipe is edited, the recipeName changes but recipeId may still point to old recipe
    for (const recipe of recipes) {
      const recipeName = recipe.recipeName;
      const params = recipe.params;
      
      // Check if recipe exists by name
      let existing = db.prepare('SELECT id FROM recipes WHERE name = ?').get(recipeName);
      
      if (!existing) {
        // Auto-create recipe
        console.log(`[Machine API] Auto-creating missing recipe: ${recipeName}`);
        
        // Handle count type properly: exact means both min and max are the same
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
        
        // Get the newly created recipe ID
        existing = { id: result.lastInsertRowid };
        console.log(`[Machine API] Created recipe ${recipeName} with ID ${existing.id}`);
      }
      
      // CRITICAL: Update recipeId to match the recipe in database
      // This ensures that when recipe_stats are created, they link to the correct recipe
      if (existing && recipe.recipeId !== existing.id) {
        console.log(`[Machine API] Updating recipeId for ${recipeName}: ${recipe.recipeId} → ${existing.id}`);
        recipe.recipeId = existing.id;
      }
    }
    
    console.log(`[Machine API] Updating active recipes (${recipes.length} recipes)`);
    console.log(`[Machine API] Recipe details:`, recipes.map(r => `${r.recipeName} (ID:${r.recipeId}) on gates [${r.gates.join(',')}]`).join(', '));
    
    // If paused, detect which gates are affected by this recipe change
    // These gates will need to complete their current batch before switching
    if (currentState.state === 'paused' && currentState.currentProgramId) {
      const affectedGates = [];
      const originalRecipes = {};
      
      // Build map of old gate -> recipe from programStartRecipes
      const oldGateToRecipe = {};
      for (const recipe of currentState.programStartRecipes) {
        for (const gate of recipe.gates || []) {
          oldGateToRecipe[gate] = {
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            params: recipe.params,
          };
        }
      }
      
      // Build map of new gate -> recipe
      const newGateToRecipe = {};
      for (const recipe of recipes) {
        for (const gate of recipe.gates || []) {
          newGateToRecipe[gate] = {
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            params: recipe.params,
          };
        }
      }
      
      // Find gates that had a recipe before but have a different one now (or no recipe)
      for (const gate of Object.keys(oldGateToRecipe)) {
        const gateNum = Number(gate);
        const oldRecipe = oldGateToRecipe[gate];
        const newRecipe = newGateToRecipe[gate];
        
        // Only mark as transitioning if:
        // 1. Gate had a recipe at program start
        // 2. Recipe has changed (different recipe or no recipe)
        // 3. Gate is not already transitioning
        const existingTransitioning = machineState.getTransitioningGates();
        const recipeChanged = !newRecipe || newRecipe.recipeName !== oldRecipe.recipeName;
        
        if (recipeChanged && !existingTransitioning.includes(gateNum)) {
          affectedGates.push(gateNum);
          originalRecipes[gateNum] = oldRecipe;
          console.log(`[Machine API] Gate ${gate}: recipe changed from ${oldRecipe.recipeName} to ${newRecipe?.recipeName || 'none'}`);
        }
      }
      
      // Mark affected gates as transitioning
      if (affectedGates.length > 0) {
        machineState.startGateTransition(affectedGates, originalRecipes);
        console.log(`[Machine API] Marked gates [${affectedGates.join(', ')}] for transition`);
      }
    }
    
    machineState.setActiveRecipes(recipes);
    console.log('[Machine API] Active recipes updated successfully in DB');
    
    return res.json({
      success: true,
      recipes: machineState.getActiveRecipes(),
      transitioningGates: machineState.getTransitioningGates(),
    });
    
  } catch (error) {
    console.error('[Machine API] Error updating recipes:', error);
    res.status(500).json({ error: 'Failed to update active recipes' });
  }
});

/**
 * GET /api/machine/stream
 * Server-Sent Events stream for real-time machine state updates
 */
router.get('/stream', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial state
  const initialState = machineState.getState();
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  
  // Listen for state changes
  const listener = (state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  
  eventBus.bus.on('machine:state-changed', listener);
  
  // Cleanup on disconnect
  req.on('close', () => {
    eventBus.bus.off('machine:state-changed', listener);
    console.log('[Machine API] SSE client disconnected');
  });
  
  console.log('[Machine API] SSE client connected');
});

/**
 * POST /api/machine/skip-transition
 * Force-complete a batch on a transitioning gate
 * Body: { gate: number }
 */
router.post('/skip-transition', async (req, res) => {
  try {
    const { gate } = req.body;
    
    if (!gate || gate < 1 || gate > 8) {
      return res.status(400).json({ error: 'Invalid gate number' });
    }
    
    console.log(`[Machine API] Skip transition requested for gate ${gate}`);
    
    // Check if gate is actually transitioning
    const transitioningGates = machineState.getTransitioningGates();
    if (!transitioningGates.includes(gate)) {
      return res.status(400).json({ error: `Gate ${gate} is not transitioning` });
    }
    
    // Get current gate state (pieces and grams)
    const gates = require('../state/gates');
    const snapshot = gates.getSnapshot();
    const gateState = snapshot.find(g => g.gate === gate);
    const pieces = gateState?.pieces || 0;
    const grams = gateState?.grams || 0;
    
    console.log(`[Machine API] Force-completing batch on gate ${gate}: ${pieces} pieces, ${grams.toFixed(1)}g`);
    
    // Get recipe info for stats (from transition start recipes - original recipe)
    const state = machineState.getState();
    const originalRecipeInfo = state.transitionStartRecipes?.[gate];
    const recipeIdForStats = originalRecipeInfo?.recipeId || null;
    const recipeName = originalRecipeInfo?.recipeName || 'unknown';
    
    // Get old program ID for batch attribution
    const oldProgramId = machineState.getTransitionOldProgramId();
    
    // Write batch completion to SQLite (as incomplete batch)
    const tsIso = new Date().toISOString();
    let programIdForBatch;
    
    try {
      if (oldProgramId) {
        programIdForBatch = oldProgramId;
        console.log(`[Machine API] Writing incomplete batch to OLD program ${programIdForBatch} (gate ${gate}, recipe: ${recipeName})`);
      } else {
        // Fallback: get current program
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
        
        console.log(`[Machine API] Incomplete batch written to SQLite (recipe: ${recipeName}, pieces: ${pieces}, grams: ${grams.toFixed(1)})`);
      }
    } catch (err) {
      console.error(`[Machine API] Failed to write incomplete batch to SQLite:`, err);
    }
    
    // Reset the gate
    gates.resetGate(gate);
    console.log(`[Machine API] Gate ${gate} reset to 0 pieces, 0 grams`);
    
    // Broadcast gate reset
    const eventBus = require('../lib/eventBus');
    eventBus.bus.emit('broadcast', { type: 'gate', data: { gate, pieces: 0, grams: 0, ts: tsIso } });
    
    // Write M2 reset to InfluxDB
    const influx = require('../services/influx');
    influx.writeGateState({
      gate,
      pieces_in_gate: 0,
      weight_sum_g: 0,
      ts: tsIso,
    }).catch(err => console.error("M2 reset write failed:", err.message));
    
    // Complete this gate's transition
    machineState.completeGateTransition(gate);
    
    // Reload recipe manager to update this gate to new recipe
    const recipeManager = require('../lib/recipeManager');
    recipeManager.loadGateAssignments();
    
    // Check if ALL transitions are now complete
    if (!machineState.hasTransitioningGates()) {
      console.log(`[Machine API] All gates have finished their batches after skip`);
      
      // Finalize the old program's stats
      const finalizeResult = handleAllTransitionsComplete();
      if (finalizeResult.success) {
        console.log(`[Machine API] Old program ${oldProgramId} finalized after skip`);
      }
      
      eventBus.bus.emit('broadcast', { type: 'transition_complete', data: { ts: tsIso } });
    }
    
    // Broadcast full snapshot
    const fullSnapshot = gates.getSnapshot();
    eventBus.bus.emit('broadcast', { type: 'overlay', data: { ts: tsIso, overlay: fullSnapshot } });
    
    res.json({ 
      success: true, 
      message: `Gate ${gate} transition skipped`,
      pieces,
      grams: parseFloat(grams.toFixed(1))
    });
    
  } catch (error) {
    console.error('[Machine API] Error in skip-transition:', error);
    res.status(500).json({ error: 'Failed to skip transition' });
  }
});

// Export router and helper functions
module.exports = router;
module.exports.handleAllTransitionsComplete = handleAllTransitionsComplete;

