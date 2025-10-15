require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const influx = require('./services/influx');

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
app.use('/api/assignments', assignmentsRoutes); // M5 moved from InfluxDB to SQLite
app.use('/api/history', historyRoutes);
app.use('/api/import', importRoutes); // One-time data imports

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
    console.error('Influx write error:', e);
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
    console.error('Influx query error:', e);
    res.status(500).json({ message: 'Influx query failed' });
  }
});

// ---------- start server ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (SQLite + InfluxDB3)`);
  if (outbox && typeof outbox.start === 'function') {
    outbox.start();     // begin polling outbox & broadcasting
  }
});