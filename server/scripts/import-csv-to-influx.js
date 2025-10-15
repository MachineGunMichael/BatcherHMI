#!/usr/bin/env node
// Import CSV files into InfluxDB 3
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
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

const CSV_DIR = path.join(__dirname, '../../python-worker/one_time_output');

// CSV file to measurement mapping
const FILES = [
  { file: 'influx_m1_pieces.csv', measurement: 'pieces', batchSize: 10000 },
  { file: 'influx_m2_gate_state.csv', measurement: 'gate_state', batchSize: 10000 },
  { file: 'influx_m3_kpi_minute_recipes.csv', measurement: 'kpi_minute', batchSize: 5000 },
  { file: 'influx_m3_kpi_minute_combined.csv', measurement: 'kpi_minute', batchSize: 5000 },
  { file: 'influx_m4_kpi_totals.csv', measurement: 'kpi_totals', batchSize: 5000 },
];

async function importCSV(filePath, measurement, batchSize = 1000) {
  const fileName = path.basename(filePath);
  process.stdout.write(`\n📥 Importing ${fileName} into ${measurement}...\n`);
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let headers = null;
  let lines = [];
  let count = 0;
  let errors = 0;
  
  for await (const line of rl) {
    if (!headers) {
      headers = line.split(',').map(h => h.trim());
      continue;
    }
    
    lines.push(line);
    
    if (lines.length >= batchSize) {
      const success = await writeBatch(lines, headers, measurement);
      if (success) {
        count += lines.length;
        process.stdout.write(`  ⏳ ${count} rows imported...\r`);
      } else {
        errors += lines.length;
      }
      lines = [];
    }
  }
  
  // Write remaining lines
  if (lines.length > 0) {
    const success = await writeBatch(lines, headers, measurement);
    if (success) {
      count += lines.length;
    } else {
      errors += lines.length;
    }
  }
  
  process.stdout.write('\n');
  if (errors === 0) {
    console.log(`✅ Successfully imported ${count} rows from ${fileName}`);
  } else {
    console.log(`⚠️  Imported ${count} rows, ${errors} rows failed from ${fileName}`);
  }
}

async function writeBatch(lines, headers, measurement) {
  const lineProtocol = lines.map(line => csvToLineProtocol(line, headers, measurement)).filter(Boolean);
  if (lineProtocol.length === 0) return true;
  
  const batch = lineProtocol.join('\n');
  try {
    await client.write(batch);
    return true;
  } catch (err) {
    console.error(`\n❌ ERROR: Write failed for ${measurement}:`, err.message);
    if (err.body) {
      console.error('   Details:', err.body);
    }
    return false;
  }
}

function csvToLineProtocol(line, headers, measurement) {
  const values = parseCSVLine(line);
  if (values.length !== headers.length) return null;
  
  const row = {};
  headers.forEach((h, i) => { row[h] = values[i]; });
  
  // Determine timestamp column
  const tsCol = headers.find(h => h.includes('ts') || h.includes('time'));
  if (!tsCol || !row[tsCol]) return null;
  
  const timestamp = new Date(row[tsCol]).getTime() * 1000000; // Convert to nanoseconds
  if (isNaN(timestamp)) return null;
  
  // Separate tags and fields based on measurement type
  let tags = {};
  let fields = {};
  
  if (measurement === 'pieces') {
    tags = { 
      ...(row.piece_id ? { piece_id: String(row.piece_id) } : {}),
      ...(row.gate ? { gate: String(row.gate) } : {})
    };
    fields = { weight_g: parseFloat(row.weight_g || 0) };
  } else if (measurement === 'gate_state') {
    tags = { gate: String(row.gate || 0) };
    fields = {
      pieces_in_gate: parseFloat(row.pieces_in_gate || 0),
      weight_sum_g: parseFloat(row.weight_sum_g || 0)
    };
  } else if (measurement === 'kpi_minute') {
    tags = {
      ...(row.program ? { program: String(row.program) } : {}),
      recipe: String(row.recipe || 'unknown')
    };
    fields = {
      batches_min: parseFloat(row.batches_min || 0),
      giveaway_pct: parseFloat(row.giveaway_pct || 0),
      ...(row.rejects_per_min !== undefined ? { rejects_per_min: parseFloat(row.rejects_per_min || 0) } : {}),
      ...(row.pieces_processed !== undefined ? { pieces_processed: parseFloat(row.pieces_processed || 0) } : {}),
      ...(row.weight_processed_g !== undefined ? { weight_processed_g: parseFloat(row.weight_processed_g || 0) } : {}),
      ...(row.total_rejects_count !== undefined ? { total_rejects_count: parseFloat(row.total_rejects_count || 0) } : {}),
      ...(row.total_rejects_weight_g !== undefined ? { total_rejects_weight_g: parseFloat(row.total_rejects_weight_g || 0) } : {})
    };
  } else if (measurement === 'kpi_totals') {
    tags = {
      ...(row.program ? { program: String(row.program) } : {}),
      recipe: String(row.recipe || 'unknown')
    };
    fields = {
      total_batches: parseFloat(row.total_batches || 0),
      giveaway_g_per_batch: parseFloat(row.giveaway_g_per_batch || 0),
      giveaway_pct_avg: parseFloat(row.giveaway_pct_avg || 0)
    };
  }
  
  // Build line protocol
  const tagStr = Object.entries(tags)
    .map(([k, v]) => `${escapeTag(k)}=${escapeTag(v)}`)
    .join(',');
  
  // Fields that should be written as integers (with 'i' suffix)
  const integerFields = ['pieces_in_gate', 'total_rejects_count'];
  
  const fieldStr = Object.entries(fields)
    .map(([k, v]) => {
      // Check if this field should be an integer
      if (integerFields.includes(k) && Number.isInteger(v)) {
        return `${escapeTag(k)}=${v}i`;
      }
      // Otherwise write as float (append .0 if integer value)
      const val = Number.isInteger(v) ? `${v}.0` : v;
      return `${escapeTag(k)}=${val}`;
    })
    .join(',');
  
  const tagsPart = tagStr ? `,${tagStr}` : '';
  return `${measurement}${tagsPart} ${fieldStr} ${timestamp}`;
}

function escapeTag(str) {
  return String(str).replace(/,/g, '\\,').replace(/ /g, '\\ ').replace(/=/g, '\\=');
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function clearAllMeasurements() {
  console.log('🗑️  Clearing all existing data...');
  const measurements = ['pieces', 'gate_state', 'kpi_minute', 'kpi_totals'];
  
  for (const measurement of measurements) {
    try {
      await client.query(`DELETE FROM ${measurement}`);
      console.log(`   ✅ Cleared ${measurement}`);
    } catch (err) {
      console.log(`   ⚠️  Could not clear ${measurement} (may not exist): ${err.message}`);
    }
  }
  console.log('');
}

async function main() {
  console.log('🚀 InfluxDB CSV Import Tool');
  console.log('============================');
  console.log(`📍 Host: ${host}`);
  console.log(`💾 Database: ${database}`);
  console.log(`📁 CSV Directory: ${CSV_DIR}\n`);
  
  // Clear all existing data first
  await clearAllMeasurements();
  
  const startTime = Date.now();
  let totalSuccess = 0;
  let totalFailed = 0;
  
  for (const { file, measurement, batchSize } of FILES) {
    const filePath = path.join(CSV_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }
    
    try {
      await importCSV(filePath, measurement, batchSize);
      totalSuccess++;
    } catch (err) {
      console.error(`❌ Fatal error importing ${file}:`, err.message);
      totalFailed++;
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Import complete in ${duration}s`);
  console.log(`   Successfully imported: ${totalSuccess} files`);
  if (totalFailed > 0) {
    console.log(`   Failed: ${totalFailed} files`);
  }
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  process.exit(1);
});

