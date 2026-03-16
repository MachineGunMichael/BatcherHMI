// server/routes/stats.js
const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { verifyToken } = require('../utils/authMiddleware');
const { query: influxQuery } = require('../services/influx');
const log = require('../lib/logger');
const machineState = require('../services/machineState');

/**
 * GET /api/stats/programs
 * Get all programs with their basic info
 */
router.get('/programs', verifyToken, (req, res) => {
  try {
    const programs = db.prepare(`
      SELECT 
        p.id,
        p.name,
        ps.start_ts,
        ps.end_ts,
        ps.total_batches
      FROM programs p
      LEFT JOIN program_stats ps ON ps.program_id = p.id
      WHERE ps.program_id IS NOT NULL
      ORDER BY ps.start_ts DESC
    `).all();

    res.json(programs);
  } catch (error) {
    log.error('system', 'fetch_programs_error', error);
    res.status(500).json({ message: 'Failed to fetch programs' });
  }
});

/**
 * GET /api/stats/programs/:id
 * Get detailed stats for a specific program
 */
router.get('/programs/:id', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    const stats = db.prepare(`
      SELECT 
        ps.*,
        p.name as program_name
      FROM program_stats ps
      JOIN programs p ON p.id = ps.program_id
      WHERE ps.program_id = ?
    `).get(programId);

    if (!stats) {
      return res.status(404).json({ message: 'Program not found' });
    }

    res.json(stats);
  } catch (error) {
    log.error('system', 'fetch_program_stats_error', error);
    res.status(500).json({ message: 'Failed to fetch program stats' });
  }
});

/**
 * GET /api/stats/programs/:id/recipes
 * Get recipe stats for a specific program
 */
router.get('/programs/:id/recipes', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.id);

    const recipes = db.prepare(`
      SELECT *
      FROM recipe_stats_view
      WHERE program_id = ?
      ORDER BY total_batches DESC
    `).all(programId);

    // For the currently running program, ensure all active recipes are included
    // (some may have been added after program creation and aren't in recipe_stats yet)
    const currentState = machineState.getState();
    if (currentState.currentProgramId === programId && currentState.state !== 'idle') {
      const activeRecipes = machineState.getActiveRecipes() || [];
      const existingRecipeIds = new Set(recipes.map(r => r.recipe_name));

      for (const ar of activeRecipes) {
        if (existingRecipeIds.has(ar.recipeName)) continue;
        let r = ar.recipeId
          ? db.prepare('SELECT * FROM recipes WHERE id = ?').get(ar.recipeId)
          : null;
        if (!r && ar.recipeName) {
          r = db.prepare('SELECT * FROM recipes WHERE name = ?').get(ar.recipeName);
        }
        if (!r) continue;
        const bc = db.prepare(`
          SELECT COUNT(*) as total_batches, COALESCE(SUM(weight_g),0) as total_batched_weight_g,
                 COALESCE(SUM(pieces),0) as total_items_batched
          FROM batch_completions WHERE program_id = ? AND recipe_id = ? AND gate != 0
        `).get(programId, ar.recipeId);

        let customerName = null;
        if (ar.orderId) {
          const order = db.prepare('SELECT c.name as customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(ar.orderId);
          if (order) customerName = order.customer_name;
        }
        recipes.push({
          program_id: programId,
          recipe_name: r.name,
          gates_assigned: (ar.gates || []).join(','),
          order_id: ar.orderId || null,
          customer_name: customerName,
          total_batches: bc?.total_batches || 0,
          total_batched_weight_g: bc?.total_batched_weight_g || 0,
          total_reject_weight_g: 0,
          total_giveaway_weight_g: 0,
          total_weight_processed_g: bc?.total_batched_weight_g || 0,
          total_weight_g: bc?.total_batched_weight_g || 0,
          total_items_batched: bc?.total_items_batched || 0,
          total_items_rejected: 0,
          total_items_processed: bc?.total_items_batched || 0,
          total_giveaway_pct: 0,
          updated_at: new Date().toISOString(),
        });
      }
    }

    res.json(recipes);
  } catch (error) {
    log.error('system', 'fetch_recipe_stats_error', error);
    res.status(500).json({ message: 'Failed to fetch recipe stats' });
  }
});

/**
 * GET /api/stats/programs/:id/assignments
 * Get gate assignments with full recipe specifications for a program
 * For replay programs (without run_configs), we get unique recipes from recipe_stats
 * and assign them to gates 1, 2, 3... for display purposes
 */
router.get('/programs/:id/assignments', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.id);

    // For the currently running program, use live machine state
    const currentState = machineState.getState();
    if (currentState.currentProgramId === programId && currentState.state !== 'idle') {
      const activeRecipes = machineState.getActiveRecipes() || [];
      const assignments = [];
      for (const recipe of activeRecipes) {
        if (!recipe.gates?.length) continue;
        let r = recipe.recipeId
          ? db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipe.recipeId)
          : null;
        if (!r && recipe.recipeName) {
          r = db.prepare('SELECT * FROM recipes WHERE name = ?').get(recipe.recipeName);
        }
        if (!r) continue;
        let customerName = null;
        if (recipe.orderId) {
          const order = db.prepare('SELECT o.id, c.name as customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(recipe.orderId);
          if (order) customerName = order.customer_name;
        }
        for (const gate of recipe.gates) {
          assignments.push({
            gate,
            recipe_id: r.id,
            recipe_name: r.name,
            order_id: recipe.orderId || null,
            customer_name: customerName,
            piece_min_weight_g: r.piece_min_weight_g,
            piece_max_weight_g: r.piece_max_weight_g,
            batch_min_weight_g: r.batch_min_weight_g,
            batch_max_weight_g: r.batch_max_weight_g,
            min_pieces_per_batch: r.min_pieces_per_batch,
            max_pieces_per_batch: r.max_pieces_per_batch,
          });
        }
      }
      assignments.sort((a, b) => a.gate - b.gate);
      return res.json({ assignments });
    }
    
    // Try to get from run_configs first (for live mode programs)
    const config = db.prepare(`
      SELECT DISTINCT rc.id as config_id
      FROM run_configs rc
      WHERE rc.program_id = ?
      ORDER BY rc.id DESC
      LIMIT 1
    `).get(programId);

    if (config) {
      const rawAssignments = db.prepare(`
        SELECT 
          rca.gate_number as gate,
          rca.recipe_id,
          r.name as recipe_name,
          r.piece_min_weight_g,
          r.piece_max_weight_g,
          r.batch_min_weight_g,
          r.batch_max_weight_g,
          r.min_pieces_per_batch,
          r.max_pieces_per_batch
        FROM run_config_assignments rca
        JOIN recipes r ON r.id = rca.recipe_id
        WHERE rca.config_id = ?
        ORDER BY rca.gate_number ASC
      `).all(config.config_id);

      const orderInfoByRecipe = {};
      const recipeStats = db.prepare(`
        SELECT rs.recipe_id, rs.order_id, c.name as customer_name
        FROM recipe_stats rs
        LEFT JOIN orders o ON o.id = rs.order_id
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE rs.program_id = ? AND rs.order_id IS NOT NULL
      `).all(programId);
      for (const rs of recipeStats) {
        orderInfoByRecipe[rs.recipe_id] = { order_id: rs.order_id, customer_name: rs.customer_name };
      }

      const assignments = rawAssignments.map(a => ({
        ...a,
        order_id: orderInfoByRecipe[a.recipe_id]?.order_id || null,
        customer_name: orderInfoByRecipe[a.recipe_id]?.customer_name || null,
      }));

      return res.json({ assignments });
    }

    // Completed program - get recipes from recipe_stats with gates_assigned
    const recipes = db.prepare(`
      SELECT DISTINCT
        rs.recipe_id,
        rs.gates_assigned,
        rs.order_id,
        r.name as recipe_name,
        c.name as customer_name,
        r.piece_min_weight_g,
        r.piece_max_weight_g,
        r.batch_min_weight_g,
        r.batch_max_weight_g,
        r.min_pieces_per_batch,
        r.max_pieces_per_batch
      FROM recipe_stats rs
      JOIN recipes r ON r.id = rs.recipe_id
      LEFT JOIN orders o ON o.id = rs.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE rs.program_id = ?
      ORDER BY rs.total_batches DESC
    `).all(programId);

    // Parse gates_assigned (e.g., "1,1,1,2,2,2" -> [1, 2]) and create assignment records
    const assignments = [];
    recipes.forEach(recipe => {
      if (recipe.gates_assigned) {
        // Extract unique gates from comma-separated string
        const gatesStr = recipe.gates_assigned.toString();
        const uniqueGates = [...new Set(gatesStr.split(',').map(g => parseInt(g.trim())))];
        
        // Create an assignment entry for each unique gate
        uniqueGates.forEach(gate => {
          assignments.push({
            gate: gate,
            recipe_id: recipe.recipe_id,
            recipe_name: recipe.recipe_name,
            order_id: recipe.order_id || null,
            customer_name: recipe.customer_name || null,
            piece_min_weight_g: recipe.piece_min_weight_g,
            piece_max_weight_g: recipe.piece_max_weight_g,
            batch_min_weight_g: recipe.batch_min_weight_g,
            batch_max_weight_g: recipe.batch_max_weight_g,
            min_pieces_per_batch: recipe.min_pieces_per_batch,
            max_pieces_per_batch: recipe.max_pieces_per_batch
          });
        });
      }
    });

    // Sort by gate number
    assignments.sort((a, b) => a.gate - b.gate);

    res.json({ assignments });
  } catch (error) {
    log.error('system', 'fetch_program_assignments_error', error);
    res.status(500).json({ message: 'Failed to fetch program assignments' });
  }
});

/**
 * GET /api/stats/programs/:id/pieces-histogram
 * Get piece weight distribution histogram for a specific program from InfluxDB
 * Uses pieces from start_ts to last batch completion (to match batch_completions totals)
 */
router.get('/programs/:id/pieces-histogram', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    // Get program time range and total pieces from batch completions
    const stats = db.prepare(`
      SELECT start_ts, end_ts 
      FROM program_stats 
      WHERE program_id = ?
    `).get(programId);

    if (!stats || !stats.start_ts) {
      return res.status(404).json({ message: 'Program time range not found' });
    }
    
    // If they go to new program B → B has data before A is finalized (okay, but needs careful handling)    // Get the last batch completion time from batch_completions
    const batchInfo = db.prepare(`
      SELECT 
        MAX(completed_at) as last_batch_time,
        SUM(pieces) as total_batched_pieces
      FROM batch_completions 
      WHERE program_id = ?
    `).get(programId);
    
    // Get total expected pieces (batched + rejected) from program_stats
    const programStats = db.prepare(`
      SELECT total_items_batched, total_items_rejected
      FROM program_stats WHERE program_id = ?
    `).get(programId);
    
    const totalBatched = programStats?.total_items_batched || batchInfo?.total_batched_pieces || 0;
    const totalRejected = programStats?.total_items_rejected || 0;
    const expectedPieces = totalBatched + totalRejected;
    
    // Use MAX(end_ts, last_batch_time) to include:
    // - Rejected pieces (up to end_ts when transition started)
    // - Batched pieces (up to last_batch_time, which may be after end_ts for transition batches)
    const lastBatchTime = batchInfo?.last_batch_time;
    const endTs = stats.end_ts;
    let endTime = endTs;
    if (lastBatchTime && new Date(lastBatchTime) > new Date(endTs)) {
      endTime = lastBatchTime;
    }
    
    log.debug('system', 'histogram_query', `Program ${programId}`, { start: stats.start_ts, end: endTime, expectedPieces });

    // Query InfluxDB for pieces from start to last batch completion
    const influx = require('../services/influx');
    const query = `
      SELECT weight_g
      FROM pieces
      WHERE time >= '${stats.start_ts}' 
        AND time <= '${endTime}'
    `;

    const iterator = await influx.query(query);
    
    // Convert result to JavaScript array
    let weights = [];
    for await (const row of iterator) {
      weights.push(Number(row.weight_g));
    }
    
    // Limit to expected pieces from batch_completions to ensure consistency
    // This handles cases where pieces in gates at transition time shouldn't be counted
    if (expectedPieces > 0 && weights.length > expectedPieces) {
      weights = weights.slice(0, expectedPieces);
    }
    
    if (weights.length === 0) {
      return res.json({ bins: [], totalPieces: 0 });
    }

    const totalPieces = weights.length;

    // Calculate histogram bins with 5g bin size
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const binSize = 5; // 5 gram bins
    
    // Round min down to nearest 5, max up to nearest 5
    const binStart = Math.floor(minWeight / binSize) * binSize;
    const binEnd = Math.ceil(maxWeight / binSize) * binSize;
    const binCount = (binEnd - binStart) / binSize;

    // Initialize bins
    const bins = [];
    for (let i = 0; i < binCount; i++) {
      const rangeStart = binStart + (i * binSize);
      const rangeEnd = rangeStart + binSize;
      bins.push({
        range: `${rangeStart}-${rangeEnd}`,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        count: 0,
        label: `${rangeStart}g`
      });
    }

    // Count pieces in each bin
    weights.forEach(weight => {
      const binIndex = Math.min(
        Math.floor((weight - binStart) / binSize),
        binCount - 1
      );
      if (binIndex >= 0 && binIndex < binCount) {
        bins[binIndex].count++;
      }
    });

    res.json({ 
      bins, 
      totalPieces,
      minWeight: Math.round(minWeight),
      maxWeight: Math.round(maxWeight)
    });

  } catch (error) {
    log.error('system', 'fetch_program_pieces_error', error);
    res.status(500).json({ message: 'Failed to fetch program pieces', error: error.message });
  }
});

/**
 * GET /api/stats/programs/:id/gate-dwell
 * Get gate dwell times for a specific program (for boxplot visualization)
 */
router.get('/programs/:id/gate-dwell', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    // Try to get gate-to-recipe mapping from run_configs (live programs)
    let gateAssignments = db.prepare(`
      SELECT DISTINCT rca.gate_number, r.name as recipe_name
      FROM run_configs rc
      JOIN run_config_assignments rca ON rca.config_id = rc.id
      JOIN recipes r ON r.id = rca.recipe_id
      WHERE rc.program_id = ?
      ORDER BY rca.gate_number
    `).all(programId);
    
    // Create gate-to-recipe map
    const gateToRecipe = {};
    
    if (gateAssignments && gateAssignments.length > 0) {
      // Use run_configs if available
      gateAssignments.forEach(row => {
        gateToRecipe[row.gate_number] = row.recipe_name;
      });
    } else {
      // Fallback: use recipe_stats.gates_assigned for replay/imported programs
      const recipeStats = db.prepare(`
        SELECT rs.recipe_id, rs.gates_assigned, r.name as recipe_name
        FROM recipe_stats rs
        JOIN recipes r ON r.id = rs.recipe_id
        WHERE rs.program_id = ?
      `).all(programId);
      
      // Parse gates_assigned (comma-separated list like "1,1,1,2,2,2")
      recipeStats.forEach(row => {
        if (row.gates_assigned) {
          const gates = row.gates_assigned.split(',').map(g => parseInt(g.trim()));
          // Get unique gates for this recipe
          const uniqueGates = [...new Set(gates)];
          uniqueGates.forEach(gate => {
            gateToRecipe[gate] = row.recipe_name;
          });
        }
      });
    }
    
    // Get actual batch counts per gate from batch_completions
    const batchCounts = db.prepare(`
      SELECT gate, COUNT(*) as batch_count
      FROM batch_completions
      WHERE program_id = ? AND gate != 0
      GROUP BY gate
    `).all(programId);
    
    // Create batch count map
    const gateBatchCount = {};
    batchCounts.forEach(row => {
      gateBatchCount[row.gate] = row.batch_count;
    });
    
    // Compute dwell times from batch_completions (time between consecutive batches on same gate)
    const batches = db.prepare(`
      SELECT gate, completed_at
      FROM batch_completions
      WHERE program_id = ? AND gate != 0
      ORDER BY gate, completed_at
    `).all(programId);

    const dwellByGate = {};

    // Initialize all gates that have batches
    Object.keys(gateBatchCount).forEach(gate => {
      const gateNum = parseInt(gate);
      dwellByGate[gateNum] = {
        gate: gateNum,
        recipe_name: gateToRecipe[gateNum] || 'Unknown',
        dwell_times: [],
        batch_count: gateBatchCount[gateNum] || 0
      };
    });

    // Compute dwell times between consecutive batches on each gate
    let prevGate = null;
    let prevTime = null;
    batches.forEach(row => {
      const gate = row.gate;
      const time = new Date(row.completed_at).getTime();
      if (gate === prevGate && prevTime !== null) {
        const dwellSec = (time - prevTime) / 1000;
        if (dwellSec > 0 && dwellSec < 3600) {
          if (!dwellByGate[gate]) {
            dwellByGate[gate] = {
              gate,
              recipe_name: gateToRecipe[gate] || 'Unknown',
              dwell_times: [],
              batch_count: gateBatchCount[gate] || 0
            };
          }
          dwellByGate[gate].dwell_times.push(dwellSec);
        }
      }
      prevGate = gate;
      prevTime = time;
    });
    
    // Convert to array and sort by gate number
    const result = Object.values(dwellByGate).sort((a, b) => a.gate - b.gate);
    
    res.json(result);
  } catch (error) {
    log.error('system', 'fetch_gate_dwell_error', error);
    res.status(500).json({ message: 'Failed to fetch gate dwell times', error: error.message });
  }
});

/**
 * GET /api/stats/programs/:id/history
 * Get per-minute time series data for a program from SQLite
 * All data calculated from batch_completions (source of truth) filtered by program end_ts
 */
router.get('/programs/:id/history', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    // Get program end_ts to filter out transition batches that completed after program ended
    const programInfo = db.prepare(`
      SELECT end_ts FROM program_stats WHERE program_id = ?
    `).get(programId);
    
    const endTs = programInfo?.end_ts;
    
    // Get batches, pieces, weight per minute from batch_completions
    // Filter by end_ts to exclude transition batches that completed after program ended
    let batchData;
    if (endTs) {
      batchData = db.prepare(`
        SELECT 
          strftime('%Y-%m-%dT%H:%M:00Z', completed_at) as minute,
          r.name as recipe_name,
          COUNT(*) as batch_count,
          SUM(bc.pieces) as pieces_in_batches,
          SUM(bc.weight_g) as weight_in_batches
        FROM batch_completions bc
        LEFT JOIN recipes r ON bc.recipe_id = r.id
        WHERE bc.program_id = ?
          AND bc.completed_at <= ?
        GROUP BY minute, bc.recipe_id
        ORDER BY minute ASC
      `).all(programId, endTs);
    } else {
      batchData = db.prepare(`
        SELECT 
          strftime('%Y-%m-%dT%H:%M:00Z', completed_at) as minute,
          r.name as recipe_name,
          COUNT(*) as batch_count,
          SUM(bc.pieces) as pieces_in_batches,
          SUM(bc.weight_g) as weight_in_batches
        FROM batch_completions bc
        LEFT JOIN recipes r ON bc.recipe_id = r.id
        WHERE bc.program_id = ?
        GROUP BY minute, bc.recipe_id
        ORDER BY minute ASC
      `).all(programId);
    }
    
    
    // Build all data from batch_completions (source of truth)
    const batchesPerRecipe = {};
    const piecesPerRecipe = {};
    const weightPerRecipe = {};
    
    batchData.forEach(row => {
      const recipe = row.recipe_name || 'Unknown';
      const timestamp = new Date(row.minute).getTime();
      
      if (!batchesPerRecipe[recipe]) {
        batchesPerRecipe[recipe] = [];
      }
      if (!piecesPerRecipe[recipe]) {
        piecesPerRecipe[recipe] = [];
      }
      if (!weightPerRecipe[recipe]) {
        weightPerRecipe[recipe] = [];
      }
      
      batchesPerRecipe[recipe].push({
        t: timestamp,
        v: row.batch_count || 0
      });
      
      piecesPerRecipe[recipe].push({
        t: timestamp,
        v: row.pieces_in_batches || 0
      });
      
      weightPerRecipe[recipe].push({
        t: timestamp,
        v: row.weight_in_batches || 0
      });
    });
    
    
    res.json({
      batches: batchesPerRecipe,
      pieces: piecesPerRecipe,
      weight: weightPerRecipe
    });
  } catch (error) {
    log.error('system', 'fetch_program_history_error', error);
    res.status(500).json({ message: 'Failed to fetch program history', error: error.message });
  }
});

// GET /api/stats/programs/:id/pieces - Get piece weight scatter data for a program
router.get('/programs/:id/pieces', verifyToken, async (req, res) => {
  const programId = parseInt(req.params.id);
  
  try {
    // Get program start and end times
    const programStats = db.prepare(`
      SELECT start_ts, end_ts
      FROM program_stats
      WHERE program_id = ?
    `).get(programId);
    
    if (!programStats || !programStats.start_ts) {
      return res.json({ pieces: [] });
    }
    
    // Get the last batch completion time - use this as end cutoff to match batch_completions
    const batchInfo = db.prepare(`
      SELECT 
        MAX(completed_at) as last_batch_time,
        SUM(pieces) as total_batched_pieces
      FROM batch_completions 
      WHERE program_id = ?
    `).get(programId);
    
    const endTime = batchInfo?.last_batch_time || programStats.end_ts;
    const expectedPieces = batchInfo?.total_batched_pieces || 0;
    
    
    // Query InfluxDB for all pieces in this time range
    const influx = require('../services/influx');
    const query = `
      SELECT time, weight_g, gate
      FROM pieces
      WHERE time >= '${programStats.start_ts}'
        AND time <= '${endTime}'
      ORDER BY time ASC
    `;
    
    const iterator = await influx.query(query);
    
    // MEMORY OPTIMIZATION: Stream process data in a single pass
    // Instead of loading all pieces into an array, we:
    // 1. First pass: find min/max times and count pieces
    // 2. Second pass: accumulate into pre-allocated buckets
    
    const TREND_BUCKETS = 100;
    let pieceCount = 0;
    let minTime = Infinity;
    let maxTime = -Infinity;
    
    // Pre-allocate bucket accumulators (minimal memory)
    const buckets = new Array(TREND_BUCKETS);
    for (let i = 0; i < TREND_BUCKETS; i++) {
      buckets[i] = { count: 0, sum: 0, min: Infinity, max: -Infinity };
    }
    
    // Single pass: stream directly into buckets
    // We need to buffer pieces temporarily to get time range first
    const pieceBuffer = [];
    const MAX_BUFFER_SIZE = 5000; // Process in chunks to limit memory
    
    for await (const row of iterator) {
      // Stop if we've reached expected pieces from batch_completions
      // This ensures we don't count pieces that were in gates at transition time
      if (expectedPieces > 0 && pieceCount >= expectedPieces) {
        break;
      }
      
      if (row.gate && row.gate !== 0) {
        const t = new Date(row.time).getTime();
        const w = Number(row.weight_g);
        
        pieceBuffer.push({ t, w });
        pieceCount++;
        
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
        
        // Process buffer when it gets large
        if (pieceBuffer.length >= MAX_BUFFER_SIZE && minTime !== Infinity && maxTime !== -Infinity) {
          const timeRange = maxTime - minTime || 1;
          const bucketSize = timeRange / TREND_BUCKETS;
          
          for (const p of pieceBuffer) {
            const bucketIdx = Math.min(
              Math.floor((p.t - minTime) / bucketSize),
              TREND_BUCKETS - 1
            );
            const bucket = buckets[bucketIdx];
            bucket.count++;
            bucket.sum += p.w;
            if (p.w < bucket.min) bucket.min = p.w;
            if (p.w > bucket.max) bucket.max = p.w;
          }
          pieceBuffer.length = 0; // Clear buffer
        }
      }
    }
    
    
    if (pieceCount === 0 || minTime === Infinity) {
      return res.json({ scatterPoints: [], trendLine: [] });
    }
    
    // Process remaining pieces in buffer
    const timeRange = maxTime - minTime || 1;
    const bucketSize = timeRange / TREND_BUCKETS;
    
    for (const p of pieceBuffer) {
      const bucketIdx = Math.min(
        Math.floor((p.t - minTime) / bucketSize),
        TREND_BUCKETS - 1
      );
      const bucket = buckets[bucketIdx];
      bucket.count++;
      bucket.sum += p.w;
      if (p.w < bucket.min) bucket.min = p.w;
      if (p.w > bucket.max) bucket.max = p.w;
    }
    pieceBuffer.length = 0; // Clear buffer
    
    // Build final results from bucket statistics
    const trendLine = [];
    const scatterPoints = [];
    
    for (let i = 0; i < TREND_BUCKETS; i++) {
      const bucket = buckets[i];
      if (bucket.count > 0) {
        const avgTime = minTime + (i + 0.5) * bucketSize;
        const avgWeight = bucket.sum / bucket.count;
        
        // Add trend line point (mean)
        trendLine.push({ t: avgTime, w: avgWeight });
        
        // Add scatter points: min
        scatterPoints.push({ t: avgTime, w: bucket.min, g: 0 });
        
        // Add mean only if visibly different from min and max (> 5g)
        if (Math.abs(avgWeight - bucket.min) > 5 && Math.abs(avgWeight - bucket.max) > 5) {
          scatterPoints.push({ t: avgTime, w: avgWeight, g: 0 });
        }
        
        // Add max only if different from min
        if (Math.abs(bucket.max - bucket.min) > 5) {
          scatterPoints.push({ t: avgTime, w: bucket.max, g: 0 });
        }
      }
    }
    
    
    res.json({ 
      scatterPoints: scatterPoints,
      trendLine: trendLine
    });
    
  } catch (error) {
    log.error('system', 'fetch_pieces_error', error, { programId });
    res.status(500).json({ error: 'Failed to fetch piece weights' });
  }
});

// ================ ORDER / RECIPE STATS ENDPOINTS ================
// All order endpoints are scoped by program_id to ensure consistency
// with the Program View and accurate per-run statistics.

/**
 * GET /api/stats/orders
 * List recipe runs within programs, with optional customer and date filters.
 * Each entry is a (recipe, order, program) combination - a single recipe run within one program.
 */
router.get('/orders', verifyToken, (req, res) => {
  try {
    const { customer_id, date } = req.query;

    let query = `
      SELECT
        rs.program_id,
        rs.recipe_id,
        r.name as recipe_name,
        r.display_name as recipe_display_name,
        rs.order_id,
        c.name as customer_name,
        rs.total_batches,
        rs.total_items_batched,
        rs.total_items_rejected,
        COALESCE(bc_times.first_batch, ps.start_ts) as first_batch,
        COALESCE(bc_times.last_batch, ps.end_ts) as last_batch
      FROM recipe_stats rs
      JOIN recipes r ON r.id = rs.recipe_id
      JOIN program_stats ps ON ps.program_id = rs.program_id
      LEFT JOIN (
        SELECT program_id, recipe_id, COALESCE(order_id, 0) as oid,
               MIN(completed_at) as first_batch, MAX(completed_at) as last_batch
        FROM batch_completions
        WHERE gate != 0
        GROUP BY program_id, recipe_id, COALESCE(order_id, 0)
      ) bc_times ON bc_times.program_id = rs.program_id
                 AND bc_times.recipe_id = rs.recipe_id
                 AND bc_times.oid = COALESCE(rs.order_id, 0)
      LEFT JOIN orders o ON o.id = rs.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ps.end_ts IS NOT NULL
        AND rs.completed = 1
    `;
    const params = [];

    if (customer_id) {
      query += ` AND o.customer_id = ?`;
      params.push(parseInt(customer_id));
    }

    if (date) {
      query += ` AND DATE(ps.start_ts) = ?`;
      params.push(date);
    }

    query += ` ORDER BY ps.start_ts DESC, rs.total_batches DESC`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error) {
    log.error('system', 'fetch_order_stats_list_error', error);
    res.status(500).json({ message: 'Failed to fetch order stats list' });
  }
});

/**
 * GET /api/stats/orders/dates
 * Get distinct dates that have completed programs with recipe stats.
 */
router.get('/orders/dates', verifyToken, (req, res) => {
  try {
    const { customer_id } = req.query;
    let query = `
      SELECT DISTINCT DATE(ps.start_ts) as date
      FROM program_stats ps
      JOIN recipe_stats rs ON rs.program_id = ps.program_id
      LEFT JOIN orders o ON o.id = rs.order_id
      WHERE ps.start_ts IS NOT NULL AND ps.end_ts IS NOT NULL
        AND rs.completed = 1
    `;
    const params = [];
    if (customer_id) {
      query += ` AND o.customer_id = ?`;
      params.push(parseInt(customer_id));
    }
    query += ` ORDER BY date DESC`;

    const rows = db.prepare(query).all(...params);
    res.json(rows.map(r => r.date));
  } catch (error) {
    log.error('system', 'fetch_order_dates_error', error);
    res.status(500).json({ message: 'Failed to fetch order dates' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId
 * Get aggregate stats for a specific recipe within a specific program.
 * Uses recipe_stats (pre-computed, accurate giveaway/reject values).
 * query param: order_id (optional, for composite key)
 */
router.get('/orders/:recipeId/program/:programId', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;

    // Get program time range
    const ps = db.prepare(`SELECT start_ts, end_ts FROM program_stats WHERE program_id = ?`).get(programId);

    // Get recipe stats - query recipe_stats directly for reliability
    const recipe = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(recipeId);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    let rsQuery = `
      SELECT rs.*,
        c.name as customer_name
      FROM recipe_stats rs
      LEFT JOIN orders o ON o.id = rs.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE rs.program_id = ? AND rs.recipe_id = ?
    `;
    const rsParams = [programId, recipeId];
    if (orderId) {
      rsQuery += ` AND rs.order_id = ?`;
      rsParams.push(orderId);
    } else {
      rsQuery += ` AND (rs.order_id IS NULL OR rs.order_id = 0)`;
    }

    const rs = db.prepare(rsQuery).get(...rsParams);

    if (!rs) {
      return res.status(404).json({ message: 'No recipe stats found for this program' });
    }

    // Compute giveaway pct
    const totalWeight = (rs.total_batched_weight_g || 0) + (rs.total_giveaway_weight_g || 0) + (rs.total_reject_weight_g || 0);
    const giveawayPct = totalWeight > 0
      ? ((rs.total_giveaway_weight_g || 0) * 100 / totalWeight)
      : 0;

    res.json({
      recipe_id: recipeId,
      recipe_name: recipe.name,
      recipe_display_name: recipe.display_name || null,
      order_id: rs.order_id,
      customer_name: rs.customer_name,
      order_display_name: null,
      program_id: programId,
      program_name: `${recipe.name} (Program ${programId})`,
      start_ts: ps?.start_ts,
      end_ts: ps?.end_ts,
      total_batches: rs.total_batches,
      total_batched_weight_g: rs.total_batched_weight_g,
      total_reject_weight_g: rs.total_reject_weight_g,
      total_giveaway_weight_g: rs.total_giveaway_weight_g,
      total_items_batched: rs.total_items_batched,
      total_items_rejected: rs.total_items_rejected,
      total_giveaway_pct: giveawayPct,
    });
  } catch (error) {
    log.error('system', 'fetch_order_stats_error', error);
    res.status(500).json({ message: 'Failed to fetch order stats' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId/assignments
 * Get gate assignments for a recipe within a program.
 * Uses run_config_assignments (actual gate config), falling back to batch_completions.
 */
router.get('/orders/:recipeId/program/:programId/assignments', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);

    // Try run_config_assignments first (accurate for live programs)
    const config = db.prepare(`
      SELECT id FROM run_configs WHERE program_id = ? ORDER BY id DESC LIMIT 1
    `).get(programId);

    if (config) {
      const assignments = db.prepare(`
        SELECT
          rca.gate_number as gate,
          rca.recipe_id,
          r.name as recipe_name,
          r.piece_min_weight_g, r.piece_max_weight_g,
          r.batch_min_weight_g, r.batch_max_weight_g,
          r.min_pieces_per_batch, r.max_pieces_per_batch
        FROM run_config_assignments rca
        JOIN recipes r ON r.id = rca.recipe_id
        WHERE rca.config_id = ? AND rca.recipe_id = ?
        ORDER BY rca.gate_number ASC
      `).all(config.id, recipeId);

      if (assignments.length > 0) {
        return res.json({ assignments });
      }
    }

    // Fallback: derive from batch_completions for this program + recipe
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;
    let bcQuery = `
      SELECT DISTINCT bc.gate, bc.recipe_id,
        r.name as recipe_name,
        r.piece_min_weight_g, r.piece_max_weight_g,
        r.batch_min_weight_g, r.batch_max_weight_g,
        r.min_pieces_per_batch, r.max_pieces_per_batch
      FROM batch_completions bc
      JOIN recipes r ON r.id = bc.recipe_id
      WHERE bc.program_id = ? AND bc.recipe_id = ? AND bc.gate != 0
    `;
    const bcParams = [programId, recipeId];
    if (orderId) {
      bcQuery += ` AND bc.order_id = ?`;
      bcParams.push(orderId);
    }
    bcQuery += ` ORDER BY bc.gate ASC`;

    const gates = db.prepare(bcQuery).all(...bcParams);
    res.json({ assignments: gates });
  } catch (error) {
    log.error('system', 'fetch_order_assignments_error', error);
    res.status(500).json({ message: 'Failed to fetch order assignments' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId/history
 * Per-minute time series for a recipe within a program, from batch_completions.
 */
router.get('/orders/:recipeId/program/:programId/history', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;

    let query = `
      SELECT
        strftime('%Y-%m-%dT%H:%M:00Z', bc.completed_at) as minute,
        r.name as recipe_name,
        COUNT(*) as batch_count,
        SUM(bc.pieces) as pieces_in_batches,
        SUM(bc.weight_g) as weight_in_batches
      FROM batch_completions bc
      LEFT JOIN recipes r ON bc.recipe_id = r.id
      WHERE bc.program_id = ? AND bc.recipe_id = ? AND bc.gate != 0
    `;
    const params = [programId, recipeId];
    if (orderId) {
      query += ` AND bc.order_id = ?`;
      params.push(orderId);
    }
    query += ` GROUP BY minute ORDER BY minute ASC`;

    const batchData = db.prepare(query).all(...params);

    const batchesPerRecipe = {};
    const piecesPerRecipe = {};
    const weightPerRecipe = {};

    batchData.forEach(row => {
      const recipe = row.recipe_name || 'Unknown';
      const timestamp = new Date(row.minute).getTime();
      if (!batchesPerRecipe[recipe]) batchesPerRecipe[recipe] = [];
      if (!piecesPerRecipe[recipe]) piecesPerRecipe[recipe] = [];
      if (!weightPerRecipe[recipe]) weightPerRecipe[recipe] = [];
      batchesPerRecipe[recipe].push({ t: timestamp, v: row.batch_count || 0 });
      piecesPerRecipe[recipe].push({ t: timestamp, v: row.pieces_in_batches || 0 });
      weightPerRecipe[recipe].push({ t: timestamp, v: row.weight_in_batches || 0 });
    });

    res.json({ batches: batchesPerRecipe, pieces: piecesPerRecipe, weight: weightPerRecipe });
  } catch (error) {
    log.error('system', 'fetch_order_history_error', error);
    res.status(500).json({ message: 'Failed to fetch order history' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId/pieces-histogram
 * Piece weight distribution histogram from InfluxDB, scoped to a program's time range.
 */
router.get('/orders/:recipeId/program/:programId/pieces-histogram', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;

    // Get time range from batch_completions scoped to this program + recipe
    let rangeQuery = `
      SELECT MIN(bc.completed_at) as start_ts, MAX(bc.completed_at) as end_ts,
             SUM(bc.pieces) as total_pieces
      FROM batch_completions bc
      WHERE bc.program_id = ? AND bc.recipe_id = ? AND bc.gate != 0
    `;
    const rangeParams = [programId, recipeId];
    if (orderId) {
      rangeQuery += ` AND bc.order_id = ?`;
      rangeParams.push(orderId);
    }

    const range = db.prepare(rangeQuery).get(...rangeParams);

    if (!range || !range.start_ts) {
      return res.json({ bins: [], totalPieces: 0 });
    }

    const expectedPieces = range.total_pieces || 0;
    const influx = require('../services/influx');
    const query = `
      SELECT weight_g
      FROM pieces
      WHERE time >= '${range.start_ts}' AND time <= '${range.end_ts}'
    `;

    const iterator = await influx.query(query);
    let weights = [];
    for await (const row of iterator) {
      weights.push(Number(row.weight_g));
    }

    if (expectedPieces > 0 && weights.length > expectedPieces) {
      weights = weights.slice(0, expectedPieces);
    }

    if (weights.length === 0) {
      return res.json({ bins: [], totalPieces: 0 });
    }

    const totalPieces = weights.length;
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const binSize = 5;
    const binStart = Math.floor(minWeight / binSize) * binSize;
    const binEnd = Math.ceil(maxWeight / binSize) * binSize;
    const binCount = (binEnd - binStart) / binSize;

    const bins = [];
    for (let i = 0; i < binCount; i++) {
      const rangeStart = binStart + (i * binSize);
      const rangeEnd = rangeStart + binSize;
      bins.push({ range: `${rangeStart}-${rangeEnd}`, rangeStart, rangeEnd, count: 0, label: `${rangeStart}g` });
    }

    weights.forEach(weight => {
      const binIndex = Math.min(Math.floor((weight - binStart) / binSize), binCount - 1);
      if (binIndex >= 0 && binIndex < binCount) bins[binIndex].count++;
    });

    res.json({ bins, totalPieces, minWeight: Math.round(minWeight), maxWeight: Math.round(maxWeight) });
  } catch (error) {
    log.error('system', 'fetch_order_pieces_histogram_error', error);
    res.status(500).json({ message: 'Failed to fetch order pieces histogram' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId/gate-dwell
 * Gate dwell times for a recipe within a program.
 * Uses gate_dwell_times scoped by program_id and the recipe's gates.
 */
router.get('/orders/:recipeId/program/:programId/gate-dwell', verifyToken, (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;

    // Get gates used by this recipe in this program
    let gateQuery = `
      SELECT DISTINCT bc.gate, r.name as recipe_name
      FROM batch_completions bc
      JOIN recipes r ON r.id = bc.recipe_id
      WHERE bc.program_id = ? AND bc.recipe_id = ? AND bc.gate != 0
    `;
    const gateParams = [programId, recipeId];
    if (orderId) {
      gateQuery += ` AND bc.order_id = ?`;
      gateParams.push(orderId);
    }

    const usedGates = db.prepare(gateQuery).all(...gateParams);

    if (usedGates.length === 0) {
      return res.json([]);
    }

    const recipeName = usedGates[0].recipe_name;
    const gateNumbers = usedGates.map(g => g.gate);

    // Compute dwell times from batch_completions for each gate
    const result = gateNumbers.map(gate => {
      let batchQuery = `
        SELECT completed_at FROM batch_completions
        WHERE program_id = ? AND recipe_id = ? AND gate = ?
      `;
      const batchParams = [programId, recipeId, gate];
      if (orderId) {
        batchQuery += ` AND order_id = ?`;
        batchParams.push(orderId);
      }
      batchQuery += ` ORDER BY completed_at ASC`;

      const gateBatches = db.prepare(batchQuery).all(...batchParams);
      const dwellTimes = [];
      for (let i = 1; i < gateBatches.length; i++) {
        const prevTime = new Date(gateBatches[i - 1].completed_at).getTime();
        const currTime = new Date(gateBatches[i].completed_at).getTime();
        const dwellSec = (currTime - prevTime) / 1000;
        if (dwellSec > 0 && dwellSec < 3600) {
          dwellTimes.push(dwellSec);
        }
      }

      return {
        gate,
        recipe_name: recipeName,
        dwell_times: dwellTimes,
        batch_count: gateBatches.length,
      };
    });

    res.json(result);
  } catch (error) {
    log.error('system', 'fetch_order_gate_dwell_error', error);
    res.status(500).json({ message: 'Failed to fetch order gate dwell' });
  }
});

/**
 * GET /api/stats/orders/:recipeId/program/:programId/pieces
 * Piece weight scatter/trend data from InfluxDB, scoped to a program's time range.
 */
router.get('/orders/:recipeId/program/:programId/pieces', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.programId);
    const recipeId = parseInt(req.params.recipeId);
    const orderId = req.query.order_id ? parseInt(req.query.order_id) : null;

    let rangeQuery = `
      SELECT MIN(bc.completed_at) as start_ts, MAX(bc.completed_at) as end_ts,
             SUM(bc.pieces) as total_pieces
      FROM batch_completions bc
      WHERE bc.program_id = ? AND bc.recipe_id = ? AND bc.gate != 0
    `;
    const rangeParams = [programId, recipeId];
    if (orderId) {
      rangeQuery += ` AND bc.order_id = ?`;
      rangeParams.push(orderId);
    }

    const range = db.prepare(rangeQuery).get(...rangeParams);

    if (!range || !range.start_ts) {
      return res.json({ scatterPoints: [], trendLine: [] });
    }

    const expectedPieces = range.total_pieces || 0;
    const influx = require('../services/influx');
    const query = `
      SELECT time, weight_g, gate
      FROM pieces
      WHERE time >= '${range.start_ts}' AND time <= '${range.end_ts}'
      ORDER BY time ASC
    `;

    const iterator = await influx.query(query);
    const TREND_BUCKETS = 100;
    let pieceCount = 0;
    let minTime = Infinity;
    let maxTime = -Infinity;

    const buckets = new Array(TREND_BUCKETS);
    for (let i = 0; i < TREND_BUCKETS; i++) {
      buckets[i] = { count: 0, sum: 0, min: Infinity, max: -Infinity };
    }

    const pieceBuffer = [];
    const MAX_BUFFER_SIZE = 5000;

    for await (const row of iterator) {
      if (expectedPieces > 0 && pieceCount >= expectedPieces) break;
      if (row.gate && row.gate !== 0) {
        const t = new Date(row.time).getTime();
        const w = Number(row.weight_g);
        pieceBuffer.push({ t, w });
        pieceCount++;
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;

        if (pieceBuffer.length >= MAX_BUFFER_SIZE && minTime !== Infinity) {
          const timeRange = maxTime - minTime || 1;
          const bucketSize = timeRange / TREND_BUCKETS;
          for (const p of pieceBuffer) {
            const idx = Math.min(Math.floor((p.t - minTime) / bucketSize), TREND_BUCKETS - 1);
            const b = buckets[idx];
            b.count++; b.sum += p.w;
            if (p.w < b.min) b.min = p.w;
            if (p.w > b.max) b.max = p.w;
          }
          pieceBuffer.length = 0;
        }
      }
    }

    if (pieceCount === 0 || minTime === Infinity) {
      return res.json({ scatterPoints: [], trendLine: [] });
    }

    const timeRange = maxTime - minTime || 1;
    const bucketSize = timeRange / TREND_BUCKETS;
    for (const p of pieceBuffer) {
      const idx = Math.min(Math.floor((p.t - minTime) / bucketSize), TREND_BUCKETS - 1);
      const b = buckets[idx];
      b.count++; b.sum += p.w;
      if (p.w < b.min) b.min = p.w;
      if (p.w > b.max) b.max = p.w;
    }

    const trendLine = [];
    const scatterPoints = [];
    for (let i = 0; i < TREND_BUCKETS; i++) {
      const bucket = buckets[i];
      if (bucket.count > 0) {
        const avgTime = minTime + (i + 0.5) * bucketSize;
        const avgWeight = bucket.sum / bucket.count;
        trendLine.push({ t: avgTime, w: avgWeight });
        scatterPoints.push({ t: avgTime, w: bucket.min, g: 0 });
        if (Math.abs(avgWeight - bucket.min) > 5 && Math.abs(avgWeight - bucket.max) > 5) {
          scatterPoints.push({ t: avgTime, w: avgWeight, g: 0 });
        }
        if (Math.abs(bucket.max - bucket.min) > 5) {
          scatterPoints.push({ t: avgTime, w: bucket.max, g: 0 });
        }
      }
    }

    res.json({ scatterPoints, trendLine });
  } catch (error) {
    log.error('system', 'fetch_order_pieces_error', error);
    res.status(500).json({ message: 'Failed to fetch order pieces' });
  }
});

/**
 * GET /api/stats/programs/dates
 * Get distinct dates that have programs, for date picker filtering.
 */
router.get('/programs-dates', verifyToken, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT DATE(start_ts) as date
      FROM program_stats
      WHERE start_ts IS NOT NULL
      ORDER BY date DESC
    `).all();
    res.json(rows.map(r => r.date));
  } catch (error) {
    log.error('system', 'fetch_program_dates_error', error);
    res.status(500).json({ message: 'Failed to fetch program dates' });
  }
});

module.exports = router;
