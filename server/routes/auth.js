const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userRepo = require('../repositories/userRepo');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'username, password and role are required' });
    }

    const user = userRepo.findByUsernameAndRole(username, role);
    if (!user) return res.status(401).json({ message: 'Invalid credentials or role' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials or role' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, user: userRepo.toSafe(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/validate
router.post('/validate', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'No token provided' });

    const data = jwt.verify(token, JWT_SECRET);
    const safe = userRepo.findById(data.id);
    if (!safe) return res.status(404).json({ message: 'User not found' });

    res.json({ valid: true, user: safe });
  } catch (e) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

module.exports = router;