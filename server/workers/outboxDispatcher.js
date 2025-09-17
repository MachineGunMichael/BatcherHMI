const settingsRepo = require('../repositories/settingsRepo');
const stream = require('../routes/stream'); // use its broadcast helper

// placeholder for posting to external C# service, etc.
async function forwardToExternal(event) {
  // TODO: implement HTTP or gRPC call to C# service
  // console.log('Forwarding to external:', event);
  return true;
}

function start(intervalMs = 2000) {
  setInterval(async () => {
    try {
      const rows = settingsRepo.getPendingOutbox(50);
      if (!rows.length) return;

      // dispatch each
      const doneIds = [];
      for (const row of rows) {
        const payload = JSON.parse(row.payload);
        // notify SSE clients as well
        stream.broadcast(row.event_type, payload);
        await forwardToExternal({ type: row.event_type, payload });
        doneIds.push(row.id);
      }
      settingsRepo.markOutboxDispatched(doneIds);
    } catch (e) {
      console.error('outbox dispatcher error', e);
    }
  }, intervalMs);
}

module.exports = { start };