'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const {createRequire} = require('node:module');
const crypto = require('node:crypto');
const {once} = require('node:events');
const runtime = require('../../server/loadGameCode');
const {io: connect} = require('socket.io-client');
const {createEntityLedger} = require(path.join(runtime.gameDir, 'ai/test-coop-entity-ledger'));
const {createEconomyLedger} = require(path.join(runtime.gameDir, 'ai/test-coop-economy-ledger'));
const {createTurnLedger, compareCommitted} = require(path.join(runtime.gameDir, 'ai/test-coop-turn-ledger'));
const copy = x => JSON.parse(JSON.stringify(x));
const evaluate = code => {const v = vm.runInThisContext(code); return v === undefined ? v : copy(v)};
const fixture = {context:global, evaluate};
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function compare(label, observed, expected) {
    console.log(JSON.stringify({scenario:label, expected, observed}));
    assert.deepEqual(observed, expected, label); console.log('PASS '+label);
}
function event(socket, name) {
    return new Promise((resolve,reject) => {
        const timeout = setTimeout(() => {socket.off(name, receive); reject(new Error('timeout '+name))}, 5000);
        function receive(value) {clearTimeout(timeout); resolve(value)}
        socket.once(name, receive);
    });
}
async function launch(board, savedGame) {
    const passwords = board.gameSettings.coop.humanSlots.map(i=>'schedule-human-'+i);
    const [password,other]=passwords;
    const digest = p => crypto.createHash('sha256').update(p).digest('hex');
    const game = {gameID:'schedule-owned', playerIndexToUserIndex:[null,...passwords.map(digest),null], rounds:[]};
    const rows = {games:[game],users:passwords.map(p=>({userId:digest(p),gameID:game.gameID})),turns:[]};
    let revision=0;
    const matches=(r,q)=>Object.entries(q).every(([k,v])=>r[k]===v);
    const db={async createCollection(){},collection(name){return {
        async findOne(q){return copy(rows[name].find(r=>matches(r,q)) || null)},
        async updateOne(q,u){const row=rows[name].find(r=>matches(r,q)); assert(row);
            for(const [key,value] of Object.entries(u.$set)) {
                const parts=key.split('.'); let target=row;
                for(const part of parts.slice(0,-1))target=target[part];
                target[parts.at(-1)]=copy(value);
            }
            // Phase checkpoints are internal; only completed human/round commits advance this diagnostic revision.
            if(name==='games' && Object.hasOwn(u.$set,'rounds') && !u.$set.coopCheckpoint)revision++;
        },
        async insertOne(){throw new Error('unexpected insert')},
        async deleteOne(){throw new Error('unexpected delete')}
    }}};
    const server = http.createServer();
    const listen=server.listen.bind(server); server.listen=()=>listen(0,'127.0.0.1');
    const filename=path.join(__dirname,'../../server/index.js');
    const realRequire=createRequire(filename);
    let transport;
    const customRequire=name=> {
        if(name==='https')return {createServer:()=>server};
        if(name==='mongodb')return {MongoClient:class {async connect(){} db(){return db}}};
        if(name==='socket.io')return (...args)=>{transport=realRequire(name)(...args);return transport};
        return realRequire(name);
    };
    const api = new Function('require','__dirname','module','process',fs.readFileSync(filename,'utf8')+'\nreturn {enqueueGameOperation,createNewRound,handleNextTurn,finishRoundAndAdvanceAutomatedTurns,getCurrentParalleTurnInfo,advanceRoundCheckpoints,getTurnGameObjectForEmit};')(
        customRequire,path.dirname(filename),{exports:{}},{...process,env:{...process.env,LOCAL_DEV:'1'}});
    await once(server,'listening');
    if (savedGame) Object.assign(game, copy(savedGame));
    else game.rounds=[api.createNewRound(board)];
    // Read-only diagnostic snapshots expose the same stored commit to both
    // clients; revision is a test persistence counter, not a production field.
    transport.on('connection',socket=>socket.on('authoritySnapshot',ack=>ack({revision,state:copy(game.rounds)})));
    const clients=[password,other].map(()=>connect('http://127.0.0.1:'+server.address().port,{transports:['websocket'],reconnection:false}));
    await Promise.all(clients.map(c=>event(c,'connect')));
    return {game,clients,password,other,api,passwords,digest,get revision(){return revision},
        async close(){clients.forEach(c=>c.disconnect());await new Promise(resolve=>transport.close(resolve))}};
}
// Installed temporarily at tests/coop/twelve-humans.test.js by the game adapter.
test('twelve humans Big: authoritative peer and persisted reconnect convergence',{timeout:60000},async()=>{
 const {createFixture}=require(path.join(runtime.gameDir,'ai/test-coop-harness'));
 const f=createFixture(undefined,()=>{});
 f.evaluate(`globalThis.generated=generateCoopGame(12,{size:'big',seed:0});generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=0;gameSettings.isOnline=true;gameSettings.coop.typedWaves={lastRound:0};`);
 const board=f.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
 compare('Big-dimensions-roster-portals',f.evaluate('[grid.arr.length,grid.arr[0].length,gameSettings.coop.initialHumanCount,external.filter(p=>p.isDemonPortal).length]'),[68,68,12,36]);
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
  const result=await h.api.handleNextTurn(h.digest(h.passwords[player-1]),evaluate('getGameObject()'));
  compare('human-completion-accepted',!!result.ignored,false);
  peers=await snapshots();compare('committed-peer-convergence',hash(peers[0]),hash(peers[1]));
  const saved=copy(h.game),before=hash(saved.rounds);await h.close();h=await launch(board,saved);
  peers=await snapshots();compare('reconnected-peer-convergence',hash(peers[0]),hash(peers[1]));compare('persisted-rounds-no-replay',hash(h.game.rounds),before);
  console.log('PASS twelve-human server Big=68x68 portals=36 peers=2 reconnect=identical replay=none server_errors=0');
 }finally{await h.close()}
});
