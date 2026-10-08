'use strict';
// Authenticated deployment action/undo/commit and replay verification.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {io} = require('socket.io-client');
const {execFileSync} = require('child_process');
function refreshJournal() {
  if (args['journal-since']) fs.writeFileSync(args['server-log'], execFileSync('python3',
    [path.join(__dirname, 'journal.py'), args['journal-since']]));
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
for (const key of ['url', 'client-root', 'server-root', 'run', 'game', 'smoke-key-file', 'expires-at', 'server-log', 'out']) {
    if (!args[key]) throw new Error(`--${key} is required`);
}
const {signSmoke} = require(path.join(args['server-root'], 'server/smokeIsolation'));
const {serverRulesVersion} = require(path.join(args['server-root'], 'server/rulesVersion'));
const {createRuntimeContext, loadBrowserScripts} = require(path.join(args['client-root'], 'ai/gamestart-simple-economy-completion.js'));
const smokeKey = fs.readFileSync(args['smoke-key-file']);
const expiresAt = Number(args['expires-at']);
const MAP_NAME = 'test:deploy-enforce-replay';
const HUMANS = 2;
const TIMEOUT_MS = 60000;
const BOARD_EVENTS = ['gameStarted', 'playYourTurn', 'waitYouTurn'];
fs.mkdirSync(args.out, {recursive: true});

// Cancellation wakes pending protocol waits so finally can clean authenticated sockets.
let cancellation;
let rejectCancellation;
const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
cancelled.catch(() => {});
function cancel(signal) {
    if (cancellation) return;
    cancellation = new Error(`verification cancelled: ${signal}`);
    rejectCancellation(cancellation);
}
process.on('SIGTERM', () => cancel('SIGTERM'));
process.on('SIGINT', () => cancel('SIGINT'));
function wait(promise) {
    if (cancellation) return Promise.reject(cancellation);
    return Promise.race([promise, cancelled]);
}
const owned = {gameIDs: [], accountIds: []};
function persistOwned() {
    const file = path.join(args.out, 'owned.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(owned));
    fs.renameSync(file + '.tmp', file);
}
persistOwned();

const CLIENT_SETUP = `
  entityInterface = {visible: false, change() {}, hide() {}}
  townInterface = {visible: false, change() {}, hide() {}}
  barrackInterface = {visible: false, change() {}, hide() {}}
  statisticsInterface = {}
  gameEvent = {nextTurn() {}, waitingMode: false, selected: new Empty(), hideAll() {},
    removeSelection() { this.selected = new Empty() }, screen: {moveTo() {}, moveToPlayer() {}, stop() {}}}
  nextTurnButton = {setNextPlayerColor() {}, highlightButton: false, enableClick() {}, disableClick() {}}
  nextTurnPauseInterface = {visible: false}
  saveManager = {save() {}}
  menuBack = function() { gameExit = true }
  installHeadlessActionBorders()
  Border = HeadlessActionBorder
`;

function clientContext() {
    const context = createRuntimeContext(1);
    loadBrowserScripts(context);
    new vm.Script(CLIENT_SETUP, {filename: 'deploy-client-setup.js'}).runInContext(context);
    const run = (source, value) => {
        context.__value = JSON.stringify(value === undefined ? null : value);
        return JSON.parse(new vm.Script(`JSON.stringify((${source})(JSON.parse(__value)))`,
            {filename: 'deploy-client.js'}).runInContext(context) ?? 'null');
    };
    return run;
}

// The packed board the host sends for the shipped competitive map (as ops/prod_smoke_lobby.js competitiveBoard).
function competitiveBoard() {
    return clientContext()(`() => {
      const variant = maps['open field'].find(v => v.players.length === 3);
      isFogOfWar = false;
      variant.start({updateCameraBorders() {}, clearValues() {
        external=[]; externalProduction=[]; nature=[]; goldmines=[]; gameRound=0; gameExit=false;
      }}, false);
      const b = JSON.parse(JSON.stringify(getGameObject()));
      b.nature=[]; b.goldmines=[]; b.external=[]; b.externalProduction=[];
      for(const x of Object.keys(b.grid)) for(const y of Object.keys(b.grid[x])) b.grid[x][y]=0;
      b.players.forEach((p,i) => {
        p.towns=[]; p.gold=100;
        p.units = i ? [Object.assign({}, p.units[0], {coord:{x:5+i,y:6}, hp:i===2 ? 1 : 100})] : [];
        if(i) b.grid[5+i][6]=i;
      });
      b.whooseTurn=0; b.gameRound=0; b.gameSettings.isOnline=true;
      return b;
    }`);
}

// A free adjacent destination for the seat's first unit (shipped move rules), nearest its town; plan only.
function planMove(board, me, reserved) {
    const run = clientContext();
    run('board => { loadFromJson(JSON.stringify(board)) }', board);
    return run(`({me, reserved}) => {
        const same = (a, b) => a.x === b.x && a.y === b.y
        const player = players[me], unit = player.units[0], town = player.towns[0]
        const from = {x: unit.coord.x, y: unit.coord.y}
        unit.select()
        const neighbours = grid.getHexagon(unit.coord).neighbours
        const distance = c => Math.abs(c.x - town.coord.x) + Math.abs(c.y - town.coord.y)
        const options = unit.getAvailableMoveCommands().map(c => c.destinationCoord)
            .filter(c => neighbours.some(n => same(n, c)) && !same(c, from) && !reserved.some(r => same(r, c)))
            .filter(c => grid.getCell(c).unit.isEmpty() && grid.getCell(c).building.isEmpty())
            .sort((a, b) => distance(a) - distance(b) || a.x - b.x || a.y - b.y)
        return {from, to: options[0] ? {x: options[0].x, y: options[0].y} : null, name: unit.name, town: {x: town.coord.x, y: town.coord.y}}
    }`, {me, reserved});
}

function connect(identity) {
    const socket = io(args.url, {rejectUnauthorized: args['insecure-tls'] !== 'true', ...(args.ca ? {ca:fs.readFileSync(args.ca)} : {}), auth:{browserProtocol:2}, reconnection: false, timeout: 10000, transports: ['websocket']});
    const client = {socket, identity, inbox: [], waiters: [], diffs: []};
    socket.on('game:diff', data => { client.diffs.push(data); console.log('PASS spectator game:diff '+JSON.stringify({identity,gameID:data.gameID,seq:data.seq,actorSeat:data.actorSeat,cells:data.diff.cells.length})); });
    socket.onAny((event, payload) => {
        if (event === 'game:terrain') { client.terrain = payload; return; }
        if (!BOARD_EVENTS.includes(event)) return;
        client.inbox.push({event, board: typeof payload === 'string' ? JSON.parse(payload) : payload});
        client.waiters.splice(0).forEach(resolve => resolve());
    });
    client.request = async (event, body) => {
        if (cancellation) throw cancellation;
        const ack = await wait(socket.timeout(TIMEOUT_MS).emitWithAck(event, body));
        if (!ack || ack.ok !== true) throw new Error(`${event} failed for ${identity}: ${ack?.error || 'invalid acknowledgement'}`);
        if (event === 'auth:smoke') {
            client.authenticated = true; client.account = ack.account;
            owned.accountIds.push(ack.account.accountId); persistOwned();
        }
        if (event === 'lobby:start') { owned.gameIDs.push(ack.gameID); persistOwned(); }
        return ack;
    };
    client.next = async label => {
        const deadline = Date.now() + TIMEOUT_MS;
        while (!client.inbox.length) {
            if (Date.now() > deadline) throw new Error(`${identity}: no board event (${label})`);
            await wait(new Promise(resolve => { client.waiters.push(resolve); setTimeout(resolve, 200); }));
        }
        return client.inbox.shift();
    };
    client.connected = new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', error => reject(new Error(`connect_error ${identity}: ${error.message}`)));
    });
    client.connected.catch(() => {});
    return client;
}

const shadowLines = gameID => fs.readFileSync(args['server-log'], 'utf8').split('\n')
    .filter(line => /^SHADOW_[A-Z]+ /.test(line) && JSON.parse(line.slice(line.indexOf(' ') + 1)).gameID === gameID);

async function main() {
  const assert = require('node:assert/strict');
  const clients = [1,2].map(i=>connect(`prod_smoke_${args.run}_${args.game}_p${i}`));
  const result = {turns:[]};
  let failure;
  try {
    refreshJournal();
    assert.match(fs.readFileSync(args['server-log'],'utf8'), /^@@actionEnforce on$/m);
    assert.match(fs.readFileSync(args['server-log'],'utf8'), /^@@hiddenInfo on$/m);
    for(const c of clients) {
      await wait(c.connected);
      const credential={identity:c.identity,run:args.run,expiresAt};
      const signedIn=await c.request('auth:smoke',{...credential,signature:signSmoke(smokeKey,credential)});
      c.authenticated=true; c.account=signedIn.account;
      console.log('PASS auth:smoke identity='+c.identity);
    }
    const created=await clients[0].request('lobby:create',{board:competitiveBoard(),mapName:MAP_NAME});
    await clients[1].request('lobby:join',{lobbyId:created.lobby.lobbyId});
    const {gameID}=await clients[0].request('lobby:start',{lobbyId:created.lobby.lobbyId});
    result.gameID=gameID;
    console.log('PASS auth/lobby game='+gameID+' rulesVersion='+serverRulesVersion());
    for(const c of clients) {
      const ack=await c.request('game:open',{gameID,rulesVersion:serverRulesVersion()});
      c.playerIndex=ack.playerIndex;
    }
    for(const [index,kill] of [[0,false],[1,false],[0,true]]) {
      const c=clients[index];
      let entry;
      do { entry=await c.next('playable turn'); } while(entry.event!=='playYourTurn');
      assert.equal(entry.board.hiddenInfo,true);
      const run=clientContext();
      const board=run('({board,terrain}) => boardWithTerrain(board,terrain)',{board:entry.board,terrain:c.terrain});
      run('board => loadFromJson(JSON.stringify(board))',board);
      const action=kill ? {t:'unit',from:{x:6,y:6},to:{x:7,y:6},expect:{name:board.players[1].units[0].name}} :
        {t:'skip',at:{x:6+index,y:6}};
      let seq=0, truthHash;
      const actions=[];
      for(const a of (kill ? [action,{t:'end'}] : [action,{t:'undo'},action,{t:'end'}])) {
        if(a.t==='end') a.hash=run('() => stateHash()');
        const local=run('a => {const r=applyAction(a);return {ok:r.ok,reason:r.reason,hash:stateHash()}}',a);
        assert.equal(local.ok,true,JSON.stringify(local));
        const ack=await c.request('game:action',{gameID,seq:++seq,action:a});
        assert.match(ack.hash,/^[a-f0-9]{64}$/);
        truthHash=ack.hash;
        // Production has no test:seatState: commit validates filtered endHash; replay validates truth hash.
        if(ack.revealed?.length) run('cells => markRevealedCellsKnown(cells)',ack.revealed);
        console.log(`PASS protocol=2 seat=${c.playerIndex} round=${board.gameRound} game:action ${a.t} truthHash=${ack.hash} recorded; client filtered stateHash=${local.hash}`);
        actions.push(a);
      }
      const endHash=run('() => stateHash()');
      c.socket.emit('nextTurn',JSON.stringify({gameID,endHash}));
      result.turns.push({playerIndex:c.playerIndex,actions,endHash:truthHash});
    }
    let replay;
    const until=Date.now()+30000;
    do {
      replay=await wait(clients[0].socket.timeout(10000).emitWithAck('game:replay',{gameID}));
      if(replay.ok) break;
      assert.equal(replay.error,'NOT_FINISHED');
      await wait(new Promise(r=>setTimeout(r,100)));
    } while(Date.now()<until);
    assert.equal(replay.ok,true,JSON.stringify(replay));
    const logged=replay.turns.filter(t=>t.actions.length);
    assert.deepEqual(logged.map(({playerIndex,actions,endHash})=>({playerIndex,actions,endHash})),result.turns);
    assert.ok(replay.snapshots.length>=2);
    fs.writeFileSync(path.join(args.out,'replay-ack.json'),JSON.stringify(replay,null,2));
    assert.ok(clients.some(c=>c.diffs.some(d=>d.gameID===gameID && d.actorSeat!==c.playerIndex && d.diff.cells.length>0)), 'spectator received nonempty game:diff');
    fs.writeFileSync(path.join(args.out,'spectator-diffs.json'),JSON.stringify(clients.map(c=>({identity:c.identity,playerIndex:c.playerIndex,diffs:c.diffs})),null,2));
    for(const c of clients) for(const d of c.diffs) {
      assert.ok(!('order' in d.diff) && !('lists' in d.diff) && !('full' in d.diff));
      assert.ok(!d.diff.meta.fields || !('timers' in d.diff.meta.fields));
      for(const cell of d.diff.cells) if(cell.colour===null) {
        assert.ok(!cell.unit && !cell.building && !cell.production, 'hidden cell has no objects');
      }
    }
    console.log('PASS fog-filtered real-time diffs: hidden cells empty; full board ordering and timers absent');
    refreshJournal();
    const lines=fs.readFileSync(args['server-log'],'utf8').split('\n').filter(l=>l.startsWith('@@enforce commit ') && l.includes(gameID));
    assert.equal(lines.length,3);
    for(const line of lines) { assert.match(line,/protocol=2$/); console.log(line); }
    console.log(`PASS ENFORCE_REPLAY clients=2 turns=${logged.length} actions=${logged.reduce((n,t)=>n+t.actions.length,0)} snapshots=${replay.snapshots.length} stored actions/endHashes match`);
  } catch(e) {failure=e;console.error(e.stack);}
  finally {
    result.owned=owned;
    persistOwned();
    try {
      result.cleanup=args['no-cleanup']==='true' && !failure && !cancellation ? {status:'deferred'} : await require('./cleanup').cleanup(clients);
      console.log('CLEANUP '+JSON.stringify(result.cleanup));
    } catch(e) {result.cleanup={status:'failed',reason:e.message};failure=failure||e;console.error(e.stack);}
    clients.forEach(c=>c.socket.disconnect());
  }
  failure = failure || cancellation;
  fs.writeFileSync(path.join(args.out,'result.json'),JSON.stringify({...result, failure:failure?.message,ok:!failure},null,2));
  return !failure;
}
main().then(ok=>process.exit(ok?0:1),e=>{console.error(e.stack);process.exit(1)});
