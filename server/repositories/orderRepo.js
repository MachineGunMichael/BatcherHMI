const db = require('../db/sqlite');

/**
 * Order statuses
 */
const ORDER_STATUS = {
  RECEIVED: 'received',
  ASSIGNED: 'assigned',
  IN_PRODUCTION: 'in-production',
  HALTED: 'halted',
  COMPLETED: 'completed',
  IN_TRANSIT: 'in-transit',
  ARRIVED: 'arrived',
};

/**
 * Get all orders (with optional filters)
 */
function getAllOrders({ status, customerId, includeCompleted = true } = {}) {
  let query = `
    SELECT 
      o.*,
      r.name as recipe_name,
      r.display_name as recipe_display_name,
      c.name as customer_name
    FROM orders o
    JOIN recipes r ON r.id = o.recipe_id
    JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  const params = [];
  
  if (status) {
    query += ` AND o.status = ?`;
    params.push(status);
  }
  
  if (customerId) {
    query += ` AND o.customer_id = ?`;
    params.push(customerId);
  }
  
  if (!includeCompleted) {
    query += ` AND o.status NOT IN ('completed', 'arrived')`;
  }
  
  query += ` ORDER BY o.due_date ASC, o.created_at ASC`;
  
  const stmt = db.prepare(query);
  return stmt.all(...params);
}

/**
 * Get orders available for assignment (received or halted status)
 * Halted orders are ones that were stopped mid-production and can be resumed
 */
function getAvailableOrders() {
  const received = getAllOrders({ status: ORDER_STATUS.RECEIVED });
  const halted = getAllOrders({ status: ORDER_STATUS.HALTED });
  return [...received, ...halted];
}

/**
 * Get orders in production
 */
function getInProductionOrders() {
  return getAllOrders({ status: ORDER_STATUS.IN_PRODUCTION });
}

/**
 * Get an order by ID
 */
function getOrderById(id) {
  const stmt = db.prepare(`
    SELECT 
      o.*,
      r.name as recipe_name,
      r.display_name as recipe_display_name,
      c.name as customer_name
    FROM orders o
    JOIN recipes r ON r.id = o.recipe_id
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `);
  return stmt.get(id);
}

/**
 * Create a new order
 */
function createOrder({
  customer_id,
  recipe_id,
  piece_min_weight_g,
  piece_max_weight_g,
  batch_min_weight_g,
  batch_max_weight_g,
  batch_type,
  batch_value,
  requested_batches,
  due_date,
}) {
  const now = new Date().toISOString();
  const statusTimestamps = JSON.stringify({ received: now });
  
  const stmt = db.prepare(`
    INSERT INTO orders (
      customer_id, recipe_id,
      piece_min_weight_g, piece_max_weight_g,
      batch_min_weight_g, batch_max_weight_g,
      batch_type, batch_value,
      prod_piece_min_weight_g, prod_piece_max_weight_g,
      prod_batch_min_weight_g, prod_batch_max_weight_g,
      prod_batch_type, prod_batch_value,
      requested_batches, due_date,
      status, status_timestamps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)
  `);
  
  const result = stmt.run(
    customer_id, recipe_id,
    piece_min_weight_g, piece_max_weight_g,
    batch_min_weight_g || null, batch_max_weight_g || null,
    batch_type || null, batch_value || null,
    // Initialize production config with same values
    piece_min_weight_g, piece_max_weight_g,
    batch_min_weight_g || null, batch_max_weight_g || null,
    batch_type || null, batch_value || null,
    requested_batches, due_date || null,
    statusTimestamps
  );
  
  return getOrderById(result.lastInsertRowid);
}

/**
 * Update order status
 */
function updateOrderStatus(id, newStatus) {
  const order = getOrderById(id);
  if (!order) return null;
  
  const timestamps = JSON.parse(order.status_timestamps || '{}');
  timestamps[newStatus] = new Date().toISOString();
  
  const stmt = db.prepare(`
    UPDATE orders 
    SET status = ?, status_timestamps = ?
    WHERE id = ?
  `);
  stmt.run(newStatus, JSON.stringify(timestamps), id);
  
  return getOrderById(id);
}

/**
 * Update order production config
 */
function updateOrderProductionConfig(id, {
  prod_piece_min_weight_g,
  prod_piece_max_weight_g,
  prod_batch_min_weight_g,
  prod_batch_max_weight_g,
  prod_batch_type,
  prod_batch_value,
}, changedBy = null, note = null) {
  const order = getOrderById(id);
  if (!order) return null;
  
  // Record history
  const historyStmt = db.prepare(`
    INSERT INTO order_config_history (
      order_id, changed_by, note,
      prev_piece_min_weight_g, prev_piece_max_weight_g,
      prev_batch_min_weight_g, prev_batch_max_weight_g,
      prev_batch_type, prev_batch_value,
      new_piece_min_weight_g, new_piece_max_weight_g,
      new_batch_min_weight_g, new_batch_max_weight_g,
      new_batch_type, new_batch_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  historyStmt.run(
    id, changedBy, note,
    order.prod_piece_min_weight_g, order.prod_piece_max_weight_g,
    order.prod_batch_min_weight_g, order.prod_batch_max_weight_g,
    order.prod_batch_type, order.prod_batch_value,
    prod_piece_min_weight_g, prod_piece_max_weight_g,
    prod_batch_min_weight_g, prod_batch_max_weight_g,
    prod_batch_type, prod_batch_value
  );
  
  // Update production config
  const updateStmt = db.prepare(`
    UPDATE orders SET
      prod_piece_min_weight_g = ?,
      prod_piece_max_weight_g = ?,
      prod_batch_min_weight_g = ?,
      prod_batch_max_weight_g = ?,
      prod_batch_type = ?,
      prod_batch_value = ?
    WHERE id = ?
  `);
  
  updateStmt.run(
    prod_piece_min_weight_g,
    prod_piece_max_weight_g,
    prod_batch_min_weight_g || null,
    prod_batch_max_weight_g || null,
    prod_batch_type || null,
    prod_batch_value || null,
    id
  );
  
  return getOrderById(id);
}

/**
 * Update order gate assignments
 */
function updateOrderGates(id, gates) {
  const stmt = db.prepare(`
    UPDATE orders SET assigned_gates = ? WHERE id = ?
  `);
  stmt.run(JSON.stringify(gates), id);
  return getOrderById(id);
}

/**
 * Increment completed batches
 */
function incrementCompletedBatches(id, count = 1) {
  const stmt = db.prepare(`
    UPDATE orders SET completed_batches = completed_batches + ? WHERE id = ?
  `);
  stmt.run(count, id);
  return getOrderById(id);
}

/**
 * Update order (for customer editing - only when status is 'received')
 */
function updateOrder(id, updates) {
  const order = getOrderById(id);
  if (!order) return null;
  if (order.status !== ORDER_STATUS.RECEIVED) {
    throw new Error('Can only edit orders in "received" status');
  }
  
  const allowedFields = [
    'requested_batches', 'due_date',
    'piece_min_weight_g', 'piece_max_weight_g',
    'batch_min_weight_g', 'batch_max_weight_g',
    'batch_type', 'batch_value'
  ];
  
  const updateParts = [];
  const values = [];
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      updateParts.push(`${field} = ?`);
      values.push(updates[field]);
      
      // Also update production config to match
      if (field.startsWith('piece_') || field.startsWith('batch_')) {
        updateParts.push(`prod_${field} = ?`);
        values.push(updates[field]);
      }
    }
  }
  
  if (updateParts.length === 0) return order;
  
  values.push(id);
  const stmt = db.prepare(`UPDATE orders SET ${updateParts.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  
  return getOrderById(id);
}

/**
 * Cancel/delete an order (only when status is 'received')
 */
function cancelOrder(id) {
  const order = getOrderById(id);
  if (!order) return null;
  if (order.status !== ORDER_STATUS.RECEIVED) {
    throw new Error('Can only cancel orders in "received" status');
  }
  
  const stmt = db.prepare('DELETE FROM orders WHERE id = ?');
  return stmt.run(id);
}

/**
 * Get order config history
 */
function getOrderConfigHistory(orderId) {
  const stmt = db.prepare(`
    SELECT 
      h.*,
      u.username as changed_by_username,
      u.name as changed_by_name
    FROM order_config_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.order_id = ?
    ORDER BY h.changed_at DESC
  `);
  return stmt.all(orderId);
}

module.exports = {
  ORDER_STATUS,
  getAllOrders,
  getAvailableOrders,
  getInProductionOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  updateOrderProductionConfig,
  updateOrderGates,
  incrementCompletedBatches,
  updateOrder,
  cancelOrder,
  getOrderConfigHistory,
};
