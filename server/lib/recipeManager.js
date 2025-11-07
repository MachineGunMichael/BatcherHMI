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
   */
  loadRecipes() {
    const rows = db.prepare(`SELECT id, name FROM recipes`).all();
    
    for (const row of rows) {
      const spec = this.parseRecipeName(row.id, row.name);
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
   * Load current gate assignments from SQLite
   */
  loadGateAssignments() {
    const rows = db.prepare(`
      SELECT rca.gate_number, rca.recipe_id
      FROM run_config_assignments rca
      WHERE rca.config_id = (
        SELECT active_config_id 
        FROM settings_history 
        WHERE active_config_id IS NOT NULL 
        ORDER BY changed_at DESC 
        LIMIT 1
      )
    `).all();
    
    this.gateAssignments.clear();
    
    if (rows.length === 0) {
      console.log('⏳ No gate assignments loaded yet. Waiting for Python worker...');
      return;
    }
    
    for (const row of rows) {
      this.gateAssignments.set(row.gate_number, row.recipe_id);
      const recipe = this.recipes.get(row.recipe_id);
      console.log(`   Gate ${row.gate_number} → ${recipe ? recipe.name : row.recipe_id}`);
    }
    
    console.log(`🔧 Loaded assignments for ${this.gateAssignments.size} gates`);
  }

  /**
   * Get recipe spec for a gate
   */
  getRecipeForGate(gate) {
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
   * Reload recipes and assignments (call when program changes)
   */
  reload() {
    // Store old assignments before reloading
    const oldAssignments = new Map(this.gateAssignments);
    
    this.loadRecipes();
    this.loadGateAssignments();
    // Clear warned gates on reload (new program may have different gate configs)
    this.warnedGates.clear();
    
    // Reset gates whose recipe changed or became inactive
    for (let g = gates.GATE_MIN; g <= gates.GATE_MAX; g++) {
      const oldRecipe = oldAssignments.get(g);
      const newRecipe = this.gateAssignments.get(g);
      
      if (oldRecipe !== newRecipe) {
        // Recipe changed or gate became inactive/active
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

module.exports = recipeManager;

