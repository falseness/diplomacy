'use strict';
// Divided Valley (version 4) runtime movement and phase continuation. Every case
// starts a production generateCoopGame map through the GameManager.start
// sequence (fog, map.start, initValues, startTurn) and plays real rounds through
// nextTurn(). Demons are moved only by DemonPlayer/SimpleAiPlayer; the one
// moving human unit only receives legal one-step commands taken from its own
// getAvailableMoveCommands() and sent through sendInstructions(). Observers
// delegate to the original methods; only rendering, timer and training side
// effects are stubbed. One active H4 game per size is saved by the page's local
// saveGame(), restored by loadGame() in a fresh runtime, and its next completed
// round is compared with the uninterrupted peer.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync, execFileSync} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const {createFixture} = require('./test-coop-harness');
const valley = require('./coop-valley-plan.js');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['ai/test-coop-valley-runtime.js', 'ai/test-coop-demon-bush-movement.js', 'ai/test-coop-demon-fog-movement.js',
  'ai/test-coop-demon-movement-fixture.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js', 'index.html',
  'ai/generateMap.js', 'ai/coop-valley-plan.js', 'ai/coop-map-scaling.js', 'options/gamestart.js', 'options/save.js',
  'gameObjectSerialization.js', 'nextTurn.js', 'player.js', 'ai/players.js', 'sprites/entities/units/unit/unit.js',
  'sprites/entities/units/unit/interactionWithUnit.js', 'sprites/entities/units/earlyDemons.js',
  'sprites/entities/buildings/demonPortal.js', 'ai/wave-placement.js', 'ai/wave-composition.js', 'ai/wave-config.js'];
const SIZES = ['tiny', 'normal', 'big'], HUMANS = [1, 4, 12], SEED = 0, FOG = true;
const RESUME = {humans: 4, round: 3};
const LATERAL_STEPS = 4, MAX_ROUND = 12, CASE_TIMEOUT_MS = 420000;
const CASES = SIZES.flatMap(size => HUMANS.map(humans => ({id: `${size}-H${humans}`, size, humans,
  lateral: humans > 1, resume: humans === RESUME.humans})));
const FAULTS = {
  'noop-demons': {case: 'tiny-H1', assertion: 'demon-leaves-portal'},
  'teleport-human': {case: 'tiny-H4', assertion: 'human-legal-movement'},
  'reseed-resume': {case: 'tiny-H4', assertion: 'resumed-round-parity'}
};

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const out = path.resolve(option('--output-dir') || 'artifacts/TASK-145');
const fault = option('--fault');
if (fault !== null && !FAULTS[fault]) throw new Error('unknown fault ' + fault);
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const writeJson = (rel, data) => {
  fs.mkdirSync(path.dirname(path.join(out, rel)), {recursive: true});
  fs.writeFileSync(path.join(out, rel), JSON.stringify(data, null, 1) + '\n');
};

// The page's own local persistence functions (inline in index.html).
function pageFunctions(names) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, 'index.html defines ' + name);
    let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}' && --depth === 0) break;
    }
    return html.slice(start, i + 1);
  }).join('\n');
}
const PAGE_PERSISTENCE = pageFunctions(['saveGame', 'hasSave', 'loadGame']);

// Installed inside the game realm. Observers only record and delegate.
function installRuntime(options) {
  gameEvent.nextTurn = () => {}; gameEvent.hideAll = () => {};
  timer.pauseAndSaveTime = () => {}; timer.setNextTurnTime = () => {};
  nextTurnPauseInterface = {visible: false};
  AiRuntime.trainFromHumanCommands = () => {};
  menuBack = () => { gameExit = true; emit({type: 'terminal', round: gameRound, result: gameSettings.coop.result}); };
  errorWindow = {enableTemporary() { throw new Error('page persistence failed: ' + this.textString); }};
  const noLines = {createLine() {}};
  let serial = 0, action = null, pendingTarget = null;
  const ids = new Map(), origins = new Map();
  const at = c => ({x: c.x, y: c.y});
  const describe = e => {
    if (!ids.has(e)) ids.set(e, ++serial);
    const d = {id: ids.get(e), owner: e.playerColor, role: e.player.role, kind: e.name, coord: at(e.coord), hp: e.hp};
    if (e.isUnit) d.moves = e.moves;
    if (origins.has(e)) d.origin = origins.get(e);
    return d;
  };
  const describeCell = c => {
    const cell = grid.getCell(c), part = x => x.notEmpty() ? {kind: x.name, owner: x.playerColor, role: x.player.role} : null;
    return {coord: at(c), building: part(cell.building), unit: part(cell.unit), fogged: isFogOfWar && !grid.fogOfWar[c.x][c.y]};
  };
  const demonField = (unit, from) => {
    const way = new BestEnemyTargetForAI();
    way.create(from, BestEnemyTargetForAI.unreachableDistance, grid.arr, unit.playerColor, noLines);
    return way;
  };
  const targetDistance = (unit, target) => demonField(unit, target).getDistance(unit.coord);
  // Nearest live human town or unit by the demon's own path metric.
  const nearestHuman = unit => {
    const way = demonField(unit, unit.coord);
    let best = null;
    for (const slot of gameSettings.coop.humanSlots) for (const e of [...players[slot].towns, ...players[slot].units]) {
      if (e.killed) continue;
      const distance = way.getDistance(e.coord);
      if (distance >= BestEnemyTargetForAI.unreachableDistance) continue;
      if (!best || distance < best.distance || (distance === best.distance && (e.coord.x - best.coord.x || e.coord.y - best.coord.y) < 0))
        best = {coord: at(e.coord), kind: e.name, owner: e.playerColor, role: e.player.role, distance};
    }
    return best;
  };
  globalThis.observe = () => ({round: gameRound, turn: whooseTurn, terminal: gameExit, fog: isFogOfWar,
    waveGeneration: gameSettings.coop.waveGeneration || null, localPhase: gameSettings.coop.localPhase || null,
    humans: gameSettings.coop.humanSlots.map(s => ({owner: s, gold: players[s].gold,
      units: players[s].units.filter(u => !u.killed).map(describe), towns: players[s].towns.filter(t => !t.killed).map(describe)})),
    demons: (d => ({gold: d.gold, income: d.income, towns: d.towns.length, goldmines: d.goldmines.length,
      units: d.units.filter(u => !u.killed).map(describe)}))(players[gameSettings.coop.demonSlot]),
    portals: external.filter(e => e.isDemonPortal && !e.killed).map(e => at(e.coord)),
    neutralTowns: players[0].towns.filter(t => !t.killed).length});
  // Local save boundary: production SaveManager.save (updateExternal + saveGame).
  const keys = () => ['grid', 'players', 'external', 'externalProduction', 'nature', 'goldmines', 'whooseTurn',
    'gameRound', 'isFogOfWar', 'gameSettings', ...players.flatMap((_, i) => ['timer' + i, 'Player:' + i])];
  globalThis.readSave = () => Object.fromEntries(keys().map(k => [k, localStorage.getItem(gameSlot + k)]));
  globalThis.persisted = () => ({grid: JSON.stringify(grid), players: JSON.stringify(players), external: JSON.stringify(external),
    externalProduction: JSON.stringify(externalProduction), nature: JSON.stringify(nature), goldmines: JSON.stringify(goldmines),
    whooseTurn: JSON.stringify(whooseTurn), gameRound: JSON.stringify(gameRound), isFogOfWar: String(isFogOfWar),
    gameSettings: JSON.stringify(gameSettings)});
  const manager = new SaveManager(), save = manager.save;
  manager.save = function(...args) {
    const result = save.apply(this, args);
    globalThis.lastSave = {round: gameRound, turn: whooseTurn, data: readSave()};
    emit({type: 'save-boundary', round: gameRound, turn: whooseTurn});
    return result;
  };
  saveManager = manager;
  const spawn = spawnCoopWave;
  spawnCoopWave = function(...args) {
    const result = spawn.apply(this, args);
    const spawned = result.spawned.map(s => { const u = grid.getUnit(s); origins.set(u, {waveRound: args[0], portal: at(s)}); return describe(u); });
    emit({type: 'spawn', round: gameRound, waveRound: args[0], waveSeed: gameSettings.coop.waveGeneration.seed, skipped: result.skipped, spawned});
    return result;
  };
  const advance = advanceCoopLocalPhase;
  advanceCoopLocalPhase = function(...args) {
    const before = gameSettings.coop.localPhase && gameSettings.coop.localPhase.stage;
    const result = advance.apply(this, args);
    emit({type: 'phase', round: gameRound, waveRound: gameSettings.coop.localPhase.round, from: before, to: gameSettings.coop.localPhase.stage});
    return result;
  };
  const neutralNext = players[0].nextTurn;
  players[0].nextTurn = function(...args) {
    const result = neutralNext.apply(this, args);
    emit({type: 'round-state', ...observe()});
    return result;
  };
  if (options.noopDemons) players[gameSettings.coop.demonSlot].combatAI = {play() {}};
  const calculate = BestEnemyTargetForAI.prototype.calculateBestEnemyTarget;
  BestEnemyTargetForAI.prototype.calculateBestEnemyTarget = function(v0, arr, owner) {
    const result = calculate.call(this, v0, arr, owner);
    pendingTarget = {from: at(v0), owner, target: result && describeCell(result)};
    return result;
  };
  const move = InterationWithUnit.prototype.move;
  InterationWithUnit.prototype.move = function(coord, cell, arr, unit) {
    if (action && action.unit === unit) {
      const steps = [];
      for (let c = at(coord), guard = 0; !coordsEqually(c, unit.coord) && guard < 10000; c = this.way.getParent(c), guard++) steps.push(at(c));
      action.record.paths.push({from: at(unit.coord), destination: at(coord), cost: this.way.getDistance(coord), cells: steps.reverse()});
    }
    return move.call(this, coord, cell, arr, unit);
  };
  const send = Unit.prototype.sendInstructions;
  Unit.prototype.sendInstructions = function(cell) {
    const destination = at(cell.coord), before = describe(this);
    const commands = this.isMyTurn ? this.getAvailableCommands() : [];
    const legal = commands.some(c => coordsEqually(c.destinationCoord, destination));
    const record = {type: 'action', round: gameRound, turn: whooseTurn, actor: before, destination, legal,
      destinationState: describeCell(destination), legalCommands: commands.length,
      foggedLegalCommands: isFogOfWar ? commands.filter(c => !grid.fogOfWar[c.destinationCoord.x][c.destinationCoord.y]).length : 0,
      paths: []};
    if (this.player.role === 'DEMONS') {
      const pending = pendingTarget && coordsEqually(pendingTarget.from, this.coord) && pendingTarget.owner === this.playerColor ? pendingTarget : null;
      record.intent = pending ? 'move-toward-target' : 'attack';
      record.target = pending ? pending.target : describeCell(destination);
      if (record.target) record.targetDistanceBefore = targetDistance(this, record.target.coord);
      record.nearestHuman = nearestHuman(this);
    } else record.intent = 'human-command';
    pendingTarget = null;
    action = {unit: this, record};
    try { return send.call(this, cell); }
    finally {
      action = null;
      record.after = describe(this);
      record.moveExpenditure = before.moves - this.moves;
      if (record.target && !this.killed) record.targetDistanceAfter = targetDistance(this, record.target.coord);
      if (record.nearestHuman && !this.killed) record.nearestHuman.distanceAfter = demonField(this, this.coord).getDistance(record.nearestHuman.coord);
      emit(record);
    }
  };
  // Static route field used only to choose among the unit's own legal commands.
  globalThis.routeField = (target, owner) => {
    const n = grid.arr.length, m = grid.arr[0].length, d = Array.from({length: n}, () => new Array(m).fill(-1));
    const open = (x, y) => {
      const cell = grid.arr[x][y], b = cell.building, u = cell.unit;
      if (b.notEmpty() && (b.isObstacle(owner) || (!b.isPassable && b.playerColor !== owner))) return false;
      return !(u.notEmpty() && u.playerColor !== owner);
    };
    const queue = [at(target)]; d[target.x][target.y] = 0;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (const nb of grid.arr[c.x][c.y].hexagon.neighbours) {
        if (isCoordNotOnMap(nb, n, m) || d[nb.x][nb.y] >= 0 || !open(nb.x, nb.y)) continue;
        d[nb.x][nb.y] = d[c.x][c.y] + 1; queue.push(at(nb));
      }
    }
    return d;
  };
  // One legal step of the moving human: toward the lateral entry, then along it.
  globalThis.moverStep = plan => {
    const unit = players[plan.mover].units.find(u => !u.killed);
    if (!unit) return {status: 'no-unit'};
    const from = at(unit.coord);
    if (coordsEqually(from, plan.exit)) return {status: 'arrived', from};
    if (unit.moves <= 0) return {status: 'no-moves', from};
    const lo = Math.min(plan.entry.x, plan.exit.x), hi = Math.max(plan.entry.x, plan.exit.x);
    const onLateral = from.y === plan.exit.y && from.x >= lo && from.x <= hi;
    const waypoint = onLateral ? {x: from.x + Math.sign(plan.exit.x - plan.entry.x), y: plan.exit.y} : plan.entry;
    const field = routeField(waypoint, plan.mover);
    const commands = unit.getAvailableMoveCommands();
    const fogged = isFogOfWar ? commands.filter(c => !grid.fogOfWar[c.destinationCoord.x][c.destinationCoord.y]).map(c => at(c.destinationCoord)) : [];
    const steps = commands.filter(c => unit.interaction.way.getDistance(c.destinationCoord) === 1 &&
      !unit.canHitSomethingOnCell(grid.getCell(c.destinationCoord)) && field[c.destinationCoord.x][c.destinationCoord.y] >= 0)
      .sort((a, b) => field[a.destinationCoord.x][a.destinationCoord.y] - field[b.destinationCoord.x][b.destinationCoord.y] ||
        a.destinationCoord.x - b.destinationCoord.x || a.destinationCoord.y - b.destinationCoord.y);
    const here = field[from.x][from.y], best = steps[0];
    const report = {from, waypoint, legalCommands: commands.length, foggedLegal: fogged, movesBefore: unit.moves};
    if (!best || !(field[best.destinationCoord.x][best.destinationCoord.y] < here || here < 0)) return {status: 'blocked', ...report};
    const destination = at(best.destinationCoord);
    if (options.teleportHuman) {
      // Corruption: relocate the unit without the movement system.
      grid.setUnit(new Empty(), unit.coord); unit.coord = destination; grid.setUnit(unit, destination);
    } else {
      unit.select();
      unit.sendInstructions(grid.getCell(destination));
    }
    return {status: 'moved', ...report, destination, after: at(unit.coord), movesAfter: unit.moves,
      destinationVisible: !isFogOfWar || grid.fogOfWar[destination.x][destination.y] > 0};
  };
}

function lateralPlan(generated) {
  const {playerCount, seed, size} = generated.coop.generation;
  const mountains = new Set(generated.mountains.map(c => `${c.x},${c.y}`));
  for (let a = 0; a < 8; a++) {
    const plan = valley.planDividedValley(playerCount, size, a ? (seed ^ Math.imul(a, 0x9e3779b9)) >>> 0 : seed);
    if (plan.side === generated.mapSize.x && plan.masks.ridge.every(c => mountains.has(`${c.x},${c.y}`))) return {attempt: a, plan};
  }
  throw new Error('no matching valley plan');
}

function runCase(c) {
  const journalFile = path.join(out, 'journals', `${c.id}.jsonl`);
  fs.mkdirSync(path.dirname(journalFile), {recursive: true});
  fs.writeFileSync(journalFile, '');
  const row = {case: c.id, size: c.size, humans: c.humans, seed: SEED, fog: FOG, fault, status: 'running', checks: [],
    journal: path.relative(out, journalFile)};
  const save = () => writeJson(`cases/${c.id}.json`, row);
  const check = (name, pass, detail) => {
    const entry = {name, pass: Boolean(pass), detail};
    row.checks.push(entry); save();
    console.log(JSON.stringify({case: c.id, check: name, pass: entry.pass, detail}));
    assert.ok(pass, name);
  };
  const events = {uninterrupted: [], resumed: []};
  const runtime = (label, options) => {
    const f = createFixture(undefined, () => {}, {nativeIntrinsics: true});
    f.context.emit = event => {
      const copy = {case: c.id, runtime: label, seq: events[label].length, ...JSON.parse(JSON.stringify(event))};
      events[label].push(copy);
      fs.appendFileSync(journalFile, JSON.stringify(copy) + '\n');
    };
    f.evaluate(PAGE_PERSISTENCE + '\nundefined');
    f.context.runtimeOptions = options;
    return f;
  };
  const options = {noopDemons: fault === 'noop-demons', teleportHuman: fault === 'teleport-human'};
  const t0 = Date.now();
  try {
    const f = runtime('uninterrupted', options);
    f.evaluate(`globalThis.generated = generateCoopGame(${c.humans}, {size: '${c.size}', seed: ${SEED}}); undefined`);
    const generated = f.evaluate('JSON.parse(JSON.stringify(generated))');
    row.generation = {...generated.coop.generation, mapSize: generated.mapSize, generatedMs: Date.now() - t0,
      portals: generated.portals, humanTowns: generated.players.slice(1, 1 + c.humans).map(p => p.towns[0]),
      mapSha256: sha(JSON.stringify(generated))};
    check('version-4-generation', isDeepStrictEqual(generated.coop.generation,
      {version: 4, playerCount: c.humans, seed: SEED, size: c.size, options: {seed: SEED, size: c.size}}), generated.coop.generation);
    // GameManager.start(map, fog, isClassicTimer, isOnline) without canvas/menu/animation-loop effects.
    f.evaluate(`(() => {
      isFogOfWar = ${FOG}; gameSettings.isOnline = false
      generated.start({clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
        updateCameraBorders() {}}, false, true)
      whooseTurn = 0; gameRound = 0; actionManager.clear()
      ;(${installRuntime.toString()})(runtimeOptions)
      emit({type: 'start', ...observe()})
      startTurn()
    })()`);
    const config = f.evaluate(`({firstWaveRound: getCoopWaveConfig(gameSettings.coop.balanceVersion).types.imp.unlockRound,
      demonSlot: gameSettings.coop.demonSlot, humanSlots: gameSettings.coop.humanSlots, balanceVersion: gameSettings.coop.balanceVersion,
      combatController: players[gameSettings.coop.demonSlot].constructor.name, suddenDeathRound})`);
    row.configuration = config;
    const {plan, attempt} = lateralPlan(generated);
    row.valley = {attempt, rows: plan.rows, laterals: plan.valley.laterals, passages: plan.valley.passages};
    let mover = null;
    if (c.lateral) {
      // Nearest rear-lateral cell of every human; the pair with the shortest walk
      // that still crosses LATERAL_STEPS lateral cells toward the ally.
      f.context.lateralCells = plan.masks.rearLateral;
      const near = f.evaluate(`gameSettings.coop.humanSlots.map(slot => {
        const town = players[slot].towns[0].coord, field = routeField(town, slot)
        const ranked = lateralCells.map(cell => ({cell, distance: field[cell.x][cell.y]})).filter(r => r.distance >= 0)
          .sort((a, b) => a.distance - b.distance || a.cell.x - b.cell.x)
        return {slot, town: {x: town.x, y: town.y}, nearest: ranked[0] || null}
      })`);
      // The walk must bring the mover closer to the ally: route distance to the
      // ally town from the lateral exit is below that from the entry and the start.
      f.context.nearLateral = near;
      f.context.lateralStepsMin = LATERAL_STEPS;
      const pairs = f.evaluate(`(() => {
        const pairs = []
        for (const m of nearLateral) for (const a of nearLateral) {
          if (m === a || !m.nearest || !a.nearest) continue
          const entry = m.nearest.cell, exit = a.nearest.cell, steps = Math.abs(entry.x - exit.x)
          if (steps < lateralStepsMin) continue
          const field = routeField(a.town, m.slot)
          const allyDistance = {start: field[m.town.x][m.town.y], entry: field[entry.x][entry.y], exit: field[exit.x][exit.y]}
          if (allyDistance.start < 0 || allyDistance.exit < 0 || allyDistance.exit >= allyDistance.entry ||
            allyDistance.exit >= allyDistance.start) continue
          pairs.push({mover: m.slot, ally: a.slot, moverTown: m.town, allyTown: a.town, entry, exit,
            approach: m.nearest.distance, lateralSteps: steps, plannedAllyDistance: allyDistance})
        }
        return pairs
      })()`);
      pairs.sort((p, q) => p.approach + p.lateralSteps - q.approach - q.lateralSteps || p.mover - q.mover || p.ally - q.ally);
      check('lateral-pair-available', pairs.length > 0, {near});
      mover = pairs[0];
      f.context.moverPlan = mover;
      mover.allyDistanceAtStart = f.evaluate(`(() => { const u = players[moverPlan.mover].units.find(u => !u.killed)
        return routeField(moverPlan.allyTown, moverPlan.mover)[u.coord.x][u.coord.y] })()`);
      row.lateral = {pair: mover, turns: []};
    }
    const state = fx => fx.evaluate('({round: gameRound, turn: whooseTurn, exit: gameExit})');
    const status = {departure: false, traversal: !c.lateral, resume: !c.resume};
    // One human turn: the mover takes legal steps until its moves are spent; others end the turn.
    const humanTurn = (fx, label) => {
      const s = state(fx);
      if (mover && s.turn === mover.mover) {
        const turn = {runtime: label, round: s.round, steps: []};
        for (let i = 0; i < 8; i++) {
          const start = events[label].length;
          const step = fx.evaluate('moverStep(moverPlan)');
          step.actions = events[label].slice(start).filter(e => e.type === 'action');
          turn.steps.push(step);
          if (step.status !== 'moved') break;
          const act = step.actions;
          const cells = act.flatMap(a => a.paths.flatMap(p => p.cells));
          check('human-legal-movement', act.length === 1 && act[0].legal && act[0].paths.length === 1 &&
            isDeepStrictEqual(act[0].paths[0].from, step.from) && isDeepStrictEqual(cells, [step.after]) &&
            act[0].moveExpenditure === act[0].paths[0].cost && step.movesBefore - step.movesAfter === cells.length,
          {round: s.round, from: step.from, destination: step.destination, after: step.after, actions: act.length});
          check('human-fog-restriction', !FOG || (step.foggedLegal.length === 0 && step.destinationVisible && act[0].foggedLegalCommands === 0),
            {round: s.round, foggedLegal: step.foggedLegal, destinationVisible: step.destinationVisible});
        }
        if (label === 'uninterrupted') row.lateral.turns.push(turn);
        fx.context.moverTurnResult = turn;
      }
      fx.evaluate(`emit({type: 'human-end-turn', round: gameRound, owner: whooseTurn}); nextTurn(); undefined`);
      return state(fx);
    };
    const completedRound = (label, round) => events[label].filter(e => e.type === 'round-state' && e.round === round + 1);
    const checkRound = (label, completed) => {
      const rs = completedRound(label, completed).pop();
      check('demon-economic-exclusion', rs && rs.demons.gold === 0 && rs.demons.income === 0 && rs.demons.towns === 0 &&
        rs.demons.goldmines === 0 && rs.neutralTowns === generated.players[0].towns.length,
      rs && {runtime: label, round: rs.round, demons: {gold: rs.demons.gold, towns: rs.demons.towns, goldmines: rs.demons.goldmines},
        neutralTowns: rs.neutralTowns});
      const demonActions = events[label].filter(e => e.type === 'action' && e.round === completed && e.actor.role === 'DEMONS');
      check('demon-actions-legal', demonActions.every(a => a.legal), {runtime: label, round: completed, actions: demonActions.length});
      return rs;
    };
    row.rounds = [];
    let s = state(f), resumeSave = null, peerStart = 0;
    while (!(status.departure && status.traversal && status.resume)) {
      check('no-terminal-before-demonstration', !s.exit, s);
      if (c.resume && !resumeSave && s.round === RESUME.round && s.turn === config.humanSlots[0]) {
        resumeSave = f.evaluate('lastSave');
        check('resume-save-boundary', resumeSave.round === RESUME.round && resumeSave.turn === config.humanSlots[0],
          {round: resumeSave.round, turn: resumeSave.turn});
        peerStart = events.uninterrupted.length;
      }
      const before = s.round;
      s = humanTurn(f, 'uninterrupted');
      if (s.round === before) continue;
      const rs = checkRound('uninterrupted', before);
      row.rounds.push({completed: before, state: rs, persistedSha256: sha(JSON.stringify(f.evaluate('persisted()')))});
      console.log(`ROUND ${c.id} completed=${before} demons=${rs.demons.units.length} humanUnits=${rs.humans.reduce((n, h) => n + h.units.length, 0)}`);
      if (before + 1 === config.firstWaveRound) {
        const spawns = events.uninterrupted.filter(e => e.type === 'spawn' && e.waveRound === config.firstWaveRound);
        const spawnedIds = new Set(spawns.flatMap(e => e.spawned.map(u => u.id)));
        const portals = new Set(generated.portals.map(p => `${p.x},${p.y}`));
        const departures = events.uninterrupted.filter(e => e.type === 'action' && e.round === before && spawnedIds.has(e.actor.id) &&
          portals.has(`${e.actor.coord.x},${e.actor.coord.y}`) && e.actor.origin &&
          isDeepStrictEqual(e.actor.coord, e.actor.origin.portal));
        // Toward a human: the path distance to the nearest live human town/unit strictly drops.
        const valid = departures.filter(d => d.legal && d.intent === 'move-toward-target' && d.target &&
          d.nearestHuman && d.nearestHuman.role === 'HUMAN' && d.nearestHuman.distanceAfter < d.nearestHuman.distance &&
          !portals.has(`${d.after.coord.x},${d.after.coord.y}`) && d.paths.length === 1 &&
          d.paths[0].cells.length === d.paths[0].cost && d.moveExpenditure === d.paths[0].cost && d.moveExpenditure >= 1 &&
          d.targetDistanceAfter < d.targetDistanceBefore);
        const targetKinds = {};
        for (const d of departures) {
          const t = d.target && (d.target.building || d.target.unit), key = t ? `${t.kind}:${t.role}` : 'none';
          targetKinds[key] = (targetKinds[key] || 0) + 1;
        }
        row.demonDeparture = {waveRound: config.firstWaveRound, spawned: spawns.flatMap(e => e.spawned),
          departures: departures.map(d => ({actor: d.actor, intendedTarget: d.target, path: d.paths.flatMap(p => p.cells),
            moveExpenditure: d.moveExpenditure, after: d.after.coord, targetDistance: [d.targetDistanceBefore, d.targetDistanceAfter],
            nearestHuman: d.nearestHuman, legal: d.legal})),
          intendedTargetKinds: targetKinds, validDepartures: valid.length, allDepartures: departures.length};
        // Every departure is a legal production action (demon-actions-legal); at least one
        // must leave its portal toward a human. Others remain recorded with their metrics.
        check('demon-leaves-portal', spawnedIds.size > 0 && valid.length > 0 && departures.every(d => d.legal),
          {spawned: spawnedIds.size, departures: departures.length, valid: valid.length, intendedTargetKinds: targetKinds});
        status.departure = true;
      }
      if (c.lateral && !status.traversal) {
        const unitNow = f.evaluate('(() => { const u = players[moverPlan.mover].units.find(u => !u.killed); return u ? {x: u.coord.x, y: u.coord.y} : null })()');
        if (unitNow && isDeepStrictEqual(unitNow, mover.exit)) {
          const cells = row.lateral.turns.flatMap(t => t.steps.filter(x => x.status === 'moved').map(x => x.after));
          const dir = Math.sign(mover.exit.x - mover.entry.x);
          const expected = Array.from({length: mover.lateralSteps + 1}, (_, i) => ({x: mover.entry.x + dir * i, y: mover.exit.y}));
          const tail = cells.slice(cells.length - expected.length);
          const allyDistance = f.evaluate('routeField(moverPlan.allyTown, moverPlan.mover)[moverPlan.exit.x][moverPlan.exit.y]');
          row.lateral.traversed = cells; row.lateral.allyDistance = [mover.allyDistanceAtStart, allyDistance];
          row.lateral.completedRound = before;
          check('lateral-traversal-toward-ally', isDeepStrictEqual(tail, expected) &&
            cells.slice(0, cells.length - expected.length).every(x => x.y !== mover.exit.y || x.x < Math.min(mover.entry.x, mover.exit.x) ||
              x.x > Math.max(mover.entry.x, mover.exit.x)) && allyDistance < mover.allyDistanceAtStart &&
            plan.masks.rearLateral.some(m => isDeepStrictEqual(m, mover.entry)) && plan.masks.rearLateral.some(m => isDeepStrictEqual(m, mover.exit)),
          {entry: mover.entry, exit: mover.exit, lateralSteps: mover.lateralSteps, traversed: cells, allyDistance: row.lateral.allyDistance});
          status.traversal = true;
        } else check('lateral-traversal-within-round-limit', before + 1 < MAX_ROUND && unitNow, {round: before + 1, unit: unitNow});
      }
      if (c.resume && resumeSave && !status.resume && before === RESUME.round) {
        const peerAfter = f.evaluate('lastSave');
        const peerEvents = events.uninterrupted.slice(peerStart);
        const g = runtime('resumed', {noopDemons: false, teleportHuman: false});
        g.context.savedGame = resumeSave.data;
        g.context.moverPlan = mover;
        const loaded = g.evaluate(`(() => {
          for (const [key, value] of Object.entries(savedGame)) if (value !== null) localStorage.setItem(gameSlot + key, value)
          const ok = loadGame()
          actionManager.clear()
          ;(${installRuntime.toString()})(runtimeOptions)
          return {ok, persisted: persisted(), round: gameRound, turn: whooseTurn}
        })()`);
        const savedPersisted = Object.fromEntries(Object.keys(loaded.persisted).map(k => [k, resumeSave.data[k]]));
        check('resume-snapshot-equality', loaded.ok && isDeepStrictEqual(loaded.persisted, savedPersisted),
          {loaded: loaded.ok, keys: Object.keys(savedPersisted).filter(k => loaded.persisted[k] !== savedPersisted[k])});
        if (fault === 'reseed-resume') g.evaluate('gameSettings.coop.waveGeneration.seed = (gameSettings.coop.waveGeneration.seed + 1) >>> 0; undefined');
        let r = state(g);
        while (r.round === RESUME.round) r = humanTurn(g, 'resumed');
        checkRound('resumed', RESUME.round);
        const resumedAfter = g.evaluate('lastSave');
        const normalize = list => list.filter(e => e.type !== 'start').map(({case: _c, runtime: _r, seq: _s, ...e}) =>
          JSON.parse(JSON.stringify(e, (k, v) => k === 'id' || k === 'origin' ? undefined : v)));
        const peerJournal = normalize(peerEvents), resumedJournal = normalize(events.resumed);
        const differing = Object.keys(peerAfter.data).filter(k => peerAfter.data[k] !== resumedAfter.data[k]);
        const firstJournalDifference = peerJournal.findIndex((e, i) => !isDeepStrictEqual(e, resumedJournal[i]));
        const roundActions = list => list.filter(e => e.type === 'action');
        const summary = {size: c.size, humans: c.humans, savedAt: {round: resumeSave.round, turn: resumeSave.turn},
          nextSave: {round: peerAfter.round, turn: peerAfter.turn}, resumedNextSave: {round: resumedAfter.round, turn: resumedAfter.turn},
          saveSha256: sha(JSON.stringify(resumeSave.data)), uninterruptedSha256: sha(JSON.stringify(peerAfter.data)),
          resumedSha256: sha(JSON.stringify(resumedAfter.data)), differingKeys: differing,
          journalEvents: [peerJournal.length, resumedJournal.length], firstJournalDifference,
          actions: {uninterrupted: roundActions(peerJournal).length, resumed: roundActions(resumedJournal).length,
            demon: roundActions(peerJournal).filter(a => a.actor.role === 'DEMONS').length,
            human: roundActions(peerJournal).filter(a => a.actor.role === 'HUMAN').length},
          spawns: peerJournal.filter(e => e.type === 'spawn').map(e => e.spawned.length)};
        writeJson(`peer-rounds/${c.id}-save-round${RESUME.round}.json`, resumeSave);
        writeJson(`peer-rounds/${c.id}-uninterrupted-round${RESUME.round + 1}.json`, peerAfter);
        writeJson(`peer-rounds/${c.id}-resumed-round${RESUME.round + 1}.json`, resumedAfter);
        writeJson(`peer-rounds/${c.id}-journals-round${RESUME.round}.json`, {uninterrupted: peerJournal, resumed: resumedJournal});
        row.resume = summary;
        check('resumed-round-parity', peerAfter.round === RESUME.round + 1 && resumedAfter.round === RESUME.round + 1 &&
          differing.length === 0 && peerJournal.length === resumedJournal.length && firstJournalDifference < 0 &&
          summary.actions.demon > 0, summary);
        status.resume = true;
      }
    }
    const allActions = events.uninterrupted.filter(e => e.type === 'action');
    row.demonFogIndependence = {actions: allActions.filter(a => a.actor.role === 'DEMONS').length,
      actionsIntoHumanFog: allActions.filter(a => a.actor.role === 'DEMONS' && a.destinationState.fogged).length,
      legalCommandsInHumanFog: allActions.filter(a => a.actor.role === 'DEMONS').reduce((n, a) => n + a.foggedLegalCommands, 0)};
    row.finalRound = s.round;
    row.status = 'passed';
    console.log(`PASS valley-runtime ${c.id} rounds=${s.round} departures=${row.demonDeparture.validDepartures}` +
      (c.lateral ? ` lateral=${mover.lateralSteps} mover=${mover.mover} ally=${mover.ally}` : '') + (c.resume ? ' resume=parity' : ''));
  } catch (error) {
    row.status = 'failed'; row.error = error.stack;
    throw error;
  } finally {
    row.elapsedMs = Date.now() - t0;
    save();
  }
}

function main() {
  const t0 = Date.now();
  fs.mkdirSync(out, {recursive: true});
  for (const dir of ['cases', 'journals', 'peer-rounds']) fs.rmSync(path.join(out, dir), {recursive: true, force: true});
  const results = [];
  for (const c of CASES) {
    const started = Date.now();
    const child = spawnSync(process.execPath, [__filename, '--case', c.id, '--output-dir', out],
      {stdio: ['ignore', 'inherit', 'inherit'], timeout: CASE_TIMEOUT_MS});
    const file = path.join(out, 'cases', `${c.id}.json`);
    const row = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {case: c.id, status: 'missing'};
    row.exitStatus = child.status; row.signal = child.signal; row.wallMs = Date.now() - started;
    console.log(`CASE_EXIT ${c.id} status=${child.status} signal=${child.signal} wallMs=${row.wallMs}`);
    results.push(row);
  }
  fs.writeFileSync(path.join(out, 'action-journals.jsonl'),
    CASES.map(c => fs.readFileSync(path.join(out, 'journals', `${c.id}.jsonl`), 'utf8')).join(''));
  // Negative controls run one narrowed case each and must fail on the named assertion.
  const negatives = [];
  for (const [name, spec] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-control', name);
    fs.rmSync(dir, {recursive: true, force: true});
    const args = [__filename, '--case', spec.case, '--fault', name, '--output-dir', dir];
    console.log('BEGIN negative control: ' + [process.execPath, ...args.map(a => path.isAbsolute(a) ? path.relative(process.cwd(), a) : a)].join(' '));
    const child = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: CASE_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024});
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'stdout.log'), child.stdout || '');
    fs.writeFileSync(path.join(dir, 'stderr.log'), child.stderr || '');
    const assertion = ((child.stderr || '').match(/AssertionError \[ERR_ASSERTION\]: (.*)/) || [])[1] || null;
    const failedChecks = fs.existsSync(path.join(dir, 'cases', `${spec.case}.json`)) ?
      JSON.parse(fs.readFileSync(path.join(dir, 'cases', `${spec.case}.json`))).checks.filter(x => !x.pass).map(x => x.name) : [];
    const result = {fault: name, case: spec.case, expectedAssertion: spec.assertion, exitStatus: child.status, signal: child.signal,
      assertion, failedChecks, pass: child.status === 1 && assertion === spec.assertion && isDeepStrictEqual(failedChecks, [spec.assertion])};
    process.stdout.write((child.stdout || '').split('\n').filter(l => /"pass":false|^PASS|^ROUND/.test(l)).join('\n') + '\n');
    process.stdout.write(child.stderr || '');
    console.log(`END negative control ${name} actual_exit_status=${child.status} assertion=${assertion} failedChecks=${failedChecks.join(',')}`);
    negatives.push(result);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...SOURCES], {cwd: ROOT, encoding: 'utf8'});
  writeJson('source-identities.json', {node: process.version, algorithm: 'sha256', head,
    workingTreeChanges: dirty.split('\n').filter(Boolean),
    files: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]))});
  const passed = results.filter(r => r.status === 'passed' && r.exitStatus === 0);
  const summary = {cases: results.length, passed: passed.length,
    departures: results.filter(r => r.demonDeparture && r.demonDeparture.validDepartures > 0).length,
    lateral: results.filter(r => r.lateral && r.lateral.traversed).map(r => `${r.case}:${r.lateral.pair.lateralSteps}`),
    resumes: results.filter(r => r.resume && r.resume.differingKeys.length === 0).map(r => r.case),
    demonActionsIntoHumanFog: results.reduce((n, r) => n + (r.demonFogIndependence ? r.demonFogIndependence.actionsIntoHumanFog : 0), 0),
    negativeControls: negatives.map(n => `${n.fault}:${n.exitStatus}:${n.assertion}`), elapsedSeconds: Math.round((Date.now() - t0) / 1000)};
  writeJson('checkpoints.json', {test: 'ai/test-coop-valley-runtime.js', node: process.version, cwd: process.cwd(), head,
    matrix: {sizes: SIZES, humans: HUMANS, seed: SEED, fog: FOG, resume: RESUME, lateralSteps: LATERAL_STEPS, maxRound: MAX_ROUND},
    summary, cases: results, negativeControls: negatives});
  const ok = passed.length === CASES.length && summary.departures === CASES.length &&
    summary.lateral.length === CASES.filter(c => c.lateral).length && summary.resumes.length === SIZES.length &&
    summary.demonActionsIntoHumanFog > 0 && negatives.every(n => n.pass);
  console.log(`${ok ? 'PASS' : 'FAIL'} valley-runtime cases=${summary.passed}/${summary.cases} departures=${summary.departures}/${CASES.length} ` +
    `lateral=${summary.lateral.join(',')} resumeParity=${summary.resumes.join(',')} demonActionsIntoHumanFog=${summary.demonActionsIntoHumanFog} ` +
    `negativeControls=${summary.negativeControls.join(',')} elapsed=${summary.elapsedSeconds}s`);
  if (!ok) process.exitCode = 1;
}

const caseId = option('--case');
if (caseId) {
  const c = CASES.find(x => x.id === caseId);
  assert.ok(c, 'unknown case ' + caseId);
  runCase(c);
} else {
  main();
}
