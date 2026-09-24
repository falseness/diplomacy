'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const helpers='../../diplomacy_server/tests/reliability/helpers/';
const {withServices}=require(helpers+'services');
const {currentCoopFixtureSpec,buildCurrentCoopBoardInVm}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
const out=process.argv[2];
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
async function wait(label,probe){const end=Math.min(Date.now()+30000,Number(process.env.TASK233_STOP_AT));while(Date.now()<end){const r=await probe();if(r)return r;await new Promise(r=>setTimeout(r,30));}throw Error('timeout '+label);}
async function main(){
 const rows=[];
 const result=await withServices({evidenceDir:out,bounds:{scenarioMs:Math.min(180000,Number(process.env.TASK233_STOP_AT)-Date.now()-60000)}},async service=>{
 for(const [fog,joinMode] of [[false,'sequential'],[true,'simultaneous']]){
 const id=`network-${joinMode}-fog-${fog}`,clients=[];
 const spec=currentCoopFixtureSpec({label:id,humans:2,size:'tiny',seed:1,purpose:'TASK-233 declared siege fixture',players:[
 {rgb:{r:100,g:100,b:100},gold:0,towns:[]},
 {rgb:{r:255,g:0,b:0},gold:100,towns:[{x:4,y:4}],units:[{type:'normchel',x:4,y:4}]},
 {rgb:{r:0,g:0,b:255},gold:100,towns:[{x:9,y:8}]}],demons:[{type:'bombard',x:4,y:6}]});
 const board=buildCurrentCoopBoardInVm(spec);board.isFogOfWar=fog;
 write(id+'-fixture.json',{spec,board});
 try{
 const join=async()=>{const handle=await service.connectSocket();const p={handle,password:crypto.randomUUID(),board:null,active:false};clients.push(p);
 handle.client.onAny((event,body)=>{if(event==='error')p.error=body;if(['gameStarted','playYourTurn','waitYouTurn'].includes(event)){const b=JSON.parse(body);if(b.grid){p.board=b;p.active=event!=='waitYouTurn';}}});
 handle.client.emit('startGameOrConnect',JSON.stringify({password:p.password,game:board}));await wait('join',()=>{if(p.error)throw Error(p.error);return p.board;});};
 if(joinMode==='sequential'){await join();await join();}else{const rs=await Promise.allSettled([join(),join()]);for(const r of rs)if(r.status==='rejected')throw r.reason;}
 assert.deepEqual(clients.map(p=>p.board.whooseTurn).sort(),[1,2]);
 const before=structuredClone(clients[0].board),submitted=new Set();
 while(submitted.size<2){const p=await wait('active human',()=>{const e=clients.find(p=>p.error);if(e)throw Error(e.error);return clients.find(p=>p.active&&!submitted.has(p));});
 submitted.add(p);p.active=false;const revision=p.board.coopCommit.revision,game=structuredClone(p.board);delete game.coopCommit;
 p.handle.client.emit('nextTurn',JSON.stringify({password:p.password,game,whooseTurn:p.board.whooseTurn}));await wait('ack',()=>clients.every(p=>p.board.coopCommit.revision>revision));}
 await wait('round 1',()=>clients.every(p=>p.board.gameRound===1));
 const project=b=>({townHP:b.players[1].towns.find(t=>t.coord.x===4&&t.coord.y===4).hp,occupantHP:b.players[1].units.find(u=>u.coord.x===4&&u.coord.y===4).hp,demons:b.players[3].units.map(u=>({name:u.name,hp:u.hp,moves:u.moves,coord:u.coord})),gold:b.players[3].gold});
 const expected={townHP:6,occupantHP:5,demons:[{name:'bombard',hp:4,moves:0,coord:{x:4,y:6}}],gold:0};
 const observed=clients.map(p=>project(p.board));
 const stored=await service.mongo.db(service.databaseName).collection('games').findOne({gameID:clients[0].board.coopCommit.gameID});
 const persisted=project(stored.rounds[1][0].parallelTurnResult);
 rows.push({id,before:project(before),expected,observed,persisted});write('network-attacks.json',{rows});
 for(const actual of [...observed,persisted])assert.deepEqual(actual,expected);
 console.log('PASS '+id);
 }finally{for(const p of clients)await p.handle.close();}
 }
 });
 write('network-cleanup.json',result);assert(result.cleanup.processes.every(p=>!p.aliveAfter)&&result.cleanup.directories.every(d=>!d.existsAfter));
 write('network-attacks.json',{rows,pass:true});console.log('PASS network-cleanup');
}
main().catch(e=>{if(e.cleanup)write('network-cleanup.json',{cleanup:e.cleanup});console.error(e);process.exitCode=1;});
