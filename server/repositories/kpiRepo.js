// server/repositories/kpiRepo.js
const db = require('../db/sqlite');

/** normalize ts => minute start (Date | ms | ISO) */
function toMinuteStart(ts) {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return new Date(); // fallback now
  return new Date(Math.floor(d.getTime() / 60000) * 60000);
}

// Ensure tables exist (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS kpi_minute_snapshots (
    ts_minute        DATETIME NOT NULL,
    recipe           TEXT NOT NULL,                 -- recipe name or "__combined"
    batches_min      REAL NOT NULL,
    giveaway_pct     REAL NOT NULL,
    rejects_per_min  REAL,
    PRIMARY KEY (ts_minute, recipe)
  );

  CREATE TABLE IF NOT EXISTS kpi_total_snapshots (
    ts                     DATETIME NOT NULL,
    recipe                 TEXT NOT NULL,
    total_batches          REAL NOT NULL,
    giveaway_g_per_batch   REAL NOT NULL,
    giveaway_pct_avg       REAL NOT NULL,
    PRIMARY KEY (ts, recipe)
  );
`);

const upsertMinuteStmt = db.prepare(`
  INSERT INTO kpi_minute_snapshots
    (ts_minute, recipe, batches_min, giveaway_pct, rejects_per_min)
  VALUES
    (@ts_minute, @recipe, @batches_min, @giveaway_pct, @rejects_per_min)
  ON CONFLICT(ts_minute, recipe) DO UPDATE SET
    batches_min = excluded.batches_min,
    giveaway_pct = excluded.giveaway_pct,
    rejects_per_min = excluded.rejects_per_min
`);

const upsertTotalsStmt = db.prepare(`
  INSERT INTO kpi_total_snapshots
    (ts, recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg)
  VALUES
    (@ts, @recipe, @total_batches, @giveaway_g_per_batch, @giveaway_pct_avg)
  ON CONFLICT(ts, recipe) DO UPDATE SET
    total_batches = excluded.total_batches,
    giveaway_g_per_batch = excluded.giveaway_g_per_batch,
    giveaway_pct_avg = excluded.giveaway_pct_avg
`);

function upsertMinute({ ts, recipe, batches_min, giveaway_pct, rejects_per_min }) {
  const ts_minute = toMinuteStart(ts).toISOString();
  upsertMinuteStmt.run({
    ts_minute,
    recipe: String(recipe),
    batches_min: Number(batches_min),
    giveaway_pct: Number(giveaway_pct),
    rejects_per_min: rejects_per_min == null ? null : Number(rejects_per_min),
  });
  return { ok: true, ts_minute };
}

function upsertTotals({ ts, recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg }) {
  const when = new Date(ts).toISOString();
  upsertTotalsStmt.run({
    ts: when,
    recipe: String(recipe),
    total_batches: Number(total_batches),
    giveaway_g_per_batch: Number(giveaway_g_per_batch),
    giveaway_pct_avg: Number(giveaway_pct_avg),
  });
  return { ok: true, ts: when };
}

function historyMinute({ from, to, include = 'all' }) {
  // defaults: last 60 minutes
  let fromD = from ? new Date(from) : new Date(Date.now() - 60 * 60 * 1000);
  let toD = to ? new Date(to) : new Date();

  const params = {
    from: fromD.toISOString(),
    to: toD.toISOString(),
  };

  let sql = `
    SELECT ts_minute, recipe, batches_min, giveaway_pct, rejects_per_min
    FROM kpi_minute_snapshots
    WHERE ts_minute >= @from AND ts_minute <= @to
  `;

  if (include === 'combined') {
    sql += ` AND recipe = "__combined" `;
  } else if (include === 'recipes') {
    sql += ` AND recipe <> "__combined" `;
  }

  sql += ` ORDER BY ts_minute ASC, recipe ASC `;

  return db.prepare(sql).all(params);
}

module.exports = {
  upsertMinute,
  upsertTotals,
  historyMinute,
};