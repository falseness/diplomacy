'use strict';
// Authoritative server parity for Divided Valley (version-4) co-op maps.
//
// Adapter mode (default) reversibly materializes the sibling server's HEAD files
// plus ops/coop-scaled-matchmaking-server.patch, runs the sibling matchmaking suite
// and this file in --server-child mode against the real server runtime, then
// restores the original sibling bytes on success or ordinary failure. Positive
// mode also runs the named negative controls as nested adapter runs.
//
// Child mode loads server/loadGameCode.js (the production script loader) and the
// real server/index.js with only persistence, TLS and the listening address
// replaced (in-memory rows, loopback HTTP). It compares complete local-client and
// server generated maps and started boards, creates games through
// startGameOrConnect, reconnects on the same and on a restarted server, rejects
// unknown and downgraded generation versions before persistence, and resumes the
// persisted human, wave, demon and complete checkpoints of a round-3 wave.
// No live service is contacted and nothing is deployed.
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
const SERVER = path.resolve(ROOT, '../diplomacy_server');
const PATCH = path.join(ROOT, 'ops/coop-scaled-matchmaking-server.patch');
const INSTALLER = path.join(ROOT, 'ops/apply_coop_scaled_matchmaking.py');
const PREVIOUS_PATCH_REVISION = '67bd75e';
const SIBLING_FILES = ['server/loadGameCode.js', 'server/matchmakingSlots.js',
  'tests/coop/browser-online.test.js', 'tests/coop/matchmaking.test.js'];
const MATRIX = {humans: [2, 5, 12], sizes: ['tiny', 'normal', 'big'], seeds: [0, 1]};
const FAULTS = {'previous-patch': 'server-generation-parity', 'accept-unknown-version': 'unknown-version-rejected'};
const UNKNOWN_VERSIONS = [99, 5, 0, -1, '4', null, 'missing'];
const DOWNGRADED_VERSIONS = [1, 2, 3];
const WAVE = {seed: 42, round: 3};
const FIXED_NOW = 1700000000000;
const MANAGER = `{clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}}`;
const SOURCES = ['ai/test-coop-valley-server.js', 'ops/coop-scaled-matchmaking-server.patch', 'ops/apply_coop_scaled_matchmaking.py',
  'ops/coop-scaled-matchmaking.md', 'ai/generateMap.js', 'ai/coop-valley-plan.js', 'ai/coop-map-scaling.js',
  'ai/test-coop-harness.js', 'ai/browserScriptCache.js', 'ai/fixtures/coop-legacy-stored-maps.json',
  'gameObjectSerialization.js', 'options/gamestart.js', 'options/save.js', 'nextTurn.js', 'ai/wave-placement.js',
  'ai/wave-composition.js', 'index.html'];
const SERVER_SOURCES = ['server/index.js', 'server/coopAuthority.js', 'server/gameRound.js', 'server/matchmakingKey.js',
  'server/getPlayersParallelOrder.js', 'server/legacyRound.js', 'server/lobbyStatus.js', ...SIBLING_FILES];

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const outDir = path.resolve(option('--output-dir') || 'artifacts/TASK-142');
const fault = option('--fault');
if (fault !== null && !FAULTS[fault]) throw new Error('unknown fault ' + fault);
const list = (name, fallback, parse) => (option(name) || fallback.join(',')).split(',').map(parse);
const humansList = list('--humans', MATRIX.humans, Number);
const sizesList = list('--sizes', MATRIX.sizes, String);
const seedsList = list('--seeds', MATRIX.seeds, Number);
const fullMatrix = humansList.join() === MATRIX.humans.join() && sizesList.join() === MATRIX.sizes.join() &&
  seedsList.join() === MATRIX.seeds.join();
if (!fault && !argv.includes('--subset') && !fullMatrix) throw new Error('positive mode requires humans 2,5,12, all sizes and seeds 0,1');

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(outDir, rel)), {recursive: true}); fs.writeFileSync(path.join(outDir, rel), text); };
const matrixArgs = () => ['--humans', humansList.join(), '--sizes', sizesList.join(), '--seeds', seedsList.join()];

// ---------------------------------------------------------------- adapter mode
function materialize(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-valley-server-'));
  try {
    for (const file of SIBLING_FILES) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
      fs.writeFileSync(path.join(dir, file), execFileSync('git', ['-C', SERVER, 'show', 'HEAD:' + file]));
    }
    const patch = kind === 'previous-patch'
      ? execFileSync('git', ['-C', ROOT, 'show', PREVIOUS_PATCH_REVISION + ':ops/coop-scaled-matchmaking-server.patch'])
      : fs.readFileSync(PATCH);
    execFileSync('git', ['-C', dir, 'apply', '-'], {input: patch});
    const files = Object.fromEntries(SIBLING_FILES.map(f => [f, fs.readFileSync(path.join(dir, f))]));
    if (kind === 'accept-unknown-version') {
      // Corruption: only downgrades are rejected; unknown versions slip through.
      const slots = files['server/matchmakingSlots.js'].toString();
      const strict = "assert.strictEqual(generation.version, 4, 'Unsupported co-op generation version')";
      assert.equal(slots.split(strict).length, 2, 'fault anchor');
      files['server/matchmakingSlots.js'] = Buffer.from(slots.replace(strict,
        "assert(![1, 2, 3].includes(generation.version), 'Unsupported co-op generation version')"));
    }
    return {files, patchSha256: sha(patch)};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

// The installer must upgrade a checkout carrying the previous revision and then
// recognize the current revision. Exercised on a disposable copy, never the sibling.
function checkInstaller(expected) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-valley-installer-'));
  try {
    for (const file of SIBLING_FILES) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
      fs.writeFileSync(path.join(dir, file), execFileSync('git', ['-C', SERVER, 'show', 'HEAD:' + file]));
    }
    execFileSync('git', ['-C', dir, 'apply', '-'], {input: execFileSync('git', ['-C', ROOT, 'show', PREVIOUS_PATCH_REVISION + ':ops/coop-scaled-matchmaking-server.patch'])});
    const runs = [1, 2].map(() => spawnSync('python3', [INSTALLER, dir], {encoding: 'utf8'}));
    const equal = SIBLING_FILES.every(f => fs.readFileSync(path.join(dir, f)).equals(expected[f]));
    const record = {runs: runs.map(r => ({status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim()})), upgradedEqualsCurrentPatch: equal};
    console.log('INSTALLER ' + JSON.stringify(record));
    assert.deepEqual([runs[0].status, runs[1].status, equal, /already applied/.test(runs[1].stdout), /reversed/.test(runs[0].stdout)],
      [0, 0, true, true, true], 'installer-upgrade');
    return record;
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

function adapter() {
  fs.mkdirSync(outDir, {recursive: true});
  const t0 = Date.now();
  console.log(`ADAPTER cwd=${process.cwd()} node=${process.version} server=${SERVER} fault=${fault || 'none'} output=${outDir}`);
  const originals = SIBLING_FILES.map(f => fs.readFileSync(path.join(SERVER, f)));
  const {files, patchSha256} = materialize(fault);
  const identities = SIBLING_FILES.map((file, i) => ({file, before: sha(originals[i]), applied: sha(files[file]), after: null}));
  const report = {fault, node: process.version, patch: fault === 'previous-patch' ? `${PREVIOUS_PATCH_REVISION}:ops/coop-scaled-matchmaking-server.patch` : 'ops/coop-scaled-matchmaking-server.patch',
    patchSha256, siblingHead: execFileSync('git', ['-C', SERVER, 'rev-parse', 'HEAD']).toString().trim(), identities, steps: {}};
  let restored = false;
  const restore = () => {
    if (restored) return; restored = true;
    SIBLING_FILES.forEach((file, i) => {
      fs.writeFileSync(path.join(SERVER, file), originals[i]);
      identities[i].after = sha(fs.readFileSync(path.join(SERVER, file)));
      console.log(`RESTORED ${file} before=${identities[i].before} after=${identities[i].after} equal=${identities[i].after === identities[i].before}`);
    });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { restore(); process.exit(130); });
  let status = 1;
  try {
    SIBLING_FILES.forEach((file, i) => {
      fs.writeFileSync(path.join(SERVER, file), files[file]);
      console.log(`APPLIED ${file} before=${identities[i].before} applied=${identities[i].applied}`);
    });
    if (!fault && !argv.includes('--subset')) {
      report.steps.installer = checkInstaller(files);
      const command = [process.execPath, '--test', 'tests/coop/matchmaking.test.js'];
      console.log(`BEGIN server-suite cwd=${SERVER} command=${command.join(' ')}`);
      const suite = spawnSync(command[0], command.slice(1), {cwd: SERVER, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
        env: {...process.env, COOP_TEST_OUTPUT_DIR: path.join(outDir, 'server-suite')}});
      write('server-suite/stdout.log', suite.stdout); write('server-suite/stderr.log', suite.stderr);
      process.stdout.write(suite.stdout.split('\n').filter(l => /^(# (tests|suites|pass|fail|cancelled|duration_ms)|ok |not ok |PASS )/.test(l)).join('\n') + '\n');
      process.stdout.write(suite.stderr);
      console.log(`END server-suite actual_exit_status=${suite.status}`);
      report.steps.serverSuite = {command: command.join(' '), cwd: SERVER, status: suite.status,
        summary: suite.stdout.split('\n').filter(l => /^# (tests|pass|fail)/.test(l))};
      assert.equal(suite.status, 0, 'server-matchmaking-suite');
    }
    const childArgs = [__filename, '--server-child', '--output-dir', outDir, ...matrixArgs(), ...(fault ? ['--fault', fault] : []),
      ...(argv.includes('--subset') ? ['--subset'] : [])];
    console.log(`BEGIN server-child cwd=${ROOT} command=${[process.execPath, ...childArgs].join(' ')}`);
    const child = spawnSync(process.execPath, childArgs, {cwd: ROOT, stdio: 'inherit'});
    console.log(`END server-child actual_exit_status=${child.status}`);
    report.steps.serverChild = {status: child.status};
    status = child.status ?? 1;
  } finally {
    restore();
    write('adapter-identities.json', JSON.stringify(report, null, 1) + '\n');
  }
  assert.ok(identities.every(r => r.after === r.before), 'sibling-restored');
  if (status !== 0) { process.exitCode = status; return; }
  if (fault || argv.includes('--subset')) return;

  // Negative controls: each is a complete nested adapter run on the tiny H2 seed-0 case.
  report.negativeControls = [];
  for (const [name, assertion] of Object.entries(FAULTS)) {
    const args = [__filename, '--fault', name, '--humans', '2', '--sizes', 'tiny', '--seeds', '0',
      '--output-dir', path.join(outDir, 'negative-control', name)];
    console.log(`BEGIN negative-control ${name} cwd=${process.cwd()} command=${[process.execPath, ...args].join(' ')}`);
    const run = spawnSync(process.execPath, args, {encoding: 'utf8', maxBuffer: 512 * 1024 * 1024});
    write(`negative-control/${name}/stdout.log`, run.stdout); write(`negative-control/${name}/stderr.log`, run.stderr);
    const named = new RegExp(`AssertionError \\[ERR_ASSERTION\\]: ${assertion}\\b`).test(run.stderr);
    const faultIdentities = JSON.parse(fs.readFileSync(path.join(outDir, 'negative-control', name, 'adapter-identities.json')));
    const record = {name, assertion, status: run.status, namedAssertion: named,
      assertionLine: (run.stderr.match(new RegExp(`AssertionError \\[ERR_ASSERTION\\]: ${assertion}\\b.*`)) || [null])[0],
      restored: faultIdentities.identities.every(r => r.after === r.before),
      restoredLines: run.stdout.split('\n').filter(l => l.startsWith('RESTORED '))};
    console.log(run.stdout.split('\n').filter(l => /^(APPLIED|RESTORED|END|FAIL|ADAPTER)/.test(l)).join('\n'));
    console.log(`END negative-control ${name} actual_exit_status=${run.status} named_assertion=${named} ${record.assertionLine}`);
    report.negativeControls.push(record);
    assert.deepEqual([run.status, named, record.restored], [1, true, true], 'negative-control-' + name);
  }
  report.elapsedMs = Date.now() - t0;
  const checkpoints = JSON.parse(fs.readFileSync(path.join(outDir, 'checkpoints.json')));
  checkpoints.adapter = report;
  write('checkpoints.json', JSON.stringify(checkpoints, null, 1) + '\n');
  write('adapter-identities.json', JSON.stringify(report, null, 1) + '\n');
  const identitiesFile = {node: process.version, algorithm: 'sha256',
    game: {head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim(),
      files: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]))},
    server: {head: report.siblingHead, dir: SERVER,
      unpatchedFiles: Object.fromEntries(SERVER_SOURCES.filter(f => !SIBLING_FILES.includes(f)).map(f => [f, sha(fs.readFileSync(path.join(SERVER, f)))])),
      patchedFilesAsTested: Object.fromEntries(identities.map(r => [r.file, r.applied])),
      originalFilesRestored: Object.fromEntries(identities.map(r => [r.file, r.after]))}};
  write('source-identities.json', JSON.stringify(identitiesFile, null, 1) + '\n');
  const s = checkpoints.summary;
  console.log(`PASS valley-server parity=${s.parityEqual}/${s.parityCases} creation=${s.created} reconnect=${s.reconnectExact} restart=${s.restartExact} ` +
    `unknown_rejected=${s.unknownRejected} downgrade_rejected=${s.downgradeRejected} legacy=${s.legacy} phase_resumes=${s.phaseResumes} ` +
    `checks=${s.checks} server_suite=0 installer=upgrade negative_controls=${report.negativeControls.map(n => n.name + ':' + n.status).join(',')} sibling_restored=true`);
}

// ------------------------------------------------------------------ child mode
async function serverChild() {
  const t0 = Date.now();
  Date.now = () => FIXED_NOW;
  const realLog = console.log;
  console.log = (...a) => { if (!(typeof a[0] === 'string' && /^(loaded|@@|A user connected|User disconnected)/.test(a[0]))) realLog(...a); };
  const realError = console.error, serverErrors = [];
  console.error = (...a) => { serverErrors.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' ')); realError(...a); };
  const runtime = require(path.join(SERVER, 'server/loadGameCode.js'));
  const {createFixture} = require('./test-coop-harness');
  const {getCoopMapScaling} = require('./coop-map-scaling');
  const LEGACY = require('./fixtures/coop-legacy-stored-maps.json');
  const {io: connect} = createRequire(path.join(SERVER, 'tests/coop/matchmaking.test.js'))('socket.io-client');
  const evaluate = code => vm.runInThisContext(code);
  evaluate(`isFogOfWar=false; townInterface={change(){},hide(){}}; barrackInterface={change(){},hide(){}};
    gameEvent={selected:new Empty(),hideAll(){},removeSelection(){this.selected=new Empty()},screen:{moveTo(){},moveToPlayer(){},stop(){}}}; undefined`);
  // Observe production wave/demon entry points; the demon AI move itself is outside
  // persistence and is replaced by a counter so resumed boards are deterministic.
  evaluate(`globalThis.valleyCalls={spawn:[],play:[]};
    globalThis.valleyOriginalSpawn=spawnCoopWave;
    spawnCoopWave=function(round){valleyCalls.spawn.push(round);return valleyOriginalSpawn.apply(this,arguments)};
    DemonPlayer.prototype.play=function(){valleyCalls.play.push(gameRound)}; undefined`);
  const client = createFixture(undefined, () => {});
  client.evaluate(`Date.now=()=>${FIXED_NOW}; undefined`);

  const checkpoints = {test: 'ai/test-coop-valley-server.js', mode: 'server-child', fault, node: process.version, cwd: process.cwd(),
    serverDir: SERVER, fixedNow: FIXED_NOW, wave: WAVE, matrix: {humans: humansList, sizes: sizesList, seeds: seedsList},
    loader: {scriptOrderIncludesValleyPlan: runtime.scriptOrder.includes('ai/coop-valley-plan.js'),
      valleyPlanBeforeGenerateMap: runtime.scriptOrder.indexOf('ai/coop-valley-plan.js') >= 0 &&
        runtime.scriptOrder.indexOf('ai/coop-valley-plan.js') < runtime.scriptOrder.indexOf('ai/generateMap.js')},
    parity: [], cases: [], legacy: [], checks: 0};
  const peers = [];
  const checks = [];
  const compact = value => { const text = JSON.stringify(value); return text === undefined || text.length <= 400 ? value : {sha256: sha(text), bytes: text.length}; };
  function check(name, observed, expected) {
    const pass = isDeepStrictEqual(observed, expected);
    checks.push(name);
    realLog(JSON.stringify({check: name, pass, expected: compact(expected), observed: compact(observed)}));
    if (!pass) assert.fail(`${name.split(':')[0]}: ${name} expected ${JSON.stringify(compact(expected))} observed ${JSON.stringify(compact(observed))}`);
  }
  realLog(`LOADER ${JSON.stringify(checkpoints.loader)}`);

  // ---- persistence: in-memory rows behind the production MongoDB call surface.
  async function launch(rows, onGameUpdate = () => {}) {
    let nextId = 1;
    const matchValue = (row, key, value) => value && typeof value === 'object' && '$exists' in value
      ? (key in row) === value.$exists : value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : row[key] === value;
    const matches = (row, q) => Object.entries(q).every(([key, value]) => key === '$or' ? value.some(p => matches(row, p)) : matchValue(row, key, value));
    const db = {async createCollection() {}, collection(name) {
      const table = rows[name] || (rows[name] = []);
      return {
        async findOne(q) { const row = table.find(r => matches(r, q)); return row ? copy(row) : null; },
        find(q = {}) { return {sort() { return {async *[Symbol.asyncIterator]() { for (const row of table.filter(r => matches(r, q)).reverse()) yield copy(row); }}; }}; },
        async insertOne(row) { table.push({_id: 'row-' + nextId++, ...copy(row)}); },
        async deleteOne(q) { const i = table.findIndex(r => matches(r, q)); if (i >= 0) table.splice(i, 1); },
        async deleteMany(q) { for (let i = table.length - 1; i >= 0; i--) if (matches(table[i], q)) table.splice(i, 1); },
        async updateOne(q, u) {
          const row = table.find(r => matches(r, q)); assert(row, 'update target');
          for (const [key, value] of Object.entries(u.$set)) {
            const parts = key.split('.'); let target = row;
            for (const part of parts.slice(0, -1)) target = target[part];
            target[parts.at(-1)] = copy(value);
          }
          if (name === 'games') onGameUpdate(copy(row), u.$set);
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
      return realRequire(name);
    };
    const api = new Function('require', '__dirname', 'module', 'process', fs.readFileSync(filename, 'utf8') +
      '\nreturn {enqueueGameOperation,createNewGame,handleNextTurn,getCurrentParalleTurnInfo,getTurnGameObjectForEmit,loadGameWithCurrentRound};')(
      customRequire, path.dirname(filename), {exports: {}}, {...process, env: {...process.env, LOCAL_DEV: '1'}});
    await once(server, 'listening');
    const sockets = [];
    return {rows, api, port: server.address().port, sockets,
      async request(password, game) {
        const socket = connect('http://127.0.0.1:' + server.address().port, {transports: ['websocket'], reconnection: false});
        sockets.push(socket);
        await once(socket, 'connect');
        const reply = new Promise((resolve, reject) => {
          const names = ['gameStarted', 'playYourTurn', 'waitYouTurn', 'error'];
          const timer = setTimeout(() => { finish(); reject(new Error(`timeout startGameOrConnect request_bytes=${JSON.stringify({password, game}).length} connected=${socket.connected}`)); }, 180000);
          const handlers = names.map(event => [event, body => { finish(); resolve({event, board: event === 'error' ? null : JSON.parse(body), error: event === 'error' ? body : null}); }]);
          const finish = () => { clearTimeout(timer); handlers.forEach(([event, fn]) => socket.off(event, fn)); };
          handlers.forEach(([event, fn]) => socket.once(event, fn));
        });
        socket.emit('startGameOrConnect', JSON.stringify({password, game}));
        return {socket, ...(await reply)};
      },
      async close() { sockets.forEach(s => s.disconnect()); await new Promise(resolve => transport.close(resolve)); }};
  }
  const digest = password => crypto.createHash('sha256').update(password).digest('hex');
  // First differing JSON paths, recorded with an exactness check.
  function diffPaths(a, b, at = '$', found = []) {
    if (found.length >= 12 || isDeepStrictEqual(a, b)) return found;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[key], b[key], `${at}.${key}`, found);
    } else found.push({path: at, observed: compact(a), expected: compact(b)});
    return found;
  }
  const withoutCommit = board => { const {coopCommit, ...rest} = board; return rest; };
  const markers = board => ({round: board.gameRound, waveGeneration: board.gameSettings.coop.waveGeneration || null,
    localPhase: board.gameSettings.coop.localPhase || null, generation: board.gameSettings.coop.generation,
    demonUnits: board.players[board.gameSettings.coop.demonSlot].units.length});
  const clientRoundTrip = board => { client.context.valleyBoard = JSON.stringify(board);
    return JSON.parse(client.evaluate('(() => { loadFromJson(valleyBoard); players[0].isGameEnded; return JSON.stringify(getGameObject()) })()')); };
  const clientGrid = board => { client.context.valleyBoard = JSON.stringify(withoutCommit(board));
    return client.evaluate('(() => { loadFromJson(valleyBoard); return JSON.parse(JSON.stringify(getGameObject().grid)) })()'); };

  // ---- generation parity: identical client and server call sequences.
  const BUILD = source => `(() => { const map = ${source}; const mapJson = JSON.stringify(map);
    isFogOfWar = false; gameSettings.isOnline = true; map.start(${MANAGER}, false, false)
    whooseTurn = 0; gameRound = 0; actionManager.clear()
    return {mapJson, boardJson: JSON.stringify(getGameObject())} })()`;
  function build(label, source, input) {
    client.context.valleyInput = input; global.valleyInput = input;
    let t = process.hrtime.bigint();
    const local = client.evaluate(BUILD(source));
    const localMs = Number(process.hrtime.bigint() - t) / 1e6; t = process.hrtime.bigint();
    let server;
    try { server = evaluate(BUILD(source)); }
    catch (error) { assert.fail(`server-generation-parity: ${label} server generation threw ${error.name}: ${error.message}`); }
    const serverMs = Number(process.hrtime.bigint() - t) / 1e6;
    const record = {id: label, localMs: Math.round(localMs), serverMs: Math.round(serverMs),
      local: {mapSha256: sha(local.mapJson), boardSha256: sha(local.boardJson), mapBytes: local.mapJson.length, boardBytes: local.boardJson.length},
      server: {mapSha256: sha(server.mapJson), boardSha256: sha(server.boardJson), mapBytes: server.mapJson.length, boardBytes: server.boardJson.length}};
    record.mapEqual = local.mapJson === server.mapJson; record.boardEqual = local.boardJson === server.boardJson;
    check(`server-generation-parity:${label}:generated-map`, record.server.mapSha256, record.local.mapSha256);
    check(`server-generation-parity:${label}:started-board`, record.server.boardSha256, record.local.boardSha256);
    return {record, map: JSON.parse(local.mapJson), board: JSON.parse(local.boardJson), boardJson: local.boardJson};
  }

  // ---- one stored game through creation, reconnect, restart and rejection.
  async function joinAll(h, board, passwords) {
    const replies = [];
    for (const password of passwords) replies.push(await h.request(password, board));
    return replies;
  }
  function checkPeers(id, label, replies, board, request, expectedSlots) {
    const game = request.rows.games[0];
    const record = {id: `${id}-${label}`, gameID: game.gameID, peers: []};
    replies.forEach((reply, i) => {
      const slot = expectedSlots[i];
      const b = reply.board;
      const peer = {slot, event: reply.event, boardSha256: sha(b), gridSha256: sha(b.grid), whooseTurn: b.whooseTurn,
        commit: b.coopCommit, generation: b.gameSettings.coop.generation, dimensions: [b.grid.length, ...new Set(b.grid.map(c => c.length))]};
      record.peers.push(peer);
      check(`peer-snapshot:${id}-${label}-slot${slot}`, {event: reply.event === 'gameStarted' || reply.event === 'playYourTurn' || reply.event === 'waitYouTurn',
        whooseTurn: b.whooseTurn, gameID: b.coopCommit.gameID, grid: sha(b.grid), generation: b.gameSettings.coop.generation, round: b.gameRound},
      {event: true, whooseTurn: slot, gameID: game.gameID, grid: sha(board.grid), generation: board.gameSettings.coop.generation, round: board.gameRound});
    });
    check(`peer-snapshot:${id}-${label}-creator-event`, replies[0].event, 'gameStarted');
    return record;
  }

  async function storedGameCase(id, board, humans, storedAsLegacy) {
    const passwords = Array.from({length: humans}, (_, i) => `valley-${id}-human-${i + 1}`);
    const slots = passwords.map((_, i) => i + 1);
    const out = {id, humans};
    // Creation: new requests go through startGameOrConnect; stored legacy games are
    // written by production createNewGame as a pre-upgrade server persisted them.
    const h = await launch({games: [], users: []});
    let replies;
    if (storedAsLegacy) {
      const game = h.api.createNewGame(copy(board), 'legacy-' + id);
      game.playerIndexToUserIndex = [null, ...passwords.map(digest), null];
      h.rows.games.push({_id: 'legacy', ...game}); passwords.forEach(p => h.rows.users.push({userId: digest(p), gameID: game.gameID}));
      replies = await joinAll(h, board, passwords);
    } else replies = await joinAll(h, board, passwords);
    const game = h.rows.games[0];
    check(`creation:${id}-rows`, {games: h.rows.games.length, users: h.rows.users.length, slots: game.playerIndexToUserIndex},
      {games: 1, users: humans, slots: [null, ...passwords.map(digest), null]});
    // The stored board is the request after one load, game-end check (which writes
    // coop.result) and serialization; the local client's same round trip must match.
    const initial = game.rounds[0][0].parallelTurnResult, roundTrip = clientRoundTrip(board);
    check(`creation:${id}-stored-initial-board-exact`, {sha256: sha(initial), diff: diffPaths(initial, roundTrip)}, {sha256: sha(roundTrip), diff: []});
    out.requestNormalization = diffPaths(initial, board);
    const peerRecord = storedAsLegacy ? {id: `${id}-reconnect-stored`, gameID: game.gameID, peers: replies.map((r, i) => ({slot: slots[i], event: r.event,
      boardSha256: sha(r.board), gridSha256: sha(r.board.grid), generation: r.board.gameSettings.coop.generation}))} : checkPeers(id, 'creation', replies, board, h, slots);
    if (storedAsLegacy) replies.forEach((r, i) => check(`legacy-saved-grid:${id}-slot${slots[i]}`,
      {grid: sha(r.board.grid), generation: r.board.gameSettings.coop.generation, whooseTurn: r.board.whooseTurn},
      {grid: sha(board.grid), generation: board.gameSettings.coop.generation, whooseTurn: slots[i]}));
    check(`local-client-load:${id}-grid`, sha(clientGrid(replies[0].board)), sha(replies[0].board.grid));
    peers.push(peerRecord);
    // Same-server reconnect with a stale client board: the stored commit wins.
    const storedBefore = sha(h.rows.games);
    replies[0].socket.disconnect();
    const stale = copy(board); stale.gameRound = 7; stale.grid[0][0] = stale.grid[0][0] === 1 ? 2 : 1;
    const again = await h.request(passwords[0], stale);
    check(`reconnect:${id}-same-server-exact`, {event: again.event, board: sha(again.board)}, {event: replies[0].event === 'gameStarted' ? 'playYourTurn' : replies[0].event, board: sha(replies[0].board)});
    check(`reconnect:${id}-stored-unchanged`, sha(h.rows.games), storedBefore);
    const saved = copy(h.rows);
    await h.close();
    // Restarted server over the persisted rows: every peer reconnects to the same board.
    const r = await launch(copy(saved));
    const restarted = await joinAll(r, stale, passwords);
    restarted.forEach((reply, i) => check(`restart:${id}-slot${slots[i]}-exact`, sha(reply.board),
      sha(i === 0 ? again.board : replies[i].board)));
    check(`restart:${id}-rows-unchanged`, sha(r.rows), sha(saved));
    peers.push({id: `${id}-restart`, peers: restarted.map((reply, i) => ({slot: slots[i], event: reply.event, boardSha256: sha(reply.board), gridSha256: sha(reply.board.grid)}))});
    out.creation = {gameID: game.gameID, boardSha256: sha(board), gridSha256: sha(board.grid), events: replies.map(x => x.event)};
    out.reconnect = {sameServer: again.event, restart: restarted.map(x => x.event)};
    // Generation-version gate on new requests, before persistence.
    out.rejections = [];
    if (!storedAsLegacy) {
      for (const [kind, versions] of [['unknown-version-rejected', UNKNOWN_VERSIONS], ['downgrade-version-rejected', DOWNGRADED_VERSIONS]]) {
        for (const version of versions) {
          const forged = copy(board);
          if (version === 'missing') delete forged.gameSettings.coop.generation.version; else forged.gameSettings.coop.generation.version = version;
          const before = sha(r.rows), errorsBefore = serverErrors.length;
          const reply = await r.request(`valley-${id}-forged-${String(version)}`, forged);
          const reason = serverErrors.slice(errorsBefore).join(' | ');
          const observed = {event: reply.event, error: reply.error, versionGate: /Unsupported co-op generation version/.test(reason), rowsUnchanged: sha(r.rows) === before};
          out.rejections.push({kind, version, ...observed, serverReason: reason});
          check(`${kind}:${id}-version-${JSON.stringify(version)}`, observed, {event: 'error', error: 'catched error', versionGate: true, rowsUnchanged: true});
        }
      }
    }
    await r.close();
    return out;
  }

  // ---- round-3 wave boundary: human, wave, demon and complete persisted phases.
  async function phaseCase(id, board, humans, storedAsLegacy) {
    const passwords = Array.from({length: humans}, (_, i) => `valley-${id}-phase-human-${i + 1}`);
    const phaseBoard = copy(board);
    phaseBoard.gameRound = WAVE.round - 1;
    phaseBoard.gameSettings.coop.waveGeneration = {version: 1, seed: WAVE.seed, lastRound: WAVE.round - 1};
    const captured = {};
    const h = await launch({games: [], users: []}, (row, set) => {
      if (set.coopCheckpoint && set.coopCheckpoint.stage) captured[set.coopCheckpoint.stage] = {games: [row], users: null};
    });
    if (storedAsLegacy) {
      const game = h.api.createNewGame(copy(phaseBoard), 'legacy-phase-' + id);
      game.playerIndexToUserIndex = [null, ...passwords.map(digest), null];
      h.rows.games.push({_id: 'legacy-phase', ...game}); passwords.forEach(p => h.rows.users.push({userId: digest(p), gameID: game.gameID}));
    }
    await joinAll(h, phaseBoard, passwords);
    const gameID = h.rows.games[0].gameID;
    evaluate('valleyCalls={spawn:[],play:[]}');
    const submissions = [];
    for (let guard = 0; h.rows.games[0].rounds.length === 1; guard++) {
      assert.ok(guard <= humans, 'phase submission guard');
      const info = h.api.getCurrentParalleTurnInfo(copy(h.rows.games[0]));
      for (const player of info.whoNewToPlay) {
        await h.api.enqueueGameOperation(gameID, async () => {
          const emitted = await h.api.getTurnGameObjectForEmit(gameID, player, info.gameObject);
          const submitted = withoutCommit(emitted); submitted.whooseTurn = player;
          const result = await h.api.handleNextTurn(digest(passwords[player - 1]), submitted);
          submissions.push({player, ignored: !!result.ignored});
        });
      }
    }
    const liveCalls = evaluate('JSON.parse(JSON.stringify(valleyCalls))');
    const live = await h.api.enqueueGameOperation(gameID, async () => {
      const game = await h.api.loadGameWithCurrentRound(gameID);
      const info = h.api.getCurrentParalleTurnInfo(game);
      return h.api.getTurnGameObjectForEmit(gameID, 1, info.gameObject, !info.whoNewToPlay.includes(1));
    });
    const liveRows = copy(h.rows);
    captured.human = {games: copy(liveRows.games), users: null};
    for (const stage of Object.keys(captured)) captured[stage].users = copy(liveRows.users);
    await h.close();
    const spawned = live.players[live.gameSettings.coop.demonSlot].units.length;
    check(`phase-live:${id}-round-completed`, {submissions: submissions.filter(s => !s.ignored).length, rounds: liveRows.games[0].rounds.length,
      checkpoint: liveRows.games[0].coopCheckpoint ?? null, spawnCalls: liveCalls.spawn, playCalls: liveCalls.play.length, spawnedPositive: spawned > 0},
    {submissions: humans, rounds: 2, checkpoint: null, spawnCalls: [WAVE.round], playCalls: 1, spawnedPositive: true});
    check(`phase-live:${id}-markers`, markers(live), {round: WAVE.round, waveGeneration: {version: 1, seed: WAVE.seed, lastRound: WAVE.round},
      localPhase: null, generation: board.gameSettings.coop.generation, demonUnits: spawned});
    const out = {id, humans, spawned, liveBoardSha256: sha(live), liveGridSha256: sha(live.grid), liveCalls, phases: {}};
    const expectedCalls = {wave: {spawn: [WAVE.round], play: 1}, demon: {spawn: [], play: 1}, complete: {spawn: [], play: 0}, human: {spawn: [], play: 0}};
    for (const stage of ['wave', 'demon', 'complete', 'human']) {
      check(`phase-checkpoint:${id}-${stage}-captured`, !!captured[stage], true);
      const savedGame = captured[stage].games[0];
      const snapshot = stage === 'human' ? savedGame.rounds.at(-1)[0].parallelTurnResult : savedGame.coopCheckpoint.snapshot;
      const saved = {stage: savedGame.coopCheckpoint ? savedGame.coopCheckpoint.stage : 'human',
        checkpointRound: savedGame.coopCheckpoint ? savedGame.coopCheckpoint.round : null, rounds: savedGame.rounds.length,
        lastWaveRound: snapshot.gameSettings.coop.waveGeneration.lastRound,
        demonUnits: snapshot.players[snapshot.gameSettings.coop.demonSlot].units.length, gridSha256: sha(snapshot.grid)};
      check(`phase-checkpoint:${id}-${stage}-markers`, {...saved, gridSha256: undefined},
        {stage, checkpointRound: stage === 'human' ? null : WAVE.round - 1, rounds: stage === 'human' ? 2 : 1,
          lastWaveRound: stage === 'wave' ? WAVE.round - 1 : WAVE.round, demonUnits: stage === 'wave' ? 0 : spawned, gridSha256: undefined});
      evaluate('valleyCalls={spawn:[],play:[]}');
      const r = await launch(copy(captured[stage]));
      const reply = await r.request(passwords[0], phaseBoard);
      const calls = evaluate('JSON.parse(JSON.stringify(valleyCalls))');
      const resumedGame = r.rows.games[0];
      const record = {saved, event: reply.event, boardSha256: sha(reply.board), gridSha256: sha(reply.board.grid),
        markers: markers(reply.board), calls: {spawn: calls.spawn, play: calls.play.length}, checkpointAfter: resumedGame.coopCheckpoint ?? null,
        storedRoundsSha256: sha(resumedGame.rounds)};
      check(`phase-resume:${id}-${stage}-grid`, sha(reply.board.grid), sha(live.grid));
      check(`phase-resume:${id}-${stage}-board`, sha(reply.board), sha(live));
      check(`phase-resume:${id}-${stage}-markers`, record.markers, markers(live));
      check(`phase-resume:${id}-${stage}-calls-and-checkpoint`, {calls: record.calls, checkpointAfter: record.checkpointAfter, rounds: resumedGame.rounds.length},
        {calls: expectedCalls[stage], checkpointAfter: null, rounds: 2});
      check(`phase-resume:${id}-${stage}-stored-rounds`, sha(resumedGame.rounds), sha(liveRows.games[0].rounds));
      check(`phase-resume:${id}-${stage}-local-client-grid`, sha(clientGrid(reply.board)), sha(reply.board.grid));
      out.phases[stage] = record;
      await r.close();
    }
    return out;
  }

  // ---- matrix
  const combos = [];
  for (const size of sizesList) for (const humans of humansList) for (const seed of seedsList) combos.push({humans, size, seed, id: `H${humans}-${size}-s${seed}`});
  const built = new Map();
  for (const c of combos) {
    const b = build(c.id, `generateCoopGame(${c.humans}, {seed:${c.seed}, size:'${c.size}'})`, null);
    const scaling = getCoopMapScaling(c.humans, c.size);
    check(`current-generation:${c.id}-metadata`, [b.board.gameSettings.coop.generation, [b.board.grid.length, b.board.grid[0].length], b.map.portals.length],
      [{version: 4, playerCount: c.humans, seed: c.seed, size: c.size, options: {seed: c.seed, size: c.size}}, [scaling.mapSize.x, scaling.mapSize.y], scaling.counts.portals]);
    b.record.generation = b.board.gameSettings.coop.generation; b.record.side = scaling.mapSize;
    checkpoints.parity.push(b.record);
    realLog(`PASS parity ${c.id} local=${b.record.local.boardSha256.slice(0, 12)} server=${b.record.server.boardSha256.slice(0, 12)} board_bytes=${b.record.local.boardBytes} ms=${b.record.localMs}/${b.record.serverMs}`);
    write(`boards/${c.id}.json`, b.boardJson + '\n');
    built.set(c.id, b);
  }
  for (const c of combos) {
    const {board} = built.get(c.id);
    const t = process.hrtime.bigint();
    const record = await storedGameCase(c.id, board, c.humans, false);
    record.size = c.size; record.seed = c.seed;
    if (fault) { checkpoints.cases.push(record); continue; }
    record.phase = await phaseCase(c.id, board, c.humans, false);
    record.elapsedMs = Math.round(Number(process.hrtime.bigint() - t) / 1e6);
    checkpoints.cases.push(record);
    realLog(`PASS server-case ${c.id} ms=${record.elapsedMs}`);
  }
  if (!fault) for (const legacy of LEGACY) {
    const map = legacy.map, g = map.coop.generation, id = `legacy-v${legacy.version}-H${map.coop.initialHumanCount}-${g.size}-s${g.seed}`;
    const b = build(id, 'Object.assign(Object.create(GameMap.prototype), JSON.parse(valleyInput))', JSON.stringify(map));
    const current = evaluate(BUILD(`generateCoopGame(${g.playerCount}, {seed:${g.seed}, size:'${g.size}'})`));
    const currentBoard = JSON.parse(current.boardJson);
    check(`legacy-saved-grid:${id}-distinguishable-from-current`, {version: b.board.gameSettings.coop.generation.version, equalGrid: sha(currentBoard.grid) === sha(b.board.grid)},
      {version: legacy.version, equalGrid: false});
    // A new request carrying legacy metadata is a downgrade and must not persist.
    const gate = await launch({games: [], users: []});
    const errorsBefore = serverErrors.length;
    const refused = await gate.request(`valley-${id}-new-request`, b.board);
    const reason = serverErrors.slice(errorsBefore).join(' | ');
    check(`downgrade-version-rejected:${id}-new-request`, {event: refused.event, versionGate: /Unsupported co-op generation version/.test(reason), rows: [gate.rows.games.length, gate.rows.users.length]},
      {event: 'error', versionGate: true, rows: [0, 0]});
    await gate.close();
    const record = await storedGameCase(id, b.board, map.coop.initialHumanCount, true);
    record.source = legacy.source; record.parity = b.record; record.currentGeneratorGridSha256 = sha(currentBoard.grid);
    record.phase = await phaseCase(id, b.board, map.coop.initialHumanCount, true);
    checkpoints.legacy.push(record);
    realLog(`PASS legacy-case ${id}`);
  }
  const phaseRecords = [...checkpoints.cases, ...checkpoints.legacy].filter(r => r.phase);
  checkpoints.summary = {parityCases: checkpoints.parity.length, parityEqual: checkpoints.parity.filter(p => p.mapEqual && p.boardEqual).length,
    created: checkpoints.cases.length, reconnectExact: checkpoints.cases.length + checkpoints.legacy.length,
    restartExact: checkpoints.cases.length + checkpoints.legacy.length,
    unknownRejected: checkpoints.cases.flatMap(c => c.rejections).filter(r => r.kind === 'unknown-version-rejected' && r.rowsUnchanged).length,
    downgradeRejected: checkpoints.cases.flatMap(c => c.rejections).filter(r => r.kind === 'downgrade-version-rejected' && r.rowsUnchanged).length + checkpoints.legacy.length,
    legacy: checkpoints.legacy.map(l => l.id).join('|') || 0,
    phaseResumes: phaseRecords.reduce((n, r) => n + Object.keys(r.phase.phases).length, 0), checks: checks.length,
    elapsedMs: Math.round(process.uptime() * 1000)};
  checkpoints.checks = checks.length;
  const dir = fault ? 'fault-child' : '';
  write(path.join(dir, 'checkpoints.json'), JSON.stringify(checkpoints, null, 1) + '\n');
  write(path.join(dir, 'peer-snapshots.json'), JSON.stringify(peers, null, 1) + '\n');
  if (!fault && fullMatrix) {
    assert.deepEqual([checkpoints.summary.parityCases, checkpoints.summary.parityEqual, checkpoints.legacy.length, checkpoints.summary.phaseResumes],
      [18, 18, 2, 80], 'coverage');
  }
  realLog(`PASS server-child ${JSON.stringify(checkpoints.summary)}`);
}

if (argv.includes('--server-child')) serverChild().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
else adapter();
