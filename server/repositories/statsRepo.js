// server/repositories/statsRepo.js
const db = require('../db/sqlite');

/* ------------ time helper (UTC minute ISO without ms) ------------ */
function toMinuteUTC(ts) {
  const d = ts ? new Date(ts) : new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ---------------------------- WRITERS (optional) ---------------------------- */
/* If Python writes directly to SQLite, you may not use these; still useful for tests. */

function upsertProgramTotals(programId, delta) {
  const {
    total_batches = 0,
    total_batched_weight_g = 0,
    total_reject_weight_g = 0,
    total_giveaway_weight_g = 0,
    total_items_batched = 0,
    total_items_rejected = 0,
  } = delta || {};

  db.prepare(`
    INSERT INTO program_stats
      (program_id, total_batches, total_batched_weight_g, total_reject_weight_g,
       total_giveaway_weight_g, total_items_batched, total_items_rejected, updated_at)
    VALUES (@pid, @tb, @tbtw, @trw, @tg, @tib, @tir, CURRENT_TIMESTAMP)
    ON CONFLICT(program_id) DO UPDATE SET
      total_batches             = total_batches + @tb,
      total_batched_weight_g    = total_batched_weight_g + @tbtw,
      total_reject_weight_g     = total_reject_weight_g + @trw,
      total_giveaway_weight_g   = total_giveaway_weight_g + @tg,
      total_items_batched       = total_items_batched + @tib,
      total_items_rejected      = total_items_rejected + @tir,
      updated_at                = CURRENT_TIMESTAMP
  `).run({
    pid: programId, tb: total_batches, tbtw: total_batched_weight_g,
    trw: total_reject_weight_g, tg: total_giveaway_weight_g,
    tib: total_items_batched, tir: total_items_rejected,
  });
}

function upsertRecipeTotals(programId, recipeId, delta) {
  const {
    total_batches = 0,
    total_batched_weight_g = 0,
    total_reject_weight_g = 0,
    total_giveaway_weight_g = 0,
    total_items_batched = 0,
    total_items_rejected = 0,
  } = delta || {};

  db.prepare(`
    INSERT INTO recipe_stats
      (program_id, recipe_id, total_batches, total_batched_weight_g, total_reject_weight_g,
       total_giveaway_weight_g, total_items_batched, total_items_rejected, updated_at)
    VALUES (@pid, @rid, @tb, @tbtw, @trw, @tg, @tib, @tir, CURRENT_TIMESTAMP)
    ON CONFLICT(program_id, recipe_id) DO UPDATE SET
      total_batches             = total_batches + @tb,
      total_batched_weight_g    = total_batched_weight_g + @tbtw,
      total_reject_weight_g     = total_reject_weight_g + @trw,
      total_giveaway_weight_g   = total_giveaway_weight_g + @tg,
      total_items_batched       = total_items_batched + @tib,
      total_items_rejected      = total_items_rejected + @tir,
      updated_at                = CURRENT_TIMESTAMP
  `).run({
    pid: programId, rid: recipeId, tb: total_batches, tbtw: total_batched_weight_g,
    trw: total_reject_weight_g, tg: total_giveaway_weight_g,
    tib: total_items_batched, tir: total_items_rejected,
  });
}

function upsertProgramMinute(programId, ts_minute, v) {
  const {
    batches_created = 0,
    pieces_processed = 0,
    weight_processed_g = 0,
  } = v || {};
  db.prepare(`
    INSERT INTO program_throughput_minute
      (program_id, ts_minute, batches_created, pieces_processed, weight_processed_g)
    VALUES (@pid, @ts, @bm, @pm, @wm)
    ON CONFLICT(program_id, ts_minute) DO UPDATE SET
      batches_created   = batches_created   + @bm,
      pieces_processed  = pieces_processed  + @pm,
      weight_processed_g= weight_processed_g+ @wm
  `).run({ pid: programId, ts: ts_minute, bm: batches_created, pm: pieces_processed, wm: weight_processed_g });
}

function upsertRecipeMinute(programId, recipeId, ts_minute, v) {
  const {
    batches_created = 0,
    pieces_processed = 0,
    weight_processed_g = 0,
  } = v || {};
  db.prepare(`
    INSERT INTO recipe_throughput_minute
      (program_id, recipe_id, ts_minute, batches_created, pieces_processed, weight_processed_g)
    VALUES (@pid, @rid, @ts, @bm, @pm, @wm)
    ON CONFLICT(program_id, recipe_id, ts_minute) DO UPDATE SET
      batches_created   = batches_created   + @bm,
      pieces_processed  = pieces_processed  + @pm,
      weight_processed_g= weight_processed_g+ @wm
  `).run({ pid: programId, rid: recipeId, ts: ts_minute, bm: batches_created, pm: pieces_processed, wm: weight_processed_g });
}

function updateGateDwell(programId, gateNumber, durationSec) {
  const row = db.prepare(`
    SELECT sample_count, mean_sec, m2_sec, min_sec, max_sec
    FROM gate_dwell_accumulators WHERE program_id=? AND gate_number=?
  `).get(programId, gateNumber);

  const n0 = row ? row.sample_count : 0;
  const mean0 = row ? row.mean_sec : 0;
  const m2_0 = row ? row.m2_sec : 0;
  const min0 = row ? row.min_sec : null;
  const max0 = row ? row.max_sec : null;

  const n1 = n0 + 1;
  const delta = durationSec - mean0;
  const mean1 = mean0 + delta / n1;
  const delta2 = durationSec - mean1;
  const m2_1 = m2_0 + delta * delta2;

  const min1 = (min0 == null) ? durationSec : Math.min(min0, durationSec);
  const max1 = (max0 == null) ? durationSec : Math.max(max0, durationSec);

  db.prepare(`
    INSERT INTO gate_dwell_accumulators
      (program_id, gate_number, sample_count, mean_sec, m2_sec, min_sec, max_sec, updated_at)
    VALUES (@pid, @gate, @n, @mean, @m2, @min, @max, CURRENT_TIMESTAMP)
    ON CONFLICT(program_id, gate_number) DO UPDATE SET
      sample_count = @n,
      mean_sec     = @mean,
      m2_sec       = @m2,
      min_sec      = @min,
      max_sec      = @max,
      updated_at   = CURRENT_TIMESTAMP
  `).run({ pid: programId, gate: gateNumber, n: n1, mean: mean1, m2: m2_1, min: min1, max: max1 });
}

/* ---------------------------- READERS ---------------------------- */
function getProgramSummary(programId) {
  return db.prepare(`SELECT * FROM program_stats_view WHERE program_id = ?`).get(programId);
}
function getRecipeSummaries(programId) {
  return db.prepare(`SELECT * FROM recipe_stats_view WHERE program_id = ? ORDER BY recipe_id`).all(programId);
}
function getThroughputSeries(programId, fromISO, toISO) {
  const program = db.prepare(`
    SELECT ts_minute, batches_created, pieces_processed, weight_processed_g
    FROM program_throughput_minute
    WHERE program_id=? AND ts_minute BETWEEN ? AND ?
    ORDER BY ts_minute
  `).all(programId, fromISO, toISO);

  const recipes = db.prepare(`
    SELECT recipe_id, ts_minute, batches_created, pieces_processed, weight_processed_g
    FROM recipe_throughput_minute
    WHERE program_id=? AND ts_minute BETWEEN ? AND ?
    ORDER BY recipe_id, ts_minute
  `).all(programId, fromISO, toISO);

  return { program, recipes };
}

module.exports = {
  // writers (optional)
  upsertProgramTotals, upsertRecipeTotals,
  upsertProgramMinute, upsertRecipeMinute,
  updateGateDwell,
  // readers
  getProgramSummary, getRecipeSummaries, getThroughputSeries,
  // helper
  toMinuteUTC,
};