// server/scripts/influx-seed-demo.js
// Seed demo points using @influxdata/influxdb3-client (no HTTP paths)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { InfluxDBClient } = require('@influxdata/influxdb3-client');

const host = process.env.INFLUXDB3_HOST_URL || 'http://127.0.0.1:8181';
const token = process.env.INFLUXDB3_AUTH_TOKEN;
const database = process.env.INFLUXDB3_DATABASE || 'batching';

if (!token) {
  console.error('INFLUXDB3_AUTH_TOKEN is not set. Source .influxdb3/env first.');
  process.exit(1);
}

const client = new InfluxDBClient({ host, token, database });

// helpers ---------------------------------------------------------
const esc = (s) => String(s).replace(/ /g, '\\ ').replace(/,/g, '\\,').replace(/=/g, '\\=');
const esv = (s) => String(s).replace(/ /g, '\\ ').replace(/,/g, '\\,').replace(/=/g, '\\=');
const nowNs = () => BigInt(Date.now()) * 1000000n;
const tsShiftNs = (minsAgo) => nowNs() - BigInt(minsAgo) * 60n * 1000000000n;

function lp(measurement, tags, fields, tsNs) {
  const tagStr = Object.entries(tags || {})
    .filter(([,v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${esc(k)}=${esv(v)}`).join(',');
  const fieldStr = Object.entries(fields || {})
    .filter(([,v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const k2 = esc(k);
      if (typeof v === 'number' && Number.isFinite(v)) return `${k2}=${v}`;
      if (typeof v === 'boolean') return `${k2}=${v ? 'true' : 'false'}`;
      return `${k2}="${String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
    }).join(',');
  const tagsPart = tagStr ? `,${tagStr}` : '';
  return tsNs != null ? `${esc(measurement)}${tagsPart} ${fieldStr} ${tsNs}` 
                      : `${esc(measurement)}${tagsPart} ${fieldStr}`;
}

async function main() {
  try {
    const lines = [];

    // --- M1: pieces (5 samples)
    for (let i = 0; i < 5; i++) {
      lines.push(lp('pieces', { piece_id: `p-${1000+i}` }, { weight_g: 20 + i }, tsShiftNs(5 - i)));
    }

    // --- M2: gate_state (eight gates right now)
    for (let g = 1; g <= 8; g++) {
      lines.push(lp('gate_state', { gate: String(g) }, { pieces_in_gate: 2+g, weight_sum_g: 100+g*5 }, nowNs()));
    }

    // --- M3: kpi_minute (per recipe + combined)
    const recipes = ['Program A','Program B','Program C','Program D'];
    for (const r of recipes) {
      lines.push(lp('kpi_minute', { recipe: r }, {
        batches_min: 10 + Math.random()*5,
        giveaway_pct: 0.5 + Math.random()*1.0,
        rejects_per_min: 3 + Math.random()*2
      }, nowNs()));
    }
    // combined line for UI “white” totals
    lines.push(lp('kpi_minute', { recipe: '__combined' }, {
      batches_min_sum: 50 + Math.random()*10,
      giveaway_pct_avg: 1.1 + Math.random()*0.3,
      rejects_per_min: 7 + Math.random()*2
    }, nowNs()));

    // --- M4: kpi_totals (per recipe)
    for (const r of recipes) {
      lines.push(lp('kpi_totals', { recipe: r }, {
        total_batches: 100 + Math.floor(Math.random()*20),
        giveaway_g_per_batch: 5 + Math.random()*2,
        giveaway_pct_avg: 1.1 + Math.random()*0.3,
      }, nowNs()));
    }

    // --- M5: assignments (a few)
    lines.push(lp('assignments', { piece_id: 'p-2001', gate: '3', recipe: 'Program B' }, { assigned: 1 }, nowNs()));
    lines.push(lp('assignments', { piece_id: 'p-2002', gate: '1', recipe: 'Program A' }, { assigned: 1 }, nowNs()));

    await client.write(lines.join('\n'));
    console.log(`Seeded ${lines.length} points into ${database} @ ${host}`);
  } catch (e) {
    console.error('Seed error:', e.message || e);
    process.exit(1);
  } finally {
    if (client.close) client.close();
  }
}

main();