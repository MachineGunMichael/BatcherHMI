// server/lib/recipeManager.js
// Manages recipe specifications and batch detection logic

const db = require('../db/sqlite');
const { bus } = require('./eventBus');
const gates = require('../state/gates');

class RecipeManager {
  constructor() {
    this.recipes = new Map(); // recipe_id -> recipe spec
    this.gateAssignments = new Map(); // gate -> recipe_id
    this.warnedGates = new Set(); // track gates we've already warned about
  }

  /**
   * Load all recipes from SQLite
   * Uses database columns as the source of truth, with name parsing as fallback
   */
  loadRecipes() {
    const rows = db.prepare(`
      SELECT id, name, 
             piece_min_weight_g, piece_max_weight_g,
             batch_min_weight_g, batch_max_weight_g,
             min_pieces_per_batch, max_pieces_per_batch
      FROM recipes
    `).all();
    
    for (const row of rows) {
      // Try to parse from name first (for backwards compatibility)
      let spec = this.parseRecipeName(row.id, row.name);
      
      // Use database columns as source of truth (override parsed values)
      if (spec) {
        // Override with actual database values if they exist
        spec.pieceMin = row.piece_min_weight_g ?? spec.pieceMin;
        spec.pieceMax = row.piece_max_weight_g ?? spec.pieceMax;
        spec.batchMin = row.batch_min_weight_g ?? spec.batchMin;
        spec.batchMax = row.batch_max_weight_g ?? spec.batchMax;
        
        // Determine count type and value from database
        if (row.min_pieces_per_batch && row.max_pieces_per_batch && 
            row.min_pieces_per_batch === row.max_pieces_per_batch) {
          spec.countType = 'exact';
          spec.countVal = row.min_pieces_per_batch;
        } else if (row.min_pieces_per_batch) {
          spec.countType = 'min';
          spec.countVal = row.min_pieces_per_batch;
        } else if (row.max_pieces_per_batch) {
          spec.countType = 'max';
          spec.countVal = row.max_pieces_per_batch;
        }
      } else {
        // Fallback: create spec entirely from database columns
        spec = {
          id: row.id,
          name: row.name,
          pieceMin: row.piece_min_weight_g || 0,
          pieceMax: row.piece_max_weight_g || 0,
          batchMin: row.batch_min_weight_g || 0,
          batchMax: row.batch_max_weight_g || 0,
          countType: null,
          countVal: null,
        };
        
        // Determine count type from database
        if (row.min_pieces_per_batch && row.max_pieces_per_batch && 
            row.min_pieces_per_batch === row.max_pieces_per_batch) {
          spec.countType = 'exact';
          spec.countVal = row.min_pieces_per_batch;
        } else if (row.min_pieces_per_batch) {
          spec.countType = 'min';
          spec.countVal = row.min_pieces_per_batch;
        } else if (row.max_pieces_per_batch) {
          spec.countType = 'max';
          spec.countVal = row.max_pieces_per_batch;
        }
      }
      
      if (spec) {
        this.recipes.set(row.id, spec);
      }
    }
    
    if (this.recipes.size === 0) {
      console.log('⏳ No recipes loaded yet. Waiting for Python worker...');
    } else {
      console.log(`📋 Loaded ${this.recipes.size} recipes`);
    }
  }

  /**
   * Parse recipe name format: R_pieceMin_pieceMax_batchMin_batchMax_countType_countVal
   * Example: R_120_160_0_0_exact_35
   */
  parseRecipeName(id, name) {
    if (!name || !name.startsWith('R_')) return null;
    
    try {
      const parts = name.split('_');
      return {
        id,
        name,
        pieceMin: parseInt(parts[1]) || 0,
        pieceMax: parseInt(parts[2]) || 0,
        batchMin: parseInt(parts[3]) || 0,
        batchMax: parseInt(parts[4]) || 0,
        countType: parts[5] === 'NA' ? null : parts[5], // 'exact', 'min', 'max', or null
        countVal: parts[6] === 'NA' || parts[6] === '0' ? null : parseInt(parts[6]),
      };
    } catch (e) {
      console.warn(`⚠️  Failed to parse recipe: ${name}`);
      return null;
    }
  }

  /**
   * Load current gate assignments from machine state (NEW - machine state integration)
   */
  loadGateAssignments() {
    // Get active recipes from machine state
    const machineStateRow = db.prepare(`
      SELECT active_recipes 
      FROM machine_state 
      WHERE id = 1
    `).get();
    
    this.gateAssignments.clear();
    
    if (!machineStateRow || !machineStateRow.active_recipes) {
      console.log('⏳ No active recipes in machine state yet');
      return;
    }
    
    try {
      const activeRecipes = JSON.parse(machineStateRow.active_recipes);
      
      if (!Array.isArray(activeRecipes) || activeRecipes.length === 0) {
        console.log('⏳ No active recipes configured');
        return;
      }
      
      // Convert active recipes to gate assignments
      for (const recipe of activeRecipes) {
        const recipeName = recipe.recipeName;
        const gates = recipe.gates || [];
        const params = recipe.params || {};
        
        // Find recipe ID by name
        let recipeRow = db.prepare(`SELECT id FROM recipes WHERE name = ?`).get(recipeName);
        
        if (!recipeRow) {
          // Auto-create recipe (fallback if /api/machine/recipes wasn't called)
          console.warn(`⚠️  Recipe not found in database: ${recipeName}, auto-creating...`);
          
          try {
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
            
            db.prepare(`
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
            
            // Fetch the newly created recipe
            recipeRow = db.prepare(`SELECT id FROM recipes WHERE name = ?`).get(recipeName);
            console.log(`   ✅ Auto-created recipe: ${recipeName} (ID: ${recipeRow.id})`);
          } catch (e) {
            console.error(`   ❌ Failed to auto-create recipe ${recipeName}:`, e);
            continue;
          }
        }
        
        if (!recipeRow) {
          console.error(`   ❌ Could not get recipe ID for ${recipeName}`);
          continue;
        }
        
        const recipeId = recipeRow.id;
        
        // Assign this recipe to all its gates
        for (const gate of gates) {
          this.gateAssignments.set(gate, recipeId);
          const recipeSpec = this.recipes.get(recipeId);
          console.log(`   Gate ${gate} → ${recipeSpec ? recipeSpec.name : recipeName}`);
        }
      }
      
      console.log(`🔧 Loaded assignments for ${this.gateAssignments.size} gates`);
    } catch (e) {
      console.error('❌ Failed to parse active recipes from machine state:', e);
    }
  }

  /**
   * Get recipe spec for a gate
   * IMPORTANT: For transitioning gates, returns the ORIGINAL recipe (not the new one)
   * This ensures pieces are assigned based on the recipe that's actually running
   */
  getRecipeForGate(gate) {
    const machineState = require('../services/machineState');
    const state = machineState.getState();
    
    // Check if this gate is transitioning - if so, use the ORIGINAL recipe
    if (state.transitioningGates?.includes(gate) && state.transitionStartRecipes?.[gate]) {
      const originalRecipe = state.transitionStartRecipes[gate];
      // Get the recipe spec using the ORIGINAL recipe ID
      if (originalRecipe.recipeId) {
        const spec = this.recipes.get(originalRecipe.recipeId);
        if (spec) {
          return spec;
        }
      }
      // Fallback: parse from recipe name if ID lookup fails
      if (originalRecipe.recipeName) {
        return this.parseRecipeName(originalRecipe.recipeId, originalRecipe.recipeName);
      }
    }
    
    // Normal case: use current assignment
    const recipeId = this.gateAssignments.get(gate);
    if (!recipeId) return null;
    return this.recipes.get(recipeId);
  }

  /**
   * Check if batch is complete based on recipe specifications
   * 
   * @param {number} gate - Gate number
   * @param {number} pieces - Current piece count
   * @param {number} grams - Current weight in grams
   * @returns {boolean} - True if batch is complete
   */
  isBatchComplete(gate, pieces, grams) {
    const recipe = this.getRecipeForGate(gate);
    if (!recipe) {
      // Only warn once per gate (not on every piece)
      if (!this.warnedGates.has(gate)) {
        console.log(`⚠️  Gate ${gate}: No recipe assigned (gate inactive)`);
        this.warnedGates.add(gate);
      }
      return false;
    }

    // Weight-based completion
    let weightCondition = false;
    if (recipe.batchMin > 0) {
      if (recipe.batchMax > 0) {
        // Weight range: batch completes when batch_min <= weight <= batch_max
        weightCondition = grams >= recipe.batchMin && grams <= recipe.batchMax;
        if (grams > recipe.batchMax) {
          console.log(`⚠️  Gate ${gate}: Weight exceeded max bound (${grams.toFixed(1)}g > ${recipe.batchMax}g)`);
        }
      } else {
        // Only minimum weight: weight >= batch_min
        weightCondition = grams >= recipe.batchMin;
      }
    }

    // Count-based completion
    let countCondition = false;
    if (recipe.countType && recipe.countVal !== null) {
      if (recipe.countType === 'exact') {
        countCondition = pieces === recipe.countVal;
        if (pieces > recipe.countVal) {
          console.log(`⚠️  Gate ${gate}: Count exceeded exact bound (${pieces} > ${recipe.countVal})`);
        }
      } else if (recipe.countType === 'min') {
        countCondition = pieces >= recipe.countVal;
      } else if (recipe.countType === 'max') {
        countCondition = pieces >= recipe.countVal;
        if (pieces > recipe.countVal) {
          console.log(`⚠️  Gate ${gate}: Count exceeded max bound (${pieces} > ${recipe.countVal})`);
        }
      }
    }

    // Determine completion
    let isComplete = false;
    let reason = '';
    
    // OR logic: if both conditions exist, either one triggers completion
    if (recipe.batchMin > 0 && recipe.countType && recipe.countVal !== null) {
      isComplete = weightCondition || countCondition;
      if (weightCondition) reason = `weight ${grams.toFixed(1)}g >= ${recipe.batchMin}g`;
      if (countCondition) reason = `count ${pieces} ${recipe.countType} ${recipe.countVal}`;
    } else if (recipe.batchMin > 0) {
      isComplete = weightCondition;
      if (weightCondition) reason = `weight ${grams.toFixed(1)}g >= ${recipe.batchMin}g`;
    } else if (recipe.countType && recipe.countVal !== null) {
      isComplete = countCondition;
      if (countCondition) reason = `count ${pieces} ${recipe.countType} ${recipe.countVal}`;
    }

    if (isComplete) {
      console.log(`✅ Gate ${gate} (${recipe.name}): BATCH COMPLETE - ${reason}`);
    }

    return isComplete;
  }

  /**
   * Check if batch is complete using provided parameters (for transitioning gates)
   * This is used when a recipe has been removed but the gate still needs to complete its batch
   * @param {number} gate - Gate number
   * @param {number} pieces - Current piece count
   * @param {number} grams - Current weight in grams
   * @param {object} params - Recipe parameters from transitionStartRecipes
   * @returns {boolean} - True if batch is complete
   */
  isBatchCompleteWithParams(gate, pieces, grams, params) {
    // Extract parameters (params structure from frontend/machine state)
    const batchMin = params.batchMinWeight || 0;
    const batchMax = params.batchMaxWeight || 0;
    const countType = params.countType || null;
    const countVal = params.countValue || null;

    // Weight-based completion
    let weightCondition = false;
    if (batchMin > 0) {
      if (batchMax > 0) {
        weightCondition = grams >= batchMin && grams <= batchMax;
        if (grams > batchMax) {
          console.log(`⚠️  Gate ${gate} (transitioning): Weight exceeded max bound (${grams.toFixed(1)}g > ${batchMax}g)`);
        }
      } else {
        weightCondition = grams >= batchMin;
      }
    }

    // Count-based completion
    let countCondition = false;
    if (countType && countVal !== null && countType !== 'NA') {
      if (countType === 'exact') {
        countCondition = pieces === countVal;
        if (pieces > countVal) {
          console.log(`⚠️  Gate ${gate} (transitioning): Count exceeded exact bound (${pieces} > ${countVal})`);
        }
      } else if (countType === 'min') {
        countCondition = pieces >= countVal;
      } else if (countType === 'max') {
        countCondition = pieces >= countVal;
        if (pieces > countVal) {
          console.log(`⚠️  Gate ${gate} (transitioning): Count exceeded max bound (${pieces} > ${countVal})`);
        }
      }
    }

    // Determine completion (OR logic)
    let isComplete = false;
    let reason = '';
    
    if (batchMin > 0 && countType && countVal !== null && countType !== 'NA') {
      isComplete = weightCondition || countCondition;
      if (weightCondition) reason = `weight ${grams.toFixed(1)}g >= ${batchMin}g`;
      if (countCondition) reason = `count ${pieces} ${countType} ${countVal}`;
    } else if (batchMin > 0) {
      isComplete = weightCondition;
      if (weightCondition) reason = `weight ${grams.toFixed(1)}g >= ${batchMin}g`;
    } else if (countType && countVal !== null && countType !== 'NA') {
      isComplete = countCondition;
      if (countCondition) reason = `count ${pieces} ${countType} ${countVal}`;
    }

    if (isComplete) {
      console.log(`✅ Gate ${gate} (TRANSITIONING): BATCH COMPLETE - ${reason}`);
    }

    return isComplete;
  }

  /**
   * Reload recipes and assignments (call when program changes)
   */
  reload() {
    console.log('[RecipeManager] Reloading recipes and gate assignments...');
    
    // Store old assignments before reloading
    const oldAssignments = new Map(this.gateAssignments);
    
    this.loadRecipes();
    this.loadGateAssignments();
    // Clear warned gates on reload (new program may have different gate configs)
    this.warnedGates.clear();
    
    // Get transitioning gates - DO NOT reset these!
    // They should keep their pieces/weight until batch completes
    const machineState = require('../services/machineState');
    const transitioningGates = machineState.getTransitioningGates() || [];
    
    // Only reset gates that:
    // 1. Had a recipe change AND
    // 2. Are NOT in the transitioning list
    for (let g = gates.GATE_MIN; g <= gates.GATE_MAX; g++) {
      const oldRecipe = oldAssignments.get(g);
      const newRecipe = this.gateAssignments.get(g);
      
      if (oldRecipe !== newRecipe) {
        // Check if this gate is transitioning - if so, DON'T reset it!
        if (transitioningGates.includes(g)) {
          console.log(`⏳ Gate ${g}: Recipe changed (${oldRecipe} → ${newRecipe}) - NOT resetting (transitioning)`);
          continue;
        }
        
        // Recipe changed or gate became inactive/active - safe to reset
        gates.resetGate(g);
        if (oldRecipe && newRecipe) {
          console.log(`🔄 Gate ${g}: Recipe changed (${oldRecipe} → ${newRecipe}) - reset to 0`);
        } else if (!newRecipe) {
          console.log(`🔄 Gate ${g}: Became inactive - reset to 0`);
        } else if (!oldRecipe) {
          console.log(`🔄 Gate ${g}: Became active (${newRecipe}) - reset to 0`);
        }
      }
    }
  }
}

// Singleton instance
const recipeManager = new RecipeManager();

// Initialize on module load
try {
  recipeManager.loadRecipes();
  recipeManager.loadGateAssignments();
} catch (e) {
  console.error('❌ Failed to initialize RecipeManager:', e);
}

// Auto-reload assignments when program changes (via event bus)
bus.on('program:changed', () => {
  console.log('📢 Program changed event received, reloading assignments...');
  try {
    recipeManager.reload();
  } catch (e) {
    console.error('❌ Failed to reload assignments on program change:', e);
  }
});

// Auto-reload assignments when machine state changes (NEW - machine state integration)
bus.on('machine:state-changed', (state) => {
  console.log(`📢 Machine state changed to: ${state.state}, ${state.activeRecipes?.length || 0} active recipes`);
  console.log(`📢 transitioningGates: ${JSON.stringify(state.transitioningGates)}`);
  console.log(`📢 Reloading assignments...`);
  try {
    recipeManager.reload();  // Use reload() instead of just loadGateAssignments() to reset gates
    // Log which gates have assignments after reload
    const gateAssignments = [];
    for (let g = 1; g <= 8; g++) {
      const recipe = recipeManager.getRecipeForGate(g);
      if (recipe) {
        gateAssignments.push(`Gate ${g}: ${recipe.name}`);
      }
    }
    console.log(`📢 After reload, gate assignments: ${gateAssignments.join(', ') || 'none'}`);
  } catch (e) {
    console.error('❌ Failed to reload assignments on machine state change:', e);
  }
});

module.exports = recipeManager;

