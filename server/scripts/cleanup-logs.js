#!/usr/bin/env node
/**
 * Log Cleanup Script
 * 
 * Removes log files older than the retention period (default: 30 days).
 * Can be run manually or scheduled via cron.
 * 
 * Usage:
 *   node cleanup-logs.js           # Use default 30 days
 *   node cleanup-logs.js --days=7  # Custom retention period
 *   node cleanup-logs.js --dry-run # Show what would be deleted
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const DEFAULT_RETENTION_DAYS = 30;

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysArg = args.find(a => a.startsWith('--days='));
const retentionDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : DEFAULT_RETENTION_DAYS;

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

console.log(`\n📋 Log Cleanup Script`);
console.log(`   Retention: ${retentionDays} days`);
console.log(`   Cutoff: ${cutoffDate.toISOString()}`);
console.log(`   Mode: ${dryRun ? 'DRY RUN (no files will be deleted)' : 'DELETE'}`);
console.log(`   Directory: ${LOG_DIR}\n`);

if (!fs.existsSync(LOG_DIR)) {
  console.log('⚠️  Log directory does not exist. Nothing to clean.\n');
  process.exit(0);
}

// Find and process log files
const files = fs.readdirSync(LOG_DIR);
let deletedCount = 0;
let deletedBytes = 0;
let keptCount = 0;

for (const file of files) {
  if (!file.endsWith('.log')) continue;
  
  const filePath = path.join(LOG_DIR, file);
  const stats = fs.statSync(filePath);
  
  if (stats.mtime < cutoffDate) {
    if (dryRun) {
      console.log(`   🗑️  Would delete: ${file} (${formatBytes(stats.size)}) - ${stats.mtime.toISOString()}`);
    } else {
      fs.unlinkSync(filePath);
      console.log(`   ✅ Deleted: ${file} (${formatBytes(stats.size)})`);
    }
    deletedCount++;
    deletedBytes += stats.size;
  } else {
    keptCount++;
  }
}

console.log(`\n📊 Summary:`);
console.log(`   Files ${dryRun ? 'to delete' : 'deleted'}: ${deletedCount} (${formatBytes(deletedBytes)})`);
console.log(`   Files kept: ${keptCount}`);
console.log('');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

