// server/state/gates.js
const GATE_MIN = 1;
const GATE_MAX = 8;

const state = new Map();
const processingQueues = new Map(); // Queue of pending operations per gate
for (let g = GATE_MIN; g <= GATE_MAX; g++) {
  state.set(g, { pieces: 0, grams: 0 });
  processingQueues.set(g, Promise.resolve()); // Start with resolved promise
}

function getSnapshot() {
  return Array.from({ length: GATE_MAX }, (_, i) => {
    const gate = i + 1;
    const s = state.get(gate) || { pieces: 0, grams: 0 };
    return { gate, pieces: s.pieces, grams: s.grams };
  });
}

function setGate(gate, pieces, grams) {
  const p = Math.max(0, Math.floor(pieces || 0));
  const g = Math.max(0, Number(grams || 0));
  state.set(gate, { pieces: p, grams: g });
  return { gate, pieces: p, grams: g };
}

function incGate(gate, dPieces = 0, dGrams = 0) {
  const cur = state.get(gate) || { pieces: 0, grams: 0 };
  const next = {
    pieces: Math.max(0, Math.floor(cur.pieces + (dPieces || 0))),
    grams: Math.max(0, Number(cur.grams + (dGrams || 0))),
  };
  state.set(gate, next);
  return { gate, ...next };
}

function resetGate(gate) {
  state.set(gate, { pieces: 0, grams: 0 });
  return { gate, pieces: 0, grams: 0 };
}

function resetAll() {
  for (let g = GATE_MIN; g <= GATE_MAX; g++) state.set(g, { pieces: 0, grams: 0 });
}

/**
 * Clear gates that don't have recipe assignments
 * @param {Set<number>} activeGates - Set of gate numbers that have recipes
 */
function clearInactiveGates(activeGates) {
  for (let g = GATE_MIN; g <= GATE_MAX; g++) {
    if (!activeGates.has(g)) {
      state.set(g, { pieces: 0, grams: 0 });
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
    setGate(g, Number(r.pieces || 0), Number(r.grams || 0));
  }
}

/**
 * Process a piece atomically using a promise queue to prevent race conditions
 * This ensures pieces are ALWAYS processed in order, never rejected
 * @param {number} gate - Gate number
 * @param {number} weight - Weight in grams
 * @param {function} checkBatchComplete - Callback to check if batch is complete (pieces, grams) => boolean
 * @returns {Promise<{ pieces: number, grams: number, batchComplete: boolean }>}
 */
async function processPieceAtomic(gate, weight, checkBatchComplete) {
  // Chain this operation to the end of the queue for this gate
  const operation = processingQueues.get(gate).then(async () => {
    // Increment
    const cur = state.get(gate) || { pieces: 0, grams: 0 };
    const next = {
      pieces: Math.max(0, Math.floor(cur.pieces + 1)),
      grams: Math.max(0, Number(cur.grams + weight)),
    };
    state.set(gate, next);

    // Check if batch is complete
    const batchComplete = checkBatchComplete ? checkBatchComplete(next.pieces, next.grams) : false;

    if (batchComplete) {
      // Reset immediately (still within the queued operation)
      state.set(gate, { pieces: 0, grams: 0 });
      return {
        pieces: next.pieces,
        grams: next.grams,
        batchComplete: true,
      };
    }

    return {
      pieces: next.pieces,
      grams: next.grams,
      batchComplete: false,
    };
  });

  // Update the queue with this operation
  processingQueues.set(gate, operation.catch(() => {})); // Catch errors to prevent queue breakage

  // Wait for this specific operation to complete
  return operation;
}

module.exports = {
  GATE_MIN,
  GATE_MAX,
  getSnapshot,
  setGate,
  incGate,
  resetGate,
  resetAll,
  clearInactiveGates,
  isAllZero,
  loadSnapshot,
  processPieceAtomic,
};