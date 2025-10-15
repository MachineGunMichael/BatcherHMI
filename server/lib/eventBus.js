// server/lib/eventBus.js
const { EventEmitter } = require("events");

// Single shared emitter for the whole process
const bus = new EventEmitter();

// Convenience helper
function broadcast(event, payload) {
  bus.emit(event, payload);
}

module.exports = { bus, broadcast };