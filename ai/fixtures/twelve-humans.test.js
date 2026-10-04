'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const runtime = require('../../server/loadGameCode');
const {launchMemoryServer} = require('./helpers/memory-server');
const {createEntityLedger} = require('../client/test-coop-entity-ledger');
const {createEconomyLedger} = require('../client/test-coop-economy-ledger');
const {createTurnLedger, compareCommitted} = require(path.join(runtime.gameDir, 'ai/test-coop-turn-ledger'));
const copy = x => JSON.parse(JSON.stringify(x));
const evaluate = code => {const v = vm.runInThisContext(code); return v === undefined ? v : copy(v)};
const fixture = {context:global, evaluate};
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function compare(label, observed, expected) {
    console.log(JSON.stringify({scenario:label, expected, observed}));
    assert.deepEqual(observed, expected, label); console.log('PASS '+label);
}
// The production server runs over an in-memory DB with a seeded game; each
// human signs in with a seeded session (tests/coop/helpers/memory-server.js,
// TASK-310). A relaunch with savedGame keeps the previous host's accounts and
// sessions, like a server restart over the same database.
async function launch(board, savedGame, previous) {
    const h=await launchMemoryServer({secrets:board.gameSettings.coop.humanSlots.map(i=>'schedule-human-'+i),sockets:2,restart:previous,
        game:accountIds=>savedGame?copy(savedGame):{gameID:'schedule-owned',playerIndexToUserIndex:[null,...accountIds,null],rounds:[]},
        exports:['createNewRound','applyNextTurn','getCurrentParalleTurnInfo','getTurnGameObjectForEmit'],
        // Phase checkpoints are internal; only completed human/round commits advance this diagnostic revision.
        counts:changes=>Object.hasOwn(changes,'rounds') && !changes.coopCheckpoint,
        // Read-only diagnostic snapshots expose the same stored commit to both
        // clients; revision is a test persistence counter, not a production field.
        onConnection:(socket,host)=>socket.on('authoritySnapshot',ack=>ack({revision:host.revision,state:copy(host.game.rounds)}))});
    if (!savedGame) h.game.rounds=[h.api.createNewRound(board)];
    return h;
}
// Installed temporarily at tests/coop/twelve-humans.test.js by the game adapter.
// 180 s: the current Big H12 board (99x99, 158 portals; it was 68x68 with 36 when the bound was 60 s) took 50 s
// wall / 55 s CPU alone on this host (TASK-452).
test('twelve humans Big: authoritative peer and persisted reconnect convergence',{timeout:180000},async()=>{
 const {createFixture}=require('../client/test-coop-harness');
 const f=createFixture(undefined,()=>{});
 f.evaluate(`globalThis.generated=generateCoopGame(12,{size:'big',seed:0});generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=0;gameSettings.isOnline=true;gameSettings.coop.typedWaves={lastRound:0};`);
 const board=f.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
 // Hex circle big H12: R=max(16,ceil(14*sqrt(12)))=49, side 2R+1=99; 13 portals per human + 2 heavy = 158.
 compare('Big-dimensions-roster-portals',f.evaluate('[grid.arr.length,grid.arr[0].length,gameSettings.coop.initialHumanCount,external.filter(p=>p.isDemonPortal).length]'),[99,99,12,158]);
 let h=await launch(board);
 const snapshots=()=>Promise.all(h.clients.map(c=>new Promise((resolve,reject)=>c.timeout(5000).emit('authoritySnapshot',(e,s)=>e?reject(e):resolve(s)))));
 try {
  let peers=await snapshots();compare('initial-peer-convergence',hash(peers[0]),hash(peers[1]));
  const pending=h.api.getCurrentParalleTurnInfo(h.game).whoNewToPlay;
  compare('all-twelve-scheduled',h.game.rounds[0].slice(1).flatMap(c=>c.turns.map(t=>t.playerIndex)).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
  const player=pending[0],component=h.game.rounds.at(-1).slice(1).find(c=>c.turns[c.nextTurnIndex]?.playerIndex===player);
  const issued=await h.api.getTurnGameObjectForEmit(h.game.gameID,player,component.componentResult);
  global.scheduleBoard=issued||component.componentResult;global.schedulePlayer=player;
  evaluate('loadFromJson(JSON.stringify(scheduleBoard));whooseTurn=schedulePlayer;players[whooseTurn].nextTurn()');
  const result=await h.api.applyNextTurn(h.game.gameID,player,evaluate('getGameObject()'),null);
  compare('human-completion-accepted',!!result.ignored,false);
  peers=await snapshots();compare('committed-peer-convergence',hash(peers[0]),hash(peers[1]));
  const saved=copy(h.game),before=hash(saved.rounds);await h.close();h=await launch(board,saved,h);
  peers=await snapshots();compare('reconnected-peer-convergence',hash(peers[0]),hash(peers[1]));compare('persisted-rounds-no-replay',hash(h.game.rounds),before);
  console.log('PASS twelve-human server Big=99x99 portals=158 peers=2 reconnect=identical replay=none server_errors=0');
 }finally{await h.close()}
});
