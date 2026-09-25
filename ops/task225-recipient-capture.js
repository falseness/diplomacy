'use strict';
// Observation-only preload for the existing concurrent provider. Credentials
// establish peer identity before responses; MongoDB establishes recipient slots.
// No decisions, payloads, clocks, or service lifecycle behavior are replaced.
if (process.argv.some(arg => arg.endsWith('/concurrent-games.test.js'))) {
    const fs = require('node:fs'), path = require('node:path');
    const base = '/root/diplomacy_server/tests/reliability/helpers/';
    const services = require(base + 'services');
    const obs = require(base + 'observations');
    const original = services.withServices;
    services.withServices = (options, scenario) => original(options, async service => {
        const out = options.evidenceDir, secrets = [], peers = new Map(), connections = [], packets = [];
        const capture = path.join(out, 'recipient-packets.jsonl');
        fs.writeFileSync(capture, '');
        const connect = service.connectSocket;
        service.connectSocket = async (...args) => {
            const connection = {id: 'connection-' + (connections.length + 1), peer: null};
            connections.push(connection);
            const handle = await connect(...args), socket = handle.client;
            const emit = socket.emit;
            socket.emit = function(event, ...values) {
                if (event === 'startGameOrConnect') {
                    const body = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
                    const password = body.password;
                    if (!peers.has(password)) {
                        secrets.push(password);
                        peers.set(password, 'peer-' + peers.size);
                    }
                    connection.peer = peers.get(password);
                    connection.password = password;
                }
                return emit.call(this, event, ...values);
            };
            socket.onAny((event, ...values) => {
                const bodies = values.map(v => {
                    if (typeof v !== 'string') return v;
                    try { return JSON.parse(v); } catch { return v; }
                });
                const row = {at: Date.now(), connection: connection.id,
                    peer: connection.peer, transport: socket.io.engine.transport.name, event, bodies};
                packets.push(structuredClone(row));
            });
            return handle;
        };
        try { return await scenario(service); }
        finally {
            // Match admission allocation order, independently of response ordering.
            const orderedSecrets = [...new Set(connections.map(c => c.password).filter(Boolean))];
            fs.writeFileSync(capture, packets.map(row => JSON.stringify(obs.redact(row, orderedSecrets)) + '\n').join(''));
            const games = service.mongo.db(service.databaseName).collection('games');
            const bindings = [];
            for (const [password, peer] of peers) {
                const user = obs.sha256(password);
                const docs = await games.find({playerIndexToUserIndex: user}).toArray();
                if (docs.length !== 1) throw Error('recipient requires exactly one persisted roster');
                const doc = docs[0], roster = doc.playerIndexToUserIndex;
                if (roster.filter(x => x === user).length !== 1) throw Error('ambiguous recipient roster');
                bindings.push({peer, gameID: doc.gameID, slot: roster.indexOf(user),
                    user, roster, connections: connections.filter(c => c.peer === peer).map(c => c.id)});
            }
            fs.writeFileSync(path.join(out, 'recipient-bindings.json'),
                JSON.stringify(obs.redact({bindings}, orderedSecrets), null, 2) + '\n');
        }
    });
}
