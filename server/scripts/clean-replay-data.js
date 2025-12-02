#!/usr/bin/env node
/**
 * Clean Replay Data (June 2025) - Safe for Live Data
 * 
 * This script removes ONLY replay/imported data (June 2025) from SQLite,
 * while preserving all live mode data (October/November 2025+).
 * 
 * Use this instead of:
 *   rm -f db/sqlite/batching_app.sqlite
 * 
 * Usage:
 *   node scripts/clean-replay-data.js
 *   
 *   # Or specify custom date range:
 *   node scripts/clean-replay-data.js --start 2025-06-01 --end 2025-06-30
 */

const path = require('path');
const Database = require('better-sqlite3');

// Parse command line arguments
const args = process.argv.slice(2);
let startDate = '2025-06-01';
let endDate = '2025-06-30';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--start' && args[i + 1]) {
    startDate = args[i + 1];
    i++;
  } else if (args[i] === '--end' && args[i + 1]) {
    endDate = args[i + 1];
    i++;
  }
}

console.log('🧹 Clean Replay Data Script');
console.log('===========================\n');
console.log(`Date Range: ${startDate} to ${endDate}\n`);

// Connect to SQLite
const dbPath = path.join(__dirname, '../db/sqlite/batching_app.sqlite');
console.log(`📂 Database: ${dbPath}\n`);

let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // Find programs to delete
  console.log('🔍 Finding programs in date range...\n');
  
  const programs = db.prepare(`
    SELECT ps.program_id, p.name as program_name, ps.start_ts, ps.end_ts
    FROM program_stats ps
    LEFT JOIN programs p ON ps.program_id = p.id
    WHERE ps.start_ts >= ? AND ps.start_ts <= ?
    ORDER BY ps.program_id
  `).all(startDate + 'T00:00:00Z', endDate + 'T23:59:59Z');
  
  if (programs.length === 0) {
    console.log('✅ No programs found in this date range. Nothing to delete.\n');
    db.close();
    process.exit(0);
  }
  
  const programIds = programs.map(p => p.program_id);
  
  console.log(`Found ${programs.length} programs to delete:\n`);
  programs.forEach(p => {
    console.log(`  - Program ${p.program_id}: ${p.program_name}`);
    console.log(`    Time: ${new Date(p.start_ts).toLocaleString()} → ${new Date(p.end_ts).toLocaleString()}`);
  });
  console.log('');
  
  // Count related data
  const counts = {
    recipe_stats: db.prepare(`SELECT COUNT(*) as count FROM recipe_stats WHERE program_id IN (${programIds.join(',')})`).get().count,
    gate_dwell_times: db.prepare(`SELECT COUNT(*) as count FROM gate_dwell_times WHERE program_id IN (${programIds.join(',')})`).get().count,
    gate_dwell_accumulators: db.prepare(`SELECT COUNT(*) as count FROM gate_dwell_accumulators WHERE program_id IN (${programIds.join(',')})`).get().count,
    kpi_minute_recipes: db.prepare(`SELECT COUNT(*) as count FROM kpi_minute_recipes WHERE program_id IN (${programIds.join(',')})`).get().count
  };
  
  console.log('Related data to delete:');
  Object.entries(counts).forEach(([table, count]) => {
    console.log(`  - ${table}: ${count} rows`);
  });
  console.log('');
  
  // Confirm with user
  console.log(`\n⚠️  This will DELETE data for ${programIds.length} programs.`);
  console.log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
  
  // Wait 3 seconds then delete
  setTimeout(() => {
    try {
      console.log('🗑️  Deleting data...\n');
      
      // Delete data in transaction
      const deleteTransaction = db.transaction(() => {
        const placeholders = programIds.map(() => '?').join(',');
        
        // Delete from each table
        const deleteCounts = {
          recipe_stats: db.prepare(`DELETE FROM recipe_stats WHERE program_id IN (${placeholders})`).run(...programIds).changes,
          gate_dwell_times: db.prepare(`DELETE FROM gate_dwell_times WHERE program_id IN (${placeholders})`).run(...programIds).changes,
          gate_dwell_accumulators: db.prepare(`DELETE FROM gate_dwell_accumulators WHERE program_id IN (${placeholders})`).run(...programIds).changes,
          kpi_minute_recipes: db.prepare(`DELETE FROM kpi_minute_recipes WHERE program_id IN (${placeholders})`).run(...programIds).changes,
          program_stats: db.prepare(`DELETE FROM program_stats WHERE program_id IN (${placeholders})`).run(...programIds).changes
        };
        
        return deleteCounts;
      });
      
      const deleteCounts = deleteTransaction();
      
      console.log('✅ Deletion complete!\n');
      console.log('Rows deleted:');
      Object.entries(deleteCounts).forEach(([table, count]) => {
        console.log(`  - ${table}: ${count} rows`);
      });
      console.log('');
      
      // Verify
      const remaining = db.prepare(`
        SELECT COUNT(*) as count 
        FROM program_stats 
        WHERE start_ts >= ? AND start_ts <= ?
      `).get(startDate + 'T00:00:00Z', endDate + 'T23:59:59Z');
      
      if (remaining.count === 0) {
        console.log('✅ Verification passed: No replay data remains in date range.\n');
      } else {
        console.log(`⚠️  Warning: ${remaining.count} programs still exist in date range.\n`);
      }
      
      // Show remaining live data
      const liveData = db.prepare(`
        SELECT COUNT(*) as count, MIN(start_ts) as oldest, MAX(start_ts) as newest
        FROM program_stats
      `).get();
      
      if (liveData.count > 0) {
        console.log(`📊 Remaining data: ${liveData.count} programs`);
        console.log(`   Oldest: ${new Date(liveData.oldest).toLocaleString()}`);
        console.log(`   Newest: ${new Date(liveData.newest).toLocaleString()}`);
      } else {
        console.log('📊 Database is now empty (no programs remain)');
      }
      console.log('');
      
    } catch (error) {
      console.error('\n❌ Error during deletion:', error.message);
      console.error(error.stack);
      process.exit(1);
    } finally {
      db.close();
      console.log('✨ Done!\n');
    }
  }, 3000);
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  if (db) db.close();
  process.exit(1);
}
