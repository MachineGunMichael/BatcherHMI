// server/scripts/sqlite-setup.js
// One-shot SQLite setup: base schema + seed + active-config migration (idempotent)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db/sqlite');
const bcrypt = require('bcryptjs');

/* ----------------- helpers ----------------- */
function run(sql) { db.exec(sql); }

function tableExists(name) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
  ).get(name);
  return !!row;
}

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === column);
}

/* --------------- base schema --------------- */
function createBaseSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('admin','manager','operator')),
      name          TEXT NOT NULL,
      permissions   TEXT, -- JSON string
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
    AFTER UPDATE ON users
    FOR EACH ROW BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS recipes (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL UNIQUE,
      piece_min_weight_g    REAL NOT NULL,
      piece_max_weight_g    REAL NOT NULL,
      batch_min_weight_g    REAL,
      batch_max_weight_g    REAL,
      min_pieces_per_batch  INTEGER,
      max_pieces_per_batch  INTEGER,
      created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_recipes_updated_at
    AFTER UPDATE ON recipes
    FOR EACH ROW BEGIN
      UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS programs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      gates      INTEGER NOT NULL DEFAULT 8,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_programs_updated_at
    AFTER UPDATE ON programs
    FOR EACH ROW BEGIN
      UPDATE programs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS program_gate_recipes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id  INTEGER NOT NULL,
      gate_number INTEGER NOT NULL,  -- 0 = reject
      recipe_id   INTEGER NOT NULL,
      UNIQUE (program_id, gate_number),
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE RESTRICT
    );

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
  `);
}

/* ------------------- seed ------------------- */
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) {
    console.log('SQLite already seeded. Skipping seed.');
    return;
  }

  console.log('Seeding users, recipes, program, settings...');

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, name, permissions)
    VALUES (@username, @password_hash, @role, @name, @permissions)
  `);
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  insertUser.run({
    username: 'admin',
    password_hash: hash('admin123'),
    role: 'admin',
    name: 'System Administrator',
    permissions: JSON.stringify(['read','write','execute','configure']),
  });
  insertUser.run({
    username: 'manager',
    password_hash: hash('manager123'),
    role: 'manager',
    name: 'Production Manager',
    permissions: JSON.stringify(['read','write','execute']),
  });
  insertUser.run({
    username: 'operator',
    password_hash: hash('operator123'),
    role: 'operator',
    name: 'Line Operator',
    permissions: JSON.stringify(['read','execute']),
  });

  const insertRecipe = db.prepare(`
    INSERT INTO recipes
      (name, piece_min_weight_g, piece_max_weight_g,
       batch_min_weight_g, batch_max_weight_g,
       min_pieces_per_batch, max_pieces_per_batch)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const names = ['Program A','Program B','Program C','Program D'];
  const ranges = [[18,22],[22,26],[26,30],[30,34]];
  names.forEach((n, i) => insertRecipe.run(n, ranges[i][0], ranges[i][1], null, null, null, null));

  const programId = db.prepare(`INSERT INTO programs (name, gates) VALUES ('Default Program', 8)`).run().lastInsertRowid;

  const recipeIdByName = (name) => db.prepare(`SELECT id FROM recipes WHERE name=?`).get(name).id;
  const insertPGR = db.prepare(`
    INSERT INTO program_gate_recipes (program_id, gate_number, recipe_id)
    VALUES (?, ?, ?)
  `);

  // Example mapping (adjust as you like)
  insertPGR.run(programId, 0, recipeIdByName('Program A')); // you can treat gate 0 specially (reject)
  insertPGR.run(programId, 1, recipeIdByName('Program A'));
  insertPGR.run(programId, 2, recipeIdByName('Program B'));
  insertPGR.run(programId, 3, recipeIdByName('Program C'));
  insertPGR.run(programId, 4, recipeIdByName('Program D'));
  insertPGR.run(programId, 5, recipeIdByName('Program A'));
  insertPGR.run(programId, 6, recipeIdByName('Program B'));
  insertPGR.run(programId, 7, recipeIdByName('Program C'));
  insertPGR.run(programId, 8, recipeIdByName('Program D'));

  db.prepare(`INSERT INTO settings (mode, active_program_id) VALUES ('preset', ?)`).run(programId);

  console.log('Seed complete.');
}

/* -------------- active setup + history -------------- */
function createActiveConfigSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS run_configs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT,
      source      TEXT NOT NULL CHECK (source IN ('program','manual')),
      program_id  INTEGER,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (program_id) REFERENCES programs(id)
    );

    CREATE TABLE IF NOT EXISTS run_config_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      config_id   INTEGER NOT NULL,
      gate_number INTEGER NOT NULL,
      recipe_id   INTEGER, -- NULL means "empty gate"
      UNIQUE (config_id, gate_number),
      FOREIGN KEY (config_id) REFERENCES run_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS settings_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      changed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id          INTEGER,
      mode             TEXT NOT NULL CHECK (mode IN ('preset','manual')),
      active_config_id INTEGER,
      note             TEXT,
      FOREIGN KEY (user_id)          REFERENCES users(id),
      FOREIGN KEY (active_config_id) REFERENCES run_configs(id)
    );
  `);

  if (!columnExists('settings', 'active_config_id')) {
    run(`ALTER TABLE settings ADD COLUMN active_config_id INTEGER;`);
    console.log('Added settings.active_config_id');
  }
}

function seedInitialActiveConfigIfMissing() {
  const s = db.prepare(`SELECT mode, active_program_id, active_config_id FROM settings LIMIT 1`).get();
  if (!s) {
    console.log('No settings row; skipping active config bootstrap.');
    return;
  }
  if (s.active_config_id) {
    console.log('active_config_id already set; skipping bootstrap.');
    return;
  }
  if (!s.active_program_id) {
    console.log('No active_program_id; skipping bootstrap.');
    return;
  }

  const prog = db.prepare(`SELECT id, name FROM programs WHERE id = ?`).get(s.active_program_id);
  if (!prog) {
    console.log('active_program_id points to missing program; skipping.');
    return;
  }

  const insertConfig = db.prepare(`
    INSERT INTO run_configs (name, source, program_id)
    VALUES (?, 'program', ?)
  `);
  const info = insertConfig.run(`Initial from ${prog.name}`, prog.id);
  const newConfigId = info.lastInsertRowid;

  const pgrRows = db.prepare(`
    SELECT gate_number, recipe_id
    FROM program_gate_recipes
    WHERE program_id = ?
    ORDER BY gate_number
  `).all(prog.id);

  const insertAssign = db.prepare(`
    INSERT INTO run_config_assignments (config_id, gate_number, recipe_id)
    VALUES (?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach(r => insertAssign.run(newConfigId, r.gate_number, r.recipe_id));
  });
  tx(pgrRows);

  db.prepare(`UPDATE settings SET active_config_id = ?`).run(newConfigId);
  db.prepare(`
    INSERT INTO settings_history (mode, active_config_id, note)
    VALUES (?, ?, ?)
  `).run(s.mode || 'preset', newConfigId, 'Bootstrapped from existing active_program_id');

  console.log(`Seeded run_config #${newConfigId} from "${prog.name}".`);
}

/* ---------------------- main ---------------------- */
function main() {
  // Create base schema first
  createBaseSchema();

  // Seed only if empty
  seedIfEmpty();

  // Create active-config schema & seed initial config from program
  createActiveConfigSchema();
  seedInitialActiveConfigIfMissing();

  console.log('✅ SQLite setup complete.');
}

main();