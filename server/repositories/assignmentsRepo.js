// server/repositories/assignmentsRepo.js
// Query assignment history from SQLite (replaces M5 from InfluxDB)

const db = require('../db/sqlite');

/**
 * Get current active assignments (from active_config_id in settings)
 * Returns array of { gate_number, recipe_id, recipe_name }
 */
function getCurrentAssignments() {
  const rows = db.prepare(`
    SELECT 
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name
    FROM settings s
    JOIN run_config_assignments rca ON rca.config_id = s.active_config_id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE s.id = (SELECT id FROM settings ORDER BY id LIMIT 1)
    ORDER BY rca.gate_number
  `).all();
  
  return rows;
}

/**
 * Get assignment history with timestamps
 * Returns array of { changed_at, config_id, config_name, gate_number, recipe_id, recipe_name, note }
 */
function getAssignmentHistory({ limit = 100, programId = null } = {}) {
  let sql = `
    SELECT 
      sh.changed_at,
      sh.active_config_id AS config_id,
      rc.name AS config_name,
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name,
      sh.note,
      rc.program_id
    FROM settings_history sh
    LEFT JOIN run_configs rc ON rc.id = sh.active_config_id
    LEFT JOIN run_config_assignments rca ON rca.config_id = rc.id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE sh.active_config_id IS NOT NULL
  `;
  
  const params = [];
  if (programId !== null) {
    sql += ' AND rc.program_id = ?';
    params.push(programId);
  }
  
  sql += ' ORDER BY sh.changed_at DESC, rca.gate_number ASC LIMIT ?';
  params.push(limit);
  
  return db.prepare(sql).all(...params);
}

/**
 * Get assignments at a specific time
 * @param {string} timestamp - ISO timestamp
 * @param {number?} programId - optional program filter
 */
function getAssignmentsAtTime(timestamp, programId = null) {
  let sql = `
    SELECT 
      sh.changed_at,
      sh.active_config_id AS config_id,
      rc.name AS config_name,
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name,
      rc.program_id
    FROM settings_history sh
    JOIN run_configs rc ON rc.id = sh.active_config_id
    LEFT JOIN run_config_assignments rca ON rca.config_id = rc.id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE sh.changed_at <= ?
      AND sh.active_config_id IS NOT NULL
  `;
  
  const params = [timestamp];
  if (programId !== null) {
    sql += ' AND rc.program_id = ?';
    params.push(programId);
  }
  
  sql += ' ORDER BY sh.changed_at DESC, rca.gate_number ASC LIMIT 20';
  
  return db.prepare(sql).all(...params);
}

/**
 * Get assignment changes for a specific program
 */
function getAssignmentsByProgram(programId) {
  return db.prepare(`
    SELECT 
      sh.changed_at,
      sh.active_config_id AS config_id,
      rc.name AS config_name,
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name,
      sh.note
    FROM settings_history sh
    JOIN run_configs rc ON rc.id = sh.active_config_id
    LEFT JOIN run_config_assignments rca ON rca.config_id = rc.id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE rc.program_id = ?
    ORDER BY sh.changed_at DESC, rca.gate_number ASC
  `).all(programId);
}

module.exports = {
  getCurrentAssignments,
  getAssignmentHistory,
  getAssignmentsAtTime,
  getAssignmentsByProgram,
};

