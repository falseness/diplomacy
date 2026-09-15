'use strict';
// Save/load compatibility for Divided Valley (version 4) maps in the human,
// demon and complete local phases, and for stored version-2/3 maps produced by
// the pre-valley generators (ai/fixtures/coop-legacy-stored-maps.json). Every
// save is restored in a fresh runtime whose generation, repair and wave entry
// points are counted, so a load may never regenerate a map or spawn a wave.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const {createFixture} = require('./test-coop-harness');
const {audit: legacyAudit} = require('./test-coop-terrain-audit');
const {verifyValley} = require('./test-coop-valley-contract');
const valley = require('./coop-valley-plan.js');
const {getCoopMapScaling} = require('./coop-map-scaling');
const LEGACY = require('./fixtures/coop-legacy-stored-maps.json');
const ROOT = path.join(__dirname, '..');
const SOURCES = ['ai/test-coop-valley-save.js', 'ai/test-coop-scaled-save.js', 'ai/test-coop-map-scaling.js',
  'ai/fixtures/coop-legacy-stored-maps.json', 'ai/generateMap.js', 'ai/coop-valley-plan.js', 'ai/coop-map-scaling.js',
  'gameObjectSerialization.js', 'options/save.js', 'options/gamestart.js', 'nextTurn.js', 'ai/wave-composition.js',
  'ai/wave-placement.js', 'ai/test-coop-harness.js', 'ai/test-coop-terrain-audit.js', 'ai/test-coop-valley-contract.js',
  'ai/browserScriptCache.js', 'index.html'];
const PHASES = ['demon', 'complete', 'human'];
const MATRIX = {humans: [1, 4, 12], sizes: ['tiny', 'normal', 'big']};
const WAVE = {seed: 42, round: 3};
// Version-4 maps use the seedless typed schedule: completed round 4 is the first
// wave and only normal portals produce. Stored version-2/3 maps keep seeded waves.
const waveFor = stored => stored.coop.generation.version === 4 ?
  {round: 4, spawned: stored.portals.filter(p => p.category === 'normal').length, waveGeneration: null, typedWaves: {lastRound: 4}} :
  {round: WAVE.round, spawned: stored.portals.length, waveGeneration: {version: 1, seed: WAVE.seed, lastRound: WAVE.round}, typedWaves: null};
const ENTRY_POINTS = ['generateCoopGame', 'buildCoopValleyCandidate', 'planDividedValley', 'placeValleyStarts',
  'enforceCoopStartBalance', 'repairCoopValley', 'placeCoopPortals', 'growCoopTerrain', 'repairCoopConnectivity',
  'spawnCoopWave', 'generateCoopWave', 'placeCoopWave'];
const FAULTS = {regenerate: 'snapshot-equality'};
const MANAGER = `{clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}}`;

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const outDir = option('--output-dir') && path.resolve(option('--output-dir'));
const fault = option('--fault');
const humansList = (option('--humans') || MATRIX.humans.join(',')).split(',').map(Number);
const sizesList = (option('--sizes') || MATRIX.sizes.join(',')).split(',');
if (fault !== null && !FAULTS[fault]) throw new Error('unknown fault ' + fault);
// --subset narrows a development run; it skips the coverage gate and negative control.
const subset = argv.includes('--subset');
if (!fault && !subset && (humansList.join() !== MATRIX.humans.join() || sizesList.join() !== MATRIX.sizes.join()))
  throw new Error('positive mode requires humans 1,4,12 and all sizes');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const sortCoords = list => list.map(c => ({x: c.x, y: c.y})).sort((a, b) => a.x - b.x || a.y - b.y);
const write = (rel, text) => {
  if (!outDir) return;
  fs.mkdirSync(path.dirname(path.join(outDir, rel)), {recursive: true});
  fs.writeFileSync(path.join(outDir, rel), text);
};
const attemptSeed = (seed, attempt) => attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed;

// Placements read back from the live runtime registries and grid cells.
const LIVE_LAYOUT = `(() => {
  const at = o => ({x:o.coord.x, y:o.coord.y}), sort = a => a.sort((p,q) => p.x-q.x || p.y-q.y)
  const cells = test => { const r = []; for (let x=0;x<grid.arr.length;x++) for (let y=0;y<grid.arr[x].length;y++) if (test(grid.arr[x][y])) r.push({x,y}); return r }
  const nat = name => sort(nature.filter(n => !n.killed && n.name === name).map(at))
  return {mapSize:{x:grid.arr.length, y:grid.arr[0].length},
    towns:players.map(p => sort(p.towns.filter(t => !t.killed).map(at))),
    goldmines:sort(goldmines.filter(g => !g.killed).map(at)),
    portals:sort(external.filter(p => p.isDemonPortal && !p.killed).map(at)),
    mountains:nat('mountain'), lakes:nat('lake'), bushes:nat('bush'), hills:nat('hill'),
    gridBuildings:cells(c => c.building.notEmpty()).length, gridUnits:cells(c => c.unit.notEmpty()).length,
    units:players.map(p => sort(p.units.filter(u => !u.killed).map(u => ({...at(u), name:u.name, hp:u.hp, moves:u.moves}))))}
})()`;
const IDENTITIES = `players.map((p, slot) => ({slot, class:p.constructor.name, role:p.role, rgb:{...p.color},
  economyEnabled:p.economyEnabled, isLost:!!p.isLost, gold:p.gold}))`;
const MARKERS = `({round:gameRound, turn:whooseTurn, waveGeneration:gameSettings.coop.waveGeneration || null,
  typedWaves:gameSettings.coop.typedWaves || null,
  localPhase:gameSettings.coop.localPhase || null, balanceVersion:gameSettings.coop.balanceVersion,
  initialHumanCount:gameSettings.coop.initialHumanCount, demonSlot:gameSettings.coop.demonSlot})`;

function expectedLayout(map) {
  return {mapSize: map.mapSize, towns: map.players.map(p => sortCoords(p.towns)), goldmines: sortCoords(map.goldmines),
    portals: sortCoords(map.portals), mountains: sortCoords(map.mountains), lakes: sortCoords(map.lakes),
    bushes: sortCoords(map.bushes), hills: sortCoords(map.hills)};
}
const placements = live => { const {gridBuildings, gridUnits, units, ...rest} = live; return rest; };

// Version-aware terrain audit: stored version-2/3 grids keep the proportional
// 8/6/10% density and clustering contract; version 4 is judged by the Divided
// Valley contract, whose terrain counts vary with the planned ridge.
function auditTerrain(stored, live) {
  const h = stored.coop.initialHumanCount, generation = stored.coop.generation;
  const mines = new Map(stored.goldmines.map(m => [`${m.x},${m.y}`, m]));
  const map = {size: generation.size, mapSize: live.mapSize, coop: {initialHumanCount: h},
    players: stored.players.map((p, i) => ({...p, towns: live.towns[i]})),
    goldmines: live.goldmines.map(c => ({...mines.get(`${c.x},${c.y}`), ...c})),
    portals: live.portals, mountains: live.mountains, lakes: live.lakes, bushes: live.bushes, hills: live.hills};
  const counts = {mountains: map.mountains.length, lakes: map.lakes.length, bushes: map.bushes.length, hills: map.hills.length};
  if (generation.version < 4) {
    let legacy;
    try { legacy = {pass: true, detail: legacyAudit(map, 'legacy-v' + generation.version).categories}; }
    catch (error) { legacy = {pass: false, detail: error.message}; }
    return {semantics: 'legacy-density-clusters-routes', version: generation.version, pass: legacy.pass, counts, legacy};
  }
  let contract = null, attempt = -1;
  for (let a = 0; a < 8 && !(contract && contract.valid); a++) {
    const plan = valley.planDividedValley(h, generation.size, attemptSeed(generation.seed, a));
    const mountains = new Set(map.mountains.map(c => `${c.x},${c.y}`));
    if (plan.side !== live.mapSize.x || !plan.masks.ridge.every(c => mountains.has(`${c.x},${c.y}`))) continue;
    contract = verifyValley({...map, valley: plan.valley}); attempt = a;
  }
  const scaling = getCoopMapScaling(h, generation.size);
  const target = {mountains: scaling.counts.mountains, lakes: scaling.counts.lakes, bushes: scaling.counts.bushes};
  return {semantics: 'divided-valley-contract', version: 4, attempt, pass: !!(contract && contract.valid),
    rejectedBy: contract ? contract.rejectedBy : 'no-matching-plan', counts, proportionalTargets: target,
    variableTerrain: Object.keys(target).some(k => counts[k] !== target[k])};
}

// One runtime per stored map: start it, spawn the round-3 wave through the
// production dispatcher and save at the demon, complete and human boundaries.
function prepare(entry) {
  const f = createFixture(undefined, () => {});
  const t0 = Date.now();
  if (entry.version === 4) {
    f.evaluate(`globalThis.stored = generateCoopGame(${entry.humans}, {size:'${entry.size}', seed:${entry.seed}}); undefined`);
  } else {
    f.context.storedInput = JSON.stringify(entry.map);
    f.evaluate('globalThis.stored = Object.assign(Object.create(GameMap.prototype), JSON.parse(storedInput)); undefined');
  }
  const storedJson = f.evaluate('JSON.stringify(stored)'), stored = JSON.parse(storedJson);
  const generatedMs = Date.now() - t0;
  // Current-generator output for the same inputs; stored maps must differ from it.
  const regenerated = entry.version === 4 ? stored : JSON.parse(f.evaluate(
    `JSON.stringify(generateCoopGame(stored.coop.generation.playerCount, stored.coop.generation.options))`));
  const demonSlot = stored.coop.demonSlot;
  const saves = {};
  const capture = phase => {
    saves[phase] = {json: f.evaluate('JSON.stringify(getGameObject())'), identities: f.evaluate(IDENTITIES),
      markers: f.evaluate(MARKERS), live: f.evaluate(LIVE_LAYOUT)};
  };
  const w = waveFor(stored);
  const wave = f.evaluate(`(() => {
    stored.start(${MANAGER}, false); actionManager.clear()
    gameRound = ${w.round - 1}; whooseTurn = ${demonSlot}
    if (${!w.typedWaves}) gameSettings.coop.waveGeneration = {version:1, seed:${WAVE.seed}, lastRound:${WAVE.round - 1}}
    gameSettings.coop.localPhase = {round:${w.round}, stage:'wave'}
    const before = players[${demonSlot}].units.length
    advanceCoopLocalPhase()
    return {spawned:players[${demonSlot}].units.length - before, stage:gameSettings.coop.localPhase.stage}
  })()`);
  assert.deepEqual(wave, {spawned: w.spawned, stage: 'demon'}, entry.id + '-wave-spawned');
  capture('demon');
  // The demon AI move is outside persistence; the dispatcher still refreshes the controller.
  f.evaluate(`(() => { const d = players[${demonSlot}]; d.play = () => {}
    try { advanceCoopLocalPhase() } finally { delete d.play } })()`);
  capture('complete');
  f.evaluate(`delete gameSettings.coop.localPhase; gameRound = ${w.round}; whooseTurn = 1; actionManager.clear(); undefined`);
  capture('human');
  const distinguishing = {
    mapSize: [stored.mapSize, regenerated.mapSize],
    humanTownsNotInCurrentGeneration: stored.players.slice(1, 1 + stored.coop.initialHumanCount)
      .filter((p, i) => JSON.stringify(p.towns) !== JSON.stringify(regenerated.players[i + 1].towns)).length,
    layoutSha256: {stored: sha(JSON.stringify(expectedLayout(stored))), current: sha(JSON.stringify(expectedLayout(regenerated)))}};
  return {stored, storedJson, saves, wave, generatedMs, regeneratedLayout: expectedLayout(regenerated), distinguishing};
}

const EXPECTED_MARKERS = {
  demon: (demonSlot, w) => ({round: w.round - 1, turn: demonSlot, localPhase: {round: w.round, stage: 'demon'}}),
  complete: (demonSlot, w) => ({round: w.round - 1, turn: demonSlot, localPhase: {round: w.round, stage: 'complete'}}),
  human: (demonSlot, w) => ({round: w.round, turn: 1, localPhase: null})
};

function restore(entry, prepared, phase) {
  const {stored, saves} = prepared, save = saves[phase], h = stored.coop.initialHumanCount, demonSlot = stored.coop.demonSlot;
  const w = waveFor(stored);
  const id = `${entry.id}-${phase}`, checks = [];
  const check = (name, observed, expected) => {
    const pass = isDeepStrictEqual(observed, expected);
    checks.push({name: `${id}-${name}`, pass, expected, observed});
    console.log(JSON.stringify({name: `${id}-${name}`, pass, expected: compact(expected), observed: compact(observed)}));
    assert.deepEqual(observed, expected, name);
  };
  const t0 = Date.now();
  const g = createFixture(undefined, () => {});
  g.context.savedInput = save.json;
  g.evaluate(`globalThis.entryCalls = {}
    for (const name of ${JSON.stringify(ENTRY_POINTS)}) {
      const original = globalThis[name]; entryCalls[name] = 0
      globalThis[name] = function(...args) { entryCalls[name]++; return original.apply(this, args) }
    }
    { const start = GameMap.prototype.start; entryCalls['GameMap.start'] = 0
      GameMap.prototype.start = function(...args) { entryCalls['GameMap.start']++; return start.apply(this, args) } }
    loadFromJson(savedInput); undefined`);
  if (fault === 'regenerate') {
    // Corruption: a loader that rebuilds the saved map from its generation inputs.
    g.evaluate(`(() => { const s = gameSettings.coop.generation
      generateCoopGame(s.playerCount, s.options).start(${MANAGER}, false); whooseTurn = 1 })()`);
  }
  const after = g.evaluate('JSON.stringify(getGameObject())');
  write(`snapshots/${id}-before.json`, save.json);
  write(`snapshots/${id}-after.json`, after);
  const record = {case: id, version: stored.coop.generation.version, humans: h, size: stored.coop.generation.size,
    seed: stored.coop.generation.seed, phase, beforeSha256: sha(save.json), afterSha256: sha(after), bytes: save.json.length,
    snapshots: {before: `snapshots/${id}-before.json`, after: `snapshots/${id}-after.json`}, checks};
  try {
    check('snapshot-equality', {sha256: sha(after), bytes: after.length}, {sha256: sha(save.json), bytes: save.json.length});
    check('no-regeneration-or-spawn', g.evaluate('entryCalls'),
      Object.fromEntries([...ENTRY_POINTS, 'GameMap.start'].map(n => [n, 0])));
    check('generation-inputs', g.evaluate('gameSettings.coop.generation'), stored.coop.generation);
    check('player-identities', g.evaluate(IDENTITIES), save.identities);
    const markers = g.evaluate(MARKERS);
    check('round-wave-phase-markers', markers, {...EXPECTED_MARKERS[phase](demonSlot, w),
      waveGeneration: w.waveGeneration, typedWaves: w.typedWaves, localPhase: EXPECTED_MARKERS[phase](demonSlot, w).localPhase,
      balanceVersion: 2, initialHumanCount: h, demonSlot});
    check('round-wave-phase-markers-unchanged', markers, save.markers);
    const live = g.evaluate(LIVE_LAYOUT);
    check('exact-grid-object-placements', placements(live), expectedLayout(stored));
    check('units-no-duplicates', {units: live.units, gridUnits: live.gridUnits, gridBuildings: live.gridBuildings},
      {units: save.live.units, gridUnits: save.live.gridUnits, gridBuildings: save.live.gridBuildings});
    check('demon-wave-count', live.units[demonSlot].length, w.spawned);
    check('not-current-regeneration', {equal: JSON.stringify(placements(live)) === JSON.stringify(prepared.regeneratedLayout)},
      {equal: stored.coop.generation.version === 4});
    const terrain = auditTerrain(stored, live);
    record.terrainAudit = terrain;
    check('version-aware-terrain-audit', {semantics: terrain.semantics, pass: terrain.pass},
      {semantics: stored.coop.generation.version < 4 ? 'legacy-density-clusters-routes' : 'divided-valley-contract', pass: true});
    // Resuming the restored boundary must not spawn the round's wave again.
    const resumed = g.evaluate(`(() => {
      const d = players[${demonSlot}]; let played = 0; d.play = () => { played++ }
      try { if (gameSettings.coop.localPhase) advanceCoopLocalPhase() } finally { delete d.play }
      return {stage:gameSettings.coop.localPhase ? gameSettings.coop.localPhase.stage : null, played,
        demonUnits:d.units.filter(u => !u.killed).length, calls:entryCalls,
        wave:gameSettings.coop.waveGeneration || null, typedWaves:gameSettings.coop.typedWaves || null}
    })()`);
    check('resume-without-duplicate-spawn', resumed, {stage: phase === 'human' ? null : 'complete', played: phase === 'demon' ? 1 : 0,
      demonUnits: w.spawned, calls: Object.fromEntries([...ENTRY_POINTS, 'GameMap.start'].map(n => [n, 0])),
      wave: w.waveGeneration, typedWaves: w.typedWaves});
  } finally {
    record.elapsedMs = Date.now() - t0;
  }
  return record;
}

function compact(value) {
  const text = JSON.stringify(value);
  return text.length <= 600 ? value : {sha256: sha(text), bytes: text.length};
}

function entries() {
  const list = [];
  for (const size of sizesList) for (const humans of humansList)
    list.push({id: `v4-${size}-H${humans}`, version: 4, humans, size, seed: 0});
  for (const legacy of LEGACY) list.push({id: `v${legacy.version}-${legacy.map.coop.generation.size}-H${legacy.map.coop.initialHumanCount}`,
    version: legacy.version, map: legacy.map, source: legacy.source});
  return list;
}

function main() {
  const checkpoints = {test: 'ai/test-coop-valley-save.js', fault, node: process.version, cwd: process.cwd(),
    wave: WAVE, phases: PHASES, maps: [], cases: []};
  const rejected = [];
  for (const entry of entries()) {
    const prepared = prepare(entry);
    const {stored} = prepared;
    const mapRecord = {id: entry.id, version: stored.coop.generation.version, generation: stored.coop.generation,
      source: entry.source || 'generateCoopGame (current)', generatedMs: prepared.generatedMs, wave: prepared.wave,
      counts: {side: stored.mapSize, neutralTowns: stored.players[0].towns.length, goldmines: stored.goldmines.length,
        portals: stored.portals.length, mountains: stored.mountains.length, lakes: stored.lakes.length, bushes: stored.bushes.length},
      storedMapSha256: sha(prepared.storedJson), distinguishing: prepared.distinguishing, map: `maps/${entry.id}.json`};
    write(`maps/${entry.id}.json`, prepared.storedJson + '\n');
    if (entry.version === 4) {
      const scaling = getCoopMapScaling(entry.humans, entry.size);
      assert.deepEqual([stored.coop.generation, stored.mapSize, stored.players[0].towns.length, stored.goldmines.length, stored.portals.length],
        [{version: 4, playerCount: entry.humans, seed: 0, size: entry.size, options: {seed: 0, size: entry.size}}, scaling.mapSize,
          scaling.counts.neutralTowns, scaling.counts.goldmines, scaling.counts.portals], entry.id + '-current-generation');
    } else {
      // Stored version-2/3 layouts are intentionally distinguishable from the current generator.
      assert.equal(stored.coop.generation.version, entry.version, entry.id + '-stored-version');
      assert.ok(prepared.distinguishing.humanTownsNotInCurrentGeneration > 0 &&
        prepared.distinguishing.layoutSha256.stored !== prepared.distinguishing.layoutSha256.current, entry.id + '-distinguishable');
    }
    console.log(JSON.stringify(mapRecord));
    checkpoints.maps.push(mapRecord);
    for (const phase of PHASES) {
      if (!fault) { const r = restore(entry, prepared, phase); checkpoints.cases.push(r); console.log(`PASS ${r.case}`); continue; }
      try { restore(entry, prepared, phase); rejected.push({case: `${entry.id}-${phase}`, rejectedBy: null}); }
      catch (error) {
        rejected.push({case: `${entry.id}-${phase}`, rejectedBy: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'error: ' + error.message});
      }
    }
  }
  const summary = {maps: checkpoints.maps.length, cases: checkpoints.cases.length,
    v4Cases: checkpoints.cases.filter(c => c.version === 4).length,
    legacyCases: checkpoints.cases.filter(c => c.version < 4).length,
    phases: [...new Set(checkpoints.cases.map(c => c.phase))],
    snapshotsEqual: checkpoints.cases.filter(c => c.beforeSha256 === c.afterSha256).length,
    variableTerrainV4: checkpoints.cases.filter(c => c.terrainAudit && c.terrainAudit.variableTerrain).length / PHASES.length};
  if (fault) {
    checkpoints.rejected = rejected;
    write('negative-control/checkpoints.json', JSON.stringify(checkpoints, null, 1) + '\n');
    const byNamed = rejected.filter(r => r.rejectedBy === FAULTS[fault]).length;
    console.log(`FAULT ${fault} cases=${rejected.length} rejectedBy=${FAULTS[fault]}:${byNamed}/${rejected.length} ` +
      JSON.stringify(rejected));
    if (byNamed !== rejected.length || !rejected.length) { console.error('fault not rejected by the named assertion'); process.exit(3); }
    assert.fail(`${FAULTS[fault]}: regenerated saved maps rejected ${byNamed}/${rejected.length}`);
  }
  if (subset) { console.log('SUBSET ' + JSON.stringify(summary)); return; }
  // Negative control: the corruption must be rejected by snapshot equality.
  const childArgs = [__filename, '--fault', 'regenerate', '--humans', '1,4', '--sizes', 'tiny'];
  if (outDir) childArgs.push('--output-dir', path.join(outDir, 'negative-control'));
  console.log('BEGIN negative control: ' + [process.execPath, ...childArgs.map(a => path.relative(process.cwd(), a) || a)].join(' '));
  const child = spawnSync(process.execPath, childArgs, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  const faultLine = (child.stdout.match(/^FAULT .*$/m) || [''])[0];
  console.log(faultLine);
  process.stdout.write(child.stderr);
  console.log(`END negative control actual_exit_status=${child.status}`);
  write('negative-control/stdout.log', child.stdout);
  write('negative-control/stderr.log', child.stderr);
  assert.equal(child.status, 1, 'negative-control-exit');
  assert.match(child.stderr, /AssertionError \[ERR_ASSERTION\]: snapshot-equality: regenerated saved maps rejected 12\/12/, 'negative-control-assertion');
  summary.negativeControl = {exit: child.status, faultLine};
  checkpoints.summary = summary;
  write('checkpoints.json', JSON.stringify(checkpoints, null, 1) + '\n');
  write('source-identities.json', JSON.stringify({node: process.version, algorithm: 'sha256',
    files: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]))}, null, 1) + '\n');
  assert.deepEqual([summary.maps, summary.v4Cases, summary.legacyCases, summary.snapshotsEqual], [11, 27, 6, 33], 'coverage');
  console.log(`PASS valley-save maps=11 cases=33 v4=27 (humans=1,4,12 sizes=tiny,normal,big phases=demon,complete,human) ` +
    `legacy=6 (v2,v3) snapshots_equal=33/33 regeneration_calls=0 spawn_calls=0 negative_control=snapshot-equality exit=1`);
}

main();
