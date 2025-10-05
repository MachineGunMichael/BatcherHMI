// server/services/influx.js
// InfluxDB 3 helper using the official Node SDK for WRITES (Line Protocol).
// We also export Flux query builders for convenience, but do not execute them here.

const { InfluxDBClient } = require('@influxdata/influxdb3-client');

// --- env ----------------------------------------------------------------
const host = process.env.INFLUXDB3_HOST_URL || 'http://127.0.0.1:8181';
const token = process.env.INFLUXDB3_AUTH_TOKEN;   // do NOT hardcode a token here
const database = process.env.INFLUXDB3_DATABASE || 'batching';

if (!token) {
  console.warn('[influx] INFLUXDB3_AUTH_TOKEN is not set. Source server/.influxdb3/env before running.');
}

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

  const fieldPairs = Object.entries(fields)
    .filter(([,v]) => v !== undefined && v !== null)
    .map(([k,v]) => {
      const key = escKey(k);
      if (typeof v === 'number' && Number.isFinite(v)) return `${key}=${v}`;
      if (typeof v === 'boolean') return `${key}=${v ? 'true' : 'false'}`;
      return `${key}=${escFieldStr(v)}`;
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

// --- M1..M5 writers ------------------------------------------------------
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

// M2: gate_state — cumulative rows produced by Python importer.
// This writer is here in case you need to write from Node as well.
async function writeGateState({ gate, pieces_in_gate, weight_sum_g, ts }) {
  return writePoint({
    measurement: 'gate_state',
    tags: gate != null ? { gate: String(gate) } : {},
    fields: {
      pieces_in_gate: Number(pieces_in_gate ?? 0),
      weight_sum_g: Number(weight_sum_g ?? 0),
    },
    timestamp: ts,
  });
}

// M3: per-recipe per-minute KPI (no rejects_per_min here), program tagged
async function writeKpiMinute({
  program,
  recipe,
  batches_min,
  giveaway_pct,
  pieces_processed,    // NEW (optional)
  weight_processed_g,  // NEW (optional)
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
      // new fields; kept optional so existing callers don't break
      pieces_processed: Number(pieces_processed ?? 0),
      weight_processed_g: Number(weight_processed_g ?? 0),
    },
    timestamp: ts,
  });
}

// M3 combined: includes rejects_per_min + the two NEW fields, program tagged
async function writeKpiMinuteCombined({
  program,
  batches_min,
  giveaway_pct,
  rejects_per_min,
  pieces_processed,     // NEW (optional)
  weight_processed_g,   // NEW (optional)
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
      // new fields; optional and default to 0
      pieces_processed: Number(pieces_processed ?? 0),
      weight_processed_g: Number(weight_processed_g ?? 0),
    },
    timestamp: ts,
  });
}

// M4: rolling per-minute totals, program tagged
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

// M5: assignments REMOVED - now stored in SQLite only
// (see run_config_assignments and settings_history tables)
// Use /api/settings routes to manage configurations

// --- OPTIONAL: Flux query builders (strings only) ------------------------
// Use these in your route/controllers when you're ready to enable queries.
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

function buildQueryRecipeKpiMinute(startISO, endISO, programId) {
  return `
from(bucket: "${database}")
  |> range(start: ${JSON.stringify(startISO)}, stop: ${JSON.stringify(endISO)})
  |> filter(fn: (r) => r._measurement == "kpi_minute" and r.program == "${String(programId)}" and r.recipe != "__combined")
  |> keep(columns: ["_time","program","recipe","batches_min","giveaway_pct","pieces_processed","weight_processed_g"])
`;
}

function buildQueryCombinedKpiMinute(startISO, endISO, programId) {
  return `
from(bucket: "${database}")
  |> range(start: ${JSON.stringify(startISO)}, stop: ${JSON.stringify(endISO)})
  |> filter(fn: (r) => r._measurement == "kpi_minute" and r.program == "${String(programId)}" and r.recipe == "__combined")
  |> keep(columns: ["_time","program","recipe","batches_min","giveaway_pct","rejects_per_min","pieces_processed","weight_processed_g"])
`;
}

function buildQueryKpiTotalsRolling(startISO, endISO, programId) {
  return `
from(bucket: "${database}")
  |> range(start: ${JSON.stringify(startISO)}, stop: ${JSON.stringify(endISO)})
  |> filter(fn: (r) => r._measurement == "kpi_totals" and r.program == "${String(programId)}")
  |> keep(columns: ["_time","program","recipe","total_batches","giveaway_g_per_batch","giveaway_pct_avg"])
`;
}

// buildQueryAssignments REMOVED - assignments now in SQLite only
// Query settings_history and run_config_assignments tables instead

// Placeholder executor — left disabled on purpose.
// If you wire up a Flux-capable endpoint, implement this.
async function queryFlux(/* flux */) {
  throw new Error('queryFlux() not enabled in this build. Provide a Flux endpoint or use Flight SQL for InfluxDB 3.');
}

module.exports = {
  // config
  host, token, database,
  // health
  ping,
  // writes
  writeLineProtocol, writePoint,
  writePiece, writeGateState,
  writeKpiMinute, writeKpiMinuteCombined,
  writeKpiTotals,
  // writeAssignment removed - use SQLite (run_config_assignments + settings_history)
  // query builders
  buildQueryPieces,
  buildQueryGateState,
  buildQueryRecipeKpiMinute,
  buildQueryCombinedKpiMinute,
  buildQueryKpiTotalsRolling,
  // buildQueryAssignments removed - use SQLite instead
  // executor stub
  queryFlux,
};