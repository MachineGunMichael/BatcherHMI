const db = require('../db/sqlite');

// ensure settings + outbox tables (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    mode              TEXT NOT NULL CHECK(mode IN ('preset','manual')) DEFAULT 'preset',
    active_program_id INTEGER,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (active_program_id) REFERENCES programs(id) ON DELETE SET NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
  AFTER UPDATE ON settings
  FOR EACH ROW BEGIN
    UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END;

  CREATE TABLE IF NOT EXISTS outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched  INTEGER NOT NULL DEFAULT 0
  );
`);

const q = {
  one: db.prepare(`SELECT * FROM settings ORDER BY id ASC LIMIT 1`),
  insertDefault: db.prepare(`INSERT INTO settings (mode, active_program_id) VALUES ('preset', NULL)`),
  update: db.prepare(`
    UPDATE settings
    SET mode = COALESCE(@mode, mode),
        active_program_id = COALESCE(@active_program_id, active_program_id)
    WHERE id = @id
  `),
  addOutbox: db.prepare(`INSERT INTO outbox (event_type, payload) VALUES (?, ?)`),
  getNewOutbox: db.prepare(`SELECT * FROM outbox WHERE dispatched = 0 ORDER BY id ASC LIMIT ?`),
  markDispatched: db.prepare(`UPDATE outbox SET dispatched = 1 WHERE id IN ($ids)`),
};

function ensureOne() {
  let row = q.one.get();
  if (!row) {
    q.insertDefault.run();
    row = q.one.get();
  }
  return row;
}

function getSettings() {
  return ensureOne();
}

function updateSettings({ mode, active_program_id }) {
  const current = ensureOne();
  q.update.run({
    id: current.id,
    mode: mode ?? null,
    active_program_id: Number.isInteger(active_program_id) ? active_program_id : null
  });

  const updated = q.one.get();
  // enqueue outbox event
  q.addOutbox.run('settings.changed', JSON.stringify(updated));
  return updated;
}

function getPendingOutbox(limit = 50) {
  return q.getNewOutbox.all(limit);
}

function markOutboxDispatched(ids = []) {
  if (!ids.length) return;
  const placeholder = ids.join(',');
  db.prepare(`UPDATE outbox SET dispatched = 1 WHERE id IN (${placeholder})`).run();
}

module.exports = {
  getSettings,
  updateSettings,
  getPendingOutbox,
  markOutboxDispatched
};