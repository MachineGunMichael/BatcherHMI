const express = require('express');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const customerRepo = require('../repositories/customerRepo');
const log = require('../lib/logger');
const db = require('../db/sqlite');

const router = express.Router();

/**
 * GET /api/customers
 * Get all customers (admin only)
 */
router.get('/', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const customers = customerRepo.getAllCustomers();
    res.json({ customers });
  } catch (error) {
    log.error('system', 'fetch_customers_error', error);
    res.status(500).json({ message: 'Failed to fetch customers' });
  }
});

/**
 * GET /api/customers/me
 * Get current user's customer info (for customer users)
 */
router.get('/me', verifyToken, (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ message: 'Not a customer account' });
    }
    
    const customer = customerRepo.getCustomerByUserId(req.user.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }
    
    res.json({ customer });
  } catch (error) {
    log.error('system', 'fetch_customer_me_error', error);
    res.status(500).json({ message: 'Failed to fetch customer info' });
  }
});

/**
 * GET /api/customers/:id
 * Get a specific customer (admin only)
 */
router.get('/:id', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const customer = customerRepo.getCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({ customer });
  } catch (error) {
    log.error('system', 'fetch_customer_error', error);
    res.status(500).json({ message: 'Failed to fetch customer' });
  }
});

/**
 * POST /api/customers
 * Create a new customer (admin only)
 */
router.post('/', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const { name, address, contact_email, contact_phone, notes } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: 'Customer name is required' });
    }
    
    const customer = customerRepo.createCustomer({
      name,
      address,
      contact_email,
      contact_phone,
      notes,
    });
    
    log.audit('customer_created', 'Customer created', { customerId: customer.id, name }, req.user.username);
    
    res.status(201).json({ customer });
  } catch (error) {
    log.error('system', 'create_customer_error', error);
    res.status(500).json({ message: 'Failed to create customer' });
  }
});

/**
 * PUT /api/customers/:id
 * Update a customer (admin only)
 */
router.put('/:id', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const existing = customerRepo.getCustomerById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    const customer = customerRepo.updateCustomer(req.params.id, req.body);
    
    log.audit('customer_updated', 'Customer updated', { customerId: customer.id, name: customer.name }, req.user.username);
    
    res.json({ customer });
  } catch (error) {
    log.error('system', 'update_customer_error', error);
    res.status(500).json({ message: 'Failed to update customer' });
  }
});

/**
 * DELETE /api/customers/:id
 * Delete a customer (admin only)
 */
router.delete('/:id', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const existing = customerRepo.getCustomerById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    customerRepo.deleteCustomer(req.params.id);
    
    log.audit('customer_deleted', 'Customer deleted', { customerId: existing.id, name: existing.name }, req.user.username);
    
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    log.error('system', 'delete_customer_error', error);
    res.status(500).json({ message: 'Failed to delete customer' });
  }
});

/**
 * GET /api/customers/:id/orders
 * Get customer's orders (admin or the customer themselves)
 */
router.get('/:id/orders', verifyToken, (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    
    // Check permission: admin can see any, customer can only see their own
    if (req.user.role !== 'admin') {
      const userCustomer = customerRepo.getCustomerByUserId(req.user.id);
      if (!userCustomer || userCustomer.id !== customerId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    
    const orders = customerRepo.getCustomerOrders(customerId);
    const activeOrders = customerRepo.getCustomerActiveOrders(customerId);
    const orderHistory = customerRepo.getCustomerOrderHistory(customerId);
    
    res.json({ orders, activeOrders, orderHistory });
  } catch (error) {
    log.error('system', 'fetch_customer_orders_error', error);
    res.status(500).json({ message: 'Failed to fetch customer orders' });
  }
});

/**
 * GET /api/customers/:id/recipes
 * Get recipes assigned to a specific customer
 */
router.get('/:id/recipes', verifyToken, (req, res) => {
  try {
    const customerId = parseInt(req.params.id);

    if (req.user.role === 'customer') {
      const userCustomer = customerRepo.getCustomerByUserId(req.user.id);
      if (!userCustomer || userCustomer.id !== customerId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const recipes = db.prepare(`
      SELECT
        r.id,
        r.name,
        r.display_name,
        r.piece_min_weight_g,
        r.piece_max_weight_g,
        r.batch_min_weight_g,
        r.batch_max_weight_g,
        r.min_pieces_per_batch,
        r.max_pieces_per_batch,
        r.created_at,
        r.updated_at,
        COALESCE(cr.is_favorite, 0) as is_favorite
      FROM customer_recipes cr
      JOIN recipes r ON r.id = cr.recipe_id
      WHERE cr.customer_id = ?
      ORDER BY cr.is_favorite DESC, r.name ASC
    `).all(customerId);

    res.json({ recipes });
  } catch (error) {
    log.error('system', 'fetch_customer_recipes_error', error);
    res.status(500).json({ message: 'Failed to fetch customer recipes' });
  }
});

/**
 * POST /api/customers/:id/recipes
 * Add a recipe to a customer's list
 */
router.post('/:id/recipes', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const { recipe_id } = req.body;

    if (!recipe_id) {
      return res.status(400).json({ message: 'recipe_id is required' });
    }

    db.prepare('INSERT OR IGNORE INTO customer_recipes (customer_id, recipe_id) VALUES (?, ?)').run(customerId, recipe_id);

    res.status(201).json({ message: 'Recipe added to customer' });
  } catch (error) {
    log.error('system', 'add_customer_recipe_error', error);
    res.status(500).json({ message: 'Failed to add recipe to customer' });
  }
});

/**
 * DELETE /api/customers/:id/recipes/:recipeId
 * Remove a recipe from a customer's list
 */
router.delete('/:id/recipes/:recipeId', verifyToken, requireRole('admin'), (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const recipeId = parseInt(req.params.recipeId);

    db.prepare('DELETE FROM customer_recipes WHERE customer_id = ? AND recipe_id = ?').run(customerId, recipeId);

    res.json({ message: 'Recipe removed from customer' });
  } catch (error) {
    log.error('system', 'remove_customer_recipe_error', error);
    res.status(500).json({ message: 'Failed to remove recipe from customer' });
  }
});

/**
 * PATCH /api/customers/:id/recipes/:recipeId/favorite
 * Toggle a customer-specific recipe favorite
 */
router.patch('/:id/recipes/:recipeId/favorite', verifyToken, (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const recipeId = parseInt(req.params.recipeId);

    if (req.user.role === 'customer') {
      const userCustomer = customerRepo.getCustomerByUserId(req.user.id);
      if (!userCustomer || userCustomer.id !== customerId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const current = db.prepare('SELECT is_favorite FROM customer_recipes WHERE customer_id = ? AND recipe_id = ?').get(customerId, recipeId);
    if (!current) {
      return res.status(404).json({ message: 'Recipe not found for this customer' });
    }

    const newFav = current.is_favorite ? 0 : 1;
    db.prepare('UPDATE customer_recipes SET is_favorite = ? WHERE customer_id = ? AND recipe_id = ?').run(newFav, customerId, recipeId);

    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
    log.audit('customer_recipe_favorite_toggled', newFav ? 'Favorited' : 'Unfavorited', {
      customerId, recipeId, recipe: recipe?.name,
    }, req.user?.username || 'system');

    res.json({ is_favorite: !!newFav });
  } catch (error) {
    log.error('system', 'toggle_customer_recipe_favorite_error', error);
    res.status(500).json({ message: 'Failed to toggle favorite' });
  }
});

module.exports = router;
