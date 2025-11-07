// server/routes/stats.js
const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { verifyToken } = require('../utils/authMiddleware');

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
 * GET /api/stats/programs/:id/pieces
 * Get piece weight distribution for a specific program from InfluxDB
 */
router.get('/programs/:id/pieces', verifyToken, async (req, res) => {
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

module.exports = router;
