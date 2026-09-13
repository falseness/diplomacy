const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const copy = value => JSON.parse(JSON.stringify(value));

// A reference schedule takes declared eliminations, never runtime isLost or
// observed phase counts. Round zero is the fixture's first playable round.
function createTurnLedger(humans, report = console.log) {
  const roster = [...humans];
  const eliminations = new Map();
  function eliminate(player, beforeRound) {
    assert.ok(roster.includes(player));
    assert.ok(Number.isInteger(beforeRound) && beforeRound >= 0);
    eliminations.set(player, beforeRound);
  }
  function expected(completedRounds, terminal = false) {
    assert.ok(Number.isInteger(completedRounds) && completedRounds >= 0, 'valid round');
    const events = [];
    for (let round = 0; round <= completedRounds; round++) {
      const alive = roster.filter(p => !eliminations.has(p) || eliminations.get(p) > round);
      if (round === completedRounds) {
        if (!terminal && alive.length) events.push({type: 'human', round, player: alive[0]});
        break;
      }
      assert.ok(alive.length, 'completed nonterminal round has humans');
      events.push(...alive.map(player => ({type: 'human', round, player})),
        {type: 'wave', round}, {type: 'demon', round}, {type: 'complete', round});
    }
    return events;
  }
  function check(label, observed, completedRounds, terminal = false) {
    const wanted = expected(completedRounds, terminal);
    report(JSON.stringify({scenario: label, roster, eliminations: [...eliminations],
      expected: {round: completedRounds, terminal, events: wanted}, observed}));
    assert.equal(observed.round, completedRounds, 'valid round progression');
    assert.equal(observed.terminal, terminal, 'terminal state');
    for (let round = 0; round < completedRounds; round++) {
      for (const type of ['wave', 'demon', 'complete']) {
        assert.equal(observed.events.filter(e => e.round === round && e.type === type).length,
          1, `exactly one ${type} phase round ${round}`);
      }
    }
    assert.deepStrictEqual(observed.events, wanted, 'human order and phase sequence');
    report(`PASS ${label} expected_round=${completedRounds} observed_round=${observed.round} events=${wanted.length}`);
  }
  return {eliminate, expected, check};
}

// The current game has no co-op wave controller or network commit revision.
// This adapter records the real offline dispatcher/player hooks. Only the wave
// opportunity and revision envelope are fixture protocol metadata. Future
// controllers can supply these observations directly to the exported checks.
function createTurnFixture() {
  const fixture = createFixture();
  fixture.evaluate(`globalThis.turnEvents = [{type: 'human', round: 0, player: 1}];
    gameSettings.isOnline = false;
    AiRuntime.trainFromHumanCommands = () => {}; // No model training in this fixture.
    gameEvent.nextTurn = () => {};
    timer = {pauseAndSaveTime() {}, setNextTurnTime() {}};
    unpacker.getPlayerTimerByIndex = () => JSON.stringify({remaining: 60});
    nextTurnPauseInterface = {visible: false};
    globalThis.saveManager = {save: () => {
      if (fixtureConfig.actors[whooseTurn].role === 'human')
        turnEvents.push({type: 'human', round: gameRound, player: whooseTurn});
    }};
    const demonTurn = players[3].nextTurn.bind(players[3]);
    players[3].nextTurn = () => {
      turnEvents.push({type: 'wave', round: gameRound});
      turnEvents.push({type: 'demon', round: gameRound});
      demonTurn();
    };
    const neutralTurn = players[0].nextTurn.bind(players[0]);
    players[0].nextTurn = () => {
      neutralTurn();
      turnEvents.push({type: 'complete', round: gameRound - 1});
    }; undefined;`);
  return fixture;
}
function observation(fixture) {
  return fixture.evaluate('({round: gameRound, terminal: gameExit, events: turnEvents})');
}

// Include the entire persisted game plus state omitted by its serializers:
// map entities (not just territory), fog, economy flags and elimination,
// terminal state, and the fixture phase journal. UI/camera and wall-clock
// animation state do not affect committed gameplay. Timers are deterministic.
function committedSnapshot(fixture, revision) {
  assert.ok(Number.isInteger(revision) && revision >= 0, 'valid committed revision');
  return {revision, state: fixture.evaluate(`JSON.parse(JSON.stringify({game: JSON.parse(JSON.stringify(getGameObject())),
    terminal: gameExit, suddenDeathRound,
    cells: grid.arr.map(column => column.map(c => ({coord: c.coord,
      unit: c.unit, building: c.building}))), fog: grid.fogOfWar || null,
    actors: players.map((p, i) => ({role: fixtureConfig.actors[i].role,
      economyEnabled: p.economyEnabled !== false, eliminated: p.isLost,
      goldmines: p.goldmines})), phases: turnEvents}))`)};
}
function compareCommitted(label, left, right, report = console.log) {
  report(JSON.stringify({scenario: label, expected: left, observed: right}));
  assert.ok(Number.isInteger(left.revision) && left.revision >= 0, 'valid committed revision');
  assert.equal(right.revision, left.revision, 'matching committed revisions');
  assert.deepStrictEqual(right.state, left.state, 'complete committed client state');
  report(`PASS ${label} expected_revision=${left.revision} observed_revision=${right.revision}`);
}
function eliminateSecondHuman(fixture) {
  fixture.evaluate(`players[2].units.slice().forEach(u => u.kill());
    players[2].towns.slice().forEach(t => t.destroy());`);
  assert.equal(fixture.evaluate('players[2].isLost'), true, 'real player elimination');
}
function advance(fixture, count) {
  for (let i = 0; i < count; i++) fixture.evaluate('offlineNextTurn()');
}
const faults = {
  'duplicate-wave': 'exactly one wave phase',
  'duplicate-demon': 'exactly one demon phase',
  'missing-wave': 'exactly one wave phase',
  'wrong-human-order': 'human order and phase sequence',
  'eliminated-human': 'human order and phase sequence',
  'invalid-round': 'valid round progression',
  'divergent-gold': 'complete committed client state',
  'divergent-hp': 'complete committed client state',
  'divergent-territory': 'complete committed client state',
  'divergent-production': 'complete committed client state',
  'divergent-timer': 'complete committed client state',
  'divergent-terminal': 'complete committed client state',
  'mismatched-revision': 'matching committed revisions'
};
function runFault(name) {
  assert.ok(name in faults);
  const fixture = createTurnFixture();
  if (name.startsWith('divergent-') || name === 'mismatched-revision') {
    const left = committedSnapshot(fixture, 0);
    const mutations = {
      'divergent-gold': 'players[2].gold++',
      'divergent-hp': 'players[1].units[0].hp--',
      'divergent-territory': 'grid.getHexagon({x:0,y:0}).playerColor = 2',
      'divergent-production': 'players[1].towns[0].unitProduction = new UnitProduction(2, 20, Noob, "noob")',
      'divergent-timer': 'unpacker.getPlayerTimerByIndex = () => JSON.stringify({remaining: 59})',
      'divergent-terminal': 'gameExit = true'
    };
    if (mutations[name]) fixture.evaluate(mutations[name] + '; undefined');
    compareCommitted(name, left, committedSnapshot(fixture, name === 'mismatched-revision' ? 1 : 0));
    return;
  }
  const ledger = createTurnLedger([1, 2]);
  advance(fixture, 3);
  const observed = observation(fixture);
  if (name.startsWith('duplicate-')) observed.events.splice(3, 0, {type: name.slice(10), round: 0});
  if (name === 'missing-wave') observed.events = observed.events.filter(e => e.type !== 'wave');
  if (name === 'wrong-human-order') [observed.events[0], observed.events[1]] = [observed.events[1], observed.events[0]];
  if (name === 'eliminated-human') ledger.eliminate(2, 0);
  if (name === 'invalid-round') observed.round = -1;
  ledger.check(name, observed, 1);
}
function runTests() {
  const clients = [createTurnFixture(), createTurnFixture()];
  const ledger = createTurnLedger([1, 2]);
  ledger.check('initial-human-order', observation(clients[0]), 0);
  const initial = committedSnapshot(clients[0], 0);
  compareCommitted('initial-committed-clients', initial, committedSnapshot(clients[1], 0));
  for (const fixture of clients) {
    fixture.submit({type: 'move', source: {x:2,y:2}, destination: {x:2,y:3}},
      [{x:2,y:3,hp:2,moves:1}, {x:1,y:1,hp:2,moves:2}], s => s.players[1].units);
  }
  compareCommitted('move-committed-clients', committedSnapshot(clients[0], 1), committedSnapshot(clients[1], 1));
  assert.equal(initial.state.game.players[1].units[0].coord.y, 2, 'detached committed snapshot');
  console.log('PASS detached-committed-snapshot expected_y=2 observed_y=2');
  clients.forEach(f => advance(f, 3));
  clients.forEach(f => ledger.check('completed-round-two-humans', observation(f), 1));
  compareCommitted('round-one-committed-clients', committedSnapshot(clients[0], 2), committedSnapshot(clients[1], 2));
  clients.forEach(eliminateSecondHuman);
  ledger.eliminate(2, 1);
  for (let round = 2; round <= 3; round++) {
    clients.forEach(f => advance(f, 2));
    clients.forEach(f => ledger.check('skips-eliminated-human-round-' + round, observation(f), round));
    compareCommitted('round-' + round + '-committed-clients', committedSnapshot(clients[0], round + 1),
      committedSnapshot(clients[1], round + 1));
  }
  // Terminal mid-round: no completed-round obligation for the partial round,
  // and the production gameExit guard must leave all observations unchanged.
  clients.forEach(f => f.evaluate('gameExit = true'));
  const terminalBefore = committedSnapshot(clients[0], 5);
  clients.forEach(f => advance(f, 2));
  compareCommitted('terminal-does-not-advance', terminalBefore, committedSnapshot(clients[0], 5));
  compareCommitted('terminal-committed-clients', terminalBefore, committedSnapshot(clients[1], 5));
  // Independently specified protocol boundary (separate from the real
  // dispatcher test above, which terminates mid-round).
  createTurnLedger([1, 2]).check('terminal-before-first-round',
    {round: 0, terminal: true, events: []}, 0, true);
  for (const [name, marker] of Object.entries(faults)) {
    const child = spawnSync(process.execPath, [__filename, '--fault', name],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000});
    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    assert.equal(child.error, undefined, name);
    assert.equal(child.status, 1, name);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes(marker), name);
    console.log(`PASS rejects-${name} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log(`PASS co-op turn ledger fault_probes=${Object.keys(faults).length}`);
}
if (require.main === module) {
  if (process.argv[2] === '--fault') runFault(process.argv[3]);
  else runTests();
}
module.exports = {createTurnLedger, committedSnapshot, compareCommitted};
