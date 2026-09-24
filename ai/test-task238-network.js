'use strict';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {withServices}=require('../../diplomacy_server/tests/reliability/helpers/services');
const {BrowserPlayer,startClientServer}=require('../../diplomacy_server/tests/reliability/helpers/browser-driver');
const {reconnect}=require('../../diplomacy_server/tests/reliability/helpers/movement-identity-reconnect');
const {buildCurrentCoopBoardInVm}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
const {spec,expected}=require('./test-task238-fixtures');
const out=process.argv[2],checks=[],rows=[];
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const check=(id,observed,expected)=>{checks.push({id,observed,expected,pass:require('node:util').isDeepStrictEqual(observed,expected)});write('network-checkpoints.json',{checks});assert.deepEqual(observed,expected,id);console.log('PASS '+id);};
async function wait(label,probe){const end=Math.min(Date.now()+60000,Number(process.env.TASK238_STOP_AT));while(Date.now()<end){const r=await probe();if(r)return r;await new Promise(r=>setTimeout(r,40));}throw Error('timeout '+label);}
const project=b=>({round:b.gameRound,marker:b.gameSettings.coop.typedWaves,units:b.players[3].units.map(u=>({type:u.name,hp:u.hp,owner:b.grid[u.coord.x][u.coord.y]})).sort((a,b)=>a.type.localeCompare(b.type))});
async function main(){
 const secrets=[],errors=[];let browser,client,cleanup;const handles=[];
 try{
 assert(Number(process.env.TASK238_STOP_AT)-Date.now()>360000,'reserve cleanup');
 const result=await withServices({evidenceDir:out,bounds:{scenarioMs:300000},pollingOnly:true},async service=>{
 console.log('RUNTIME '+JSON.stringify(service.lifecycle.runtime));
 const games=service.mongo.db(service.databaseName).collection('games');
 for(const r of [4,28]){
 const id='network/H2/r'+r,fog=r===28,joinMode=fog?'simultaneous':'sequential',s=spec(2),board=buildCurrentCoopBoardInVm(s);
 board.gameRound=r-1;board.gameSettings.coop.typedWaves={lastRound:r-1};board.isFogOfWar=fog;
 write('fixture-r'+r+'.json',{s,board,joinMode,fog,purpose:'declared pre-wave initial state, not natural progression'});
 const peers=Array.from({length:2},()=>({password:String(crypto.randomInt(100000000,999999999)),board:null,active:false}));secrets.push(...peers.map(p=>p.password));
 const attach=async(p,label)=>{
 if(p.handle)await p.handle.close();p.board=null;p.error=null;
 p.handle=await service.connectSocket({transports:['polling']});handles.push(p.handle);
 p.handle.client.onAny((event,body)=>{
 if(event==='error')p.error=body;
 if(['gameStarted','playYourTurn','waitYouTurn'].includes(event)){const b=JSON.parse(body);if(b.grid){p.board=b;p.active=event!=='waitYouTurn';fs.appendFileSync(path.join(out,'protocol.jsonl'),JSON.stringify({id,label,event,board:b})+'\n');}}
 });
 p.handle.client.emit('startGameOrConnect',JSON.stringify({password:p.password,game:board}));
 await wait(label,()=>{if(p.error)throw Error(p.error);return p.board;});
 };
 if(fog){const results=await Promise.allSettled(peers.map(p=>attach(p,'join')));for(const result of results)if(result.status==='rejected')throw result.reason;}else for(const p of peers)await attach(p,'join');
 check(id+'/participants',peers.map(p=>p.board.whooseTurn).sort(),[1,2]);
 const gameID=peers[0].board.coopCommit.gameID,before=await games.findOne({gameID});write('saved-before-r'+r+'.json',before);
 const wantBefore={round:r-1,marker:{lastRound:r-1},units:[]};
 for(const p of peers){await attach(p,'reload-before');check(id+'/reload-before/'+p.board.whooseTurn,project(p.board),wantBefore);}
 const ps=[];
 if(r===4){
 client=await startClientServer(undefined,{emptyFavicon:true});
 const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type:'spki',format:'der'})).digest('base64');
 browser=await require('playwright').chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});console.log('BROWSER=chromium '+browser.version());
 fs.mkdirSync(path.join(out,'screenshots'));
 for(let i=0;i<2;i++){
 const p=await BrowserPlayer.open(browser,{name:'p'+i,input:'mouse',endpoint:service.endpoint,clientUrl:client.url,errors,screenshotDir:path.join(out,'screenshots'),events:{write:s=>fs.appendFileSync(path.join(out,'browser-events.jsonl'),s)},inputs:{write:s=>{const a=JSON.parse(s);delete a.until;if(/password/.test(a.label||'')){delete a.x;delete a.y;}fs.appendFileSync(path.join(out,'browser-inputs.jsonl'),JSON.stringify(a)+'\n');}}});ps.push(p);
 await reconnect(p,{password:peers[i].password,coop:true,fog:false});await p.page.waitForFunction(()=>onlineSocket.connected&&!menu.visible&&gameRound===3,null,{timeout:60000});
 }
 for(const p of peers)await p.handle.close();
 check('browser/contexts',new Set(ps.map(p=>p.page.context())).size,2);
 for(const p of ps){
 await p.page.waitForFunction(()=>!gameEvent.waitingMode&&!nextTurnButton.unactive,null,{timeout:60000});
 if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:640,y:450},'dismiss overlay','!nextTurnPauseInterface.visible');
 await p.page.waitForFunction(()=>nextTurnButton.canClick&&!nextTurnButton.unactive,null,{timeout:10000});
 await p.tapControl('nextTurnButton','commit human wave turn','gameEvent.waitingMode || gameRound===4');
 }
 }else{
 const submitted=new Set();while(submitted.size<2){const p=await wait('active',()=>{for(const p of peers)if(p.error)throw Error(p.error);return peers.find(p=>p.active&&!submitted.has(p));});submitted.add(p);const revision=p.board.coopCommit.revision,game=structuredClone(p.board);delete game.coopCommit;p.active=false;p.handle.client.emit('nextTurn',JSON.stringify({password:p.password,game}));await wait('commit',()=>peers.every(p=>p.board.coopCommit.revision>revision));}
 }
 const after=await wait('persisted wave',async()=>{const g=await games.findOne({gameID});return g.rounds.at(-1)[0].parallelTurnResult.gameRound===r&&g;});
 write('saved-after-r'+r+'.json',after);
 const committed=after.rounds.at(-1)[0].parallelTurnResult;
 const want={round:r,marker:{lastRound:r},units:expected(s,r).map(u=>({type:u.type,hp:u.hp,owner:3})).sort((a,b)=>a.type.localeCompare(b.type))};
 check(id+'/persisted-wave',project(committed),want);check(id+'/commit-count',after.coopRevision,2);
 if(r===4){for(const p of ps){await p.page.waitForFunction(()=>gameRound===4,null,{timeout:60000});check('browser/'+p.name+'/wave',project(await p.observe(()=>JSON.parse(JSON.stringify(getGameObject())))),want);if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:640,y:450},'show wave','!nextTurnPauseInterface.visible');await p.cellPoint(committed.players[3].units[0].coord);await p.screenshot('round4-wave');}
 write('served-sources.json',Object.fromEntries(client.served));await browser.close();browser=null;await client.close();client=null;}
 const reloads=[];
 for(const p of peers){await attach(p,'reload-after');const observed=project(p.board);check(id+'/reload-after/'+p.board.whooseTurn,observed,want);reloads.push({commit:p.board.coopCommit,observed});}
 const reloaded=await games.findOne({gameID});check(id+'/reload-no-duplicate',{revision:reloaded.coopRevision,rounds:reloaded.rounds.length,board:project(reloaded.rounds.at(-1)[0].parallelTurnResult)},{revision:2,rounds:2,board:want});
 rows.push({id,expected:{attempts:want.units.length,spawns:want,skipReasons:[],revision:2},observed:{attempts:committed.players[3].units.length,spawns:project(committed),skipReasons:[],revision:after.coopRevision},reloads,before:'saved-before-r'+r+'.json',after:'saved-after-r'+r+'.json',fog,joinMode});write('network-roundtrips.json',{rows});
 for(const p of peers)await p.handle.close();
 }
 check('browser/errors',errors,[]);
 const lines=fs.readFileSync(path.join(service.logDir,'server.log'),'utf8').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l));check('network/server-errors',lines,[]);
 });cleanup=result.cleanup;
 }catch(e){cleanup=e.cleanup;throw e;}finally{
 for(const h of handles)await h.close();if(browser)await browser.close();if(client)await client.close();write('network-cleanup.json',{cleanup,browserClosed:true,clientClosed:true});write('browser-errors.json',errors);
 for(const f of fs.readdirSync(out,{recursive:true})){const p=path.join(out,f);if(fs.statSync(p).isFile()&&!f.endsWith('.png')){let t=fs.readFileSync(p,'utf8');for(const secret of secrets)t=t.split(secret).join('[redacted]');fs.writeFileSync(p,t);}}
 }
 check('network/cleanup',cleanup.processes.every(p=>!p.aliveAfter)&&cleanup.directories.every(d=>!d.existsAfter),true);
 write('network-roundtrips.json',{rows,pass:true});console.log('PASS network waves=4,28 browser-wave=4 reload-no-duplicate cleanup=true');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
