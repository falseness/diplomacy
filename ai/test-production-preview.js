'use strict';
// TASK-157: shared production preview (render/productionPreview.js).
// A real barrack is ordered by the human town, then trains an archer through
// order, undo, a production turn, blocked completion, save/load and completion.
// At every stage the map overlay path (grid.drawEntityOverlays) is drawn
// repeatedly on a recording canvas: the ghost must be the literal unit at the
// literal opacity, canvas alpha must be restored, and the independently
// declared entity/economy ledgers, undo stack and selected information must be
// identical before and after drawing. The helper is also applied to a demon
// portal, which must stay free of economic manufacture inheritance.
//
// usage: node ai/test-production-preview.js --output-dir DIR [--fault NAME]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['ai/test-production-preview.js', 'ai/test-coop-harness.js', 'ai/browserScriptCache.js',
  'render/productionPreview.js', 'render/image.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/production.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/preparingManufacture.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/barrack.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/town.js',
  'sprites/entities/buildings/demonPortal.js', 'options/actionManager.js', 'options/save.js',
  'gameObjectSerialization.js', 'groups/grid.js', 'player.js', 'index.html'];

// Independent literal rules (not read from production tables).
const OPACITY = 0.5;
const RATES = {townIncome: 4, suburbIncome: 1, suburbs: 7, noobSalary: 1, barrackUpkeep: 2,
  barrackCost: 25, archerCost: 40};
const BARRACK = {x: 1, y: 2};

// Test-only faults, injected into the game realm; repo files are never modified.
const FAULTS = {
  'opaque-ghost': {marker: 'MISMATCH ordered-draw-1-ghosts', inject: `
    drawProductionPreview = (ctx, imageName, pos, coord, turns) => {
      drawCachedImage(ctx, cachedImages[imageName], pos)
      grid.getCell(coord).infoText = new CoordText(coord.x, coord.y, turns, 'red') }`},
  // Resetting to 1 instead of restoring is only visible from a non-default alpha (draw 4).
  'alpha-not-restored': {marker: 'MISMATCH ordered-draw-4-alpha-restored', inject: `
    drawProductionPreview = (ctx, imageName, pos, coord, turns) => {
      ctx.globalAlpha = 0.5; drawCachedImage(ctx, cachedImages[imageName], pos); ctx.globalAlpha = 1
      grid.getCell(coord).infoText = new CoordText(coord.x, coord.y, turns, 'red') }`},
  'live-unit-on-draw': {marker: 'MISMATCH ordered-draw-1-ledgers-unchanged', inject: `{
    const draw = drawProductionPreview
    drawProductionPreview = (ctx, imageName, pos, coord, turns) => {
      draw(ctx, imageName, pos, coord, turns)
      if (grid.getUnit(coord).isEmpty()) new Archer(coord.x, coord.y) } }`},
  'stale-turns-info': {marker: 'MISMATCH after-production-turn-info', inject: `{
    const add = addProductionPreviewInfo
    addProductionPreviewInfo = (info, name, turns) => add(info, name, 2) }`}
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-dir') args.outputDir = argv[++i];
    else if (argv[i] === '--fault') args.fault = argv[++i];
    else throw new Error('unknown argument ' + argv[i]);
  }
  if (!args.outputDir) throw new Error('--output-dir DIR is required');
  if (args.fault && !FAULTS[args.fault]) throw new Error('unknown fault ' + args.fault);
  return args;
}

function createRecorder() {
  const checkpoints = [];
  function check(name, observed, expected) {
    const pass = isDeepStrictEqual(observed, expected);
    checkpoints.push({name, expected, observed, pass});
    if (!pass) {
      console.error(`MISMATCH ${name}\nexpected=${JSON.stringify(expected)}\nobserved=${JSON.stringify(observed)}`);
      const error = new Error(`MISMATCH ${name}`);
      error.checkpoint = name;
      throw error;
    }
    console.log(`PASS ${name}`);
  }
  return {checkpoints, check};
}

// Declared entities and economy events; expectations never read the runtime.
function createLedgers() {
  const entities = [
    {id: 'neutral-town', kind: 'town', name: 'town', owner: 0, x: 4, y: 5},
    {id: 'h1-town', kind: 'town', name: 'town', owner: 1, x: 1, y: 1},
    {id: 'h2-town', kind: 'town', name: 'town', owner: 2, x: 7, y: 1},
    {id: 'h1-noob', kind: 'unit', name: 'noob', owner: 1, x: 2, y: 2},
    {id: 'h1-garrison', kind: 'unit', name: 'noob', owner: 1, x: 1, y: 1},
    {id: 'h2-garrison', kind: 'unit', name: 'noob', owner: 2, x: 7, y: 1},
    {id: 'demon-noob', kind: 'unit', name: 'noob', owner: 3, x: 7, y: 5}
  ];
  const gold = [0, 100, 75, 0];
  const events = [];
  const order = [];
  return {
    events,
    record(event) {
      events.push(event);
      if (event.type === 'spawn') entities.push(event.entity);
      else if (event.type === 'move') Object.assign(entities.find(e => e.id === event.id), event.to);
      else if (event.type === 'gold') {
        gold[event.owner] += event.amount;
        if (event.reversible) order.push(event);
      } else if (event.type === 'reversal') {
        const original = order.pop();
        gold[original.owner] -= original.amount;
      } else throw new Error('unknown ledger event ' + event.type);
    },
    turn(owner, units) {
      this.record({type: 'gold', owner, amount: RATES.townIncome + RATES.suburbIncome * RATES.suburbs, rule: 'town+suburbs'});
      this.record({type: 'gold', owner, amount: -RATES.noobSalary * units, rule: 'noob salary x' + units});
    },
    expected() {
      const rows = entities.map(({id, ...rest}) => rest);
      return {entities: sortRows(rows), gold: [...gold]};
    }
  };
}
const sortRows = rows => [...rows].sort((a, b) => a.x - b.x || a.y - b.y || a.kind.localeCompare(b.kind));

function observeState(f) {
  return f.evaluate(`(() => {
    const rows = [], problems = []
    for (const column of grid.arr) for (const cell of column) {
      if (cell.unit.notEmpty()) rows.push({kind: 'unit', name: cell.unit.name, owner: cell.unit.playerColor,
        x: cell.coord.x, y: cell.coord.y})
      const b = cell.building
      if (b.notEmpty()) rows.push({kind: b.name === 'town' ? 'town' : 'building', name: b.name,
        owner: b.playerColor, x: cell.coord.x, y: cell.coord.y})
    }
    const lists = players.map((p, owner) => ({owner, gold: p.gold,
      units: p.units.filter(u => !u.killed).map(u => u.name + '@' + u.coord.x + ',' + u.coord.y),
      towns: p.towns.filter(t => !t.killed).map(t => ({town: t.coord.x + ',' + t.coord.y,
        buildings: t.buildings.filter(b => !b.killed).map(b => b.name + '@' + b.coord.x + ',' + b.coord.y),
        buildingProduction: t.buildingProduction.map(b => b.name + '@' + b.coord.x + ',' + b.coord.y),
        unitProduction: t.unitProduction.isEmpty() ? null : t.unitProduction.toJSON()}))}))
    for (const p of players) for (const u of p.units) if (!u.killed && grid.getUnit(u.coord) !== u) problems.push('unit map')
    const barrack = grid.getBuilding(${JSON.stringify(BARRACK)})
    return {entities: rows, lists, external: external.length, externalProduction: externalProduction.length,
      undo: actionManager.arr.length, round: gameRound, turn: whooseTurn, problems,
      barrackProduction: barrack.isPreparingManufacture ?
        (barrack.unitProduction.isEmpty() ? null : barrack.unitProduction.toJSON()) : 'no barrack',
      occupant: grid.getUnit(${JSON.stringify(BARRACK)}).isEmpty() ? null : grid.getUnit(${JSON.stringify(BARRACK)}).name,
      serialized: JSON.stringify(getGameObject())}
  })()`);
}

// Drawing may only change view state: the transient per-cell turns text.
function installCanvas(f) {
  f.evaluate(`(() => {
    for (const name of ['noob', 'archer', 'KOHb', 'normchel', 'catapult', 'imp', 'barrack', 'town'])
      cachedImages[name] = {previewImageName: name}
    globalThis.recordingCanvas = initialAlpha => {
      const calls = []
      const target = {globalAlpha: initialAlpha}
      const ctx = new Proxy(target, {
        get(t, p) { return p in t ? t[p] : (...args) => calls.push({op: String(p), alpha: t.globalAlpha,
          image: args[0] && args[0].previewImageName || null, x: args[1], y: args[2]}) },
        set(t, p, v) { if (p === 'globalAlpha') calls.push({op: 'set globalAlpha', value: v}); t[p] = v; return true }
      })
      return {ctx, calls, target}
    }
    globalThis.selectedInfo = []
    barrackInterface.change = info => selectedInfo.push(JSON.parse(JSON.stringify(info)))
  })()`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(ROOT, args.outputDir);
  if (fs.existsSync(path.join(out, 'checkpoints.json'))) {
    console.error(`refusing to overwrite existing evidence in ${out}`);
    process.exit(2);
  }
  fs.mkdirSync(out, {recursive: true});
  const recorder = createRecorder();
  const barrackCheckpoints = [], drawLedger = [], ledgerRows = [];
  const report = {recorder, barrackCheckpoints, drawLedger, ledgerRows};
  let status = 0, failure = null;
  try {
    runScenario(args.fault, report);
    if (!args.fault) runNegativeControls(out, recorder);
  } catch (error) {
    status = 1;
    failure = error.message;
    console.error(error.stack);
  }
  const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
  write('barrack-checkpoints.json', barrackCheckpoints);
  write('draw-call-ledger.json', drawLedger);
  write('economy-entity-ledgers.json', ledgerRows);
  write('source-identities.json', {node: process.version, files: SOURCES.map(file => ({file,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')}))});
  const {checkpoints} = recorder;
  write('checkpoints.json', {status: status ? 'failed' : 'passed', fault: args.fault || null, failure,
    total: checkpoints.length, passed: checkpoints.filter(c => c.pass).length, checkpoints});
  if (!status) {
    console.log(`PASS production-preview${args.fault ? ' fault=' + args.fault : ''} checkpoints=${checkpoints.length} ` +
      `draw_stages=${drawLedger.length} draw_calls=${drawLedger.reduce((n, s) => n + s.draws.length, 0)}`);
  }
  process.exit(status);
}

function runScenario(fault, report) {
  const {recorder, barrackCheckpoints, drawLedger, ledgerRows} = report;
  const {check} = recorder;
  const ledgers = createLedgers();
  let f = createFixture(defaultFixture(), () => {});
  installCanvas(f);
  if (fault) f.evaluate(FAULTS[fault].inject + '; undefined');
  const barrackRow = {kind: 'building', name: 'barrack', owner: 1, ...BARRACK};

  function ledgerCheck(stage) {
    const expected = ledgers.expected();
    const observed = observeState(f);
    ledgerRows.push({stage, events: JSON.parse(JSON.stringify(ledgers.events)), expected,
      observed: {entities: sortRows(observed.entities), gold: observed.lists.map(p => p.gold), lists: observed.lists}});
    check(stage + '-entities', sortRows(observed.entities), expected.entities);
    check(stage + '-gold', observed.lists.map(p => p.gold), expected.gold);
    check(stage + '-references', observed.problems, []);
    return observed;
  }

  // Draws the real map overlays three times at alpha 1 and once at a non-default
  // alpha; the ghost list and restored alpha are literal expectations.
  function drawStage(stage, expectedGhost, expectedTurnsText) {
    const before = observeState(f);
    const infoBefore = f.evaluate('grid.getBuilding(' + JSON.stringify(BARRACK) + ').info');
    const draws = [];
    [1, 1, 1, 0.75].forEach((initialAlpha, index) => {
      const n = index + 1;
      f.context.initialAlpha = initialAlpha;
      const result = f.evaluate(`(() => {
        const canvas = recordingCanvas(initialAlpha)
        grid.drawEntityOverlays(canvas.ctx)
        const text = grid.getCell(${JSON.stringify(BARRACK)}).infoText.text
        grid.getCell(${JSON.stringify(BARRACK)}).infoText.text = ''
        const pos = grid.getBuilding(${JSON.stringify(BARRACK)}).pos
        return {calls: canvas.calls, finalAlpha: canvas.target.globalAlpha, text, pos: {x: pos.x, y: pos.y}}
      })()`);
      const ghosts = result.calls.filter(c => c.op === 'drawImage' && c.image !== null)
        .map(c => ({image: c.image, alpha: c.alpha, x: c.x, y: c.y}));
      const otherAlphas = [...new Set(result.calls.filter(c => c.op !== 'set globalAlpha' &&
        !(c.op === 'drawImage' && c.image !== null)).map(c => c.alpha))];
      draws.push({draw: n, initialAlpha, calls: result.calls, ghosts, finalAlpha: result.finalAlpha,
        turnsText: result.text});
      check(`${stage}-draw-${n}-ghosts`, ghosts, expectedGhost ?
        [{image: expectedGhost, alpha: OPACITY, x: result.pos.x, y: result.pos.y}] : []);
      check(`${stage}-draw-${n}-alpha-restored`, result.finalAlpha, initialAlpha);
      check(`${stage}-draw-${n}-other-sprites-unaffected`, otherAlphas.filter(a => a !== initialAlpha), []);
      check(`${stage}-draw-${n}-turns-text`, result.text, expectedTurnsText);
      const after = observeState(f);
      check(`${stage}-draw-${n}-ledgers-unchanged`, after, before);
    });
    check(stage + '-info-unchanged-by-draw', f.evaluate('grid.getBuilding(' + JSON.stringify(BARRACK) + ').info'), infoBefore);
    drawLedger.push({stage, expectedGhost, expectedOpacity: OPACITY, expectedTurnsText, draws});
  }

  function barrackStage(stage, expected) {
    const observed = f.evaluate(`(() => {
      const b = grid.getBuilding(${JSON.stringify(BARRACK)})
      selectedInfo.length = 0
      whooseTurn = 1
      b.select(false)
      const info = b.info.info
      return {name: b.name, train: info.train === undefined ? null : info.train,
        turns: info.turns === undefined ? null : info.turns, gold: info.gold, income: info.income,
        selected: selectedInfo.map(s => ({train: s.info.train === undefined ? null : s.info.train,
          turns: s.info.turns === undefined ? null : s.info.turns})),
        production: b.unitProduction.isEmpty() ? null : b.unitProduction.toJSON(),
        occupant: grid.getUnit(b.coord).isEmpty() ? null : grid.getUnit(b.coord).name,
        undoType: actionManager.lastAction ? actionManager.lastAction.type : null}
    })()`);
    f.evaluate('grid.getBuilding(' + JSON.stringify(BARRACK) + ').removeSelect(); gameEvent.selected = new Empty()');
    barrackCheckpoints.push({stage, expected, observed});
    check(stage + '-info', {train: observed.train, turns: observed.turns, gold: observed.gold},
      {train: expected.train, turns: expected.turns, gold: expected.gold});
    check(stage + '-selected-info', observed.selected, [{train: expected.train, turns: expected.turns}]);
    check(stage + '-production', observed.production, expected.production);
    check(stage + '-occupant', observed.occupant, expected.occupant);
    if ('undoType' in expected) check(stage + '-undo-type', observed.undoType, expected.undoType);
  }
  const goldText = (gold, income) => `${gold} (${income > 0 ? '+' : ''}${income})`;
  const human1 = () => ledgers.expected().gold[1];

  // Setup: a real town order for the barrack, three production turns.
  ledgerCheck('initial');
  check('barrack-order-accepted', f.evaluate(`whooseTurn = 1; (() => {
    const town = grid.getBuilding({x:1,y:1})
    if (!town.prepare('barrack')) return false
    town.sendInstructions(grid.getCell(${JSON.stringify(BARRACK)}))
    return grid.getBuilding(${JSON.stringify(BARRACK)}).name })()`), 'barrack');
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.barrackCost, rule: 'barrack order'});
  ledgers.record({type: 'spawn', entity: {id: 'barrack-production', kind: 'building', name: 'barrack', owner: 1, ...BARRACK}});
  for (let turn = 1; turn <= 3; turn++) {
    f.evaluate('whooseTurn = 1; players[1].nextTurn()');
    ledgers.turn(1, 2);
  }
  f.evaluate('actionManager.clear()');
  ledgerCheck('barrack-ready');
  check('barrack-class', f.evaluate(`({cls: grid.getBuilding(${JSON.stringify(BARRACK)}).constructor.name,
    inTown: grid.getBuilding({x:1,y:1}).buildings.includes(grid.getBuilding(${JSON.stringify(BARRACK)}))})`),
    {cls: 'Barrack', inTown: true});
  let income = RATES.townIncome + RATES.suburbIncome * RATES.suburbs - 2 * RATES.noobSalary - RATES.barrackUpkeep;
  barrackStage('ready', {train: null, turns: null, gold: goldText(human1(), income), production: null, occupant: null});
  drawStage('ready', null, '');

  // Order, undo, reorder: cost deduction and reversal through the undo stack.
  check('archer-order-accepted', f.evaluate(`whooseTurn = 1; grid.getBuilding(${JSON.stringify(BARRACK)}).prepare('archer')`), true);
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.archerCost, rule: 'archer order', reversible: true});
  ledgerCheck('ordered');
  const ordered = {train: 'archer', turns: 2, production: {turns: 2, cost: 40, name: 'archer'}, occupant: null};
  barrackStage('ordered', {...ordered, gold: goldText(human1(), income), undoType: 'prepareUnit'});
  drawStage('ordered', 'archer', 2);
  check('second-order-rejected', f.evaluate(`grid.getBuilding(${JSON.stringify(BARRACK)}).prepare('noob')`), false);
  ledgerCheck('second-order-rejected');

  f.evaluate('actionManager.undo()');
  ledgers.record({type: 'reversal'});
  ledgerCheck('undone');
  barrackStage('undone', {train: null, turns: null, gold: goldText(human1(), income), production: null, occupant: null,
    undoType: null});
  drawStage('undone', null, '');

  check('archer-reorder-accepted', f.evaluate(`whooseTurn = 1; grid.getBuilding(${JSON.stringify(BARRACK)}).prepare('archer')`), true);
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.archerCost, rule: 'archer reorder', reversible: true});
  ledgerCheck('reordered');
  barrackStage('reordered', {...ordered, gold: goldText(human1(), income), undoType: 'prepareUnit'});
  drawStage('reordered', 'archer', 2);

  // One production turn: delay counts down, no unit yet.
  f.evaluate('whooseTurn = 1; players[1].nextTurn(); actionManager.clear()');
  ledgers.turn(1, 2);
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.barrackUpkeep, rule: 'barrack upkeep'});
  ledgerCheck('after-production-turn');
  const pending = {train: 'archer', turns: 1, production: {turns: 1, cost: 40, name: 'archer'}};
  barrackStage('after-production-turn', {...pending, gold: goldText(human1(), income), occupant: null});
  drawStage('after-production-turn', 'archer', 1);

  // Blocked completion: the garrison stands on the barrack cell.
  f.submit({type: 'move', source: {x: 1, y: 1}, destination: BARRACK}, BARRACK,
    state => ({x: state.players[1].units[1].x, y: state.players[1].units[1].y}));
  ledgers.record({type: 'move', id: 'h1-garrison', to: BARRACK});
  f.evaluate('whooseTurn = 1; players[1].nextTurn(); actionManager.clear()');
  ledgers.turn(1, 2);
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.barrackUpkeep, rule: 'barrack upkeep'});
  ledgerCheck('blocked');
  barrackStage('blocked', {...pending, gold: goldText(human1(), income), occupant: 'noob'});
  drawStage('blocked', 'archer', 1);

  // Save/load: a fresh runtime restores the blocked order and its preview.
  const saved = f.evaluate('JSON.stringify(getGameObject())');
  const original = f;
  const expectedAfterLoad = observeState(original);
  f = createFixture(defaultFixture(), () => {});
  installCanvas(f);
  if (fault) f.evaluate(FAULTS[fault].inject + '; undefined');
  f.context.savedGame = saved;
  f.evaluate('loadFromJson(savedGame); whooseTurn = 1');
  const loadedState = observeState(f);
  check('loaded-state-equals-saved', {...loadedState, undo: 0}, {...expectedAfterLoad, undo: 0});
  ledgerCheck('loaded');
  barrackStage('loaded', {...pending, gold: goldText(human1(), income), occupant: 'noob'});
  drawStage('loaded', 'archer', 1);

  // Completion in the loaded runtime once the cell is free.
  const unblock = realm => realm.submit({type: 'move', source: BARRACK, destination: {x: 1, y: 3}}, {x: 1, y: 3},
    state => ({x: state.players[1].units[1].x, y: state.players[1].units[1].y}));
  unblock(f);
  ledgers.record({type: 'move', id: 'h1-garrison', to: {x: 1, y: 3}});
  f.evaluate('whooseTurn = 1; players[1].nextTurn(); actionManager.clear()');
  ledgers.turn(1, 2);
  ledgers.record({type: 'gold', owner: 1, amount: -RATES.barrackUpkeep, rule: 'barrack upkeep'});
  ledgers.record({type: 'spawn', entity: {id: 'archer', kind: 'unit', name: 'archer', owner: 1, ...BARRACK}});
  const completed = ledgerCheck('completed');
  income -= 2; // archer salary from the next turn
  barrackStage('completed', {train: null, turns: null, gold: goldText(human1(), income), production: null,
    occupant: 'archer'});
  drawStage('completed', null, '');

  // The original runtime reaches the identical completed state.
  unblock(original);
  original.evaluate('whooseTurn = 1; players[1].nextTurn(); actionManager.clear()');
  const originalCompleted = observeState(original);
  check('original-and-loaded-completion-identical', {...originalCompleted, serialized: JSON.parse(originalCompleted.serialized)},
    {...completed, serialized: JSON.parse(observeState(f).serialized)});
  check('barrack-entity-present', ledgers.expected().entities.some(e => isDeepStrictEqual(e, barrackRow)), true);

  runPortalStage(check, drawLedger, ledgerRows);
}

// The helper applied to a demon portal: view-only, no manufacture economy.
function runPortalStage(check, drawLedger, ledgerRows) {
  const config = defaultFixture();
  config.coop = true;
  const f = createFixture(config, () => {});
  installCanvas(f);
  f.evaluate('portal = new DemonPortal(6, 5, "normal"); undefined');
  check('portal-no-manufacture-inheritance', f.evaluate(`({
    manufacture: portal instanceof Manufacture, preparing: portal instanceof PreparingManufacture,
    isPreparingManufacture: portal.isPreparingManufacture, isManufacture: portal.isManufacture,
    members: ['town', 'income', 'unitProduction', 'prepare', 'startUnitPreparing', 'unitPreparingLogic', 'minusGold', 'gold']
      .filter(k => k in portal)})`),
    {manufacture: false, preparing: false, isPreparingManufacture: false, isManufacture: false, members: []});
  const state = () => f.evaluate(`({serialized: JSON.stringify(getGameObject()), gold: players.map(p => p.gold),
    units: players.map(p => p.units.length), external: external.length, occupant: grid.getUnit({x:6,y:5}).isEmpty(),
    undo: actionManager.arr.length, info: portal.info})`);
  const before = state();
  const draws = [];
  for (const initialAlpha of [1, 1, 0.6]) {
    f.context.initialAlpha = initialAlpha;
    const result = f.evaluate(`(() => {
      const canvas = recordingCanvas(initialAlpha)
      drawProductionPreview(canvas.ctx, 'imp', portal.pos, portal.coord, 4)
      const text = grid.getCell(portal.coord).infoText.text
      grid.getCell(portal.coord).infoText.text = ''
      return {calls: canvas.calls, finalAlpha: canvas.target.globalAlpha, text, pos: {x: portal.pos.x, y: portal.pos.y},
        info: addProductionPreviewInfo({}, 'imp', 4)}
    })()`);
    draws.push({initialAlpha, ...result});
    check(`portal-helper-ghost-${draws.length}`, result.calls.filter(c => c.op === 'drawImage')
      .map(c => ({image: c.image, alpha: c.alpha, x: c.x, y: c.y})), [{image: 'imp', alpha: OPACITY, x: result.pos.x, y: result.pos.y}]);
    check(`portal-helper-alpha-restored-${draws.length}`, result.finalAlpha, initialAlpha);
    check(`portal-helper-info-${draws.length}`, [result.info, result.text], [{train: 'imp', turns: 4}, 4]);
    check(`portal-helper-state-unchanged-${draws.length}`, state(), before);
  }
  drawLedger.push({stage: 'portal-helper', expectedGhost: 'imp', expectedOpacity: OPACITY, expectedTurnsText: 4, draws});
  ledgerRows.push({stage: 'portal-helper', expected: 'unchanged by drawing', before, after: state()});
}

function runNegativeControls(out, recorder) {
  const results = [];
  for (const [name, fault] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-controls', name);
    const child = spawnSync(process.execPath, [__filename, '--output-dir', dir, '--fault', name],
      {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'output.log'), `$ ${process.execPath} ${path.relative(ROOT, __filename)} --output-dir ${path.relative(ROOT, dir)} --fault ${name}\n` +
      `--- stdout\n${child.stdout}--- stderr\n${child.stderr}--- exit ${child.status}\n`);
    const firstMismatch = (child.stderr.match(/^MISMATCH \S+/m) || [null])[0];
    results.push({name, exit: child.status, firstMismatch});
    console.log(`negative-control ${name} exit=${child.status} first=${firstMismatch}`);
    recorder.check('negative-control-' + name, {exit: child.status, firstMismatch}, {exit: 1, firstMismatch: fault.marker});
  }
  fs.writeFileSync(path.join(out, 'negative-controls.json'), JSON.stringify(results, null, 2) + '\n');
}

main();
