// server/scripts/sqlite-setup.js
// One-shot SQLite setup: base schema + seed + active-config + KPI schema (idempotent)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db/sqlite');
const bcrypt = require('bcryptjs');

/* ----------------- helpers ----------------- */
function run(sql) { db.exec(sql); }
function tableExists(name) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
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
      permissions   TEXT,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
    AFTER UPDATE ON users FOR EACH ROW BEGIN
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
    AFTER UPDATE ON recipes FOR EACH ROW BEGIN
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
    AFTER UPDATE ON programs FOR EACH ROW BEGIN
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
    AFTER UPDATE ON settings FOR EACH ROW BEGIN
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

  console.log('Seeding users only...');

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

  console.log('✅ Users seeded. Recipes and programs will be loaded by Python worker.');
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
  if (!s) return;
  if (s.active_config_id) return;
  if (!s.active_program_id) return;

  const prog = db.prepare(`SELECT id, name FROM programs WHERE id = ?`).get(s.active_program_id);
  if (!prog) return;

  const info = db.prepare(`
    INSERT INTO run_configs (name, source, program_id)
    VALUES (?, 'program', ?)
  `).run(`Initial from ${prog.name}`, prog.id);
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

  // make sure there's at least one row in settings; active_config_id can be filled later
  db.prepare(`
    INSERT INTO settings (mode, active_config_id)
    SELECT 'preset', NULL
    WHERE NOT EXISTS (SELECT 1 FROM settings)
  `).run();

  db.prepare(`
    UPDATE settings SET mode='preset', active_config_id = ?
    WHERE id = (SELECT id FROM settings ORDER BY id LIMIT 1)
  `).run(newConfigId);
  db.prepare(`
    INSERT INTO settings_history (mode, active_config_id, note)
    VALUES (?, ?, ?)
  `).run(s.mode || 'preset', newConfigId, 'Bootstrapped from existing active_program_id');

  console.log(`Seeded run_config #${newConfigId} from "${prog.name}".`);
}

/* -------------- KPI schema (11 items + gate dwell) -------------- */
function createStatisticsSchema() {
  run(`
    -- Totals per program
    CREATE TABLE IF NOT EXISTS program_stats (
      program_id INTEGER PRIMARY KEY,
      total_batches INTEGER NOT NULL DEFAULT 0,                -- (1)
      total_batched_weight_g INTEGER NOT NULL DEFAULT 0,       -- (2)
      total_reject_weight_g INTEGER NOT NULL DEFAULT 0,        -- (3)
      total_giveaway_weight_g INTEGER NOT NULL DEFAULT 0,      -- (4)
      total_items_batched INTEGER NOT NULL DEFAULT 0,          -- (7)
      total_items_rejected INTEGER NOT NULL DEFAULT 0,         -- (8)
      start_ts TEXT,                                           -- window start (ISO minute)
      end_ts   TEXT,                                           -- window end   (ISO minute)
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
    );
  `);

  // Make sure start/end columns exist on old DBs
  if (!columnExists('program_stats', 'start_ts')) {
    run(`ALTER TABLE program_stats ADD COLUMN start_ts TEXT;`);
  }
  if (!columnExists('program_stats', 'end_ts')) {
    run(`ALTER TABLE program_stats ADD COLUMN end_ts TEXT;`);
  }

  run(`
    -- Totals per (program, recipe)
    CREATE TABLE IF NOT EXISTS recipe_stats (
      program_id INTEGER NOT NULL,
      recipe_id  INTEGER NOT NULL,
      total_batches INTEGER NOT NULL DEFAULT 0,                -- (1)
      total_batched_weight_g INTEGER NOT NULL DEFAULT 0,       -- (2)
      total_reject_weight_g INTEGER NOT NULL DEFAULT 0,        -- (3)
      total_giveaway_weight_g INTEGER NOT NULL DEFAULT 0,      -- (4)
      total_items_batched INTEGER NOT NULL DEFAULT 0,          -- (7)
      total_items_rejected INTEGER NOT NULL DEFAULT 0,         -- (8)
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (program_id, recipe_id),
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE CASCADE
    );

    -- Gate dwell accumulators (min/max/avg/std via Welford)
    CREATE TABLE IF NOT EXISTS gate_dwell_accumulators (
      program_id    INTEGER NOT NULL,
      gate_number   INTEGER NOT NULL,  -- 0..N (0 = reject)
      sample_count  INTEGER NOT NULL DEFAULT 0,
      mean_sec      REAL    NOT NULL DEFAULT 0,
      m2_sec        REAL    NOT NULL DEFAULT 0,
      min_sec       REAL,
      max_sec       REAL,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (program_id, gate_number),
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
    );

    -- Batch completions (single source of truth for batch events)
    CREATE TABLE IF NOT EXISTS batch_completions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      gate         INTEGER NOT NULL,
      completed_at TEXT NOT NULL,              -- ISO timestamp
      pieces       INTEGER NOT NULL,
      weight_g     REAL NOT NULL,
      recipe_id    INTEGER NOT NULL,
      program_id   INTEGER,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batch_completions_time ON batch_completions(completed_at);
    CREATE INDEX IF NOT EXISTS idx_batch_completions_gate ON batch_completions(gate);
    
    -- M3 KPI tables (per-minute data, migrated from InfluxDB to SQLite)
    CREATE TABLE IF NOT EXISTS kpi_minute_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      program_id INTEGER,
      batches_min REAL DEFAULT 0,
      giveaway_pct REAL DEFAULT 0,
      pieces_processed INTEGER DEFAULT 0,
      weight_processed_g REAL DEFAULT 0,
      rejects_per_min REAL DEFAULT 0,
      total_rejects_count INTEGER DEFAULT 0,
      total_rejects_weight_g REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_min_recipes_time ON kpi_minute_recipes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_min_recipes_recipe ON kpi_minute_recipes(recipe_name, timestamp);
    
    CREATE TABLE IF NOT EXISTS kpi_minute_combined (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      batches_min REAL DEFAULT 0,
      giveaway_pct REAL DEFAULT 0,
      pieces_processed INTEGER DEFAULT 0,
      weight_processed_g REAL DEFAULT 0,
      rejects_per_min REAL DEFAULT 0,
      total_rejects_count INTEGER DEFAULT 0,
      total_rejects_weight_g REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_min_combined_time ON kpi_minute_combined(timestamp);
    
    -- M4 KPI table (cumulative totals per recipe)
    CREATE TABLE IF NOT EXISTS kpi_totals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      program_id INTEGER,
      total_batches INTEGER DEFAULT 0,
      giveaway_g_per_batch REAL DEFAULT 0,
      giveaway_pct_avg REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_totals_time ON kpi_totals(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_totals_recipe ON kpi_totals(recipe_name, timestamp);
  `);

  // ---------- Views ----------
  run(`
    DROP VIEW IF EXISTS program_stats_view;
    CREATE VIEW program_stats_view AS
    SELECT
      ps.program_id,
      p.name AS program_name,
      ps.start_ts,
      ps.end_ts,
      ps.total_batches,                                        -- (1)
      ps.total_batched_weight_g,                               -- (2)
      ps.total_reject_weight_g,                                -- (3)
      ps.total_giveaway_weight_g,                              -- (4)
      (ps.total_batched_weight_g + ps.total_giveaway_weight_g)
        AS total_weight_processed_g,                           -- (5)
      (ps.total_batched_weight_g + ps.total_giveaway_weight_g + ps.total_reject_weight_g)
        AS total_weight_g,                                     -- (6)
      ps.total_items_batched,                                  -- (7)
      ps.total_items_rejected,                                 -- (8)
      (ps.total_items_batched + ps.total_items_rejected)
        AS total_items_processed,                              -- (9)
      CASE
        WHEN (ps.total_batched_weight_g + ps.total_giveaway_weight_g + ps.total_reject_weight_g) > 0
          THEN ROUND( (ps.total_giveaway_weight_g * 100.0)
                     / (ps.total_batched_weight_g + ps.total_giveaway_weight_g + ps.total_reject_weight_g), 4)
        ELSE 0
      END AS total_giveaway_pct,                               -- (10)
      ps.updated_at
    FROM program_stats ps
    JOIN programs p ON p.id = ps.program_id;

    DROP VIEW IF EXISTS recipe_stats_view;
    CREATE VIEW recipe_stats_view AS
    WITH gates AS (
      SELECT rc.program_id,
             rca.recipe_id,
             GROUP_CONCAT(gn, ',') AS gates_assigned
      FROM (
        SELECT config_id, recipe_id, gate_number AS gn
        FROM run_config_assignments
        ORDER BY gn
      ) rca
      JOIN run_configs rc ON rc.id = rca.config_id
      GROUP BY rc.program_id, rca.recipe_id
    )
    SELECT
      rs.program_id,
      r.name AS recipe_name,
      COALESCE(g.gates_assigned, '') AS gates_assigned,
      rs.total_batches,                                        -- (1)
      rs.total_batched_weight_g,                               -- (2)
      rs.total_reject_weight_g,                                -- (3)
      rs.total_giveaway_weight_g,                              -- (4)
      (rs.total_batched_weight_g + rs.total_giveaway_weight_g)
        AS total_weight_processed_g,                           -- (5)
      (rs.total_batched_weight_g + rs.total_giveaway_weight_g + rs.total_reject_weight_g)
        AS total_weight_g,                                     -- (6)
      rs.total_items_batched,                                  -- (7)
      rs.total_items_rejected,                                 -- (8)
      (rs.total_items_batched + rs.total_items_rejected)
        AS total_items_processed,                              -- (9)
      CASE
        WHEN (rs.total_batched_weight_g + rs.total_giveaway_weight_g + rs.total_reject_weight_g) > 0
          THEN ROUND( (rs.total_giveaway_weight_g * 100.0)
                     / (rs.total_batched_weight_g + rs.total_giveaway_weight_g + rs.total_reject_weight_g), 4)
        ELSE 0
      END AS total_giveaway_pct,                               -- (10)
      rs.updated_at
    FROM recipe_stats rs
    JOIN recipes r ON r.id = rs.recipe_id
    LEFT JOIN gates g ON g.program_id = rs.program_id AND g.recipe_id = rs.recipe_id;

    -- Lightweight alias view used by CSV export
    DROP VIEW IF EXISTS recipe_stats_report;
    CREATE VIEW recipe_stats_report AS
    SELECT * FROM recipe_stats_view;

    DROP VIEW IF EXISTS gate_dwell_stats;
    CREATE VIEW gate_dwell_stats AS
    SELECT
      program_id,
      gate_number,
      min_sec,
      max_sec,
      mean_sec AS avg_sec,
      CASE WHEN sample_count > 1 THEN sqrt(m2_sec / (sample_count - 1)) ELSE 0 END AS std_sec,
      sample_count,
      updated_at
    FROM gate_dwell_accumulators;

    -- Assignment history view (replaces M5 from InfluxDB)
    DROP VIEW IF EXISTS assignment_history_view;
    CREATE VIEW assignment_history_view AS
    SELECT
      sh.changed_at,
      sh.active_config_id AS config_id,
      rc.name AS config_name,
      rc.program_id,
      p.name AS program_name,
      rca.gate_number,
      rca.recipe_id,
      r.name AS recipe_name,
      sh.note,
      sh.user_id
    FROM settings_history sh
    LEFT JOIN run_configs rc ON rc.id = sh.active_config_id
    LEFT JOIN programs p ON p.id = rc.program_id
    LEFT JOIN run_config_assignments rca ON rca.config_id = rc.id
    LEFT JOIN recipes r ON r.id = rca.recipe_id
    WHERE sh.active_config_id IS NOT NULL
    ORDER BY sh.changed_at DESC, rca.gate_number ASC;
  `);

  // NOTE: the old trigger that derived start/end from program_throughput_minute
  // is intentionally removed because those minute tables no longer exist.
}

/* -------------------- seed default program -------------------- */
function seedDefaultProgramIfEmpty() {
  // ⚠️ REMOVED: No longer seed recipes or programs at startup
  // The Python worker will be the single source of truth for recipes and programs
  console.log('⏩ Skipping recipe/program seed. Python worker will load them.');
}

/* -------------- add display_name to recipes -------------- */
function addRecipeDisplayName() {
  if (!columnExists('recipes', 'display_name')) {
    run(`ALTER TABLE recipes ADD COLUMN display_name TEXT;`);
    console.log('Added recipes.display_name');
  }
}

/* -------------- machine state schema -------------- */
function createMachineStateSchema() {
  run(`
    -- Machine state table (singleton)
    CREATE TABLE IF NOT EXISTS machine_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'running', 'paused', 'transitioning')),
      current_program_id INTEGER,
      active_recipes TEXT, -- JSON array of recipe objects (current target)
      program_start_recipes TEXT, -- JSON snapshot for comparison
      transitioning_gates TEXT, -- JSON array of gate numbers currently transitioning
      transition_start_recipes TEXT, -- JSON map {gate: recipe} for original recipes at transition start
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (current_program_id) REFERENCES programs(id) ON DELETE SET NULL
    );
    
    -- Ensure singleton row exists
    INSERT OR IGNORE INTO machine_state (id, state, active_recipes, program_start_recipes, transitioning_gates, transition_start_recipes)
    VALUES (1, 'idle', '[]', '[]', '[]', '{}');
  `);
  
  // Add new columns if they don't exist (for existing databases)
  if (!columnExists('machine_state', 'transitioning_gates')) {
    run(`ALTER TABLE machine_state ADD COLUMN transitioning_gates TEXT DEFAULT '[]';`);
  }
  if (!columnExists('machine_state', 'transition_start_recipes')) {
    run(`ALTER TABLE machine_state ADD COLUMN transition_start_recipes TEXT DEFAULT '{}';`);
  }
  if (!columnExists('machine_state', 'registered_transitioning_gates')) {
    run(`ALTER TABLE machine_state ADD COLUMN registered_transitioning_gates TEXT DEFAULT '[]';`);
  }
  
  console.log('✅ Machine state schema created.');
}

/* ---------------------- main ---------------------- */
function main() {
  createBaseSchema();
  seedIfEmpty();
  createActiveConfigSchema();
  seedInitialActiveConfigIfMissing();
  createStatisticsSchema();
  createMachineStateSchema();
  seedDefaultProgramIfEmpty();
  addRecipeDisplayName();
  console.log('✅ SQLite setup complete.');
}
main();