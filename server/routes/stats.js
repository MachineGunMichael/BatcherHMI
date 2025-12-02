// server/routes/stats.js
const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { verifyToken } = require('../utils/authMiddleware');
const { query: influxQuery } = require('../services/influx');

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
    console.error('Error fetching programs:', error);
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
    console.error('Error fetching program stats:', error);
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

    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipe stats:', error);
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
    
    // Try to get from run_configs first (for live mode programs)
    const config = db.prepare(`
      SELECT DISTINCT rc.id as config_id
      FROM run_configs rc
      WHERE rc.program_id = ?
      ORDER BY rc.id DESC
      LIMIT 1
    `).get(programId);

    if (config) {
      // Live mode program - get actual gate assignments
      const assignments = db.prepare(`
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

      return res.json({ assignments });
    }

    // Replay program - get recipes from recipe_stats with gates_assigned
    const recipes = db.prepare(`
      SELECT DISTINCT
        rs.recipe_id,
        rs.gates_assigned,
        r.name as recipe_name,
        r.piece_min_weight_g,
        r.piece_max_weight_g,
        r.batch_min_weight_g,
        r.batch_max_weight_g,
        r.min_pieces_per_batch,
        r.max_pieces_per_batch
      FROM recipe_stats rs
      JOIN recipes r ON r.id = rs.recipe_id
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
    console.error('Error fetching program assignments:', error);
    res.status(500).json({ message: 'Failed to fetch program assignments' });
  }
});

/**
 * GET /api/stats/programs/:id/pieces-histogram
 * Get piece weight distribution histogram for a specific program from InfluxDB
 */
router.get('/programs/:id/pieces-histogram', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    // Get program time range from SQLite
    const stats = db.prepare(`
      SELECT start_ts, end_ts 
      FROM program_stats 
      WHERE program_id = ?
    `).get(programId);

    if (!stats || !stats.start_ts || !stats.end_ts) {
      return res.status(404).json({ message: 'Program time range not found' });
    }

    // Query InfluxDB for all pieces in the time range
    const influx = require('../services/influx');
    const query = `
      SELECT weight_g
      FROM pieces
      WHERE time >= '${stats.start_ts}' 
        AND time <= '${stats.end_ts}'
    `;

    const iterator = await influx.query(query);
    
    // Convert result to JavaScript array
    const weights = [];
    for await (const row of iterator) {
      weights.push(Number(row.weight_g));
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
    console.error('Error fetching program pieces:', error);
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
    
    // Get all dwell times for this program
    const dwellTimes = db.prepare(`
      SELECT 
        gate_number,
        dwell_time_sec,
        batch_timestamp
      FROM gate_dwell_times
      WHERE program_id = ?
      ORDER BY gate_number, batch_timestamp
    `).all(programId);
    
    // Group by gate and add recipe information
    const dwellByGate = {};
    dwellTimes.forEach(row => {
      const gate = row.gate_number;
      if (!dwellByGate[gate]) {
        dwellByGate[gate] = {
          gate: gate,
          recipe_name: gateToRecipe[gate] || 'Unknown',
          dwell_times: []
        };
      }
      dwellByGate[gate].dwell_times.push(row.dwell_time_sec);
    });
    
    // Convert to array and sort by gate number
    const result = Object.values(dwellByGate).sort((a, b) => a.gate - b.gate);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching gate dwell times:', error);
    res.status(500).json({ message: 'Failed to fetch gate dwell times', error: error.message });
  }
});

/**
 * GET /api/stats/programs/:id/history
 * Get per-minute time series data for a program from SQLite (live worker writes M3 to SQLite)
 */
router.get('/programs/:id/history', verifyToken, async (req, res) => {
  try {
    const programId = parseInt(req.params.id);
    
    // Query SQLite kpi_minute_recipes table (where live worker writes M3 data)
    const kpiData = db.prepare(`
      SELECT 
        timestamp,
        recipe_name,
        batches_min,
        pieces_processed,
        weight_processed_g
      FROM kpi_minute_recipes
      WHERE program_id = ?
      ORDER BY timestamp ASC
    `).all(programId);
    
    console.log(`[History] Found ${kpiData.length} per-minute records for program ${programId}`);
    
    // Transform SQLite data to match the format expected by frontend
    // Group by recipe and convert timestamps to milliseconds
    const batchesPerRecipe = {};
    const piecesPerRecipe = {};
    const weightPerRecipe = {};
    
    kpiData.forEach(row => {
      const recipe = row.recipe_name;
      const timestamp = new Date(row.timestamp).getTime(); // Convert to milliseconds
      
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
        v: row.batches_min || 0
      });
      
      piecesPerRecipe[recipe].push({
        t: timestamp,
        v: row.pieces_processed || 0
      });
      
      weightPerRecipe[recipe].push({
        t: timestamp,
        v: row.weight_processed_g || 0
      });
    });
    
    console.log(`[History] Batches recipes: ${Object.keys(batchesPerRecipe).length}, Pieces recipes: ${Object.keys(piecesPerRecipe).length}, Weight recipes: ${Object.keys(weightPerRecipe).length}`);
    
    res.json({
      batches: batchesPerRecipe,
      pieces: piecesPerRecipe,
      weight: weightPerRecipe
    });
  } catch (error) {
    console.error('Error fetching program history:', error);
    console.error('Error stack:', error.stack);
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
    
    if (!programStats || !programStats.start_ts || !programStats.end_ts) {
      return res.json({ pieces: [] });
    }
    
    console.log(`[Pieces] Fetching piece weights for program ${programId} (${programStats.start_ts} to ${programStats.end_ts})`);
    
    // Query InfluxDB for all pieces in this time range
    const influx = require('../services/influx');
    const query = `
      SELECT time, weight_g, gate
      FROM pieces
      WHERE time >= '${programStats.start_ts}'
        AND time <= '${programStats.end_ts}'
      ORDER BY time ASC
    `;
    
    const iterator = await influx.query(query);
    
    // Convert result to JavaScript array
    const allPieces = [];
    for await (const row of iterator) {
      if (row.gate && row.gate !== 0) { // Exclude rejects (gate 0)
        allPieces.push({
          t: new Date(row.time).getTime(),
          w: Number(row.weight_g),
          g: Number(row.gate)
        });
      }
    }
    
    console.log(`[Pieces] Found ${allPieces.length} pieces for program ${programId}`);
    
    // Calculate trend line and scatter points showing min/mean/max per time bucket
    const TREND_BUCKETS = 100;  // Number of time buckets for both trend and scatter
    
    if (allPieces.length === 0) {
      return res.json({ scatterPoints: [], trendLine: [] });
    }
    
    // Sort by time
    allPieces.sort((a, b) => a.t - b.t);
    
    const minTime = allPieces[0].t;
    const maxTime = allPieces[allPieces.length - 1].t;
    const timeRange = maxTime - minTime;
    const bucketSize = timeRange / TREND_BUCKETS;
    
    // Calculate both trend line and scatter points (min/mean/max per bucket)
    const trendLine = [];
    const scatterPoints = [];
    
    for (let i = 0; i < TREND_BUCKETS; i++) {
      const bucketStart = minTime + (i * bucketSize);
      const bucketEnd = bucketStart + bucketSize;
      
      // Get all pieces in this time bucket
      const bucketPieces = allPieces.filter(p => p.t >= bucketStart && p.t < bucketEnd);
      
      if (bucketPieces.length > 0) {
        const avgTime = (bucketStart + bucketEnd) / 2;
        
        // Calculate statistics
        const weights = bucketPieces.map(p => p.w);
        const minWeight = Math.min(...weights);
        const maxWeight = Math.max(...weights);
        const avgWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
        
        // Add trend line point (mean)
        trendLine.push({
          t: avgTime,
          w: avgWeight
        });
        
        // Add scatter points: always add min and max, add mean only if it's distinct
        scatterPoints.push({
          t: avgTime,
          w: minWeight,
          g: 0
        });
        
        // Add mean point only if it's visibly different from min and max (more than 5g difference)
        if (Math.abs(avgWeight - minWeight) > 5 && Math.abs(avgWeight - maxWeight) > 5) {
          scatterPoints.push({
            t: avgTime,
            w: avgWeight,
            g: 0
          });
        }
        
        if (Math.abs(maxWeight - minWeight) > 5) {
          scatterPoints.push({
            t: avgTime,
            w: maxWeight,
            g: 0
          });
        }
      }
    }
    
    console.log(`[Pieces] Debug first few buckets:`);
    for (let i = 0; i < Math.min(3, trendLine.length); i++) {
      console.log(`  Bucket ${i}: trend=${trendLine[i].w.toFixed(1)}g at ${new Date(trendLine[i].t).toLocaleTimeString()}`);
      const bucketScatter = scatterPoints.filter(p => Math.abs(p.t - trendLine[i].t) < 1);
      console.log(`    Scatter points: ${bucketScatter.map(p => p.w.toFixed(1)).join(', ')}g`);
    }
    
    console.log(`[Pieces] Calculated trend line with ${trendLine.length} points`);
    console.log(`[Pieces] Scatter points: ${scatterPoints.length} points (min/mean/max per time bucket)`);
    
    res.json({ 
      scatterPoints: scatterPoints.sort((a, b) => a.t - b.t),
      trendLine: trendLine
    });
    
  } catch (error) {
    console.error(`[Pieces] Error fetching pieces for program ${programId}:`, error);
    res.status(500).json({ error: 'Failed to fetch piece weights' });
  }
});

module.exports = router;
