// Import routes for one-time data imports
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../db/sqlite');
const { verifyToken } = require('../utils/authMiddleware');

/**
 * POST /api/import/assignments
 * Import assignment history from CSV
 * NOTE: Auth temporarily disabled for one-time import
 */
router.post('/assignments', async (req, res) => {
  try {
    const CSV_PATH = path.join(__dirname, '../../python-worker/one_time_output/sqlite_assignments.csv');
    
    if (!fs.existsSync(CSV_PATH)) {
      return res.status(404).json({ error: 'CSV file not found', path: CSV_PATH });
    }

    console.log('Starting assignment import from:', CSV_PATH);

    // Read CSV data
    const programs = new Map();
    const recipes = new Map();
    const assignments = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_PATH)
        .pipe(csv())
        .on('data', (row) => {
          const ts = row.ts;
          const program = parseInt(row.program);
          const gate = parseInt(row.gate);
          const recipe = row.recipe;
          
          if (!programs.has(program)) {
            programs.set(program, `Program ${program}`);
          }
          if (!recipes.has(recipe)) {
            recipes.set(recipe, recipe);
          }
          
          assignments.push({ ts, program, gate, recipe });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Found ${programs.size} programs, ${recipes.size} recipes, ${assignments.length} assignment records`);

    // Clean up any existing imports (delete configs created from previous imports)
    console.log('Cleaning up existing imports...');
    db.exec(`
      DELETE FROM run_config_assignments WHERE config_id IN (
        SELECT id FROM run_configs WHERE source = 'manual' AND name LIKE 'Config_%'
      );
      DELETE FROM settings_history WHERE active_config_id IN (
        SELECT id FROM run_configs WHERE source = 'manual' AND name LIKE 'Config_%'
      );
      DELETE FROM run_configs WHERE source = 'manual' AND name LIKE 'Config_%';
    `);

    // Insert programs
    const insertProgram = db.prepare(`
      INSERT OR IGNORE INTO programs (id, name, gates)
      VALUES (?, ?, 8)
    `);
    
    for (const [id, name] of programs) {
      insertProgram.run(id, name);
    }

    // Insert recipes
    const insertRecipe = db.prepare(`
      INSERT OR IGNORE INTO recipes (name, piece_min_weight_g, piece_max_weight_g)
      VALUES (?, 0, 1000)
    `);
    
    for (const [name] of recipes) {
      insertRecipe.run(name);
    }

    // Get recipe ID map
    const recipeMap = new Map();
    const allRecipes = db.prepare('SELECT id, name FROM recipes').all();
    allRecipes.forEach(r => recipeMap.set(r.name, r.id));

    // Group assignments by timestamp and program
    const configsByTimestamp = new Map();
    
    assignments.forEach(({ ts, program, gate, recipe }) => {
      const key = `${ts}_${program}`;
      if (!configsByTimestamp.has(key)) {
        configsByTimestamp.set(key, { ts, program, gates: [] });
      }
      configsByTimestamp.get(key).gates.push({ gate, recipe });
    });

    // Insert configs and assignments
    const insertConfig = db.prepare(`
      INSERT INTO run_configs (name, program_id, source)
      VALUES (?, ?, 'manual')
    `);
    
    const insertConfigAssignment = db.prepare(`
      INSERT INTO run_config_assignments (config_id, gate_number, recipe_id)
      VALUES (?, ?, ?)
    `);
    
    const insertSettingsHistory = db.prepare(`
      INSERT INTO settings_history (changed_at, active_config_id, mode, note, user_id)
      VALUES (?, ?, 'preset', ?, NULL)
    `);

    let configCount = 0;
    let assignmentCount = 0;
    
    for (const [key, { ts, program, gates }] of configsByTimestamp) {
      const configName = `Config_${ts.replace(/[:\s]/g, '_')}_P${program}`;
      const result = insertConfig.run(configName, program);
      
      const configId = result.lastInsertRowid;
      configCount++;
      
      for (const { gate, recipe } of gates) {
        const recipeId = recipeMap.get(recipe);
        if (recipeId) {
          insertConfigAssignment.run(configId, gate, recipeId);
          assignmentCount++;
        }
      }
      
      insertSettingsHistory.run(ts, configId, `Imported from CSV`);
    }
    
    console.log(`Import complete: ${configCount} configs, ${assignmentCount} assignments`);

    res.json({
      success: true,
      programs: programs.size,
      recipes: recipes.size,
      configs: configCount,
      assignments: assignmentCount
    });
  } catch (err) {
    console.error('Assignment import error:', err);
    res.status(500).json({ error: 'Import failed', message: err.message });
  }
});

module.exports = router;

