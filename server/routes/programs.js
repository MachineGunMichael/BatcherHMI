const express = require('express');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const programRepo = require('../repositories/programRepo');

const router = express.Router();

// GET /api/programs/recipes
router.get('/recipes', verifyToken, (req, res) => {
  res.json({ recipes: programRepo.listRecipes() });
});

// GET /api/programs
router.get('/', verifyToken, (req, res) => {
  res.json({ programs: programRepo.listPrograms() });
});

// GET /api/programs/:id
router.get('/:id', verifyToken, (req, res) => {
  const p = programRepo.getProgram(Number(req.params.id));
  if (!p) return res.status(404).json({ message: 'Program not found' });
  res.json({ program: p });
});

// POST /api/programs  (admin/manager)
router.post('/', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  const { name, gates = 8, mapping = [] } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name required' });

  const created = programRepo.createProgram({ name, gates, mapping });
  res.status(201).json({ program: created });
});

// PUT /api/programs/:id  (admin/manager)
router.put('/:id', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const updated = programRepo.updateProgram(id, req.body || {});
  if (!updated) return res.status(404).json({ message: 'Program not found' });
  res.json({ program: updated });
});

// DELETE /api/programs/:id (admin)
router.delete('/:id', verifyToken, requireRole('admin'), (req, res) => {
  programRepo.removeProgram(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;