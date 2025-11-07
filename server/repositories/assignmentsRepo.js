// server/repositories/assignmentsRepo.js
// Query assignment history from SQLite (M5 has been moved from Influx → SQLite)

const db = require('../db/sqlite');

/** Current active assignments (from settings.active_config_id) */
function getCurrentAssignments() {
  return db.prepare(`
    SELECT rca.gate_number, rca.recipe_id, r.name AS recipe_name
    FROM settings s
    JOIN run_config_assignments rca ON rca.config_id = s.active_config_id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE s.id = (SELECT id FROM settings ORDER BY id LIMIT 1)
    ORDER BY rca.gate_number
  `).all();
}

/** Timeline of config changes + their assignments (newest first) */
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
    WHERE sh.active_config_id IS NOT NULL`;
  const params = [];
  if (programId !== null) { sql += ' AND rc.program_id = ?'; params.push(programId); }
  sql += ' ORDER BY sh.changed_at DESC, rca.gate_number ASC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

/**
 * Check if a program is active at a given timestamp by checking program_stats.
 * Returns true if current time is within an active program period.
 */
function isProgramActiveAt(tsIso) {
  // program_stats uses ISO format timestamps (with T and Z), so normalize the input
  const tsNormalized = new Date(tsIso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  // Check if we're within any program's active period (start_ts <= time <= end_ts)
  // If end_ts is NULL, the program is still active, so treat it as "current time"
  const activeProgramSql = `
    SELECT COUNT(*) as count
    FROM program_stats
    WHERE ? >= start_ts AND (end_ts IS NULL OR ? <= end_ts)
  `;
  
  const result = db.prepare(activeProgramSql).get(tsNormalized, tsNormalized);
  return result && result.count > 0;
}

/**
 * SNAPSHOT per gate at a specific moment (latest <= changed_at per gate).
 * Reads from `assignment_history_view`.
 * Returns [{ gate, recipe_name }]
 * Returns empty array if no program is active at the given time.
 */
function getAssignmentsSnapshotAt(tsIso) {
  // DON'T convert - use ISO format directly for timestamp comparison
  // SQLite can compare ISO timestamps correctly if format is consistent
  
  // Simply return the latest assignments at or before this timestamp
  // No need to check program_stats - if settings_history exists, return it
  const sql = `
    SELECT DISTINCT
      v.gate_number AS gate,
      v.recipe_name
    FROM assignment_history_view v
    WHERE v.changed_at <= ?
      AND v.changed_at = (
        SELECT MAX(changed_at) 
        FROM assignment_history_view v2
        WHERE v2.gate_number = v.gate_number AND v2.changed_at <= ?
      )
    ORDER BY v.gate_number ASC`;
  return db.prepare(sql).all(tsIso, tsIso);
}

/**
 * CONFIG ACTIVE at timestamp (uses settings_history "lookback"),
 * then returns that config's per-gate assignments.
 * Returns rows with metadata: [{ changed_at, config_id, config_name, gate_number, recipe_id, recipe_name, program_id }]
 */
function getAssignmentsAtChangeBefore(tsIso, programId = null) {
  // Convert ISO timestamp to SQLite format
  const tsSqlite = new Date(tsIso).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  
  // First, find the most recent config change before the timestamp
  let findConfigSql = `
    SELECT sh.active_config_id, sh.changed_at
    FROM settings_history sh
    JOIN run_configs rc ON rc.id = sh.active_config_id
    WHERE sh.changed_at <= ?
      AND sh.active_config_id IS NOT NULL`;
  const params = [tsSqlite];
  if (programId !== null) { 
    findConfigSql += ' AND rc.program_id = ?'; 
    params.push(programId); 
  }
  findConfigSql += ' ORDER BY sh.changed_at DESC LIMIT 1';
  
  const mostRecentConfig = db.prepare(findConfigSql).get(...params);
  
  if (!mostRecentConfig) {
    return []; // No config found before this timestamp
  }
  
  // Now get ALL gate assignments for this specific config
  const sql = `
    SELECT 
      ? AS changed_at,
      ? AS config_id,
      rc.name AS config_name,
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name,
      rc.program_id
    FROM run_config_assignments rca
    JOIN run_configs rc ON rc.id = ?
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE rca.config_id = ?
    ORDER BY rca.gate_number ASC`;
  
  return db.prepare(sql).all(
    mostRecentConfig.changed_at, 
    mostRecentConfig.active_config_id,
    mostRecentConfig.active_config_id,
    mostRecentConfig.active_config_id
  );
}

/** All assignment changes for a program (most recent first) */
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
  getAssignmentsSnapshotAt,     // ← use this for "what's active right now"
  getAssignmentsAtChangeBefore, // ← use this when you want the config metadata
  getAssignmentsByProgram,
  isProgramActiveAt,            // ← check if any program is active at a given time
};