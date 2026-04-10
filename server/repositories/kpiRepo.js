// server/repositories/kpiRepo.js
// Query M3 (KPI minute) and M4 (KPI totals) data from SQLite
// These were moved from InfluxDB to SQLite for better performance

const db = require('../db/sqlite');

/**
 * Convert SQLite timestamp to milliseconds since epoch
 * @param {string} ts - ISO 8601 timestamp
 * @returns {number} Milliseconds since epoch
 */
function toEpochMs(ts) {
  return new Date(ts).getTime();
}

/**
 * Get M3 throughput (batches/min) per recipe
 * Returns: { perRecipe: { recipe: [{t, v}] }, total: [{t, v}] }
 * Note: t is returned as milliseconds since epoch to match InfluxDB format
 */
function getM3ThroughputPerRecipe({ from, to }) {
  // Per-recipe data
  const perRecipeRows = db.prepare(`
    SELECT recipe_name, timestamp, batches_min
    FROM kpi_minute_recipes
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const perRecipe = {};
  perRecipeRows.forEach(row => {
    if (!perRecipe[row.recipe_name]) {
      perRecipe[row.recipe_name] = [];
    }
    perRecipe[row.recipe_name].push({
      t: toEpochMs(row.timestamp),
      v: Number(row.batches_min)
    });
  });
  
  // Total (combined) data
  const totalRows = db.prepare(`
    SELECT timestamp, batches_min
    FROM kpi_minute_combined
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const total = totalRows.map(row => ({
    t: toEpochMs(row.timestamp),
    v: Number(row.batches_min)
  }));
  
  return { perRecipe, total };
}

/**
 * Get M3 giveaway (%) per recipe
 * Returns: { perRecipe: { recipe: [{t, v}] }, total: [{t, v}] }
 * Note: t is returned as milliseconds since epoch to match InfluxDB format
 */
function getM3GiveawayPerRecipe({ from, to }) {
  // Per-recipe data
  const perRecipeRows = db.prepare(`
    SELECT recipe_name, timestamp, giveaway_pct
    FROM kpi_minute_recipes
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const perRecipe = {};
  perRecipeRows.forEach(row => {
    if (!perRecipe[row.recipe_name]) {
      perRecipe[row.recipe_name] = [];
    }
    perRecipe[row.recipe_name].push({
      t: toEpochMs(row.timestamp),
      v: Number(row.giveaway_pct)
    });
  });
  
  // Total (combined) data
  const totalRows = db.prepare(`
    SELECT timestamp, giveaway_pct
    FROM kpi_minute_combined
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const total = totalRows.map(row => ({
    t: toEpochMs(row.timestamp),
    v: Number(row.giveaway_pct)
  }));
  
  return { perRecipe, total };
}

/**
 * Get M3 pieces processed per recipe
 * Returns: { perRecipe: { recipe: [{t, v}] }, total: [{t, v}] }
 * Note: t is returned as milliseconds since epoch to match InfluxDB format
 */
function getM3PiecesProcessedPerRecipe({ from, to }) {
  // Per-recipe data
  const perRecipeRows = db.prepare(`
    SELECT recipe_name, timestamp, pieces_processed
    FROM kpi_minute_recipes
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const perRecipe = {};
  perRecipeRows.forEach(row => {
    if (!perRecipe[row.recipe_name]) {
      perRecipe[row.recipe_name] = [];
    }
    perRecipe[row.recipe_name].push({
      t: toEpochMs(row.timestamp),
      v: Number(row.pieces_processed)
    });
  });
  
  // Total (combined) data
  const totalRows = db.prepare(`
    SELECT timestamp, pieces_processed
    FROM kpi_minute_combined
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const total = totalRows.map(row => ({
    t: toEpochMs(row.timestamp),
    v: Number(row.pieces_processed)
  }));
  
  return { perRecipe, total };
}

/**
 * Get M3 weight processed (g) per recipe
 * Returns: { perRecipe: { recipe: [{t, v}] }, total: [{t, v}] }
 * Note: t is returned as milliseconds since epoch to match InfluxDB format
 */
function getM3WeightProcessedPerRecipe({ from, to }) {
  // Per-recipe data
  const perRecipeRows = db.prepare(`
    SELECT recipe_name, timestamp, weight_processed_g
    FROM kpi_minute_recipes
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const perRecipe = {};
  perRecipeRows.forEach(row => {
    if (!perRecipe[row.recipe_name]) {
      perRecipe[row.recipe_name] = [];
    }
    perRecipe[row.recipe_name].push({
      t: toEpochMs(row.timestamp),
      v: Number(row.weight_processed_g)
    });
  });
  
  // Total (combined) data
  const totalRows = db.prepare(`
    SELECT timestamp, weight_processed_g
    FROM kpi_minute_combined
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  const total = totalRows.map(row => ({
    t: toEpochMs(row.timestamp),
    v: Number(row.weight_processed_g)
  }));
  
  return { perRecipe, total };
}

/**
 * Get M3 rejects (combined total only)
 * Returns: [{ t, v, total_rejects_count, total_rejects_weight_g }]
 * Note: t is returned as milliseconds since epoch to match InfluxDB format
 */
function getM3CombinedRejects({ from, to }) {
  const rows = db.prepare(`
    SELECT timestamp, rejects_per_min, total_rejects_count, total_rejects_weight_g
    FROM kpi_minute_combined
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
  
  return rows.map(row => ({
    t: toEpochMs(row.timestamp),
    v: Number(row.rejects_per_min),
    total_rejects_count: Number(row.total_rejects_count),
    total_rejects_weight_g: Number(row.total_rejects_weight_g)
  }));
}

/**
 * Get M3 combined data (for all KPIs at once)
 * Returns: { throughput, giveaway, piecesProcessed, weightProcessed }
 */
function getM3AllCombined({ from, to }) {
  return {
    throughput: getM3ThroughputPerRecipe({ from, to }),
    giveaway: getM3GiveawayPerRecipe({ from, to }),
    piecesProcessed: getM3PiecesProcessedPerRecipe({ from, to }),
    weightProcessed: getM3WeightProcessedPerRecipe({ from, to })
  };
}

/**
 * Get M4 pie chart data (totals per recipe)
 * Returns: [{ recipe, total_batches, giveaway_g_per_batch, giveaway_pct_avg }]
 */
function getM4Pies({ from, to }) {
  // Get the LATEST value for each recipe within the time range
  // This gives us the cumulative totals as of the 'to' timestamp
  const rows = db.prepare(`
    SELECT DISTINCT
      recipe_name,
      total_batches,
      giveaway_g_per_batch,
      giveaway_pct_avg
    FROM kpi_totals
    WHERE timestamp >= ? AND timestamp <= ?
      AND timestamp = (
        SELECT MAX(timestamp)
        FROM kpi_totals kt2
        WHERE kt2.recipe_name = kpi_totals.recipe_name
          AND kt2.timestamp >= ?
          AND kt2.timestamp <= ?
      )
    ORDER BY recipe_name ASC
  `).all(from, to, from, to);
  
  return rows.map(row => ({
    recipe: row.recipe_name,
    total_batches: Number(row.total_batches),
    giveaway_g_per_batch: Number(row.giveaway_g_per_batch),
    giveaway_pct_avg: Number(row.giveaway_pct_avg)
  }));
}

/**
 * Get giveaway data from batch_completions scoped per-recipe.
 * Uses order_id when available (accurate for order-based recipes),
 * falls back to recipe name only (all batches for that recipe).
 * @param {Array<{recipe: string, orderId?: number}>} recipeOrders
 */
function getM4PiesCumulative(recipeOrders) {
  if (!recipeOrders || recipeOrders.length === 0) return [];

  const machineRow = db.prepare('SELECT current_program_id FROM machine_state WHERE id = 1').get();
  const programId = machineRow?.current_program_id;

  const results = [];
  for (const { recipe, orderId } of recipeOrders) {
    // Strategy 1: Use recipe_stats (Python worker's correct calculation)
    let row;
    if (programId) {
      if (orderId) {
        row = db.prepare(`
          SELECT rs.total_batches, rs.total_giveaway_weight_g, rs.total_batched_weight_g
          FROM recipe_stats rs
          JOIN recipes r ON r.id = rs.recipe_id
          WHERE rs.program_id = ? AND r.name = ? AND rs.order_id = ?
        `).get(programId, recipe, orderId);
      }
      if (!row) {
        row = db.prepare(`
          SELECT SUM(rs.total_batches) AS total_batches,
                 SUM(rs.total_giveaway_weight_g) AS total_giveaway_weight_g,
                 SUM(rs.total_batched_weight_g) AS total_batched_weight_g
          FROM recipe_stats rs
          JOIN recipes r ON r.id = rs.recipe_id
          WHERE rs.program_id = ? AND r.name = ?
        `).get(programId, recipe);
      }
    }

    if (row && row.total_batches) {
      const totalBatches = Number(row.total_batches);
      const totalGiveawayG = Number(row.total_giveaway_weight_g || 0);
      const totalBatchedG = Number(row.total_batched_weight_g || 0);
      const giveawayGPerBatch = totalBatches > 0 ? totalGiveawayG / totalBatches : 0;
      const totalActualG = totalBatchedG + totalGiveawayG;
      const giveawayPct = totalActualG > 0 ? (totalGiveawayG / totalActualG) * 100 : 0;
      results.push({
        recipe, total_batches: totalBatches,
        giveaway_g_per_batch: Number(giveawayGPerBatch.toFixed(1)),
        giveaway_pct_avg: Number(giveawayPct.toFixed(2)),
      });
      continue;
    }

    // Strategy 2: Fall back to batch_completions with per-piece target calculation
    // target_weight = SUM(pieces) * piece_min_weight  (same as Python worker for exact/min types)
    let bcRow;
    if (orderId) {
      bcRow = db.prepare(`
        SELECT COUNT(bc.id) AS total_batches,
               SUM(bc.weight_g) AS total_weight_g,
               SUM(bc.pieces) AS total_pieces,
               r.piece_min_weight_g
        FROM batch_completions bc
        JOIN recipes r ON r.id = bc.recipe_id
        WHERE r.name = ? AND bc.order_id = ? AND bc.status = 'completed'
        GROUP BY r.name
      `).get(recipe, orderId);
    }
    if (!bcRow) {
      bcRow = db.prepare(`
        SELECT COUNT(bc.id) AS total_batches,
               SUM(bc.weight_g) AS total_weight_g,
               SUM(bc.pieces) AS total_pieces,
               r.piece_min_weight_g
        FROM batch_completions bc
        JOIN recipes r ON r.id = bc.recipe_id
        WHERE r.name = ? AND bc.status = 'completed'
        GROUP BY r.name
      `).get(recipe);
    }

    if (!bcRow || !bcRow.total_batches) {
      results.push({ recipe, total_batches: 0, giveaway_g_per_batch: 0, giveaway_pct_avg: 0 });
      continue;
    }

    const totalBatches = Number(bcRow.total_batches);
    const totalWeightG = Number(bcRow.total_weight_g || 0);
    const totalPieces = Number(bcRow.total_pieces || 0);
    const pieceMinWeight = Number(bcRow.piece_min_weight_g || 0);
    const targetTotal = pieceMinWeight * totalPieces;
    const giveawayG = targetTotal > 0 ? Math.max(0, totalWeightG - targetTotal) : 0;
    const giveawayGPerBatch = totalBatches > 0 ? giveawayG / totalBatches : 0;
    const giveawayPct = targetTotal > 0 ? (giveawayG / (targetTotal + giveawayG)) * 100 : 0;

    results.push({
      recipe, total_batches: totalBatches,
      giveaway_g_per_batch: Number(giveawayGPerBatch.toFixed(1)),
      giveaway_pct_avg: Number(giveawayPct.toFixed(2)),
    });
  }
  return results;
}

module.exports = {
  getM3ThroughputPerRecipe,
  getM3GiveawayPerRecipe,
  getM3PiecesProcessedPerRecipe,
  getM3WeightProcessedPerRecipe,
  getM3CombinedRejects,
  getM3AllCombined,
  getM4Pies,
  getM4PiesCumulative
};
