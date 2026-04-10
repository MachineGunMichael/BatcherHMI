// server/lib/pauseTracker.js
// Tracks machine pause/resume intervals for accurate timing calculations.
// Paused durations are subtracted from batch completion time, operator response time,
// and gate blocked time so these KPIs only reflect active running time.

const db = require('../db/sqlite');
const log = require('./logger');

// Ensure table exists (auto-migration)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pause_intervals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id  INTEGER NOT NULL,
      paused_at   TEXT NOT NULL,
      resumed_at  TEXT,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pause_intervals_program ON pause_intervals(program_id);
  `);
} catch (e) {
  console.error('[pauseTracker] Table creation failed:', e.message);
}

/**
 * Record that the machine was paused at the given timestamp.
 */
function recordPause(programId, pausedAtIso) {
  if (!programId) return;
  try {
    db.prepare(`
      INSERT INTO pause_intervals (program_id, paused_at)
      VALUES (?, ?)
    `).run(programId, pausedAtIso);
  } catch (e) {
    log.error('system', 'pause_tracker_record_pause_error', e, { programId });
  }
}

/**
 * Record that the machine was resumed at the given timestamp.
 * Closes the most recent open pause interval for this program.
 */
function recordResume(programId, resumedAtIso) {
  if (!programId) return;
  try {
    db.prepare(`
      UPDATE pause_intervals
      SET resumed_at = ?
      WHERE id = (
        SELECT id FROM pause_intervals
        WHERE program_id = ? AND resumed_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      )
    `).run(resumedAtIso, programId);
  } catch (e) {
    log.error('system', 'pause_tracker_record_resume_error', e, { programId });
  }
}

/**
 * Calculate total paused milliseconds between two ISO timestamps for a program.
 * Handles partial overlaps (pause that started before startIso or hasn't ended yet).
 */
function getPausedMsBetween(programId, startIso, endIso) {
  if (!programId || !startIso || !endIso) return 0;

  try {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (endMs <= startMs) return 0;

    // Fetch all pause intervals for this program that could overlap [startIso, endIso]
    const rows = db.prepare(`
      SELECT paused_at, resumed_at
      FROM pause_intervals
      WHERE program_id = ?
        AND paused_at < ?
        AND (resumed_at IS NULL OR resumed_at > ?)
      ORDER BY paused_at ASC
    `).all(programId, endIso, startIso);

    let totalPausedMs = 0;
    for (const row of rows) {
      const pStart = Math.max(new Date(row.paused_at).getTime(), startMs);
      const pEnd = row.resumed_at
        ? Math.min(new Date(row.resumed_at).getTime(), endMs)
        : endMs; // Still paused → count up to endIso
      if (pEnd > pStart) {
        totalPausedMs += (pEnd - pStart);
      }
    }

    return totalPausedMs;
  } catch (e) {
    log.error('system', 'pause_tracker_get_paused_ms_error', e, { programId });
    return 0;
  }
}

module.exports = {
  recordPause,
  recordResume,
  getPausedMsBetween,
};
