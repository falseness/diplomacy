'use strict';
// Authentication is a prerequisite, never attempted or retried during cleanup.
async function cleanup(clients, timeoutMs = 10000) {
  const client = clients.find(c => c.authenticated && c.socket.connected);
  if (!client) return {status: 'skipped', reason: 'no authenticated connected socket'};
  const socket = client.socket;
  const data = await new Promise((resolve, reject) => {
    const handlers = {};
    const finish = (err, value) => {
      clearTimeout(timer);
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(Error('cleanup timeout')), timeoutMs);
    handlers.smokeRunCleaned = data => finish(null, data);
    handlers.error = () => finish(Error('cleanup error'));
    handlers.disconnect = () => finish(Error('cleanup disconnected'));
    for (const [event, handler] of Object.entries(handlers)) socket.once(event, handler);
    socket.emit('cleanupSmokeRun');
  });
  return {status: 'complete', data};
}
module.exports = {cleanup};
