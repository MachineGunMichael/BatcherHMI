const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userRepo = require('../repositories/userRepo');
const log = require('../lib/logger');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'username, password and role are required' });
    }

    const user = userRepo.findByUsernameAndRole(username, role);
    if (!user) {
      log.loginFailed(username, 'invalid_credentials_or_role', ip);
      return res.status(401).json({ message: 'Invalid credentials or role' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      log.loginFailed(username, 'invalid_password', ip);
      return res.status(401).json({ message: 'Invalid credentials or role' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }  // Long expiration - idle timeout is handled client-side
    );

    log.userLogin(user.username, user.role, ip);
    
    res.json({ token, user: userRepo.toSafe(user) });
  } catch (err) {
    log.error('system', 'login_error', err);
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
