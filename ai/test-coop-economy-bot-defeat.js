'use strict';
// TASK-159: co-op combat-defeat harness with the real economy bot in every human
// slot. Each game is a generated version-4 map (current rules, standard starting
// assets) started in a fresh child process; every human slot is constructed as
// SimpleAiPlayerWithEconomy through GameMap's playerType, so the production
// dispatcher (nextTurn) invokes the unchanged policy at the start of each human
// turn and the harness only ends the turn. Observers delegate to the original
// methods and record; they never assign results, rounds, hp or ownership.
//
// usage:
//   node ai/test-coop-economy-bot-defeat.js --output-dir DIR [--size tiny|normal|big]
//        [--humans 1,2,4] [--seeds 0,1] [--max-rounds 100] [--case-timeout-ms 600000]
//        [--case-hang-ms 3600000] [--calibrate] [--fault-cpu-bound]
//   node ai/test-coop-economy-bot-defeat.js --self-test --output-dir DIR
// Gate mode exits 0 only if every case is a real combat terminal defeat by the
// completed max round. Calibrate mode keeps every outcome and exits 0 unless an
// infrastructure failure (exception, timeout, integrity violation) occurred.
// --case-timeout-ms bounds each case child's own CPU time (the host is shared, so
// wall time measures contention); --case-hang-ms is only a parent wall-clock hang guard.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');
const {isDeepStrictEqual} = require('util');

const ROOT = path.resolve(__dirname, '..');
const SIZES = ['tiny', 'normal', 'big'];
const MAX_ROUNDS_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_HANG_MS = 3600000;
const FAULT_CPU_BOUND_MS = 1000;
const POLICY = 'SimpleAiPlayerWithEconomy';
const OUTCOMES = ['combat-defeat', 'non-combat-defeat', 'victory', 'draw', 'survival', 'late-terminal'];
const INFRASTRUCTURE = ['timeout', 'exception', 'integrity-failure', 'incomplete'];
// Hidden negative-control faults applied by the child after the named round.
const FAULTS = {
  'skip-turn-policy': {round: 1, marker: 'policy-not-replaced',
    description: 'every human slot gets an own no-op play (skip turn) instead of the economy policy'},
  'round-jump': {round: 2, marker: 'round-integrity', description: 'gameRound is advanced by 3 outside the neutral turn'},
  'assigned-result': {round: 2, marker: 'result-from-evaluator',
    description: 'the harness assigns gameSettings.coop.result = defeat and ends the game'},
  'combat-cheat': {round: 2, marker: 'removal-cause', description: 'human units and towns are removed directly, outside any action'},
  'stall-after-round': {round: 2, marker: 'case-hang', description: 'the child blocks forever (no CPU use) after completing round 2'},
  'throw-in-turn': {round: 2, marker: 'case-exception', description: 'the child throws after completing round 2'}
};

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
class UsageError extends Error {}
class IntegrityFailure extends Error {
  constructor(name, detail) { super(`${name}: ${detail}`); this.checkpoint = name; }
}
class CpuBoundExceeded extends Error {}
// process.cpuUsage and uptime count from process start, so boot and generation are included.
function usage() {
  const {user, system} = process.cpuUsage(), cpuSeconds = (user + system) / 1e6, wallSeconds = process.uptime();
  return {cpuSeconds, wallSeconds, cpuShare: cpuSeconds / wallSeconds};
}
function priority() {
  let autogroup = null;
  try { autogroup = fs.readFileSync('/proc/self/autogroup', 'utf8').trim(); } catch (error) { /* not Linux */ }
  return {autogroup, nice: require('os').getPriority()};
}

function parseList(text, name) {
  if (typeof text !== 'string' || !/^\d+(,\d+)*$/.test(text)) throw new UsageError(`invalid ${name}: ${text}`);
  const values = text.split(',').map(Number);
  if (new Set(values).size !== values.length) throw new UsageError(`duplicate value in ${name}: ${text}`);
  return values;
}

function parseArgs(argv) {
  const known = new Set(['--size', '--humans', '--seeds', '--max-rounds', '--case-timeout-ms', '--case-hang-ms', '--output-dir',
    '--self-test', '--calibrate', '--fault', '--fault-cpu-bound', '--child']);
  const flags = new Set(['--self-test', '--calibrate', '--fault-cpu-bound']);
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!known.has(name)) throw new UsageError(`unknown argument: ${name}`);
    if (flags.has(name)) { values[name] = true; continue; }
    if (i + 1 >= argv.length) throw new UsageError(`${name} requires a value`);
    values[name] = argv[++i];
  }
  if (values['--child'] !== undefined) return {child: JSON.parse(Buffer.from(values['--child'], 'base64').toString('utf8'))};
  const sizeText = values['--size'] === undefined ? 'tiny' : values['--size'];
  const sizes = typeof sizeText === 'string' ? sizeText.split(',') : [];
  const args = {
    size: sizeText, sizes,
    humans: parseList(values['--humans'] === undefined ? '1' : values['--humans'], '--humans'),
    seeds: parseList(values['--seeds'] === undefined ? '0' : values['--seeds'], '--seeds'),
    maxRounds: values['--max-rounds'] === undefined ? MAX_ROUNDS_LIMIT : Number(values['--max-rounds']),
    caseTimeoutMs: values['--case-timeout-ms'] === undefined ? DEFAULT_TIMEOUT_MS : Number(values['--case-timeout-ms']),
    caseHangMs: values['--case-hang-ms'] === undefined ? DEFAULT_HANG_MS : Number(values['--case-hang-ms']),
    outputDir: values['--output-dir'], selfTest: !!values['--self-test'], calibrate: !!values['--calibrate'],
    fault: values['--fault'] === undefined ? null : values['--fault'], faultCpuBound: !!values['--fault-cpu-bound']
  };
  if (!args.outputDir) throw new UsageError('--output-dir DIR is required');
  if (!sizes.length || sizes.some(size => !SIZES.includes(size))) throw new UsageError(`invalid --size: ${args.size}`);
  if (new Set(sizes).size !== sizes.length) throw new UsageError(`duplicate value in --size: ${args.size}`);
  if (args.humans.some(h => h < 1 || h > 12)) throw new UsageError('invalid --humans: each count must be 1..12');
  if (args.seeds.some(s => s > 0xffffffff)) throw new UsageError('invalid --seeds: unsigned 32-bit integers');
  if (!Number.isInteger(args.maxRounds) || args.maxRounds < 1 || args.maxRounds > MAX_ROUNDS_LIMIT)
    throw new UsageError(`invalid --max-rounds: integer 1..${MAX_ROUNDS_LIMIT}`);
  if (!Number.isInteger(args.caseTimeoutMs) || args.caseTimeoutMs < 1) throw new UsageError('invalid --case-timeout-ms');
  if (!Number.isInteger(args.caseHangMs) || args.caseHangMs < 1) throw new UsageError('invalid --case-hang-ms');
  if (args.selfTest && args.calibrate) throw new UsageError('--self-test and --calibrate are exclusive');
  if (args.fault !== null && !FAULTS[args.fault]) throw new UsageError(`unknown --fault: ${args.fault}`);
  if ((args.fault !== null || args.faultCpuBound) && args.selfTest) throw new UsageError('--fault is only for negative-control parents');
  return args;
}

// Pure outcome classification used by the parent for every case record.
function classifyOutcome(s) {
  const result = (classification, reason) => ({classification, reason, gatePass: classification === 'combat-defeat',
    infrastructure: INFRASTRUCTURE.includes(classification)});
  if (s.status === 'timeout') return result('timeout', s.timeoutKind === 'case-cpu-bound' ?
    `case-cpu-bound: ${s.cpuSeconds} CPU-s > ${s.cpuBoundSeconds} (wall ${s.wallSeconds} s) at ${JSON.stringify(s.lastPhase)}` :
    `${s.timeoutKind || 'case-timeout'} after ${s.elapsedMs} ms at ${JSON.stringify(s.lastPhase)}`);
  if (s.status === 'exception') return result('exception', `case-exception: ${s.error}`);
  if (s.integrityFailures && s.integrityFailures.length)
    return result('integrity-failure', s.integrityFailures.map(f => f.checkpoint).join(','));
  if (s.status !== 'completed') return result('incomplete', `status=${s.status}`);
  if (!s.terminal) return s.completedRound >= s.maxRounds ? result('survival', `nonterminal at completed round ${s.completedRound}`)
    : result('incomplete', `nonterminal at round ${s.completedRound} < ${s.maxRounds}`);
  if (!s.resultFromEvaluator) return result('integrity-failure', 'result-from-evaluator');
  if (s.completedRound > s.maxRounds) return result('late-terminal', `terminal at round ${s.completedRound}`);
  if (s.result === 'victory') return result('victory', 'humans survived every demon and portal');
  if (s.result === 'draw') return result('draw', 'humans and demons eliminated together');
  if (s.result !== 'defeat') return result('integrity-failure', `unknown result ${s.result}`);
  if (s.humanAssetsRemaining !== 0) return result('integrity-failure', `defeat with ${s.humanAssetsRemaining} human assets`);
  const causes = s.humanRemovalCauses || {};
  if (s.lastHumanRemovalCause !== 'unit-action' || (causes.flood || 0) > 0 || (causes.unattributed || 0) > 0)
    return result('non-combat-defeat', `last=${s.lastHumanRemovalCause} causes=${JSON.stringify(causes)}`);
  return result('combat-defeat', `defeat at completed round ${s.completedRound} by ${s.lastHumanRemovalActorRole} combat`);
}

// ---------------------------------------------------------------- child game
function installInstrumentation() {
  const events = globalThis.__events = [];
  const stack = [];
  const ids = new Map();
  let serial = 0;
  const describe = e => {
    if (!ids.has(e)) ids.set(e, ++serial);
    let role = null;
    try { role = e.player ? e.player.role : null; } catch (error) { role = null; }
    return {id: ids.get(e), owner: e.playerColor ?? null, role, kind: e.name, x: e.coord.x, y: e.coord.y, hp: e.hp,
      killed: !!e.killed};
  };
  globalThis.__describe = describe;
  const top = () => stack.length ? stack[stack.length - 1] : null;
  const inKind = kind => stack.some(c => c.kind === kind);
  const within = (context, fn) => { stack.push(context); try { return fn(); } finally { stack.pop(); } };
  const emit = event => events.push({round: gameRound, turn: whooseTurn, ...event});
  const cause = () => {
    const c = top();
    return {cause: c ? c.kind : 'unattributed', actor: c && c.actor || null, actorRole: c && c.role || null,
      legal: c && 'legal' in c ? c.legal : null};
  };
  const assets = p => ({gold: p.gold, income: p.income, units: p.units.filter(u => !u.killed).length,
    towns: p.towns.filter(t => !t.killed).length});

  // Presentation, persistence and training side effects only.
  gameEvent.nextTurn = () => {};
  timer.pauseAndSaveTime = () => {};
  timer.setNextTurnTime = () => {};
  nextTurnPauseInterface = {visible: false};
  globalThis.saveManager = {save() {}};
  AiRuntime.trainFromHumanCommands = () => {};
  globalThis.__terminal = null;
  // The production evaluator (NeutralPlayer.isGameEnded) sets coop.result; the
  // menu's only gameplay side effect is gameExit. The harness never sets a result.
  menuBack = () => {
    gameExit = true;
    __terminal = {round: gameRound, turn: whooseTurn, result: gameSettings.coop.result};
    emit({type: 'terminal', ...__terminal});
  };

  const coop = gameSettings.coop;
  let resultValue = coop.result === undefined ? null : coop.result;
  globalThis.__resultEvaluations = 0;
  Object.defineProperty(coop, 'result', {enumerable: true, configurable: true,
    get() { return resultValue; },
    set(value) {
      const evaluator = /isGameEnded/.test(new Error().stack.split('\n').slice(1, 4).join('\n'));
      if (evaluator) __resultEvaluations++;
      if (!evaluator || value !== resultValue) emit({type: 'result-set', value, previous: resultValue, evaluator});
      resultValue = value;
    }});

  const send = Unit.prototype.sendInstructions;
  Unit.prototype.sendInstructions = function(cell) {
    const role = this.player.role, destination = {x: cell.coord.x, y: cell.coord.y};
    const legal = this.getAvailableCommands().some(c => coordsEqually(c.destinationCoord, destination));
    const fogged = role === 'HUMAN' && isFogOfWar && !grid.fogOfWar[destination.x][destination.y];
    const controller = role === 'HUMAN' ? inKind('bot-play') : role === 'DEMONS' ? inKind('demon-play') : false;
    const context = {kind: 'unit-action', actor: describe(this), role, destination, legal, fogged, controller};
    const target = cell.unit.notEmpty() ? describe(cell.unit) :
      cell.building.notEmpty() ? {kind: cell.building.name, owner: cell.building.playerColor ?? null} : null;
    emit({type: 'unit-action', ...context, target});
    const movesBefore = this.moves;
    const result = within(context, () => send.call(this, cell));
    emit({type: 'unit-action-end', actor: describe(this), movesBefore, moves: this.moves});
    return result;
  };
  for (const proto of [Entity.prototype, Town.prototype]) {
    const hit = proto.hit;
    proto.hit = function(damage) {
      const target = describe(this), by = cause();
      const destroyed = hit.call(this, damage);
      emit({type: 'damage', ...by, target, damage, after: describe(this)});
      return destroyed;
    };
  }
  for (const proto of [Unit.prototype, Building.prototype, DemonPortal.prototype]) {
    const kill = proto.kill;
    proto.kill = function(...args) {
      const wasKilled = !!this.killed, target = describe(this), by = cause();
      const value = kill.apply(this, args);
      if (!wasKilled && this.killed) emit({type: 'removal', ...by, target});
      return value;
    };
  }
  const refresh = Player.prototype.nextTurn;
  Player.prototype.nextTurn = function(...args) {
    const owner = players.indexOf(this), goldBefore = this.gold;
    const value = within({kind: 'turn-refresh', owner, role: this.role}, () => refresh.apply(this, args));
    if (this.role === 'HUMAN') emit({type: 'economy-refresh', owner, goldBefore, gold: this.gold, income: this.income});
    return value;
  };
  globalThis.__advances = [];
  const neutralTurn = NeutralPlayer.prototype.nextTurn;
  NeutralPlayer.prototype.nextTurn = function(...args) {
    const from = gameRound;
    const value = within({kind: 'neutral-turn'}, () => neutralTurn.apply(this, args));
    __advances.push([from, gameRound]);
    emit({type: 'round-advance', from, to: gameRound});
    return value;
  };
  const flood = NeutralPlayer.prototype.floodCell;
  NeutralPlayer.prototype.floodCell = function(...args) { return within({kind: 'flood'}, () => flood.apply(this, args)); };
  globalThis.__plays = {};
  const policyPlay = SimpleAiPlayerWithEconomy.prototype.play;
  SimpleAiPlayerWithEconomy.prototype.play = function(...args) {
    const owner = players.indexOf(this);
    __plays[owner] = (__plays[owner] || 0) + 1;
    const before = assets(this);
    const value = within({kind: 'bot-play', owner, role: this.role}, () => policyPlay.apply(this, args));
    emit({type: 'bot-play', owner, role: this.role, lost: this.isLost, before, after: assets(this)});
    return value;
  };
  const demonPlay = DemonPlayer.prototype.play;
  DemonPlayer.prototype.play = function(...args) { return within({kind: 'demon-play', role: 'DEMONS'}, () => demonPlay.apply(this, args)); };
  // Kind of objective the demon AI chose (mirrors the building-first selection); counted, not changed.
  globalThis.__targetKinds = {};
  const bestTarget = BestEnemyTargetForAI.prototype.calculateBestEnemyTarget;
  BestEnemyTargetForAI.prototype.calculateBestEnemyTarget = function(v0, arr, color) {
    const coord = bestTarget.call(this, v0, arr, color);
    const player = players[color];
    if (player.role === 'DEMONS') {
      const cell = coord && arr[coord.x][coord.y];
      const b = cell && cell.building;
      const building = b && !player.ignoresObjective(cell) && b.notEmpty() && !player.isAlliedWith(b.player) &&
        (!b.isExternal || b.isDemonPortal) && !b.isNature;
      const kind = !cell ? 'none' : building ? `building:${b.name}:${b.player.role}${b.player.isLost ? ':lost-owner' : ''}` :
        `unit:${cell.unit.notEmpty() ? cell.unit.name + ':' + cell.unit.player.role : 'unknown'}`;
      __targetKinds[kind] = (__targetKinds[kind] || 0) + 1;
    }
    return coord;
  };
  let prepareDepth = 0;
  for (const proto of [PreparingManufacture.prototype, Town.prototype]) {
    const prepare = proto.prepare;
    proto.prepare = function(what) {
      if (prepareDepth) return prepare.call(this, what);
      const goldBefore = this.player.gold;
      let ok;
      prepareDepth++;
      try { ok = within({kind: 'economy-prepare', role: this.player.role}, () => prepare.call(this, what)); } finally { prepareDepth--; }
      emit({type: 'economy-prepare', owner: this.playerColor, role: this.player.role, controller: inKind('bot-play'),
        producer: describe(this), product: what, ok: !!ok, goldBefore, goldAfter: this.player.gold});
      return ok;
    };
  }
  const place = Town.prototype.sendInstructions;
  Town.prototype.sendInstructions = function(cell) {
    const product = this.activeProduction.name ?? null, goldBefore = this.player.gold;
    const legal = !!this.activeProduction.canCreateOnCell(cell, this);
    const value = within({kind: 'economy-placement', role: this.player.role}, () => place.call(this, cell));
    emit({type: 'economy-placement', owner: this.playerColor, role: this.player.role, controller: inKind('bot-play'),
      producer: describe(this), product, legal, destination: {x: cell.coord.x, y: cell.coord.y}, goldBefore,
      goldAfter: this.player.gold});
    return value;
  };
  const spawn = spawnCoopWave;
  spawnCoopWave = function(round, ...rest) {
    const portals = external.filter(p => p.isDemonPortal && !p.killed).map(p => ({...describe(p),
      category: p.category ?? null, occupied: grid.getUnit(p.coord).notEmpty()}));
    const placed = spawn.call(this, round, ...rest);
    const spawned = placed.spawned.map(s => {
      const portal = portals.find(p => p.x === s.x && p.y === s.y);
      const scheduled = portal && portal.category ? getCoopScheduledDemonType(portal.category, round) : null;
      return {...s, category: portal ? portal.category : null, scheduled, matchesSchedule: scheduled === s.type,
        unit: describe(grid.getUnit({x: s.x, y: s.y}))};
    });
    emit({type: 'wave', waveRound: round, portals, spawned, skipped: placed.skipped,
      typedWaves: gameSettings.coop.typedWaves ? {...gameSettings.coop.typedWaves} : null});
    return placed;
  };
  globalThis.__observe = () => JSON.stringify({round: gameRound, turn: whooseTurn, terminal: gameExit,
    result: gameSettings.coop.result ?? null, terminalEvent: __terminal, fog: isFogOfWar, suddenDeathRound,
    localPhase: gameSettings.coop.localPhase || null, typedWaves: gameSettings.coop.typedWaves || null,
    humans: gameSettings.coop.humanSlots.map(owner => {
      const p = players[owner], towns = p.towns.filter(t => !t.killed);
      return {owner, lost: p.isLost, policy: p.constructor.name, gold: p.gold, income: p.income,
        units: p.units.filter(u => !u.killed).map(describe), towns: towns.map(describe),
        buildings: towns.flatMap(t => t.buildings.filter(b => !b.killed).map(describe))};
    }),
    demons: players[gameSettings.coop.demonSlot].units.filter(u => !u.killed).map(describe),
    portals: external.filter(p => p.isDemonPortal && !p.killed).map(p => ({...describe(p), category: p.category ?? null}))});
}

function policyMethodSources() {
  const methods = cls => Object.getOwnPropertyNames(cls.prototype).filter(name => name !== 'constructor' &&
    typeof Object.getOwnPropertyDescriptor(cls.prototype, name).value === 'function')
    .map(name => ({class: cls.name, name, text: cls.prototype[name].toString()}));
  return JSON.stringify({chain: [Object.getPrototypeOf(SimpleAiPlayerWithEconomy.prototype) === SimpleAiPlayer.prototype,
    Object.getPrototypeOf(SimpleAiPlayer.prototype) === Player.prototype],
    methods: [...methods(SimpleAiPlayerWithEconomy), ...methods(SimpleAiPlayer)]});
}

function runChild(spec) {
  const {createFixture} = require('./test-coop-harness');
  const out = spec.outputDir;
  const recordFile = path.join(out, spec.record), journalFile = path.join(out, spec.journal);
  const progressFile = path.join(out, spec.progress);
  fs.mkdirSync(path.dirname(journalFile), {recursive: true});
  fs.writeFileSync(journalFile, '');
  const started = Date.now();
  const cpuBoundSeconds = spec.cpuBoundMs / 1000;
  const record = {id: spec.id, spec, status: 'running', runtime: {node: process.version, v8: process.versions.v8,
    platform: `${process.platform}-${process.arch}`, pid: process.pid, browser: null}, priority: priority(), cpuBoundSeconds,
    rounds: [], births: [], integrityFailures: [], counters: {}};
  const save = () => writeJson(recordFile, record);
  const progress = (stage, obs) => writeJson(progressFile, {stage, round: obs ? obs.round : null, turn: obs ? obs.turn : null,
    localPhase: obs ? obs.localPhase : null, elapsedMs: Date.now() - started, ...usage()});
  let lastStage = 'boot';
  const cpuBound = () => {
    const u = usage();
    if (u.cpuSeconds > cpuBoundSeconds) {
      record.lastPhase = {stage: lastStage, round: obs ? obs.round : null, turn: obs ? obs.turn : null};
      throw new CpuBoundExceeded(`case-cpu-bound: ${spec.id} used ${u.cpuSeconds.toFixed(1)} CPU-s > ${cpuBoundSeconds} ` +
        `(wall ${u.wallSeconds.toFixed(1)} s) at ${JSON.stringify(record.lastPhase)}`);
    }
  };
  const counters = record.counters = {nextTurnCalls: 0, humanTurns: 0, botPlays: 0, economyPrepares: 0, economyPreparesOk: 0,
    economyPlacements: 0, economyGoldSpent: 0, humanUnitActions: 0, demonUnitActions: 0, illegalActions: 0,
    humanFoggedDestinations: 0, damage: {}, removals: {}, humanRemovalCauses: {}, waves: 0, spawned: {}, spawnedByCategory: {},
    humanBirths: 0, demonBirths: 0, resultSets: 0, resultEvaluations: 0, economyRefreshes: 0, demonDamageOnHumans: 0,
    demonTargetKinds: {}};
  const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };
  let lastHumanRemoval = null;
  const fail = (name, detail) => { throw new IntegrityFailure(name, detail); };
  progress('boot');
  save();
  let f, obs;
  try {
    f = createFixture(undefined, () => {}, {nativeIntrinsics: true});
    const ev = source => f.evaluate(source);
    // Deterministic per-case random source inside the realm (demon tie-breaks).
    ev(`(() => { let s = ${spec.rngSeed} >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })(); undefined`);
    ev(`globalThis.generated = generateCoopGame(${spec.humans}, {size: '${spec.size}', seed: ${spec.seed}}); undefined`);
    record.generation = JSON.parse(ev('JSON.stringify(generated.coop.generation)'));
    record.generatedMapSha256 = sha(ev('JSON.stringify(generated)'));
    lastStage = 'generated';
    cpuBound();
    // The only setup change: each human roster slot names the existing policy class.
    record.roster = JSON.parse(ev(`JSON.stringify(generated.players.map((p, i) => {
      if (i >= 1 && i <= generated.coop.humanSlots.length) p.playerType = '${POLICY}'
      return {slot: i, playerType: p.playerType || null, gold: p.gold, towns: p.towns.length, units: p.units.length}
    }))`));
    progress('generated');
    record.policySources = JSON.parse(ev(`(${policyMethodSources.toString()})()`));
    ev(`isFogOfWar = ${spec.fog ? 'true' : 'false'}; gameSettings.isOnline = false
      generated.start({clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
        updateCameraBorders() {}}, false)
      whooseTurn = 0; actionManager.clear(); undefined`);
    ev(`(${installInstrumentation.toString()})(); undefined`);
    record.configuration = JSON.parse(ev(`JSON.stringify({generation: gameSettings.coop.generation, humanSlots: gameSettings.coop.humanSlots,
      demonSlot: gameSettings.coop.demonSlot, balanceVersion: gameSettings.coop.balanceVersion, suddenDeathRound, isFogOfWar,
      aiActionLimit: gameSettings.aiActionLimit ?? null, isOnline: gameSettings.isOnline,
      rules: {demonTypes: DEMON_TYPES, typedWaveSchedule: COOP_TYPED_WAVE_SCHEDULE},
      slots: players.map((p, i) => ({slot: i, class: p.constructor.name, role: p.role, gold: p.gold, economyMode: p.economyMode ?? null,
        ownOverrides: ['play', 'nextTurn', 'playCombatActions', 'spendWarGold', 'spendEconomyGold', 'unitDoMoves']
          .filter(name => Object.prototype.hasOwnProperty.call(p, name))}))})`));
    fs.mkdirSync(path.join(out, 'snapshots'), {recursive: true});
    fs.writeFileSync(path.join(out, spec.snapshots.initial), ev('JSON.stringify(getGameObject())') + '\n');
    obs = JSON.parse(ev('__observe()'));
    record.initial = obs;
    const known = new Set();
    const initialHumanIds = new Set();
    const assetsOf = o => [...o.humans.flatMap(h => [...h.units, ...h.towns, ...h.buildings]), ...o.demons, ...o.portals];
    for (const asset of assetsOf(obs)) { known.add(asset.id); if (asset.role === 'HUMAN') initialHumanIds.add(asset.id); }
    record.initialHumanAssetIds = [...initialHumanIds];
    let waveSpawnIds = new Set();
    const humanSlots = record.configuration.humanSlots;
    for (const slot of record.configuration.slots.filter(s => humanSlots.includes(s.slot))) {
      if (slot.class !== POLICY || slot.role !== 'HUMAN' || slot.ownOverrides.length || slot.economyMode !== 'war')
        fail('policy-not-replaced', `slot ${slot.slot} is ${JSON.stringify(slot)}`);
    }
    progress('started', obs);
    save();
    lastStage = 'started';
    cpuBound();
    let roundTurns = 0, roundStartedAt = Date.now(), roundStart = {...counters}, roundUsage = usage();
    let roundTargetKinds = {};
    const faultRound = spec.fault ? FAULTS[spec.fault].round : null;
    let faultApplied = false;
    const turn = () => {
      const before = obs;
      ev('__plays = {}; __advances.length = 0; undefined');
      ev('nextTurn(); undefined');
      counters.nextTurnCalls++;
      roundTurns++;
      obs = JSON.parse(ev('__observe()'));
      const events = JSON.parse(ev('JSON.stringify(__events.splice(0))'));
      const advances = JSON.parse(ev('JSON.stringify(__advances)'));
      const plays = JSON.parse(ev('JSON.stringify(__plays)'));
      const targetKinds = JSON.parse(ev('(k => (__targetKinds = {}, JSON.stringify(k)))(__targetKinds)'));
      for (const [kind, n] of Object.entries(targetKinds)) { bump(counters.demonTargetKinds, kind, n); bump(roundTargetKinds, kind, n); }
      counters.resultEvaluations = ev('__resultEvaluations');
      const births = [];
      for (const asset of assetsOf(obs)) {
        if (known.has(asset.id)) continue;
        known.add(asset.id);
        const birth = {type: 'birth', round: obs.round, ...asset};
        births.push(birth);
      }
      for (const e of events) {
        switch (e.type) {
          case 'unit-action':
            if (e.role === 'HUMAN') counters.humanUnitActions++; else counters.demonUnitActions++;
            if (!e.legal) { counters.illegalActions++; fail('legal-actions', `illegal ${e.role} command ${JSON.stringify(e)}`); }
            if (!e.controller) fail('policy-controller', `${e.role} unit command outside its controller ${JSON.stringify(e)}`);
            if (e.fogged) { counters.humanFoggedDestinations++; fail('fog-rules', `human command into fog ${JSON.stringify(e)}`); }
            break;
          case 'economy-prepare':
            counters.economyPrepares++;
            if (e.ok) { counters.economyPreparesOk++; counters.economyGoldSpent += e.goldBefore - e.goldAfter; }
            if (e.role === 'HUMAN' && !e.controller) fail('policy-controller', `economy prepare outside policy ${JSON.stringify(e)}`);
            break;
          case 'economy-placement':
            counters.economyPlacements++;
            counters.economyGoldSpent += e.goldBefore - e.goldAfter;
            if (!e.legal) { counters.illegalActions++; fail('legal-actions', `illegal placement ${JSON.stringify(e)}`); }
            if (e.role === 'HUMAN' && !e.controller) fail('policy-controller', `economy placement outside policy ${JSON.stringify(e)}`);
            break;
          case 'economy-refresh': counters.economyRefreshes++; break;
          case 'bot-play': counters.botPlays++; break;
          case 'damage':
            bump(counters.damage, `${e.cause}:${e.actorRole}->${e.target.role}`);
            if (e.actorRole === 'DEMONS' && e.target.role === 'HUMAN') counters.demonDamageOnHumans += e.damage;
            if (e.cause !== 'unit-action' || e.legal !== true) fail('combat-integrity', `damage outside a legal unit action ${JSON.stringify(e)}`);
            break;
          case 'removal':
            bump(counters.removals, `${e.cause}:${e.actorRole}->${e.target.role}:${e.target.kind}`);
            if (e.cause === 'unattributed') fail('removal-cause', `removal outside any engine action ${JSON.stringify(e)}`);
            if (e.target.role === 'HUMAN' && e.target.owner !== null) {
              bump(counters.humanRemovalCauses, e.cause);
              lastHumanRemoval = e;
            }
            break;
          case 'wave':
            counters.waves++;
            for (const s of e.spawned) {
              bump(counters.spawned, s.type);
              bump(counters.spawnedByCategory, `${s.category}:${s.type}`);
              waveSpawnIds.add(s.unit.id);
              if (!s.matchesSchedule) fail('wave-schedule', `spawn does not match the production schedule ${JSON.stringify(s)}`);
            }
            break;
          case 'result-set':
            counters.resultSets++;
            if (!e.evaluator) fail('result-from-evaluator', `coop.result assigned outside NeutralPlayer.isGameEnded ${JSON.stringify(e)}`);
            break;
        }
      }
      for (const b of births) {
        b.cause = b.role === 'DEMONS' && b.kind !== 'demonPortal' ? (waveSpawnIds.has(b.id) ? 'wave' : 'unexplained') : 'production';
        if (b.role === 'HUMAN') counters.humanBirths++; else counters.demonBirths++;
        if (b.cause === 'unexplained') fail('birth-cause', `demon unit without a wave spawn ${JSON.stringify(b)}`);
        record.births.push(b);
      }
      const journal = [...events, ...births, {type: 'turn-observation', round: obs.round, turn: obs.turn, plays, advances,
        terminal: obs.terminal, result: obs.result}];
      fs.appendFileSync(journalFile, journal.map(e => JSON.stringify(e)).join('\n') + '\n');
      // Rounds advance only inside the neutral turn, one at a time.
      const roundOk = obs.round === before.round + advances.length &&
        advances.every((a, i) => a[0] === before.round + i && a[1] === a[0] + 1);
      if (!roundOk) fail('round-integrity', `round ${before.round} -> ${obs.round} with neutral advances ${JSON.stringify(advances)}`);
      if (roundTurns > humanSlots.length + 1) fail('stalled-dispatcher', `${roundTurns} end-turn calls in round ${before.round}`);
      if (!obs.terminal) {
        const active = obs.humans.find(h => h.owner === obs.turn);
        if (!active || active.lost) fail('active-human', `turn ${obs.turn} is not a live human slot`);
        counters.humanTurns++;
        const slot = JSON.parse(ev(`JSON.stringify((p => ({class: p.constructor.name, role: p.role, economyMode: p.economyMode,
          ownOverrides: ['play', 'nextTurn', 'playCombatActions', 'spendWarGold', 'unitDoMoves'].filter(n => Object.prototype.hasOwnProperty.call(p, n))}))(players[${obs.turn}]))`));
        if (slot.class !== POLICY || slot.role !== 'HUMAN' || slot.ownOverrides.length || plays[obs.turn] !== 1)
          fail('policy-not-replaced', `human turn ${obs.turn} round ${obs.round}: ${JSON.stringify(slot)} policyPlays=${plays[obs.turn] || 0}`);
      }
      progress(obs.terminal ? 'terminal' : 'human-turn', obs);
      if (obs.round !== before.round || obs.terminal) {
        const summary = o => o.humans.map(h => ({owner: h.owner, lost: h.lost, gold: h.gold, income: h.income,
          units: h.units.length, towns: h.towns.length, buildings: h.buildings.length,
          unitKinds: h.units.reduce((m, u) => (m[u.kind] = (m[u.kind] || 0) + 1, m), {})}));
        const delta = {};
        for (const key of ['botPlays', 'economyPreparesOk', 'economyPlacements', 'humanUnitActions', 'demonUnitActions', 'humanBirths',
          'demonBirths', 'demonDamageOnHumans'])
          delta[key] = counters[key] - roundStart[key];
        delta.demonTargetKinds = roundTargetKinds;
        const now = usage();
        record.rounds.push({fromRound: before.round, round: obs.round, terminal: obs.terminal, result: obs.result, turns: roundTurns,
          elapsedMs: Date.now() - roundStartedAt, cpuSeconds: now.cpuSeconds, wallSeconds: now.wallSeconds, cpuShare: now.cpuShare,
          roundCpuSeconds: now.cpuSeconds - roundUsage.cpuSeconds, roundWallSeconds: now.wallSeconds - roundUsage.wallSeconds,
          roundCpuShare: (now.cpuSeconds - roundUsage.cpuSeconds) / Math.max(1e-9, now.wallSeconds - roundUsage.wallSeconds),
          humans: summary(obs),
          demons: obs.demons.reduce((m, u) => (m[u.kind] = (m[u.kind] || 0) + 1, m), {}),
          portals: obs.portals.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {}), delta});
        roundTurns = 0; roundStartedAt = Date.now(); roundStart = {...counters}; roundUsage = now; roundTargetKinds = {};
        record.last = obs;
        save();
        console.log(`ROUND ${spec.id} round=${obs.round} humanAssets=${obs.humans.reduce((n, h) => n + h.units.length + h.towns.length, 0)} demons=${obs.demons.length} portals=${obs.portals.length} result=${obs.result} elapsedMs=${Date.now() - started} cpuSeconds=${now.cpuSeconds.toFixed(1)} cpuShare=${now.cpuShare.toFixed(2)} demonDamageOnHumans=${delta.demonDamageOnHumans}`);
      }
      lastStage = obs.terminal ? 'terminal' : 'human-turn';
      cpuBound();
    };
    const applyFault = () => {
      faultApplied = true;
      record.faultApplied = {fault: spec.fault, round: obs.round, description: FAULTS[spec.fault].description};
      save();
      if (spec.fault === 'skip-turn-policy') ev('for (const s of gameSettings.coop.humanSlots) players[s].play = function() {}; undefined');
      else if (spec.fault === 'round-jump') ev('gameRound += 3; undefined');
      else if (spec.fault === 'assigned-result') ev("gameSettings.coop.result = 'defeat'; menuBack(); undefined");
      else if (spec.fault === 'combat-cheat') ev(`for (const s of gameSettings.coop.humanSlots) {
        for (const u of players[s].units.slice()) if (!u.killed) u.kill()
        for (const t of players[s].towns.slice()) if (!t.killed) t.destroy() }; undefined`);
      else if (spec.fault === 'stall-after-round') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      else if (spec.fault === 'throw-in-turn') throw new Error('fault throw-in-turn: injected child exception');
    };
    turn();
    while (!obs.terminal && obs.round < spec.maxRounds) {
      if (spec.fault && !faultApplied && obs.round >= faultRound) {
        applyFault();
        if (spec.fault === 'assigned-result' || spec.fault === 'combat-cheat') {
          // Observe the injected state through the same checks as a real turn.
          const events = JSON.parse(ev('JSON.stringify(__events.splice(0))'));
          fs.appendFileSync(journalFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');
          const bad = events.find(e => (e.type === 'result-set' && !e.evaluator) || (e.type === 'removal' && e.cause === 'unattributed'));
          if (bad) fail(bad.type === 'result-set' ? 'result-from-evaluator' : 'removal-cause', JSON.stringify(bad));
        }
      }
      turn();
    }
    obs = JSON.parse(ev('__observe()'));
    fs.writeFileSync(path.join(out, spec.snapshots.final), ev('JSON.stringify(getGameObject())') + '\n');
    record.final = obs;
    record.status = 'completed';
  } catch (error) {
    if (error instanceof IntegrityFailure) {
      record.status = 'completed';
      record.integrityFailures.push({checkpoint: error.checkpoint, message: error.message});
    } else if (error instanceof CpuBoundExceeded) {
      record.status = 'timeout';
      record.timeoutKind = 'case-cpu-bound';
      record.error = error.message;
    } else {
      record.status = 'exception';
      record.error = error && error.stack || String(error);
    }
    if (f && obs) record.final = obs;
    console.error(error && error.stack || error);
  }
  const final = record.final || record.initial;
  Object.assign(record, usage());
  record.summary = {status: record.status, error: record.error || null, integrityFailures: record.integrityFailures,
    timeoutKind: record.timeoutKind || null, lastPhase: record.lastPhase || null, elapsedMs: Date.now() - started,
    cpuSeconds: record.cpuSeconds, wallSeconds: record.wallSeconds, cpuShare: record.cpuShare, cpuBoundSeconds,
    terminal: !!(final && final.terminal), result: final ? final.result : null, completedRound: final ? final.round : null,
    maxRounds: spec.maxRounds,
    resultFromEvaluator: !!(final && final.terminalEvent && counters.resultEvaluations > 0 &&
      record.integrityFailures.every(x => x.checkpoint !== 'result-from-evaluator')),
    humanAssetsRemaining: final ? final.humans.reduce((n, h) => n + h.units.length + h.towns.length, 0) : null,
    humanRemovalCauses: counters.humanRemovalCauses, lastHumanRemovalCause: lastHumanRemoval ? lastHumanRemoval.cause : null,
    lastHumanRemovalActorRole: lastHumanRemoval ? lastHumanRemoval.actorRole : null, lastHumanRemoval};
  record.classification = classifyOutcome(record.summary);
  record.elapsedMs = Date.now() - started;
  save();
  progress(record.status, final);
  console.log(`CHILD_RESULT ${spec.id} status=${record.status} classification=${record.classification.classification} ` +
    `round=${record.summary.completedRound} result=${record.summary.result} failures=${record.integrityFailures.map(x => x.checkpoint).join(',') || 'none'} ` +
    `cpuSeconds=${record.cpuSeconds.toFixed(2)} wallSeconds=${record.wallSeconds.toFixed(2)} cpuShare=${record.cpuShare.toFixed(3)}`);
  process.exitCode = record.status === 'completed' && !record.integrityFailures.length ? 0 : 1;
}

// ---------------------------------------------------------------- parent
function caseSpec(outputDir, size, humans, seed, fog, maxRounds, fault, cpuBoundMs = DEFAULT_TIMEOUT_MS) {
  const id = `${size}-H${humans}-seed${seed}-fog${fog ? 1 : 0}`;
  return {id, size, humans, seed, fog, maxRounds, fault: fault || null, cpuBoundMs, outputDir: path.resolve(outputDir),
    rngSeed: parseInt(sha(`economy-bot-defeat:${id}`).slice(0, 8), 16),
    record: `cases/${id}.json`, progress: `cases/${id}.progress.json`, journal: `journals/${id}.jsonl`,
    snapshots: {initial: `snapshots/${id}-initial.json`, final: `snapshots/${id}-final.json`}};
}

// The case child enforces spec.cpuBoundMs on its own CPU time; hangMs is only a wall-clock hang guard.
function runCaseProcess(spec, hangMs) {
  const args = [__filename, '--child', Buffer.from(JSON.stringify(spec)).toString('base64')];
  const started = Date.now();
  const child = spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', timeout: hangMs, killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024 * 1024});
  const elapsedMs = Date.now() - started;
  process.stdout.write(child.stdout || '');
  process.stderr.write(child.stderr || '');
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(spec.outputDir, file), 'utf8')); } catch (e) { return null; } };
  const record = read(spec.record);
  const lastPhase = read(spec.progress);
  const timedOut = !!(child.error && child.error.code === 'ETIMEDOUT');
  let summary;
  if (timedOut) summary = {status: 'timeout', timeoutKind: 'case-hang', elapsedMs, lastPhase,
    cpuSeconds: lastPhase ? lastPhase.cpuSeconds : null, wallSeconds: lastPhase ? lastPhase.wallSeconds : null,
    cpuShare: lastPhase ? lastPhase.cpuShare : null, cpuBoundSeconds: spec.cpuBoundMs / 1000};
  else if (!record || !record.summary) summary = {status: 'exception', error: `child exit ${child.status} signal ${child.signal} without a record`};
  else summary = {...record.summary, status: record.summary.status === 'completed' && child.status !== 0 && !record.integrityFailures.length ?
    'exception' : record.summary.status};
  const classification = classifyOutcome(summary);
  return {id: spec.id, spec, command: [process.execPath, __filename, '--child', '<base64 case spec>'], cwd: ROOT,
    exitStatus: child.status, signal: child.signal, timedOut, elapsedMs, hangMs, cpuBoundMs: spec.cpuBoundMs,
    lastPhase: summary.lastPhase || lastPhase, cpuSeconds: summary.cpuSeconds ?? null, wallSeconds: summary.wallSeconds ?? null,
    cpuShare: summary.cpuShare ?? null, priority: record ? record.priority : null, summary, ...classification,
    failures: [...(summary.status === 'timeout' ? [summary.timeoutKind] : []),
      ...(summary.integrityFailures ? summary.integrityFailures.map(x => x.checkpoint) : [])],
    policy: record && record.configuration ? {slots: record.configuration.slots.filter(s => record.configuration.humanSlots.includes(s.slot)),
      botPlays: record.counters.botPlays, humanTurns: record.counters.humanTurns} : null,
    counters: record ? record.counters : null, recordFile: spec.record, journal: spec.journal, snapshots: spec.snapshots};
}

function sourceFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  return [...new Set(['ai/test-coop-economy-bot-defeat.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js', 'index.html', ...scripts])]
    .filter(file => fs.existsSync(path.join(ROOT, file)));
}
function sourceIdentities() {
  const files = {};
  for (const file of sourceFiles()) files[file] = sha(fs.readFileSync(path.join(ROOT, file)));
  let head = null, dirty = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
    dirty = execFileSync('git', ['status', '--porcelain', '--', ...Object.keys(files)], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(Boolean);
  } catch (error) { /* not a git checkout */ }
  return {head, dirtyTrackedOrUntracked: dirty, fileCount: Object.keys(files).length, files};
}
function policyIdentities(cases) {
  const source = fs.readFileSync(path.join(ROOT, 'ai/players.js'), 'utf8');
  const withSources = cases.map(c => ({c, record: (() => { try { return JSON.parse(fs.readFileSync(path.join(c.spec.outputDir, c.recordFile), 'utf8')); } catch (e) { return null; } })()}));
  const first = withSources.find(x => x.record && x.record.policySources);
  const methods = first ? first.record.policySources.methods.map(m => ({class: m.class, name: m.name, sha256: sha(m.text),
    foundVerbatimInSource: source.includes(m.text)})) : [];
  return {policyClass: POLICY, sourceFile: 'ai/players.js', sourceSha256: sha(source),
    prototypeChain: first ? first.record.policySources.chain : null, methods,
    cases: withSources.map(({c, record}) => ({id: c.id, fault: c.spec.fault, policy: c.policy,
      methodShaMatchesFirst: !!(record && record.policySources && first &&
        isDeepStrictEqual(record.policySources.methods.map(m => sha(m.text)), first.record.policySources.methods.map(m => sha(m.text))))}))};
}

function refuseOverwrite(outputDir) {
  for (const file of ['case-manifest.json', 'checkpoints.json', 'harness-self-tests.json']) {
    if (fs.existsSync(path.join(outputDir, file))) {
      console.error(`refusing to overwrite existing ${path.join(outputDir, file)}`);
      process.exit(2);
    }
  }
}

function runGate(args) {
  const out = path.resolve(args.outputDir);
  refuseOverwrite(out);
  fs.mkdirSync(out, {recursive: true});
  const mode = args.calibrate ? 'calibrate' : 'gate';
  const specs = [];
  for (const size of args.sizes) for (const humans of args.humans) for (const seed of args.seeds)
    specs.push(caseSpec(out, size, humans, seed, false, args.maxRounds, args.fault, args.faultCpuBound ? FAULT_CPU_BOUND_MS : args.caseTimeoutMs));
  const manifest = {mode, argv: process.argv.slice(2), cwd: ROOT, runtime: {node: process.version, v8: process.versions.v8, browser: null},
    size: args.size, sizes: args.sizes, humans: args.humans, seeds: args.seeds, fog: false, maxRounds: args.maxRounds, caseTimeoutMs: args.caseTimeoutMs,
    caseBound: 'case-child CPU time (process.cpuUsage user+system, including boot and generation), checked after every turn',
    cpuBoundMs: args.faultCpuBound ? FAULT_CPU_BOUND_MS : args.caseTimeoutMs, caseHangMs: args.caseHangMs, faultCpuBound: args.faultCpuBound,
    fault: args.fault, policy: POLICY, priority: priority(), startedAt: new Date().toISOString(), cases: []};
  console.log(`PRIORITY parent ${JSON.stringify(manifest.priority)}`);
  const identitiesBefore = sourceIdentities();
  for (const spec of specs) {
    const row = runCaseProcess(spec, args.caseHangMs);
    manifest.cases.push(row);
    writeJson(path.join(out, 'case-manifest.json'), manifest);
    console.log(`CASE_RESULT ${row.id} classification=${row.classification} gate=${row.gatePass ? 'pass' : 'fail'} ` +
      `infrastructure=${row.infrastructure} exit=${row.exitStatus} signal=${row.signal} elapsedMs=${row.elapsedMs} ` +
      `round=${row.summary.completedRound ?? null} result=${row.summary.result ?? null} failures=${row.failures.join(',') || 'none'} ` +
      `cpuSeconds=${row.cpuSeconds} wallSeconds=${row.wallSeconds} cpuShare=${row.cpuShare} autogroup=${JSON.stringify(row.priority && row.priority.autogroup)} ` +
      `lastPhase=${JSON.stringify(row.lastPhase)} reason=${row.reason}`);
  }
  manifest.finishedAt = new Date().toISOString();
  const identitiesAfter = sourceIdentities();
  const checkpoints = manifest.cases.map(row => ({name: `${row.id}-${mode === 'gate' ? 'combat-defeat' : 'outcome-retained'}`,
    expected: mode === 'gate' ? 'combat-defeat' : 'no infrastructure failure',
    observed: mode === 'gate' ? row.classification : (row.infrastructure ? row.classification : 'no infrastructure failure'),
    pass: mode === 'gate' ? row.gatePass : !row.infrastructure, reason: row.reason}));
  checkpoints.push({name: 'source-identities-stable', expected: identitiesBefore.files, observed: identitiesAfter.files,
    pass: isDeepStrictEqual(identitiesBefore.files, identitiesAfter.files)});
  const passed = checkpoints.every(c => c.pass);
  manifest.gateClaimed = mode === 'gate' && passed;
  manifest.passed = passed;
  writeJson(path.join(out, 'case-manifest.json'), manifest);
  writeJson(path.join(out, 'checkpoints.json'), {mode, passed, checkpoints});
  writeJson(path.join(out, 'policy-identities.json'), policyIdentities(manifest.cases));
  writeJson(path.join(out, 'source-identities.json'), identitiesAfter);
  const counts = {};
  for (const row of manifest.cases) counts[row.classification] = (counts[row.classification] || 0) + 1;
  if (mode === 'gate') {
    console.log(`${passed ? 'PASS' : 'FAIL'} economy-bot-defeat gate size=${args.size} cases=${manifest.cases.length} ` +
      `combatDefeats=${counts['combat-defeat'] || 0} outcomes=${JSON.stringify(counts)} maxRounds=${args.maxRounds}`);
  } else {
    console.log(`${passed ? 'PASS' : 'FAIL'} economy-bot-defeat calibrate size=${args.size} cases=${manifest.cases.length} ` +
      `outcomes=${JSON.stringify(counts)} infrastructureFailures=${manifest.cases.filter(r => r.infrastructure).length} gate=not-claimed`);
  }
  process.exitCode = passed ? 0 : 1;
}

// ---------------------------------------------------------------- self-test
function runSelfTest(args) {
  const out = path.resolve(args.outputDir);
  refuseOverwrite(out);
  fs.mkdirSync(out, {recursive: true});
  const checkpoints = [];
  const report = {runtime: {node: process.version, v8: process.versions.v8, platform: `${process.platform}-${process.arch}`,
    browser: 'none: node vm realm (no browser used)'}, cwd: ROOT, argv: process.argv.slice(2), startedAt: new Date().toISOString(),
  classificationFixtures: [], cliFixtures: [], smoke: [], subprocesses: []};
  const check = (section, name, observed, expected, extra = {}) => {
    const pass = isDeepStrictEqual(observed, expected);
    const row = {section, name, expected, observed, pass, ...extra};
    checkpoints.push(row);
    const show = value => { const text = JSON.stringify(value); return text.length > 400 ? `{sha256:${sha(text)},bytes:${text.length}}` : text; };
    console.log(`${pass ? 'PASS' : 'FAIL'} ${section}:${name} expected=${show(expected)} observed=${show(observed)}`);
    return row;
  };
  const identitiesBefore = sourceIdentities();

  // 1. Classification fixtures with independent literal expectations.
  const combat = {status: 'completed', integrityFailures: [], terminal: true, resultFromEvaluator: true, completedRound: 27, maxRounds: 100,
    result: 'defeat', humanAssetsRemaining: 0, humanRemovalCauses: {'unit-action': 3}, lastHumanRemovalCause: 'unit-action',
    lastHumanRemovalActorRole: 'DEMONS'};
  const fixtures = [
    ['combat-defeat', combat, {classification: 'combat-defeat', gatePass: true, infrastructure: false}],
    ['human-victory', {...combat, result: 'victory', humanAssetsRemaining: 5}, {classification: 'victory', gatePass: false, infrastructure: false}],
    ['draw', {...combat, result: 'draw'}, {classification: 'draw', gatePass: false, infrastructure: false}],
    ['nonterminal-survival', {...combat, terminal: false, result: null, completedRound: 100, humanAssetsRemaining: 4},
      {classification: 'survival', gatePass: false, infrastructure: false}],
    ['timeout', {status: 'timeout', elapsedMs: 600000, lastPhase: {stage: 'human-turn', round: 61}},
      {classification: 'timeout', gatePass: false, infrastructure: true}],
    ['cpu-bound', {status: 'timeout', timeoutKind: 'case-cpu-bound', cpuSeconds: 600.4, cpuBoundSeconds: 600, wallSeconds: 1400,
      lastPhase: {stage: 'human-turn', round: 22}}, {classification: 'timeout', gatePass: false, infrastructure: true}],
    ['case-hang', {status: 'timeout', timeoutKind: 'case-hang', elapsedMs: 3600000, lastPhase: {stage: 'human-turn', round: 2}},
      {classification: 'timeout', gatePass: false, infrastructure: true}],
    ['exception', {status: 'exception', error: 'TypeError: boom'}, {classification: 'exception', gatePass: false, infrastructure: true}],
    ['flood-defeat', {...combat, humanRemovalCauses: {'unit-action': 2, flood: 1}, lastHumanRemovalCause: 'flood'},
      {classification: 'non-combat-defeat', gatePass: false, infrastructure: false}],
    ['assigned-result', {...combat, resultFromEvaluator: false}, {classification: 'integrity-failure', gatePass: false, infrastructure: true}],
    ['integrity-violation', {...combat, integrityFailures: [{checkpoint: 'round-integrity'}]},
      {classification: 'integrity-failure', gatePass: false, infrastructure: true}],
    ['defeat-with-human-assets', {...combat, humanAssetsRemaining: 1}, {classification: 'integrity-failure', gatePass: false, infrastructure: true}],
    ['late-terminal', {...combat, completedRound: 101}, {classification: 'late-terminal', gatePass: false, infrastructure: false}],
    ['nonterminal-before-max', {...combat, terminal: false, result: null, completedRound: 40},
      {classification: 'incomplete', gatePass: false, infrastructure: true}]
  ];
  for (const [name, input, expected] of fixtures) {
    const observed = classifyOutcome(input);
    const row = check('classification', name, {classification: observed.classification, gatePass: observed.gatePass,
      infrastructure: observed.infrastructure}, expected, {input, reason: observed.reason});
    report.classificationFixtures.push(row);
  }

  // 2. CLI fixtures.
  const cli = [
    ['defaults', ['--output-dir', 'x'], {size: 'tiny', sizes: ['tiny'], humans: [1], seeds: [0], maxRounds: 100, caseTimeoutMs: 600000,
      caseHangMs: 3600000, faultCpuBound: false, selfTest: false, calibrate: false}],
    ['explicit', ['--size', 'big', '--humans', '1,2,4,10,12', '--seeds', '0,9', '--max-rounds', '100', '--case-timeout-ms', '600000',
      '--case-hang-ms', '7200000', '--output-dir', 'x', '--calibrate'], {size: 'big', sizes: ['big'], humans: [1, 2, 4, 10, 12], seeds: [0, 9],
      maxRounds: 100, caseTimeoutMs: 600000, caseHangMs: 7200000, faultCpuBound: false, selfTest: false, calibrate: true}],
    ['size-list', ['--size', 'tiny,normal,big', '--output-dir', 'x'], {size: 'tiny,normal,big', sizes: ['tiny', 'normal', 'big'],
      humans: [1], seeds: [0], maxRounds: 100, caseTimeoutMs: 600000, caseHangMs: 3600000, faultCpuBound: false, selfTest: false, calibrate: false}],
    ['fault-cpu-bound', ['--output-dir', 'x', '--fault-cpu-bound'], {size: 'tiny', sizes: ['tiny'], humans: [1], seeds: [0], maxRounds: 100,
      caseTimeoutMs: 600000, caseHangMs: 3600000, faultCpuBound: true, selfTest: false, calibrate: false}],
    ['bad-hang', ['--case-hang-ms', '0', '--output-dir', 'x'], 'invalid --case-hang-ms'],
    ['bad-size', ['--size', 'huge', '--output-dir', 'x'], 'invalid --size: huge'],
    ['bad-size-in-list', ['--size', 'tiny,huge', '--output-dir', 'x'], 'invalid --size: tiny,huge'],
    ['duplicate-size', ['--size', 'tiny,tiny', '--output-dir', 'x'], 'duplicate value in --size: tiny,tiny'],
    ['bad-humans', ['--humans', '13', '--output-dir', 'x'], 'invalid --humans: each count must be 1..12'],
    ['too-many-rounds', ['--max-rounds', '101', '--output-dir', 'x'], 'invalid --max-rounds: integer 1..100'],
    ['missing-output', ['--size', 'tiny'], '--output-dir DIR is required']
  ];
  for (const [name, argv, expected] of cli) {
    let observed;
    try {
      const parsed = parseArgs(argv);
      observed = {size: parsed.size, sizes: parsed.sizes, humans: parsed.humans, seeds: parsed.seeds, maxRounds: parsed.maxRounds,
        caseTimeoutMs: parsed.caseTimeoutMs, caseHangMs: parsed.caseHangMs, faultCpuBound: parsed.faultCpuBound, selfTest: parsed.selfTest,
        calibrate: parsed.calibrate};
    } catch (error) { observed = error.message; }
    report.cliFixtures.push(check('cli', name, observed, expected, {argv}));
  }

  // 3. Real generated smoke cases in fresh processes: solo (fog off) and fog-on.
  const manifest = {mode: 'self-test', cwd: ROOT, runtime: report.runtime, policy: POLICY, cases: []};
  const smokeSpecs = [caseSpec(out, 'tiny', 1, 0, false, MAX_ROUNDS_LIMIT), caseSpec(out, 'tiny', 2, 0, true, MAX_ROUNDS_LIMIT)];
  for (const spec of smokeSpecs) {
    const row = runCaseProcess(spec, DEFAULT_HANG_MS);
    manifest.cases.push(row);
    writeJson(path.join(out, 'case-manifest.json'), manifest);
    const record = JSON.parse(fs.readFileSync(path.join(out, spec.record), 'utf8'));
    const c = record.counters;
    const humanSlots = record.configuration.humanSlots;
    const slots = record.configuration.slots.filter(s => humanSlots.includes(s.slot));
    const journal = fs.readFileSync(path.join(out, spec.journal), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const firstWave = journal.find(e => e.type === 'wave' && e.spawned.length);
    const smoke = {id: spec.id, classification: row.classification, reason: row.reason, round: row.summary.completedRound,
      result: row.summary.result, counters: c, checks: []};
    const sc = (name, observed, expected) => smoke.checks.push(check('smoke', `${spec.id}-${name}`, observed, expected));
    sc('child-exit', row.exitStatus, 0);
    sc('no-infrastructure-failure', row.infrastructure, false);
    sc('generation', {version: record.configuration.generation.version, playerCount: record.configuration.generation.playerCount,
      size: record.configuration.generation.size, seed: record.configuration.generation.seed},
    {version: 4, playerCount: spec.humans, size: 'tiny', seed: 0});
    sc('fog', record.configuration.isFogOfWar, spec.fog);
    sc('human-slot-policy', slots.map(s => ({class: s.class, role: s.role, economyMode: s.economyMode, ownOverrides: s.ownOverrides})),
      humanSlots.map(() => ({class: POLICY, role: 'HUMAN', economyMode: 'war', ownOverrides: []})));
    sc('standard-starting-gold', slots.map(s => s.gold), humanSlots.map(slot => record.roster[slot].gold));
    sc('policy-sources-verbatim', record.policySources.methods.every(m => fs.readFileSync(path.join(ROOT, 'ai/players.js'), 'utf8').includes(m.text)) &&
      record.policySources.chain.every(Boolean), true);
    sc('every-human-turn-played-by-policy', c.botPlays >= c.humanTurns && c.humanTurns > 0, true);
    sc('no-skip-turn-substitution', journal.filter(e => e.type === 'turn-observation' && !e.terminal)
      .every(e => e.plays[e.turn] === 1), true);
    sc('economy-production-actions', {preparesOk: c.economyPreparesOk > 0, goldSpent: c.economyGoldSpent > 0,
      humanProductionBirths: record.births.some(b => b.role === 'HUMAN' && b.cause === 'production')},
    {preparesOk: true, goldSpent: true, humanProductionBirths: true});
    sc('human-unit-actions-legal', {actions: c.humanUnitActions > 0, illegal: c.illegalActions, fogged: c.humanFoggedDestinations},
      {actions: true, illegal: 0, fogged: 0});
    sc('first-wave', firstWave ? {round: firstWave.waveRound, normalImp: firstWave.spawned.some(s => s.category === 'normal' && s.type === 'imp'),
      allScheduled: firstWave.spawned.every(s => s.matchesSchedule)} : null, {round: 4, normalImp: true, allScheduled: true});
    sc('result-evaluator-observed', row.summary.terminal ? row.summary.resultFromEvaluator : c.resultEvaluations > 0, true);
    sc('snapshots-retained', [spec.snapshots.initial, spec.snapshots.final].map(file => fs.existsSync(path.join(out, file)) &&
      JSON.parse(fs.readFileSync(path.join(out, file), 'utf8')).gameSettings.coop.generation.version === 4), [true, true]);
    if (spec.fog) sc('fog-human-actions-visible', c.humanUnitActions > 0 && c.humanFoggedDestinations === 0, true);
    const finite = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
    sc('cpu-bound-usage-recorded', {bound: record.cpuBoundSeconds, perCase: [row.cpuSeconds, row.wallSeconds, row.cpuShare].every(finite),
      withinBound: row.cpuSeconds <= 600, perRound: record.rounds.length > 0 && record.rounds.every(r => [r.cpuSeconds, r.wallSeconds, r.cpuShare].every(finite)),
      priority: !!record.priority && 'autogroup' in record.priority && 'nice' in record.priority},
    {bound: 600, perCase: true, withinBound: true, perRound: true, priority: true});
    sc('demon-targets-observed', Object.values(c.demonTargetKinds).reduce((n, k) => n + k, 0) > 0 && c.demonDamageOnHumans > 0, true);
    report.smoke.push(smoke);
  }

  // 4. Parent subprocesses: required positives exit 0, named negatives exit nonzero for their assertion.
  const parents = [
    {name: 'positive-gate-tiny-H1-seed0', kind: 'positive', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0'], exit: 0,
      expect: m => m.cases[0].classification === 'combat-defeat' && m.gateClaimed === true, marker: /PASS economy-bot-defeat gate/},
    {name: 'positive-calibrate-survival-retained', kind: 'positive', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--max-rounds', '3', '--calibrate'],
      exit: 0, expect: m => m.cases[0].classification === 'survival' && m.gateClaimed === false, marker: /gate=not-claimed/},
    {name: 'negative-gate-nonterminal-survivor', kind: 'negative', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--max-rounds', '3'],
      exit: 1, expect: m => m.cases[0].classification === 'survival' && m.gateClaimed === false, marker: /CASE_RESULT \S+ classification=survival gate=fail/},
    ...['skip-turn-policy', 'round-jump', 'assigned-result', 'combat-cheat'].map(fault => ({name: `negative-fault-${fault}`, kind: 'negative',
      args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--fault', fault], exit: 1,
      expect: m => m.cases[0].classification === 'integrity-failure' && m.cases[0].failures.includes(FAULTS[fault].marker),
      marker: new RegExp(`failures=${FAULTS[fault].marker}`)})),
    {name: 'negative-fault-stall-after-round', kind: 'negative',
      args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--case-hang-ms', '20000', '--fault', 'stall-after-round'], exit: 1,
      expect: m => m.cases[0].classification === 'timeout' && m.cases[0].lastPhase && m.cases[0].lastPhase.round === 2 &&
        m.cases[0].signal === 'SIGKILL' && isDeepStrictEqual(m.cases[0].failures, ['case-hang']),
      marker: /classification=timeout gate=fail .*failures=case-hang /},
    {name: 'negative-fault-cpu-bound', kind: 'negative', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--fault-cpu-bound'], exit: 1,
      expect: m => m.cpuBoundMs === 1000 && m.caseTimeoutMs === 600000 && m.cases[0].classification === 'timeout' &&
        isDeepStrictEqual(m.cases[0].failures, ['case-cpu-bound']) && m.cases[0].signal === null && m.cases[0].exitStatus === 1 &&
        m.cases[0].cpuSeconds > 1 && m.gateClaimed === false,
      marker: /classification=timeout gate=fail .*failures=case-cpu-bound .*reason=case-cpu-bound: /},
    {name: 'negative-fault-throw-in-turn', kind: 'negative', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--fault', 'throw-in-turn'],
      exit: 1, expect: m => m.cases[0].classification === 'exception', marker: /fault throw-in-turn: injected child exception/},
    {name: 'negative-calibrate-infrastructure-failure', kind: 'negative',
      args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--calibrate', '--fault', 'throw-in-turn'], exit: 1,
      expect: m => m.cases[0].classification === 'exception' && m.gateClaimed === false, marker: /infrastructureFailures=1 gate=not-claimed/},
    {name: 'negative-cli-invalid-size', kind: 'negative', args: ['--size', 'huge'], exit: 2, expect: null, marker: /invalid --size: huge/},
    {name: 'negative-overwrite-guard', kind: 'negative', args: ['--size', 'tiny', '--humans', '1', '--seeds', '0', '--max-rounds', '3', '--calibrate'],
      reuse: 'positive-calibrate-survival-retained', exit: 2, expect: null, marker: /refusing to overwrite/}
  ];
  for (const p of parents) {
    // The overwrite guard reruns into the positive calibrate directory, which must stay untouched.
    const dir = p.reuse ? path.join(out, 'positive-controls', p.reuse) :
      path.join(out, p.kind === 'positive' ? 'positive-controls' : 'negative-controls', p.name);
    const logDir = path.join(out, p.kind === 'positive' ? 'positive-controls' : 'negative-controls', p.name);
    const manifestBefore = p.reuse ? fs.readFileSync(path.join(dir, 'case-manifest.json'), 'utf8') : null;
    const argv = [__filename, ...p.args, '--output-dir', path.relative(ROOT, dir)];
    const started = Date.now();
    const child = spawnSync(process.execPath, argv, {cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000});
    const stdout = child.stdout || '', stderr = child.stderr || '';
    process.stdout.write(`----- SUBPROCESS ${p.name} (${p.kind}) command: ${[path.relative(ROOT, process.execPath) || process.execPath, ...argv.map(a => path.isAbsolute(a) ? path.relative(ROOT, a) : a)].join(' ')}\n`);
    process.stdout.write(`----- SUBPROCESS ${p.name} stdout\n${stdout}----- SUBPROCESS ${p.name} stderr\n${stderr}----- SUBPROCESS ${p.name} EXIT_STATUS=${child.status} signal=${child.signal}\n`);
    let manifestOk = null;
    if (p.expect) {
      try { manifestOk = !!p.expect(JSON.parse(fs.readFileSync(path.join(dir, 'case-manifest.json'), 'utf8'))); } catch (error) { manifestOk = false; }
    }
    if (p.reuse) manifestOk = fs.readFileSync(path.join(dir, 'case-manifest.json'), 'utf8') === manifestBefore;
    fs.mkdirSync(logDir, {recursive: true});
    fs.writeFileSync(path.join(logDir, `${p.name}.stdout.log`), stdout);
    fs.writeFileSync(path.join(logDir, `${p.name}.stderr.log`), stderr);
    const row = check('subprocess', p.name, {exitStatus: child.status, marker: p.marker.test(stdout + stderr), manifest: manifestOk},
      {exitStatus: p.exit, marker: true, manifest: p.expect || p.reuse ? true : null},
      {kind: p.kind, command: [process.execPath, ...argv], cwd: ROOT, elapsedMs: Date.now() - started, signal: child.signal,
        markerPattern: String(p.marker), outputDir: path.relative(out, dir), logDir: path.relative(out, logDir)});
    report.subprocesses.push(row);
  }

  const identitiesAfter = sourceIdentities();
  check('identity', 'tested-sources-unchanged-during-run', identitiesAfter.files, identitiesBefore.files);
  const allCases = [...manifest.cases];
  for (const p of report.subprocesses) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(out, p.outputDir, 'case-manifest.json'), 'utf8'));
      allCases.push(...m.cases.filter(row => !allCases.some(x => x.spec.outputDir === row.spec.outputDir && x.id === row.id)));
    } catch (error) { /* CLI negatives have no manifest */ }
  }
  const policy = policyIdentities(allCases);
  check('identity', 'policy-methods-verbatim-in-source', policy.methods.length > 0 && policy.methods.every(m => m.foundVerbatimInSource), true);
  check('identity', 'policy-identical-across-cases', policy.cases.every(c => c.methodShaMatchesFirst), true);
  manifest.passed = checkpoints.every(c => c.pass);
  report.finishedAt = new Date().toISOString();
  report.passed = checkpoints.every(c => c.pass);
  writeJson(path.join(out, 'case-manifest.json'), manifest);
  writeJson(path.join(out, 'policy-identities.json'), policy);
  writeJson(path.join(out, 'source-identities.json'), identitiesAfter);
  writeJson(path.join(out, 'harness-self-tests.json'), report);
  writeJson(path.join(out, 'checkpoints.json'), {mode: 'self-test', passed: report.passed, total: checkpoints.length,
    failed: checkpoints.filter(c => !c.pass).length, checkpoints});
  const negatives = report.subprocesses.filter(p => p.kind === 'negative'), positives = report.subprocesses.filter(p => p.kind === 'positive');
  console.log(`${report.passed ? 'PASS' : 'FAIL'} economy-bot-defeat self-test checkpoints=${checkpoints.filter(c => c.pass).length}/${checkpoints.length} ` +
    `positive_parents=${positives.filter(p => p.pass).length}/${positives.length} negative_controls=${negatives.filter(p => p.pass).length}/${negatives.length} ` +
    `smoke=${report.smoke.map(s => `${s.id}:${s.classification}@${s.round}`).join(',')}`);
  process.exitCode = report.passed ? 0 : 1;
}

if (require.main === module) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`usage error: ${error.message}`);
    process.exit(2);
  }
  if (args.child) runChild(args.child);
  else if (args.selfTest) runSelfTest(args);
  else runGate(args);
}
module.exports = {parseArgs, classifyOutcome, FAULTS};
