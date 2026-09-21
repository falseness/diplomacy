#!/usr/bin/env node
'use strict';
// Offline oracle only. Synthetic event ordering is NOT browser/network evidence.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); assert(i >= 0 && args[i + 1], `required ${name}`); return path.resolve(args[i + 1]); }
const bundlePath = option('--bundle');
const evidence = option('--comparison');
const output = option('--output-dir');
assert(!fs.existsSync(output), 'refuse evidence overwrite');
fs.mkdirSync(output, {recursive: true});
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const identities = [];
function read(file) { const bytes = fs.readFileSync(file); identities.push({path: file, sha256: sha(bytes)}); return bytes.toString(); }
const checks = [];
function check(name, actual, expected) {
  actual = JSON.parse(JSON.stringify(actual));
  checks.push({name, expected, actual, passed: JSON.stringify(actual) === JSON.stringify(expected)});
  assert.deepStrictEqual(actual, expected, name);
  console.log(`PASS ${name}`);
}
try {
  read(__filename);
  check('shipped-index-url', read(path.resolve(__dirname, '../index.html')).includes('src="https://cdn.socket.io/socket.io-3.0.0.js"'), true);
  const bundle = read(bundlePath);
  check('pinned-current-cdn-sha256', sha(bundle), 'e3ea5880b996b7c89a9475540bbc0dbc0ab556beac6f42b6d8ec727218f2d51a');
  // Expose the bundle's module loader; no module or transition body is modified.
  const anchor = 'return __webpack_require__(__webpack_require__.s = "./build/index.js");';
  check('unique-loader-anchor', bundle.split(anchor).length, 2);
  const timers = [];
  const context = vm.createContext({console, setTimeout: (fn, delay) => { const t = {fn, delay}; timers.push(t); return t; }, clearTimeout: t => { t.cancelled = true; }});
  vm.runInContext(bundle.replace(anchor, 'globalThis.bundleRequire = __webpack_require__; ' + anchor), context);
  const req = context.bundleRequire;
  const Engine = req('./node_modules/engine.io-client/lib/socket.js');
  const Polling = req('./node_modules/engine.io-client/lib/transports/polling.js');
  const Emitter = req('./node_modules/component-emitter/index.js');
  const Manager = req('./build/manager.js').Manager;
  const traces = [];
  function scenario(name, polling, writable, events, expected) {
    const trace = [];
    const old = Object.create(Polling.prototype);
    Object.assign(old, {polling, writable, readyState: 'open', socket: {}, doClose() { trace.push('old-close'); }});
    const probe = new Emitter();
    Object.assign(probe, {name: 'websocket', send: packets => trace.push(...packets.map(p => p.type)), open() { this.emit('open'); }, close() { trace.push('probe-close'); }});
    const socket = Object.create(Engine.prototype);
    Object.assign(socket, {readyState: 'open', transport: old, createTransport: () => probe, flush() { trace.push('flush'); }});
    socket.on('upgrade', () => trace.push('upgrade-event'));
    socket.on('upgradeError', e => trace.push(e.message));
    socket.probe('websocket');
    probe.emit('packet', {type: 'pong', data: 'probe'});
    for (const event of events) {
      if (event === 'probe-close') probe.emit('close');
      else if (event === 'socket-close') { socket.readyState = 'closed'; socket.emit('close'); }
      else old.emit(event);
    }
    const actual = {transport: socket.transport.name, old: old.readyState, upgrades: trace.filter(x => x === 'upgrade').length, errors: trace.filter(x => x.startsWith('probe error')), socket: socket.readyState};
    check(name, actual, expected);
    traces.push({name, fixture: {polling, writable, events}, trace, actual});
  }
  const success = {transport:'websocket', old:'paused', upgrades:1, errors:[], socket:'open'};
  const waiting = {transport:'polling', old:'pausing', upgrades:0, errors:[], socket:'open'};
  scenario('idle-upgrades-immediately', false, true, [], success);
  scenario('pending-poll-blocks-upgrade', true, true, [], waiting);
  scenario('pending-write-blocks-upgrade', false, false, [], waiting);
  scenario('both-pending-poll-alone-insufficient', true, false, ['pollComplete'], waiting);
  scenario('both-pending-drain-alone-insufficient', true, false, ['drain'], waiting);
  scenario('poll-then-drain-upgrades-once', true, false, ['pollComplete','drain','pollComplete','drain'], success);
  scenario('drain-then-poll-upgrades-once', true, false, ['drain','pollComplete','drain','pollComplete'], success);
  scenario('probe-close-before-completion', true, false, ['probe-close','pollComplete','drain'], {...success, transport:'polling', upgrades:0, errors:['probe error: transport closed']});
  scenario('socket-close-before-completion', true, false, ['socket-close','pollComplete','drain'], {...success, transport:'polling', upgrades:0, errors:['probe error: socket closed'], socket:'closed'});
  // Real polling decode/close behavior, with no network and a declared close boundary.
  for (const [payload, expected] of [['6', {state:'paused', completed:1}], ['1', {state:'closed', completed:0}]]) {
    const poll = Object.create(Polling.prototype);
    Object.assign(poll, {readyState:'open', polling:true, writable:true, socket:{}, doClose() {}});
    let completed = 0;
    poll.pause(() => completed++);
    poll.onData(payload);
    check(`polling-payload-${payload}`, {state:poll.readyState, completed}, expected);
  }
  const manager = new Manager('https://offline.invalid', {autoConnect:false, reconnection:true, randomizationFactor:0});
  let opens = 0;
  const reconnects = [];
  manager.open = cb => { opens++; cb(); }; // Declared successful synthetic open boundary.
  manager.on('reconnect', n => reconnects.push(n));
  manager.onclose('transport close');
  check('close-schedules-one-reconnect', timers.filter(t => !t.cancelled).length, 1);
  manager.reconnect();
  check('duplicate-reconnect-does-not-schedule-twice', timers.filter(t => !t.cancelled).length, 1);
  timers.find(t => !t.cancelled).fn();
  check('synthetic-open-completes-reconnect', {opens, reconnects, reconnecting:manager._reconnecting}, {opens:1, reconnects:[1], reconnecting:false});
  const observations = [];
  for (const arm of ['1-U','2-R','3-R']) {
    const file = path.join(evidence, arm, 'repetitions/coop-12-01/wire.jsonl');
    const rows = read(file).trim().split('\n').map(JSON.parse);
    for (const player of ['p7','p12']) {
      const selected = rows.filter(r => r.player === player);
      const counts = {
        opens: selected.filter(r => r.engineType === '0').length,
        probePongs: selected.filter(r => r.engine === '3probe').length,
        upgrades: selected.filter(r => r.engine === '5' && r.direction === 'sent').length
      };
      check(`saved-${arm}-${player}-observations`, counts, arm === '1-U' ? {opens:2, probePongs:2, upgrades:1} : {opens:1, probePongs:1, upgrades:1});
      observations.push({arm, player, counts, rows:selected});
    }
  }
  save('transition-traces.json', {kind:'synthetic offline oracle; no network or gameplay claims', traces});
  save('saved-observations.json', {limits:'The current CDN bytes are pinned against index.html, but historical browser bundle bytes were not archived and byte identity with past races is unproven. Body-read timestamps are not delivery times; redacted SIDs cannot identify server sessions. No pollComplete/drain/close callback order was captured. Counts do not prove server acceptance or transport causation.', observations});
  console.log(`OFFLINE REPLAY PASSED ${checks.length}/${checks.length}; transport causation unresolved; no gate run`);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  save('checkpoints.json', {passed:checks.filter(c => c.passed).length, failed:checks.filter(c => !c.passed).length, checks});
  save('source-identities.json', identities);
}
