const db = require('../db/sqlite');

/**
 * Get all customers
 */
function getAllCustomers() {
  const stmt = db.prepare(`
    SELECT 
      c.*,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as total_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('completed', 'arrived')) as active_orders
    FROM customers c
    ORDER BY c.name ASC
  `);
  return stmt.all();
}

/**
 * Get a customer by ID
 */
function getCustomerById(id) {
  const stmt = db.prepare(`
    SELECT * FROM customers WHERE id = ?
  `);
  return stmt.get(id);
}

/**
 * Get customer by user ID (for logged-in customer users)
 */
function getCustomerByUserId(userId) {
  const stmt = db.prepare(`
    SELECT c.* FROM customers c
    JOIN users u ON u.customer_id = c.id
    WHERE u.id = ?
  `);
  return stmt.get(userId);
}

/**
 * Create a new customer
 */
function createCustomer({ name, address, contact_email, contact_phone, notes }) {
  const stmt = db.prepare(`
    INSERT INTO customers (name, address, contact_email, contact_phone, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, address || null, contact_email || null, contact_phone || null, notes || null);
  return getCustomerById(result.lastInsertRowid);
}

/**
 * Update a customer
 */
function updateCustomer(id, { name, address, contact_email, contact_phone, notes }) {
  const updates = [];
  const values = [];
  
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (address !== undefined) { updates.push('address = ?'); values.push(address); }
  if (contact_email !== undefined) { updates.push('contact_email = ?'); values.push(contact_email); }
  if (contact_phone !== undefined) { updates.push('contact_phone = ?'); values.push(contact_phone); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
  
  if (updates.length === 0) return getCustomerById(id);
  
  values.push(id);
  const stmt = db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  return getCustomerById(id);
}

/**
 * Delete a customer
 */
function deleteCustomer(id) {
  const stmt = db.prepare('DELETE FROM customers WHERE id = ?');
  return stmt.run(id);
}

/**
 * Get customer orders (active and history)
 */
function getCustomerOrders(customerId, includeCompleted = true) {
  let query = `
    SELECT 
      o.*,
      r.name as recipe_name,
      r.display_name as recipe_display_name
    FROM orders o
    JOIN recipes r ON r.id = o.recipe_id
    WHERE o.customer_id = ?
  `;
  
  if (!includeCompleted) {
    query += ` AND o.status NOT IN ('completed', 'arrived')`;
  }
  
  query += ` ORDER BY o.created_at DESC`;
  
  const stmt = db.prepare(query);
  return stmt.all(customerId);
}

/**
 * Get customer active orders (not completed)
 */
function getCustomerActiveOrders(customerId) {
  return getCustomerOrders(customerId, false);
}

/**
 * Get customer order history (completed only)
 */
function getCustomerOrderHistory(customerId) {
  const stmt = db.prepare(`
    SELECT 
      o.*,
      r.name as recipe_name,
      r.display_name as recipe_display_name
    FROM orders o
    JOIN recipes r ON r.id = o.recipe_id
    WHERE o.customer_id = ? AND o.status IN ('completed', 'arrived')
    ORDER BY o.created_at DESC
  `);
  return stmt.all(customerId);
}

module.exports = {
  getAllCustomers,
  getCustomerById,
  getCustomerByUserId,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerOrders,
  getCustomerActiveOrders,
  getCustomerOrderHistory,
};
