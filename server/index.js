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
    
    const hasGateSnapshot = columns.some(c => c.name === 'gate_snapshot');
    if (!hasGateSnapshot) {
      log.system('migration', 'Adding column gate_snapshot', { column: 'gate_snapshot' });
      db.prepare(`ALTER TABLE machine_state ADD COLUMN gate_snapshot TEXT DEFAULT '[]'`).run();
      log.system('migration', 'Column gate_snapshot added', { column: 'gate_snapshot' });
    }



    // Backfill recipe_stats for completed programs that are missing them
    // (happens when programs were stopped before the gates_assigned column existed)
    const orphanedPrograms = db.prepare(`
      SELECT ps.program_id
      FROM program_stats ps
      WHERE ps.end_ts IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM recipe_stats rs WHERE rs.program_id = ps.program_id)
        AND EXISTS (SELECT 1 FROM batch_completions bc WHERE bc.program_id = ps.program_id)
    `).all();

    if (orphanedPrograms.length > 0) {
      log.system('migration', `Backfilling recipe_stats for ${orphanedPrograms.length} orphaned programs`);
      for (const { program_id } of orphanedPrograms) {
        try {
          const batchStats = db.prepare(`
            SELECT recipe_id, order_id,
              COUNT(*) as total_batches,
              SUM(pieces) as total_items_batched,
              SUM(weight_g) as total_batched_weight_g
            FROM batch_completions
            WHERE program_id = ?
            GROUP BY recipe_id, order_id
          `).all(program_id);

          for (const stats of batchStats) {
            const recipe = db.prepare(`SELECT batch_min_weight_g FROM recipes WHERE id = ?`).get(stats.recipe_id);
            let giveaway = 0;
            if (recipe && recipe.batch_min_weight_g) {
              giveaway = Math.max(0, stats.total_batched_weight_g - recipe.batch_min_weight_g * stats.total_batches);
            }
            const gatesRow = db.prepare(`
              SELECT GROUP_CONCAT(DISTINCT gate) as gates FROM batch_completions
              WHERE program_id = ? AND recipe_id = ? AND gate > 0
            `).get(program_id, stats.recipe_id);

            db.prepare(`
              INSERT INTO recipe_stats (program_id, recipe_id, order_id, gates_assigned,
                total_batches, total_batched_weight_g, total_reject_weight_g, total_giveaway_weight_g,
                total_items_batched, total_items_rejected)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
            `).run(program_id, stats.recipe_id, stats.order_id || null, gatesRow?.gates || '',
              stats.total_batches, stats.total_batched_weight_g, giveaway, stats.total_items_batched);
          }
          log.system('migration', `Backfilled recipe_stats for program ${program_id}: ${batchStats.length} recipes`);
        } catch (e) {
          log.error('system', 'recipe_stats_backfill_error', e, { program_id });
        }
      }
    }
  } catch (err) {
    log.error('system', 'migration_error', err);
  }
}

// Run migrations before starting server
runMigrations();

// No longer clearing transition state on startup - state is restored instead
// (see initializeOnStartup below)

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
const customersRoutes = require('./routes/customers');
const ordersRoutes = require('./routes/orders');
const usersRoutes = require('./routes/users');

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
app.use('/api/customers', customersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/users', usersRoutes);

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

// Restore machine state from SQLite on server startup
// Instead of resetting, we recover the persisted state so production can resume after crashes
function initializeOnStartup() {
  try {
    // Restore gate piece/gram counters from the persisted snapshot
    const gateRestored = machineState.restoreGateSnapshot();
    if (!gateRestored) {
      gates.resetAll();
      log.system('gates_reset', 'No gate snapshot found - gate counters reset to 0');
    }
    
    // Read the persisted state from SQLite
    const persistedState = machineState.getState();
    const previousState = persistedState.state;
    const activeRecipeCount = (persistedState.activeRecipes || []).length;
    const queueCount = (persistedState.orderQueue || []).length;
    const hadTransitions = (persistedState.transitioningGates || []).length > 0;
    
    log.system('state_restore_start', 'Restoring machine state from SQLite', {
      previousState,
      activeRecipes: activeRecipeCount,
      queueItems: queueCount,
      hadTransitions,
      currentProgramId: persistedState.currentProgramId,
    });
    
    if (previousState === 'idle' && activeRecipeCount === 0) {
      // Nothing to restore - already idle with no recipes
      log.system('state_restore_skip', 'State is already idle with no active recipes - nothing to restore');
    } else {
      // Clean up transient flags from recipes (they are invalid after restart)
      const cleanedRecipes = (persistedState.activeRecipes || []).map(r => {
        const cleaned = { ...r };
        delete cleaned._isIncomingFromQueue;
        delete cleaned._isReplacementRecipe;
        delete cleaned._queueBatchId;
        delete cleaned._isFromQueue;
        delete cleaned._replacedFinishing;
        delete cleaned._stableColorIndex;
        delete cleaned.batchLimitTransitioning;
        delete cleaned.isFinishing;
        return cleaned;
      });
      
      // Clean up transient flags from queue items
      const cleanedQueue = (persistedState.orderQueue || []).map(q => {
        const cleaned = { ...q };
        delete cleaned._queueBatchId;
        return cleaned;
      });
      
      // If machine was running or transitioning, move to paused
      // The physical process stopped during the crash - operator must review before resuming
      let restoredState = previousState;
      if (previousState === 'running' || previousState === 'transitioning') {
        restoredState = 'paused';
        log.system('state_restore_paused', `Machine was "${previousState}" before shutdown - setting to "paused" for operator review`, {
          previousState,
          activeRecipes: cleanedRecipes.map(r => ({ name: r.recipeName, gates: r.gates, batches: `${r.completedBatches}/${r.requestedBatches}` })),
        });
      }
      
      // If there were active transitions, they cannot be resumed
      // Clear transition state, remove gateless recipes, and merge duplicates
      let finalRecipes = cleanedRecipes;
      if (hadTransitions) {
        log.system('state_restore_transitions_cleared', 'Clearing stale transition state (cannot resume transitions after restart)', {
          transitioningGates: persistedState.transitioningGates,
        });
        
        // Remove incoming recipes that had no gates (they were just created, never actually ran)
        finalRecipes = cleanedRecipes.filter(r => {
          if ((r.gates || []).length === 0 && activeRecipeCount > 1) {
            log.system('state_restore_removed_gateless', `Removed gateless recipe: ${r.recipeName}`, {
              recipeName: r.recipeName,
              completedBatches: r.completedBatches,
            });
            return false;
          }
          return true;
        });
      }
      
      // Merge duplicate recipe entries (same recipe appearing twice due to transition state)
      // Keep the entry with the most data (highest completedBatches, most gates)
      const mergedMap = new Map();
      for (const r of finalRecipes) {
        const stableKey = r.orderId ? `order_${r.orderId}` : `recipe_${r.recipeName}`;
        const existing = mergedMap.get(stableKey);
        if (existing) {
          // Merge: combine gates, keep highest completedBatches
          const mergedGates = [...new Set([...(existing.gates || []), ...(r.gates || [])])].sort((a, b) => a - b);
          const merged = {
            ...existing,
            gates: mergedGates,
            completedBatches: Math.max(existing.completedBatches || 0, r.completedBatches || 0),
            requestedBatches: existing.requestedBatches || r.requestedBatches || 0,
            params: existing.params || r.params,
            gatesAssigned: mergedGates.length,
          };
          mergedMap.set(stableKey, merged);
          log.system('state_restore_merged_duplicate', `Merged duplicate recipe: ${r.recipeName}`, {
            recipeName: r.recipeName,
            existingGates: existing.gates,
            newGates: r.gates,
            mergedGates,
            completedBatches: merged.completedBatches,
          });
        } else {
          mergedMap.set(stableKey, r);
        }
      }
      finalRecipes = Array.from(mergedMap.values());
      
      // Also sync batch counts between active recipes and queue items
      // If a recipe is active with completedBatches, update the matching queue item
      const cleanedQueueWithBatches = cleanedQueue.map(q => {
        const matchingActive = finalRecipes.find(r => {
          if (q.orderId) return r.orderId === q.orderId;
          return r.recipeName === q.recipeName && !r.orderId;
        });
        if (matchingActive && (matchingActive.completedBatches || 0) > (q.completedBatches || 0)) {
          return { ...q, completedBatches: matchingActive.completedBatches };
        }
        return q;
      });
      
      // Persist the cleaned-up state
      machineState.updateState({
        state: restoredState,
        activeRecipes: finalRecipes,
        programStartRecipes: finalRecipes, // Snapshot matches current state
        orderQueue: cleanedQueueWithBatches,
        // Clear all transition state
        transitioningGates: [],
        transitionStartRecipes: {},
        completedTransitionGates: [],
        registeredTransitioningGates: [],
      });
      
      // Clear transition old program ID if it was set
      machineState.clearTransitionOldProgramId();
      
      log.system('state_restored', `Machine state restored successfully`, {
        restoredState,
        activeRecipes: finalRecipes.length,
        queueItems: cleanedQueueWithBatches.length,
        currentProgramId: persistedState.currentProgramId,
        recipes: finalRecipes.map(r => ({
          name: r.recipeName,
          gates: r.gates,
          completedBatches: r.completedBatches,
          requestedBatches: r.requestedBatches,
        })),
      });
      
      // Check if any restored recipe has already reached its batch limit transition threshold
      // This prevents "lagging 1 behind" after restart - the transition is set up immediately
      // so the next batch completion triggers the gate handoff correctly
      if (restoredState === 'paused' && persistedState.currentProgramId) {
        const restoredRecipes = machineState.getActiveRecipes();
        for (const r of restoredRecipes) {
          if (machineState.shouldStartBatchLimitTransition(r)) {
            log.system('state_restore_transition_detected', `Recipe ${r.recipeName} at batch limit threshold on restore - starting transition`, {
              recipeName: r.recipeName,
              completedBatches: r.completedBatches,
              requestedBatches: r.requestedBatches,
              gates: r.gates,
              threshold: r.requestedBatches - r.gates.length,
            });
            machineState.startBatchLimitTransition(r);
          }
        }
      }
    }
    
    // Recover any orphaned orders (status is 'assigned'/'in-production' but not in active/queue)
    const recoveredCount = machineState.recoverOrphanedOrders();
    if (recoveredCount > 0) {
      log.system('orders_recovered', `Recovered ${recoveredCount} orphaned order(s) on startup`);
    }
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
