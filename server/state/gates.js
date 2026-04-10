// server/state/gates.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const GATE_MIN = 1;
const GATE_MAX = 8;

const HAS_BUFFER = process.env.MACHINE_HAS_BUFFER === 'true';

function emptyCompartment() {
  return { pieces: 0, grams: 0 };
}

function emptyGateState() {
  return {
    main: emptyCompartment(),
    buffer: emptyCompartment(),
    mainFull: false,
    bufferFull: false,
    mainFilledAt: null,
    bothFilledAt: null,
  };
}

const state = new Map();
const processingQueues = new Map();
const operationCounts = new Map();
const QUEUE_RESET_THRESHOLD = 1000;

for (let g = GATE_MIN; g <= GATE_MAX; g++) {
  state.set(g, emptyGateState());
  processingQueues.set(g, Promise.resolve());
  operationCounts.set(g, 0);
}

function getSnapshot() {
  return Array.from({ length: GATE_MAX }, (_, i) => {
    const gate = i + 1;
    const s = state.get(gate) || emptyGateState();
    return {
      gate,
      main: { ...s.main },
      buffer: { ...s.buffer },
      mainFull: s.mainFull,
      bufferFull: s.bufferFull,
      // Legacy compat: total pieces/grams across both compartments
      pieces: s.main.pieces + s.buffer.pieces,
      grams: s.main.grams + s.buffer.grams,
    };
  });
}

function setGate(gate, pieces, grams) {
  const p = Math.max(0, Math.floor(pieces || 0));
  const g = Math.max(0, Number(grams || 0));
  const s = state.get(gate) || emptyGateState();
  s.main = { pieces: p, grams: g };
  s.buffer = emptyCompartment();
  s.mainFull = false;
  s.bufferFull = false;
  s.mainFilledAt = null;
  s.bothFilledAt = null;
  state.set(gate, s);
  return { gate, pieces: p, grams: g };
}

function incGate(gate, dPieces = 0, dGrams = 0) {
  const s = state.get(gate) || emptyGateState();
  const target = s.mainFull && HAS_BUFFER ? s.buffer : s.main;
  target.pieces = Math.max(0, Math.floor(target.pieces + (dPieces || 0)));
  target.grams = Math.max(0, Number(target.grams + (dGrams || 0)));
  state.set(gate, s);
  return { gate, pieces: s.main.pieces + s.buffer.pieces, grams: s.main.grams + s.buffer.grams };
}

function resetGate(gate) {
  state.set(gate, emptyGateState());
  return { gate, pieces: 0, grams: 0 };
}

function resetAll() {
  for (let g = GATE_MIN; g <= GATE_MAX; g++) state.set(g, emptyGateState());
}

function clearInactiveGates(activeGates) {
  for (let g = GATE_MIN; g <= GATE_MAX; g++) {
    if (!activeGates.has(g)) {
      state.set(g, emptyGateState());
    }
  }
}

function isAllZero() {
  return getSnapshot().every(x => x.pieces === 0 && x.grams === 0);
}

function loadSnapshot(arr) {
  if (!Array.isArray(arr)) return;
  for (const r of arr) {
    const g = Number(r.gate);
    if (!Number.isFinite(g) || g < GATE_MIN || g > GATE_MAX) continue;
    if (r.main) {
      const s = {
        main: { pieces: Math.max(0, Math.floor(r.main.pieces || 0)), grams: Math.max(0, Number(r.main.grams || 0)) },
        buffer: { pieces: Math.max(0, Math.floor((r.buffer && r.buffer.pieces) || 0)), grams: Math.max(0, Number((r.buffer && r.buffer.grams) || 0)) },
        mainFull: !!r.mainFull,
        bufferFull: !!r.bufferFull,
        mainFilledAt: r.mainFilledAt || null,
        bothFilledAt: r.bothFilledAt || null,
      };
      state.set(g, s);
    } else {
      // Legacy format: { gate, pieces, grams }
      setGate(g, Number(r.pieces || 0), Number(r.grams || 0));
    }
  }
}

/**
 * Check if a gate is eligible to receive pieces.
 * In non-buffer mode: gate is blocked when mainFull.
 * In buffer mode: gate is blocked when both mainFull AND bufferFull.
 */
function isGateBlocked(gate) {
  const s = state.get(gate) || emptyGateState();
  if (HAS_BUFFER) return s.mainFull && s.bufferFull;
  return s.mainFull;
}

/**
 * Get raw gate state (for internal use)
 */
function getGateState(gate) {
  return state.get(gate) || emptyGateState();
}

/**
 * Process a piece atomically using a promise queue to prevent race conditions.
 * Routes piece to main or buffer based on compartment status.
 * Does NOT auto-reset on batch completion -- waits for operator acknowledgment.
 *
 * @param {number} gate - Gate number
 * @param {number} weight - Weight in grams
 * @param {function} checkBatchComplete - (pieces, grams) => boolean
 * @param {string} [timestamp] - ISO timestamp for recording fill events
 * @returns {Promise<{ pieces, grams, batchComplete, compartment, gateBlocked, mainFilledAt, bothFilledAt }>}
 */
async function processPieceAtomic(gate, weight, checkBatchComplete, timestamp) {
  const count = operationCounts.get(gate) + 1;
  operationCounts.set(gate, count);

  if (count >= QUEUE_RESET_THRESHOLD) {
    await processingQueues.get(gate);
    processingQueues.set(gate, Promise.resolve());
    operationCounts.set(gate, 0);
  }

  const operation = processingQueues.get(gate).then(async () => {
    const s = state.get(gate) || emptyGateState();
    const tsIso = timestamp || new Date().toISOString();

    // Determine target compartment
    const toBuffer = s.mainFull && HAS_BUFFER;
    const target = toBuffer ? s.buffer : s.main;
    const compartment = toBuffer ? 'buffer' : 'main';

    // Increment target compartment
    target.pieces = Math.max(0, Math.floor(target.pieces + 1));
    target.grams = Math.max(0, Number(target.grams + weight));
    state.set(gate, s);

    const batchComplete = checkBatchComplete ? checkBatchComplete(target.pieces, target.grams) : false;

    if (batchComplete) {
      if (compartment === 'main') {
        s.mainFull = true;
        s.mainFilledAt = tsIso;
        state.set(gate, s);
        return {
          pieces: target.pieces,
          grams: target.grams,
          batchComplete: true,
          compartment: 'main',
          gateBlocked: !HAS_BUFFER,
          mainFilledAt: s.mainFilledAt,
          bothFilledAt: null,
        };
      } else {
        // Buffer batch complete → gate fully blocked
        s.bufferFull = true;
        s.bothFilledAt = tsIso;
        state.set(gate, s);
        return {
          pieces: target.pieces,
          grams: target.grams,
          batchComplete: true,
          compartment: 'buffer',
          gateBlocked: true,
          mainFilledAt: s.mainFilledAt,
          bothFilledAt: s.bothFilledAt,
        };
      }
    }

    return {
      pieces: target.pieces,
      grams: target.grams,
      batchComplete: false,
      compartment,
      gateBlocked: false,
      mainFilledAt: s.mainFilledAt,
      bothFilledAt: s.bothFilledAt,
    };
  });

  processingQueues.set(gate, operation.catch(() => {}));
  return operation;
}

/**
 * Acknowledge a gate -- called when the operator presses the physical button.
 * In buffer mode: transfers buffer contents to main, checks if transferred items complete a batch.
 * In non-buffer mode: simply resets the gate.
 *
 * @param {number} gate - Gate number
 * @param {function} checkBatchComplete - (pieces, grams) => boolean
 * @param {string} [timestamp] - ISO timestamp
 * @returns {{ transferred: boolean, immediateComplete: boolean, mainPieces, mainGrams, gateState }}
 */
function acknowledgeGate(gate, checkBatchComplete, timestamp) {
  const s = state.get(gate) || emptyGateState();
  const tsIso = timestamp || new Date().toISOString();

  const result = {
    transferred: false,
    immediateComplete: false,
    mainPieces: 0,
    mainGrams: 0,
    previousMainFilledAt: s.mainFilledAt,
    previousBothFilledAt: s.bothFilledAt,
  };

  if (!HAS_BUFFER) {
    // Non-buffer: just reset
    state.set(gate, emptyGateState());
    result.gateState = getSnapshot().find(x => x.gate === gate);
    return result;
  }

  // Buffer mode: transfer buffer → main
  const hadBuffer = s.buffer.pieces > 0 || s.buffer.grams > 0;
  const transferredPieces = s.buffer.pieces;
  const transferredGrams = s.buffer.grams;

  s.main = { pieces: transferredPieces, grams: transferredGrams };
  s.buffer = emptyCompartment();
  s.bufferFull = false;
  s.bothFilledAt = null;

  // Check if transferred contents immediately complete a batch
  const immediateComplete = hadBuffer && checkBatchComplete
    ? checkBatchComplete(s.main.pieces, s.main.grams) : false;

  if (immediateComplete) {
    s.mainFull = true;
    s.mainFilledAt = tsIso;
  } else {
    s.mainFull = false;
    s.mainFilledAt = null;
  }

  state.set(gate, s);
  result.transferred = hadBuffer;
  result.immediateComplete = immediateComplete;
  result.mainPieces = s.main.pieces;
  result.mainGrams = s.main.grams;
  result.gateState = getSnapshot().find(x => x.gate === gate);
  return result;
}

module.exports = {
  GATE_MIN,
  GATE_MAX,
  HAS_BUFFER,
  getSnapshot,
  setGate,
  incGate,
  resetGate,
  resetAll,
  clearInactiveGates,
  isAllZero,
  loadSnapshot,
  isGateBlocked,
  getGateState,
  processPieceAtomic,
  acknowledgeGate,
};
