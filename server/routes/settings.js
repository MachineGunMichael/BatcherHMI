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
        is_favorite,
        piece_min_weight_g,
        piece_max_weight_g,
        batch_min_weight_g,
        batch_max_weight_g,
        min_pieces_per_batch,
        max_pieces_per_batch,
        created_at,
        updated_at
      FROM recipes
      ORDER BY is_favorite DESC, name ASC
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

// DELETE /api/settings/recipes/:id - Delete a recipe
router.delete('/recipes/:id', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  try {
    const { id } = req.params;

    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    db.prepare('DELETE FROM recipes WHERE id = ?').run(id);

    console.log(`[Settings API] ✅ Recipe deleted: ${recipe.name} (ID: ${id})`);

    res.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    console.error('Failed to delete recipe:', error);
    res.status(500).json({ message: 'Failed to delete recipe' });
  }
});

// PATCH /api/settings/recipes/:id/favorite - Toggle recipe favorite status
router.patch('/recipes/:id/favorite', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    const { id } = req.params;
    const { is_favorite } = req.body;

    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    const newFavorite = is_favorite !== undefined ? (is_favorite ? 1 : 0) : (recipe.is_favorite ? 0 : 1);
    db.prepare('UPDATE recipes SET is_favorite = ? WHERE id = ?').run(newFavorite, id);

    const updatedRecipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    console.log(`[Settings API] ✅ Recipe favorite toggled: ${recipe.name} (ID: ${id}) -> ${newFavorite}`);

    res.json({ recipe: updatedRecipe });
  } catch (error) {
    console.error('Failed to toggle recipe favorite:', error);
    res.status(500).json({ message: 'Failed to toggle recipe favorite' });
  }
});

// ============== SAVED PROGRAMS API ==============

// GET /api/settings/saved-programs - Get all saved program templates
router.get('/saved-programs', verifyToken, (req, res) => {
  try {
    const programs = db.prepare(`
      SELECT id, name, display_name, is_favorite, created_at, updated_at
      FROM saved_programs
      ORDER BY is_favorite DESC, name ASC
    `).all();

    // For each program, get its recipes
    const programsWithRecipes = programs.map(program => {
      const recipes = db.prepare(`
        SELECT id, recipe_id, recipe_name, display_name, gates, params
        FROM saved_program_recipes
        WHERE saved_program_id = ?
      `).all(program.id);

      return {
        ...program,
        recipes: recipes.map(r => ({
          ...r,
          gates: JSON.parse(r.gates),
          params: JSON.parse(r.params),
        })),
      };
    });

    res.json({ programs: programsWithRecipes });
  } catch (error) {
    console.error('Failed to fetch saved programs:', error);
    res.status(500).json({ message: 'Failed to fetch saved programs' });
  }
});

// POST /api/settings/saved-programs - Create a new saved program template
router.post('/saved-programs', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    const { name, display_name, recipes } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Program name is required' });
    }

    if (!recipes || !Array.isArray(recipes) || recipes.length === 0) {
      return res.status(400).json({ message: 'At least one recipe is required' });
    }

    // Check if program name already exists
    const existing = db.prepare('SELECT id FROM saved_programs WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ message: 'A program with this name already exists' });
    }

    // Start transaction
    const insertProgram = db.prepare(`
      INSERT INTO saved_programs (name, display_name) VALUES (?, ?)
    `);
    const insertRecipe = db.prepare(`
      INSERT INTO saved_program_recipes (saved_program_id, recipe_id, recipe_name, display_name, gates, params)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      const programResult = insertProgram.run(name, display_name || null);
      const programId = programResult.lastInsertRowid;

      for (const recipe of recipes) {
        insertRecipe.run(
          programId,
          recipe.recipeId || null,
          recipe.recipeName,
          recipe.displayName || null,
          JSON.stringify(recipe.gates),
          JSON.stringify(recipe.params)
        );
      }

      return programId;
    });

    const programId = transaction();

    // Fetch the created program with recipes
    const program = db.prepare('SELECT * FROM saved_programs WHERE id = ?').get(programId);
    const programRecipes = db.prepare(`
      SELECT id, recipe_id, recipe_name, display_name, gates, params
      FROM saved_program_recipes WHERE saved_program_id = ?
    `).all(programId);

    console.log(`[Settings API] ✅ Saved program created: ${name} (ID: ${programId}) with ${recipes.length} recipes`);

    res.status(201).json({
      program: {
        ...program,
        recipes: programRecipes.map(r => ({
          ...r,
          gates: JSON.parse(r.gates),
          params: JSON.parse(r.params),
        })),
      },
    });
  } catch (error) {
    console.error('Failed to create saved program:', error);
    res.status(500).json({ message: 'Failed to create saved program' });
  }
});

// DELETE /api/settings/saved-programs/:id - Delete a saved program template
router.delete('/saved-programs/:id', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  try {
    const { id } = req.params;

    const program = db.prepare('SELECT * FROM saved_programs WHERE id = ?').get(id);
    if (!program) {
      return res.status(404).json({ message: 'Program not found' });
    }

    // Delete program (cascade will delete recipes)
    db.prepare('DELETE FROM saved_programs WHERE id = ?').run(id);

    console.log(`[Settings API] ✅ Saved program deleted: ${program.name} (ID: ${id})`);

    res.json({ message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Failed to delete saved program:', error);
    res.status(500).json({ message: 'Failed to delete saved program' });
  }
});

// PATCH /api/settings/saved-programs/:id/favorite - Toggle saved program favorite status
router.patch('/saved-programs/:id/favorite', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    const { id } = req.params;
    const { is_favorite } = req.body;

    const program = db.prepare('SELECT * FROM saved_programs WHERE id = ?').get(id);
    if (!program) {
      return res.status(404).json({ message: 'Program not found' });
    }

    const newFavorite = is_favorite !== undefined ? (is_favorite ? 1 : 0) : (program.is_favorite ? 0 : 1);
    db.prepare('UPDATE saved_programs SET is_favorite = ? WHERE id = ?').run(newFavorite, id);

    const updatedProgram = db.prepare('SELECT * FROM saved_programs WHERE id = ?').get(id);
    console.log(`[Settings API] ✅ Saved program favorite toggled: ${program.name} (ID: ${id}) -> ${newFavorite}`);

    res.json({ program: updatedProgram });
  } catch (error) {
    console.error('Failed to toggle saved program favorite:', error);
    res.status(500).json({ message: 'Failed to toggle saved program favorite' });
  }
});

module.exports = router;