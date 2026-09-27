'use strict';
// Diagnostic preload: observe real socket events without changing inputs,
// handlers, clocks, deadlines or assertions in the production-source harness.
const fs = require('node:fs');
const path = require('node:path');
const services = require('/root/diplomacy_server/tests/reliability/helpers/services');
const original = services.withServices;
const output = process.env.ONLINE_EVIDENCE_DIR;
if (!output) throw new Error('ONLINE_EVIDENCE_DIR required for passive join trace');
fs.mkdirSync(output, {recursive: true});
const trace = path.join(output, 'passive-join-timing.jsonl');
const fd = fs.openSync(trace, 'wx');
const started = Date.now();
let connections = 0;
const record = value => fs.writeSync(fd, JSON.stringify({atMs: Date.now(), elapsedMs: Date.now() - started, ...value}) + '\n');
record({event: 'observer-start', diagnosticOnly: true, node: process.version});
services.withServices = async (options, execute) => original(options, async service => {
    record({event: 'services-ready'});
    const connect = service.connectSocket.bind(service);
    service.connectSocket = async (...args) => {
        const connection = ++connections;
        record({event: 'connect-start', connection});
        const handle = await connect(...args);
        record({event: 'connected', connection, socketId: handle.client.id});
        handle.client.onAnyOutgoing(event => {
            if (event === 'startGameOrConnect' || event === 'nextTurn') record({event: 'sent-' + event, connection});
        });
        handle.client.onAny((event, body) => {
            if (!['gameStarted', 'playYourTurn', 'waitYouTurn', 'error'].includes(event)) return;
            let board = body;
            if (typeof body === 'string') { try { board = JSON.parse(body); } catch { board = null; } }
            // Deliberately omit payloads, passwords and error text.
            record({event, connection, slot: board?.whooseTurn ?? null, round: board?.gameRound ?? null, hasBoard: !!board?.grid});
        });
        handle.client.on('disconnect', reason => record({event: 'disconnected', connection, reason}));
        return handle;
    };
    return execute(service);
});
process.on('exit', code => {
    record({event: 'observer-exit', code, connections});
    fs.closeSync(fd);
});
