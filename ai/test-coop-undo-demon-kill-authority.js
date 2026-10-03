// Regression: a human unit kills a demon and moves into its cell; undoing a
// later town action must not rebuild the demon list from that coordinate and
// adopt the human unit (the server rejects it as 'demon spawn/movement', or
// after a co-op peer commit persists a duplicate in the owner's list).
// JSON-only: synthetic fixture, stubbed socket, the server's own validator.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const clientDir = path.resolve(option('--client-dir', path.resolve(__dirname, '..')));
const serverDir = path.resolve(option('--server-dir', path.resolve(clientDir, '../diplomacy_server/server')));
const output = option('--output-dir', null);
const lines = [];
function log(line) { lines.push(line); console.log(line); }
if (output) fs.mkdirSync(path.join(output, 'boards'), {recursive: true});
function saveBoard(name, board) {
  if (output) fs.writeFileSync(path.join(output, 'boards', name + '.json'), JSON.stringify(board, null, 2) + '\n');
}

// The harness moved to diplomacy_server tests/client (TASK-451); it is loaded for the client copy so that it
// plays that copy's browser scripts.
const {createFixture, defaultFixture} = require(path.resolve(serverDir, '../tests/client/helpers/coop-harness-for-tree')).coopHarnessForTree(clientDir);
const {validateCoopAuthority} = require(path.join(serverDir, 'coopAuthority.js'));
log(`client-dir=${clientDir} server-dir=${serverDir}`);

const NOOB = {x: 2, y: 2}, IMP = {x: 2, y: 3}, TOWN = {x: 1, y: 1};
const PEER_FROM = {x: 7, y: 1}, PEER_TO = {x: 7, y: 2};
const LOCAL_SERVER = 'ws://127.0.0.1:1';

function setup() {
  const config = defaultFixture();
  config.coop = true;
  config.actors[1].units = [{...NOOB, hp: 2}];
  config.actors[3].units = [];
  const f = createFixture(config, () => {});
  f.context.impCoord = IMP;
  f.evaluate(`(() => {
    const slot = gameSettings.coop.demonSlot
    grid.getHexagon(impCoord).firstpaint(slot)
    const imp = new Imp(impCoord.x, impCoord.y)
    imp.hp = 1
    if (imp.player !== players[slot]) throw new Error('imp is not demon-owned')
    whooseTurn = 1
    actionManager.clear()
  })()`);
  const types = f.evaluate('JSON.parse(JSON.stringify(DEMON_TYPES))');
  const setupState = f.evaluate(`({slot: gameSettings.coop.demonSlot, humans: gameSettings.coop.humanSlots,
    gold: players[1].gold,
    units: players.map(p => p.units.map(u => [u.name, u.coord.x, u.coord.y, u.hp]))})`);
  return {f, types, setupState};
}

function board(f) { return f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'); }

function act(f, step) {
  f.context.step = step;
  return f.evaluate(`(() => {
    const s = step
    if (s.type === 'undo') { actionManager.undo(); return {undo: actionManager.arr.map(a => a.type)} }
    if (s.type === 'buy') {
      const town = grid.getBuilding(s.town)
      const gold = players[whooseTurn].gold
      if (!town.prepare('noob')) throw new Error('town.prepare(noob) refused, gold=' + gold)
      return {gold: [gold, players[whooseTurn].gold]}
    }
    const unit = grid.getUnit(s.from)
    if (unit.isEmpty() || !unit.isMyTurn) throw new Error('unit unavailable at ' + JSON.stringify(s.from))
    unit.select()
    if (!unit.getAvailableCommands().some(c => coordsEqually(c.destinationCoord, s.to)))
      throw new Error('illegal command ' + JSON.stringify(s))
    unit.sendInstructions(grid.getCell(s.to))
    return {target: grid.getUnit(s.to).name, owner: grid.getUnit(s.to).playerColor}
  })()`);
}

// Checks 1-3 inspect the live client after serialization; check 4 is the server.
function check(name, f, base, submitted, types) {
  const live = f.evaluate(`(() => {
    const owners = new Map(), cross = [], dupes = [], strays = []
    players.forEach((p, i) => {
      const seen = new Map()
      for (const u of p.units) {
        if (u.killed) continue
        const key = u.coord.x + ',' + u.coord.y
        if (!owners.has(u)) owners.set(u, [])
        owners.get(u).push(i)
        if (seen.has(key)) dupes.push({player: i, coord: key})
        seen.set(key, u)
        if (grid.getUnit(u.coord) !== u) strays.push({player: i, name: u.name, coord: key})
      }
    })
    for (const [u, list] of owners) if (new Set(list).size > 1)
      cross.push({name: u.name, coord: u.coord.x + ',' + u.coord.y, players: list})
    return {cross, dupes, strays,
      lists: players.map(p => p.units.filter(u => !u.killed).map(u => [u.name, u.coord.x, u.coord.y]))}
  })()`);
  const submittedCross = [];
  const byCoord = new Map();
  submitted.players.forEach((p, i) => p.units.forEach(u => {
    const key = u.coord.x + ',' + u.coord.y;
    if (byCoord.has(key) && byCoord.get(key) !== i) submittedCross.push({coord: key, players: [byCoord.get(key), i]});
    byCoord.set(key, i);
  }));
  log(JSON.stringify({scenario: name, lists: live.lists}));
  const results = [];
  const record = (label, fn) => {
    try { fn(); log(`PASS ${name} ${label}`); results.push({label, ok: true}); }
    catch (error) { log(`FAIL ${name} ${label}: ${error.message}`); results.push({label, ok: false, error: error.message}); }
  };
  record('no-unit-in-two-players-lists', () => {
    assert.deepEqual(live.cross, [], 'live unit in two lists');
    assert.deepEqual(submittedCross, [], 'serialized coordinate in two lists');
  });
  record('no-duplicate-coordinate-in-any-list', () => assert.deepEqual(live.dupes, []));
  record('every-list-unit-is-grid-unit', () => assert.deepEqual(live.strays, []));
  record('validateCoopAuthority-accepted', () =>
    validateCoopAuthority(base, submitted, 1, base.gameRound, types));
  return results;
}

const kill = {type: 'move', from: NOOB, to: IMP};
const buy = {type: 'buy', town: TOWN};
const undo = {type: 'undo'};

function runLocal(name, steps) {
  const {f, types, setupState} = setup();
  const base = board(f);
  if (name === 'A') saveBoard('turn-start', base);
  const trace = steps.map(step => ({step, result: act(f, step)}));
  log(JSON.stringify({scenario: name, setup: setupState, trace}));
  const submitted = board(f);
  saveBoard('submitted-' + name, submitted);
  return check(name, f, base, submitted, types);
}

// Scenario C: A, then a newer same-round co-op revision through the real
// SetupServerCommunicationLogic receive path ('continued'), then serialize.
function runContinuing() {
  const {f, types, setupState} = setup();
  const emitted = [];
  const socket = {handlers: {}, connected: false, url: null,
    io: {on() {}}, on(event, fn) { this.handlers[event] = fn; },
    emit(event) { emitted.push(event); }, disconnect() {}};
  f.context.fakeSocket = socket;
  f.context.localServer = LOCAL_SERVER;
  f.evaluate(`(() => {
    window.DIPLOMACY_SERVER = localServer
    document.getElementById = () => null
    io = (url, options) => { fakeSocket.url = url; return fakeSocket }
    undoButton = {enableClick() {}, disableClick() {}}
    nextTurnPauseInterface = {visible: false}
    timer = {updateLastPause() {}, pause() {}}
    GameManager.updateCameraBorders = () => {}
    gameEvent.waitingMode = false
    onlineSession.openGame = async () => ({ok: true, playerIndex: 1})
    enterLobbyGame = () => {}
    SetupServerCommunicationLogic('task247-local')
  })()`);
  assert.equal(socket.url, LOCAL_SERVER);
  const start = board(f);
  const accepted = {...start, coopCommit: {gameID: 'task247-local', revision: 1}};
  saveBoard('turn-start-C-revision-1', accepted);
  f.context.delivery = JSON.stringify(accepted);
  const first = f.evaluate(`fakeSocket.handlers.playYourTurn(delivery), whooseTurn`);
  // Build the peer's newer commit: player 2 moves, round and actor unchanged.
  const peer = setup().f;
  peer.context.board = JSON.stringify(start);
  peer.evaluate('loadFromJson(board); whooseTurn = 2; undefined');
  act(peer, {type: 'move', from: PEER_FROM, to: PEER_TO});
  peer.evaluate('whooseTurn = 1; undefined');
  const newer = {...board(peer), coopCommit: {gameID: 'task247-local', revision: 2}};
  assert.equal(newer.gameRound, start.gameRound);
  saveBoard('delivered-C-revision-2', newer);
  const trace = [kill, buy, undo].map(step => ({step, result: act(f, step)}));
  f.context.delivery = JSON.stringify(newer);
  // Only the 'continued' branch keeps the local undo stack and local kill;
  // a fresh load would reset both to the delivered board.
  const delivered = f.evaluate(`(() => {
    fakeSocket.handlers.playYourTurn(delivery)
    return {undo: actionManager.arr.map(a => a.type), commit: onlineCommit,
      atImp: grid.getUnit(${JSON.stringify(IMP)}).playerColor,
      peer: grid.getUnit(${JSON.stringify(PEER_TO)}).playerColor}
  })()`);
  log(JSON.stringify({scenario: 'C', setup: setupState, firstTurn: first, trace, afterDelivery: delivered, emitted}));
  const submitted = board(f);
  saveBoard('submitted-C', submitted);
  const base = {...newer};
  delete base.coopCommit;
  const results = check('C', f, base, submitted, types);
  const continued = delivered.commit.revision === 2 && delivered.undo.join() === 'unit' &&
    delivered.atImp === 1 && delivered.peer === 2 &&
    submitted.players[2].units.some(u => u.coord.x === PEER_TO.x && u.coord.y === PEER_TO.y);
  log(`${continued ? 'PASS' : 'FAIL'} C continuing-path revision=${delivered.commit.revision} ` +
    `undo=${delivered.undo.join('|')} local_kill_kept=${delivered.atImp === 1} peer_unit_at=${PEER_TO.x},${PEER_TO.y}`);
  results.push({label: 'continuing-path', ok: continued});
  return results;
}

const scenarios = [
  ['A', () => runLocal('A', [kill, buy, undo])],
  ['B', () => runLocal('B', [kill, undo, kill, buy, undo])],
  ['C', runContinuing],
  ['control-kill-no-undo', () => runLocal('control-kill-no-undo', [kill])],
  ['control-move-undo-move-buy-undo', () => runLocal('control-move-undo-move-buy-undo',
    [{type: 'move', from: NOOB, to: {x: 3, y: 2}}, undo, {type: 'move', from: NOOB, to: {x: 3, y: 2}}, buy, undo])]
];
const summary = {};
let failed = 0;
for (const [name, run] of scenarios) {
  let results;
  try { results = run(); }
  catch (error) { results = [{label: 'scenario-error', ok: false, error: error.stack}]; log(`FAIL ${name} scenario-error: ${error.stack}`); }
  summary[name] = results;
  failed += results.filter(r => !r.ok).length;
}
log(`${failed ? 'FAIL' : 'PASS'} coop-undo-demon-kill-authority scenarios=${scenarios.length} failed_checks=${failed}`);
if (output) {
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'stdout.log'), lines.join('\n') + '\n');
}
process.exitCode = failed ? 1 : 0;
