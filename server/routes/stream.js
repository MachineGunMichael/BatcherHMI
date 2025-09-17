const express = require('express');
const { verifyToken } = require('../utils/authMiddleware');

const router = express.Router();
const clients = new Set();

router.get('/events', verifyToken, (req, res) => {
  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();

  // greet
  res.write(`event: ping\ndata: "ready"\n\n`);

  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
    res.end();
  });
});

// broadcast helper for other modules
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { /* client probably closed */ }
  }
}

module.exports = { router, broadcast };