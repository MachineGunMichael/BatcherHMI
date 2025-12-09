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
        return handleStop(currentState, res);
      
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
    
    if (changed) {
      // Recipes changed: transition to new program
      console.log('[Machine API] Recipes changed, initiating program transition');
      
      machineState.updateState({ state: 'transitioning' });
      
      // Worker will detect this and finish current batches, then call /transition-complete
      return res.json({
        success: true,
        action: 'transition_program',
        recipesChanged: true,
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
          total_giveaway_weight_g = ?
        WHERE program_id = ?
      `).run(
        programTotals.total_batches || 0,
        programTotals.total_items_batched || 0,
        programTotals.total_batched_weight_g || 0,
        programTotals.total_giveaway_weight_g || 0,
        programId
      );
      
      console.log(`[Machine API] Updated program_stats totals: ${programTotals.total_batches || 0} batches, ${programTotals.total_items_batched || 0} items`);
    }
    
    console.log(`[Machine API] ⏱️ Stats calculation took ${Date.now() - startTime}ms`);
    return true;
  } catch (e) {
    console.error('[Machine API] Failed to calculate stats:', e);
    return false;
  }
}

/**
 * Handle STOP action
 * Immediately stops the machine and resets to idle (no waiting for batches)
 */
function handleStop(currentState, res) {
  if (currentState.state === 'idle') {
    return res.status(400).json({ 
      error: 'Machine is already stopped' 
    });
  }
  
  console.log('[Machine API] Stopping machine immediately');
  
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
  
  // Reset gates to 0
  const gates = require('../state/gates');
  gates.resetAll();
  console.log('[Machine API] All gates reset to 0');
  
  // Reset to idle (clears active recipes)
  machineState.reset();
  console.log('[Machine API] Machine state reset to idle');
  
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
      
      return res.json({
        success: true,
        action: 'stopped',
        state: machineState.getState(),
      });
      
    } else if (action === 'recipe_change') {
      // Finalize old program and create new one
      const endTime = new Date().toISOString();
      
      // Calculate and write stats for old program (just like stop does)
      const statsStart = Date.now();
      calculateAndWriteProgramStats(programId);
      console.log(`[Machine API] ⏱️ Stats calculation phase took ${Date.now() - statsStart}ms`);
      
      db.prepare(`
        UPDATE program_stats 
        SET end_ts = ? 
        WHERE program_id = ?
      `).run(endTime, programId);
      
      console.log(`[Machine API] Program ${programId} finalized (recipe change)`);
      
      // Reset gate states for the new program
      const gates = require('../state/gates');
      gates.resetAll();
      console.log(`[Machine API] Reset all gate states for new program`);
      
      // Create new program
      const programName = `program_${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')}`;
      const insertProgram = db.prepare('INSERT INTO programs (name) VALUES (?)');
      const result = insertProgram.run(programName);
      const newProgramId = result.lastInsertRowid;
      
      console.log(`[Machine API] Created new program: ${programName} (ID: ${newProgramId})`);
      
      // Create program_stats row for new program
      const startTime = new Date().toISOString();
      db.prepare(`
        INSERT INTO program_stats (
          program_id, 
          start_ts, 
          total_batches, 
          total_items_batched, 
          total_batched_weight_g,
          total_reject_weight_g,
          total_giveaway_weight_g
        ) VALUES (?, ?, 0, 0, 0, 0, 0)
      `).run(newProgramId, startTime);
      
      // Create recipe_stats rows for each active recipe
      const activeRecipes = machineState.getActiveRecipes();
      for (const recipe of activeRecipes) {
        const recipeId = recipe.recipeId;
        const recipeName = recipe.recipeName;
        const gatesAssigned = recipe.gates.join(',');
        
        // Get or create recipe ID if it doesn't exist
        let dbRecipeId = recipeId;
        if (!dbRecipeId) {
          const existing = db.prepare('SELECT id FROM recipes WHERE name = ?').get(recipeName);
          dbRecipeId = existing?.id;
        }
        
        if (dbRecipeId) {
          db.prepare(`
            INSERT INTO recipe_stats (
              program_id, 
              recipe_id, 
              gates_assigned,
              total_batches, 
              total_items_batched, 
              total_batched_weight_g,
              total_items_rejected,
              total_reject_weight_g,
              total_giveaway_weight_g
            ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
          `).run(newProgramId, dbRecipeId, gatesAssigned);
          console.log(`[Machine API] Created recipe_stats for recipe ${recipeName} (ID: ${dbRecipeId})`);
        }
      }
      
      // Update state to running with new program
      machineState.updateState({
        state: 'running',
        currentProgramId: newProgramId,
      });
      machineState.snapshotRecipes();
      
      console.log(`[Machine API] ⏱️ Recipe change transition took ${Date.now() - transitionStart}ms total`);
      
      return res.json({
        success: true,
        action: 'new_program_started',
        programId: newProgramId,
        programName,
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
 */
router.post('/recipes', (req, res) => {
  try {
    const { recipes } = req.body;
    const currentState = machineState.getState();
    
    // Validate: can only update recipes when not running
    if (currentState.state === 'running') {
      return res.status(400).json({ 
        error: 'Cannot update recipes while machine is running' 
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
    machineState.setActiveRecipes(recipes);
    console.log('[Machine API] Active recipes updated successfully in DB');
    
    return res.json({
      success: true,
      recipes: machineState.getActiveRecipes(),
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

module.exports = router;

