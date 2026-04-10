// server/lib/recipeManager.js
// Manages recipe specifications and batch detection logic

const db = require('../db/sqlite');
const { bus } = require('./eventBus');
const gates = require('../state/gates');
const log = require('./logger');

class RecipeManager {
  constructor() {
    this.recipes = new Map(); // recipe_id -> recipe spec
    this.gateAssignments = new Map(); // gate -> recipe_id
    this.warnedGates = new Set(); // track gates we've already warned about
  }

  /**
   * Load all recipes from SQLite
   */
  loadRecipes() {
    const rows = db.prepare(`
      SELECT id, name, 
             piece_min_weight_g, piece_max_weight_g,
             batch_min_weight_g, batch_max_weight_g,
             min_pieces_per_batch, max_pieces_per_batch
      FROM recipes
    `).all();
    
    this.recipes.clear();

    for (const row of rows) {
      let spec = this.parseRecipeName(row.id, row.name);
      
      if (spec) {
        spec.pieceMin = row.piece_min_weight_g ?? spec.pieceMin;
        spec.pieceMax = row.piece_max_weight_g ?? spec.pieceMax;
        spec.batchMin = row.batch_min_weight_g ?? spec.batchMin;
        spec.batchMax = row.batch_max_weight_g ?? spec.batchMax;
        
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
    
    log.debug('system', 'recipes_loaded', `Loaded ${this.recipes.size} recipes`, { count: this.recipes.size });
  }

  /**
   * Parse recipe name format: R_pieceMin_pieceMax_batchMin_batchMax_countType_countVal
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
        countType: parts[5] === 'NA' ? null : parts[5],
        countVal: parts[6] === 'NA' || parts[6] === '0' ? null : parseInt(parts[6]),
      };
    } catch (e) {
      log.warn('system', 'recipe_parse_error', `Failed to parse: ${name}`);
      return null;
    }
  }

  /**
   * Load current gate assignments from machine state
   */
  loadGateAssignments() {
    const machineStateRow = db.prepare(`
      SELECT active_recipes 
      FROM machine_state 
      WHERE id = 1
    `).get();
    
    this.gateAssignments.clear();
    
    if (!machineStateRow || !machineStateRow.active_recipes) {
      return;
    }
    
    try {
      const activeRecipes = JSON.parse(machineStateRow.active_recipes);
      
      if (!Array.isArray(activeRecipes) || activeRecipes.length === 0) {
        return;
      }
      
      for (const recipe of activeRecipes) {
        const recipeName = recipe.recipeName;
        const gateList = recipe.gates || [];
        const params = recipe.params || {};
        
        let recipeRow = db.prepare(`SELECT id FROM recipes WHERE name = ?`).get(recipeName);
        
        if (!recipeRow) {
          // Auto-create recipe
          try {
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
            
            recipeRow = db.prepare(`SELECT id FROM recipes WHERE name = ?`).get(recipeName);
            log.operations('recipe_auto_created', `Recipe "${recipeName}" auto-created`, { recipeName, recipeId: recipeRow?.id });
          } catch (e) {
            log.error('system', 'recipe_auto_create_error', e, { recipeName });
            continue;
          }
        }
        
        if (!recipeRow) {
          continue;
        }
        
        const recipeId = recipeRow.id;
        
        for (const gate of gateList) {
          this.gateAssignments.set(gate, recipeId);
        }
      }
      
      log.debug('system', 'gate_assignments_loaded', `Loaded ${this.gateAssignments.size} gate assignments`, { 
        count: this.gateAssignments.size 
      });
    } catch (e) {
      log.error('system', 'gate_assignments_parse_error', e);
    }
  }

  /**
   * Get recipe spec for a gate
   */
  getRecipeForGate(gate) {
    const machineState = require('../services/machineState');
    const state = machineState.getState();
    
    if (state.transitioningGates?.includes(gate) && state.transitionStartRecipes?.[gate]) {
      const originalRecipe = state.transitionStartRecipes[gate];
      if (originalRecipe.recipeId) {
        const spec = this.recipes.get(originalRecipe.recipeId);
        if (spec) {
          return spec;
        }
      }
      if (originalRecipe.recipeName) {
        return this.parseRecipeName(originalRecipe.recipeId, originalRecipe.recipeName);
      }
    }
    
    const recipeId = this.gateAssignments.get(gate);
    if (!recipeId) return null;
    return this.recipes.get(recipeId);
  }

  /**
   * Check if batch is complete based on recipe specifications
   */
  isBatchComplete(gate, pieces, grams) {
    const recipe = this.getRecipeForGate(gate);
    if (!recipe) {
      if (!this.warnedGates.has(gate)) {
        this.warnedGates.add(gate);
        console.warn(`[recipeManager] No recipe found for gate ${gate} — cannot check batch completion`);
      }
      // Safety: if no recipe but gate has accumulated extreme amounts, force complete
      if (pieces > 200 || grams > 50000) {
        console.warn(`[recipeManager] Gate ${gate} safety reset: ${pieces} pieces, ${grams}g with no recipe`);
        return true;
      }
      return false;
    }

    // Weight-based completion (use >= batchMin; batchMax is a target, not a hard ceiling)
    let weightCondition = false;
    if (recipe.batchMin > 0) {
      weightCondition = grams >= recipe.batchMin;
    }

    // Count-based completion (use >= for all types to prevent stuck gates)
    let countCondition = false;
    if (recipe.countType && recipe.countVal !== null) {
      countCondition = pieces >= recipe.countVal;
    }

    // Determine completion (OR logic)
    let isComplete = false;
    
    if (recipe.batchMin > 0 && recipe.countType && recipe.countVal !== null) {
      isComplete = weightCondition || countCondition;
    } else if (recipe.batchMin > 0) {
      isComplete = weightCondition;
    } else if (recipe.countType && recipe.countVal !== null) {
      isComplete = countCondition;
    }

    return isComplete;
  }

  /**
   * Check if batch is complete using provided parameters (for transitioning gates)
   */
  isBatchCompleteWithParams(gate, pieces, grams, params) {
    const batchMin = params.batchMinWeight || 0;
    const countType = params.countType || null;
    const countVal = params.countValue || null;

    // Weight-based completion (use >= batchMin; batchMax is a target, not a hard ceiling)
    let weightCondition = false;
    if (batchMin > 0) {
      weightCondition = grams >= batchMin;
    }

    // Count-based completion (use >= for all types to prevent stuck gates)
    let countCondition = false;
    if (countType && countVal !== null && countType !== 'NA') {
      countCondition = pieces >= countVal;
    }

    // Determine completion (OR logic)
    let isComplete = false;
    
    if (batchMin > 0 && countType && countVal !== null && countType !== 'NA') {
      isComplete = weightCondition || countCondition;
    } else if (batchMin > 0) {
      isComplete = weightCondition;
    } else if (countType && countVal !== null && countType !== 'NA') {
      isComplete = countCondition;
    }

    return isComplete;
  }

  /**
   * Reload recipes and assignments
   */
  reload() {
    const oldAssignments = new Map(this.gateAssignments);
    
    this.loadRecipes();
    this.loadGateAssignments();
    this.warnedGates.clear();
    
    const machineState = require('../services/machineState');
    const transitioningGates = machineState.getTransitioningGates() || [];
    
    for (let g = gates.GATE_MIN; g <= gates.GATE_MAX; g++) {
      const oldRecipe = oldAssignments.get(g);
      const newRecipe = this.gateAssignments.get(g);
      
      if (oldRecipe !== newRecipe) {
        if (transitioningGates.includes(g)) {
          continue; // Don't reset transitioning gates
        }
        
        gates.resetGate(g);
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
  log.error('system', 'recipe_manager_init_error', e);
}

// Auto-reload on program changes
bus.on('program:changed', () => {
  try {
    recipeManager.reload();
  } catch (e) {
    log.error('system', 'recipe_reload_error', e);
  }
});

// Auto-reload on machine state changes
bus.on('machine:state-changed', (state) => {
  try {
    recipeManager.reload();
  } catch (e) {
    log.error('system', 'recipe_reload_error', e);
  }
});

module.exports = recipeManager;
