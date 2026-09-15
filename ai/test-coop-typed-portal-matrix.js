'use strict';
// Independent 1152-case matrix for the typed portal layout (TASK-152): every
// size x humans 1..12 x seeds 0..31 is generated through generateCoopGame in
// two worker processes, each case once as the primary map and once as a repeat
// in the other process. The parent re-measures every map from raw placements
// with literal rules only (counts, categories, fronts, overlaps, empty-hex and
// path distances, reachability, disparity, approach cells and attempts) and
// runs synthetic negative controls that must be rejected by the named check.
// Usage: node20 ai/test-coop-typed-portal-matrix.js --output-dir DIR [--workers N]
//        node20 ai/test-coop-typed-portal-matrix.js --output-dir DIR --cases ID,...   (development; never passes)
//        node20 ai/test-coop-typed-portal-matrix.js --output-dir DIR --fault missing-category|duplicate-cell|blocked-approach [--cases ID]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const {spawn, spawnSync, execFileSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const ROOT = path.join(__dirname, '..');

// Independent literals; none are read from production code.
const SIZES = ['tiny', 'normal', 'big'], HUMANS = Array.from({length: 12}, (_, i) => i + 1);
const SEEDS = Array.from({length: 32}, (_, i) => i), EXPECTED_CASES = 1152;
const CATEGORIES = ['normal', 'ranged', 'heavy', 'highTier'], PORTALS_PER_HUMAN = 4;
const SIDES = {tiny: [11, 11, 13, 15, 17, 19, 20, 22, 23, 24, 25, 26], normal: [15, 18, 22, 25, 28, 31, 34, 36, 38, 40, 42, 44],
  big: [21, 28, 34, 39, 44, 48, 52, 56, 59, 62, 65, 68]};
const TOWN_DISTANCE = {tiny: 6, normal: 10, big: 14};
const DISPARITY = 4, MIN_APPROACH = 2, ATTEMPT_LIMIT = 8;
const MODELS = ['mineEndpoints', 'walkableMines'];
const FAULTS = {'missing-category': 'portal-categories', 'duplicate-cell': 'portal-unique-cells', 'blocked-approach': 'free-approach-cells'};
const FAULT_CASE = 'tiny-H2-seed0';
// Records every candidate attempt of generateCoopGame.
const RECORDER = `(() => {
  const build = buildCoopValleyCandidate
  globalThis.matrixLog = []
  buildCoopValleyCandidate = function(humans, size, seed, attempt) {
    try { const map = build(humans, size, seed, attempt); matrixLog.push({attempt, ok:true}); return map }
    catch (error) { matrixLog.push({attempt, ok:false, constraint:error.constraint}); throw error }
  }
})()`;

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const key = c => `${c.x},${c.y}`;
const caseId = (size, humans, seed) => `${size}-H${humans}-seed${seed}`;
const ALL_CASES = SIZES.flatMap(size => HUMANS.flatMap(humans => SEEDS.map(seed => ({id: caseId(size, humans, seed), size, humans, seed}))));

function generator() {
  const {createFixture} = require('./test-coop-harness');
  const f = createFixture(undefined, () => {});
  f.evaluate(RECORDER);
  return c => {
    const t0 = Date.now();
    try {
      const r = f.evaluate(`(() => { matrixLog = []
        const json = JSON.stringify(generateCoopGame(${c.humans}, {seed:${c.seed}, size:'${c.size}'}))
        return {json, attempts: matrixLog.slice()} })()`);
      return {json: r.json, attempts: r.attempts, generationMs: Date.now() - t0};
    } catch (error) {
      return {error: String(error && error.message || error), attempts: f.evaluate('matrixLog.slice()'), generationMs: Date.now() - t0};
    }
  };
}

// ------------------------------------------------------------------ worker
if (argv[0] === '--worker') {
  const [, tasksFile, outFile] = argv;
  const generate = generator();
  fs.writeFileSync(outFile, '');
  const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  tasks.forEach((t, i) => {
    const g = generate(t);
    const row = {id: t.id, role: t.role, pid: process.pid, attempts: g.attempts, generationMs: g.generationMs,
      ...(g.error ? {error: g.error} : {sha256: sha(g.json), bytes: Buffer.byteLength(g.json), json: t.role === 'primary' ? g.json : undefined})};
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log(`WORKER pid=${process.pid} task=${i + 1}/${tasks.length} ${t.role} ${t.id} ` +
      `${g.error ? 'error=' + JSON.stringify(g.error) : 'sha256=' + row.sha256.slice(0, 16)} attempts=${g.attempts.length} ms=${g.generationMs}`);
  });
  process.exit(0);
}

// ------------------------------------------------------------------ independent verifier
// Offset columns, odd columns half a row lower (sprites/sprite.js), restated.
function neighbourIds(id, w, h) {
  const x = id % w, y = Math.floor(id / w), shift = x % 2 ? 0 : -1, list = [];
  for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y + shift], [x - 1, y + shift + 1], [x + 1, y + shift], [x + 1, y + shift + 1]])
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
  return list;
}
// Blocked cells are never entered; endpoint cells are entered but not expanded.
function field(w, h, start, blocked, endpoints) {
  const dist = new Int32Array(w * h).fill(-1), queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  dist[start] = 0; queue[tail++] = start;
  while (head < tail) {
    const id = queue[head++];
    if (id !== start && endpoints && endpoints.has(id)) continue;
    for (const n of neighbourIds(id, w, h)) if (dist[n] < 0 && !(blocked && blocked.has(n))) { dist[n] = dist[id] + 1; queue[tail++] = n; }
  }
  return dist;
}
// Closed-form empty-grid distance (axial coordinates) cross-checks the BFS.
function cubeDistance(a, b) {
  const ra = a.y - (a.x - (a.x & 1)) / 2, rb = b.y - (b.x - (b.x & 1)) / 2, dq = a.x - b.x, dr = ra - rb;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function verifyCase(c, map, attempts) {
  const H = c.humans, side = SIDES[c.size][H - 1], assertions = [];
  const check = (name, observed, expected, detail) => {
    observed = observed === undefined ? '<undefined>' : JSON.parse(JSON.stringify(observed));
    expected = JSON.parse(JSON.stringify(expected));
    assertions.push({name, expected, observed, pass: isDeepStrictEqual(observed, expected), ...(detail === undefined ? {} : {detail})});
  };
  const w = map.mapSize.x, h = map.mapSize.y;
  const inBounds = p => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const idOf = p => p.y * w + p.x, cellOf = id => ({x: id % w, y: Math.floor(id / w)});
  const humans = map.players.slice(1, 1 + H), towns = humans.map(p => p.towns[0]), neutral = map.players[0].towns;
  const portals = Array.isArray(map.portals) ? map.portals : [];
  const layers = {mountains: map.mountains || [], lakes: map.lakes || [], bushes: map.bushes || [], hills: map.hills || []};

  check('generation-metadata', {generation: map.coop && map.coop.generation, mapSize: map.mapSize,
    humanStarts: humans.map(p => p.towns.length), players: map.players.length},
  {generation: {version: 4, playerCount: H, seed: c.seed, size: c.size, options: {seed: c.seed, size: c.size}},
    mapSize: {x: side, y: side}, humanStarts: Array(H).fill(1), players: H + 2});
  const n = attempts.length;
  check('bounded-generation-attempts', {withinLimit: n >= 1 && n <= ATTEMPT_LIMIT, indices: attempts.map(a => a.attempt), outcomes: attempts.map(a => a.ok)},
    {withinLimit: true, indices: Array.from({length: n}, (_, i) => i), outcomes: Array.from({length: n}, (_, i) => i === n - 1)}, {attempts: n, limit: ATTEMPT_LIMIT});
  check('portal-count', {portals: portals.length}, {portals: PORTALS_PER_HUMAN * H});
  check('portal-unique-cells', {unique: new Set(portals.map(key)).size}, {unique: PORTALS_PER_HUMAN * H});
  check('portal-in-bounds', {outOfBounds: portals.filter(p => !inBounds(p)).map(key)}, {outOfBounds: []});
  check('portal-categories', {counts: Object.fromEntries(CATEGORIES.map(k => [k, portals.filter(p => p.category === k).length])),
    unknown: portals.filter(p => !CATEGORIES.includes(p.category)).length},
  {counts: Object.fromEntries(CATEGORIES.map(k => [k, H])), unknown: 0});
  const front = p => 2 * p.x < w ? 'west' : 'east';
  const fronts = {west: portals.filter(p => front(p) === 'west').length, east: portals.filter(p => front(p) === 'east').length};
  check('two-front-balance', fronts, {west: PORTALS_PER_HUMAN * H / 2, east: PORTALS_PER_HUMAN * H / 2});
  const portalKeys = new Set(portals.map(key));
  const onto = list => list.filter(q => portalKeys.has(key(q))).map(key);
  check('no-overlap-starts-resources-terrain', {humanStarts: onto(towns), neutralTowns: onto(neutral), goldmines: onto(map.goldmines),
    mountains: onto(layers.mountains), lakes: onto(layers.lakes), bushes: onto(layers.bushes), hills: onto(layers.hills)},
  {humanStarts: [], neutralTowns: [], goldmines: [], mountains: [], lakes: [], bushes: [], hills: []});

  // Empty-hex distances from every portal to every town.
  const valid = portals.filter(inBounds);
  const empty = valid.map(p => field(w, h, idOf(p)));
  const hexHuman = towns.map(t => empty.map(d => d[idOf(t)]));
  const hexNeutral = neutral.map(t => empty.map(d => d[idOf(t)]));
  const cubeMismatches = [...towns, ...neutral].flatMap((t, i) => valid.map((p, j) => ({t, p, bfs: empty[j][idOf(t)]})))
    .filter(r => r.bfs !== cubeDistance(r.t, r.p)).length;
  check('hex-distance-cross-check', {mismatches: cubeMismatches, pairs: (towns.length + neutral.length) * valid.length},
    {mismatches: 0, pairs: (H + neutral.length) * valid.length});
  const minHuman = Math.min(...hexHuman.flat());
  check('human-town-portal-hex-minimum', {required: TOWN_DISTANCE[c.size], meetsRequired: minHuman >= TOWN_DISTANCE[c.size]},
    {required: ({tiny: 6, normal: 10, big: 14})[c.size], meetsRequired: true}, {minimum: minHuman});

  // Path models: terrain and other humans' towns block; neutral towns, portals
  // (and goldmines in the endpoint model) are entered but not passed through.
  const terrain = [...layers.mountains, ...layers.lakes].map(idOf), townIds = towns.map(idOf);
  const fields = Object.fromEntries(MODELS.map(model => [model, towns.map((t, i) => field(w, h, idOf(t),
    new Set([...terrain, ...townIds.filter((_, j) => j !== i)]),
    new Set([...neutral, ...valid, ...(model === 'mineEndpoints' ? map.goldmines : [])].map(idOf))))]));
  const pathMatrix = Object.fromEntries(MODELS.map(m => [m, fields[m].map(d => valid.map(p => d[idOf(p)] < 0 ? null : d[idOf(p)]))]));
  const unreached = MODELS.flatMap(m => pathMatrix[m].flatMap((row, i) => row.map((v, j) => v === null ? `${m}:human${i + 1}:${key(valid[j])}` : null)).filter(Boolean));
  check('all-human-reachability', {unreached, portalsMeasured: valid.length}, {unreached: [], portalsMeasured: PORTALS_PER_HUMAN * H});
  const nearest = Object.fromEntries(MODELS.map(m => [m, pathMatrix[m].map(row => row.length && row.every(v => v !== null) ? Math.min(...row) : null)]));
  const disparity = Object.fromEntries(MODELS.map(m => [m, nearest[m].every(v => v !== null) ? Math.max(...nearest[m]) - Math.min(...nearest[m]) : null]));
  check('nearest-portal-path-disparity', Object.fromEntries(MODELS.map(m => [m, disparity[m] !== null && disparity[m] <= DISPARITY])),
    {mineEndpoints: true, walkableMines: true}, {disparity, limit: DISPARITY});

  // Free adjacent approach cells: in bounds, no town, mine, portal, mountain or
  // lake, and reached by every human in both models; plus exclusive pairs.
  const occupied = new Set([...map.players.flatMap(p => p.towns), ...map.goldmines, ...valid, ...layers.mountains, ...layers.lakes].map(idOf));
  const bushIds = new Set(layers.bushes.map(idOf));
  const free = valid.map(p => neighbourIds(idOf(p), w, h).filter(id => !occupied.has(id) && MODELS.every(m => fields[m].every(d => d[id] >= 0))));
  const owner = new Map();
  const augment = (slot, seen) => {
    for (const id of free[slot >> 1]) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!owner.has(id) || augment(owner.get(id), seen)) { owner.set(id, slot); return true; }
    }
    return false;
  };
  const exclusivePairs = Array.from({length: 2 * valid.length}, (_, slot) => augment(slot, new Set())).every(Boolean);
  const freeCounts = free.map(list => list.length);
  check('free-approach-cells', {portalsBelowMinimum: valid.filter((_, i) => freeCounts[i] < MIN_APPROACH).map(key), exclusivePairs},
    {portalsBelowMinimum: [], exclusivePairs: true}, {minimum: freeCounts.length ? Math.min(...freeCounts) : null, required: MIN_APPROACH});

  const geometry = {id: c.id, side: w, humanStarts: towns.map(key), neutralTowns: neutral.map(key),
    portals: portals.map(p => ({x: p.x, y: p.y, category: p.category, front: front(p)})), fronts,
    hexHumanTownToPortal: hexHuman, hexNeutralTownToPortal: hexNeutral, minimumHumanHex: minHuman,
    minimumNeutralHex: hexNeutral.length ? Math.min(...hexNeutral.flat()) : null,
    pathHumanToPortal: pathMatrix, nearestPortalPath: nearest, disparity,
    approachCells: free.map((list, i) => ({portal: key(valid[i]), free: list.map(id => key(cellOf(id))), bushFree: list.filter(id => !bushIds.has(id)).length})),
    exclusivePairs};
  return {assertions, geometry};
}

// ------------------------------------------------------------------ parent / fault
const outDir = option('--output-dir') && path.resolve(option('--output-dir'));
const fault = option('--fault');
if (!outDir) throw new Error('--output-dir is required');
if (fault !== null && !FAULTS[fault]) throw new Error('unknown fault ' + fault);
for (const name of ['matrix.json', 'checkpoints.json'])
  if (fs.existsSync(path.join(outDir, name))) { console.error('refusing to overwrite ' + path.join(outDir, name)); process.exit(2); }
const selected = option('--cases') ? option('--cases').split(',') : null;
const cases = selected ? ALL_CASES.filter(c => selected.includes(c.id)) : ALL_CASES;
if (selected && cases.length !== selected.length) throw new Error('unknown case in --cases');
const workerCount = Number(option('--workers') || 2);
if (!Number.isInteger(workerCount) || workerCount < 2) throw new Error('--workers must be an integer >= 2 (repeats need a second process)');
fs.mkdirSync(outDir, {recursive: true});
const write = (name, value, indent = 1) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, indent));
const hashFile = file => fs.existsSync(path.join(ROOT, file)) ? sha(fs.readFileSync(path.join(ROOT, file))) : null;
const git = args => { try { return execFileSync('git', ['-C', ROOT, ...args], {encoding: 'utf8'}).trim(); } catch (e) { return null; } };
function writeSources(extra = {}) {
  const scripts = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script[^>]+src=['"]([^'"]+)['"]/g)]
    .map(m => m[1]).filter(s => !/^https?:/.test(s));
  const files = ['ai/test-coop-typed-portal-matrix.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js', 'index.html', ...scripts];
  write('source-identities.json', {head: git(['rev-parse', 'HEAD']), dirtyFiles: git(['status', '--short']), node: process.version,
    files: [...new Set(files)].map(file => ({file, sha256: hashFile(file)})), ...extra});
}

// Synthetic mutations of one generated map; each must be rejected by its named check.
function mutate(name, map) {
  const m = JSON.parse(JSON.stringify(map));
  if (name === 'missing-category') {
    m.portals = m.portals.map(p => p.category === 'highTier' ? {...p, category: 'normal'} : p);
    return {map: m, mutation: 'every highTier portal relabelled normal'};
  }
  if (name === 'duplicate-cell') {
    m.portals[1] = {...m.portals[1], x: m.portals[0].x, y: m.portals[0].y};
    return {map: m, mutation: `portal 1 moved onto portal 0 at ${key(m.portals[0])}`};
  }
  const w = m.mapSize.x, p = m.portals[0];
  const taken = new Set([...m.players.flatMap(q => q.towns), ...m.goldmines, ...m.portals, ...m.mountains, ...m.lakes].map(key));
  const open = neighbourIds(p.y * w + p.x, w, m.mapSize.y).map(id => ({x: id % w, y: Math.floor(id / w)})).filter(c => !taken.has(key(c)));
  const blocked = open.slice(1);
  m.mountains = [...m.mountains, ...blocked];
  m.bushes = m.bushes.filter(b => !blocked.some(c => key(c) === key(b)));
  return {map: m, mutation: `mountains on ${blocked.map(key).join(' ')} leave portal ${key(p)} one open neighbour`};
}

function runFault() {
  const id = selected ? selected[0] : FAULT_CASE, c = ALL_CASES.find(x => x.id === id);
  console.log(`START fault=${fault} case=${id} intended=${FAULTS[fault]} node=${process.version} cwd=${process.cwd()}`);
  const g = generator()(c);
  if (g.error) { console.log(`FAIL generation error ${g.error}`); process.exit(2); }
  const map = JSON.parse(g.json), baseline = verifyCase(c, map, g.attempts);
  const {map: bad, mutation} = mutate(fault, map), result = verifyCase(c, bad, g.attempts);
  const failed = result.assertions.filter(a => !a.pass);
  const baselineIntended = baseline.assertions.find(a => a.name === FAULTS[fault]);
  console.log(`MUTATION ${mutation}`);
  console.log(`BASELINE ${id} ${FAULTS[fault]} pass=${baselineIntended.pass} baselineFailures=${baseline.assertions.filter(a => !a.pass).length}`);
  for (const a of failed) console.log(`ASSERTION-FAILED ${id}-${a.name} expected=${JSON.stringify(a.expected)} observed=${JSON.stringify(a.observed)}`);
  const rejected = baseline.assertions.every(a => a.pass) && failed.some(a => a.name === FAULTS[fault]);
  write('checkpoints.json', {task: 'TASK-152', mode: 'fault:' + fault, case: id, mutation, intended: FAULTS[fault], rejectedByIntended: rejected,
    failed: failed.map(a => a.name), baseline: baseline.assertions, mutated: result.assertions});
  writeSources();
  if (rejected) { console.log(`REJECTED fault=${fault} by=${FAULTS[fault]}`); process.exit(1); }
  console.log(`NOT-REJECTED fault=${fault} intended=${FAULTS[fault]} failed=${failed.map(a => a.name).join(',') || 'none'}`);
  process.exit(4);
}

async function runMatrix() {
  const started = Date.now();
  console.log(`START typed-portal-matrix cases=${cases.length}/${EXPECTED_CASES} workers=${workerCount} node=${process.version} cwd=${process.cwd()}`);
  const checkpoints = [];
  const top = (id, observed, expected) => { const pass = isDeepStrictEqual(observed, expected); checkpoints.push({id, expected, observed, pass});
    if (!pass) console.log(`MISMATCH ${id} expected=${JSON.stringify(expected).slice(0, 300)} observed=${JSON.stringify(observed).slice(0, 300)}`); };
  top('matrix-literal-size', {sizes: SIZES.length, humans: HUMANS.length, seeds: SEEDS.length, product: ALL_CASES.length}, {sizes: 3, humans: 12, seeds: 32, product: EXPECTED_CASES});

  // Primary for index % n === k, repeat in the next worker.
  const workDir = path.join(outDir, 'workers');
  fs.mkdirSync(workDir, {recursive: true});
  const exits = await Promise.all(Array.from({length: workerCount}, (_, k) => {
    const tasks = cases.flatMap((c, i) => i % workerCount === k ? [{...c, role: 'primary'}] : (i + 1) % workerCount === k ? [{...c, role: 'repeat'}] : []);
    const tasksFile = path.join(workDir, `tasks-${k}.json`), outFile = path.join(workDir, `rows-${k}.jsonl`);
    fs.writeFileSync(tasksFile, JSON.stringify(tasks));
    return new Promise(resolve => {
      const child = spawn(process.execPath, [__filename, '--worker', tasksFile, outFile], {stdio: ['ignore', 'pipe', 'pipe']});
      child.stdout.on('data', d => process.stdout.write(d));
      child.stderr.on('data', d => process.stderr.write(d));
      child.on('exit', (code, signal) => resolve({worker: k, pid: child.pid, tasks: tasks.length, code, signal}));
    });
  }));
  exits.forEach(e => top(`worker-${e.worker}-exit`, {code: e.code, signal: e.signal}, {code: 0, signal: null}));

  const primary = new Map(), repeat = new Map(), duplicates = [];
  for (let k = 0; k < workerCount; k++) {
    const file = path.join(workDir, `rows-${k}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for await (const line of readline.createInterface({input: fs.createReadStream(file), crlfDelay: Infinity})) {
      if (!line) continue;
      const row = JSON.parse(line), target = row.role === 'primary' ? primary : repeat;
      if (target.has(row.id)) duplicates.push(row.role + ':' + row.id);
      target.set(row.id, row);
    }
  }
  const expectedIds = ALL_CASES.map(c => c.id);
  top('matrix-every-case-recorded', {primary: primary.size, repeat: repeat.size, duplicates,
    missing: expectedIds.filter(id => !primary.has(id) || !repeat.has(id)), extra: [...primary.keys(), ...repeat.keys()].filter(id => !expectedIds.includes(id))},
  {primary: EXPECTED_CASES, repeat: EXPECTED_CASES, duplicates: [], missing: [], extra: []});

  const matrix = [], geometryRows = [];
  for (const c of cases) {
    const p = primary.get(c.id), r = repeat.get(c.id);
    let assertions = [], geometry = null;
    const record = (name, observed, expected, detail) => assertions.push({name, expected, observed, pass: isDeepStrictEqual(observed, expected), ...(detail ? {detail} : {})});
    record('generated-without-error', {primary: p ? p.error || null : 'missing', repeat: r ? r.error || null : 'missing'}, {primary: null, repeat: null});
    if (p && !p.error) {
      const verified = verifyCase(c, JSON.parse(p.json), p.attempts);
      assertions = assertions.concat(verified.assertions);
      geometry = verified.geometry;
    }
    record('deterministic-repeat', {sameSha256: !!(p && r && p.sha256 && p.sha256 === r.sha256), sameAttempts: !!(p && r && isDeepStrictEqual(p.attempts, r.attempts)),
      separateProcesses: !!(p && r && p.pid !== r.pid)}, {sameSha256: true, sameAttempts: true, separateProcesses: true},
    {primarySha256: p && p.sha256, repeatSha256: r && r.sha256, primaryPid: p && p.pid, repeatPid: r && r.pid});
    const failed = assertions.filter(a => !a.pass).map(a => a.name);
    assertions.forEach(a => checkpoints.push({id: `${c.id}-${a.name}`, expected: a.expected, observed: a.observed, pass: a.pass, ...(a.detail ? {detail: a.detail} : {})}));
    if (geometry) geometryRows.push(geometry);
    matrix.push({id: c.id, size: c.size, humans: c.humans, seed: c.seed, pass: failed.length === 0, failed, assertionCount: assertions.length,
      side: geometry && geometry.side, portals: geometry && geometry.portals.length,
      categories: geometry && Object.fromEntries(CATEGORIES.map(k => [k, geometry.portals.filter(q => q.category === k).length])),
      fronts: geometry && geometry.fronts, minimumHumanHex: geometry && geometry.minimumHumanHex, requiredHex: TOWN_DISTANCE[c.size],
      disparity: geometry && geometry.disparity, minimumFreeApproach: geometry && Math.min(...geometry.approachCells.map(a => a.free.length)),
      attempts: p && p.attempts.length, sha256: p && p.sha256, repeatSha256: r && r.sha256, primaryPid: p && p.pid, repeatPid: r && r.pid,
      generationMs: p && p.generationMs, repeatGenerationMs: r && r.generationMs});
    for (const f of failed) console.log(`CASE-FAILED ${c.id} ${f}`);
  }
  console.log(`MEASURED cases=${matrix.length} passed=${matrix.filter(m => m.pass).length} failed=${matrix.filter(m => !m.pass).length}`);
  top('matrix-all-cases-pass', {recorded: matrix.length, failedCases: matrix.filter(m => !m.pass).map(m => m.id)}, {recorded: EXPECTED_CASES, failedCases: []});

  // Negative controls in separate processes.
  const negatives = [];
  for (const [name, intended] of Object.entries(FAULTS)) {
    const dir = path.join(outDir, 'negative-controls', name);
    const args = [__filename, '--fault', name, '--cases', FAULT_CASE, '--output-dir', dir];
    console.log(`BEGIN negative control ${name} command=${process.execPath} ${path.relative(ROOT, __filename)} --fault ${name} --cases ${FAULT_CASE} --output-dir ${path.relative(ROOT, dir)}`);
    const run = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 600000});
    process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || '');
    const file = path.join(dir, 'checkpoints.json'), data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const observed = {exitStatus: run.status, signal: run.signal, rejectedByIntended: data ? data.rejectedByIntended : null,
      intendedFailed: data ? data.failed.includes(intended) : null};
    console.log(`END negative control ${name} actual_exit_status=${run.status} intended=${intended} rejected_by_intended=${observed.rejectedByIntended}`);
    negatives.push({name, intended, case: FAULT_CASE, command: `${process.execPath} ${args.map(a => path.isAbsolute(a) ? path.relative(ROOT, a) : a).join(' ')}`,
      mutation: data && data.mutation, failedAssertions: data && data.failed, stdout: run.stdout, stderr: run.stderr, ...observed});
    top(`negative-control-${name}`, observed, {exitStatus: 1, signal: null, rejectedByIntended: true, intendedFailed: true});
  }

  const complete = !selected;
  const failedCheckpoints = checkpoints.filter(k => !k.pass);
  write('matrix.json', {task: 'TASK-152', complete, expectedCases: EXPECTED_CASES, recordedCases: matrix.length,
    passedCases: matrix.filter(m => m.pass).length, rules: {sides: SIDES, townDistance: TOWN_DISTANCE, disparity: DISPARITY, minApproach: MIN_APPROACH,
      attemptLimit: ATTEMPT_LIMIT, portalsPerHuman: PORTALS_PER_HUMAN, categories: CATEGORIES, frontRule: 'west when 2x < width; each front 2H portals'},
    workers: exits, cases: matrix});
  write('geometry-measurements.json', {task: 'TASK-152', models: {mineEndpoints: 'mountains, lakes and other humans\' towns block; neutral towns, portals and goldmines are entered but not expanded',
    walkableMines: 'as mineEndpoints but goldmines are walkable'}, cases: geometryRows}, 0);
  write('negative-controls.json', {task: 'TASK-152', controls: negatives});
  writeSources({generatedRows: fs.readdirSync(workDir).filter(f => f.endsWith('.jsonl')).map(f => ({file: path.join('workers', f), sha256: sha(fs.readFileSync(path.join(workDir, f)))}))});
  write('checkpoints.json', {task: 'TASK-152', mode: complete ? 'positive' : 'subset', total: checkpoints.length, passed: checkpoints.length - failedCheckpoints.length,
    failed: failedCheckpoints.map(k => k.id), elapsedSeconds: Math.round((Date.now() - started) / 1000), checkpoints}, 0);

  if (failedCheckpoints.length) { console.log(`FAIL typed-portal-matrix failed_checkpoints=${failedCheckpoints.length} first=${failedCheckpoints[0].id}`); process.exit(1); }
  if (!complete) { console.log(`INCOMPLETE typed-portal-matrix subset cases=${matrix.length}/${EXPECTED_CASES}; not a matrix pass`); process.exit(5); }
  console.log(`PASS typed-portal-matrix cases=${matrix.length}/${EXPECTED_CASES} portals=${matrix.reduce((s, m) => s + m.portals, 0)} ` +
    `checkpoints=${checkpoints.length} negative_controls=${negatives.length} repeats=${repeat.size} elapsed_s=${Math.round((Date.now() - started) / 1000)}`);
  process.exit(0);
}

if (fault) runFault();
else runMatrix().catch(error => { console.error(error && error.stack || error); process.exit(2); });
