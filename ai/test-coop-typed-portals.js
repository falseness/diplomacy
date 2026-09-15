'use strict';
// Four typed portals per starting human in new Divided Valley co-op maps
// (TASK-151). Every size x H1..12 x seeds 0/1 is generated through the real
// local co-op menu getter (online and hotseat getters on a subset) and replayed
// in a separate process. Counts, categories, fronts, town distances, access,
// path fairness and approach cells are measured here from raw placements with
// literal rules; the TASK-134 contract verifier also runs on each map. Each map
// is then started from its JSON, saved and restored, and a subset is restored
// by the sibling server's production script loader, to prove the categories
// reach runtime DemonPortal instances.
// Usage: node20 ai/test-coop-typed-portals.js --output-dir DIR
//        node20 ai/test-coop-typed-portals.js --fault legacy-count|near-portal|untyped-save --output-dir DIR [--cases ID,...]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawn, execFileSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const ROOT = path.join(__dirname, '..');
const SERVER = path.resolve(ROOT, '../diplomacy_server');

// Independent literals (TASK-151 rules); none are read from production code.
const SIZES = ['tiny', 'normal', 'big'], HUMANS = Array.from({length: 12}, (_, i) => i + 1), SEEDS = [0, 1];
const CATEGORIES = ['normal', 'ranged', 'heavy', 'highTier'], PORTALS_PER_HUMAN = 4;
const SIDES = {tiny: [11, 11, 13, 15, 17, 19, 20, 22, 23, 24, 25, 26], normal: [15, 18, 22, 25, 28, 31, 34, 36, 38, 40, 42, 44],
  big: [21, 28, 34, 39, 44, 48, 52, 56, 59, 62, 65, 68]};
const RESOURCES_PER_HUMAN = {tiny: 1, normal: 2, big: 3};
const TOWN_DISTANCE = {tiny: 6, normal: 10, big: 14};
const DISPARITY = 4, MIN_APPROACH = 2, ATTEMPT_LIMIT = 8, DENSITY_TOLERANCE = 0.02;
const SHARES = {mountains: 0.08, lakes: 0.06, bushes: 0.10};
const ONLINE_HUMANS = [1, 2, 5, 12], HOTSEAT_HUMANS = [1, 12];
const SERVER_CASES = ['tiny-H1-seed0', 'tiny-H12-seed1', 'normal-H5-seed0', 'big-H12-seed0'];
const FAULTS = {'legacy-count': 'portal-count', 'near-portal': 'portal-town-distance', 'untyped-save': 'runtime-categories-after-load'};
const SUPERSEDES = [
  'TASK-138 criterion "Keep portal totals H x multiplier(Tiny=1,Normal=2,Big=3)": now 4 x H on every size',
  'TASK-138 criterion "Solo Tiny retains exactly one portal ... Do not increase counts to populate both fronts": solo maps have four portals on both fronts',
  'TASK-134/135/137/139/140/141/142/143 portal totals derived from H x multiplier (ai/test-coop-valley-contract.js expectedFor, ai/test-coop-valley-portals.js, ai/test-coop-map-scaling.js, ai/test-coop-generation-api.js)'];
const SOURCES = ['ai/test-coop-typed-portals.js', 'ai/coop-map-scaling.js', 'ai/coop-valley-plan.js', 'ai/generateMap.js',
  'ai/wave-config.js', 'sprites/entities/buildings/demonPortal.js', 'options/gamestart.js', 'options/save.js',
  'gameObjectSerialization.js', 'menu/menu.js', 'index.html', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js',
  'ai/test-coop-valley-contract.js', 'ai/test-coop-valley-portals.js', 'ai/test-coop-map-scaling.js', 'ai/test-coop-generation-api.js'];
const SERVER_SOURCES = ['server/loadGameCode.js'];
const MANAGER = `{clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}}`;
// Records every candidate attempt of generateCoopGame.
const RECORDER = `(() => {
  const build = buildCoopValleyCandidate
  globalThis.typedLog = []
  buildCoopValleyCandidate = function(humans, size, seed, attempt) {
    try { const map = build(humans, size, seed, attempt); typedLog.push({attempt, ok:true}); return map }
    catch (error) { typedLog.push({attempt, ok:false, constraint:error.constraint}); throw error }
  }
})()`;

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const key = c => `${c.x},${c.y}`;
const caseId = (size, humans, seed) => `${size}-H${humans}-seed${seed}`;
const attemptSeed = (seed, attempt) => attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed;
const capital = size => size[0].toUpperCase() + size.slice(1);
const ALL_CASES = SIZES.flatMap(size => HUMANS.flatMap(humans => SEEDS.map(seed => ({id: caseId(size, humans, seed), size, humans, seed}))));

// ------------------------------------------------------------------ workers
if (argv[0] === '--replay-worker') {
  const [, casesFile, outFile] = argv;
  const {createFixture} = require('./test-coop-harness');
  const f = createFixture(undefined, () => {});
  const rows = [];
  for (const c of JSON.parse(fs.readFileSync(casesFile, 'utf8'))) {
    const json = f.evaluate(`JSON.stringify(generateCoopGame(${c.humans}, {seed:${c.seed}, size:'${c.size}'}))`);
    rows.push({id: c.id, sha256: sha(json), bytes: Buffer.byteLength(json), pid: process.pid});
    fs.writeFileSync(outFile, JSON.stringify(rows));
  }
  process.exit(0);
}
if (argv[0] === '--server-restore-worker') {
  // The production server loader evaluates the client scripts into this realm.
  const [, savesFile, outFile] = argv;
  require(path.join(SERVER, 'server/loadGameCode.js'));
  const results = JSON.parse(fs.readFileSync(savesFile, 'utf8')).map(s => {
    loadFromJson(s.saved);
    const portals = external.filter(e => e.isDemonPortal && !e.killed).map(e => ({x: e.coord.x, y: e.coord.y,
      category: e.category, owner: e.playerColor, isDemonPortal: e instanceof DemonPortal}))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    return {id: s.id, portals, exactResave: JSON.stringify(getGameObject()) === s.saved, pid: process.pid};
  });
  fs.writeFileSync(outFile, JSON.stringify(results));
  process.exit(0);
}

// ------------------------------------------------------------------ parent
const outDir = option('--output-dir') && path.resolve(option('--output-dir'));
const fault = option('--fault');
if (!outDir) throw new Error('--output-dir is required');
if (fault !== null && !FAULTS[fault]) throw new Error('unknown fault ' + fault);
if (fs.existsSync(path.join(outDir, 'checkpoints.json'))) throw new Error('refusing to overwrite ' + path.join(outDir, 'checkpoints.json'));
const selected = option('--cases') ? option('--cases').split(',') : null;
if (!fault && selected && !argv.includes('--subset')) throw new Error('positive mode runs every case; use --subset for development');
const cases = selected ? ALL_CASES.filter(c => selected.includes(c.id)) : ALL_CASES;
if (selected && cases.length !== selected.length) throw new Error('unknown case in --cases');
fs.mkdirSync(outDir, {recursive: true});
const write = (name, value) => fs.writeFileSync(path.join(outDir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 1));

const checkpoints = [];
class Mismatch extends Error {}
function compare(id, observed, expected) {
  observed = observed === undefined ? '<undefined>' : JSON.parse(JSON.stringify(observed));
  expected = JSON.parse(JSON.stringify(expected));
  const pass = isDeepStrictEqual(observed, expected);
  checkpoints.push({id, expected, observed, pass});
  if (!pass) {
    console.log(`MISMATCH ${id} expected=${JSON.stringify(expected).slice(0, 400)} observed=${JSON.stringify(observed).slice(0, 400)}`);
    if (fault) throw new Mismatch(id);
  }
  return pass;
}

// Odd columns sit half a row lower (sprites/sprite.js): restated here.
function neighbours(c, mapSize) {
  const shift = c.x % 2 ? 0 : -1;
  return [{x: c.x, y: c.y - 1}, {x: c.x, y: c.y + 1}, {x: c.x - 1, y: c.y + shift}, {x: c.x - 1, y: c.y + shift + 1},
    {x: c.x + 1, y: c.y + shift}, {x: c.x + 1, y: c.y + shift + 1}]
    .filter(n => n.x >= 0 && n.y >= 0 && n.x < mapSize.x && n.y < mapSize.y);
}
// Blocked cells are never entered; endpoint cells are entered but not expanded.
function bfs(mapSize, origin, blocked = new Set(), endpoints = new Set()) {
  const dist = new Map([[key(origin), 0]]), queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    if (i > 0 && endpoints.has(key(queue[i]))) continue;
    for (const n of neighbours(queue[i], mapSize)) {
      if (dist.has(key(n)) || blocked.has(key(n))) continue;
      dist.set(key(n), dist.get(key(queue[i])) + 1); queue.push(n);
    }
  }
  return dist;
}

function measure(c, map, plan) {
  const humans = map.players.slice(1, 1 + c.humans), towns = humans.map(p => p.towns[0]);
  const portals = map.portals, mapSize = map.mapSize, side = mapSize.x;
  const terrain = [...map.mountains, ...map.lakes].map(key);
  const objects = new Set([...map.players.flatMap(p => p.towns), ...map.goldmines, ...portals, ...map.mountains, ...map.lakes].map(key));
  const passages = plan.valley.passages.filter(p => p.kind === 'advance').map(p => {
    const cells = [];
    for (let x = p.x[0]; x <= p.x[1]; x++) for (let y = p.y[0] + 1; y < p.y[1]; y++) cells.push(key({x, y}));
    return {name: p.name, interior: cells};
  });
  const transit = (i, model, closed = []) => bfs(mapSize, towns[i],
    new Set([...terrain, ...towns.filter((_, j) => j !== i).map(key), ...closed]),
    new Set([...map.players[0].towns, ...portals, ...(model === 'mineEndpoints' ? map.goldmines : [])].map(key)));
  const models = ['mineEndpoints', 'walkableMines'];
  const fields = Object.fromEntries(models.map(m => [m, towns.map((_, i) => transit(i, m))]));
  const hex = towns.map(t => bfs(mapSize, t));
  const hexMatrix = hex.map(d => portals.map(p => d.get(key(p))));
  const pathMatrix = Object.fromEntries(models.map(m => [m, fields[m].map(d => portals.map(p => d.has(key(p)) ? d.get(key(p)) : null))]));
  const nearest = Object.fromEntries(models.map(m => [m, pathMatrix[m].map(row => row.every(v => v !== null) ? Math.min(...row) : null)]));
  const disparity = Object.fromEntries(models.map(m => [m, nearest[m].every(v => v !== null) ? Math.max(...nearest[m]) - Math.min(...nearest[m]) : null]));
  const usable = portals.map(p => neighbours(p, mapSize).filter(n => !objects.has(key(n)) &&
    models.every(m => fields[m].every(d => d.has(key(n))))).map(key));
  // Two exclusive approach cells per portal (bipartite matching over usable cells).
  const owner = new Map();
  const augment = (slot, seen) => {
    for (const cell of usable[slot >> 1]) {
      if (seen.has(cell)) continue;
      seen.add(cell);
      if (!owner.has(cell) || augment(owner.get(cell), seen)) { owner.set(cell, slot); return true; }
    }
    return false;
  };
  const matched = Array.from({length: 2 * portals.length}, (_, slot) => augment(slot, new Set())).every(Boolean);
  const exclusive = portals.map(() => []);
  for (const [cell, slot] of owner) exclusive[slot >> 1].push(cell);
  const passageAlone = passages.map(a => {
    const closed = passages.filter(b => b !== a).flatMap(b => b.interior);
    return {open: a.name, humans: towns.map((_, i) => {
      const d = transit(i, 'mineEndpoints', closed);
      return {portalsReached: portals.filter(p => d.has(key(p))).length, approachCellsReached: exclusive.flat().filter(cell => d.has(cell)).length};
    })};
  });
  const bothClosed = towns.map((_, i) => { const d = transit(i, 'mineEndpoints', passages.flatMap(p => p.interior));
    return portals.filter(p => d.has(key(p))).length; });
  const front = p => 2 * p.x < side ? 'west' : 'east';
  const fronts = {west: portals.filter(p => front(p) === 'west').length, east: portals.filter(p => front(p) === 'east').length};
  const categoryByFront = Object.fromEntries(['west', 'east'].map(fr => [fr, Object.fromEntries(CATEGORIES.map(k =>
    [k, portals.filter(p => front(p) === fr && p.category === k).length]))]));
  const area = side * side, ridge = plan.masks.ridge.length;
  const terrainRows = Object.fromEntries(Object.entries(SHARES).map(([kind, share]) => {
    const target = Math.round(area * share), achieved = map[kind].length;
    return [kind, {target, achieved, deviation: achieved - target, withinTolerance: Math.abs(achieved - target) <= DENSITY_TOLERANCE * area,
      ridgeOverflow: kind === 'mountains' && achieved > target && achieved === ridge}];
  }));
  return {towns, hexMatrix, minimumHexDistance: Math.min(...hexMatrix.flat().map(v => v === undefined ? -Infinity : v)),
    pathMatrix, nearest, disparity, usable, matched, exclusive, passageAlone, bothClosed, fronts, categoryByFront,
    regionAtPortal: portals.map(p => plan.grid[p.y][p.x]), terrain: terrainRows, ridgeCells: ridge};
}

function auditGeneration(c, map, attempts, plan) {
  const H = c.humans, side = SIDES[c.size][H - 1], R = RESOURCES_PER_HUMAN[c.size];
  const p = `${c.id}-`;
  if (fault === 'legacy-count') map = {...map, portals: map.portals.slice(0, H * R)};
  if (fault === 'near-portal') {
    // Move portal 0 to a free cell one step inside the size's distance from human 1.
    const d = bfs(map.mapSize, map.players[1].towns[0]);
    const taken = new Set([...map.players.flatMap(q => q.towns), ...map.goldmines, ...map.portals, ...map.mountains, ...map.lakes].map(key));
    const spot = [...d.entries()].filter(([k, v]) => v === TOWN_DISTANCE[c.size] - 1 && !taken.has(k)).map(([k]) => k).sort()[0];
    const [x, y] = spot.split(',').map(Number);
    map = {...map, portals: [{...map.portals[0], x, y}, ...map.portals.slice(1)]};
  }
  const categoryCounts = Object.fromEntries(CATEGORIES.map(k => [k, map.portals.filter(q => q.category === k).length]));
  compare(p + 'portal-count', {portals: map.portals.length, distinct: new Set(map.portals.map(key)).size},
    {portals: PORTALS_PER_HUMAN * H, distinct: PORTALS_PER_HUMAN * H});
  compare(p + 'portal-categories', {counts: categoryCounts, unknown: map.portals.filter(q => !CATEGORIES.includes(q.category)).length},
    {counts: Object.fromEntries(CATEGORIES.map(k => [k, H])), unknown: 0});
  compare(p + 'dimensions-assets-resources', {mapSize: map.mapSize, assets: map.players.slice(1, 1 + H).map(q => [q.gold, q.towns.length, q.units.length]),
    neutralTowns: map.players[0].towns.length, goldmines: map.goldmines.length, incomes: [...new Set(map.goldmines.map(g => g.income))],
    controller: map.players[H + 1] && {towns: map.players[H + 1].towns.length, units: map.players[H + 1].units.length, gold: map.players[H + 1].gold}},
    {mapSize: {x: side, y: side}, assets: Array.from({length: H}, () => [100, 1, 0]), neutralTowns: H * R, goldmines: H * R, incomes: [20],
      controller: {towns: 0, units: 0, gold: 0}});
  compare(p + 'generation-metadata-attempts', {generation: map.coop.generation, withinBound: attempts.length >= 1 && attempts.length <= ATTEMPT_LIMIT,
    lastOk: attempts.length ? attempts[attempts.length - 1].ok : null},
    {generation: {version: 4, playerCount: H, seed: c.seed, size: c.size, options: {seed: c.seed, size: c.size}}, withinBound: true, lastOk: true});
  compare(p + 'plan-matches-map', {side: plan.side, ridgeInMountains: plan.masks.ridge.every(r => map.mountains.some(m => key(m) === key(r)))},
    {side, ridgeInMountains: true});
  const m = measure(c, map, plan);
  const rows = {id: c.id, size: c.size, humans: H, seed: c.seed, attempts, measurements: m};
  compare(p + 'portal-town-distance', {minimum: Math.min(m.minimumHexDistance, TOWN_DISTANCE[c.size]), allMeasured: m.hexMatrix.flat().every(Number.isInteger)},
    {minimum: TOWN_DISTANCE[c.size], allMeasured: true});
  compare(p + 'shared-fronts', {groups: [m.fronts.west, m.fronts.east].filter(Boolean).length, difference: Math.abs(m.fronts.west - m.fronts.east),
    regions: m.regionAtPortal.map((ch, i) => ch === (2 * map.portals[i].x < side ? 'W' : 'E'))},
    {groups: 2, difference: Math.min(1, Math.abs(m.fronts.west - m.fronts.east)), regions: map.portals.map(() => true)});
  compare(p + 'access-every-human-every-portal', Object.values(m.pathMatrix).every(rows => rows.every(r => r.every(v => v !== null))), true);
  compare(p + 'each-passage-alone', {alone: m.passageAlone.map(a => a.humans.every(h => h.portalsReached === map.portals.length &&
    h.approachCellsReached === 2 * map.portals.length)), bothClosed: m.bothClosed.every(n => n === 0)},
    {alone: [true, true], bothClosed: true});
  compare(p + 'nearest-portal-disparity', Object.fromEntries(Object.entries(m.disparity).map(([k, v]) => [k, v !== null && v <= DISPARITY])),
    {mineEndpoints: true, walkableMines: true});
  compare(p + 'approach-cells', {minimumUsable: Math.min(...m.usable.map(u => u.length)) >= MIN_APPROACH, exclusivePairs: m.matched},
    {minimumUsable: true, exclusivePairs: true});
  compare(p + 'terrain-rules', Object.fromEntries(Object.entries(m.terrain).map(([k, v]) => [k, v.withinTolerance || v.ridgeOverflow])),
    {mountains: true, lakes: true, bushes: true});
  const contract = verifyValley({...map, size: c.size, valley: plan.valley});
  compare(p + 'valley-contract', {valid: contract.valid, failed: contract.failed}, {valid: true, failed: []});
  return rows;
}

const {createFixture} = require('./test-coop-harness');
const {verifyValley} = require('./test-coop-valley-contract.js');
const valley = require('./coop-valley-plan.js');

async function main() {
  const started = Date.now();
  console.log(`START typed-portals cases=${cases.length} fault=${fault || 'none'} node=${process.version} cwd=${process.cwd()}`);
  const casesFile = path.join(outDir, 'replay-cases.json'), replayFile = path.join(outDir, 'replay-worker.json');
  fs.writeFileSync(casesFile, JSON.stringify(cases));
  const replayLog = fs.openSync(path.join(outDir, 'replay-worker.log'), 'w');
  const replay = fault ? null : new Promise(resolve => spawn(process.execPath, [__filename, '--replay-worker', casesFile, replayFile],
    {stdio: ['ignore', replayLog, replayLog]}).on('exit', (code, signal) => resolve({code, signal})));
  const f = createFixture(undefined, () => {});
  f.evaluate(RECORDER);
  const maps = [], placements = [], counts = [], runtime = [], entrypoints = [], serverSaves = [];
  for (const c of cases) {
    const t0 = Date.now();
    const generated = f.evaluate(`(() => {
      typedLog = []
      const tree = Object.getOwnPropertyDescriptor(CoopSettingsTree.prototype, 'selectedMap').get
      const map = tree.call({playersSlider:{value:${c.humans}}, mapSlider:{value:${c.seed}}, sizeSlider:{realValue:'${capital(c.size)}'}})
      return {json: JSON.stringify(map), isGameMap: map instanceof GameMap, attempts: typedLog.slice()}
    })()`);
    const generationMs = Date.now() - t0, map = JSON.parse(generated.json);
    const success = generated.attempts.findIndex(a => a.ok);
    const plan = valley.planDividedValley(c.humans, c.size, attemptSeed(c.seed, success));
    compare(`${c.id}-local-menu-entrypoint`, generated.isGameMap, true);
    const rows = auditGeneration(c, map, generated.attempts, plan);
    placements.push(rows);
    maps.push({id: c.id, sha256: sha(generated.json), generationMs, attempts: generated.attempts, successSeed: attemptSeed(c.seed, success), map});
    counts.push({id: c.id, size: c.size, humans: c.humans, seed: c.seed, portals: map.portals.length,
      categories: Object.fromEntries(CATEGORIES.map(k => [k, map.portals.filter(q => q.category === k).length])),
      fronts: rows.measurements.fronts, categoriesByFront: rows.measurements.categoryByFront,
      neutralTowns: map.players[0].towns.length, goldmines: map.goldmines.length, side: map.mapSize.x});

    // Other entrypoints: online co-op (2..12 humans) and hotseat co-op getters.
    if (c.seed === 0 && (ONLINE_HUMANS.includes(c.humans) || HOTSEAT_HUMANS.includes(c.humans))) {
      const other = f.evaluate(`(() => {
        const call = (Tree, extra) => { try { return JSON.stringify(Object.getOwnPropertyDescriptor(Tree.prototype, 'selectedMap').get
          .call({isCoop:true, playersSlider:{value:${c.humans}}, mapSlider:{value:${c.seed}}, sizeSlider:{realValue:'${capital(c.size)}'}})) }
          catch (error) { return 'error:' + error.message } }
        return {online: ${ONLINE_HUMANS.includes(c.humans)} ? call(OnlineSettingsTree) : null,
          hotseat: ${HOTSEAT_HUMANS.includes(c.humans)} ? call(HotseatSettingsTree) : null}
      })()`);
      const expectOnline = !ONLINE_HUMANS.includes(c.humans) ? null : c.humans === 1 ? 'error:Online co-op requires 2 to 12 humans' : sha(generated.json);
      const observed = {online: other.online === null ? null : other.online.startsWith('error:') ? other.online : sha(other.online),
        hotseat: other.hotseat === null ? null : other.hotseat.startsWith('error:') ? other.hotseat : sha(other.hotseat)};
      compare(`${c.id}-online-hotseat-entrypoints`, observed, {online: expectOnline, hotseat: HOTSEAT_HUMANS.includes(c.humans) ? sha(generated.json) : null});
      entrypoints.push({id: c.id, local: sha(generated.json), ...observed});
    }

    // Runtime: start the generated map loaded from JSON, save and restore it.
    f.context.typedMapJson = generated.json;
    const live = `external.filter(e => e.isDemonPortal && !e.killed).map(e => ({x:e.coord.x, y:e.coord.y, category:e.category,
      owner:e.playerColor, isDemonPortal:e instanceof DemonPortal})).sort((a, b) => a.x - b.x || a.y - b.y)`;
    const run = f.evaluate(`(() => {
      const loaded = Object.assign(Object.create(GameMap.prototype), JSON.parse(typedMapJson))
      loaded.start(${MANAGER}, false); actionManager.clear()
      const started = ${live}
      globalThis.typedSaved = JSON.stringify(getGameObject())
      return {started, saved: typedSaved}
    })()`);
    let saved = run.saved;
    if (fault === 'untyped-save') {
      const game = JSON.parse(saved), text = typeof game.external === 'string';
      const ext = text ? JSON.parse(game.external) : game.external;
      ext.forEach(e => delete e.category);
      game.external = text ? JSON.stringify(ext) : ext;
      saved = JSON.stringify(game);
    }
    f.context.typedSavedInput = saved;
    const restored = f.evaluate(`(() => { loadFromJson(typedSavedInput); return {portals: ${live}, exact: JSON.stringify(getGameObject()) === typedSavedInput} })()`);
    const demonSlot = c.humans + 1;
    const expectedLive = map.portals.map(q => ({x: q.x, y: q.y, category: q.category, owner: demonSlot, isDemonPortal: true}))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const savedExternal = (() => { const g = JSON.parse(saved); const ext = typeof g.external === 'string' ? JSON.parse(g.external) : g.external;
      return ext.filter(e => e.name === 'demonPortal').map(e => ({x: e.coord.x, y: e.coord.y, category: e.category, owner: e.ownerSlot})).sort((a, b) => a.x - b.x || a.y - b.y); })();
    compare(`${c.id}-runtime-categories-after-start`, run.started, expectedLive);
    compare(`${c.id}-runtime-categories-after-load`, {portals: restored.portals, savedExternal, exactResave: restored.exact},
      {portals: expectedLive, savedExternal: expectedLive.map(({isDemonPortal, ...rest}) => rest), exactResave: true});
    runtime.push({id: c.id, startedPortals: run.started.length, restoredPortals: restored.portals.length, savedSha256: sha(saved),
      categories: Object.fromEntries(CATEGORIES.map(k => [k, restored.portals.filter(q => q.category === k).length]))});
    if (SERVER_CASES.includes(c.id)) serverSaves.push({id: c.id, saved, expected: expectedLive});
    console.log(`CASE ${c.id} side=${map.mapSize.x} portals=${map.portals.length} categories=${CATEGORIES.map(k => counts[counts.length - 1].categories[k]).join('/')} ` +
      `fronts=${rows.measurements.fronts.west}W/${rows.measurements.fronts.east}E minHex=${rows.measurements.minimumHexDistance}>=${TOWN_DISTANCE[c.size]} ` +
      `disparity=${rows.measurements.disparity.mineEndpoints}/${rows.measurements.disparity.walkableMines} minApproach=${Math.min(...rows.measurements.usable.map(u => u.length))} ` +
      `attempts=${generated.attempts.length} generationMs=${generationMs} totalMs=${Date.now() - t0} failedSoFar=${checkpoints.filter(k => !k.pass).length}`);
  }

  // Server realm restore through ../diplomacy_server/server/loadGameCode.js.
  let serverResults = [];
  if (serverSaves.length) {
    const savesFile = path.join(outDir, 'server-restore-input.json'), resultFile = path.join(outDir, 'server-restore.json');
    fs.writeFileSync(savesFile, JSON.stringify(serverSaves.map(({id, saved}) => ({id, saved}))));
    const serverLog = fs.openSync(path.join(outDir, 'server-restore-worker.log'), 'w');
    const exit = await new Promise(resolve => spawn(process.execPath, [__filename, '--server-restore-worker', savesFile, resultFile],
      {stdio: ['ignore', serverLog, serverLog], cwd: SERVER}).on('exit', (code, signal) => resolve({code, signal})));
    compare('server-restore-worker-exit', exit, {code: 0, signal: null});
    serverResults = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : [];
    for (const s of serverSaves) {
      const r = serverResults.find(x => x.id === s.id);
      compare(`${s.id}-server-realm-categories-after-load`, r ? {portals: r.portals, exactResave: r.exactResave, otherProcess: r.pid !== process.pid} : null,
        {portals: s.expected, exactResave: true, otherProcess: true});
    }
  }

  if (replay) {
    const exit = await replay;
    compare('replay-worker-exit', exit, {code: 0, signal: null});
    const rows = fs.existsSync(replayFile) ? JSON.parse(fs.readFileSync(replayFile, 'utf8')) : [];
    for (const m of maps) {
      const r = rows.find(x => x.id === m.id);
      compare(`${m.id}-deterministic-replay`, r ? {sha256: r.sha256, otherProcess: r.pid !== process.pid} : null, {sha256: m.sha256, otherProcess: true});
    }
  }
  const failed = checkpoints.filter(k => !k.pass);
  const hash = file => fs.existsSync(path.join(ROOT, file)) ? sha(fs.readFileSync(path.join(ROOT, file))) : null;
  const git = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8'}).trim(); } catch (e) { return null; } };
  write('source-identities.json', {head: git(ROOT, ['rev-parse', 'HEAD']), dirtyFiles: git(ROOT, ['status', '--short']),
    files: SOURCES.map(file => ({file, sha256: hash(file)})),
    server: {root: SERVER, head: git(SERVER, ['rev-parse', 'HEAD']), files: SERVER_SOURCES.map(file => ({file,
      sha256: fs.existsSync(path.join(SERVER, file)) ? sha(fs.readFileSync(path.join(SERVER, file))) : null}))}});
  write('generated-counts.json', {rules: {portalsPerHuman: PORTALS_PER_HUMAN, categories: CATEGORIES, sides: SIDES, resourcesPerHuman: RESOURCES_PER_HUMAN},
    totals: {cases: counts.length, portals: counts.reduce((s, r) => s + r.portals, 0), expectedPortals: counts.reduce((s, r) => s + 4 * r.humans, 0)}, cases: counts});
  write('maps.json', {cases: maps, entrypoints, runtime});
  write('placement-checkpoints.json', {rules: {townDistance: TOWN_DISTANCE, disparity: DISPARITY, minApproachCells: MIN_APPROACH,
    frontRule: 'west when 2x < side, east otherwise; group sizes differ by <=1', attemptLimit: ATTEMPT_LIMIT, densityTolerance: DENSITY_TOLERANCE},
    cases: placements, serverRestore: serverResults});
  write('checkpoints.json', {task: 'TASK-151', mode: fault ? 'fault:' + fault : selected ? 'subset' : 'positive', supersedes: SUPERSEDES,
    total: checkpoints.length, passed: checkpoints.length - failed.length, failed: failed.map(k => k.id), elapsedSeconds: Math.round((Date.now() - started) / 1000), checkpoints});
  return failed;
}

function runNegativeControls() {
  const results = [];
  for (const [name, target] of Object.entries(FAULTS)) {
    const dir = path.join(outDir, 'negative-' + name);
    const r = require('child_process').spawnSync(process.execPath, [__filename, '--fault', name, '--cases', 'tiny-H2-seed0', '--output-dir', dir], {encoding: 'utf8'});
    console.log(`BEGIN negative control ${name} command=${process.execPath} ${path.relative(ROOT, __filename)} --fault ${name} --cases tiny-H2-seed0 --output-dir ${path.relative(ROOT, dir)}`);
    process.stdout.write(r.stdout); process.stderr.write(r.stderr);
    const first = (r.stdout.match(/^MISMATCH (\S+)/m) || [])[1] || null;
    console.log(`END negative control ${name} actual_exit_status=${r.status} first_mismatch=${first}`);
    results.push({name, status: r.status, first, expected: 'tiny-H2-seed0-' + target});
  }
  return results;
}

main().then(failed => {
  if (fault) { console.log(`FAULT ${fault} accepted without mismatch`); process.exit(3); }
  let negatives = [];
  if (!selected) {
    negatives = runNegativeControls();
    negatives.forEach(n => compare('negative-control-' + n.name, {status: n.status, firstMismatch: n.first}, {status: 1, firstMismatch: n.expected}));
    const file = path.join(outDir, 'checkpoints.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const all = checkpoints.filter(k => !k.pass);
    fs.writeFileSync(file, JSON.stringify({...data, total: checkpoints.length, passed: checkpoints.length - all.length, failed: all.map(k => k.id),
      negativeControls: negatives, checkpoints}, null, 1));
    failed = all;
  }
  const portals = cases.reduce((s, c) => s + 4 * c.humans, 0);
  if (failed.length) { console.log(`FAIL typed-portals failed=${failed.length} first=${failed[0].id}`); process.exit(1); }
  console.log(`PASS typed-portals cases=${cases.length}/${ALL_CASES.length} portals=${portals} checkpoints=${checkpoints.length} ` +
    `negative_controls=${negatives.length} replay=${cases.length} server_restores=${cases.filter(c => SERVER_CASES.includes(c.id)).length}`);
  process.exit(0);
}).catch(error => {
  if (error instanceof Mismatch) {
    const file = path.join(outDir, 'checkpoints.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({task: 'TASK-151', mode: 'fault:' + fault, failed: [error.message], checkpoints}, null, 1));
    console.log(`FAIL fault=${fault} mismatch=${error.message}`);
    process.exit(1);
  }
  console.error(error && error.stack || error);
  process.exit(2);
});
