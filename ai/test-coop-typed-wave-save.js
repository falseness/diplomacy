'use strict';
// TASK-154: typed portal and synchronized phase state survives save/load.
// Solo and ten-human games on the co-op menu defaults (Normal, seed 1, no fog,
// global sudden death) are played by idle humans through the real nextTurn()
// dispatcher. An uninterrupted baseline captures current-format saves
// (getGameObject) at named points; each save is restored in a fresh runtime via
// loadFromJson + GameManager.load and continued to the terminal result. Every
// continuation must reproduce the baseline's normalized snapshots, wave/portal
// ledgers, human turns and terminal state exactly.
//
// usage: node ai/test-coop-typed-wave-save.js --output-dir DIR
//        node ai/test-coop-typed-wave-save.js --output-dir DIR --scenario solo|h10 --fault NAME
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const {createFixture} = require('./test-coop-harness');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['ai/test-coop-typed-wave-save.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js',
  'gameObjectSerialization.js', 'options/save.js', 'options/gamestart.js', 'options/gameObjectVariables.js',
  'options/actionManager.js', 'nextTurn.js', 'player.js', 'ai/players.js', 'ai/wave-composition.js', 'ai/wave-config.js',
  'ai/wave-placement.js', 'sprites/entities/buildings/demonPortal.js', 'ai/generateMap.js', 'ai/coop-valley-plan.js',
  'ai/coop-map-scaling.js', 'menu/menu.js', 'sprites/elements/checkBox.js', 'index.html'];
const OUTPUTS = ['checkpoints.json', 'continuation-ledgers.json', 'phase-checkpoints.json', 'source-identities.json',
  'negative-controls.json', 'snapshots'];
const LAST_ROUND = 36;
const PORTAL_HP = 30;

// Independent literal oracle (not read from ai/wave-config.js).
const LITERAL_STEPS = {
  normal: [[4, 'imp'], [8, 'clawling'], [12, 'hound']],
  ranged: [[8, 'spitter'], [12, 'emberArcher'], [16, 'hexcaster']],
  heavy: [[8, 'brute'], [12, 'bulwark']],
  highTier: [[12, 'ravager'], [16, 'demonLord']]
};
function literalType(category, round) {
  if (round === 0 || round % 4 !== 0) return null;
  let type = null;
  for (const [from, name] of LITERAL_STEPS[category]) if (round >= from) type = name;
  return type;
}
function literalNext(category, completed) {
  for (let round = completed + 1; ; round++) {
    const type = literalType(category, round);
    if (type) return {round, type, roundsRemaining: round - completed};
  }
}

// Mutations run at the start of a loop round (first human turn, gameRound = round - 1).
// Blocks put a demon on the portal for that round's wave; the fixture kills every
// live demon after each round. Human units cannot stay on portal cells in play.
const PLANS = {
  solo: {humans: 1, terminal: 'victory',
    mutations: {3: [['damage', 'highTier', 0, 7], ['damage', 'normal', 0, 2]], 8: [['block', 'ranged', 0]],
      13: [['destroy', 'heavy', 0]], 32: [['block', 'normal', 0]]},
    counts: {4: 1, 8: 2, 12: 4, 16: 3, 20: 3, 24: 3, 28: 3, 32: 2, 36: 3}},
  h10: {humans: 10, terminal: 'defeat',
    mutations: {3: [['destroy', 'normal', 0], ['damage', 'heavy', 2, 11], ['damage', 'highTier', 3, 29]],
      4: [['block', 'normal', 1]], 8: [['block', 'ranged', 0], ['block', 'ranged', 1]], 11: [['destroy', 'heavy', 0]],
      12: [['block', 'heavy', 1]], 31: [['destroy', 'ranged', 2]], 32: [['block', 'highTier', 0], ['block', 'highTier', 1]]},
    counts: {4: 8, 8: 27, 12: 37, 16: 38, 20: 38, 24: 38, 28: 38, 32: 35, 36: 37}}
};
// Human points are the turn-start save (saveManager.save); phase points are the
// dispatcher boundary before the stage runs ('complete' is recorded after it).
const SAVE_POINTS = [
  {id: 'r4-last-human-before-wave', kind: 'human', gameRound: 3, player: 'last'},
  {id: 'r4-before-wave', kind: 'phase', round: 4, stage: 'wave'},
  {id: 'r4-after-committed-wave', kind: 'phase', round: 4, stage: 'demon'},
  {id: 'r8-before-tier', kind: 'phase', round: 8, stage: 'wave'},
  {id: 'r8-after-tier', kind: 'phase', round: 8, stage: 'complete'},
  {id: 'r32-before-tier', kind: 'phase', round: 32, stage: 'wave'},
  {id: 'r32-after-tier', kind: 'human', gameRound: 32, player: 'first'}
];
const POINTS = Object.fromEntries(SAVE_POINTS.map(p => [p.id, p]));
const CASES = [...SAVE_POINTS.map(p => ({id: p.id, point: p.id, variant: 'resume'})),
  {id: 'reload-x3-same-realm', point: 'r4-before-wave', variant: 'reload-x3'},
  {id: 'chain-resave', point: 'r4-after-committed-wave', variant: 'chain'},
  {id: 'replayed-committed-stage', point: 'r4-after-committed-wave', variant: 'replay-stage'}];
// Each named negative control must fail on exactly this checkpoint.
const FAULTS = {
  'drop-typed-wave-marker': {scenario: 'solo', case: 'r4-after-committed-wave',
    marker: 'solo-r4-after-committed-wave-restore-markers',
    description: 'saved gameSettings.coop.typedWaves is stripped from the committed-wave save'},
  'drop-portal-category': {scenario: 'h10', case: 'r8-before-tier', marker: 'h10-r8-before-tier-restore-portal-ledger',
    description: 'saved portal categories are stripped before load'},
  'phantom-portal': {scenario: 'h10', case: 'r32-before-tier', marker: 'h10-r32-before-tier-restore-portal-ledger',
    description: 'a destroyed portal is re-added to the saved external registry'},
  'undo-across-phase': {scenario: 'h10', case: 'r4-after-committed-wave',
    marker: 'h10-r4-after-committed-wave-restore-undo-scope',
    description: 'the load skips GameManager.load, keeping a pre-load undo action across the committed demon phase'},
  'replay-committed-wave': {scenario: 'solo', case: 'replayed-committed-stage',
    marker: 'solo-replayed-committed-stage-no-repeated-wave',
    description: 'the resumed runtime forgets the committed typed-wave marker before a duplicate dispatch with free portals'}
};

function parseArgs(argv) {
  const value = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const args = {outputDir: value('--output-dir'), scenario: value('--scenario'), fault: value('--fault')};
  if (!args.outputDir) throw new Error('--output-dir DIR is required');
  if (args.scenario !== undefined && !PLANS[args.scenario]) throw new Error('unknown --scenario');
  if (args.fault !== undefined && (!FAULTS[args.fault] || FAULTS[args.fault].scenario !== args.scenario))
    throw new Error('--fault requires a known fault and its --scenario');
  if (args.scenario !== undefined && args.fault === undefined) throw new Error('--scenario is only for negative controls');
  return args;
}

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const byCoord = (a, b) => a.x - b.x || a.y - b.y;
const compact = value => { const text = JSON.stringify(value); return text === undefined || text.length <= 3000 ? value : {sha256: sha(text), bytes: text.length}; };
// Normalized gameplay snapshot: per-player timers are clock UI, not gameplay.
function normalize(json) {
  const game = JSON.parse(json);
  delete game.timers;
  return JSON.stringify(game);
}

class CheckpointFailure extends Error {}

const MANAGER = `{clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
  updateCameraBorders() {}}`;
// Test-only stubs for UI, timers and the save slot; production dispatch is untouched.
// Demon combat tie-breaks use Math.random, so each demon phase reseeds it from
// its round: continuations need the same stream without persisting RNG state.
const INSTRUMENT = `(() => {
  border.createLine = () => {}; attackBorder.createLine = () => {}
  gameEvent.nextTurn = () => {}
  timer = {pauseAndSaveTime() {}, setNextTurnTime() {}, toJSON() { return {type: 'fixture', time: 0} }}
  nextTurnPauseInterface = {visible: false}
  AiRuntime.trainFromHumanCommands = () => {}
  if (globalThis.instrumented) return
  globalThis.instrumented = true
  globalThis.ends = 0; menuBack = () => { ends++; gameExit = true }
  globalThis.saveManager = {save() { hostEvent('human', {round: gameRound, player: whooseTurn}, JSON.stringify(getGameObject())) }}
  const spawn = spawnCoopWave
  spawnCoopWave = function(round) {
    const phase = gameSettings.coop.localPhase
    const portals = external.filter(p => p.isDemonPortal && !p.killed).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category ?? null,
      occupant: grid.getUnit(p.coord).isEmpty() ? null : grid.getUnit(p.coord).playerColor})).sort((a, b) => a.x - b.x || a.y - b.y)
    const placed = spawn.apply(this, arguments)
    hostEvent('wave', {round, gameRound, dispatcher: !!phase && phase.stage === 'wave' && phase.round === round, portals,
      result: placed, typedWaves: gameSettings.coop.typedWaves || null}, null)
    return placed
  }
  const step = advanceCoopLocalPhase
  advanceCoopLocalPhase = function() {
    const phase = gameSettings.coop.localPhase
    hostEvent('phase', {round: phase.round, stage: phase.stage, gameRound, turn: whooseTurn}, JSON.stringify(getGameObject()))
    const value = step.apply(this, arguments)
    // The completed stage is never stepped again; record the boundary after it.
    if (phase.stage === 'complete')
      hostEvent('phase', {round: phase.round, stage: phase.stage, gameRound, turn: whooseTurn}, JSON.stringify(getGameObject()))
    return value
  }
  const play = DemonPlayer.prototype.play
  DemonPlayer.prototype.play = function() {
    let seed = Math.imul(gameSettings.coop.localPhase.round, 2654435761) >>> 0
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    hostEvent('demon', {round: gameSettings.coop.localPhase.round,
      units: this.units.filter(u => !u.killed).map(u => ({type: u.name, x: u.coord.x, y: u.coord.y, hp: u.hp})).sort((a, b) => a.x - b.x || a.y - b.y)}, null)
    return play.call(this)
  }
})(); undefined`;
const LIVE_STATE = `(() => {
  const coop = gameSettings.coop, at = (a, b) => a.x - b.x || a.y - b.y
  const completed = coop.typedWaves ? coop.typedWaves.lastRound : gameRound
  const portals = external.filter(p => p.isDemonPortal && !p.killed).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category ?? null,
    hp: p.hp, owner: p.playerColor, registered: grid.getBuilding(p.coord) === p,
    occupant: grid.getUnit(p.coord).isEmpty() ? null : grid.getUnit(p.coord).playerColor})).sort(at)
  let gridPortalCells = 0
  for (const column of grid.arr) for (const cell of column) if (cell.building.isDemonPortal) gridPortalCells++
  return {markers: {gameRound, whooseTurn, localPhase: coop.localPhase ? {...coop.localPhase} : null,
      typedWaves: coop.typedWaves ? {...coop.typedWaves} : null, result: coop.result ?? null, gameExit},
    portals, gridPortalCells,
    preview: portals.map(p => ({x: p.x, y: p.y, ...(p.category ? getCoopNextScheduledProduction(p.category, completed) : {error: 'no-category'})})),
    demons: players[coop.demonSlot].units.filter(u => !u.killed).map(u => ({type: u.name, x: u.coord.x, y: u.coord.y, hp: u.hp})).sort(at),
    humansAlive: coop.humanSlots.filter(s => !players[s].isLost)}
})()`;

function newRealm() {
  const f = createFixture(undefined, () => {});
  // GameManager.load detaches menu listeners and resets the canvas transform and
  // map depth layer (index.html globals); the headless fixture has no listeners or 2D context.
  f.context.document.removeEventListener = () => {};
  f.evaluate(`if (typeof mainCtx === 'undefined') globalThis.mainCtx = {setTransform() {}}
    if (typeof nextTurnPauseInterface === 'undefined') globalThis.nextTurnPauseInterface = {visible: false}
    if (typeof mapDepth === 'undefined') globalThis.mapDepth = {bounds: {left: 0, right: 1, top: 0, bottom: 1}, rebuild() {}}; undefined`);
  const run = {f, ev: source => f.evaluate(source), events: [], captures: {}, captureSpec: {}};
  f.context.hostEvent = (kind, data, json) => {
    const event = {kind, ...JSON.parse(JSON.stringify(data))};
    if (json != null) event.sha256 = sha(normalize(json));
    run.events.push(event);
    const key = kind === 'phase' ? `phase:${event.round}:${event.stage}` : kind === 'human' ? `human:${event.round}:${event.player}` : null;
    if (key && run.captureSpec[key]) {
      // A resumed runtime re-emits a pending phase boundary, but not a started human turn or a completed phase.
      const reEmitted = kind === 'phase' && event.stage !== 'complete';
      run.captures[run.captureSpec[key]] = {json, eventIndex: run.events.length - (reEmitted ? 1 : 0),
        live: run.ev(LIVE_STATE)};
    }
  };
  return run;
}

function runScenario(name, fault, out, results) {
  const plan = PLANS[name], humans = plan.humans;
  const checkpoints = [];
  const result = {name, humans, fault: fault || null, checkpoints, phaseCheckpoints: {}, cases: {}};
  results[name] = result;
  const check = (id, observed, expected, extra = {}) => {
    const pass = isDeepStrictEqual(observed, expected);
    checkpoints.push({scenario: name, name: id, pass, expected: compact(expected), observed: compact(observed), ...extra});
    if (!pass) {
      console.log(JSON.stringify({CHECKPOINT_FAILED: id, expected: compact(expected), observed: compact(observed)}));
      throw new CheckpointFailure(id);
    }
  };
  const snapDir = out && path.join(out, 'snapshots', name);
  const writeSnap = (file, json) => {
    if (!snapDir) return `snapshots/${name}/${file}`;
    fs.mkdirSync(snapDir, {recursive: true});
    fs.writeFileSync(path.join(snapDir, file), JSON.stringify(JSON.parse(json), null, 1) + '\n');
    return `snapshots/${name}/${file}`;
  };
  const t0 = Date.now();
  try {
    // Co-op menu defaults read from source: size slider index, seed slider value, fog checkbox mark.
    const menu = fs.readFileSync(path.join(ROOT, 'menu/menu.js'), 'utf8');
    const checkBox = fs.readFileSync(path.join(ROOT, 'sprites/elements/checkBox.js'), 'utf8');
    const sizeIndex = Number((menu.match(/\['Tiny', 'Normal', 'Big'\]\[value\],\s*undefined, (\d+),/) || [])[1]);
    const coopTree = menu.slice(menu.indexOf('class CoopSettingsTree'));
    const defaults = {size: ['tiny', 'normal', 'big'][sizeIndex], seed: Number((coopTree.match(/this\.mapSlider\.value = (\d+)/) || [])[1]),
      fogOfWar: (checkBox.match(/this\.mark = (true|false)/) || [])[1] === 'true'};
    check(`${name}-menu-defaults`, defaults, {size: 'normal', seed: 1, fogOfWar: false});
    result.defaults = defaults;

    // Uninterrupted baseline with captures.
    const base = newRealm();
    for (const p of SAVE_POINTS) {
      const player = p.player === 'last' ? humans : 1;
      base.captureSpec[p.kind === 'phase' ? `phase:${p.round}:${p.stage}` : `human:${p.gameRound}:${player}`] = p.id;
    }
    const genStart = Date.now();
    base.ev(`globalThis.generated = generateCoopGame(${humans}, {size: '${defaults.size}', seed: ${defaults.seed}}); undefined`);
    result.generation = base.ev('JSON.parse(JSON.stringify(generated.coop.generation))');
    result.generatedMapSha256 = sha(base.ev('JSON.stringify(generated)'));
    result.generationMs = Date.now() - genStart;
    base.ev(`generated.start(${MANAGER}, false); isFogOfWar = ${defaults.fogOfWar}; gameSettings.isOnline = false
      whooseTurn = 1; actionManager.clear(); undefined`);
    base.ev(INSTRUMENT);
    result.runtime = base.ev(`({suddenDeathRound, demonSlot: gameSettings.coop.demonSlot, humanSlots: gameSettings.coop.humanSlots,
      generationVersion: gameSettings.coop.generation.version, isFogOfWar, aiActionLimit: gameSettings.aiActionLimit ?? null})`);
    const demonSlot = result.runtime.demonSlot;
    check(`${name}-runtime-defaults`, {version: result.runtime.generationVersion, humans: result.runtime.humanSlots.length,
      suddenDeathRound: result.runtime.suddenDeathRound, fog: result.runtime.isFogOfWar, aiActionLimit: result.runtime.aiActionLimit},
    {version: 4, humans, suddenDeathRound: 40, fog: false, aiActionLimit: null});

    const model = base.ev(`external.filter(p => p.isDemonPortal).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category}))`).sort(byCoord);
    check(`${name}-portal-model`, {total: model.length, perCategory: Object.fromEntries(Object.keys(LITERAL_STEPS)
      .map(c => [c, model.filter(p => p.category === c).length]))},
    {total: 4 * humans, perCategory: {normal: humans, ranged: humans, heavy: humans, highTier: humans}});
    const ofCategory = (c, i) => model.filter(p => p.category === c)[i];
    result.portalModel = model;

    // Literal portal state after the mutations of rounds <= loopRound.
    function literalPortals(loopRound) {
      const state = model.map(p => ({...p, alive: true, hp: PORTAL_HP}));
      for (let r = 1; r <= loopRound; r++) for (const [op, c, i, n] of plan.mutations[r] || []) {
        const p = state.find(q => q.x === ofCategory(c, i).x && q.y === ofCategory(c, i).y);
        if (op === 'destroy') p.alive = false;
        if (op === 'damage') p.hp -= n;
      }
      return state.filter(p => p.alive);
    }
    const blockedAt = round => (plan.mutations[round] || []).filter(m => m[0] === 'block').map(([, c, i]) => ofCategory(c, i));
    const isBlocked = (p, round) => blockedAt(round).some(q => q.x === p.x && q.y === p.y);
    const literalSpawns = round => literalPortals(round).filter(p => !isBlocked(p, round) && literalType(p.category, round))
      .map(p => ({type: literalType(p.category, round), x: p.x, y: p.y}));

    function applyMutations(run, round) {
      for (const [op, c, i, n] of plan.mutations[round] || []) {
        const p = ofCategory(c, i), lit = `{x: ${p.x}, y: ${p.y}}`;
        if (op === 'destroy') run.ev(`grid.getBuilding(${lit}).kill(); undefined`);
        if (op === 'damage') run.ev(`grid.getBuilding(${lit}).hit(${n}); undefined`);
        if (op === 'block') run.ev(`new Imp(${p.x}, ${p.y}); undefined`);
      }
    }
    function postRound(run, round) {
      const row = run.ev(`(() => { const live = players[${demonSlot}].units.filter(u => !u.killed); const state = ${LIVE_STATE}
        live.forEach(u => u.kill()); return {...state, cleared: live.length, ends} })()`);
      run.events.push({kind: 'post-round', loopRound: round, ...row, sha256: sha(normalize(run.ev('JSON.stringify(getGameObject())')))});
    }
    function terminal(run) {
      if (plan.terminal === 'victory') run.ev(`external.filter(p => p.isDemonPortal && !p.killed).forEach(p => p.kill()); undefined`);
      else run.ev(`gameSettings.coop.humanSlots.forEach(s => { players[s].units.slice().forEach(u => u.kill()); players[s].towns.slice().forEach(t => t.destroy()) }); undefined`);
      run.ev('nextTurn(); undefined');
      run.terminal = run.ev(`({result: gameSettings.coop.result ?? null, exit: gameExit, ends, gameRound, whooseTurn})`);
      run.events.push({kind: 'terminal', ...run.terminal});
      run.finalJson = normalize(run.ev('JSON.stringify(getGameObject())'));
    }
    function drive(run, fromLoopRound, afterPostRound) {
      for (let round = fromLoopRound || 1; round <= LAST_ROUND; round++) {
        if (round !== fromLoopRound) applyMutations(run, round);
        let turns = 0;
        while (run.ev(`gameRound === ${round - 1} && !gameExit`)) {
          if (++turns > humans + 2) throw new Error(`${name} round ${round} dispatcher stalled`);
          run.ev('nextTurn(); undefined');
        }
        postRound(run, round);
        if (afterPostRound) afterPostRound(round);
      }
      terminal(run);
    }

    drive(base);
    const literalTerminal = {result: plan.terminal, exit: true, ends: 1, gameRound: LAST_ROUND};
    // Baseline literal checks: waves, human turns, portal ledgers, terminal state.
    for (let round = 1; round <= LAST_ROUND; round++) {
      const waves = base.events.filter(e => e.kind === 'wave' && e.round === round);
      const expected = literalSpawns(round);
      check(`${name}-baseline-round-${round}-wave`, waves.map(w => ({dispatcher: w.dispatcher, result: w.result, typedWaves: w.typedWaves})),
        [{dispatcher: true, result: {spawned: expected, skipped: 0}, typedWaves: {lastRound: round}}]);
      check(`${name}-baseline-round-${round}-literal-count`, expected.length, plan.counts[round] || 0);
      const post = base.events.find(e => e.kind === 'post-round' && e.loopRound === round);
      check(`${name}-baseline-round-${round}-portal-ledger`, post.portals.map(({x, y, category, hp, owner, registered}) => ({x, y, category, hp, owner, registered})),
        literalPortals(round).map(({x, y, category, hp}) => ({x, y, category, hp, owner: demonSlot, registered: true})));
    }
    const humansAlive = result.runtime.humanSlots;
    for (let g = 0; g <= LAST_ROUND; g++) {
      check(`${name}-baseline-gameRound-${g}-human-turns`, base.events.filter(e => e.kind === 'human' && e.round === g).map(e => e.player),
        g === 0 ? humansAlive.slice(1) : g === LAST_ROUND ? humansAlive.slice(0, 1) : humansAlive);
    }
    check(`${name}-baseline-terminal`, (({whooseTurn, ...t}) => t)(base.terminal), literalTerminal);
    result.baseline = {events: base.events, terminal: base.terminal, finalSha256: sha(base.finalJson),
      final: writeSnap('baseline-final.json', base.finalJson)};
    console.log(`BASELINE ${name} events=${base.events.length} waves=${base.events.filter(e => e.kind === 'wave').length} ` +
      `spawns=${base.events.filter(e => e.kind === 'wave').reduce((n, e) => n + e.result.spawned.length, 0)} terminal=${base.terminal.result}`);

    // Driver loop round containing a save point. The first human's turn at gameRound g
    // starts inside loop round g (before its post-round step); later humans play in g + 1.
    const pointPlayer = p => p.player === 'last' ? humansAlive.at(-1) : humansAlive[0];
    const loopRoundOf = p => p.kind === 'phase' ? p.round : pointPlayer(p) === humansAlive[0] ? p.gameRound : p.gameRound + 1;
    // Literal expectations at a save point.
    function literalAtPoint(p) {
      const R = p.kind === 'phase' ? p.round : p.gameRound + (p.player === 'last' ? 1 : 0);
      let markers;
      if (p.kind === 'human' && p.player === 'last') markers = {gameRound: R - 1, whooseTurn: humansAlive.at(-1), localPhase: null, typedWaves: {lastRound: R - 1}};
      else if (p.kind === 'human') markers = {gameRound: p.gameRound, whooseTurn: humansAlive[0], localPhase: null, typedWaves: {lastRound: p.gameRound}};
      else markers = {gameRound: R - 1, whooseTurn: demonSlot, localPhase: {round: R, stage: p.stage},
        typedWaves: {lastRound: p.stage === 'wave' ? R - 1 : R}};
      markers = {...markers, result: null, gameExit: false};
      const portals = literalPortals(loopRoundOf(p)).map(({x, y, category, hp}) => ({x, y, category, hp, owner: demonSlot, registered: true}));
      let occupied = null;
      if (p.stage === 'wave' || p.player === 'last') occupied = blockedAt(loopRoundOf(p)).map(({x, y}) => ({x, y})).sort(byCoord);
      if (p.stage === 'demon') occupied = [...blockedAt(p.round), ...literalSpawns(p.round)].map(({x, y}) => ({x, y})).sort(byCoord);
      const completed = markers.typedWaves.lastRound;
      const preview = portals.map(({x, y, category}) => ({x, y, ...literalNext(category, completed)}));
      const firstDispatch = p.kind === 'phase' ? (p.stage === 'wave' ? R : R + 1) : (p.player === 'last' ? R : p.gameRound + 1);
      const dispatches = [];
      for (let r = firstDispatch; r <= LAST_ROUND; r++) dispatches.push({round: r, spawned: plan.counts[r] || 0});
      return {markers, portals, occupied, preview, dispatches};
    }

    for (const p of SAVE_POINTS) {
      const capture = base.captures[p.id];
      check(`${name}-${p.id}-captured`, !!capture, true);
      const literal = literalAtPoint(p);
      result.phaseCheckpoints[p.id] = {point: p, eventIndex: capture.eventIndex, savedSha256: sha(capture.json),
        normalizedSha256: sha(normalize(capture.json)), bytes: capture.json.length, snapshot: writeSnap(`${p.id}-saved.json`, capture.json),
        observedAtSave: capture.live, literal};
      check(`${name}-${p.id}-baseline-save-state`, {markers: capture.live.markers,
        portals: capture.live.portals.map(({occupant, ...rest}) => rest), preview: capture.live.preview,
        occupied: literal.occupied && capture.live.portals.filter(q => q.occupant !== null).map(({x, y}) => ({x, y}))},
      {markers: literal.markers, portals: literal.portals, preview: literal.preview, occupied: literal.occupied});
    }

    // Restore a save in a fresh runtime (or reuse one) and check persisted state.
    function restore(caseId, json, expect, opts = {}) {
      const run = opts.run || newRealm();
      run.f.context.savedInput = json;
      run.ev(`actionManager.startAction('unit'); globalThis.preLoadUndo = actionManager.arr.length; loadFromJson(savedInput); undefined`);
      if (!opts.skipGameManagerLoad) run.ev('GameManager.load(); undefined');
      run.ev(INSTRUMENT);
      if (opts.checks === false) return run;
      const live = run.ev(LIVE_STATE);
      check(`${name}-${caseId}-restore-markers`, live.markers, expect.literal.markers);
      check(`${name}-${caseId}-restore-portal-ledger`,
        {literal: live.portals.map(({occupant, ...rest}) => rest), gridPortalCells: live.gridPortalCells, atSave: live.portals,
          occupied: expect.literal.occupied && live.portals.filter(q => q.occupant !== null).map(({x, y}) => ({x, y}))},
        {literal: expect.literal.portals, gridPortalCells: expect.literal.portals.length, atSave: expect.atSave.portals,
          occupied: expect.literal.occupied});
      check(`${name}-${caseId}-restore-next-production-preview`, live.preview, expect.literal.preview);
      check(`${name}-${caseId}-restore-next-production-preview-agrees`, live.preview, expect.atSave.preview);
      const before = normalize(run.ev('JSON.stringify(getGameObject())'));
      const undo = run.ev(`(() => { const afterLoad = actionManager.arr.length; let error = null
        try { actionManager.undo() } catch (e) { error = String(e.message) } return {preLoadUndo, afterLoad, error} })()`);
      const after = normalize(run.ev('JSON.stringify(getGameObject())'));
      check(`${name}-${caseId}-restore-undo-scope`, {...undo, undoNoop: before === after},
        {preLoadUndo: 1, afterLoad: 0, error: null, undoNoop: true});
      check(`${name}-${caseId}-restore-demons`, live.demons, expect.atSave.demons);
      check(`${name}-${caseId}-restore-snapshot-equal`, {sha256: sha(after), bytes: after.length},
        {sha256: sha(normalize(json)), bytes: normalize(json).length});
      return run;
    }
    function continueAndCompare(caseId, run, p, fromIndex, opts = {}) {
      run.events = [];
      drive(run, loopRoundOf(p), opts.afterPostRound);
      const literal = literalAtPoint(p);
      const observedEvents = opts.transformEvents ? opts.transformEvents(run.events) : run.events;
      const dispatches = observedEvents.filter(e => e.kind === 'wave').map(e => ({round: e.round, dispatcher: e.dispatcher, spawned: e.result.spawned.length}));
      check(`${name}-${caseId}-continuation-wave-dispatch`, dispatches, literal.dispatches.map(d => ({...d, dispatcher: true})));
      const expectedEvents = base.events.slice(fromIndex);
      const firstDifference = Array.from({length: Math.max(observedEvents.length, expectedEvents.length)}, (_, i) => i)
        .find(i => !isDeepStrictEqual(observedEvents[i], expectedEvents[i]));
      if (firstDifference !== undefined)
        console.log(JSON.stringify({FIRST_EVENT_DIFFERENCE: caseId, index: firstDifference,
          expected: compact(expectedEvents[firstDifference]), observed: compact(observedEvents[firstDifference])}));
      check(`${name}-${caseId}-continuation-ledgers`, observedEvents, expectedEvents);
      check(`${name}-${caseId}-continuation-human-turns`, observedEvents.filter(e => e.kind === 'human').map(e => [e.round, e.player]),
        expectedEvents.filter(e => e.kind === 'human').map(e => [e.round, e.player]));
      check(`${name}-${caseId}-continuation-final-snapshot`, {sha256: sha(run.finalJson), bytes: run.finalJson.length},
        {sha256: sha(base.finalJson), bytes: base.finalJson.length});
      check(`${name}-${caseId}-continuation-terminal`, (({whooseTurn, ...t}) => t)(run.terminal), literalTerminal);
      const record = {case: caseId, point: p.id, fromEventIndex: fromIndex, events: run.events.length, expectedEvents: expectedEvents.length,
        eventsEqual: true, dispatches, terminal: run.terminal, finalSha256: sha(run.finalJson),
        final: writeSnap(`${caseId}-final.json`, run.finalJson)};
      result.cases[caseId] = {...(result.cases[caseId] || {}), ...record};
      return record;
    }
    const expectFor = p => ({literal: literalAtPoint(p), atSave: base.captures[p.id].live});

    const faultCase = fault && FAULTS[fault].case;
    for (const c of CASES) {
      if (faultCase && c.id !== faultCase) continue;
      const tCase = Date.now();
      const p = POINTS[c.point], capture = base.captures[p.id];
      if (c.variant === 'resume') {
        let json = capture.json;
        if (fault === 'drop-typed-wave-marker') { const g = JSON.parse(json); delete g.gameSettings.coop.typedWaves; json = JSON.stringify(g); }
        if (fault === 'drop-portal-category') { const g = JSON.parse(json); g.external.forEach(e => { if (e.name === 'demonPortal') delete e.category; }); json = JSON.stringify(g); }
        if (fault === 'phantom-portal') {
          const g = JSON.parse(json), gone = ofCategory('ranged', 2);
          g.external.push({name: 'demonPortal', coord: {x: gone.x, y: gone.y}, hp: PORTAL_HP, wasHitted: false, ownerSlot: demonSlot, category: 'ranged'});
          json = JSON.stringify(g);
        }
        const run = restore(c.id, json, expectFor(p), {skipGameManagerLoad: fault === 'undo-across-phase'});
        writeSnap(`${c.id}-restored.json`, run.ev('JSON.stringify(getGameObject())'));
        continueAndCompare(c.id, run, p, capture.eventIndex);
      } else if (c.variant === 'reload-x3') {
        // Load, commit the round's wave, then reload the same save twice in the same runtime.
        const run = restore(c.id, capture.json, expectFor(p), {checks: false});
        run.ev('nextTurn(); undefined');
        check(`${name}-${c.id}-first-load-committed-wave`, run.ev('({gameRound, typedWaves: gameSettings.coop.typedWaves})'),
          {gameRound: p.round, typedWaves: {lastRound: p.round}});
        restore(c.id + '-second', capture.json, expectFor(p), {run, checks: false});
        restore(c.id, capture.json, expectFor(p), {run});
        continueAndCompare(c.id, run, p, capture.eventIndex);
      } else if (c.variant === 'chain') {
        // Resume, re-save at the next tier boundary from the resumed runtime, load that save.
        const next = POINTS['r8-before-tier'];
        const run = restore(c.id + '-first', capture.json, expectFor(p));
        run.captureSpec = {'phase:8:wave': 'chain'};
        continueAndCompare(c.id + '-first', run, p, capture.eventIndex);
        const resaved = run.captures.chain;
        check(`${name}-${c.id}-resave-equals-baseline-save`, {sha256: sha(normalize(resaved.json)), live: resaved.live},
          {sha256: sha(normalize(base.captures[next.id].json)), live: base.captures[next.id].live});
        writeSnap(`${c.id}-resaved-r8.json`, resaved.json);
        const second = restore(c.id, resaved.json, expectFor(next));
        continueAndCompare(c.id, second, next, base.captures[next.id].eventIndex);
      } else if (c.variant === 'replay-stage') {
        // The committed-wave save with its stage replayed as 'wave' must not spawn again. Right
        // after a wave every producing portal holds its own spawn, so the committed marker is
        // also probed after the round, when its demons are cleared and the portals are free:
        // a duplicate dispatch and a replayed saved wave stage must both be no-ops.
        const g = JSON.parse(capture.json);
        g.gameSettings.coop.localPhase.stage = 'wave';
        const json = JSON.stringify(g), expect = expectFor(p);
        const replayed = {literal: {...expect.literal, markers: {...expect.literal.markers, localPhase: {round: p.round, stage: 'wave'}}},
          atSave: expect.atSave};
        const run = restore(c.id, json, replayed);
        let firstEvents = null, probe = null;
        const afterPostRound = round => {
          if (round !== p.round) return;
          if (fault === 'replay-committed-wave') run.ev('delete gameSettings.coop.typedWaves; undefined');
          const mark = run.events.length, before = normalize(run.ev('JSON.stringify(getGameObject())'));
          const observed = run.ev(`(() => {
            const freeProducingPortals = external.filter(q => q.isDemonPortal && !q.killed && grid.getUnit(q.coord).isEmpty() &&
              getCoopScheduledDemonType(q.category, ${p.round})).length
            const duplicate = spawnCoopWave(${p.round})
            gameSettings.coop.localPhase = {round: ${p.round}, stage: 'wave'}; advanceCoopLocalPhase()
            const replayedStage = gameSettings.coop.localPhase.stage; delete gameSettings.coop.localPhase
            return {freeProducingPortals, duplicate, replayedStage, demons: players[${demonSlot}].units.filter(u => !u.killed).length}
          })()`);
          const after = normalize(run.ev('JSON.stringify(getGameObject())'));
          probe = {round, observed, stateUnchanged: before === after, events: run.events.splice(mark)};
          check(`${name}-${c.id}-no-repeated-wave`, {...observed, stateUnchanged: probe.stateUnchanged},
            {freeProducingPortals: literalPortals(p.round).filter(q => literalType(q.category, p.round)).length,
              duplicate: {spawned: [], skipped: 0}, replayedStage: 'demon', demons: 0, stateUnchanged: true});
        };
        continueAndCompare(c.id, run, p, capture.eventIndex, {afterPostRound, transformEvents: events => {
          firstEvents = events.slice(0, 2);
          check(`${name}-${c.id}-replayed-stage-noop`, firstEvents.map(e => e.kind === 'wave'
            ? {kind: e.kind, round: e.round, dispatcher: e.dispatcher, result: e.result, typedWaves: e.typedWaves}
            : {kind: e.kind, round: e.round, stage: e.stage}),
          [{kind: 'phase', round: p.round, stage: 'wave'},
            {kind: 'wave', round: p.round, dispatcher: true, result: {spawned: [], skipped: 0}, typedWaves: {lastRound: p.round}}]);
          const demon = events.find(e => e.kind === 'demon');
          check(`${name}-${c.id}-replayed-stage-demon-units`, demon.units, expect.atSave.demons);
          return events.slice(2);
        }});
        // The replayed stage adds one no-op wave dispatch; the probe's events are removed before comparison.
        result.cases[c.id].replayedStageEvents = firstEvents;
        result.cases[c.id].postRoundProbe = probe;
      }
      result.cases[c.id] = {...(result.cases[c.id] || {}), variant: c.variant, elapsedMs: Date.now() - tCase};
      console.log(`PASS case ${name}/${c.id} variant=${c.variant} elapsed_ms=${Date.now() - tCase}`);
    }
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof CheckpointFailure ? {checkpoint: error.message} : {message: String(error.stack || error)};
    throw error;
  } finally {
    result.elapsedMs = Date.now() - t0;
  }
  return result;
}

function sha256File(file) { return sha(fs.readFileSync(path.join(ROOT, file))); }
function headBlobSha(file) {
  try { return sha(execFileSync('git', ['show', `HEAD:${file}`], {cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']})); } catch { return null; }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.outputDir);
  fs.mkdirSync(out, {recursive: true});
  if (args.fault) {
    const results = {};
    try {
      runScenario(args.scenario, args.fault, null, results);
      console.error(`NOT-REJECTED fault ${args.fault}`);
      return 4;
    } catch (error) {
      fs.writeFileSync(path.join(out, 'fault-result.json'), JSON.stringify({fault: args.fault, spec: FAULTS[args.fault],
        failed: results[args.scenario] && results[args.scenario].checkpoints.filter(c => !c.pass), error: String(error.message)}, null, 2) + '\n');
      if (error instanceof CheckpointFailure) {
        console.error(`CHECKPOINT_FAILED ${error.message}`);
        return 1;
      }
      console.error(error.stack || error);
      return 3;
    }
  }
  const existing = OUTPUTS.filter(file => fs.existsSync(path.join(out, file)));
  if (existing.length) {
    console.error(`REFUSING to overwrite ${existing.join(', ')} in ${out}`);
    return 2;
  }
  const startedAt = new Date().toISOString();
  const identities = {head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
    node: process.version, algorithm: 'sha256', files: Object.fromEntries(SOURCES.map(file => [file, sha256File(file)]))};
  identities.differsFromHead = SOURCES.filter(file => headBlobSha(file) !== identities.files[file]);
  const results = {};
  let failure = null;
  for (const name of Object.keys(PLANS)) {
    try {
      const r = runScenario(name, undefined, out, results);
      console.log(`PASS scenario ${name} humans=${r.humans} cases=${Object.keys(r.cases).length} checkpoints=${r.checkpoints.length} elapsed_ms=${r.elapsedMs}`);
    } catch (error) {
      failure = failure || `${name}: ${error.message}`;
      console.error(`FAIL scenario ${name}: ${error instanceof CheckpointFailure ? error.message : error.stack}`);
    }
  }
  const negatives = [];
  for (const [fault, spec] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-controls', fault);
    const argv = [__filename, '--output-dir', dir, '--scenario', spec.scenario, '--fault', fault];
    const t = Date.now();
    const child = spawnSync(process.execPath, argv, {cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'stdout.log'), child.stdout);
    fs.writeFileSync(path.join(dir, 'stderr.log'), child.stderr);
    const rejected = child.status === 1 && child.stderr.includes(`CHECKPOINT_FAILED ${spec.marker}\n`);
    const row = {fault, ...spec, command: [process.execPath, ...argv.map(a => path.relative(ROOT, a) || a)].join(' '),
      exitStatus: child.status, signal: child.signal, stderr: child.stderr.trim(), rejected, elapsedMs: Date.now() - t};
    negatives.push(row);
    console.log(`${rejected ? 'REJECTED' : 'NOT-REJECTED'} negative-control ${fault} exit=${child.status} intended=${spec.marker} stderr=${JSON.stringify(child.stderr.trim())}`);
    if (!rejected) failure = failure || `negative control ${fault} was not rejected by ${spec.marker}`;
  }
  const allCheckpoints = Object.values(results).flatMap(s => s.checkpoints);
  const expectedCases = Object.keys(PLANS).length * (CASES.length);
  const passedCases = Object.values(results).reduce((n, s) => n + (s.status === 'passed' ? Object.keys(s.cases).filter(k => CASES.some(c => c.id === k)).length : 0), 0);
  if (!failure && passedCases !== expectedCases) failure = `completed cases ${passedCases}/${expectedCases}`;
  const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
  const after = Object.fromEntries(SOURCES.map(file => [file, sha256File(file)]));
  identities.unchangedDuringRun = isDeepStrictEqual(after, identities.files);
  identities.savedCheckpoints = Object.fromEntries(Object.entries(results).flatMap(([name, s]) =>
    Object.entries(s.phaseCheckpoints).map(([id, pc]) => [`${name}/${id}`, {snapshot: pc.snapshot, sha256: pc.savedSha256,
      fileSha256: sha256File(path.relative(ROOT, path.join(out, pc.snapshot)))}])));
  if (!identities.unchangedDuringRun) failure = failure || 'tested sources changed during the run';
  const summary = {startedAt, finishedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed', failure,
    node: process.version, cwd: process.cwd(), browser: null, lastRound: LAST_ROUND,
    checkpoints: allCheckpoints.length, failedCheckpoints: allCheckpoints.filter(c => !c.pass).map(c => c.name),
    cases: passedCases, expectedCases, negativeControls: negatives.length, rejectedNegativeControls: negatives.filter(n => n.rejected).length,
    literalSteps: LITERAL_STEPS, plans: PLANS, savePoints: SAVE_POINTS, caseList: CASES,
    disclosedSetup: ['UI, timer and save-slot hooks are stubbed; saveManager.save records a normalized getGameObject snapshot per human turn',
      'every live demon is killed after each completed round; scripted portal damage/destroy/demon-block mutations per plan',
      'Math.random is reseeded from the round at each demon phase (combat tie-breaks) so continuations share the stream',
      'normalization drops only the per-player timers field'],
    scenarios: Object.fromEntries(Object.entries(results).map(([k, s]) => [k, {status: s.status, humans: s.humans, defaults: s.defaults,
      generation: s.generation, generatedMapSha256: s.generatedMapSha256, generationMs: s.generationMs, runtime: s.runtime,
      cases: Object.keys(s.cases).length, elapsedMs: s.elapsedMs, error: s.error || null}]))};
  write('checkpoints.json', {summary, negativeControls: negatives, checkpoints: allCheckpoints});
  write('continuation-ledgers.json', Object.fromEntries(Object.entries(results).map(([k, s]) => [k, {baseline: s.baseline || null, cases: s.cases}])));
  write('phase-checkpoints.json', Object.fromEntries(Object.entries(results).map(([k, s]) => [k, s.phaseCheckpoints])));
  write('negative-controls.json', negatives);
  write('source-identities.json', identities);
  if (failure) {
    console.error(`FAIL typed-wave-save ${failure}`);
    return 1;
  }
  const s = summary.scenarios;
  console.log(`PASS typed-wave-save scenarios=solo,h10 cases=${passedCases}/${expectedCases} checkpoints=${allCheckpoints.length} ` +
    `negative_controls=${summary.rejectedNegativeControls}/${negatives.length} solo_ms=${s.solo.elapsedMs} h10_ms=${s.h10.elapsedMs}`);
  return 0;
}

process.exitCode = main();
