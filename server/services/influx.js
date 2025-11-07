// server/services/influx.js
// InfluxDB 3 helper using the official Node SDK for WRITES (Line Protocol)
// + a small set of Flight SQL query helpers used by the API routes.

const { InfluxDBClient } = require('@influxdata/influxdb3-client');

// --- env ----------------------------------------------------------------
const host = process.env.INFLUXDB3_HOST_URL || 'http://127.0.0.1:8181';
const token = process.env.INFLUXDB3_AUTH_TOKEN;
const database = process.env.INFLUXDB3_DATABASE || 'batching';

if (!token) {
  console.warn('[influx] INFLUXDB3_AUTH_TOKEN is not set. Source server/.influxdb3/env before running.');
}

// Single client used for Line Protocol writes and Flight SQL queries.
const client = new InfluxDBClient({ host, token, database });

// --- basic health --------------------------------------------------------
async function ping() {
  try {
    const res = await fetch(`${host}/health`).catch(() => null);
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

// --- line protocol helpers ----------------------------------------------
function escKey(s)     { return String(s).replace(/ /g,'\\ ').replace(/,/g,'\\,').replace(/=/g,'\\='); }
function escTagVal(s)  { return String(s).replace(/ /g,'\\ ').replace(/,/g,'\\,').replace(/=/g,'\\='); }
function escFieldStr(s){ return `"${String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`; }

function toNanos(ts) {
  if (ts == null) return undefined;
  if (typeof ts === 'number') {
    if (ts > 1e12) return Math.floor(ts * 1e6);   // ms -> ns
    if (ts > 1e9)  return Math.floor(ts * 1e9);   // s  -> ns
    return Math.floor(ts * 1e6);
  }
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms * 1e6);
}

function toLineProtocol({ measurement, tags = {}, fields = {}, timestamp }) {
  if (!measurement) throw new Error('measurement required');
  const meas = escKey(measurement);

  const tagPairs = Object.entries(tags)
    .filter(([,v]) => v !== undefined && v !== null && v !== '')
    .map(([k,v]) => `${escKey(k)}=${escTagVal(v)}`)
    .join(',');

  function formatNumberField(key, v) {
    // Mark known integer fields with 'i'
    const INT_KEYS = new Set([
      'pieces_in_gate',
      'total_batches',
      'pieces_processed',
      'total_rejects_count',
    ]);

    if (!Number.isFinite(v)) {
      // reject NaN/Infinity immediately so we don't send a bad batch
      throw new Error(`invalid numeric for ${key}: ${v}`);
    }

    if (INT_KEYS.has(key)) {
      return `${escKey(key)}=${Math.trunc(v)}i`;
    }

    // Force floats to actually look like floats (avoid integer-looking floats)
    const asFloat = (v % 1 === 0) ? `${v}.0` : String(v);
    return `${escKey(key)}=${asFloat}`;
  }

  const fieldPairs = Object.entries(fields)
    .filter(([,v]) => v !== undefined && v !== null)
    .map(([k,v]) => {
      if (typeof v === 'number') return formatNumberField(k, v);
      if (typeof v === 'boolean') return `${escKey(k)}=${v ? 'true' : 'false'}`;
      // strings stay strings
      return `${escKey(k)}=${escFieldStr(v)}`;
    })
    .join(',');

  if (!fieldPairs) throw new Error('fields required');

  const tagsPart = tagPairs ? `,${tagPairs}` : '';
  const ns = toNanos(timestamp);
  return ns ? `${meas}${tagsPart} ${fieldPairs} ${ns}` : `${meas}${tagsPart} ${fieldPairs}`;
}

// --- write helpers -------------------------------------------------------
async function writeLineProtocol(lines) {
  const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
  await client.write(body);
  return 'ok';
}

async function writePoint({ measurement, tags, fields, timestamp }) {
  const lp = toLineProtocol({ measurement, tags, fields, timestamp });
  return writeLineProtocol(lp);
}

// --- M1..M4 writers ------------------------------------------------------
// M1: pieces — now with piece_id and gate tags
async function writePiece({ piece_id, gate, weight_g, ts }) {
  return writePoint({
    measurement: 'pieces',
    tags: {
      ...(piece_id ? { piece_id: String(piece_id) } : {}),
      ...(gate != null ? { gate: String(gate) } : {}),
    },
    fields: { weight_g: Number(weight_g) },
    timestamp: ts,
  });
}

// M2: gate_state — cumulative rows from your importer
async function writeGateState({ gate, pieces_in_gate, weight_sum_g, ts }) {
  // Ensure pieces_in_gate is a clean integer and weight_sum_g is a clean float
  const pieces = Math.floor(Number(pieces_in_gate ?? 0));
  const weight = Math.round((Number(weight_sum_g ?? 0)) * 10) / 10;
  
  // Validate values
  if (!Number.isFinite(pieces) || !Number.isFinite(weight)) {
    console.error(`❌ [M2 WRITE] Invalid values for gate ${gate}: pieces=${pieces}, weight=${weight}`);
    throw new Error(`Invalid M2 values: pieces=${pieces}, weight=${weight}`);
  }
  
  return writePoint({
    measurement: 'gate_state',
    tags: gate != null ? { gate: String(gate) } : {},
    fields: {
      pieces_in_gate: pieces,
      weight_sum_g: weight,
    },
    timestamp: ts,
  });
}

// M3: per-recipe per-minute KPI
async function writeKpiMinute({
  program,
  recipe,
  batches_min,
  giveaway_pct,
  pieces_processed,    // optional
  weight_processed_g,  // optional
  ts,
}) {
  return writePoint({
    measurement: 'kpi_minute',
    tags: {
      ...(program != null ? { program: String(program) } : {}),
      recipe: String(recipe),
    },
    fields: {
      batches_min: Number(batches_min ?? 0),
      giveaway_pct: Number(giveaway_pct ?? 0),
      pieces_processed: Number(pieces_processed ?? 0),
      weight_processed_g: Number(weight_processed_g ?? 0),
    },
    timestamp: ts,
  });
}

// M3 combined: includes rejects_per_min and cumulative reject tracking
async function writeKpiMinuteCombined({
  program,
  batches_min,
  giveaway_pct,
  rejects_per_min,
  pieces_processed,     // optional
  weight_processed_g,   // optional
  total_rejects_count,  // optional - cumulative reject count
  total_rejects_weight_g, // optional - cumulative reject weight
  ts,
}) {
  return writePoint({
    measurement: 'kpi_minute',
    tags: {
      ...(program != null ? { program: String(program) } : {}),
      recipe: '__combined',
    },
    fields: {
      batches_min: Number(batches_min ?? 0),
      giveaway_pct: Number(giveaway_pct ?? 0),
      rejects_per_min: Number(rejects_per_min ?? 0),
      pieces_processed: Number(pieces_processed ?? 0),
      weight_processed_g: Number(weight_processed_g ?? 0),
      total_rejects_count: Number(total_rejects_count ?? 0),
      total_rejects_weight_g: Number(total_rejects_weight_g ?? 0),
    },
    timestamp: ts,
  });
}

// M4: rolling per-minute totals
async function writeKpiTotals({ program, recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg, ts }) {
  return writePoint({
    measurement: 'kpi_totals',
    tags: {
      ...(program != null ? { program: String(program) } : {}),
      recipe: String(recipe),
    },
    fields: {
      total_batches: Number(total_batches),
      giveaway_g_per_batch: Number(giveaway_g_per_batch),
      giveaway_pct_avg: Number(giveaway_pct_avg),
    },
    timestamp: ts,
  });
}

// --- Helper functions ---------------------------------------------------
// Convert bucket string (e.g., "60s", "5m", "1h") to milliseconds
function parseBucketToMs(bucket) {
  const match = bucket.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid bucket format: ${bucket}`);
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  const multipliers = {
    's': 1000,           // seconds to ms
    'm': 60 * 1000,      // minutes to ms
    'h': 60 * 60 * 1000, // hours to ms
    'd': 24 * 60 * 60 * 1000 // days to ms
  };
  
  return value * multipliers[unit];
}

// --- Flight SQL query helpers -------------------------------------------
// (Used by API routes. Your Influx 3 instance must have Flight SQL enabled.)

async function queryM3ThroughputPerRecipe({ from, to, bucket }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      recipe,
      AVG(batches_min) AS v
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe != '__combined'
    GROUP BY bucket, recipe
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  const byRecipe = {};
  rows.forEach(r => {
    const name = r.recipe;
    if (!byRecipe[name]) byRecipe[name] = [];
    byRecipe[name].push({ t: Number(r.bucket), v: Number(r.v) });
  });
  return byRecipe;
}

async function queryM3GiveawayPerRecipe({ from, to, bucket }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      recipe,
      AVG(giveaway_pct) AS v
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe != '__combined'
    GROUP BY bucket, recipe
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  const byRecipe = {};
  rows.forEach(r => {
    const name = r.recipe;
    if (!byRecipe[name]) byRecipe[name] = [];
    byRecipe[name].push({ t: Number(r.bucket), v: Number(r.v) });
  });
  return byRecipe;
}

async function queryM3PiecesProcessedPerRecipe({ from, to, bucket }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      recipe,
      AVG(pieces_processed) AS v
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe != '__combined'
    GROUP BY bucket, recipe
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  const byRecipe = {};
  rows.forEach(r => {
    const name = r.recipe;
    if (!byRecipe[name]) byRecipe[name] = [];
    byRecipe[name].push({ t: Number(r.bucket), v: Number(r.v) });
  });
  return byRecipe;
}

async function queryM3WeightProcessedPerRecipe({ from, to, bucket }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      recipe,
      AVG(weight_processed_g) AS v
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe != '__combined'
    GROUP BY bucket, recipe
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  const byRecipe = {};
  rows.forEach(r => {
    const name = r.recipe;
    if (!byRecipe[name]) byRecipe[name] = [];
    byRecipe[name].push({ t: Number(r.bucket), v: Number(r.v) });
  });
  return byRecipe;
}

async function queryM3CombinedTotal({ from, to, bucket, field }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      AVG(${field}) AS v
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe = '__combined'
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows.map(r => ({ t: Number(r.bucket), v: Number(r.v) }));
}

async function queryM3CombinedRejects({ from, to, bucket }) {
  // Convert bucket string (e.g. "60s") to milliseconds
  const bucketMs = parseBucketToMs(bucket);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  const sql = `
    SELECT
      (EXTRACT(EPOCH FROM time) * 1000 / ${bucketMs})::BIGINT * ${bucketMs} AS bucket,
      AVG(rejects_per_min) AS rejects_per_min,
      AVG(total_rejects_count) AS total_rejects_count,
      AVG(total_rejects_weight_g) AS total_rejects_weight_g
    FROM kpi_minute
    WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      AND recipe = '__combined'
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows.map(r => ({ 
    t: Number(r.bucket), 
    rejects_per_min: Number(r.rejects_per_min),
    total_rejects_count: Number(r.total_rejects_count),
    total_rejects_weight_g: Number(r.total_rejects_weight_g)
  }));
}

async function queryM1Weights({ from, to, maxPoints = 1000 }) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  // OPTIMIZED: Use sampling with LIMIT to get evenly distributed points
  // Client will handle outlier preservation
  // For 60 min window: ~7K pieces → sample to 2K points with even distribution
  const limit = Math.min(maxPoints * 2, 5000);
  
  // Calculate sample rate to get ~limit points
  // Get total count first to determine stride
  const countSql = `SELECT COUNT(*) as count FROM pieces WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}`;
  const countIterator = await client.query(countSql);
  let totalCount = 0;
  for await (const row of countIterator) {
    totalCount = Number(row.count);
  }
  
  // If total points <= limit, fetch all; otherwise sample
  if (totalCount <= limit) {
    const sql = `
      SELECT weight_g, EXTRACT(EPOCH FROM time) * 1000 AS t
      FROM pieces
      WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} 
        AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      ORDER BY time ASC
    `;
    const iterator = await client.query(sql);
    const rows = [];
    for await (const row of iterator) {
      rows.push(row);
    }
    const pieces = rows.map(r => ({ t: Number(r.t), weight_g: Number(r.weight_g) }));
    return { all: pieces };
  } else {
    // Sample evenly using ROW_NUMBER() to get ~limit points
    const stride = Math.ceil(totalCount / limit);
    const sql = `
      SELECT weight_g, t FROM (
        SELECT weight_g, EXTRACT(EPOCH FROM time) * 1000 AS t, ROW_NUMBER() OVER (ORDER BY time ASC) AS rn
        FROM pieces
        WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} 
          AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      ) sampled
      WHERE rn % ${stride} = 1
      ORDER BY t ASC
    `;
    const iterator = await client.query(sql);
    const rows = [];
    for await (const row of iterator) {
      rows.push(row);
    }
    const pieces = rows.map(r => ({ t: Number(r.t), weight_g: Number(r.weight_g) }));
    return { all: pieces };
  }
}

async function queryM2GateOverlay({ ts, windowSec }) {
  const tsMs = Date.parse(ts);
  const windowMs = windowSec * 1000;
  
  // OPTIMIZED: Get the LATEST value for each gate using window function
  // More efficient than subquery for large datasets
  const sql = `
    SELECT gate, pieces_in_gate AS pieces, weight_sum_g AS grams
    FROM (
      SELECT 
        gate, 
        pieces_in_gate, 
        weight_sum_g,
        ROW_NUMBER() OVER (PARTITION BY gate ORDER BY time DESC) AS rn
      FROM gate_state
      WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${tsMs - windowMs}
        AND EXTRACT(EPOCH FROM time) * 1000 <= ${tsMs}
    ) ranked
    WHERE rn = 1
    ORDER BY gate ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows.map(r => ({
    gate: Number(r.gate),
    pieces: Number(r.pieces || 0),
    grams: Number(r.grams || 0),
  }));
}

async function queryM4Pies({ from, to }) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  
  // Get the LATEST value for each recipe (kpi_totals are cumulative, so we want the most recent value)
  // Use a subquery to find the max time per recipe, then select those rows
  const sql = `
    SELECT
      k.recipe,
      k.total_batches,
      k.giveaway_g_per_batch,
      k.giveaway_pct_avg
    FROM kpi_totals k
    INNER JOIN (
      SELECT recipe, MAX(time) AS max_time
      FROM kpi_totals
      WHERE EXTRACT(EPOCH FROM time) * 1000 >= ${fromMs} AND EXTRACT(EPOCH FROM time) * 1000 <= ${toMs}
      GROUP BY recipe
    ) latest ON k.recipe = latest.recipe AND k.time = latest.max_time
    ORDER BY k.recipe ASC
  `;
  const iterator = await client.query(sql);
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows.map(r => ({
    recipe: r.recipe,
    total_batches: Number(r.total_batches || 0),
    giveaway_g_per_batch: Number(r.giveaway_g_per_batch || 0),
    giveaway_pct_avg: Number(r.giveaway_pct_avg || 0),
  }));
}

// --- (Optional) Flux query string builders -------------------------------
// Left available if you later enable a Flux-capable endpoint.
function buildQueryPieces(startISO, endISO) {
  return `
from(bucket: "${database}")
  |> range(start: ${JSON.stringify(startISO)}, stop: ${JSON.stringify(endISO)})
  |> filter(fn: (r) => r._measurement == "pieces")
  |> keep(columns: ["_time","piece_id","gate","_value"])
  |> rename(columns: {_value: "weight_g"})
`;
}

function buildQueryGateState(startISO, endISO) {
  return `
from(bucket: "${database}")
  |> range(start: ${JSON.stringify(startISO)}, stop: ${JSON.stringify(endISO)})
  |> filter(fn: (r) => r._measurement == "gate_state")
  |> keep(columns: ["_time","gate","pieces_in_gate","weight_sum_g"])
`;
}

// Stub to make it clear Flux execution is not enabled in this build.
async function queryFlux(/* flux */) {
  throw new Error('queryFlux() not enabled. Use Flight SQL helpers above.');
}

// --- generic query helper for custom SQL queries -------------------------
async function query(sql) {
  if (!client) throw new Error('InfluxDB client not initialized');
  return await client.query(sql);
}

// --- exports -------------------------------------------------------------
module.exports = {
  // config & health
  host, token, database, ping,

  // low-level write helpers
  writeLineProtocol, writePoint,

  // writers for your measurements
  writePiece, writeGateState, writeKpiMinute, writeKpiMinuteCombined, writeKpiTotals,

  // Flight SQL query helpers used by routes
  queryM3ThroughputPerRecipe,
  queryM3GiveawayPerRecipe,
  queryM3PiecesProcessedPerRecipe,
  queryM3WeightProcessedPerRecipe,
  queryM3CombinedTotal,
  queryM3CombinedRejects,
  queryM1Weights,
  queryM2GateOverlay,
  queryM4Pies,

  // Generic query helper
  query,

  // optional Flux builders (strings only)
  buildQueryPieces,
  buildQueryGateState,

  // Flux executor stub
  queryFlux,
};