const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();
const { findUserByCredentials, findUserById, getSafeUser, users } = require('./userDatabase');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Secret for JWT
const JWT_SECRET = 'batching-system-secret-key';

// Authentication endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    console.log('Login attempt:', { username, role }); // Debug log
    
    // Find user by credentials
    const user = await findUserByCredentials(username, password, role);
    
    if (!user) {
      // Check if user exists with that username and role
      const userExists = users.find(u => u.username === username && u.role === role);
      if (userExists) {
        return res.status(401).json({ message: 'Wrong password' });
      }
      
      // Check if user exists with that username but different role
      const userWithDifferentRole = users.find(u => u.username === username);
      if (userWithDifferentRole) {
        return res.status(401).json({ message: 'Wrong role selected' });
      }
      
      // User doesn't exist at all
      return res.status(401).json({ message: 'Wrong username' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    
    // Return user info and token (without password)
    return res.status(200).json({
      token,
      user: getSafeUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(403).json({ message: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// Protected route example
app.get('/api/auth/user', verifyToken, (req, res) => {
  const user = findUserById(req.user.userId);
  
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  
  return res.status(200).json(getSafeUser(user));
});

// Verify token endpoint (for frontend to check token validity)
app.get('/api/auth/verify', verifyToken, (req, res) => {
  return res.status(200).json({ valid: true });
});

// Validate token and return user data (for persistent login)
app.post('/api/auth/validate', verifyToken, (req, res) => {
  const user = findUserById(req.user.userId);
  
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  
  return res.status(200).json({ user: getSafeUser(user) });
});

// Server setup
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});