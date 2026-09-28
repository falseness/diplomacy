'use strict';
// Production-source checks only. EventEmitter is a labeled socket stand-in;
// these assertions do not prove HTTPS, Socket.IO, MongoDB or browser behavior.
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createPolicy} = require('/root/diplomacy_server/server/smokeIsolation');
const ids = {a: 'a'.repeat(64), b: 'b'.repeat(64), c: 'c'.repeat(64), ordinary: 'd'.repeat(64)};
const checkpoints = [], sockets = [];
function check(id, expected, observed) {
    assert.deepEqual(observed, expected, id);
    checkpoints.push({id, expected, observed, pass: true});
    console.log(`PASS ${id}`);
}
function rejects(id, fn, code = 'SMOKE_ISOLATION_DENIED') {
    let observed = null;
    try { fn(); } catch (error) { observed = code === 'READ_ONLY_PROPERTY' && error instanceof TypeError
        ? 'READ_ONLY_PROPERTY' : error.code || error.message; }
    check(id, code, observed);
}
function socket() {
    const s = new EventEmitter();
    s.data = {}; s.disconnects = [];
    s.disconnect = force => { s.disconnects.push(force); s.emit('disconnect'); };
    sockets.push(s); return s;
}
function entries() {
    return [{userId: ids.a, run: 'alpha', expiresAt: Date.now() + 60000},
        {userId: ids.b, run: 'beta', expiresAt: Date.now() + 60000},
        {userId: ids.c, run: 'alpha', expiresAt: Date.now() + 60000}];
}
async function main() {
    const out = process.argv[2];
    assert(out, 'usage: node ops/test_smoke_policy_review.js <fresh-output-directory>');
    fs.mkdirSync(out, {recursive: false});
    try {
        const input = entries(), policy = createPolicy(input);
        input[0].run = 'forged'; input[0].expiresAt = 0;
        check('allowlist-copied', 'alpha', policy.authorize(ids.a));
        check('ordinary-namespace', null, policy.authorize(ids.ordinary));
        check('policy-frozen', true, Object.isFrozen(policy));
        const a = socket();
        check('assigned-from-allowlist', 'alpha', policy.bind(a, ids.a));
        const descriptor = Object.getOwnPropertyDescriptor(a.data, 'smokeRun');
        check('namespace-immutable', {value: 'alpha', writable: false, enumerable: false, configurable: false}, descriptor);
        rejects('namespace-assignment-rejected', () => { a.data.smokeRun = 'beta'; }, 'READ_ONLY_PROPERTY');
        rejects('cross-run-rebind', () => policy.bind(a, ids.b));
        rejects('smoke-to-ordinary-rebind', () => policy.bind(a, ids.ordinary));
        check('same-run-rebind', 'alpha', policy.bind(a, ids.c));
        const ordinary = socket(); policy.bind(ordinary, ids.ordinary);
        rejects('ordinary-to-smoke-rebind', () => policy.bind(ordinary, ids.a));
        const expired = createPolicy([{userId: ids.a, run: 'alpha', expiresAt: Date.now() - 1}]);
        rejects('expired-not-ordinary', () => expired.authorize(ids.a));
        rejects('expired-bind', () => expired.bind(socket(), ids.a));
        policy.revoke('alpha');
        rejects('revoked-member-a', () => policy.authorize(ids.a));
        rejects('revoked-member-c', () => policy.authorize(ids.c));
        check('other-run-survives-revoke', 'beta', policy.authorize(ids.b));
        check('ordinary-survives-revoke', null, policy.authorize(ids.ordinary));
        rejects('ordinary-revoke-denied', () => policy.revoke(null));
        for (const [name, game, run] of [['cross-run', {smokeRun:'alpha'}, 'beta'],
            ['smoke-to-ordinary', {smokeRun:'alpha'}, null], ['ordinary-to-smoke', {}, 'alpha']]) {
            rejects(`lookup/${name}`, () => policy.assertGame(game, run));
        }
        check('lookup/same-run', undefined, policy.assertGame({smokeRun:'beta'}, 'beta'));
        check('lookup/legacy-ordinary', undefined, policy.assertGame({}, null));
        for (const [name, records] of [['duplicate', [entries()[0], entries()[0]]],
            ['bad-identity', [{...entries()[0], userId:'invalid'}]],
            ['bad-run', [{...entries()[0], run:'../escape'}]],
            ['bad-expiry', [{...entries()[0], expiresAt:1.5}]]]) {
            rejects(`configuration/${name}`, () => createPolicy(records), 'Invalid smoke allowlist entry');
        }
        rejects('configuration/not-array', () => createPolicy({}), 'Invalid smoke allowlist');
        const live = socket(), start = Date.now(), expiresAt = start + 100;
        const expiring = createPolicy([{userId:ids.a, run:'alpha', expiresAt}]);
        const disconnected = new Promise(resolve => live.once('disconnect', resolve));
        expiring.bind(live, ids.a);
        let watchdog;
        try {
            await Promise.race([disconnected, new Promise((_, reject) => {
                watchdog = setTimeout(() => reject(Error('real expiry deadline exceeded')), 2000);
            })]);
        } finally { clearTimeout(watchdog); }
        check('real-clock-expiry/force-disconnect', [true], live.disconnects);
        check('real-clock-expiry/not-early', true, Date.now() >= expiresAt);
        rejects('real-clock-expiry/no-readmission', () => expiring.bind(live, ids.a));
    } finally {
        for (const s of sockets) s.emit('disconnect');
        fs.writeFileSync(path.join(out, 'checkpoints.json'), JSON.stringify({tier:'production-source; socket stand-in',
            checkpoints: checkpoints.map(c => ({...c, expected:c.expected === undefined ? {undefined:true} : c.expected,
                observed:c.observed === undefined ? {undefined:true} : c.observed})), fullInvocation:false, wholeCriterionCredit:false}, null, 2)+'\n');
        const files = [__filename, '/root/diplomacy_server/server/smokeIsolation.js'];
        fs.writeFileSync(path.join(out, 'source-identities.json'), JSON.stringify(Object.fromEntries(files.map(f => [f,
            crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])), null, 2)+'\n');
        fs.writeFileSync(path.join(out, 'cleanup.json'), JSON.stringify({timersCleared:true, socketStandIns:sockets.length,
            servicesLaunched:false})+'\n');
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
