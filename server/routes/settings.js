const express = require('express');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const settingsRepo = require('../repositories/settingsRepo');
const programRepo = require('../repositories/programRepo');
const stream = require('./stream'); // to broadcast SSE updates
const Database = require('better-sqlite3');
const path = require('path');

const router = express.Router();

// Database connection
const db = new Database(path.join(__dirname, '../db/sqlite/batching_app.sqlite'));
db.pragma('journal_mode = WAL');

// GET /api/settings
router.get('/', verifyToken, (req, res) => {
  const s = settingsRepo.getSettings();
  const program = s.active_program_id ? programRepo.getProgram(s.active_program_id) : null;
  res.json({ settings: s, activeProgram: program });
});

// PUT /api/settings   (admin/manager)
router.put('/', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  const { mode, active_program_id } = req.body || {};
  if (mode && !['preset', 'manual'].includes(mode)) {
    return res.status(400).json({ message: "mode must be 'preset' or 'manual'" });
  }
  const updated = settingsRepo.updateSettings({ mode, active_program_id });
  const activeProgram = updated.active_program_id ? programRepo.getProgram(updated.active_program_id) : null;

  // notify SSE clients
  stream.broadcast('settings', { settings: updated, activeProgram });

  res.json({ settings: updated, activeProgram });
});

// GET /api/settings/recipes - Get all recipes from database
router.get('/recipes', verifyToken, (req, res) => {
  try {
    const recipes = db.prepare(`
      SELECT 
        id,
        name,
        display_name,
        piece_min_weight_g,
        piece_max_weight_g,
        batch_min_weight_g,
        batch_max_weight_g,
        min_pieces_per_batch,
        max_pieces_per_batch,
        created_at,
        updated_at
      FROM recipes
      ORDER BY name ASC
    `).all();

    res.json({ recipes });
  } catch (error) {
    console.error('Failed to fetch recipes:', error);
    res.status(500).json({ message: 'Failed to fetch recipes' });
  }
});

// POST /api/settings/recipes - Create a new recipe
// NOTE: Requires 'admin' or 'manager' role (operators cannot create recipes)
router.post('/recipes', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    console.log('[Settings API] Creating new recipe:', req.body.name);
    
    const {
      name,
      display_name,
      piece_min_weight_g,
      piece_max_weight_g,
      batch_min_weight_g,
      batch_max_weight_g,
      min_pieces_per_batch,
      max_pieces_per_batch,
    } = req.body;

    // Validate required fields
    if (!name || !piece_min_weight_g || !piece_max_weight_g) {
      console.log('[Settings API] Recipe creation failed: missing required fields');
      return res.status(400).json({ message: 'name, piece_min_weight_g, and piece_max_weight_g are required' });
    }

    // Check if recipe already exists
    const existing = db.prepare('SELECT id FROM recipes WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ message: 'Recipe with this name already exists', recipe: existing });
    }

    // Insert new recipe
    const result = db.prepare(`
      INSERT INTO recipes (
        name,
        display_name,
        piece_min_weight_g,
        piece_max_weight_g,
        batch_min_weight_g,
        batch_max_weight_g,
        min_pieces_per_batch,
        max_pieces_per_batch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      display_name || null,
      piece_min_weight_g,
      piece_max_weight_g,
      batch_min_weight_g || null,
      batch_max_weight_g || null,
      min_pieces_per_batch || null,
      max_pieces_per_batch || null
    );

    const newRecipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[Settings API] ✅ Recipe created successfully: ${name} (ID: ${newRecipe.id})`);

    res.status(201).json({ recipe: newRecipe });
  } catch (error) {
    console.error('[Settings API] Failed to create recipe:', error);
    res.status(500).json({ message: 'Failed to create recipe' });
  }
});

module.exports = router;