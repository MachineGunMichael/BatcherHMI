// server/lib/eventBus.js
const { EventEmitter } = require("events");

// Single shared emitter for the whole process
const bus = new EventEmitter();

// Increase max listeners to prevent memory leak warnings
// Default is 10, but with multiple SSE clients we may have more
bus.setMaxListeners(50);

// Convenience helper
function broadcast(event, payload) {
  bus.emit(event, payload);
}

module.exports = { bus, broadcast };