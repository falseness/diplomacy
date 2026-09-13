const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');

const copy = value => JSON.parse(JSON.stringify(value));
const sorted = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));

// Expectations come only from declared initial entities and explicit events,
// never from the post-action map or ownership arrays. IDs are harness metadata:
// the current browser runtime does not persist entity IDs in its wire format.
function createEntityLedger(fixture, initial, report = console.log) {
  const events = [];
  const baseline = copy(initial);
  fixture.context.ledgerInitial = copy(initial);
  fixture.evaluate(`globalThis.ledgerObjects = new Map();
    for (const row of ledgerInitial) {
      const entity = row.kind === 'unit' ? grid.getUnit(row) : grid.getBuilding(row);
      if (entity.isEmpty()) throw new Error('missing initial entity: ' + row.id);
      ledgerObjects.set(entity, row.id);
    }`);
  function expected() {
    const live = new Map();
    const used = new Set();
    function add(row) {
      assert.ok(!used.has(row.id), 'event ID reused: ' + row.id);
      used.add(row.id);
      live.set(row.id, copy(row));
    }
    baseline.forEach(add);
    for (const event of events) {
      if (event.type === 'spawn' || event.type === 'production') add(event.entity);
      else if (event.type === 'death') {
        assert.ok(live.delete(event.id), 'death of absent entity');
      } else if (event.type === 'move') {
        assert.ok(live.has(event.id), 'move of absent entity');
        Object.assign(live.get(event.id), event.destination);
      } else if (event.type === 'capture') {
        assert.ok(live.has(event.id), 'capture of absent entity');
        live.get(event.id).owner = event.owner;
      } else throw new Error('unknown ledger event');
    }
    return sorted(live.values());
  }
  function record(event) {
    events.push(copy(event));
    expected();
    report(JSON.stringify({scenario: 'entity-event', event}));
  }
  // Binding is explicit: unrecorded runtime births must not enter expectations.
  function bind(id, expression) {
    fixture.context.ledgerBindingId = id;
    fixture.evaluate(`ledgerObjects.set(${expression}, ledgerBindingId); undefined`);
  }
  function check(label) {
    const wanted = expected();
    const observed = fixture.evaluate(`(() => {
      const row = entity => ({id: ledgerObjects.get(entity) || '<unregistered>',
        kind: entity.isUnit ? 'unit' : entity.isDemonPortal ? 'portal' : entity.isNature ? 'nature' : entity.isExternal ? 'building' : 'town', name: entity.name, owner: entity.playerColor,
        x: entity.coord.x, y: entity.coord.y});
      const live = [...ledgerObjects.keys()].filter(e => !e.killed);
      const map = [], ownership = [], problems = [];
      for (const column of grid.arr) for (const cell of column) {
        for (const entity of [cell.unit, cell.building]) {
          if (entity.isEmpty()) continue;
          map.push(row(entity));
          if (entity.killed || entity.coord.x !== cell.coord.x || entity.coord.y !== cell.coord.y)
            problems.push('map reference');
        }
      }
      for (let owner = 0; owner < players.length; owner++) {
        for (const entity of [...players[owner].units, ...players[owner].towns]) {
          if (entity.killed) continue; // Runtime retains tombstones until serialization.
          ownership.push({...row(entity), owner});
          if (entity.player !== players[owner] ||
              (entity.isUnit ? grid.getUnit(entity.coord) : grid.getBuilding(entity.coord)) !== entity)
            problems.push('ownership reference');
        }
      }
      for (const entity of external.filter(e => e.isDemonPortal)) {
        ownership.push(row(entity));
        if (entity.killed || entity.player.role !== 'DEMONS' || grid.getBuilding(entity.coord) !== entity)
          problems.push('portal ownership reference');
      }
      for (const entity of external.filter(e => !e.killed && !e.isDemonPortal)) {
        ownership.push(row(entity));
        if (grid.getBuilding(entity.coord) !== entity) problems.push('external reference');
      }
      for (const entity of nature.filter(e => !e.killed)) {
        ownership.push(row(entity));
        if (grid.getBuilding(entity.coord) !== entity) problems.push('nature reference');
      }
      const serializedNature = JSON.parse(JSON.stringify(nature.filter(e => !e.killed)))
        .map(e => ({x: e.coord.x, y: e.coord.y, name: e.name}));
      const portals = JSON.parse(JSON.stringify(external)).filter(e => e.name === 'demonPortal')
        .map(e => ({owner: e.ownerSlot, x: e.coord.x, y: e.coord.y, name: e.name}));
      // Capture raw references BEFORE toJSON, which cleans ownership arrays.
      const serialized = JSON.parse(JSON.stringify(players)).flatMap((p, owner) =>
        p.units.map(u => ({owner, x: u.coord.x, y: u.coord.y, name: u.name})));
      return {live: live.map(row), map, ownership, serialized, portals, serializedNature, problems};
    })()`);
    report(JSON.stringify({scenario: label, initial: baseline, events, expected: wanted, observed}));
    assert.equal(new Set(observed.live.map(e => e.id)).size, observed.live.length, 'unique IDs');
    const units = observed.live.filter(e => e.kind === 'unit');
    assert.equal(new Set(units.map(e => `${e.x},${e.y}`)).size, units.length, 'unique occupied unit positions');
    assert.deepStrictEqual(sorted(observed.live), wanted, 'live-entity conservation');
    assert.deepStrictEqual(observed.problems, [], 'consistent references');
    assert.deepStrictEqual(sorted(observed.map), wanted, 'map live entities');
    assert.deepStrictEqual(sorted(observed.ownership), wanted, 'ownership live entities');
    // The production wire format has no IDs; compare owner, position and type.
    const wireSort = rows => rows.sort((a, b) => a.owner - b.owner || a.x - b.x || a.y - b.y);
    assert.deepStrictEqual(wireSort(observed.serialized), wireSort(wanted.filter(e => e.kind === 'unit')
      .map(e => ({owner: e.owner, x: e.x, y: e.y, name: e.name}))), 'serialized live-unit lists');
    assert.deepStrictEqual(wireSort(observed.portals), wireSort(wanted.filter(e => e.kind === 'portal')
      .map(e => ({owner: e.owner, x: e.x, y: e.y, name: e.name}))), 'serialized live-portal lists');
    const natureSort = rows => rows.sort((a, b) => a.x - b.x || a.y - b.y);
    assert.deepStrictEqual(natureSort(observed.serializedNature), natureSort(wanted.filter(e => e.kind === 'nature')
      .map(e => ({x: e.x, y: e.y, name: e.name}))), 'serialized nature lists');
    report(`PASS ${label} expected_live=${wanted.length} observed_live=${observed.live.length}`);
    return observed;
  }
  return {record, bind, check, expected};
}

const initial = [
  {id: 'neutral-town', kind: 'town', owner: 0, x: 4, y: 5},
  {id: 'human-one-town', kind: 'town', owner: 1, x: 1, y: 1},
  {id: 'human-two-town', kind: 'town', owner: 2, x: 7, y: 1},
  {id: 'human-one-unit', kind: 'unit', owner: 1, x: 2, y: 2},
  {id: 'human-one-garrison', kind: 'unit', owner: 1, x: 1, y: 1},
  {id: 'human-two-garrison', kind: 'unit', owner: 2, x: 7, y: 1},
  {id: 'demon-unit', kind: 'unit', owner: 3, x: 7, y: 5}
].map(entity => ({...entity, name: entity.kind === 'unit' ? 'noob' : 'town'}));
function setup() {
  const fixture = createFixture();
  return {fixture, ledger: createEntityLedger(fixture, initial)};
}

const faults = {
  'duplicate-ids': {marker: 'unique IDs', inject: `ledgerObjects.set(grid.getUnit({x:7,y:5}), 'human-one-unit')`},
  'missing-ownership': {marker: 'ownership live entities', inject: `players[1].units.splice(0, 1)`},
  'duplicate-position': {marker: 'unique occupied unit positions', inject: `grid.getUnit({x:7,y:5}).coord = {x:2,y:2}`},
  'broken-map-reference': {marker: 'consistent references', inject: `grid.setUnit(new Empty(), {x:2,y:2})`},
  'duplicate-ownership': {marker: 'ownership live entities', inject: `players[1].units.push(players[1].units[0])`},
  'serialized-omission': {marker: 'serialized live-unit lists', inject: `const original = players[1].toJSON.bind(players[1]);
    players[1].toJSON = () => ({...original(), units: []})`},
  'resurrected-entity': {marker: 'live-entity conservation', inject: `ledgerVictim.killed = false;
    grid.setUnit(ledgerVictim, ledgerVictim.coord)`}
};
function runFault(name) {
  const {fixture, ledger} = setup();
  ledger.check('before-' + name);
  if (name === 'resurrected-entity') {
    fixture.evaluate(`globalThis.ledgerVictim = grid.getUnit({x:7,y:5}); ledgerVictim.kill()`);
    ledger.record({type: 'death', id: 'demon-unit'});
    ledger.check('after-death-before-resurrection');
  }
  fixture.evaluate(`(() => { ${faults[name].inject}; })()`);
  ledger.check(name); // Must escape uncaught and terminate this process nonzero.
}
function runTests() {
  const {fixture, ledger} = setup();
  ledger.check('initial-conservation');
  fixture.submit({type: 'move', source: {x:2,y:2}, destination: {x:2,y:3}},
    [{x:2,y:3,hp:2,moves:1}, {x:1,y:1,hp:2,moves:2}], s => s.players[1].units);
  ledger.record({type: 'move', id: 'human-one-unit', destination: {x:2,y:3}});
  ledger.check('after-move');
  for (const [type, id, owner, x, y] of [
    ['spawn', 'demon-spawn', 3, 6, 5], ['production', 'human-produced', 1, 3, 2]
  ]) {
    fixture.evaluate(`grid.getHexagon({x:${x},y:${y}}).playerColor = ${owner};
      globalThis.ledgerBorn = ${type === 'spawn' ? `new Noob(${x},${y})` :
        `new UnitProduction(0, production.noob.cost, Noob, 'noob').create(${x},${y})`}`);
    ledger.record({type, entity: {id, kind: 'unit', name: 'noob', owner, x, y}});
    ledger.bind(id, 'ledgerBorn');
    ledger.check('after-' + type);
  }
  fixture.evaluate(`grid.getUnit({x:7,y:5}).hit(2)`);
  ledger.record({type: 'death', id: 'demon-unit'});
  ledger.check('after-lethal-hit');
  // Exercise actual player/external/nature round hooks; UI/network phase order
  // and economy accounting are separate later tasks, not simulated here.
  for (let owner = 0; owner < 4; owner++) {
    fixture.evaluate(`whooseTurn = ${owner}; externalNextTurn(); natureNextTurn(); players[${owner}].nextTurn()`);
    ledger.check('after-round-player-' + owner);
  }
  assert.equal(fixture.evaluate('gameRound'), 1);
  ledger.check('after-round');
  for (const [name, fault] of Object.entries(faults)) {
    const child = spawnSync(process.execPath, [__filename, '--fault', name], {encoding: 'utf8'});
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    assert.equal(child.status, 1, name);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes(fault.marker), name);
    console.log(`PASS rejects-${name} expected_exit=1 observed_exit=${child.status} marker=${fault.marker}`);
  }
  console.log('PASS co-op entity ledger scenarios=17');
}
if (require.main === module) {
  if (process.argv[2] === '--fault') runFault(process.argv[3]);
  else runTests();
}
module.exports = {createEntityLedger};
