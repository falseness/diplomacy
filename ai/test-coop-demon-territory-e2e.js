'use strict';
// End-to-end local co-op game: demons claim territory and run an economy.
// A generated tiny co-op map (2 humans) is started like a local game; both human
// slots are the existing economy AI (SimpleAiPlayerWithEconomy) and the harness
// only calls nextTurn(), so the human turns, the wave stage and the demon stage
// all run through the normal local phase loop (advanceCoopLocalPhase).
// Observers delegate to the original methods and only record.
// Usage:
//   node ai/test-coop-demon-territory-e2e.js [--output-dir <dir>] [--seed <n>] [--max-rounds <n>]
// Writes <dir>/rounds.jsonl (one line per round) and <dir>/summary.json.
const fs = require('fs');
const path = require('path');
const {createFixture} = require('./test-coop-harness');

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
// Seeds 1..50 were searched (TASK-420): on most of them the economy-AI humans
// lose before the demons' first barrack finishes; 49 shows every asserted event.
const DEFAULT_SEED = 49;
const seed = arg('--seed') === null ? DEFAULT_SEED : Number(arg('--seed'));
const maxRounds = arg('--max-rounds') === null ? 40 : Number(arg('--max-rounds'));
const output = arg('--output-dir');
const POLICY = 'SimpleAiPlayerWithEconomy';
const ORDINARY = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'];
const BARRACK_UNITS = ['Archer', 'KOHb', 'Normchel', 'Catapult'];
const started = Date.now();

function instrument() {
  const demonSlot = gameSettings.coop.demonSlot, demon = players[demonSlot];
  const events = globalThis.__events = [];
  const ownerKind = p => !p ? null : p.role === 'DEMONS' ? 'demon' : p.role === 'HUMAN' ? 'human' : 'neutral';
  const emit = e => events.push({round: gameRound, turn: whooseTurn, ...e});
  // Presentation and persistence side effects only.
  gameEvent.nextTurn = () => {};
  timer.pauseAndSaveTime = () => {};
  timer.setNextTurnTime = () => {};
  nextTurnPauseInterface = {visible: false};
  globalThis.saveManager = {save() {}};
  AiRuntime.trainFromHumanCommands = () => {};
  menuBack = () => { gameExit = true; emit({type: 'terminal', result: gameSettings.coop.result}); };
  // Captures: a town or goldmine whose cell a demon unit enters and repaints.
  const paint = InterationWithUnit.prototype.paintHexagons;
  InterationWithUnit.prototype.paintHexagons = function(coord, arr, unit, kill) {
    const building = grid.getBuilding(coord);
    const isDemon = unit.player === demon;
    const before = building.notEmpty() ? {name: building.name, isTown: building.isTown(),
      isMine: building instanceof Goldmine, owner: building.isTown() ? ownerKind(building.player) :
        ownerKind(players[grid.getHexagon(coord).playerColor])} : null;
    const value = paint.call(this, coord, arr, unit, kill);
    if (isDemon && before) {
      const after = grid.getBuilding(coord);
      if (before.isTown && after.notEmpty() && after.isTown() && after.player === demon && before.owner !== 'demon')
        emit({type: before.owner === 'human' ? 'capture-human-town' : 'capture-neutral-town', x: coord.x, y: coord.y,
          unit: unit.constructor.name});
      if (before.isMine && before.owner !== 'demon' && demon.isOurGoldmine(after))
        emit({type: 'capture-mine', x: coord.x, y: coord.y, from: before.owner, unit: unit.constructor.name});
    }
    return value;
  };
  // Razes: any player answering yes, or a town destroyed by any means.
  for (const P of [Player, DemonPlayer]) {
    const raze = P.prototype.shouldRazeBuilding;
    if (Object.prototype.hasOwnProperty.call(P.prototype, 'shouldRazeBuilding'))
      P.prototype.shouldRazeBuilding = function(b) {
        const r = raze.call(this, b);
        if (r) emit({type: 'raze', by: ownerKind(this), building: b.name, x: b.coord.x, y: b.coord.y});
        return r;
      };
  }
  const destroy = Town.prototype.destroy;
  if (destroy) Town.prototype.destroy = function(...args) {
    emit({type: 'raze', by: 'destroy', building: this.name, owner: ownerKind(this.player), x: this.coord.x, y: this.coord.y});
    return destroy.apply(this, args);
  };
  // Demon productions started (every economy purchase charged to the demon slot).
  const start = SimpleAiPlayerWithEconomy.prototype.startEconomyProduction;
  SimpleAiPlayerWithEconomy.prototype.startEconomyProduction = function(choice) {
    const goldBefore = this.gold, ok = start.call(this, choice);
    if (ok && this.getPlayerIndex() === demonSlot)
      emit({type: 'production-started', producer: choice.producer.name, x: choice.producer.coord.x,
        y: choice.producer.coord.y, product: choice.product, goldBefore, goldAfter: this.gold});
    return ok;
  };
  // Every successful prepare by a demon-owned town or barrack (war-mode buys skip
  // startEconomyProduction); the started unit productions are remembered so a
  // completion is credited to the demons only when they paid for it.
  const demonStarted = new WeakSet();
  let prepareDepth = 0;
  for (const proto of [PreparingManufacture.prototype, Town.prototype]) {
    const prepare = proto.prepare;
    proto.prepare = function(what) {
      if (prepareDepth || this.player !== demon) return prepare.call(this, what);
      const goldBefore = demon.gold, unitBefore = this.unitProduction, queued = this.buildingProduction ?
        this.buildingProduction.length : 0;
      let ok;
      prepareDepth++;
      try { ok = prepare.call(this, what); } finally { prepareDepth--; }
      if (ok) {
        if (this.unitProduction !== unitBefore) demonStarted.add(this.unitProduction);
        if (this.buildingProduction) for (const b of this.buildingProduction.slice(queued)) demonStarted.add(b);
        emit({type: 'prepare', producer: this.name, x: this.coord.x, y: this.coord.y, product: what, goldBefore,
          goldAfter: demon.gold});
      }
      return ok;
    };
  }
  // Building productions (suburb, farm, barrack) are paid when the town places them.
  const place = Town.prototype.sendInstructions;
  Town.prototype.sendInstructions = function(cell) {
    if (this.player !== demon) return place.call(this, cell);
    const jobs = new Set(this.buildingProduction), goldBefore = demon.gold, product = this.activeProduction.name ?? null;
    const v = place.call(this, cell);
    const added = this.buildingProduction.filter(j => !jobs.has(j));
    for (const j of added) demonStarted.add(j);
    if (added.length) emit({type: 'placement', producer: this.name, product, x: cell.coord.x, y: cell.coord.y,
      goldBefore, goldAfter: demon.gold});
    return v;
  };
  const unitLogic = PreparingManufacture.prototype.unitPreparingLogic;
  PreparingManufacture.prototype.unitPreparingLogic = function(...a) {
    const job = this.unitProduction, owner = this.player;
    const v = unitLogic.apply(this, a);
    if (owner === demon && job && job.name && job !== this.unitProduction) {
      const unit = grid.getUnit(this.coord);
      emit({type: 'production-completed', producer: this.name, x: this.coord.x, y: this.coord.y, product: job.name,
        unit: unit.notEmpty() ? unit.constructor.name : null, unitOwner: unit.notEmpty() ? ownerKind(unit.player) : null,
        paidByDemons: demonStarted.has(job)});
    }
    return v;
  };
  const buildingLogic = Town.prototype.buildingPreparingLogic;
  Town.prototype.buildingPreparingLogic = function(...a) {
    const before = new Set(this.buildings), jobs = new Set(this.buildingProduction), owner = this.player;
    const v = buildingLogic.apply(this, a);
    if (owner === demon) for (const b of this.buildings) if (!before.has(b))
      emit({type: 'production-completed', producer: 'town', x: b.coord.x, y: b.coord.y, product: b.name, unit: null,
        paidByDemons: [...jobs].some(j => !this.buildingProduction.includes(j) && demonStarted.has(j))});
    return v;
  };
  // Demon gold is sampled after every step that can change it.
  globalThis.__minGold = demon.gold;
  const sample = () => { if (demon.gold < __minGold) __minGold = demon.gold; };
  const demonPlay = DemonPlayer.prototype.play;
  DemonPlayer.prototype.play = function(...a) { sample(); const v = demonPlay.apply(this, a); sample(); return v; };
  const demonTurn = DemonPlayer.prototype.nextTurn;
  DemonPlayer.prototype.nextTurn = function(...a) { sample(); const v = demonTurn.apply(this, a); sample(); return v; };
  const phase = advanceCoopLocalPhase;
  globalThis.__phases = [];
  advanceCoopLocalPhase = function() {
    __phases.push(gameSettings.coop.localPhase.stage);
    const v = phase.apply(this, arguments); sample(); return v;
  };
  globalThis.__known = new Set(demon.units);
  globalThis.__buildings = new Set();
  globalThis.__observe = () => {
    const towns = demon.towns.filter(t => !t.killed);
    const units = demon.units.filter(u => !u.killed);
    const byClass = {};
    for (const u of units) byClass[u.constructor.name] = (byClass[u.constructor.name] || 0) + 1;
    const fresh = units.filter(u => !__known.has(u));
    for (const u of fresh) __known.add(u);
    const buildings = towns.flatMap(t => t.buildings.filter(b => !b.killed));
    const newBuildings = buildings.filter(b => !__buildings.has(b));
    for (const b of newBuildings) __buildings.add(b);
    const allTowns = players.flatMap(p => p.towns.filter(t => !t.killed));
    return JSON.stringify({round: gameRound, turn: whooseTurn, terminal: gameExit, result: gameSettings.coop.result ?? null,
      demon: {gold: demon.gold, income: demon.income, salary: demon.armySalary,
        towns: towns.map(t => ({x: t.coord.x, y: t.coord.y, hp: t.hp, suburbs: t.suburbsCount})),
        mines: goldmines.filter(g => demon.isOurGoldmine(g)).map(g => ({x: g.coord.x, y: g.coord.y, income: g.income})),
        unitsByClass: byClass,
        ordinaryUnits: units.filter(u => ORDINARY_NAMES.includes(u.constructor.name)).length,
        buildings: buildings.map(b => b.name)},
      newDemonUnits: fresh.map(u => ({cls: u.constructor.name, x: u.coord.x, y: u.coord.y,
        ordinary: ORDINARY_NAMES.includes(u.constructor.name)})),
      newDemonBuildings: newBuildings.map(b => ({name: b.name, x: b.coord.x, y: b.coord.y})),
      humans: gameSettings.coop.humanSlots.map(s => ({slot: s, lost: players[s].isLost, gold: players[s].gold,
        towns: players[s].towns.filter(t => !t.killed).length, units: players[s].units.filter(u => !u.killed).length})),
      townCount: allTowns.length,
      portals: external.filter(p => p.isDemonPortal && !p.killed).length});
  };
  __observe();
}

const f = createFixture(undefined, () => {}, {nativeIntrinsics: true});
const ev = source => f.evaluate(source);
// Deterministic random source inside the realm (AI and demon tie-breaks).
ev(`(() => { let s = ${seed} >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })(); undefined`);
ev(`globalThis.generated = generateCoopGame(2, {size: 'tiny', seed: ${seed}});
  generated.players.forEach((p, i) => { if (generated.coop.humanSlots.includes(i)) p.playerType = '${POLICY}' }); undefined`);
ev(`isFogOfWar = false; gameSettings.isOnline = false
  generated.start({clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
    updateCameraBorders() {}}, false)
  whooseTurn = 0; actionManager.clear(); globalThis.ORDINARY_NAMES = ${JSON.stringify(ORDINARY)}; undefined`);
ev(`(${instrument.toString()})(); undefined`);
const config = JSON.parse(ev(`JSON.stringify({humanSlots: gameSettings.coop.humanSlots, demonSlot: gameSettings.coop.demonSlot,
  slots: players.map((p, i) => ({slot: i, class: p.constructor.name, role: p.role ?? null}))})`));

if (output) fs.mkdirSync(output, {recursive: true});
const roundsFile = output ? path.join(output, 'rounds.jsonl') : null;
if (roundsFile) fs.writeFileSync(roundsFile, '');
const rounds = [];
let obs = JSON.parse(ev('__observe()'));
let turns = 0;
const allEvents = [];
let current = {round: obs.round, events: [], newDemonUnits: [], newDemonBuildings: [], phases: []};
const flush = () => {
  const row = {round: current.round, demonGold: obs.demon.gold, demonIncome: obs.demon.income, demonSalary: obs.demon.salary,
    demonTowns: obs.demon.towns, demonMines: obs.demon.mines, demonUnitsByClass: obs.demon.unitsByClass,
    demonBuildings: obs.demon.buildings, humans: obs.humans, portals: obs.portals, phases: current.phases,
    events: current.events, newDemonUnits: current.newDemonUnits, newDemonBuildings: current.newDemonBuildings,
    terminal: obs.terminal, result: obs.result};
  rounds.push(row);
  if (roundsFile) fs.appendFileSync(roundsFile, JSON.stringify(row) + '\n');
};
while (!obs.terminal && obs.round <= maxRounds && turns < maxRounds * 20) {
  ev('nextTurn(); undefined');
  turns++;
  const next = JSON.parse(ev('__observe()'));
  const events = JSON.parse(ev('JSON.stringify(__events.splice(0))'));
  const phases = JSON.parse(ev('JSON.stringify(__phases.splice(0))'));
  allEvents.push(...events);
  current.events.push(...events);
  current.phases.push(...phases);
  current.newDemonUnits.push(...next.newDemonUnits);
  current.newDemonBuildings.push(...next.newDemonBuildings);
  obs = next;
  if (obs.round !== current.round || obs.terminal) {
    flush();
    current = {round: obs.round, events: [], newDemonUnits: [], newDemonBuildings: [], phases: []};
  }
}
const final = JSON.parse(ev(`JSON.stringify((() => {
  const demon = players[gameSettings.coop.demonSlot];
  const live = p => p.units.some(u => !u.killed) || p.towns.some(t => !t.killed);
  return {result: gameSettings.coop.result ?? null, terminal: gameExit,
    humansAlive: gameSettings.coop.humanSlots.filter(s => !players[s].isLost && live(players[s])).length,
    demonTowns: demon.towns.filter(t => !t.killed).length, demonUnits: demon.units.filter(u => !u.killed).length,
    portals: external.filter(p => p.isDemonPortal && !p.killed).length,
    evaluated: (() => { try { return players.find(p => p.isNeutral || p instanceof NeutralPlayer).coopResult ?? null }
      catch (e) { return 'error: ' + e.message } })()}
})())`));

const first = predicate => { const r = rounds.find(predicate); return r ? r.round : null; };
const firstEvent = type => first(r => r.events.some(e => (Array.isArray(type) ? type : [type]).includes(e.type)));
const firstRound = {
  townCapture: firstEvent(['capture-human-town', 'capture-neutral-town']),
  humanTownCapture: firstEvent('capture-human-town'),
  neutralTownCapture: firstEvent('capture-neutral-town'),
  mineCapture: firstEvent('capture-mine'),
  demonMineOwned: first(r => r.demonMines.length > 0),
  productionStarted: firstEvent('production-started'),
  producedNoob: first(r => r.events.some(e => e.type === 'production-completed' && e.paidByDemons &&
    e.unit === 'Noob' && e.unitOwner === 'demon')),
  barrackUnitCompleted: first(r => r.events.some(e => e.type === 'production-completed' && e.paidByDemons &&
    e.producer === 'barrack' && BARRACK_UNITS.includes(e.unit) && e.unitOwner === 'demon')),
  barrackUnit: first(r => BARRACK_UNITS.some(c => r.demonUnitsByClass[c] > 0)),
  barrackBuilt: first(r => r.demonBuildings.includes('barrack')),
};
const razes = allEvents.filter(e => e.type === 'raze');
const minGold = Math.min(JSON.parse(ev('__minGold')), ...rounds.map(r => r.demonGold));
const consistent = (() => {
  // A shared result must match the board: victory needs no portal, demon unit or demon town;
  // defeat needs no live human; an open game has humans and demon assets left.
  if (final.result === 'victory') return final.portals === 0 && final.demonUnits === 0 && final.demonTowns === 0;
  if (final.result === 'defeat') return final.humansAlive === 0;
  if (final.result === 'draw') return final.humansAlive === 0 && final.portals === 0 && final.demonUnits === 0 && final.demonTowns === 0;
  return !final.terminal && final.humansAlive > 0 && (final.portals + final.demonUnits + final.demonTowns) > 0 &&
    (final.evaluated === null || final.evaluated === undefined);
})();

const checks = [
  ['town-capture', firstRound.townCapture !== null, {round: firstRound.townCapture, human: firstRound.humanTownCapture,
    neutral: firstRound.neutralTownCapture, events: allEvents.filter(e => /capture-.*town/.test(e.type)).length}],
  ['mine-capture', firstRound.demonMineOwned !== null, {firstOwnedRound: firstRound.demonMineOwned,
    firstCaptureEvent: firstRound.mineCapture, captures: allEvents.filter(e => e.type === 'capture-mine').length}],
  ['produced-noob', firstRound.producedNoob !== null, {round: firstRound.producedNoob,
    noobPrepares: allEvents.filter(e => e.type === 'prepare' && e.product === 'noob').length,
    noobsCompleted: allEvents.filter(e => e.type === 'production-completed' && e.unit === 'Noob' && e.paidByDemons).length}],
  ['barrack-unit', firstRound.barrackUnit !== null && firstRound.barrackUnitCompleted !== null,
    {ownedRound: firstRound.barrackUnit, completedRound: firstRound.barrackUnitCompleted, barrackBuilt: firstRound.barrackBuilt,
      prepares: allEvents.filter(e => e.type === 'prepare' && e.producer === 'barrack').map(e => e.product)}],
  ['zero-razes', razes.length === 0, {razes}],
  ['no-negative-gold', minGold >= 0, {minGold}],
  ['result-consistent', consistent, {final}],
];
const wallSeconds = (Date.now() - started) / 1000;
const summary = {seed, maxRounds, roundsRecorded: rounds.length, turns, config, firstRound, final, wallSeconds,
  checks: checks.map(([name, pass, observed]) => ({name, pass, observed}))};
if (output) fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`seed ${seed} rounds ${rounds.length} turns ${turns} final ${JSON.stringify(final)}`);
console.log(`first-rounds ${JSON.stringify(firstRound)}`);
let failed = 0;
for (const [name, pass, observed] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(observed)}`);
}
console.log(`wall_time ${wallSeconds.toFixed(1)} s (limit 900 s)`);
if (wallSeconds >= 900) { failed++; console.log('FAIL wall-time'); }
process.exit(failed ? 1 : 0);
