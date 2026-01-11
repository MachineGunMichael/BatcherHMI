require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const log = require('./lib/logger');
const influx = require('./services/influx');
const db = require('./db/sqlite');

// --- Database migrations (run at startup) ---
function runMigrations() {
  try {
    // Check which columns exist in machine_state
    const columns = db.prepare(`PRAGMA table_info(machine_state)`).all();
    const hasTransitioningGates = columns.some(c => c.name === 'transitioning_gates');
    const hasTransitionStartRecipes = columns.some(c => c.name === 'transition_start_recipes');
    const hasTransitionOldProgramId = columns.some(c => c.name === 'transition_old_program_id');
    const hasCompletedTransitionGates = columns.some(c => c.name === 'completed_transition_gates');
    
    if (!hasTransitioningGates) {
      log.system('migration', 'Adding column transitioning_gates', { column: 'transitioning_gates' });
      db.prepare(`ALTER TABLE machine_state ADD COLUMN transitioning_gates TEXT DEFAULT '[]'`).run();
      log.system('migration', 'Column transitioning_gates added', { column: 'transitioning_gates' });
    }
    
    if (!hasTransitionStartRecipes) {
      log.system('migration', 'Adding column transition_start_recipes', { column: 'transition_start_recipes' });
      db.prepare(`ALTER TABLE machine_state ADD COLUMN transition_start_recipes TEXT DEFAULT '{}'`).run();
      log.system('migration', 'Column transition_start_recipes added', { column: 'transition_start_recipes' });
    }
    
    if (!hasTransitionOldProgramId) {
      log.system('migration', 'Adding column transition_old_program_id', { column: 'transition_old_program_id' });
      db.prepare(`ALTER TABLE machine_state ADD COLUMN transition_old_program_id INTEGER DEFAULT NULL`).run();
      log.system('migration', 'Column transition_old_program_id added', { column: 'transition_old_program_id' });
    }
    
    if (!hasCompletedTransitionGates) {
      log.system('migration', 'Adding column completed_transition_gates', { column: 'completed_transition_gates' });
      db.prepare(`ALTER TABLE machine_state ADD COLUMN completed_transition_gates TEXT DEFAULT '[]'`).run();
      log.system('migration', 'Column completed_transition_gates added', { column: 'completed_transition_gates' });
    }
  } catch (err) {
    log.error('system', 'migration_error', err);
  }
}

// Run migrations before starting server
runMigrations();

// Clear stale transition state on startup (ensures clean start)
function clearStaleTransitionState() {
  try {
    log.system('clearing_transition_state', 'Clearing stale transition state');
    db.prepare(`
      UPDATE machine_state 
      SET transitioning_gates = '[]',
          transition_start_recipes = '{}',
          completed_transition_gates = '[]',
          transition_old_program_id = NULL
      WHERE id = 1
    `).run();
    log.system('transition_state_cleared', 'Transition state cleared successfully');
  } catch (err) {
    log.error('system', 'startup_error', err);
  }
}

clearStaleTransitionState();

const authRoutes = require('./routes/auth');
const programRoutes = require('./routes/programs');
const settingsRoutes = require('./routes/settings');
const tsRoutes = require('./routes/ts');
const kpiRoutes = require('./routes/kpi');
const stream = require('./routes/stream');
const ingest = require('./routes/ingest');
const statsRoutes = require('./routes/stats');
const assignmentsRoutes = require('./routes/assignments');
const historyRoutes = require('./routes/history');
const importRoutes = require('./routes/import');
const configRoutes = require('./routes/config');
const machineRoutes = require('./routes/machine');
const logsRoutes = require('./routes/logs');

const outbox = require('./workers/outboxDispatcher');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json());

// ------------ health -------------
app.get('/', async (_req, res) => {
  const tsOk = await influx.ping().catch(() => false);
  res.json({
    ok: true,
    service: 'batcher-auth',
    sqlite: true,
    influx: { ok: !!tsOk, host: influx.host, database: influx.database },
    port: PORT
  });
});

// ----------- mount routes --------
app.use('/api/auth', authRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stream', stream);
app.use('/api/ingest', ingest);
app.use('/api/ts', tsRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/import', importRoutes);
app.use('/api/config', configRoutes);
app.use('/api/machine', machineRoutes);
app.use('/api/logs', logsRoutes);

// (optional) keep your earlier debug TS endpoints for convenience:
app.get('/api/ts/health', async (_req, res) => {
  const ok = await influx.ping().catch(() => false);
  res.json({ ok, host: influx.host, database: influx.database });
});

const { verifyToken } = require('./utils/authMiddleware');
app.post('/api/ts/write', verifyToken, async (req, res) => {
  try {
    const { measurement, tags, fields, timestamp } = req.body || {};
    if (!measurement || !fields) {
      return res.status(400).json({ message: 'measurement and fields are required' });
    }
    await influx.writePoint({ measurement, tags, fields, timestamp });
    res.json({ ok: true });
  } catch (e) {
    log.error('system', 'influx_write_error', e);
    res.status(500).json({ message: 'Influx write failed' });
  }
});

app.get('/api/ts/query', verifyToken, async (req, res) => {
  try {
    const sql = String(req.query.sql || '');
    if (!sql.toLowerCase().trim().startsWith('select')) {
      return res.status(400).json({ message: 'Only SELECT queries are allowed' });
    }
    const rows = await influx.query(sql);
    res.json({ rows });
  } catch (e) {
    log.error('system', 'influx_query_error', e);
    res.status(500).json({ message: 'Influx query failed' });
  }
});

// ---------- startup initialization ----------
const gates = require('./state/gates');
const machineState = require('./services/machineState');

// Reset all gates and machine state on server startup
// This ensures a clean slate when the server restarts
function initializeOnStartup() {
  try {
    // Reset all gate states to 0
    gates.resetAll();
    log.system('gates_reset', 'All gate states reset to 0');
    
    // Reset machine state to idle (clears active recipes)
    machineState.reset();
    log.system('machine_state_reset', 'Machine state reset to idle');
  } catch (e) {
    log.error('system', 'startup_initialization_error', e);
  }
}

// ---------- memory monitoring ----------
// Only log warnings when memory gets high (passive monitoring)
setInterval(() => {
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapMB > 1500) {
    log.warn('system', 'high_memory', `Heap: ${heapMB.toFixed(0)} MB`, { heapMB: Math.round(heapMB) });
  }
}, 60 * 1000); // Check every minute

// ---------- start server ----------
app.listen(PORT, () => {
  log.serverStarted(PORT);
  
  // Initialize clean state on startup
  initializeOnStartup();
  
  if (outbox && typeof outbox.start === 'function') {
    outbox.start();
  }
});
