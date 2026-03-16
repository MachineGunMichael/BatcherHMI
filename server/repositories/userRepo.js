const db = require('../db/sqlite');

function toSafe(userRow) {
  if (!userRow) return null;
  const { password_hash, ...rest } = userRow;
  return rest;
}

function findByUsernameAndRole(username, role) {
  const stmt = db.prepare(
    `SELECT id, username, password_hash, role, name, permissions, customer_id, created_at, updated_at
     FROM users
     WHERE username = ? AND role = ?
     LIMIT 1`
  );
  return stmt.get(username, role);
}

function findById(id) {
  const stmt = db.prepare(
    `SELECT id, username, role, name, permissions, customer_id, created_at, updated_at
     FROM users WHERE id = ?`
  );
  return stmt.get(id);
}

function createUser({ username, password_hash, role, name, permissions, customer_id }) {
  const stmt = db.prepare(
    `INSERT INTO users (username, password_hash, role, name, permissions, customer_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(username, password_hash, role, name, permissions || null, customer_id || null);
  return findById(result.lastInsertRowid);
}

function updateUser(id, updates) {
  const fields = [];
  const values = [];
  
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.permissions !== undefined) { fields.push('permissions = ?'); values.push(updates.permissions); }
  if (updates.customer_id !== undefined) { fields.push('customer_id = ?'); values.push(updates.customer_id); }
  if (updates.password_hash !== undefined) { fields.push('password_hash = ?'); values.push(updates.password_hash); }
  
  if (fields.length === 0) return findById(id);
  
  values.push(id);
  const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  return findById(id);
}

function getAllUsers() {
  const stmt = db.prepare(
    `SELECT id, username, role, name, permissions, customer_id, created_at, updated_at
     FROM users ORDER BY role, username`
  );
  return stmt.all();
}

function deleteUser(id) {
  const stmt = db.prepare('DELETE FROM users WHERE id = ?');
  return stmt.run(id);
}

module.exports = {
  toSafe,
  findByUsernameAndRole,
  findById,
  createUser,
  updateUser,
  getAllUsers,
  deleteUser,
};