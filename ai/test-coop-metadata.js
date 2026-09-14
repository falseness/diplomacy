const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger, committedSnapshot, compareCommitted} = require('./test-coop-turn-ledger');

function config(count, coop = true) {
  return {coop, size: {x: Math.max(21, count * 5 + 4), y: 11}, actors: [
    {role: 'neutral', rgb: {r: 100, g: 100, b: 100}, gold: 0,
      towns: [{x: 10, y: 8}], units: []},
    ...Array.from({length: count}, (_, i) => ({role: 'human',
      rgb: {r: 220 - i * 15, g: 40 + i * 15, b: 40}, gold: 100 + i * 25,
      towns: [{x: 1 + i * 5, y: 1}], units: []})),
    {role: 'demon', rgb: {r: 160, g: 40, b: 180}, gold: 0,
      economyEnabled: false, towns: [], units: [{x: 19, y: 8, hp: 2}]}
  ]};
}
function initialEntities(c) {
  return c.actors.flatMap((a, owner) => [
    ...a.towns.map(t => ({...t, id: `town-${owner}`, kind: 'town', name: 'town', owner})),
    ...(owner && a.towns.length ? a.towns : a.units).map(u => ({x: u.x, y: u.y,
      id: `unit-${owner}`, kind: 'unit', name: 'noob', owner}))
  ]);
}
function setup(c) {
  const f = createFixture(c);
  f.evaluate('globalThis.turnEvents = [];');
  const entity = createEntityLedger(f, initialEntities(c));
  const economy = createEconomyLedger(f, c.actors.map(({role, gold}) => ({role, gold})),
    {income: {town: 4, suburb: 1}, salary: {noob: 1}, purchase: {}, production: {}});
  const turn = createTurnLedger(c.actors.flatMap((a, i) => a.role === 'human' ? [i] : []));
  function check(label) {
    entity.check(label + '-entities');
    economy.check(label + '-economy');
    turn.check(label + '-turn', f.evaluate(`({round: gameRound, terminal: gameExit,
      events: [{type: 'human', round: gameRound, player: whooseTurn}]})`), 0);
  }
  return {f, entity, check};
}
function metadata(f) {
  return f.evaluate(`({coop: gameSettings.coop || null,
    roles: players.map(p => p.role), teams: players.map(p => p.team),
    allied: players[1].isAlliedWith(players[2]),
    neutralAllied: players[0].isAlliedWith(players[1]),
    demonAllied: players[players.length-1].isAlliedWith(players[1]),
    separateController: players[players.length-1] instanceof DemonPlayer,
    neutral: players[0] instanceof NeutralPlayer,
    neutralLost: players[0].isLost,
    balances: players.map(p => p.gold),
    owners: players.map(p => p.units.map(u => u.playerColor))})`);
}
function runCount(count) {
  const c = config(count), clients = [setup(c), setup(c)];
  const expected = {coop: {initialHumanCount: count,
    humanSlots: Array.from({length: count}, (_, i) => i + 1), humanTeam: 'HUMANS', demonSlot: count + 1, balanceVersion: 2},
    roles: ['NEUTRAL', ...Array(count).fill('HUMAN'), 'DEMONS'],
    teams: [0, ...Array(count).fill('HUMANS'), 'DEMONS'], allied: true,
    neutralAllied: false, demonAllied: false, separateController: true, neutral: true,
    neutralLost: false, balances: [0, ...Array.from({length: count}, (_, i) => 100 + i * 25), 0],
    owners: [[], ...Array.from({length: count + 1}, (_, i) => [i + 1])]};
  for (const {f, check} of clients) {
    f.compare(`coop-${count}-metadata`, metadata(f), expected);
    check(`coop-${count}-initial`);
  }
  compareCommitted(`coop-${count}-initial-clients`, committedSnapshot(clients[0].f, 0), committedSnapshot(clients[1].f, 0));
  for (const [revision, type, y, moves] of [[1, 'move', 2, 1], [2, 'undo', 1, 2]]) {
    for (const {f, entity, check} of clients) {
      f.submit(type === 'move' ? {type, source: {x: 1, y: 1}, destination: {x: 1, y: 2}} : {type},
        [{x: 1, y, hp: 2, moves}], state => state.players[1].units);
      if (type === 'undo') {
        // Runtime undo reconstructs the unit; keep its declared logical ID.
        f.evaluate(`for (const [object, id] of ledgerObjects)
          if (id === 'unit-1' && object.killed) ledgerObjects.delete(object);`);
        entity.bind('unit-1', 'grid.getUnit({x:1,y:1})');
      }
      entity.record({type: 'move', id: 'unit-1', destination: {x: 1, y}});
      check(`coop-${count}-after-${type}`);
      f.compare(`coop-${count}-${type}-metadata`, metadata(f), expected);
    }
    compareCommitted(`coop-${count}-${type}-clients`, committedSnapshot(clients[0].f, revision), committedSnapshot(clients[1].f, revision));
  }
  // Exercise the real save/load boundary, including controller reconstruction.
  const f = clients[0].f;
  f.evaluate('loadFromJson(JSON.stringify(getGameObject()));');
  f.compare(`coop-${count}-restored-metadata`, metadata(f), expected);
  createEntityLedger(f, initialEntities(c)).check(`coop-${count}-restored-entities`);
  clients[0].check(`coop-${count}-restored`);
  compareCommitted(`coop-${count}-restored-clients`, committedSnapshot(f, 2), committedSnapshot(clients[1].f, 2));
  // Initial roster survives actions and persistence unchanged.
  f.compare(`coop-${count}-initial-roster-retained`, f.evaluate(`gameSettings.coop.initialHumanCount`), count);
}
function runTests() {
  const legacy = setup(config(2, false));
  const {f} = legacy;
  const counts = f.evaluate('Object.values(maps).flatMap(group => group.map(m => m.players.length - 1))');
  f.compare('local-online-interface-extrema', [Math.min(...counts), Math.max(...counts)], [2, 4]);
  // Both menu slider definitions use value+2 and selected map group length-1.
  const menu = require('fs').readFileSync(require('path').join(__dirname, '../menu/menu.js'), 'utf8');
  assert.equal((menu.match(/^        let getKeyPlayers = function\(value\) \{ return value \+ 2 \}/gm) || []).length, 2);
  console.log('PASS local-online-slider-mapping expected=2 observed=2');
  f.compare('legacy-competitive', f.evaluate(`({coop: gameSettings.coop || null,
    allied: players[1].isAlliedWith(players[2]), teams: players.map(p => p.team),
    controller: players[3] instanceof DemonPlayer})`),
    {coop: null, allied: false, teams: [0, 1, 2, 3], controller: false});
  legacy.check('legacy-initial');
  for (const count of [2,3,4,5,8,12]) runCount(count);
  // Restarting a legacy map must clear prior co-op metadata in the same runtime.
  f.evaluate(`gameSettings.coop = {humanSlots: [1,2], humanTeam: 'HUMANS', demonSlot: 3};
    maps['open field'][0].start({clearValues() {external=[]; externalProduction=[]; nature=[]; goldmines=[]; gameRound=0; gameExit=false}, updateCameraBorders() {}}, false);`);
  f.compare('legacy-restart-clears-coop', f.evaluate('({coop: gameSettings.coop || null, allied: players[1].isAlliedWith(players[2])})'), {coop: null, allied: false});
  console.log('INAPPLICABLE completed-round wave/demon counts: no end-turn or round action in metadata scenarios; initial human order/round checked after each move/undo.');
  console.log('INAPPLICABLE online transport commits: no network controller in this task; complete serialized peer state compared at matching fixture revisions 0/1/2.');
  console.log('INAPPLICABLE income/expense events: move/undo and serialization transfer no gold; independent starting balances checked after each action.');
  const child = spawnSync(process.execPath, [__filename, '--fault'], {encoding: 'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  assert.equal(child.status, 1); assert.match(child.stderr, /AssertionError/); assert.match(child.stderr, /human 1 balance/);
  console.log(`PASS rejects-corrupt-human-balance expected_exit=1 observed_exit=${child.status}`);
  console.log('PASS co-op metadata counts=2,3,4,5,8,12');
}
if (require.main === module) {
  if (process.argv.includes('--fault')) {
    const {f, check} = setup(config(2));
    f.evaluate('players[1].gold++'); check('corrupt-human-balance');
  } else runTests();
}
