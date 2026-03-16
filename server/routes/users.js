const express = require('express');
const bcrypt = require('bcryptjs');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const userRepo = require('../repositories/userRepo');
const customerRepo = require('../repositories/customerRepo');
const log = require('../lib/logger');

const router = express.Router();

/**
 * GET /api/users
 * Get all users (admin only)
 */
router.get('/', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const users = userRepo.getAllUsers().map(userRepo.toSafe);
    res.json({ users });
  } catch (error) {
    log.error('system', 'fetch_users_error', error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

/**
 * GET /api/users/:id
 * Get a specific user (admin only)
 */
router.get('/:id', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const user = userRepo.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: userRepo.toSafe(user) });
  } catch (error) {
    log.error('system', 'fetch_user_error', error);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

/**
 * POST /api/users
 * Create a new user (admin only)
 */
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role, name, permissions, customer_id } = req.body;
    
    // Validate required fields
    if (!username || !password || !role || !name) {
      return res.status(400).json({ 
        message: 'username, password, role, and name are required' 
      });
    }
    
    // Validate role
    if (!['admin', 'manager', 'operator', 'customer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    
    // Check if username already exists
    const existingAdmin = userRepo.findByUsernameAndRole(username, 'admin');
    const existingManager = userRepo.findByUsernameAndRole(username, 'manager');
    const existingOperator = userRepo.findByUsernameAndRole(username, 'operator');
    const existingCustomer = userRepo.findByUsernameAndRole(username, 'customer');
    
    if (existingAdmin || existingManager || existingOperator || existingCustomer) {
      return res.status(409).json({ message: 'Username already exists' });
    }
    
    // For customer role, customer_id is required
    if (role === 'customer') {
      if (!customer_id) {
        return res.status(400).json({ 
          message: 'customer_id is required for customer role' 
        });
      }
      
      // Verify customer exists
      const customer = customerRepo.getCustomerById(customer_id);
      if (!customer) {
        return res.status(400).json({ message: 'Customer not found' });
      }
    }
    
    // Hash password
    const password_hash = bcrypt.hashSync(password, 10);
    
    // Create user
    const user = userRepo.createUser({
      username,
      password_hash,
      role,
      name,
      permissions: permissions ? JSON.stringify(permissions) : null,
      customer_id: role === 'customer' ? customer_id : null,
    });
    
    log.audit('user_created', 'User created', {
      userId: user.id,
      username,
      role,
    }, req.user.username);
    
    res.status(201).json({ user: userRepo.toSafe(user) });
  } catch (error) {
    log.error('system', 'create_user_error', error);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

/**
 * PUT /api/users/:id
 * Update a user (admin only)
 */
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const existing = userRepo.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const updates = {};
    
    if (req.body.name !== undefined) {
      updates.name = req.body.name;
    }
    
    if (req.body.permissions !== undefined) {
      updates.permissions = JSON.stringify(req.body.permissions);
    }
    
    if (req.body.customer_id !== undefined) {
      updates.customer_id = req.body.customer_id;
    }
    
    if (req.body.password) {
      updates.password_hash = bcrypt.hashSync(req.body.password, 10);
    }
    
    const user = userRepo.updateUser(req.params.id, updates);
    
    log.audit('user_updated', 'User updated', {
      userId: user.id,
      username: user.username,
    }, req.user.username);
    
    res.json({ user: userRepo.toSafe(user) });
  } catch (error) {
    log.error('system', 'update_user_error', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

/**
 * DELETE /api/users/:id
 * Delete a user (admin only)
 */
router.delete('/:id', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const existing = userRepo.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Prevent deleting yourself
    if (existing.id === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    
    userRepo.deleteUser(req.params.id);
    
    log.audit('user_deleted', 'User deleted', {
      userId: existing.id,
      username: existing.username,
    }, req.user.username);
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    log.error('system', 'delete_user_error', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

module.exports = router;
