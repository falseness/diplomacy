'use strict';
// TASK-153: typed four-round waves through the real local co-op dispatcher.
// Generated Tiny seed-0 maps (H1, H10) are played by idle humans through
// nextTurn(); production wave generation, placement, demon AI and the shared
// result run unmodified. Instrumentation only observes, except where a named
// scenario mutation or --fault says otherwise. Between rounds the fixture kills
// every live demon so each wave's expected group is a literal function of the
// portal model below.
//
// usage: node ai/test-coop-synchronized-waves.js --output-dir DIR
//        node ai/test-coop-synchronized-waves.js --output-dir DIR --scenario h1|h10 [--fault NAME]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const {createFixture} = require('./test-coop-harness');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['nextTurn.js', 'player.js', 'ai/wave-composition.js', 'ai/wave-config.js',
  'ai/wave-placement.js', 'sprites/entities/buildings/demonPortal.js', 'ai/generateMap.js',
  'ai/coop-valley-plan.js', 'ai/coop-map-scaling.js', 'options/gamestart.js', 'gameObjectSerialization.js',
  'ai/test-coop-synchronized-waves.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js'];
const OUTPUTS = ['checkpoints.json', 'round-ledger.json', 'spawn-ledger.json',
  'duplicate-phase-checkpoints.json', 'source-identities.json', 'negative-controls.json'];
const SCENARIOS = {h1: {humans: 1}, h10: {humans: 10}};
// Each named negative control must fail on exactly this checkpoint.
const FAULTS = {
  trickle: {scenario: 'h1', marker: 'h1-round-5-spawn-selections',
    description: 'every completed round becomes a wave round (intermediate trickle spawning)'},
  backlog: {scenario: 'h10', marker: 'h10-round-17-demon-units',
    description: 'portals blocked at wave 16 spawn their skipped wave on round 17 after being cleared'},
  'duplicate-dispatch': {scenario: 'h10', marker: 'h10-duplicate-round-8-same-round-noop',
    description: 'the dispatched-round record is dropped before a duplicate dispatcher call'},
  'absence-victory': {scenario: 'h1', marker: 'h1-round-1-shared-result',
    description: 'shared result declares victory whenever no demon is alive, ignoring live portals'}
};

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
// Literal spawn counts per completed round (missing rounds expect 0).
// H10: wave 16 loses one destroyed + one human-blocked normal and heavy portal
// plus the demon-blocked ranged and highTier portals (both already producing);
// wave 24 blocks every surviving portal; two portals stay destroyed afterwards.
const LITERAL_COUNTS = {
  h1: {4: 1, 8: 3, 12: 4, 16: 4, 20: 4, 24: 4, 28: 4, 32: 4, 36: 4, 40: 4},
  h10: {4: 10, 8: 30, 12: 40, 16: 34, 20: 38, 24: 0, 28: 38, 32: 38, 36: 38, 40: 38}
};

function parseArgs(argv) {
  const value = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const args = {outputDir: value('--output-dir'), scenario: value('--scenario'), fault: value('--fault')};
  if (!args.outputDir) throw new Error('--output-dir DIR is required');
  if (args.scenario !== undefined && !SCENARIOS[args.scenario]) throw new Error('unknown --scenario');
  if (args.fault !== undefined && (!FAULTS[args.fault] || !args.scenario)) throw new Error('--fault requires a known fault and --scenario');
  return args;
}

class CheckpointFailure extends Error {}
function createChecks(scenario) {
  const rows = [];
  function check(name, observed, expected) {
    const pass = isDeepStrictEqual(observed, expected);
    rows.push({scenario, name, pass, expected, observed});
    if (!pass) {
      console.log(JSON.stringify({CHECKPOINT_FAILED: name, expected, observed}));
      throw new CheckpointFailure(name);
    }
  }
  return {rows, check};
}

const byCoord = (a, b) => a.x - b.x || a.y - b.y;

function runScenario(name, fault, out) {
  const {humans} = SCENARIOS[name];
  const {rows: checkpoints, check} = createChecks(name);
  const roundLedger = [], spawnLedger = [], duplicateLedger = [];
  const result = {name, humans, checkpoints, roundLedger, spawnLedger, duplicateLedger, fault: fault || null};
  const t0 = Date.now();
  const f = createFixture(undefined, () => {});
  const ev = source => f.evaluate(source);
  try {
    ev(`globalThis.generated = generateCoopGame(${humans}, {size: 'tiny', seed: 0}); undefined`);
    result.generation = ev('JSON.parse(JSON.stringify(generated.coop.generation))');
    result.generatedMapSha256 = crypto.createHash('sha256').update(ev('JSON.stringify(generated)')).digest('hex');
    ev(`(() => {
      generated.start({clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
        updateCameraBorders() {}}, false)
      whooseTurn = 1; actionManager.clear()
      globalThis.runtimeSuddenDeathRound = suddenDeathRound
      border.createLine = () => {}; attackBorder.createLine = () => {}
      gameSettings.isOnline = false; gameSettings.aiActionLimit = 0
      gameEvent.nextTurn = () => {}
      timer = {pauseAndSaveTime() {}, setNextTurnTime() {}}
      nextTurnPauseInterface = {visible: false}
      AiRuntime.trainFromHumanCommands = () => {}
      globalThis.ends = 0; menuBack = () => { ends++; gameExit = true }
      globalThis.trace = [{type: 'human', round: 0, player: 1}]
      globalThis.saveManager = {save() { trace.push({type: 'human', round: gameRound, player: whooseTurn}) }}
      globalThis.waveCalls = []; globalThis.waveDepth = 0; globalThis.duringWave = null
      const spawn = spawnCoopWave
      spawnCoopWave = function(round) {
        const phase = gameSettings.coop.localPhase
        waveDepth++
        try {
          const row = {round, gameRound, turn: whooseTurn, depth: waveDepth,
            dispatcher: waveDepth === 1 && !!phase && phase.stage === 'wave' && phase.round === round,
            portals: external.filter(p => p.isDemonPortal).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category,
              occupant: grid.getUnit(p.coord).isEmpty() ? null : grid.getUnit(p.coord).playerColor})).sort((a, b) => a.x - b.x || a.y - b.y)}
          trace.push({type: row.dispatcher ? 'wave' : 'wave-duplicate', round})
          const placed = spawn.apply(this, arguments)
          row.result = JSON.parse(JSON.stringify(placed))
          row.typedWaves = gameSettings.coop.typedWaves ? {...gameSettings.coop.typedWaves} : null
          waveCalls.push(row)
          if (row.dispatcher && duringWave) duringWave(round)
          return placed
        } finally { waveDepth-- }
      }
      globalThis.demonPhases = []
      const play = DemonPlayer.prototype.play
      DemonPlayer.prototype.play = function() {
        demonPhases.push({round: gameSettings.coop.localPhase.round, stage: gameSettings.coop.localPhase.stage,
          units: this.units.filter(u => !u.killed).map(u => ({type: u.name, x: u.coord.x, y: u.coord.y})).sort((a, b) => a.x - b.x || a.y - b.y)})
        trace.push({type: 'demon', round: gameSettings.coop.localPhase.round})
        return play.call(this)
      }
      const neutral = players[0].nextTurn.bind(players[0])
      players[0].nextTurn = () => { neutral(); trace.push({type: 'complete', round: gameRound}) }
    })()`);
    result.runtime = ev(`({suddenDeathRound: runtimeSuddenDeathRound, demonSlot: gameSettings.coop.demonSlot,
      humanSlots: gameSettings.coop.humanSlots, balanceVersion: gameSettings.coop.balanceVersion,
      generationVersion: gameSettings.coop.generation.version, combatController: DemonPlayer.name})`);
    if (result.runtime.suddenDeathRound <= 42) {
      // Flooding is outside this task; generated co-op maps keep the global default.
      ev('suddenDeathRound = 2000; undefined');
      result.disclosedSetup = `suddenDeathRound ${result.runtime.suddenDeathRound} -> 2000 so rounds 1..42 are flood-free`;
      console.log('SETUP ' + result.disclosedSetup);
    }
    const demonSlot = result.runtime.demonSlot;
    check(`${name}-version-4-runtime`, {generation: result.runtime.generationVersion, humans: result.runtime.humanSlots.length},
      {generation: 4, humans});

    // Portal model: runtime identities, independently tracked state.
    const model = ev(`external.filter(p => p.isDemonPortal).map(p => ({x: p.coord.x, y: p.coord.y, category: p.category}))`)
      .sort(byCoord).map(p => ({...p, alive: true, blocker: null}));
    const perCategory = Object.fromEntries(Object.keys(LITERAL_STEPS).map(c => [c, model.filter(p => p.category === c).length]));
    check(`${name}-portal-model`, {total: model.length, perCategory},
      {total: 4 * humans, perCategory: {normal: humans, ranged: humans, heavy: humans, highTier: humans}});
    const extraDemons = [];
    const alive = () => model.filter(p => p.alive);
    const eligible = () => model.filter(p => p.alive && !p.blocker);
    const ofCategory = (c, i) => model.filter(p => p.category === c)[i];
    const lit = p => `{x: ${p.x}, y: ${p.y}}`;

    function destroy(p) {
      ev(`grid.getBuilding(${lit(p)}).kill(); undefined`);
      p.alive = false;
    }
    function blockDemon(p) {
      ev(`new Imp(${p.x}, ${p.y}); undefined`);
      p.blocker = 'demon';
    }
    function blockHuman(p) {
      ev(`grid.getHexagon(${lit(p)}).sudoPaint(1); new Noob(${p.x}, ${p.y}); undefined`);
      p.blocker = 'human';
    }
    const mutations = {};
    if (name === 'h10') {
      mutations[6] = () => {
        // Eliminate the last human mid-cycle; portal cadence and counts stay fixed.
        ev('players[10].units.slice().forEach(u => u.kill()); players[10].towns.slice().forEach(t => t.destroy()); undefined');
        check('h10-eliminated-human-lost', ev('({lost: players[10].isLost, alive: gameSettings.coop.humanSlots.filter(s => !players[s].isLost)})'),
          {lost: true, alive: [1, 2, 3, 4, 5, 6, 7, 8, 9]});
        return ['eliminate human slot 10'];
      };
      mutations[16] = () => {
        const d = [ofCategory('normal', 0), ofCategory('heavy', 0)], dm = [ofCategory('ranged', 0), ofCategory('highTier', 0)],
          hm = [ofCategory('normal', 1), ofCategory('heavy', 1)];
        d.forEach(destroy); dm.forEach(blockDemon); hm.forEach(blockHuman);
        if (fault === 'backlog')
          f.context.backlogPortals = [...dm, ...hm].map(({x, y, category}) => ({x, y, category}));
        return [`destroy ${JSON.stringify(d.map(p => [p.x, p.y, p.category]))}`,
          `demon-block ${JSON.stringify(dm.map(p => [p.x, p.y, p.category]))}`,
          `human-block ${JSON.stringify(hm.map(p => [p.x, p.y, p.category]))}`];
      };
      mutations[17] = () => {
        for (const p of model.filter(p => p.blocker === 'human'))
          ev(`if (grid.getUnit(${lit(p)}).notEmpty() && grid.getUnit(${lit(p)}).playerColor === 1) grid.getUnit(${lit(p)}).kill(); undefined`);
        model.forEach(p => { p.blocker = null; });
        return ['clear human blockers (demon blockers were cleared with round-16 demons)'];
      };
      mutations[24] = () => { alive().forEach(blockDemon); return [`demon-block all ${alive().length} surviving portals`]; };
      mutations[25] = () => { model.forEach(p => { p.blocker = null; }); return ['blockers were cleared with round-24 demons']; };
    }
    if (name === 'h1') {
      mutations[41] = () => {
        // Objective not complete while any demon lives, even with every portal gone.
        const first = model[0];
        alive().forEach(destroy);
        ev(`new Imp(${first.x}, ${first.y}); undefined`);
        extraDemons.push({type: 'imp', x: first.x, y: first.y});
        return ['destroy all portals', `keep one live imp at ${first.x},${first.y}`];
      };
    }
    if (fault === 'trickle')
      ev(`isCoopTypedWaveRound = round => { if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Invalid wave round'); return round > 0 }; undefined`);
    if (fault === 'backlog')
      ev(`duringWave = round => { if (round === 17 && globalThis.backlogPortals) placeCoopWave(composeTypedCoopWave(16, backlogPortals)) }; undefined`);
    if (fault === 'absence-victory')
      ev(`Object.defineProperty(players[0].constructor.prototype, 'coopResult', {configurable: true, get() {
        return players[gameSettings.coop.demonSlot].units.some(u => !u.killed && u.hp > 0) ? null : 'victory' }}); undefined`);
    if (name === 'h10') {
      // In-dispatch duplicates: repeated generation and re-entrant turn advances.
      ev(`duringWave = (prior => round => { if (prior) prior(round); if (round === 12) {
        globalThis.nestedDuplicate = {spawn: JSON.parse(JSON.stringify(spawnCoopWave(12))), turnBefore: whooseTurn, roundBefore: gameRound}
        nextTurn(); offlineNextTurn()
        nestedDuplicate.turnAfter = whooseTurn; nestedDuplicate.roundAfter = gameRound
        nestedDuplicate.stage = gameSettings.coop.localPhase.stage } })(duringWave); undefined`);
    }

    function duplicateProbe(round) {
      const before = ev('JSON.stringify(getGameObject())');
      const callsBefore = ev('waveCalls.length');
      if (fault === 'duplicate-dispatch') ev('delete gameSettings.coop.typedWaves; undefined');
      const probes = [
        ['same-round', `spawnCoopWave(${round})`],
        ['earlier-wave-round', `spawnCoopWave(${round - 4})`],
        ['stale-intermediate-round', `spawnCoopWave(${round - 1})`],
        ['replayed-saved-wave-stage', `(() => { gameSettings.coop.localPhase = {round: ${round}, stage: 'wave'}; advanceCoopLocalPhase();
          const stage = gameSettings.coop.localPhase.stage; delete gameSettings.coop.localPhase; return {stage} })()`],
        ['completed-stage-controller', `(() => { gameSettings.coop.localPhase = {round: ${round}, stage: 'complete'}; advanceCoopLocalPhase();
          const stage = gameSettings.coop.localPhase.stage; delete gameSettings.coop.localPhase; return {stage} })()`]
      ];
      const observed = {};
      for (const [label, source] of probes) {
        observed[label] = ev(source);
        const demons = ev(`players[${demonSlot}].units.filter(u => !u.killed).length`);
        const row = {round, probe: label, source, observed: observed[label], demonUnitsAfter: demons};
        duplicateLedger.push(row);
        const expected = {'same-round': {spawned: [], skipped: 0}, 'earlier-wave-round': {spawned: [], skipped: 0},
          'stale-intermediate-round': {spawned: [], skipped: 0}, 'replayed-saved-wave-stage': {stage: 'demon'},
          'completed-stage-controller': {stage: 'complete'}}[label];
        const marker = `${name}-duplicate-round-${round}-${label === 'same-round' ? 'same-round-noop' : label}`;
        check(marker, {result: observed[label], demons}, {result: expected, demons: 0});
        row.checkpoint = marker; row.pass = true;
      }
      const calls = ev(`waveCalls.slice(${callsBefore}).map(c => ({round: c.round, spawned: c.result.spawned.length, typedWaves: c.typedWaves}))`);
      check(`${name}-duplicate-round-${round}-recorded-calls`, calls,
        [round, round - 4, round - 1, round].map(r => ({round: r, spawned: 0, typedWaves: {lastRound: round}})));
      check(`${name}-duplicate-round-${round}-state-unchanged`, ev('JSON.stringify(getGameObject())') === before, true);
      duplicateLedger.push({round, probe: 'summary', calls, stateUnchanged: true});
    }

    const expectedResultPending = {result: null, exit: false, ends: 0};
    const lastRound = name === 'h1' ? 41 : 40;
    for (let round = 1; round <= lastRound; round++) {
      const applied = mutations[round] ? mutations[round]() : [];
      const humansAlive = ev('gameSettings.coop.humanSlots.filter(s => !players[s].isLost)');
      const marks = ev('({trace: trace.length, calls: waveCalls.length, phases: demonPhases.length})');
      // Duplicate probes between rounds append their own trace rows.
      const firstHuman = ev(`trace.filter(e => e.type === 'human').at(-1)`);
      let turns = 0;
      while (ev(`gameRound === ${round - 1} && !gameExit`)) {
        if (++turns > humans + 1) throw new Error(`${name} round ${round} dispatcher stalled`);
        ev('nextTurn(); undefined');
      }
      const shared = ev('({result: gameSettings.coop.result, exit: gameExit, ends})');
      check(`${name}-round-${round}-shared-result`, shared, expectedResultPending);
      const calls = ev(`waveCalls.slice(${marks.calls})`);
      const dispatcher = calls.filter(c => c.dispatcher);
      check(`${name}-round-${round}-dispatch-once`,
        {humanTurns: turns, calls: dispatcher.length, rounds: dispatcher.map(c => c.round), gameRound: ev('gameRound')},
        {humanTurns: humansAlive.length, calls: 1, rounds: [round], gameRound: round});
      const segment = ev(`trace.slice(${marks.trace})`);
      const nested = name === 'h10' && round === 12;
      check(`${name}-round-${round}-phase-order`, {first: firstHuman, segment}, {
        first: {type: 'human', round: round - 1, player: humansAlive[0]},
        segment: [...humansAlive.slice(1).map(player => ({type: 'human', round: round - 1, player})),
          {type: 'wave', round}, ...(nested ? [{type: 'wave-duplicate', round}] : []),
          {type: 'demon', round}, {type: 'complete', round}, {type: 'human', round, player: humansAlive[0]}]});
      const call = dispatcher[0];
      const expectedEligible = eligible().map(({x, y, category}) => ({x, y, category}));
      const observedEligible = call.portals.filter(p => p.occupant === null).map(({x, y, category}) => ({x, y, category}));
      check(`${name}-round-${round}-eligible-group`, {eligible: observedEligible, alive: call.portals.length},
        {eligible: expectedEligible, alive: alive().length});
      const expectedSpawn = eligible().filter(p => literalType(p.category, round))
        .map(p => ({type: literalType(p.category, round), x: p.x, y: p.y}));
      check(`${name}-round-${round}-spawn-selections`, call.result, {spawned: expectedSpawn, skipped: 0});
      const literalCount = LITERAL_COUNTS[name][round] || 0;
      check(`${name}-round-${round}-literal-count`, {expected: expectedSpawn.length, observed: call.result.spawned.length},
        {expected: literalCount, observed: literalCount});
      const phases = ev(`demonPhases.slice(${marks.phases})`);
      const blockers = model.filter(p => p.alive && p.blocker === 'demon').map(p => ({type: 'imp', x: p.x, y: p.y}));
      check(`${name}-round-${round}-demon-units`, phases.map(p => p.units),
        [[...expectedSpawn, ...blockers, ...extraDemons].sort(byCoord)]);
      check(`${name}-round-${round}-dispatched-record`, call.typedWaves, {lastRound: round});
      for (const s of call.result.spawned) {
        const source = call.portals.find(p => p.x === s.x && p.y === s.y);
        const entry = {round, sourcePortal: source && {x: source.x, y: source.y, category: source.category},
          type: s.type, spawn: {x: s.x, y: s.y}, expectedType: source ? literalType(source.category, round) : null};
        spawnLedger.push(entry);
        check(`${name}-round-${round}-source-${s.x}-${s.y}`, {type: s.type, spawn: entry.spawn, occupantBefore: source && source.occupant},
          {type: entry.expectedType, spawn: {x: source.x, y: source.y}, occupantBefore: null});
      }
      if (nested) {
        const n = ev('nestedDuplicate');
        const expected = {spawn: {spawned: [], skipped: 0}, turnBefore: demonSlot, roundBefore: 11, turnAfter: demonSlot,
          roundAfter: 11, stage: 'wave'};
        duplicateLedger.push({round, probe: 'in-dispatch spawnCoopWave(12) + nextTurn() + offlineNextTurn()', observed: n, expected});
        check('h10-duplicate-round-12-in-dispatch', n, expected);
      }
      const cleared = extraDemons.length && round === 41 ? 0 :
        ev(`(() => { const live = players[${demonSlot}].units.filter(u => !u.killed); live.forEach(u => u.kill()); return live.length })()`);
      const afterClear = ev(`({result: players[0].coopResult, portals: external.filter(p => p.isDemonPortal && !p.killed).map(p => ({x: p.coord.x, y: p.coord.y})).sort((a, b) => a.x - b.x || a.y - b.y),
        demons: players[${demonSlot}].units.filter(u => !u.killed).length})`);
      check(`${name}-round-${round}-cleared-result-pending`, afterClear, {result: null,
        portals: alive().map(({x, y}) => ({x, y})), demons: round === 41 && name === 'h1' ? 1 : 0});
      roundLedger.push({scenario: name, round, waveRound: round % 4 === 0, mutations: applied, humansAlive,
        humanTurns: turns, dispatcherCalls: dispatcher.length, nestedCalls: calls.length - dispatcher.length,
        phaseOrder: segment.map(e => e.type), alivePortals: alive().length,
        eligiblePortals: expectedEligible, expectedCount: literalCount, observedCount: call.result.spawned.length,
        spawned: call.result.spawned, demonUnitsAtPhase: phases[0].units.length, sharedResult: shared,
        clearedDemons: cleared, resultAfterClear: afterClear.result});
      if (name === 'h10' && (round === 8 || round === 36)) duplicateProbe(round);
    }
    if (name === 'h1') {
      // Round 42: the last demon is gone and so are all portals -> real victory.
      ev(`players[${demonSlot}].units.filter(u => !u.killed).forEach(u => u.kill()); undefined`);
      const marks = ev('({calls: waveCalls.length, phases: demonPhases.length})');
      ev('nextTurn(); undefined');
      const final = ev(`({result: gameSettings.coop.result, exit: gameExit, ends, round: gameRound,
        calls: waveCalls.length - ${marks.calls}, phases: demonPhases.length - ${marks.phases}})`);
      check('h1-objective-completed-victory', final, {result: 'victory', exit: true, ends: 1, round: 41, calls: 0, phases: 0});
      roundLedger.push({scenario: name, round: 42, mutations: ['kill last imp'], objective: final});
    }
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof CheckpointFailure ? {checkpoint: error.message} : {message: String(error.stack || error)};
    throw Object.assign(error, {result});
  } finally {
    result.elapsedMs = Date.now() - t0;
    if (out) fs.writeFileSync(path.join(out, `scenario-${name}.json`), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex'); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.outputDir);
  fs.mkdirSync(out, {recursive: true});
  if (args.scenario) {
    try {
      const r = runScenario(args.scenario, args.fault, out);
      console.log(`PASS scenario ${args.scenario} checkpoints=${r.checkpoints.length}`);
      return 0;
    } catch (error) {
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
    node: process.version, files: Object.fromEntries(SOURCES.map(file => [file, sha256File(file)]))};
  const scenarios = {};
  let failure = null;
  for (const name of Object.keys(SCENARIOS)) {
    try {
      scenarios[name] = runScenario(name, undefined, out);
      console.log(`PASS scenario ${name} humans=${SCENARIOS[name].humans} rounds=${scenarios[name].roundLedger.length} ` +
        `checkpoints=${scenarios[name].checkpoints.length} spawns=${scenarios[name].spawnLedger.length} elapsed_ms=${scenarios[name].elapsedMs}`);
    } catch (error) {
      scenarios[name] = error.result || {name, status: 'failed', error: String(error.stack || error)};
      failure = failure || `${name}: ${error.message}`;
      console.error(`FAIL scenario ${name}: ${error.message}`);
    }
  }
  const negatives = [];
  for (const [fault, spec] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-controls', fault);
    const argv = [__filename, '--output-dir', dir, '--scenario', spec.scenario, '--fault', fault];
    const child = spawnSync(process.execPath, argv, {cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
    const rejected = child.status === 1 && child.stderr.includes(`CHECKPOINT_FAILED ${spec.marker}\n`);
    const row = {fault, scenario: spec.scenario, description: spec.description, command: [process.execPath, ...argv.map(a => path.relative(ROOT, a) || a)].join(' '),
      intendedCheckpoint: spec.marker, exitStatus: child.status, signal: child.signal, stderr: child.stderr.trim(), rejected};
    negatives.push(row);
    console.log(`${rejected ? 'REJECTED' : 'NOT-REJECTED'} negative-control ${fault} exit=${child.status} intended=${spec.marker} stderr=${JSON.stringify(child.stderr.trim())}`);
    if (!rejected) failure = failure || `negative control ${fault} was not rejected by ${spec.marker}`;
  }
  const allCheckpoints = Object.values(scenarios).flatMap(s => s.checkpoints || []);
  const summary = {startedAt, finishedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed', failure,
    checkpoints: allCheckpoints.length, failedCheckpoints: allCheckpoints.filter(c => !c.pass).map(c => c.name),
    negativeControls: negatives.length, rejectedNegativeControls: negatives.filter(n => n.rejected).length,
    literalCounts: LITERAL_COUNTS, literalSteps: LITERAL_STEPS,
    scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, s]) => [k, {status: s.status, humans: s.humans,
      generation: s.generation, generatedMapSha256: s.generatedMapSha256, runtime: s.runtime, disclosedSetup: s.disclosedSetup || null,
      rounds: (s.roundLedger || []).length, spawns: (s.spawnLedger || []).length, elapsedMs: s.elapsedMs, error: s.error || null}]))};
  const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
  write('checkpoints.json', {summary, negativeControls: negatives, checkpoints: allCheckpoints});
  write('round-ledger.json', Object.fromEntries(Object.entries(scenarios).map(([k, s]) => [k, s.roundLedger || []])));
  write('spawn-ledger.json', Object.fromEntries(Object.entries(scenarios).map(([k, s]) => [k, s.spawnLedger || []])));
  write('duplicate-phase-checkpoints.json', {h10: (scenarios.h10 && scenarios.h10.duplicateLedger) || [],
    checkpoints: allCheckpoints.filter(c => c.name.includes('duplicate'))});
  write('negative-controls.json', negatives);
  const after = Object.fromEntries(SOURCES.map(file => [file, sha256File(file)]));
  identities.unchangedDuringRun = isDeepStrictEqual(after, identities.files);
  write('source-identities.json', identities);
  if (!identities.unchangedDuringRun) failure = failure || 'tested sources changed during the run';
  if (failure) {
    console.error(`FAIL synchronized-waves ${failure}`);
    return 1;
  }
  const s = summary.scenarios;
  console.log(`PASS synchronized-waves scenarios=2 h1_rounds=${s.h1.rounds} h10_rounds=${s.h10.rounds} ` +
    `spawns=${s.h1.spawns + s.h10.spawns} checkpoints=${allCheckpoints.length} negative_controls=${negatives.length}/${negatives.length}`);
  return 0;
}

process.exitCode = main();
