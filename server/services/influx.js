// server/services/influx.js
// InfluxDB 3 helper using the official Node SDK (no hardcoded HTTP paths)

const { InfluxDBClient } = require('@influxdata/influxdb3-client');

// --- env ----------------------------------------------------------------
const host = process.env.INFLUXDB3_HOST_URL || 'http://127.0.0.1:8181';
const token = process.env.INFLUXDB3_AUTH_TOKEN;           // do NOT hardcode a token here
const database = process.env.INFLUXDB3_DATABASE || 'batching';

if (!token) {
  console.warn('[influx] INFLUXDB3_AUTH_TOKEN is not set. Source .influxdb3/env before running.');
}

const client = new InfluxDBClient({ host, token, database });

// --- basic health --------------------------------------------------------
async function ping() {
  try {
    // SDK has no ping function; simple HEAD on /health works
    const res = await fetch(`${host}/health`).catch(() => null);
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

// --- line protocol helpers (we keep these for the M1–M5 writers) --------
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

// --- query & write via SDK ----------------------------------------------
async function query(/* sql */) {
  throw new Error('Influx query is not available on this local build. Use SSE/REST-backed data for the HMI, or point env to InfluxDB Cloud for queries.');
}
async function writeLineProtocol(lines) {
  const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
  await client.write(body); // SDK takes LP text directly
  return 'ok';
}
async function writePoint({ measurement, tags, fields, timestamp }) {
  const lp = toLineProtocol({ measurement, tags, fields, timestamp });
  return writeLineProtocol(lp);
}

// --- M1..M5 convenience writers -----------------------------------------
async function writePiece({ piece_id, weight_g, ts }) {
  return writePoint({
    measurement: 'pieces',
    tags: piece_id ? { piece_id } : {},
    fields: { weight_g: Number(weight_g) },
    timestamp: ts,
  });
}

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

// Per-recipe per-minute metrics (and we’ll also provide a combined variant)
async function writeKpiMinute({ recipe, batches_min, giveaway_pct, rejects_per_min, ts }) {
  const fields = {
    batches_min: Number(batches_min),
    giveaway_pct: Number(giveaway_pct),
  };
  if (rejects_per_min != null) fields.rejects_per_min = Number(rejects_per_min);

  return writePoint({
    measurement: 'kpi_minute',
    tags: { recipe: String(recipe) },
    fields,
    timestamp: ts,
  });
}

// UI “white line” totals/averages
async function writeKpiMinuteCombined({ batches_min, giveaway_pct, rejects_per_min, ts }) {
  return writeKpiMinute({
    recipe: '__combined',
    batches_min,
    giveaway_pct,
    rejects_per_min,
    ts,
  });
}

async function writeKpiTotals({ recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg, ts }) {
  return writePoint({
    measurement: 'kpi_totals',
    tags: { recipe: String(recipe) },
    fields: {
      total_batches: Number(total_batches),
      giveaway_g_per_batch: Number(giveaway_g_per_batch),
      giveaway_pct_avg: Number(giveaway_pct_avg),
    },
    timestamp: ts,
  });
}

async function writeAssignment({ piece_id, gate, recipe, ts }) {
  return writePoint({
    measurement: 'assignments',
    tags: {
      ...(piece_id ? { piece_id: String(piece_id) } : {}),
      ...(gate != null ? { gate: String(gate) } : {}),
      ...(recipe ? { recipe: String(recipe) } : {}),
    },
    fields: { assigned: 1 },
    timestamp: ts,
  });
}

module.exports = {
  // config
  host, token, database,
  // basics
  ping, query, writeLineProtocol, writePoint,
  // M1..M5
  writePiece,
  writeGateState,
  writeKpiMinute,
  writeKpiMinuteCombined,
  writeKpiTotals,
  writeAssignment,
};