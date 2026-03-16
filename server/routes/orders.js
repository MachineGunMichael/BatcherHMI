const express = require('express');
const { verifyToken, requireRole } = require('../utils/authMiddleware');
const orderRepo = require('../repositories/orderRepo');
const customerRepo = require('../repositories/customerRepo');
const machineState = require('../services/machineState');
const log = require('../lib/logger');
const db = require('../db/sqlite');

const router = express.Router();

/**
 * GET /api/orders
 * Get all orders (admin/manager/operator) or customer's own orders
 */
router.get('/', verifyToken, (req, res) => {
  try {
    const { status, includeCompleted } = req.query;
    
    let orders;
    if (req.user.role === 'customer') {
      // Customer can only see their own orders
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: 'Customer profile not found' });
      }
      orders = orderRepo.getAllOrders({ 
        customerId: customer.id, 
        status, 
        includeCompleted: includeCompleted !== 'false' 
      });
    } else {
      // Admin/manager/operator can see all orders
      orders = orderRepo.getAllOrders({ 
        status, 
        includeCompleted: includeCompleted !== 'false' 
      });
    }
    
    // Enrich orders with live machine state (active recipes + queue)
    const state = machineState.getState();
    const activeRecipes = state.activeRecipes || [];
    const queue = machineState.getOrderQueue() || [];

    const activeOrderMap = {};
    for (const r of activeRecipes) {
      if (r.orderId) activeOrderMap[r.orderId] = r.gates || [];
    }
    const queueOrderSet = new Set();
    const haltedOrderSet = new Set();
    for (const q of queue) {
      if (!q.orderId) continue;
      if (q.status === 'halted' || (!q.status && (q.completedBatches || 0) > 0)) {
        haltedOrderSet.add(q.orderId);
      } else {
        queueOrderSet.add(q.orderId);
      }
    }

    const enriched = orders.map(order => {
      if (activeOrderMap[order.id] !== undefined) {
        return { ...order, status: 'in-production', assigned_gates: JSON.stringify(activeOrderMap[order.id]) };
      }
      if (haltedOrderSet.has(order.id)) {
        return { ...order, status: 'halted' };
      }
      if (queueOrderSet.has(order.id)) {
        return { ...order, status: 'assigned' };
      }
      if (order.status === 'assigned' || order.status === 'in-production') {
        return { ...order, status: 'received', assigned_gates: '[]' };
      }
      return order;
    });

    // For completed orders, add production time range from batch_completions
    for (const order of enriched) {
      if (order.status === 'completed' || order.status === 'arrived') {
        try {
          const times = db.prepare(`
            SELECT MIN(completed_at) as started_at, MAX(completed_at) as finished_at
            FROM batch_completions WHERE order_id = ? AND gate != 0
          `).get(order.id);
          if (times) {
            order.started_at = times.started_at || null;
            order.finished_at = times.finished_at || null;
          }
        } catch (e) { /* ignore */ }
      }
    }

    res.json({ orders: enriched });
  } catch (error) {
    log.error('system', 'fetch_orders_error', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/available
 * Get orders available for assignment (received status)
 */
router.get('/available', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    const orders = orderRepo.getAvailableOrders();
    res.json({ orders });
  } catch (error) {
    log.error('system', 'fetch_available_orders_error', error);
    res.status(500).json({ message: 'Failed to fetch available orders' });
  }
});

/**
 * GET /api/orders/in-production
 * Get orders currently in production
 */
router.get('/in-production', verifyToken, requireRole('admin', 'manager', 'operator'), (req, res) => {
  try {
    const orders = orderRepo.getInProductionOrders();
    res.json({ orders });
  } catch (error) {
    log.error('system', 'fetch_in_production_orders_error', error);
    res.status(500).json({ message: 'Failed to fetch in-production orders' });
  }
});

/**
 * GET /api/orders/:id
 * Get a specific order
 */
router.get('/:id', verifyToken, (req, res) => {
  try {
    const order = orderRepo.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check permission
    if (req.user.role === 'customer') {
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer || customer.id !== order.customer_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    
    res.json({ order });
  } catch (error) {
    log.error('system', 'fetch_order_error', error);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});

/**
 * POST /api/orders
 * Create a new order
 */
router.post('/', verifyToken, (req, res) => {
  try {
    let customerId;
    
    if (req.user.role === 'customer') {
      // Customer creating their own order
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: 'Customer profile not found' });
      }
      customerId = customer.id;
    } else if (req.user.role === 'admin') {
      // Admin creating order for a customer
      customerId = req.body.customer_id;
      if (!customerId) {
        return res.status(400).json({ message: 'customer_id is required' });
      }
    } else {
      return res.status(403).json({ message: 'Only admin or customer can create orders' });
    }
    
    const {
      recipe_id,
      piece_min_weight_g,
      piece_max_weight_g,
      batch_min_weight_g,
      batch_max_weight_g,
      batch_type,
      batch_value,
      requested_batches,
      due_date,
    } = req.body;
    
    // Validate required fields
    if (!recipe_id || !piece_min_weight_g || !piece_max_weight_g || !requested_batches) {
      return res.status(400).json({ 
        message: 'recipe_id, piece_min_weight_g, piece_max_weight_g, and requested_batches are required' 
      });
    }
    
    // Verify recipe exists
    const recipe = db.prepare('SELECT id, name FROM recipes WHERE id = ?').get(recipe_id);
    if (!recipe) {
      return res.status(400).json({ message: 'Recipe not found' });
    }
    
    const order = orderRepo.createOrder({
      customer_id: customerId,
      recipe_id,
      piece_min_weight_g,
      piece_max_weight_g,
      batch_min_weight_g,
      batch_max_weight_g,
      batch_type,
      batch_value,
      requested_batches,
      due_date,
    });
    
    // Ensure this recipe is in the customer's recipe list
    db.prepare('INSERT OR IGNORE INTO customer_recipes (customer_id, recipe_id) VALUES (?, ?)').run(customerId, recipe_id);
    
    log.audit('order_created', 'Order created', {
      orderId: order.id,
      customerId,
      recipeName: recipe.name,
      requestedBatches: requested_batches,
    }, req.user.username);
    
    res.status(201).json({ order });
  } catch (error) {
    log.error('system', 'create_order_error', error);
    res.status(500).json({ message: 'Failed to create order' });
  }
});

/**
 * PUT /api/orders/:id
 * Update an order (only when status is 'received')
 */
router.put('/:id', verifyToken, (req, res) => {
  try {
    const order = orderRepo.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check permission
    if (req.user.role === 'customer') {
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer || customer.id !== order.customer_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    
    const updatedOrder = orderRepo.updateOrder(req.params.id, req.body);
    
    log.audit('order_updated', 'Order updated', {
      orderId: order.id,
      changes: req.body,
    }, req.user.username);
    
    res.json({ order: updatedOrder });
  } catch (error) {
    if (error.message.includes('Can only edit')) {
      return res.status(400).json({ message: error.message });
    }
    log.error('system', 'update_order_error', error);
    res.status(500).json({ message: 'Failed to update order' });
  }
});

/**
 * DELETE /api/orders/:id
 * Cancel an order (only when status is 'received')
 */
router.delete('/:id', verifyToken, (req, res) => {
  try {
    const order = orderRepo.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check permission
    if (req.user.role === 'customer') {
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer || customer.id !== order.customer_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    
    orderRepo.cancelOrder(req.params.id);
    
    log.audit('order_cancelled', 'Order cancelled', {
      orderId: order.id,
      recipeName: order.recipe_name,
    }, req.user.username);
    
    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    if (error.message.includes('Can only cancel')) {
      return res.status(400).json({ message: error.message });
    }
    log.error('system', 'cancel_order_error', error);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
});

/**
 * PUT /api/orders/:id/status
 * Update order status (admin/operator only)
 */
router.put('/:id/status', verifyToken, requireRole('admin', 'operator'), (req, res) => {
  try {
    const { status } = req.body;
    
    if (!Object.values(orderRepo.ORDER_STATUS).includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    const order = orderRepo.updateOrderStatus(req.params.id, status);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    log.operations('order_status_changed', 'Order status changed', {
      orderId: order.id,
      newStatus: status,
      customerId: order.customer_id,
    });
    
    res.json({ order });
  } catch (error) {
    log.error('system', 'update_order_status_error', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
});

/**
 * PUT /api/orders/:id/production-config
 * Update order production config (admin/operator only)
 */
router.put('/:id/production-config', verifyToken, requireRole('admin', 'operator'), (req, res) => {
  try {
    const { note, ...config } = req.body;
    
    const order = orderRepo.updateOrderProductionConfig(
      req.params.id,
      config,
      req.user.id,
      note
    );
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    log.operations('order_config_changed', 'Order production config changed', {
      orderId: order.id,
      changes: config,
    });
    
    res.json({ order });
  } catch (error) {
    log.error('system', 'update_order_config_error', error);
    res.status(500).json({ message: 'Failed to update order config' });
  }
});

/**
 * PUT /api/orders/:id/gates
 * Update order gate assignments (admin/operator only)
 */
router.put('/:id/gates', verifyToken, requireRole('admin', 'operator'), (req, res) => {
  try {
    const { gates } = req.body;
    
    if (!Array.isArray(gates)) {
      return res.status(400).json({ message: 'gates must be an array' });
    }
    
    const order = orderRepo.updateOrderGates(req.params.id, gates);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    log.operations('order_gates_assigned', 'Order gates assigned', {
      orderId: order.id,
      gates,
    });
    
    res.json({ order });
  } catch (error) {
    log.error('system', 'update_order_gates_error', error);
    res.status(500).json({ message: 'Failed to update order gates' });
  }
});

/**
 * GET /api/orders/:id/config-history
 * Get order config change history
 */
router.get('/:id/config-history', verifyToken, (req, res) => {
  try {
    const order = orderRepo.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check permission
    if (req.user.role === 'customer') {
      const customer = customerRepo.getCustomerByUserId(req.user.id);
      if (!customer || customer.id !== order.customer_id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    
    const history = orderRepo.getOrderConfigHistory(req.params.id);
    res.json({ history });
  } catch (error) {
    log.error('system', 'fetch_order_history_error', error);
    res.status(500).json({ message: 'Failed to fetch order history' });
  }
});

module.exports = router;
