const assert = require('assert').strict;
const vm = require('vm');
const { spawnSync } = require('child_process');
const { loadBrowserScripts, detachBrowserResult } = require('./browserScriptCache');

function createCanvasContext() {
  return new Proxy({
    canvas: { width: 800, height: 600 },
    measureText(text) {
      return { width: String(text).length * 8 };
    }
  }, {
    get(target, property) {
      return property in target ? target[property] : function() {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
}

function createCanvas() {
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    getContext() {
      return createCanvasContext();
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  };
}

function createRuntimeContext() {
  const storage = {};
  const context = {
    console: Object.assign({}, console, { log() {} }),
    Math,
    Date,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
    NaN,
    setTimeout,
    clearTimeout,
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    Image: class Image {},
    navigator: { userAgent: 'node' },
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    document: {
      createElement() { return createCanvas(); },
      getElementById() { return createCanvas(); },
      querySelector() { return createCanvas(); },
      addEventListener() {}
    },
    localStorage: {
      setItem(key, value) { storage[key] = String(value); },
      getItem(key) { return storage[key] || null; },
      removeItem(key) { delete storage[key]; }
    },
    io() { return {}; },
    tf: {},
    saveAs() {}
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

// Roles are test metadata until production co-op controllers exist. Demons use
// real Noob units owned by a normal Player with existing economyEnabled=false.
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function defaultFixture() {
  return {
    size: {x: 9, y: 7},
    actors: [
      {role: 'neutral', rgb: {r: 100, g: 100, b: 100}, gold: 0,
        towns: [{x: 4, y: 5}], units: []},
      {role: 'human', rgb: {r: 220, g: 40, b: 40}, gold: 100,
        towns: [{x: 1, y: 1}], units: [{x: 2, y: 2, hp: 2}]},
      {role: 'human', rgb: {r: 40, g: 120, b: 220}, gold: 75,
        towns: [{x: 7, y: 1}], units: []},
      {role: 'demon', rgb: {r: 160, g: 40, b: 180}, gold: 0,
        economyEnabled: false, towns: [], units: [{x: 7, y: 5, hp: 2}]}
    ]
  };
}

function validateFixture(config) {
  assert.ok(Number.isInteger(config.size.x) && config.size.x > 0);
  assert.ok(Number.isInteger(config.size.y) && config.size.y > 0);
  assert.equal(config.actors[0].role, 'neutral');
  assert.equal(config.actors.filter(a => a.role === 'neutral').length, 1);
  const occupied = new Set();
  for (const actor of config.actors) {
    assert.ok(['human', 'neutral', 'demon'].includes(actor.role));
    assert.ok(Number.isFinite(actor.gold) && actor.gold >= 0);
    if (actor.role === 'neutral') assert.equal(actor.units.length, 0);
    if (actor.role === 'demon') {
      assert.equal(actor.gold, 0);
      assert.equal(actor.economyEnabled, false);
      assert.equal(actor.towns.length, 0);
    }
    for (const entity of [...actor.towns, ...actor.units]) {
      assert.ok(Number.isInteger(entity.x) && entity.x >= 0 && entity.x < config.size.x);
      assert.ok(Number.isInteger(entity.y) && entity.y >= 0 && entity.y < config.size.y);
    }
    for (const unit of actor.units) {
      assert.ok(unit.hp > 0 && unit.hp <= 2, 'Noob fixture hp must be in (0, 2]');
      const key = `${unit.x},${unit.y}`;
      assert.ok(!occupied.has(key), `duplicate unit position: ${key}`);
      occupied.add(key);
    }
  }
}

function createFixture(config = defaultFixture(), report = console.log) {
  config = clone(config);
  validateFixture(config);
  const context = createRuntimeContext();
  loadBrowserScripts(context);
  function evaluate(source) {
    return detachBrowserResult(new vm.Script(source, {
      filename: 'coop-fixture-scenario.js'
    }).runInContext(context));
  }
  context.fixtureConfig = config;
  evaluate(`(() => {
    isFogOfWar = false
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    gameEvent = {selected: new Empty(), hideAll() {},
      removeSelection() {this.selected = new Empty()},
      screen: {moveTo() {}, moveToPlayer() {}, stop() {}}}
    nextTurnButton = {setNextPlayerColor() {}, enableClick() {}, disableClick() {}}
    border = new Border()
    attackBorder = new Border()
    const configured = fixtureConfig.actors.map(actor => ({...actor,
      units: actor.units.map(unit => ({...unit, type: Noob}))}))
    new GameMap(fixtureConfig.size, fixtureConfig.coop ? configured.slice(0, -1) : configured,
      [], [], [], [], [], {type: 'rectangular'},
      fixtureConfig.coop ? {units: configured[configured.length - 1].units} : null).start({
      updateCameraBorders() {},
      clearValues() {
        external = []; externalProduction = []; nature = []; goldmines = []
        gameRound = 0; gameExit = false
      }
    }, false)
    whooseTurn = 1
    otherSettings.moveCameraToUndoTarget = false
    actionManager.clear()
  })()`);
  function snapshot() {
    return evaluate(`({turn: whooseTurn, round: gameRound,
      players: players.map((p, i) => ({role: fixtureConfig.actors[i].role,
        gold: p.gold, units: p.units.filter(u => !u.killed).map(u => ({
          x: u.coord.x, y: u.coord.y, hp: u.hp, moves: u.moves})),
        towns: p.towns.filter(t => !t.killed).map(t => ({x: t.coord.x, y: t.coord.y}))})),
      serialized: JSON.parse(JSON.stringify({grid, players}))})`);
  }
  const evidence = {configured: config, rules: evaluate(`({
    noob: {health: Noob.maxHP, damage: Noob.dmg, movement: Noob.speed, salary: Noob.salary},
    suddenDeathRound, fogOfWar: isFogOfWar})`), initial: snapshot(), actions: []};
  report(JSON.stringify({scenario: 'fixture-initial-state', ...evidence}));
  function compare(name, observed, expected) {
    report(JSON.stringify({scenario: name, expected, observed}));
    assert.deepStrictEqual(observed, expected, name);
    report(`PASS ${name}`);
  }
  function submit(command, expected, project = state => state) {
    const entry = {command: clone(command), before: snapshot()};
    evidence.actions.push(entry);
    context.submittedCommand = entry.command;
    try {
      evaluate(`(() => {
        const c = submittedCommand
        if (c.type === 'undo') { actionManager.undo(); return }
        if (c.type !== 'move') throw new Error('unsupported fixture command')
        const unit = grid.getUnit(c.source)
        if (unit.isEmpty() || !unit.isMyTurn) throw new Error('unit unavailable')
        if (!unit.getAvailableMoveCommands().some(candidate =>
          coordsEqually(candidate.destinationCoord, c.destination))) {
          throw new Error('illegal fixture move')
        }
        unit.select()
        unit.sendInstructions(grid.getCell(c.destination))
      })()`);
      entry.after = snapshot();
      compare(command.type, project(entry.after), expected);
      entry.outcome = 'passed';
    } catch (error) {
      entry.after = snapshot();
      entry.outcome = 'failed';
      entry.error = error.message;
      throw error;
    } finally {
      report(JSON.stringify({scenario: 'submitted-action', ...entry}));
    }
    return entry.after;
  }
  return {context, evaluate, snapshot, evidence, compare, submit};
}

function runTests() {
  const harness = createFixture();
  const summary = state => state.players.map(p => ({role: p.role, gold: p.gold,
    units: p.units, towns: p.towns}));
  // Town's existing constructor also spawns one Noob per human town.
  const expected = [
    {role: 'neutral', gold: 0, units: [], towns: [{x: 4, y: 5}]},
    {role: 'human', gold: 100, units: [{x: 2, y: 2, hp: 2, moves: 2}, {x: 1, y: 1, hp: 2, moves: 2}], towns: [{x: 1, y: 1}]},
    {role: 'human', gold: 75, units: [{x: 7, y: 1, hp: 2, moves: 2}], towns: [{x: 7, y: 1}]},
    {role: 'demon', gold: 0, units: [{x: 7, y: 5, hp: 2, moves: 2}], towns: []}
  ];
  harness.compare('controlled-human-neutral-demon', summary(harness.snapshot()), expected);
  harness.compare('configured-rules', harness.evidence.rules.noob,
    {health: 2, damage: 1, movement: 2, salary: 1});
  const moved = clone(expected);
  moved[1].units[0] = {x: 2, y: 3, hp: 2, moves: 1};
  harness.submit({type: 'move', source: {x: 2, y: 2}, destination: {x: 2, y: 3}}, moved, summary);
  harness.submit({type: 'undo'}, expected, summary);
  harness.compare('initial-snapshot-retained', summary(harness.evidence.initial), expected);
  harness.compare('recorded-outcomes', harness.evidence.actions.map(a => a.outcome), ['passed', 'passed']);
  const invalid = defaultFixture();
  invalid.actors[3].units[0] = {x: 2, y: 2, hp: 2};
  assert.throws(() => createFixture(invalid), /duplicate unit position: 2,2/);
  console.log('PASS invalid-fixture-rejected expected=duplicate unit position: 2,2 observed=duplicate unit position: 2,2');
  // A separate process proves that the public action API cannot swallow a bad
  // expectation and accidentally make a command-line verification pass.
  const child = spawnSync(process.execPath, [__filename, '--assertion-failure-probe'], {encoding: 'utf8'});
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /AssertionError/);
  assert.match(child.stdout, /"outcome":"failed"/);
  console.log(`PASS assertion-failure-propagation expected_exit=1 observed_exit=${child.status}`);
  console.log('PASS co-op harness scenarios=8');
}

if (require.main === module) {
  if (process.argv.includes('--assertion-failure-probe')) {
    createFixture().submit({type: 'move', source: {x: 2, y: 2}, destination: {x: 2, y: 3}},
      [{x: 8, y: 6, hp: 2, moves: 2}], state => state.players[1].units);
  } else {
    runTests();
  }
}
module.exports = {createFixture, defaultFixture, validateFixture};
