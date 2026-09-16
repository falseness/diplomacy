'use strict';
// Typed four-round waves through the local authoritative server (TASK-155).
//
// Adapter mode (default) reversibly materializes the sibling server's HEAD files
// plus ops/coop-scaled-matchmaking-server.patch, runs the sibling matchmaking suite
// and this file in --server-child mode, restores the original sibling bytes on
// success or ordinary failure, then runs the named negative controls as nested
// adapter runs. Nothing is deployed and no external service is contacted.
//
// Child mode loads the production server/loadGameCode.js and server/index.js with
// only persistence, TLS and the listening address replaced (in-memory rows,
// loopback socket.io). Current generated Tiny H2 and H10 games are created and
// played by socket.io peers through startGameOrConnect/nextTurn:
//   - forged typed-portal creation requests are rejected before persistence;
//   - every submission is emitted three times, and the final submission of each
//     round again after the round commits: each round runs one wave/demon phase;
//   - committed peer snapshots at rounds 4/8/12 are identical and hold the typed
//     spawns expected from a literal schedule, including occupied and destroyed portals;
//   - client-submitted demon commands (and portal/marker forgeries) are rejected;
//   - peers reconnect before and after the round-4 wave, the server restarts from
//     the committed round-8 rows, and round 12 resumes from its wave checkpoint and
//     from a replayed phase checkpoint without spawning twice.
// Setup disclosure: humans submit their emitted boards unchanged (idle turns). The
// demon AI move is replaced by a test-owned authoritative plan that removes older
// demons, holds one normal-portal imp from round 4 through round 7 (occupied at the
// round-8 wave) and destroys one ranged portal after the round-4 wave and one heavy
// portal after the round-8 wave. Rules, spawning and persistence are production code.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const {spawnSync, execFileSync} = require('child_process');
const {createRequire} = require('module');
const {once} = require('events');
const {isDeepStrictEqual} = require('util');

const ROOT = path.join(__dirname, '..');
const SIBLING = path.resolve(ROOT, '../diplomacy_server');
const PATCH = path.join(ROOT, 'ops/coop-scaled-matchmaking-server.patch');
const UNTYPED_PATCH_REVISION = '9f9802e'; // TASK-142 revision without typed portal validation
const SIBLING_FILES = ['server/loadGameCode.js', 'server/matchmakingSlots.js',
  'tests/coop/browser-online.test.js', 'tests/coop/matchmaking.test.js'];
const SCENARIOS = {h2: {humans: 2, size: 'tiny', seed: 0}, h10: {humans: 10, size: 'tiny', seed: 0}};
const FAULTS = {
  'accept-untyped-portals': 'forged-typed-portals-rejected',
  'accept-demon-command': 'client-demon-command-rejected',
  'drop-typed-wave-guard': 'replayed-phase-no-duplicate'
};
const FIXED_NOW = 1700000000000;
const LAST_ROUND = 12;
// Independent literal schedule: category -> demon type at wave rounds 4, 8, 12
// (installed c20 progression: ranged starts at 12, heavy at 20, highTier at 24).
const LITERAL_WAVES = {4: {normal: 'imp'}, 8: {normal: 'clawling'},
  12: {normal: 'hound', ranged: 'spitter'}};
// Independent literal next production after completed rounds 4, 8 and 12.
const LITERAL_NEXT = {
  4: {normal: {round: 8, type: 'clawling', roundsRemaining: 4}, ranged: {round: 12, type: 'spitter', roundsRemaining: 8},
    heavy: {round: 20, type: 'brute', roundsRemaining: 16}, highTier: {round: 24, type: 'ravager', roundsRemaining: 20}},
  8: {normal: {round: 12, type: 'hound', roundsRemaining: 4}, ranged: {round: 12, type: 'spitter', roundsRemaining: 4},
    heavy: {round: 20, type: 'brute', roundsRemaining: 12}, highTier: {round: 24, type: 'ravager', roundsRemaining: 16}},
  12: {normal: {round: 16, type: 'hound', roundsRemaining: 4}, ranged: {round: 16, type: 'emberArcher', roundsRemaining: 4},
    heavy: {round: 20, type: 'brute', roundsRemaining: 8}, highTier: {round: 24, type: 'ravager', roundsRemaining: 12}}
};
const SOURCES = ['ai/test-coop-typed-wave-server.js', 'ops/coop-scaled-matchmaking-server.patch', 'ops/apply_coop_scaled_matchmaking.py',
  'ops/coop-scaled-matchmaking.md', 'ai/wave-config.js', 'ai/wave-composition.js', 'ai/wave-placement.js', 'ai/generateMap.js',
  'ai/coop-valley-plan.js', 'ai/coop-map-scaling.js', 'sprites/entities/buildings/demonPortal.js', 'ai/players.js', 'nextTurn.js',
  'options/save.js', 'options/gamestart.js', 'gameObjectSerialization.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js', 'index.html'];
const SERVER_SOURCES = ['server/index.js', 'server/coopAuthority.js', 'server/gameRound.js', 'server/matchmakingKey.js',
  'server/getPlayersParallelOrder.js', 'server/legacyRound.js', 'server/lobbyStatus.js'];

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
if (!option('--output-dir')) { console.error('usage: test-coop-typed-wave-server.js --output-dir DIR [--fault NAME]'); process.exit(2); }
const outDir = path.resolve(option('--output-dir'));
const fault = option('--fault');
if (fault !== null && !FAULTS[fault]) { console.error('unknown fault ' + fault); process.exit(2); }
const scenarioIds = (option('--scenarios') || (fault ? 'h2' : 'h2,h10')).split(',');
if (scenarioIds.some(id => !SCENARIOS[id])) { console.error('unknown scenario'); process.exit(2); }
const SERVER = path.resolve(option('--server-dir') || SIBLING);

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(outDir, rel)), {recursive: true}); fs.writeFileSync(path.join(outDir, rel), text); };
const writeJson = (rel, value) => write(rel, JSON.stringify(value, null, 1) + '\n');

// ---------------------------------------------------------------- adapter mode
function materialize(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-typed-wave-server-'));
  try {
    for (const file of SIBLING_FILES) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
      fs.writeFileSync(path.join(dir, file), execFileSync('git', ['-C', SIBLING, 'show', 'HEAD:' + file]));
    }
    const patch = kind === 'accept-untyped-portals'
      ? execFileSync('git', ['-C', ROOT, 'show', UNTYPED_PATCH_REVISION + ':ops/coop-scaled-matchmaking-server.patch'])
      : fs.readFileSync(PATCH);
    execFileSync('git', ['-C', dir, 'apply', '-'], {input: patch});
    return {files: Object.fromEntries(SIBLING_FILES.map(f => [f, fs.readFileSync(path.join(dir, f))])), patchSha256: sha(patch)};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

function adapter() {
  if (!fault && ['checkpoints.json', 'server-results.json', 'fixture-hashes.json'].some(f => fs.existsSync(path.join(outDir, f)))) {
    console.error(`REFUSED existing evidence in ${outDir}; choose a new --output-dir`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, {recursive: true});
  const t0 = Date.now();
  console.log(`ADAPTER cwd=${process.cwd()} node=${process.version} server=${SIBLING} fault=${fault || 'none'} scenarios=${scenarioIds.join(',')} output=${outDir}`);
  const originals = SIBLING_FILES.map(f => fs.readFileSync(path.join(SIBLING, f)));
  const {files, patchSha256} = materialize(fault);
  const fixture = {purpose: 'temporary sibling fixture adaptation; original bytes restored in finally', siblingDir: SIBLING,
    siblingHead: execFileSync('git', ['-C', SIBLING, 'rev-parse', 'HEAD']).toString().trim(),
    patch: fault === 'accept-untyped-portals' ? `${UNTYPED_PATCH_REVISION}:ops/coop-scaled-matchmaking-server.patch` : 'ops/coop-scaled-matchmaking-server.patch',
    patchSha256, files: SIBLING_FILES.map((file, i) => ({file, before: sha(originals[i]), applied: sha(files[file]), after: null, restoredEqual: null}))};
  let restored = false;
  const restore = () => {
    if (restored) return; restored = true;
    SIBLING_FILES.forEach((file, i) => {
      fs.writeFileSync(path.join(SIBLING, file), originals[i]);
      const record = fixture.files[i];
      record.after = sha(fs.readFileSync(path.join(SIBLING, file)));
      record.restoredEqual = record.after === record.before;
      console.log(`RESTORED ${file} before=${record.before} after=${record.after} equal=${record.restoredEqual}`);
    });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { restore(); writeJson('fixture-hashes.json', fixture); process.exit(130); });
  const report = {test: 'ai/test-coop-typed-wave-server.js', node: process.version, cwd: process.cwd(), fault, steps: {}};
  let status = 1;
  try {
    SIBLING_FILES.forEach((file, i) => {
      fs.writeFileSync(path.join(SIBLING, file), files[file]);
      console.log(`APPLIED ${file} before=${fixture.files[i].before} applied=${fixture.files[i].applied}`);
    });
    if (!fault) {
      const command = [process.execPath, '--test', 'tests/coop/matchmaking.test.js'];
      console.log(`BEGIN server-suite cwd=${SIBLING} command=${command.join(' ')}`);
      const suite = spawnSync(command[0], command.slice(1), {cwd: SIBLING, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
        env: {...process.env, COOP_TEST_OUTPUT_DIR: path.join(outDir, 'server-suite')}});
      write('server-suite/stdout.log', suite.stdout); write('server-suite/stderr.log', suite.stderr);
      process.stdout.write(suite.stdout.split('\n').filter(l => /^(# (tests|suites|pass|fail|cancelled|duration_ms)|ok |not ok |# PASS )/.test(l)).join('\n') + '\n');
      process.stdout.write(suite.stderr);
      console.log(`END server-suite actual_exit_status=${suite.status}`);
      report.steps.serverSuite = {command: command.join(' '), cwd: SIBLING, status: suite.status,
        summary: suite.stdout.split('\n').filter(l => /^# (tests|pass|fail|PASS)/.test(l))};
      assert.equal(suite.status, 0, 'server-matchmaking-suite');
    }
    const childArgs = [__filename, '--server-child', '--output-dir', outDir, '--scenarios', scenarioIds.join(','), ...(fault ? ['--fault', fault] : [])];
    console.log(`BEGIN server-child cwd=${ROOT} command=${[process.execPath, ...childArgs].join(' ')}`);
    const child = spawnSync(process.execPath, childArgs, {cwd: ROOT, stdio: 'inherit'});
    console.log(`END server-child actual_exit_status=${child.status}`);
    report.steps.serverChild = {status: child.status};
    status = child.status ?? 1;
  } finally {
    restore();
    writeJson('fixture-hashes.json', fixture);
  }
  assert.ok(fixture.files.every(r => r.restoredEqual), 'sibling-restored');
  if (status !== 0) { process.exitCode = status; return; }
  if (fault) return;

  report.negativeControls = [];
  for (const [name, assertion] of Object.entries(FAULTS)) {
    const dir = path.join(outDir, 'negative-control', name);
    const args = [__filename, '--fault', name, '--scenarios', 'h2', '--output-dir', dir];
    console.log(`BEGIN negative-control ${name} cwd=${process.cwd()} command=${[process.execPath, ...args].join(' ')}`);
    const run = spawnSync(process.execPath, args, {encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024});
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'stdout.log'), run.stdout); fs.writeFileSync(path.join(dir, 'stderr.log'), run.stderr);
    const pattern = new RegExp(`AssertionError \\[ERR_ASSERTION\\]: ${assertion}\\b.*`);
    const line = (run.stderr.match(pattern) || [null])[0];
    const nested = JSON.parse(fs.readFileSync(path.join(dir, 'fixture-hashes.json')));
    const record = {name, assertion, status: run.status, namedAssertion: !!line, assertionLine: line,
      siblingRestored: nested.files.every(r => r.restoredEqual)};
    console.log(run.stdout.split('\n').filter(l => /^(ADAPTER|APPLIED|RESTORED|END)/.test(l)).join('\n'));
    console.log(`END negative-control ${name} actual_exit_status=${run.status} named_assertion=${record.namedAssertion} ${line}`);
    report.negativeControls.push(record);
    assert.deepEqual([run.status, record.namedAssertion, record.siblingRestored], [1, true, true], 'negative-control-' + name);
  }
  report.elapsedMs = Date.now() - t0;
  const results = JSON.parse(fs.readFileSync(path.join(outDir, 'server-results.json')));
  results.adapter = report;
  writeJson('server-results.json', results);
  writeJson('source-identities.json', {algorithm: 'sha256', node: process.version,
    game: {dir: ROOT, head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim(),
      files: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]))},
    server: {dir: SIBLING, head: fixture.siblingHead,
      unpatchedFiles: Object.fromEntries(SERVER_SOURCES.map(f => [f, sha(fs.readFileSync(path.join(SIBLING, f)))])),
      patchedFilesAsTested: Object.fromEntries(fixture.files.map(r => [r.file, r.applied])),
      originalFilesRestored: Object.fromEntries(fixture.files.map(r => [r.file, r.after]))}});
  const s = results.summary;
  console.log(`PASS typed-wave-server scenarios=${scenarioIds.join(',')} checkpoints=${s.checks} waves=${s.waves} spawns=${s.spawns} ` +
    `duplicates_ignored=${s.ignored} forged_creations_rejected=${s.forgedCreations} client_commands_rejected=${s.clientCommands} ` +
    `reconnects=${s.reconnects} restarts=${s.restarts} resumes=${s.resumes} server_suite=0 ` +
    `negative_controls=${report.negativeControls.map(n => n.name + ':' + n.status).join(',')} sibling_restored=true`);
}

// ------------------------------------------------------------------ child mode
async function serverChild() {
  Date.now = () => FIXED_NOW;
  const realLog = console.log, realError = console.error;
  const ignoredLines = [], serverErrors = [];
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('@@ignoredNextTurn')) ignoredLines.push(a[0]);
    if (!(typeof a[0] === 'string' && /^(loaded|@@|A user connected|User disconnected)/.test(a[0]))) realLog(...a);
  };
  console.error = (...a) => { serverErrors.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' ')); realError(...a); };
  const runtime = require(path.join(SERVER, 'server/loadGameCode.js'));
  const {createFixture} = require('./test-coop-harness');
  const {getCoopMapScaling} = require('./coop-map-scaling');
  const {io: connect} = createRequire(path.join(SERVER, 'tests/coop/matchmaking.test.js'))('socket.io-client');
  const evaluate = code => vm.runInThisContext(code);
  evaluate(`isFogOfWar=false; townInterface={change(){},hide(){}}; barrackInterface={change(){},hide(){}};
    gameEvent={selected:new Empty(),hideAll(){},removeSelection(){this.selected=new Empty()},screen:{moveTo(){},moveToPlayer(){},stop(){}}}; undefined`);
  // Observe the production wave entry point; replace only the demon AI move by the
  // test-owned authoritative plan (see header).
  evaluate(`globalThis.typedCalls={spawn:[],play:[]}; globalThis.typedPlan=null; globalThis.typedLastSpawn=[];
    globalThis.typedOriginalSpawn=spawnCoopWave;
    spawnCoopWave=function(round){const result=typedOriginalSpawn.apply(this,arguments);
      typedCalls.spawn.push({round,spawned:result.spawned.map(s=>({...s}))});typedLastSpawn=result.spawned;return result};
    DemonPlayer.prototype.play=function(){
      const wave=gameRound+1; typedCalls.play.push(gameRound);
      const fresh=new Set(typedLastSpawn.map(s=>s.x+','+s.y)); typedLastSpawn=[];
      const held=typedPlan.occupied, hold=wave<=typedPlan.holdUntil;
      for(const unit of this.units.filter(u=>!u.killed)) {
        const key=unit.coord.x+','+unit.coord.y;
        if(fresh.has(key)||(hold&&unit.coord.x===held.x&&unit.coord.y===held.y))continue;
        unit.kill();
      }
      for(const cell of typedPlan.destroy[wave]||[]) grid.getBuilding(cell).kill();
    }; undefined`);
  if (fault === 'drop-typed-wave-guard') evaluate(`globalThis.typedGuardedGenerate=generateCoopWave;
    generateCoopWave=function(){delete gameSettings.coop.typedWaves;return typedGuardedGenerate.apply(this,arguments)}; undefined`);
  const client = createFixture(undefined, () => {});
  client.evaluate(`Date.now=()=>${FIXED_NOW}; isFogOfWar=false; townInterface={change(){},hide(){}}; barrackInterface={change(){},hide(){}};
    gameEvent={selected:new Empty(),hideAll(){},removeSelection(){this.selected=new Empty()},screen:{moveTo(){},moveToPlayer(){},stop(){}}}; undefined`);

  const checks = [];
  const compact = value => { const text = JSON.stringify(value); return text === undefined || text.length <= 600 ? value : {sha256: sha(text), bytes: text.length}; };
  function check(name, observed, expected) {
    const pass = isDeepStrictEqual(observed, expected);
    checks.push({name, pass, expected: compact(expected), observed: compact(observed)});
    realLog(JSON.stringify({check: name, pass, expected: compact(expected), observed: compact(observed)}));
    if (!pass) assert.fail(`${name.split(':')[0]}: ${name} expected ${JSON.stringify(compact(expected))} observed ${JSON.stringify(compact(observed))}`);
  }
  const traces = [], endpoints = [], results = {test: 'ai/test-coop-typed-wave-server.js', mode: 'server-child', fault, node: process.version,
    cwd: process.cwd(), serverDir: SERVER, fixedNow: FIXED_NOW, external: 'none (loopback 127.0.0.1 only, no deployment)', scenarios: {}};
  let seq = 0;
  const until = async (predicate, label, ms = 300000) => {
    const start = process.hrtime.bigint();
    while (!predicate()) {
      if (Number(process.hrtime.bigint() - start) / 1e6 > ms) throw new Error('timeout ' + label);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };

  // ---- production server over in-memory rows and loopback socket.io
  async function launch(label, rows, onGameUpdate = () => {}) {
    let nextId = 1;
    const matchValue = (row, key, value) => value && typeof value === 'object' && '$exists' in value
      ? (key in row) === value.$exists : value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : row[key] === value;
    const matches = (row, q) => Object.entries(q).every(([key, value]) => key === '$or' ? value.some(p => matches(row, p)) : matchValue(row, key, value));
    const db = {async createCollection() {}, collection(name) {
      const table = rows[name] || (rows[name] = []);
      return {
        async findOne(q) { const row = table.find(r => matches(r, q)); return row ? copy(row) : null; },
        find(q = {}) { return {sort() { return {async *[Symbol.asyncIterator]() { for (const row of table.filter(r => matches(r, q)).reverse()) yield copy(row); }}; }}; },
        async insertOne(row) { table.push({_id: label + '-row-' + nextId++, ...copy(row)}); },
        async deleteOne(q) { const i = table.findIndex(r => matches(r, q)); if (i >= 0) table.splice(i, 1); },
        async deleteMany(q) { for (let i = table.length - 1; i >= 0; i--) if (matches(table[i], q)) table.splice(i, 1); },
        async updateOne(q, u) {
          const row = table.find(r => matches(r, q)); assert(row, 'update target');
          for (const [key, value] of Object.entries(u.$set)) {
            const parts = key.split('.'); let target = row;
            for (const part of parts.slice(0, -1)) target = target[part];
            target[parts.at(-1)] = copy(value);
          }
          if (name === 'games') onGameUpdate(copy(row), u.$set, rows);
        }
      };
    }};
    const server = http.createServer();
    const listen = server.listen.bind(server); server.listen = () => listen(0, '127.0.0.1');
    const filename = path.join(SERVER, 'server/index.js');
    const realRequire = createRequire(filename);
    let transport;
    const customRequire = name => {
      if (name === 'https') return {createServer: () => server};
      if (name === 'mongodb') return {MongoClient: class { async connect() {} db() { return db; } }};
      if (name === 'socket.io') return (...args) => { transport = realRequire(name)(...args); return transport; };
      // Fault only: a server whose authority validator accepts every submission.
      if (name === './coopAuthority' && fault === 'accept-demon-command') return {validateCoopAuthority() {}};
      return realRequire(name);
    };
    const api = new Function('require', '__dirname', 'module', 'process', fs.readFileSync(filename, 'utf8') +
      '\nreturn {enqueueGameOperation,getCurrentParalleTurnInfo,loadGameWithCurrentRound};')(
      customRequire, path.dirname(filename), {exports: {}}, {...process, env: {...process.env, LOCAL_DEV: '1'}});
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const record = {label, endpoint, transport: 'socket.io websocket (loopback)', rowsSha256AtLaunch: sha(rows)};
    endpoints.push(record);
    const sockets = [];
    return {label, rows, api, endpoint, sockets, record,
      async close() { sockets.forEach(s => s.disconnect()); await new Promise(resolve => transport.close(resolve)); record.rowsSha256AtClose = sha(rows); }};
  }

  // ---- a human peer: one socket per server, a persistent inbox and a trace
  function makePeer(scenario, slot, password) {
    return {scenario, slot, password, inbox: [], waiters: [], socket: null, server: null};
  }
  async function attach(h, peer) {
    if (peer.socket) peer.socket.disconnect();
    const socket = connect(h.endpoint, {transports: ['websocket'], reconnection: false});
    h.sockets.push(socket);
    peer.socket = socket; peer.server = h.label;
    await once(socket, 'connect');
    for (const event of ['gameStarted', 'playYourTurn', 'waitYouTurn', 'error']) socket.on(event, body => {
      const board = event === 'error' ? null : JSON.parse(body);
      const meta = {seq: seq++, scenario: peer.scenario, server: h.label, endpoint: h.endpoint, dir: 'server->client', slot: peer.slot, event,
        revision: board?.coopCommit?.revision ?? null, gameID: board?.coopCommit?.gameID ?? null, gameRound: board?.gameRound ?? null,
        whooseTurn: board?.whooseTurn ?? null, bytes: typeof body === 'string' ? body.length : null,
        sha256: board ? sha(board) : null, error: event === 'error' ? body : undefined};
      traces.push(meta);
      const message = {...meta, board};
      peer.inbox.push(message);
      peer.waiters = peer.waiters.filter(waiter => !waiter(message));
    });
    return socket;
  }
  function emit(h, peer, event, payload, note) {
    const body = JSON.stringify(payload);
    traces.push({seq: seq++, scenario: peer.scenario, server: h.label, endpoint: h.endpoint, dir: 'client->server', slot: peer.slot, event, note,
      revision: payload.game?.coopCommit?.revision ?? null, gameRound: payload.game?.gameRound ?? null, bytes: body.length,
      sha256: payload.game ? sha(payload.game) : null});
    peer.socket.emit(event, body);
  }
  function waitFor(peer, predicate, label, ms = 300000) {
    const found = peer.inbox.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${label} slot=${peer.slot}`)), ms);
      peer.waiters.push(message => { if (!predicate(message)) return false; clearTimeout(timer); resolve(message); return true; });
    });
  }
  const withoutCommit = board => { const {coopCommit, ...rest} = board; return copy(rest); };
  const portalsOf = board => board.external.filter(e => e.name === 'demonPortal')
    .map(e => ({x: e.coord.x, y: e.coord.y, category: e.category, hp: e.hp, ownerSlot: e.ownerSlot})).sort((a, b) => a.x - b.x || a.y - b.y);
  const demonsOf = board => board.players[board.gameSettings.coop.demonSlot].units
    .map(u => ({name: u.name, x: u.coord.x, y: u.coord.y})).sort((a, b) => a.x - b.x || a.y - b.y);
  const committedProjection = board => ({gameRound: board.gameRound, gameSettings: board.gameSettings, grid: sha(board.grid),
    demonPlayer: sha(board.players[board.gameSettings.coop.demonSlot]), portals: portalsOf(board), demons: demonsOf(board)});
  const PREVIEW = `(() => { loadFromJson(typedBoard); const coop = gameSettings.coop;
    return JSON.stringify({gameRound, typedWaves: coop.typedWaves || null,
      portals: external.filter(e => e.isDemonPortal).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category, hp: p.hp,
        next: getCoopNextScheduledProduction(p.category, gameRound)})).sort((a, b) => a.x - b.x || a.y - b.y)}) })()`;
  const clientPreview = board => { client.context.typedBoard = JSON.stringify(board); return JSON.parse(client.evaluate(PREVIEW)); };
  const serverPreview = board => { global.typedBoard = JSON.stringify(board); return JSON.parse(evaluate(PREVIEW)); };
  const clientNextWave = (board, round) => { client.context.typedBoard = JSON.stringify(board);
    return JSON.parse(client.evaluate(`(() => { loadFromJson(typedBoard); return JSON.stringify(composeTypedCoopWave(${round},
      external.filter(e => e.isDemonPortal && !e.killed).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category})))) })()`)); };

  async function scenario(id, spec) {
    const {humans, size, seed} = spec;
    const out = {id, ...spec, rounds: {}, reconnects: [], restarts: [], resumes: [], forgedCreations: [], clientCommands: [], ignored: []};
    results.scenarios[id] = out;
    // ---- current generated board, identical in the client and server realms
    const BUILD = `(() => { const map = generateCoopGame(${humans}, {seed:${seed}, size:'${size}'});
      isFogOfWar = false; gameSettings.isOnline = true;
      map.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}}, false, false)
      whooseTurn = 0; gameRound = 0; actionManager.clear(); return JSON.stringify(getGameObject()) })()`;
    const localJson = client.evaluate(BUILD), serverJson = evaluate(BUILD);
    check(`server-client-generation:${id}-board`, sha(serverJson), sha(localJson));
    const board = JSON.parse(localJson);
    const scaling = getCoopMapScaling(humans, size);
    const portals = portalsOf(board);
    const byCategory = c => portals.filter(p => p.category === c);
    check(`typed-portals:${id}-layout`, {generation: board.gameSettings.coop.generation, count: portals.length,
      categories: Object.fromEntries(['normal', 'ranged', 'heavy', 'highTier'].map(c => [c, byCategory(c).length])),
      owners: [...new Set(portals.map(p => p.ownerSlot))], cells: new Set(portals.map(p => p.x + ',' + p.y)).size},
    {generation: {version: 4, playerCount: humans, seed, size, options: {seed, size}}, count: 4 * humans,
      categories: {normal: humans, ranged: humans, heavy: humans, highTier: humans}, owners: [humans + 1], cells: 4 * humans});
    check(`typed-portals:${id}-scaling-literal`, [scaling.counts.portals, scaling.counts.portalCategories], [4 * humans, {normal: humans, ranged: humans, heavy: humans, highTier: humans}]);
    const plan = {occupied: byCategory('normal')[0], holdUntil: 7,
      destroy: {4: [pick(byCategory('ranged')[0])], 8: [pick(byCategory('heavy')[0])]}};
    function pick(p) { return {x: p.x, y: p.y}; }
    global.typedPlanJson = JSON.stringify(plan); evaluate('typedPlan = JSON.parse(typedPlanJson); undefined');
    out.plan = plan;
    const same = (a, b) => a.x === b.x && a.y === b.y;
    const destroyedBy = wave => [...(wave > 4 ? plan.destroy[4] : []), ...(wave > 8 ? plan.destroy[8] : [])];
    const expectedSpawn = wave => portals.filter(p => LITERAL_WAVES[wave]?.[p.category] && !destroyedBy(wave).some(d => same(d, p)) &&
      !(wave === 8 && same(p, plan.occupied))).map(p => ({type: LITERAL_WAVES[wave][p.category], x: p.x, y: p.y}));
    // Round 8: normal portals minus the occupied one. Round 12: normal plus ranged
    // portals minus the destroyed ranged one (heavy portals first produce at 20).
    const literalCount = {4: humans, 8: humans - 1, 12: 2 * humans - 1};

    // ---- forged typed-portal creation requests: rejected before persistence
    const gate = await launch(`${id}-creation-gate`, {games: [], users: []});
    const forgeries = [
      ['category-distribution', b => { b.external.find(e => e.name === 'demonPortal' && e.category === 'normal').category = 'highTier'; }],
      ['missing-category', b => { delete b.external.find(e => e.name === 'demonPortal').category; }],
      ['missing-portal', b => { b.external.splice(b.external.findIndex(e => e.name === 'demonPortal'), 1); }],
      ['unknown-category', b => { b.external.find(e => e.name === 'demonPortal').category = 'boss'; }]];
    for (const [name, edit] of forgeries) {
      const forged = copy(board); edit(forged);
      const peer = makePeer(id, 0, `typed-${id}-forged-${name}`);
      await attach(gate, peer);
      const errorsBefore = serverErrors.length, rowsBefore = sha(gate.rows);
      emit(gate, peer, 'startGameOrConnect', {password: peer.password, game: forged}, 'forged-creation-' + name);
      const reply = await waitFor(peer, () => true, 'forged creation ' + name, 60000);
      const reason = serverErrors.slice(errorsBefore).join(' | ');
      const observed = {event: reply.event, error: reply.error ?? null, typedPortalGate: /Invalid co-op typed portals/.test(reason),
        rows: [gate.rows.games.length, gate.rows.users.length], rowsUnchanged: sha(gate.rows) === rowsBefore};
      out.forgedCreations.push({name, ...observed, serverReason: reason});
      check(`forged-typed-portals-rejected:${id}-${name}`, observed,
        {event: 'error', error: 'catched error', typedPortalGate: true, rows: [0, 0], rowsUnchanged: true});
    }
    await gate.close();

    // ---- creation through startGameOrConnect
    const captured = {};
    let captureRound = null;
    const onUpdate = (row, set, rows) => {
      if (captureRound !== null && set.coopCheckpoint && set.coopCheckpoint.stage && set.coopCheckpoint.round === captureRound)
        captured[set.coopCheckpoint.stage] = {games: [row], users: copy(rows.users)};
    };
    let h = await launch(`${id}-server-1`, {games: [], users: []}, onUpdate);
    const peers = Array.from({length: humans}, (_, i) => makePeer(id, i + 1, `typed-${id}-human-${i + 1}`));
    for (const peer of peers) {
      await attach(h, peer);
      emit(h, peer, 'startGameOrConnect', {password: peer.password, game: board}, 'create-or-join');
      await waitFor(peer, m => m.server === h.label, 'join');
    }
    const game0 = h.rows.games[0];
    check(`creation:${id}-rows-and-slots`, {games: h.rows.games.length, users: h.rows.users.length,
      creatorEvent: peers[0].inbox[0].event, joinEventsKnown: peers.slice(1).every(p => ['playYourTurn', 'waitYouTurn'].includes(p.inbox[0].event)),
      slots: peers.map(p => p.inbox[0].whooseTurn), revisions: peers.map(p => p.inbox[0].revision)},
    {games: 1, users: humans, creatorEvent: 'gameStarted', joinEventsKnown: true, slots: peers.map(p => p.slot), revisions: Array(humans).fill(0)});
    check(`typed-portals:${id}-stored-initial-categories`, portalsOf(game0.rounds[0][0].parallelTurnResult), portals);
    const gameID = game0.gameID;
    const ctx = {revision: 0};
    const latest = (peer, server) => peer.inbox.filter(m => m.server === server && m.event !== 'error').at(-1);

    async function snapshotPeers(label, wave) {
      const messages = peers.map(peer => latest(peer, h.label));
      const stored = h.rows.games[0].rounds.at(-1)[0].parallelTurnResult;
      const projections = messages.map(m => committedProjection(m.board));
      check(`peer-snapshot:${id}-${label}-identical-committed`, {projections: projections.map(sha), revisions: messages.map(m => m.revision), gameIDs: messages.map(m => m.gameID)},
        {projections: Array(humans).fill(sha(committedProjection(stored))), revisions: Array(humans).fill(ctx.revision), gameIDs: Array(humans).fill(gameID)});
      messages.forEach(m => writeJson(`peer-snapshots/${id}-${label}-slot${m.slot}.json`, {slot: m.slot, event: m.event, server: m.server, endpoint: h.endpoint,
        revision: m.revision, gameRound: m.gameRound, boardSha256: m.sha256, board: m.board}));
      const preview = clientPreview(messages[0].board);
      check(`preview-inputs:${id}-${label}-server-equals-client`, serverPreview(stored), preview);
      messages.slice(1).forEach(m => check(`preview-inputs:${id}-${label}-slot${m.slot}-equals-slot1`, sha(clientPreview(m.board)), sha(preview)));
      if (LITERAL_NEXT[wave]) check(`preview-inputs:${id}-${label}-literal-next`, preview.portals.map(p => ({x: p.x, y: p.y, next: p.next})),
        preview.portals.map(p => ({x: p.x, y: p.y, next: LITERAL_NEXT[wave][p.category]})));
      return {messages, preview, stored};
    }

    async function completeRound(round) {
      const wave = round + 1;
      evaluate('typedCalls={spawn:[],play:[]}; undefined');
      const roundIgnoredStart = ignoredLines.length;
      const submissions = [];
      let last = null;
      for (let guard = 0; ; guard++) {
        assert.ok(guard <= humans + 1, 'round driver guard');
        const rev = ctx.revision;
        const messages = await Promise.all(peers.map(peer => waitFor(peer, m => m.server === h.label && m.revision === rev && m.event !== 'error', `revision ${rev}`)));
        const current = peers.map(peer => latest(peer, h.label));
        if (current.every(m => m.gameRound === wave)) break;
        check(`round-driver:${id}-round${round}-rev${rev}`, {rounds: current.map(m => m.gameRound), revisions: current.map(m => m.revision)},
          {rounds: Array(humans).fill(round), revisions: Array(humans).fill(rev)});
        const active = current.filter(m => m.event !== 'waitYouTurn');
        assert.ok(active.length > 0 && messages.length === humans, 'active human');
        const peer = peers[active[0].slot - 1];
        const payload = {password: peer.password, game: withoutCommit(active[0].board)};
        const ignoredBefore = ignoredLines.length;
        for (let i = 0; i < 3; i++) emit(h, peer, 'nextTurn', payload, i ? 'retry-duplicate' : 'submission');
        await Promise.all(peers.map(p => waitFor(p, m => m.server === h.label && m.revision === rev + 1, `revision ${rev + 1}`)));
        await until(() => ignoredLines.length >= ignoredBefore + 2, 'duplicate ignored');
        out.ignored.push(...ignoredLines.slice(ignoredBefore));
        ctx.revision = rev + 1;
        submissions.push({slot: peer.slot, revisionBefore: rev});
        last = {peer, payload};
      }
      const ignoredBefore = ignoredLines.length, inboxBefore = peers.map(p => p.inbox.length);
      emit(h, last.peer, 'nextTurn', last.payload, 'late-retry-final-submission');
      await until(() => ignoredLines.length >= ignoredBefore + 1, 'late retry ignored');
      out.ignored.push(...ignoredLines.slice(ignoredBefore));
      const calls = JSON.parse(evaluate('JSON.stringify(typedCalls)'));
      const stored = h.rows.games[0];
      const board = stored.rounds.at(-1)[0].parallelTurnResult;
      check(`no-duplicate-phase:${id}-round${wave}`, {spawnRounds: calls.spawn.map(c => c.round), playRounds: calls.play, storedRounds: stored.rounds.length,
        typedWaves: board.gameSettings.coop.typedWaves, lateRetry: /stale-round/.test(ignoredLines.at(-1)), noExtraMessages: peers.map((p, i) => p.inbox.length === inboxBefore[i]),
        ignoredThisRound: ignoredLines.length - roundIgnoredStart, acceptedSubmissions: submissions.length},
      {spawnRounds: [wave], playRounds: [round], storedRounds: wave + 1, typedWaves: {lastRound: wave}, lateRetry: true,
        noExtraMessages: Array(humans).fill(true), ignoredThisRound: 2 * humans + 1, acceptedSubmissions: humans});
      const spawned = calls.spawn[0].spawned.sort((a, b) => a.x - b.x || a.y - b.y);
      const expected = LITERAL_WAVES[wave] ? expectedSpawn(wave) : [];
      check(`typed-spawns:${id}-round${wave}`, spawned, expected);
      if (literalCount[wave] !== undefined) check(`typed-spawns:${id}-round${wave}-literal-count`, spawned.length, literalCount[wave]);
      out.rounds[wave] = {submissions, revisionAfter: ctx.revision, spawned, server: h.label, storedRoundsSha256: sha(stored.rounds)};
      return {spawned};
    }

    // Reconnect one peer and require its exact latest committed board.
    async function reconnect(label, peer) {
      const before = latest(peer, h.label);
      const stale = copy(board); stale.gameRound = 7;
      const rowsBefore = sha(h.rows.games);
      await attach(h, peer);
      const count = peer.inbox.length;
      emit(h, peer, 'startGameOrConnect', {password: peer.password, game: stale}, 'reconnect-' + label);
      const reply = await waitFor(peer, (m => peer.inbox.indexOf(m) >= count), 'reconnect ' + label);
      const record = {label, slot: peer.slot, server: h.label, endpoint: h.endpoint, event: reply.event, revision: reply.revision,
        gameRound: reply.gameRound, boardSha256: reply.sha256, expectedSha256: before.sha256};
      out.reconnects.push(record);
      writeJson(`peer-snapshots/${id}-reconnect-${label}-slot${peer.slot}.json`, {...record, board: reply.board});
      check(`reconnect:${id}-${label}-exact`, {event: reply.event, board: reply.sha256, rowsUnchanged: sha(h.rows.games) === rowsBefore},
        {event: before.event === 'gameStarted' ? 'playYourTurn' : before.event, board: before.sha256, rowsUnchanged: true});
    }

    // Client-submitted demon commands and forged typed state over the socket.
    async function clientCommands() {
      const peer = peers.find(p => latest(p, h.label).event !== 'waitYouTurn');
      const base = withoutCommit(latest(peer, h.label).board);
      const slot = base.gameSettings.coop.demonSlot;
      const demon = base.players[slot].units[0];
      assert.ok(demon, 'a committed demon exists for command forgeries');
      const commands = [
        ['move-demon', 'demon spawn/movement', b => { b.players[slot].units[0].coord.x += b.players[slot].units[0].coord.x > 0 ? -1 : 1; }],
        ['spawn-demon', 'demon spawn/movement', b => { const u = copy(demon); u.coord = {x: plan.destroy[4][0].x, y: plan.destroy[4][0].y}; b.players[slot].units.push(u); }],
        ['demon-actions', 'demon actions/identity', b => { b.players[slot].units[0].moves = (b.players[slot].units[0].moves || 0) + 5; }],
        ['portal-category', 'portal actions/identity', b => { const p = b.external.find(e => e.name === 'demonPortal'); p.category = p.category === 'highTier' ? 'normal' : 'highTier'; }],
        ['portal-spawn', 'portal spawn/movement', b => { const p = copy(b.external.find(e => e.name === 'demonPortal')); p.coord = {...plan.destroy[4][0]}; b.external.push(p); }],
        ['typed-wave-marker', 'settings/phase/result', b => { b.gameSettings.coop.typedWaves = {lastRound: 8}; }],
        ['demon-economy', 'demon controller/economy', b => { b.players[slot].gold += 100; }]];
      for (const [name, label, edit] of commands) {
        const forged = copy(base); edit(forged);
        const errorsBefore = serverErrors.length, rowsBefore = sha(h.rows.games), counts = peers.map(p => p.inbox.length);
        emit(h, peer, 'nextTurn', {password: peer.password, game: forged}, 'client-command-' + name);
        const reply = await waitFor(peer, m => peer.inbox.indexOf(m) >= counts[peer.slot - 1], 'command ' + name, 120000);
        const reason = serverErrors.slice(errorsBefore).join(' | ');
        const observed = {event: reply.event, authorityLabel: reason.includes('co-op authority: ' + label), rowsUnchanged: sha(h.rows.games) === rowsBefore,
          otherPeersSilent: peers.every((p, i) => p === peer || p.inbox.length === counts[i])};
        out.clientCommands.push({name, expectedLabel: label, ...observed, serverReason: reason});
        check(`client-demon-command-rejected:${id}-${name}`, observed, {event: 'error', authorityLabel: true, rowsUnchanged: true, otherPeersSilent: true});
      }
    }

    // ---- rounds 1..8 on the first server
    const snapshots = {};
    for (let round = 0; round < 8; round++) {
      if (round === 3) await reconnect('before-wave-4', peers[0]);
      if (round === 4) { await reconnect('after-wave-4', peers[humans - 1]); await clientCommands(); }
      await completeRound(round);
      if (round + 1 === 4) snapshots[4] = await snapshotPeers('round4', 4);
    }
    snapshots[8] = await snapshotPeers('round8', 8);
    const nextWaveBefore = clientNextWave(snapshots[8].messages[0].board, 12);

    // ---- restart the test-owned server from the committed round-8 rows
    const saved = copy(h.rows);
    await h.close();
    h = await launch(`${id}-server-2-restarted-from-round8`, copy(saved), onUpdate);
    for (const peer of peers) {
      const before = latest(peer, `${id}-server-1`);
      await attach(h, peer);
      emit(h, peer, 'startGameOrConnect', {password: peer.password, game: board}, 'restart-reconnect');
      const reply = await waitFor(peer, m => m.server === h.label, 'restart reconnect');
      const restoredPreview = clientPreview(reply.board);
      const record = {slot: peer.slot, server: h.label, endpoint: h.endpoint, event: reply.event, revision: reply.revision, gameRound: reply.gameRound,
        boardSha256: reply.sha256, expectedSha256: before.sha256, previewSha256: sha(restoredPreview)};
      out.restarts.push(record);
      writeJson(`peer-snapshots/${id}-restart-round8-slot${peer.slot}.json`, {...record, board: reply.board});
      check(`restart:${id}-slot${peer.slot}-exact-peer`, {event: reply.event, board: reply.sha256, revision: reply.revision},
        {event: before.event === 'gameStarted' ? 'playYourTurn' : before.event, board: before.sha256, revision: ctx.revision});
      check(`restart:${id}-slot${peer.slot}-preview-inputs`, restoredPreview, clientPreview(before.board));
      check(`restart:${id}-slot${peer.slot}-next-wave`, clientNextWave(reply.board, 12), nextWaveBefore);
    }
    check(`restart:${id}-rows-unchanged`, sha(h.rows), sha(saved));
    check(`restart:${id}-next-wave-literal`, nextWaveBefore.selections, portals.filter(p => !destroyedBy(9).some(d => same(d, p)) && LITERAL_WAVES[12][p.category])
      .map(p => ({x: p.x, y: p.y, type: LITERAL_WAVES[12][p.category]})));

    // ---- rounds 9..12 on the restarted server; capture the round-12 phase checkpoints
    for (let round = 8; round < LAST_ROUND; round++) {
      if (round === LAST_ROUND - 1) captureRound = round;
      const {spawned} = await completeRound(round);
      if (round + 1 === 12) check(`restart:${id}-predicted-wave-12-observed`, spawned, nextWaveBefore.selections.map(s => ({type: s.type, x: s.x, y: s.y})));
    }
    captureRound = null;
    snapshots[12] = await snapshotPeers('round12', 12);
    const liveRows = copy(h.rows);
    const live = peers.map(peer => latest(peer, h.label));
    // A direct duplicate dispatch of committed wave rounds is empty.
    global.typedBoard = JSON.stringify(snapshots[12].stored);
    const direct = JSON.parse(evaluate(`(() => { loadFromJson(typedBoard); return JSON.stringify([12, 8, 11].map(r => generateCoopWave(r).types.length)) })()`));
    check(`replayed-phase-no-duplicate:${id}-direct-dispatch-12-8-11`, direct, [0, 0, 0]);
    await h.close();

    // ---- resume round 12 from its persisted wave checkpoint, and from a replayed phase
    check(`phase-checkpoint:${id}-captured`, Object.keys(captured).sort(), ['complete', 'demon', 'wave']);
    const replay = copy(captured.demon);
    global.typedBoard = JSON.stringify(replay.games[0].coopCheckpoint.snapshot);
    const spawnedCells = JSON.stringify(out.rounds[12].spawned);
    // Replayed stale dispatch: the committed wave-12 marker is kept, the wave stage is
    // re-entered and every portal is free again, so only the marker prevents a respawn.
    replay.games[0].coopCheckpoint.snapshot = JSON.parse(evaluate(`(() => { loadFromJson(typedBoard);
      for (const s of ${spawnedCells}) grid.getUnit(s).kill(); return JSON.stringify(getGameObject()) })()`));
    replay.games[0].coopCheckpoint.stage = 'wave';
    for (const [label, rows, expectedCalls] of [['wave-checkpoint', captured.wave, {spawn: [{round: 12, count: out.rounds[12].spawned.length}], play: [11]}],
      ['replayed-phase', replay, {spawn: [{round: 12, count: 0}], play: [11]}]]) {
      evaluate('typedCalls={spawn:[],play:[]}; typedLastSpawn=[]; undefined');
      const r = await launch(`${id}-server-resume-${label}`, copy(rows));
      const peer = peers[0];
      await attach(r, peer);
      emit(r, peer, 'startGameOrConnect', {password: peer.password, game: board}, 'resume-' + label);
      const reply = await waitFor(peer, m => m.server === r.label, 'resume ' + label);
      const calls = JSON.parse(evaluate('JSON.stringify(typedCalls)'));
      const resumedBoard = r.rows.games[0].rounds.at(-1)[0].parallelTurnResult;
      const record = {label, server: r.label, endpoint: r.endpoint, event: reply.event, revision: reply.revision, gameRound: reply.gameRound,
        boardSha256: reply.sha256, calls: {spawn: calls.spawn.map(c => ({round: c.round, count: c.spawned.length})), play: calls.play},
        demons: demonsOf(resumedBoard), checkpointAfter: r.rows.games[0].coopCheckpoint ?? null, storedRounds: r.rows.games[0].rounds.length};
      out.resumes.push(record);
      writeJson(`peer-snapshots/${id}-resume-${label}-slot1.json`, {...record, board: reply.board});
      if (label === 'wave-checkpoint') {
        check(`phase-resume:${id}-wave-checkpoint-exact-peer`, {board: reply.sha256, revision: reply.revision, rounds: sha(r.rows.games[0].rounds)},
          {board: live[0].sha256, revision: ctx.revision, rounds: sha(liveRows.games[0].rounds)});
        check(`phase-resume:${id}-wave-checkpoint-calls`, {calls: record.calls, checkpointAfter: record.checkpointAfter, storedRounds: record.storedRounds},
          {calls: expectedCalls, checkpointAfter: null, storedRounds: 13});
      } else {
        check(`replayed-phase-no-duplicate:${id}-resumed-wave-stage`, {calls: record.calls, demons: record.demons,
          typedWaves: resumedBoard.gameSettings.coop.typedWaves, checkpointAfter: record.checkpointAfter, storedRounds: record.storedRounds},
        {calls: expectedCalls, demons: [], typedWaves: {lastRound: 12}, checkpointAfter: null, storedRounds: 13});
      }
      await r.close();
    }
    out.summary = {waves: [4, 8, 12].map(w => ({round: w, spawned: out.rounds[w].spawned.length})),
      spawns: Object.values(out.rounds).reduce((n, r) => n + r.spawned.length, 0), ignored: out.ignored.length, finalRevision: ctx.revision};
    realLog(`PASS scenario ${id} ${JSON.stringify(out.summary)}`);
  }

  let failure = null;
  try {
    for (const id of scenarioIds) await scenario(id, SCENARIOS[id]);
  } catch (error) { failure = error; }
  const scenarios = Object.values(results.scenarios);
  results.summary = {status: failure ? 'failed' : 'passed', checks: checks.length, failedChecks: checks.filter(c => !c.pass).length,
    waves: scenarios.reduce((n, s) => n + [4, 8, 12].filter(w => s.rounds[w]).length, 0),
    spawns: scenarios.reduce((n, s) => n + Object.values(s.rounds).reduce((m, r) => m + r.spawned.length, 0), 0),
    ignored: scenarios.reduce((n, s) => n + s.ignored.length, 0),
    forgedCreations: scenarios.reduce((n, s) => n + s.forgedCreations.length, 0),
    clientCommands: scenarios.reduce((n, s) => n + s.clientCommands.length, 0),
    reconnects: scenarios.reduce((n, s) => n + s.reconnects.length, 0), restarts: scenarios.reduce((n, s) => n + s.restarts.length, 0),
    resumes: scenarios.reduce((n, s) => n + s.resumes.length, 0), serverErrors: serverErrors.length,
    unexpectedServerErrors: serverErrors.filter(e => !/co-op authority:|Invalid co-op typed portals|invalid portal category/.test(e)),
    error: failure ? String(failure.stack || failure) : null, elapsedMs: Math.round(process.uptime() * 1000)};
  results.endpoints = endpoints;
  results.serverErrors = serverErrors;
  writeJson('checkpoints.json', {test: results.test, fault, node: process.version, status: results.summary.status, count: checks.length, checkpoints: checks});
  writeJson('protocol-traces.json', {endpoints, messages: traces});
  writeJson('server-results.json', results);
  if (failure) throw failure;
  check('server-errors:only-intended-rejections', results.summary.unexpectedServerErrors, []);
  if (!fault) check('coverage:scenarios', scenarioIds, ['h2', 'h10']);
  results.summary.checks = checks.length;
  writeJson('checkpoints.json', {test: results.test, fault, node: process.version, status: 'passed', count: checks.length, checkpoints: checks});
  writeJson('server-results.json', results);
  realLog(`PASS server-child ${JSON.stringify({...results.summary, unexpectedServerErrors: results.summary.unexpectedServerErrors.length})}`);
}

if (argv.includes('--server-child')) serverChild().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
else adapter();
