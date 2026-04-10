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
      role          TEXT NOT NULL CHECK(role IN ('admin','manager','operator','customer')),
      name          TEXT NOT NULL,
      permissions   TEXT,
      customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
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
      display_name          TEXT,
      is_favorite           INTEGER DEFAULT 0,
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
    -- Totals per (program, recipe, order)
    -- order_id allows tracking stats separately for orders vs regular recipes with same recipe_id
    CREATE TABLE IF NOT EXISTS recipe_stats (
      program_id INTEGER NOT NULL,
      recipe_id  INTEGER NOT NULL,
      order_id   INTEGER,                                       -- NULL for regular recipes, set for orders
      total_batches INTEGER NOT NULL DEFAULT 0,                -- (1)
      total_batched_weight_g INTEGER NOT NULL DEFAULT 0,       -- (2)
      total_reject_weight_g INTEGER NOT NULL DEFAULT 0,        -- (3)
      total_giveaway_weight_g INTEGER NOT NULL DEFAULT 0,      -- (4)
      total_items_batched INTEGER NOT NULL DEFAULT 0,          -- (7)
      total_items_rejected INTEGER NOT NULL DEFAULT 0,         -- (8)
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (program_id, recipe_id, COALESCE(order_id, 0)),
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id)  REFERENCES recipes(id)  ON DELETE CASCADE,
      FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE SET NULL
    );
  `);

  // Migration: Add order_id column to recipe_stats if it doesn't exist
  const recipeStatsColumns = db.prepare("PRAGMA table_info(recipe_stats)").all();
  if (!recipeStatsColumns.find(c => c.name === 'order_id')) {
    console.log('[SQLite] Adding order_id column to recipe_stats table...');
    run(`ALTER TABLE recipe_stats ADD COLUMN order_id INTEGER;`);
  }

  // Migration: Add order_id column to batch_completions if it doesn't exist
  const batchCompletionsColumns = db.prepare("PRAGMA table_info(batch_completions)").all();
  if (!batchCompletionsColumns.find(c => c.name === 'order_id')) {
    console.log('[SQLite] Adding order_id column to batch_completions table...');
    run(`ALTER TABLE batch_completions ADD COLUMN order_id INTEGER;`);
    run(`CREATE INDEX IF NOT EXISTS idx_batch_completions_order ON batch_completions(order_id);`);
  }

  // Migration: Add gates_assigned column to recipe_stats if it doesn't exist
  const recipeStatsColumnsAll = db.prepare("PRAGMA table_info(recipe_stats)").all();
  if (!recipeStatsColumnsAll.find(c => c.name === 'gates_assigned')) {
    console.log('[SQLite] Adding gates_assigned column to recipe_stats table...');
    run(`ALTER TABLE recipe_stats ADD COLUMN gates_assigned TEXT DEFAULT '';`);
  }

  // Migration: Add completed column to recipe_stats (1 = recipe finished its run, 0 = still active when program ended)
  if (!recipeStatsColumnsAll.find(c => c.name === 'completed')) {
    console.log('[SQLite] Adding completed column to recipe_stats table...');
    run(`ALTER TABLE recipe_stats ADD COLUMN completed INTEGER NOT NULL DEFAULT 1;`);
  }

  // Migration: Add status column to batch_completions ('completed' or 'terminated')
  if (!columnExists('batch_completions', 'status')) {
    console.log('[SQLite] Adding status column to batch_completions table...');
    run(`ALTER TABLE batch_completions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';`);
  }

  run(`

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

    -- Individual gate dwell times (per-batch inter-arrival times for boxplot visualization)
    CREATE TABLE IF NOT EXISTS gate_dwell_times (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id      INTEGER NOT NULL,
      gate_number     INTEGER NOT NULL,
      dwell_time_sec  REAL    NOT NULL,
      batch_timestamp TEXT,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gate_dwell_program ON gate_dwell_times(program_id);
    CREATE INDEX IF NOT EXISTS idx_gate_dwell_gate ON gate_dwell_times(program_id, gate_number);

    -- Batch completions (single source of truth for batch events)
    CREATE TABLE IF NOT EXISTS batch_completions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      gate         INTEGER NOT NULL,
      completed_at TEXT NOT NULL,              -- ISO timestamp
      pieces       INTEGER NOT NULL,
      weight_g     REAL NOT NULL,
      recipe_id    INTEGER NOT NULL,
      order_id     INTEGER,                    -- NULL for regular recipes, set for orders
      program_id   INTEGER,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id)  REFERENCES orders(id)  ON DELETE SET NULL,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batch_completions_time ON batch_completions(completed_at);
    CREATE INDEX IF NOT EXISTS idx_batch_completions_gate ON batch_completions(gate);
    CREATE INDEX IF NOT EXISTS idx_batch_completions_order ON batch_completions(order_id);

    -- Gate acknowledgment KPIs (operator response times)
    CREATE TABLE IF NOT EXISTS gate_acknowledgments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      gate                INTEGER NOT NULL,
      program_id          INTEGER,
      recipe_id           TEXT,
      order_id            INTEGER,
      batch_filled_at     TEXT NOT NULL,
      acknowledged_at     TEXT NOT NULL,
      response_time_ms    INTEGER NOT NULL,
      was_blocked         INTEGER NOT NULL DEFAULT 0,
      blocked_at          TEXT,
      blocked_duration_ms INTEGER,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL,
      FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gate_ack_program ON gate_acknowledgments(program_id);
    CREATE INDEX IF NOT EXISTS idx_gate_ack_gate ON gate_acknowledgments(gate);

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
      COALESCE(g.gates_assigned, rs.gates_assigned, '') AS gates_assigned,
      rs.order_id,                                             -- For composite key
      c.name AS customer_name,                                 -- Customer name for orders
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
    LEFT JOIN gates g ON g.program_id = rs.program_id AND g.recipe_id = rs.recipe_id
    LEFT JOIN orders o ON o.id = rs.order_id
    LEFT JOIN customers c ON c.id = o.customer_id;

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
  if (!columnExists('machine_state', 'order_queue')) {
    run(`ALTER TABLE machine_state ADD COLUMN order_queue TEXT DEFAULT '[]';`);
  }
  if (!columnExists('machine_state', 'gate_snapshot')) {
    run(`ALTER TABLE machine_state ADD COLUMN gate_snapshot TEXT DEFAULT '[]';`);
  }
  if (!columnExists('machine_state', 'paused_gates')) {
    run(`ALTER TABLE machine_state ADD COLUMN paused_gates TEXT DEFAULT '[]';`);
  }
  if (!columnExists('machine_state', 'weight_tare_g')) {
    run(`ALTER TABLE machine_state ADD COLUMN weight_tare_g REAL DEFAULT 0;`);
  }
  
  console.log('✅ Machine state schema created.');
}

/* --------- saved program templates schema --------- */
function createSavedProgramsSchema() {
  // Table for saved program templates (user-created programs for quick setup)
  run(`
    CREATE TABLE IF NOT EXISTS saved_programs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      display_name TEXT,
      is_favorite INTEGER DEFAULT 0,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_saved_programs_updated_at
    AFTER UPDATE ON saved_programs FOR EACH ROW BEGIN
      UPDATE saved_programs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
  `);
  
  // Table for recipes within saved program templates
  run(`
    CREATE TABLE IF NOT EXISTS saved_program_recipes (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_program_id  INTEGER NOT NULL,
      recipe_id         INTEGER,
      recipe_name       TEXT NOT NULL,
      display_name      TEXT,
      gates             TEXT NOT NULL,
      params            TEXT NOT NULL,
      FOREIGN KEY (saved_program_id) REFERENCES saved_programs(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
    );
  `);
  
  console.log('✅ Saved programs schema created.');
}

/* --------- customers and orders schema --------- */
function createCustomersAndOrdersSchema() {
  // Customers table
  run(`
    CREATE TABLE IF NOT EXISTS customers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      address       TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      notes         TEXT,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS trg_customers_updated_at
    AFTER UPDATE ON customers FOR EACH ROW BEGIN
      UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
  `);
  
  // Link users to customers (for customer accounts)
  if (!columnExists('users', 'customer_id')) {
    run(`ALTER TABLE users ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;`);
    console.log('Added users.customer_id');
  }
  
  // Orders table
  run(`
    CREATE TABLE IF NOT EXISTS orders (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id           INTEGER NOT NULL,
      recipe_id             INTEGER NOT NULL,
      
      -- Original configuration (from recipe)
      piece_min_weight_g    REAL NOT NULL,
      piece_max_weight_g    REAL NOT NULL,
      batch_min_weight_g    REAL,
      batch_max_weight_g    REAL,
      batch_type            TEXT CHECK(batch_type IN ('NA', 'min', 'max', 'exact')),
      batch_value           INTEGER,
      
      -- Production configuration (can be altered during production)
      prod_piece_min_weight_g    REAL,
      prod_piece_max_weight_g    REAL,
      prod_batch_min_weight_g    REAL,
      prod_batch_max_weight_g    REAL,
      prod_batch_type            TEXT CHECK(prod_batch_type IN ('NA', 'min', 'max', 'exact')),
      prod_batch_value           INTEGER,
      
      -- Order details
      requested_batches     INTEGER NOT NULL,
      completed_batches     INTEGER NOT NULL DEFAULT 0,
      
      -- Dates
      created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_date              DATETIME,
      
      -- Status tracking
      status                TEXT NOT NULL DEFAULT 'received' 
                           CHECK(status IN ('received', 'assigned', 'in-production', 'halted', 'completed', 'in-transit', 'arrived')),
      
      -- Status timestamps (JSON: { "received": "...", "assigned": "...", etc })
      status_timestamps     TEXT NOT NULL DEFAULT '{}',
      
      -- Gate assignments (JSON array: [1, 2, 3])
      assigned_gates        TEXT DEFAULT '[]',
      
      updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id)   REFERENCES recipes(id)   ON DELETE RESTRICT
    );
    CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
    AFTER UPDATE ON orders FOR EACH ROW BEGIN
      UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
    
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_due_date ON orders(due_date);
  `);
  
  // Order config history (track limit changes during production)
  run(`
    CREATE TABLE IF NOT EXISTS order_config_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id        INTEGER NOT NULL,
      changed_by      INTEGER,
      changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      
      -- Previous values
      prev_piece_min_weight_g    REAL,
      prev_piece_max_weight_g    REAL,
      prev_batch_min_weight_g    REAL,
      prev_batch_max_weight_g    REAL,
      prev_batch_type            TEXT,
      prev_batch_value           INTEGER,
      
      -- New values
      new_piece_min_weight_g    REAL,
      new_piece_max_weight_g    REAL,
      new_batch_min_weight_g    REAL,
      new_batch_max_weight_g    REAL,
      new_batch_type            TEXT,
      new_batch_value           INTEGER,
      
      note            TEXT,
      
      FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id)    ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_config_history_order ON order_config_history(order_id);
  `);
  
  // Customer-specific recipe lists (which recipes are available for each customer)
  run(`
    CREATE TABLE IF NOT EXISTS customer_recipes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      recipe_id   INTEGER NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (customer_id, recipe_id),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id)   REFERENCES recipes(id)   ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_recipes_customer ON customer_recipes(customer_id);
  `);

  console.log('✅ Customers and orders schema created.');
}

/* --------- seed customer recipes --------- */
function seedCustomerRecipes() {
  const customers = db.prepare('SELECT id FROM customers').all();
  const allRecipes = db.prepare('SELECT id FROM recipes').all();

  if (customers.length === 0 || allRecipes.length === 0) return;

  const existing = db.prepare('SELECT COUNT(*) as cnt FROM customer_recipes').get();
  if (existing.cnt > 0) return;

  const insert = db.prepare('INSERT OR IGNORE INTO customer_recipes (customer_id, recipe_id) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    for (const customer of customers) {
      for (const recipe of allRecipes) {
        insert.run(customer.id, recipe.id);
      }
    }
  });
  transaction();

  // Also copy global favorites to customer favorites
  const favorites = db.prepare('SELECT id FROM recipes WHERE is_favorite = 1').all();
  if (favorites.length > 0) {
    const updateFav = db.prepare('UPDATE customer_recipes SET is_favorite = 1 WHERE recipe_id = ? AND customer_id = ?');
    for (const customer of customers) {
      for (const fav of favorites) {
        updateFav.run(fav.id, customer.id);
      }
    }
  }

  console.log(`✅ Seeded customer_recipes for ${customers.length} customers with ${allRecipes.length} recipes each.`);
}

/* --------- update users role constraint --------- */
function updateUsersRoleConstraint() {
  // SQLite doesn't support modifying CHECK constraints easily
  // So we check if customer role is already allowed by trying to find it
  // If the schema was created fresh, it will already have the right constraint
  // For existing databases, we need to recreate the table (complex)
  // For now, we'll just note that new databases will have the correct constraint
  // and existing ones may need manual migration
  console.log('ℹ️ Note: Users table now supports "customer" role in new databases.');
}

/* -------------- piece log (ring buffer for live pieces table) -------------- */
function createPieceLogSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS piece_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      piece_id        INTEGER NOT NULL,
      gate            INTEGER NOT NULL,
      weight_g        REAL NOT NULL,
      length_mm       REAL,
      status          TEXT NOT NULL DEFAULT 'batched',
      calculation_time_ms REAL,
      is_last_piece   INTEGER NOT NULL DEFAULT 0,
      recipe_name     TEXT,
      order_id        INTEGER,
      program_id      INTEGER,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_piece_log_created ON piece_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_piece_log_id_desc ON piece_log(id DESC);
  `);

  if (!columnExists('piece_log', 'length_mm')) {
    run(`ALTER TABLE piece_log ADD COLUMN length_mm REAL;`);
    console.log('Added piece_log.length_mm');
  }

  console.log('✅ piece_log schema ready.');
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
  createSavedProgramsSchema();
  createCustomersAndOrdersSchema();
  updateUsersRoleConstraint();
  seedCustomerRecipes();
  createPieceLogSchema();
  console.log('✅ SQLite setup complete.');
}
main();