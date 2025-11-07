#!/usr/bin/env node
/**
 * InfluxDB 7-Day Retention Policy
 * 
 * Expert recommendation: Keep only 7 days of raw M1/M2 data in InfluxDB for fast queries.
 * Older data should be archived to SQLite for permanent storage.
 * 
 * Run this script weekly via cron or manually:
 *   node scripts/cleanup-influx-retention.js
 * 
 * For production, add to crontab:
 *   0 2 * * 0 cd /path/to/hmi/server && node scripts/cleanup-influx-retention.js
 */

require('dotenv').config();
const { InfluxDBClient } = require('@influxdata/influxdb3-client');

const host = process.env.INFLUXDB3_HOST_URL || 'http://127.0.0.1:8181';
const database = process.env.INFLUXDB3_DATABASE || 'batching';
const token = process.env.INFLUXDB3_AUTH_TOKEN;

if (!token) {
  console.error('ERROR: INFLUXDB3_AUTH_TOKEN not set');
  console.error('Run: source .influxdb3/env');
  process.exit(1);
}

const client = new InfluxDBClient({ host, token, database });

const RETENTION_DAYS = 7; // Keep last 7 days only
const MEASUREMENTS = ['pieces', 'gate_state']; // M1/M2 only (M3/M4 are in SQLite)

async function deleteOldData() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const cutoffMs = cutoffDate.getTime();
  
  console.log('\n🧹 InfluxDB Retention Cleanup');
  console.log(`   Retention: ${RETENTION_DAYS} days`);
  console.log(`   Cutoff: ${cutoffDate.toISOString()}`);
  console.log(`   Measurements: ${MEASUREMENTS.join(', ')}\n`);
  
  for (const measurement of MEASUREMENTS) {
    try {
      // Count data before deletion
      const countBeforeSql = `
        SELECT COUNT(*) as count 
        FROM ${measurement} 
        WHERE EXTRACT(EPOCH FROM time) * 1000 < ${cutoffMs}
      `;
      
      console.log(`📊 Checking ${measurement}...`);
      const countBeforeIterator = await client.query(countBeforeSql);
      let countBefore = 0;
      for await (const row of countBeforeIterator) {
        countBefore = Number(row.count);
      }
      
      if (countBefore === 0) {
        console.log(`   ✅ No old data to delete (all data is recent)\n`);
        continue;
      }
      
      console.log(`   🗑️  Deleting ${countBefore.toLocaleString()} rows older than ${RETENTION_DAYS} days...`);
      
      // InfluxDB 3.0 Core: Delete by predicate
      // Note: This may not be available in all Core builds
      // If unavailable, you'll need to use Enterprise or manually manage Parquet files
      const deleteSql = `
        DELETE FROM ${measurement} 
        WHERE EXTRACT(EPOCH FROM time) * 1000 < ${cutoffMs}
      `;
      
      try {
        await client.query(deleteSql);
        console.log(`   ✅ Deleted successfully\n`);
      } catch (deleteErr) {
        if (deleteErr.message.includes('not supported') || deleteErr.message.includes('DELETE')) {
          console.warn(`   ⚠️  DELETE not supported in InfluxDB 3.0 Core`);
          console.warn(`   💡 Manual cleanup required: Delete old Parquet files in .influxdb3/`);
          console.warn(`      Or upgrade to InfluxDB Cloud/Enterprise for automatic retention\n`);
        } else {
          throw deleteErr;
        }
      }
      
    } catch (err) {
      console.error(`   ❌ Error processing ${measurement}:`, err.message);
    }
  }
  
  console.log('✅ Cleanup complete!\n');
  client.close();
}

// Alternative: Manual Parquet file cleanup (for Core without DELETE support)
async function manualCleanup() {
  const fs = require('fs');
  const path = require('path');
  
  console.log('\n🔧 Manual Parquet Cleanup (InfluxDB 3.0 Core)');
  console.log(`   Retention: ${RETENTION_DAYS} days\n`);
  
  const dbDir = path.join(__dirname, '../../.influxdb3');
  
  if (!fs.existsSync(dbDir)) {
    console.error('❌ InfluxDB data directory not found:', dbDir);
    return;
  }
  
  // Find Parquet files older than retention period
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  
  console.log('🔍 Scanning for old Parquet files...');
  
  // Walk through InfluxDB data directory
  function findOldFiles(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    let deleted = 0;
    
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        // Check if directory name is a date (YYYY-MM-DD format)
        if (/^\d{4}-\d{2}-\d{2}$/.test(file.name)) {
          const dirDate = new Date(file.name);
          if (dirDate < cutoffDate) {
            console.log(`   🗑️  Deleting old partition: ${file.name}/`);
            fs.rmSync(fullPath, { recursive: true, force: true });
            deleted++;
            continue;
          }
        }
        // Recurse into subdirectories
        deleted += findOldFiles(fullPath);
      } else if (file.name.endsWith('.parquet')) {
        const stats = fs.statSync(fullPath);
        if (stats.mtime < cutoffDate) {
          console.log(`   🗑️  ${fullPath}`);
          fs.unlinkSync(fullPath);
          deleted++;
        }
      }
    }
    
    return deleted;
  }
  
  const deleted = findOldFiles(dbDir);
  
  if (deleted === 0) {
    console.log('   ✅ No old files found (all data is recent)\n');
  } else {
    console.log(`\n✅ Deleted ${deleted} old partitions/files\n`);
    console.log('⚠️  Restart InfluxDB to fully reclaim space');
    console.log('   ./server/start-influx-quiet.sh\n');
  }
}

// Main execution
(async () => {
  const mode = process.argv[2];
  
  if (mode === '--manual') {
    await manualCleanup();
  } else {
    console.log('💡 Attempting automatic deletion (requires DELETE support)...\n');
    await deleteOldData();
    console.log('💡 If automatic deletion failed, run with --manual flag:');
    console.log('   node scripts/cleanup-influx-retention.js --manual\n');
  }
})();

