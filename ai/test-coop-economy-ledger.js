const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');

const copy = value => JSON.parse(JSON.stringify(value));

// Replay declared economic events; never infer a credit/debit from a balance
// delta or use Player.income/armySalary as the expected accounting result.
function createEconomyLedger(fixture, initial, rules, report = console.log) {
  const baseline = copy(initial), configured = copy(rules), events = [];
  function expected() {
    const balances = baseline.map(actor => actor.gold);
    const entries = new Map(), reversed = new Set();
    for (const event of events) {
      assert.ok(!entries.has(event.id), 'unique economy event ID');
      assert.equal(baseline[event.owner].role, 'human', 'human economic event owner');
      let amount;
      if (event.type === 'reversal') {
        const original = entries.get(event.reverses);
        assert.ok(original && original.owner === event.owner &&
          ['purchase', 'production'].includes(original.type), 'reversible expense');
        assert.ok(!reversed.has(event.reverses), 'expense reversed only once');
        reversed.add(event.reverses);
        amount = -original.amount;
      } else {
        assert.ok(['income', 'salary', 'purchase', 'production'].includes(event.type));
        const rate = configured[event.type][event.rule];
        assert.ok(Number.isFinite(rate) && rate >= 0, 'configured economy rule');
        assert.ok(Number.isInteger(event.count) && event.count > 0, 'positive event count');
        amount = rate * event.count * (event.type === 'income' ? 1 : -1);
      }
      entries.set(event.id, {...event, amount});
      balances[event.owner] += amount;
    }
    return balances;
  }
  function record(event) {
    events.push(copy(event));
    expected();
    report(JSON.stringify({scenario: 'economy-event', event}));
  }
  function check(label) {
    const wanted = expected();
    const observed = fixture.evaluate(`(() => {
      const assets = [];
      const add = (entity, source) => {
        if (entity && !entity.killed && !entity.isEmpty() && !(entity instanceof DemonPortal) &&
            fixtureConfig.actors[entity.playerColor] &&
            fixtureConfig.actors[entity.playerColor].role === 'demon')
          assets.push({source, name: entity.name, coord: entity.coord});
      };
      for (const column of grid.arr) for (const cell of column) add(cell.building, 'grid');
      for (let owner = 0; owner < players.length; owner++) {
        if (fixtureConfig.actors[owner].role !== 'demon') continue;
        for (const entity of [...players[owner].towns, ...players[owner].goldmines]) {
          if (!entity.killed) assets.push({source: 'ownership', name: entity.name, coord: entity.coord});
        }
      }
      for (const entity of [...goldmines, ...external, ...externalProduction]) add(entity, 'global');
      return {balances: players.map(p => p.gold), assets};
    })()`);
    report(JSON.stringify({scenario: label, initial: baseline, rules: configured,
      events, expected: {balances: wanted, assets: []}, observed}));
    baseline.forEach((actor, owner) => {
      if (actor.role === 'human')
        assert.equal(observed.balances[owner], wanted[owner], `human ${owner} balance`);
      if (actor.role === 'demon')
        assert.equal(observed.balances[owner], 0, 'zero demon gold');
    });
    assert.deepStrictEqual(observed.assets, [], 'no demon economic assets');
    report(`PASS ${label} expected_balances=${JSON.stringify(wanted)} observed_balances=${JSON.stringify(observed.balances)} demon_assets=0`);
    return observed;
  }
  return {record, expected, check};
}

function setup() {
  const fixture = createFixture();
  // Suburb income is the literal rule in Town.income (no exported constant).
  // Initial two towns have seven suburbs each, including their own cell.
  const rules = fixture.evaluate(`({income: {town: Town.income, suburb: 1},
    salary: {noob: Noob.salary}, purchase: {wall: production.wall.cost},
    production: {noob: production.noob.cost}})`);
  fixture.compare('configured-economy-rules', rules, {
    income: {town: 4, suburb: 1}, salary: {noob: 1},
    purchase: {wall: 2}, production: {noob: 20}
  });
  const ledger = createEconomyLedger(fixture,
    fixture.evidence.configured.actors.map(({role, gold}) => ({role, gold})), rules);
  return {fixture, ledger};
}
function round(fixture, ledger, id, owner, unitCount) {
  ledger.record({id: id + '-town', owner, type: 'income', rule: 'town', count: 1});
  ledger.record({id: id + '-suburbs', owner, type: 'income', rule: 'suburb', count: 7});
  ledger.record({id: id + '-salary', owner, type: 'salary', rule: 'noob', count: unitCount});
  fixture.evaluate(`whooseTurn = ${owner}; players[${owner}].nextTurn()`);
  ledger.check(id);
}
function prepare(fixture, ledger, id) {
  fixture.compare(id + '-accepted', fixture.evaluate(`whooseTurn = 1;
    grid.getBuilding({x:1,y:1}).prepare('noob')`), true);
  ledger.record({id, owner: 1, type: 'production', rule: 'noob', count: 1});
  ledger.check(id);
}
const faults = {
  'wrong-salary': {marker: 'human 1 balance', inject: `Object.defineProperty(players[1].units[0], 'salary', {value: 2})`},
  'extra-credit': {marker: 'human 1 balance', inject: `players[1].gold += 1`},
  'offset-human-balances': {marker: 'human 1 balance', inject: `players[1].gold += 1; players[2].gold -= 1`},
  'second-human-credit': {marker: 'human 2 balance', inject: `players[2].gold += 1`},
  'nonzero-demon-gold': {marker: 'zero demon gold', inject: `players[3].gold = 1`},
  'demon-town': {marker: 'no demon economic assets', inject: `grid.getHexagon({x:6,y:5}).playerColor = 3; new Town(6,5)`},
  'demon-goldmine': {marker: 'no demon economic assets', inject: `grid.getHexagon({x:6,y:5}).playerColor = 3; new Goldmine(6,5,50)`},
  'demon-production': {marker: 'no demon economic assets', inject: `grid.getHexagon({x:6,y:5}).playerColor = 3;
    const asset = new ExternalProduction(4,2,Wall,'wall'); asset.coord = {x:6,y:5}; externalProduction.push(asset)`}
};
function runFault(name) {
  const {fixture, ledger} = setup();
  ledger.check('before-' + name);
  fixture.evaluate(`(() => { ${faults[name].inject}; })()`);
  if (name === 'wrong-salary') round(fixture, ledger, name, 1, 2);
  else ledger.check(name); // Uncaught assertion must terminate this subprocess.
}
function runTests() {
  const {fixture, ledger} = setup();
  ledger.check('initial-economy');
  round(fixture, ledger, 'human-one-income-salary', 1, 2);
  round(fixture, ledger, 'human-two-income-salary', 2, 1);
  fixture.evaluate('whooseTurn = 3; players[3].nextTurn()');
  ledger.check('demon-round-no-economy');

  fixture.evaluate(`whooseTurn = 1;
    Object.setPrototypeOf(players[1], AIPlayerWithEconomy.prototype);
    globalThis.wallCommand = players[1].getEconomyCommands().find(c => c.product === 'wall');`);
  fixture.compare('wall-purchase-accepted', fixture.evaluate('Boolean(wallCommand && players[1].applyEconomyCommand(wallCommand))'), true);
  ledger.record({id: 'wall', owner: 1, type: 'purchase', rule: 'wall', count: 1});
  ledger.check('after-wall-purchase');
  fixture.evaluate('actionManager.undo()');
  ledger.record({id: 'undo-wall', owner: 1, type: 'reversal', reverses: 'wall'});
  ledger.check('after-purchase-reversal');
  fixture.compare('wall-removed', fixture.evaluate('grid.getBuilding(wallCommand.destinationCoord).isEmpty()'), true);

  prepare(fixture, ledger, 'cancelled-unit');
  fixture.evaluate('actionManager.undo()');
  ledger.record({id: 'undo-unit', owner: 1, type: 'reversal', reverses: 'cancelled-unit'});
  ledger.check('after-production-reversal');
  fixture.compare('unit-queue-cleared', fixture.evaluate('grid.getBuilding({x:1,y:1}).unitProduction.isEmpty()'), true);
  fixture.submit({type: 'move', source: {x:1,y:1}, destination: {x:1,y:2}},
    {x:1,y:2}, state => ({x: state.players[1].units[1].x, y: state.players[1].units[1].y}));
  ledger.check('after-garrison-move');
  prepare(fixture, ledger, 'completed-unit');
  round(fixture, ledger, 'production-completes-without-second-charge', 1, 2);
  fixture.compare('produced-unit-and-empty-queue', fixture.evaluate(`({units: players[1].units.length,
    name: grid.getUnit({x:1,y:1}).name, emptyQueue: grid.getBuilding({x:1,y:1}).unitProduction.isEmpty()})`),
    {units: 3, name: 'noob', emptyQueue: true});
  round(fixture, ledger, 'produced-unit-salary-next-turn', 1, 3);
  round(fixture, ledger, 'second-human-remains-independent', 2, 1);
  fixture.evaluate('whooseTurn = 3; players[3].nextTurn()');
  ledger.check('final-demon-round');
  fixture.compare('final-independent-balances', ledger.expected(), [0,106,95,0]);

  for (const [name, fault] of Object.entries(faults)) {
    const child = spawnSync(process.execPath, [__filename, '--fault', name], {encoding: 'utf8'});
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    assert.equal(child.status, 1, name);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes(fault.marker), name);
    console.log(`PASS rejects-${name} expected_exit=1 observed_exit=${child.status} marker=${fault.marker}`);
  }
  console.log('PASS co-op economy ledger fault_probes=8');
}
if (require.main === module) {
  if (process.argv[2] === '--fault') runFault(process.argv[3]);
  else runTests();
}
module.exports = {createEconomyLedger};
