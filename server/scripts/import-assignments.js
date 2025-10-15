// Import assignment history from CSV into SQLite
// This populates the assignment_history_view or creates the necessary tables

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../db/sqlite');

const CSV_PATH = path.join(__dirname, '../../python-worker/one_time_output/sqlite_assignments.csv');

async function importAssignments() {
  console.log('\n=== Importing Assignment History ===\n');
  console.log('Reading CSV:', CSV_PATH);
  
  if (!fs.existsSync(CSV_PATH)) {
    console.error('❌ CSV file not found:', CSV_PATH);
    process.exit(1);
  }

  // First, ensure we have the programs and recipes tables populated
  // Get unique programs and recipes from the CSV
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

  // Insert programs if they don't exist
  const insertProgram = db.prepare(`
    INSERT OR IGNORE INTO programs (id, name, description)
    VALUES (?, ?, ?)
  `);
  
  for (const [id, name] of programs) {
    insertProgram.run(id, name, `Auto-imported program ${id}`);
  }
  console.log(`✓ Inserted/updated ${programs.size} programs`);

  // Insert recipes if they don't exist
  const insertRecipe = db.prepare(`
    INSERT OR IGNORE INTO recipes (name, target_weight_g, tolerance_g, description)
    VALUES (?, NULL, NULL, ?)
  `);
  
  for (const [name] of recipes) {
    insertRecipe.run(name, `Auto-imported recipe ${name}`);
  }
  console.log(`✓ Inserted/updated ${recipes.size} recipes`);

  // Get recipe ID map
  const recipeMap = new Map();
  const allRecipes = db.prepare('SELECT id, name FROM recipes').all();
  allRecipes.forEach(r => recipeMap.set(r.name, r.id));

  // Group assignments by timestamp and program to create configs
  const configsByTimestamp = new Map();
  
  assignments.forEach(({ ts, program, gate, recipe }) => {
    const key = `${ts}_${program}`;
    if (!configsByTimestamp.has(key)) {
      configsByTimestamp.set(key, { ts, program, gates: [] });
    }
    configsByTimestamp.get(key).gates.push({ gate, recipe });
  });

  console.log(`\nCreating ${configsByTimestamp.size} configuration snapshots...`);

  // Insert configs and their assignments
  const insertConfig = db.prepare(`
    INSERT INTO run_configs (name, program_id, description)
    VALUES (?, ?, ?)
  `);
  
  const insertConfigAssignment = db.prepare(`
    INSERT INTO run_config_assignments (config_id, gate_number, recipe_id)
    VALUES (?, ?, ?)
  `);
  
  const insertSettingsHistory = db.prepare(`
    INSERT INTO settings_history (changed_at, active_config_id, note, user_id)
    VALUES (?, ?, ?, NULL)
  `);

  let configCount = 0;
  let assignmentCount = 0;
  
  for (const [key, { ts, program, gates }] of configsByTimestamp) {
    // Create a config for this snapshot
    const configName = `Config_${ts.replace(/[:\s]/g, '_')}_P${program}`;
    const result = insertConfig.run(
      configName,
      program,
      `Auto-imported config from ${ts}`
    );
    
    const configId = result.lastInsertRowid;
    configCount++;
    
    // Insert gate assignments for this config
    for (const { gate, recipe } of gates) {
      const recipeId = recipeMap.get(recipe);
      if (recipeId) {
        insertConfigAssignment.run(configId, gate, recipeId);
        assignmentCount++;
      }
    }
    
    // Insert into settings history to track when this config was active
    insertSettingsHistory.run(ts, configId, `Imported from CSV`);
    
    process.stdout.write(`\rProcessed ${configCount} configs, ${assignmentCount} assignments...`);
  }
  
  console.log(`\n\n✅ Import complete!`);
  console.log(`   - ${configCount} configurations created`);
  console.log(`   - ${assignmentCount} gate assignments created`);
  console.log(`   - ${configCount} settings history entries created`);
  console.log('\n');
}

importAssignments()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

