// server/lib/operatorSimulator.js
// Simulates an operator pressing the gate acknowledgment button after a random delay.
// Enable via SIMULATE_OPERATOR=true in .env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { bus } = require('./eventBus');
const gates = require('../state/gates');
const recipeManager = require('./recipeManager');
const log = require('./logger');

const ENABLED = process.env.SIMULATE_OPERATOR === 'true';
const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 20000;

const pendingTimers = new Map(); // gate -> timeoutId

function randomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)) + MIN_DELAY_MS;
}

function scheduleAcknowledge(gate, ts) {
  if (pendingTimers.has(gate)) return; // already scheduled

  const delay = randomDelay();
  log.operations('sim_ack_scheduled', `Simulator: gate ${gate} ack in ${(delay / 1000).toFixed(1)}s`, { gate, delayMs: delay });

  const timer = setTimeout(async () => {
    pendingTimers.delete(gate);
    try {
      // Call acknowledge endpoint internally via HTTP
      const port = process.env.PORT || 5001;
      const secret = process.env.PLC_SHARED_SECRET || '';
      const resp = await fetch(`http://127.0.0.1:${port}/api/ingest/gate/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-plc-secret': secret,
        },
        body: JSON.stringify({ gate, timestamp: new Date().toISOString() }),
      });
      const data = await resp.json();
      log.operations('sim_ack_fired', `Simulator: gate ${gate} acknowledged`, { gate, result: data });
    } catch (err) {
      log.error('system', 'sim_ack_error', err, { gate });
    }
  }, delay);

  pendingTimers.set(gate, timer);
}

function clearAll() {
  for (const [gate, timer] of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

function checkExistingFullGates() {
  for (let g = gates.GATE_MIN; g <= gates.GATE_MAX; g++) {
    const s = gates.getGateState(g);
    if (s && s.mainFull && !pendingTimers.has(g)) {
      log.operations('sim_ack_catchup', `Simulator: gate ${g} already full, scheduling ack`, { gate: g });
      scheduleAcknowledge(g, new Date().toISOString());
    }
  }
}

function init() {
  if (!ENABLED) {
    log.operations('sim_disabled', 'Operator simulator is DISABLED (set SIMULATE_OPERATOR=true to enable)');
    return;
  }

  log.operations('sim_enabled', `Operator simulator ENABLED — delay ${MIN_DELAY_MS}-${MAX_DELAY_MS}ms`);

  bus.on('gate:main-filled', ({ gate, ts }) => {
    scheduleAcknowledge(gate, ts);
  });

  // Periodically check for gates that are full but have no pending timer
  setInterval(checkExistingFullGates, 5000);

  // Also check immediately on startup (slight delay to let server finish init)
  setTimeout(checkExistingFullGates, 2000);

  // Clean up on machine stop/reset
  bus.on('machine:state-changed', (payload) => {
    if (payload && payload.state === 'idle') {
      clearAll();
    }
  });
}

module.exports = { init, clearAll, ENABLED };
