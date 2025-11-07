const settingsRepo = require('../repositories/settingsRepo');
const { broadcast } = require('../lib/eventBus'); // use eventBus broadcast helper

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
        broadcast(row.event_type, payload);
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