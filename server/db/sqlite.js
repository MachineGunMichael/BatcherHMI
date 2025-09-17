// server/db/sqlite.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Database = require('better-sqlite3');

// Resolve DB file path to an absolute path relative to /server
const relPath = process.env.SQLITE_DB_PATH || 'db/sqlite/batching_app.sqlite';
const absPath = path.isAbsolute(relPath)
  ? relPath
  : path.join(__dirname, '..', relPath);

// Ensure folder exists
fs.mkdirSync(path.dirname(absPath), { recursive: true });

// Open DB and switch to WAL (safer concurrent reads)
const db = new Database(absPath);
db.pragma('journal_mode = WAL');

// Expose the absolute path for logging/debug
db.filePath = absPath;

// Helpful one-time log
if (!process.env.SILENCE_SQLITE_LOGS) {
  console.log('[SQLite] Using database at:', absPath);
}

module.exports = db;