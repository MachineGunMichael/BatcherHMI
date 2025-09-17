const db = require('../db/sqlite');

function toSafe(userRow) {
  if (!userRow) return null;
  const { password_hash, ...rest } = userRow;
  return rest;
}

function findByUsernameAndRole(username, role) {
  const stmt = db.prepare(
    `SELECT id, username, password_hash, role, name, permissions, created_at, updated_at
     FROM users
     WHERE username = ? AND role = ?
     LIMIT 1`
  );
  return stmt.get(username, role);
}

function findById(id) {
  const stmt = db.prepare(
    `SELECT id, username, role, name, permissions, created_at, updated_at
     FROM users WHERE id = ?`
  );
  return stmt.get(id);
}

module.exports = {
  toSafe,
  findByUsernameAndRole,
  findById,
};