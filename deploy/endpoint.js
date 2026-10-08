'use strict';
// Unauthenticated readiness: TLS + Engine.IO + Socket.IO, no application events.
const {io} = require('socket.io-client');
function probe(url, timeout = 10000) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' || parsed.username || parsed.password) {
        return Promise.reject(new Error('Expected credential-free wss endpoint'));
    }
    return new Promise((resolve, reject) => {
        const socket = io(url, {transports: ['websocket'], path: '/socket.io',
            reconnection: false, timeout, rejectUnauthorized: true, forceNew: true});
        const timer = setTimeout(() => finish(new Error('endpoint deadline exceeded')), timeout + 1000);
        function finish(error) {
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.disconnect();
            if (error) reject(error); else resolve();
        }
        socket.once('connect', () => finish());
        socket.once('connect_error', finish);
    });
}
module.exports = {probe};
if (require.main === module) {
    const url = process.argv[2];
    console.log(JSON.stringify({url, runtime: process.version, path: '/socket.io',
        transport: 'websocket', tlsVerification: true, timeout: 10000, applicationEvents: 0}));
    probe(url).then(() => console.log('PASS TLS Engine.IO Socket.IO connected; no authentication or application events'))
        .catch(error => {console.error('FAIL endpoint: ' + error.message); process.exitCode = 1;});
}
