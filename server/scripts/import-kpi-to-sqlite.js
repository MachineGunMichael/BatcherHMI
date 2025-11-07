#!/usr/bin/env node
// Import M3 (KPI minute) and M4 (KPI totals) data from CSV into SQLite
// This script reads the one_time_output CSVs and populates the SQLite database
// with historical KPI data for replay mode.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../db/sqlite/batching_app.sqlite');
const CSV_DIR = path.join(__dirname, '../../python-worker/one_time_output');

const FILES = [
  { file: 'influx_m3_kpi_minute_recipes.csv', table: 'kpi_minute_recipes' },
  { file: 'influx_m3_kpi_minute_combined.csv', table: 'kpi_minute_combined' },
  { file: 'influx_m4_kpi_totals.csv', table: 'kpi_totals' },
];

// Initialize database connection
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log(`[SQLite] Using database at: ${DB_PATH}\n`);

// ========== SCHEMA SETUP ==========

function setupSchema() {
  console.log('📋 Setting up KPI tables schema...\n');
  
  // M3 Per-Recipe KPIs (per-minute)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_minute_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      program_id INTEGER,
      batches_min REAL DEFAULT 0,
      giveaway_pct REAL DEFAULT 0,
      pieces_processed INTEGER DEFAULT 0,
      weight_processed_g REAL DEFAULT 0,
      rejects_per_min REAL DEFAULT 0,
      total_rejects_count INTEGER DEFAULT 0,
      total_rejects_weight_g REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_min_recipes_time ON kpi_minute_recipes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_min_recipes_recipe ON kpi_minute_recipes(recipe_name, timestamp);
  `);
  console.log('✅ Created table: kpi_minute_recipes');
  
  // M3 Combined/Total KPIs (per-minute, aggregated across all recipes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_minute_combined (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      batches_min REAL DEFAULT 0,
      giveaway_pct REAL DEFAULT 0,
      pieces_processed INTEGER DEFAULT 0,
      weight_processed_g REAL DEFAULT 0,
      rejects_per_min REAL DEFAULT 0,
      total_rejects_count INTEGER DEFAULT 0,
      total_rejects_weight_g REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_min_combined_time ON kpi_minute_combined(timestamp);
  `);
  console.log('✅ Created table: kpi_minute_combined');
  
  // M4 Totals (cumulative per recipe)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_totals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      program_id INTEGER,
      total_batches INTEGER DEFAULT 0,
      giveaway_g_per_batch REAL DEFAULT 0,
      giveaway_pct_avg REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_totals_time ON kpi_totals(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_totals_recipe ON kpi_totals(recipe_name, timestamp);
  `);
  console.log('✅ Created table: kpi_totals');
  console.log('');
}

// ========== CSV PARSING ==========

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ========== DATA IMPORT ==========

async function importCSV(filePath, table) {
  const fileName = path.basename(filePath);
  console.log(`📥 Importing ${fileName} into ${table}...`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let headers = null;
  let rows = [];
  let count = 0;
  let errors = 0;
  const BATCH_SIZE = 1000; // Insert in batches for performance
  
  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      continue;
    }
    
    const values = parseCSVLine(line);
    if (values.length !== headers.length) {
      errors++;
      continue;
    }
    
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i]; });
    rows.push(row);
    
    if (rows.length >= BATCH_SIZE) {
      const success = insertBatch(rows, table);
      if (success) {
        count += rows.length;
        process.stdout.write(`  ⏳ ${count} rows imported...\r`);
      } else {
        errors += rows.length;
      }
      rows = [];
    }
  }
  
  // Insert remaining rows
  if (rows.length > 0) {
    const success = insertBatch(rows, table);
    if (success) {
      count += rows.length;
    } else {
      errors += rows.length;
    }
  }
  
  process.stdout.write('\n');
  if (errors === 0) {
    console.log(`✅ Successfully imported ${count} rows from ${fileName}\n`);
  } else {
    console.log(`⚠️  Imported ${count} rows, ${errors} rows failed from ${fileName}\n`);
  }
}

function insertBatch(rows, table) {
  try {
    if (table === 'kpi_minute_recipes') {
      const stmt = db.prepare(`
        INSERT INTO kpi_minute_recipes (
          timestamp, recipe_name, program_id, batches_min, giveaway_pct,
          pieces_processed, weight_processed_g, rejects_per_min,
          total_rejects_count, total_rejects_weight_g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          stmt.run(
            row.ts_minute || row.minute_ts || row.timestamp,
            row.recipe || 'Unknown',
            row.program ? parseInt(row.program) : null,
            parseFloat(row.batches_min || 0),
            parseFloat(row.giveaway_pct || 0),
            parseInt(row.pieces_processed || 0),
            parseFloat(row.weight_processed_g || 0),
            parseFloat(row.rejects_per_min || 0),
            parseInt(row.total_rejects_count || 0),
            parseFloat(row.total_rejects_weight_g || 0)
          );
        }
      });
      
      insertMany(rows);
      return true;
      
    } else if (table === 'kpi_minute_combined') {
      const stmt = db.prepare(`
        INSERT INTO kpi_minute_combined (
          timestamp, batches_min, giveaway_pct, pieces_processed,
          weight_processed_g, rejects_per_min, total_rejects_count,
          total_rejects_weight_g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          stmt.run(
            row.ts_minute || row.minute_ts || row.timestamp,
            parseFloat(row.batches_min || 0),
            parseFloat(row.giveaway_pct || 0),
            parseInt(row.pieces_processed || 0),
            parseFloat(row.weight_processed_g || 0),
            parseFloat(row.rejects_per_min || 0),
            parseInt(row.total_rejects_count || 0),
            parseFloat(row.total_rejects_weight_g || 0)
          );
        }
      });
      
      insertMany(rows);
      return true;
      
    } else if (table === 'kpi_totals') {
      const stmt = db.prepare(`
        INSERT INTO kpi_totals (
          timestamp, recipe_name, program_id, total_batches,
          giveaway_g_per_batch, giveaway_pct_avg
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          stmt.run(
            row.ts || row.minute_ts || row.timestamp,
            row.recipe || 'Unknown',
            row.program ? parseInt(row.program) : null,
            parseInt(row.total_batches || 0),
            parseFloat(row.giveaway_g_per_batch || 0),
            parseFloat(row.giveaway_pct_avg || 0)
          );
        }
      });
      
      insertMany(rows);
      return true;
    }
    
    return false;
  } catch (err) {
    console.error(`\n❌ ERROR: Insert failed for ${table}:`, err.message);
    return false;
  }
}

// ========== MAIN ==========

async function main() {
  console.log('=== Importing KPI Data to SQLite ===\n');
  
  // Setup schema
  setupSchema();
  
  // Clear existing data
  console.log('🗑️  Clearing existing KPI data...');
  db.exec('DELETE FROM kpi_minute_recipes');
  db.exec('DELETE FROM kpi_minute_combined');
  db.exec('DELETE FROM kpi_totals');
  console.log('✅ Cleared existing data\n');
  
  // Import each CSV file
  for (const { file, table } of FILES) {
    const filePath = path.join(CSV_DIR, file);
    await importCSV(filePath, table);
  }
  
  // Show summary
  const recipesCount = db.prepare('SELECT COUNT(*) as count FROM kpi_minute_recipes').get().count;
  const combinedCount = db.prepare('SELECT COUNT(*) as count FROM kpi_minute_combined').get().count;
  const totalsCount = db.prepare('SELECT COUNT(*) as count FROM kpi_totals').get().count;
  
  console.log('=== Import Summary ===');
  console.log(`  kpi_minute_recipes:  ${recipesCount.toLocaleString()} rows`);
  console.log(`  kpi_minute_combined: ${combinedCount.toLocaleString()} rows`);
  console.log(`  kpi_totals:          ${totalsCount.toLocaleString()} rows`);
  console.log('');
  console.log('✅ KPI import complete!');
  
  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

