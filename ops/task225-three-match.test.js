'use strict';
// TASK-225 supplemental producer; lifecycle/UI scaffolding adapted from TASK-209.
const sr=require('node:module').createRequire('/root/diplomacy_server/tests/reliability/concurrent-games.test.js');
process.env.PLAYWRIGHT_BROWSERS_PATH??='0';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{withServices,bounded}=sr('./helpers/services');
const {BrowserPlayer,startClientServer}=sr('./helpers/browser-driver'),{reconnect}=sr('./helpers/movement-identity-reconnect');
const {canonicalBoard:projectBoard}=sr('./helpers/building-state'),fixture=sr('../coop/helpers/current-coop-fixture'),obs=sr('./helpers/observations');
function canonicalBoard(b){const v=projectBoard(b);v.nature.sort((a,b)=>a.coord.x-b.coord.x||a.coord.y-b.coord.y||a.name.localeCompare(b.name));return v;}
const READ_BOARD=new Function(`const projectBoard=${projectBoard.toString()};return (${canonicalBoard.toString()})({gameRound,grid:grid.arr.map(col=>col.map(c=>c.hexagon.playerColor)),players,external,externalProduction,nature,goldmines})`);
const CASES=['three-match-interleaving']; const requiredCheckpoints=()=>['three-match/participants','three-match/round-1','three-match/round-2','cleanup'];
const wait=async fn=>{const until=Date.now()+30000;while(Date.now()<until){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('response exceeded 30000ms');};
function board(humans,coop,label){
 global.townInterface??={change(){},hide(){}};
 const side=14;
 const players=[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},...Array.from({length:humans},(_,i)=>({rgb:{r:40+i*17,g:80,b:160},gold:200+i*30,towns:[{x:i?9:1,y:i?8:1}],units:i===0?[{type:'noob',x:3,y:6}]:[]}))];
 // Four genuine imps, each in a separate one-cell authored mountain enclosure.
 // No substituted AI, injected delay or runtime board edits.
 const holes=[{x:9,y:3},{x:9,y:5},{x:11,y:3},{x:11,y:5}];
 const mountains=[];for(let x=8;x<=12;x++)for(let y=2;y<=6;y++)if(!holes.some(c=>c.x===x&&c.y===y))mountains.push({x,y});
 const spec=fixture.currentCoopFixtureSpec({label,humans:2,size:'tiny',seed:1,players,demons:holes.map(c=>({type:'imp',...c})),terrain:{mountains}});
 const b=fixture.buildCurrentCoopBoardInVm(spec);b.isFogOfWar=coop;
 if(!coop){b.gameSettings.coop=null;b.players.pop();b.timers.pop();b.external=[];b.grid=b.grid.map(col=>col.map(n=>n===humans+1?0:n));}
 return {spec,board:b};
}
test('TASK-225 three real matches supplemental observation',{timeout:3300000},async t=>{
 const out=process.env.ONLINE_EVIDENCE_DIR,checks=[],coverage=[],timings=[],events=[],secrets=[],errors=[],reloadAborts=[],reloading=new Set();
 const json=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
 fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
 const check=(id,expected,observed)=>{const pass=require('node:util').isDeepStrictEqual(expected,observed);checks.push({id,expected:structuredClone(expected),observed:structuredClone(observed),pass});console.log(`${pass?'PASS':'FAIL'} ${id}`);assert.deepEqual(observed,expected,id);};
 const trace=row=>{events.push(row);fs.appendFileSync(path.join(out,'game-isolation.jsonl'),JSON.stringify(obs.redact({at:Date.now(),...row},secrets))+'\n');};
 const measure=async(id,phase,ms,fn)=>{const start=Date.now();try{return await bounded(id+'/'+phase,ms,fn);}finally{timings.push({id,phase,elapsedMs:Date.now()-start,boundMs:ms,pass:Date.now()-start<ms});}};
 json('verification-plan.json',{cases:CASES.map(id=>({id,tier:'four shipped browser contexts plus two extra protocol identities; real HTTPS/Socket.IO/MongoDB'})),requiredCheckpoints:requiredCheckpoints(),estimateMs:1200000,budgetMs:3600000,stopWorkMs:3300000,bounds:{responseMs:30000,phaseMs:60000,uiSetupMs:240000},seed:1,size:'tiny',browserContexts:4,viewport:{width:960,height:640},commands:['ONLINE_EVIDENCE_DIR=<fresh> NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 --test ops/task225-three-match.test.js','git diff --check in both repositories','evidence/source/cleanup audit'],exclusions:['ten-player boundary retained only in original TASK-209','three concurrent browser games','exhaustive seed/class/count matrices','high-count rendering stress'],oracle:'Authored fixture, literal +9/+10 income, movement and refresh; four individually mountain-enclosed real imps per co-op; exact canonical board assertions and persisted phase snapshots.'});
 let browser,client,logDir,lifecycle;
 const abort=()=>void browser?.close();process.on('SIGTERM',abort);t.signal.addEventListener('abort',abort,{once:true});
 try{
 lifecycle=await withServices({evidenceDir:out,pollingOnly:true,serverPreloads:[path.join(__dirname,'task225-three-match-observer.js')]},async service=>{
 logDir=service.logDir;client=await startClientServer(undefined,{emptyFavicon:true});
 const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type:'spki',format:'der'})).digest('base64');
 browser=await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});console.log('runtime '+JSON.stringify({node:process.version,chromium:browser.version(),services:service.lifecycle.runtime}));
 const games=service.mongo.db(service.databaseName).collection('games');
 const make=(n,coop,id)=>{const f=board(n,coop,id);json(id+'-fixture.json',f);return {id,n,coop,b:f.board,peers:[],ui:[],round:0,expected:null};};
 const a=make(2,true,'coop-browser'),b=make(2,false,'competitive-browser'),c=make(2,true,'coop-extra');
 const attach=async(g,p)=>{
  p.handle=await service.connectSocket({transports:['polling']});
  p.handle.client.onAny((event,body)=>{let v;try{v=typeof body==='string'?JSON.parse(body):body;}catch{v=body;}
   if(event==='error')p.error=v;
   if(['gameStarted','playYourTurn','waitYouTurn'].includes(event)&&v?.grid){p.state=v;p.active=event!=='waitYouTurn';trace({id:g.id,event,slot:v.whooseTurn,round:v.gameRound,gameID:v.coopCommit?.gameID,board:canonicalBoard(v),fullBoard:v,recipient:g.peers.indexOf(p)+1});}
  });
  p.handle.client.emit('startGameOrConnect',JSON.stringify({password:p.password,game:g.b}));
  await wait(()=>{if(p.error)throw Error(JSON.stringify(p.error));return p.state;});
 };
 const join=async g=>{const p={password:String(crypto.randomInt(100000000000,999999999999))};secrets.push(p.password);g.peers.push(p);await attach(g,p);};
 // Admission requests alternate modes; all four identities share this server.
 await join(a);await join(b);await join(c);await join(a);await join(b);await join(c);
 const init=async g=>{g.peers.sort((x,y)=>x.state.whooseTurn-y.state.whooseTurn);g.doc=await games.findOne({playerIndexToUserIndex:obs.sha256(g.peers[0].password)});g.gameID=g.doc.gameID;g.expected=canonicalBoard(g.b);for(let i=1;i<=g.n;i++)g.expected.players[i].gold+=i===1?9:10;};
 await init(a);await init(b);await init(c);json('game-identities.json',[a,b,c].map(g=>({id:g.id,gameID:g.gameID,humans:g.n,coop:g.coop})));
 const ready=async(p,r)=>{await wait(()=>p.deliveries>0);await p.page.bringToFront();await p.page.waitForFunction(r=>onlineSocket?.connected&&gameRound===r&&!gameEvent.waitingMode,r,{timeout:30000});if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:480,y:320},'dismiss turn overlay','!nextTurnPauseInterface.visible');await p.page.waitForFunction(()=>nextTurnButton.canClick&&!nextTurnButton.unactive,null,{timeout:10000});};
 await measure('browser-pair','UI joining',240000,async()=>{await Promise.all([a,b].map(async g=>{for(let i=0;i<2;i++){
  const p=await BrowserPlayer.open(browser,{name:g.id+'-p'+(i+1),input:'mouse',viewport:{width:960,height:640},endpoint:service.endpoint,clientUrl:client.url,errors:{push(row){if(reloading.has(row.player)&&row.type==='requestfailed'&&row.text==='net::ERR_ABORTED'&&row.url.startsWith(service.endpoint+'/socket.io/'))reloadAborts.push({...row,at:Date.now(),reason:'explicit UI reload canceled its outstanding polling request'});else errors.push(row);}},wire:({direction,text})=>{const packet=obs.sanitizePacket(text,secrets);fs.appendFileSync(path.join(out,'wire.jsonl'),JSON.stringify({at:Date.now(),id:g.id,slot:i+1,direction,...packet})+'\n');},screenshotDir:path.join(out,'screenshots'),events:{write(){}},inputs:{write(line){const row=JSON.parse(line);if(/password/.test(row.label||'')){delete row.x;delete row.y;}fs.appendFileSync(path.join(out,'inputs.jsonl'),JSON.stringify(row)+'\n');}}});
  // Hold a real key until a frame observes it, as in the existing purchases harness.
  p.pan=async(dx,dy,before)=>{const keys=[];if(dx)keys.push(dx>0?'ArrowRight':'ArrowLeft');if(dy)keys.push(dy>0?'ArrowDown':'ArrowUp');p.trace({action:'key-hold-until-camera-change',keys,before});try{for(const k of keys)await p.page.keyboard.down(k);await p.page.waitForFunction(b=>canvas.offset.x!==b.x||canvas.offset.y!==b.y,before,{timeout:5000,polling:'raf'});}finally{for(const k of keys)await p.page.keyboard.up(k);}};
  p.deliveries=0;p.page.on('console',m=>{if(['playYourTurn','gameStarted','waitYouTurn'].includes(m.text()))p.deliveries++;});
  g.ui.push(p);await p.page.bringToFront();
  await reconnect(p,{password:g.peers[i].password,coop:g.coop,map:'tiny deathmatch',fog:g.coop,alreadyAtMenu:true});await ready(p,0);
 }}));});
 check('three-match/participants',{contexts:4,counts:[2,2,2],distinctGames:3},{contexts:browser.contexts().length,counts:[a,b,c].map(g=>g.doc.playerIndexToUserIndex.filter(Boolean).length),distinctGames:new Set([a.gameID,b.gameID,c.gameID]).size});
 const exact=async(g,label)=>{for(const [i,p]of g.ui.entries())check(label+'/'+g.id+'/p'+i,g.expected,await p.observe(READ_BOARD));};
 await exact(a,'browser-pair/initial');await exact(b,'browser-pair/initial');check('browser-pair/initial-exact',true,true);
 const persisted=async(g,r)=>{const d=await games.findOne({gameID:g.gameID});check(g.id+'/persisted/'+r+'/participants',obs.redact([...g.peers.map(p=>obs.sha256(p.password)),...(g.coop?[null]:[])],secrets),obs.redact(d.playerIndexToUserIndex.slice(1),secrets));check(g.id+'/persisted/'+r+'/rounds',r+1,d.rounds.length);check(g.id+'/persisted/'+r+'/revision',g.coop?g.n*r:0,d.coopRevision||0);const base=structuredClone(g.expected);for(let i=1;i<=g.n;i++)base.players[i].gold-=i===1?9:10;if(g.movedRound===r)base.players[1].units[0].moves=1;check(g.id+'/persisted/'+r+'/board',base,canonicalBoard(d.rounds.at(-1)[0].parallelTurnResult));json(g.id+'-persisted-'+r+'.json',obs.redact(d,secrets));};
 const advanceExpected=g=>{g.round++;g.expected.gameRound=g.round;for(let i=1;i<=g.n;i++){g.expected.players[i].gold+=i===1?9:10;g.expected.players[i].units.forEach(u=>u.moves=2);}if(g.coop)g.expected.players[g.n+1].units.forEach(u=>u.moves=2);};
 const submitUI=async(g,i)=>{const p=g.ui[i];await ready(p,g.round);await p.tapControl('nextTurnButton','interleaved human submission');};
 const submitProtocol=async(g,i)=>{
  const p=g.peers[i],game=structuredClone(p.state);delete game.coopCommit;
  trace({id:g.id,event:'submission',slot:i+1,round:g.round,gameID:g.gameID,board:canonicalBoard(game)});
  p.handle.client.emit('nextTurn',JSON.stringify({password:p.password,game,whooseTurn:p.state.whooseTurn}));
 };
 // First-round legal UI movement, with full intermediate MongoDB documents.
 for(const g of [a,b]){await g.ui[0].page.bringToFront();await g.ui[0].tapCell({x:3,y:6},'select independent mover','gameEvent.selected.isUnit');await g.ui[0].tapCell({x:3,y:5},'move independent army','actionManager.arr.length === 1');g.expected.players[1].units[0].coord={x:3,y:5};g.expected.players[1].units[0].moves=1;g.expected.grid[3][5]=1;g.movedRound=1;await exact({...g,ui:[g.ui[0]]},'three-match/move');}
 for(let round=0;round<2;round++)await measure('three-match-interleaving','round '+(round+1),60000,async()=>{
  await Promise.all([submitUI(a,0),submitUI(b,0),submitProtocol(c,0)]);
  await wait(()=>[a,c].every(g=>g.peers.every(p=>p.state.coopCommit.revision===round*2+1)));
  for(const g of [a,b,c])json(g.id+'-intermediate-'+round+'.json',obs.redact(await games.findOne({gameID:g.gameID}),secrets));
  // Arm both UI submissions, then send the extra co-op's final request while
  // the UI input promises are in flight. No artificial service delay.
  await Promise.all([submitUI(a,1),submitUI(b,1),submitProtocol(c,1)]);
  await wait(()=>[a,b,c].every(g=>g.peers.every(p=>p.state.gameRound===round+1)));
  for(const g of [a,b,c]){
   advanceExpected(g);for(const p of g.ui)await ready(p,g.round);
   await exact(g,'three-match/round-'+g.round);
   for(const [i,p]of g.peers.entries())check(g.id+'/protocol/'+g.round+'/'+i,g.expected,canonicalBoard(p.state));
   await persisted(g,g.round);
  }
  check('three-match/round-'+(round+1),true,true);
 });
 for(const g of [a,b])for(const p of g.ui)await p.screenshot('three-match-rounds');
 const lines=fs.readFileSync(path.join(logDir,'server.log'),'utf8').split('\n');
 const phaseRows=lines.filter(l=>l.startsWith('CONCURRENT_PHASE ')).map(l=>JSON.parse(l.slice(17)));json('phase-snapshots.json',phaseRows);
 json('database-awaits.json',lines.filter(l=>l.startsWith('G09_DB ')).map(l=>JSON.parse(l.slice(7))));
 const allAI=lines.filter(l=>l.startsWith('CONCURRENT_AI ')).map(l=>JSON.parse(l.slice(14)));json('ai-boundaries.json',allAI);
 for(const co of [a,c]){
  const aiRows=allAI.filter(r=>r.label===co.id);
  check(co.id+'/real-ai-invocations',[0,1].flatMap(round=>['start','end'].map(boundary=>({round,units:4,boundary}))),aiRows.map(({round,units,boundary})=>({round,units,boundary})));
  check(co.id+'/demon-phase',['wave','demon','complete','wave','demon','complete'],phaseRows.filter(r=>r.gameID===co.gameID).map(r=>r.stage));
  const attributed=events.filter(e=>e.id===co.id&&['gameStarted','playYourTurn','waitYouTurn'].includes(e.event));
  check(co.id+'/event-attribution',true,attributed.length>co.n&&attributed.every(e=>e.gameID===co.gameID&&e.slot>=1&&e.slot<=co.n&&e.board.players.length===4));
 }
 coverage.push({id:'three-match-interleaving',pass:true,proofs:['checkpoints.json','game-isolation.jsonl','database-awaits.json','ai-boundaries.json']});
 // Competitive deliveries retain their own roster/economy and contain no AI.
 check('competitive-event-isolation',true,events.filter(e=>e.id===b.id).every(e=>e.board.players.length===3&&e.board.external.length===0));
 check('browser-errors',[],errors);check('server-errors',[],fs.readFileSync(path.join(logDir,'server.log'),'utf8').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)));
 json('served-sources.json',Object.fromEntries(client.served));await browser.close();browser=null;await client.close();client=null;
 });
 check('cleanup',true,lifecycle.cleanup.processes.every(p=>!p.aliveAfter)&&lifecycle.cleanup.directories.every(d=>!d.existsAfter));
 }catch(e){if(e.cleanup)lifecycle={cleanup:e.cleanup};throw e;}
 finally{
  if(browser)await browser.close();if(client)await client.close();process.removeListener('SIGTERM',abort);t.signal.removeEventListener('abort',abort);
  json('cleanup.json',lifecycle?.cleanup||null);json('browser-errors.json',errors);json('intentional-reload-aborts.json',reloadAborts);json('progress-timings.json',timings);json('checkpoints.json',{passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checkpoints:checks});json('coverage-results.json',{cases:coverage,pass:coverage.length===1});
  if(logDir)for(const n of fs.readdirSync(logDir)){const f=path.join(logDir,n);if(fs.statSync(f).isFile())fs.writeFileSync(f,obs.redactText(fs.readFileSync(f,'utf8'),secrets));}
 }
});
