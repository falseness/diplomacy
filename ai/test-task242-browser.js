'use strict';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const helpers='../../diplomacy_server/tests/reliability/helpers/';
const {withServices}=require(helpers+'services');
const {BrowserPlayer,startClientServer}=require(helpers+'browser-driver');
const {reconnect}=require(helpers+'movement-identity-reconnect');
const cases=[{id:'browser-clear',fog:false,join:'sequential',round:0},{id:'browser-fog-before',fog:true,join:'simultaneous',round:0},{id:'browser-fog-upgraded',fog:true,join:'sequential',round:4}];
module.exports={cases};
const categories=['melee','ranged','siege','heavy','support','chaos'];
const {exercise}=require('./test-task242-interactions');
const project=b=>({side:[b.grid.length,b.grid[0].length],fog:b.isFogOfWar,initialHumans:b.gameSettings.coop.initialHumanCount,
 portals:b.external.filter(e=>e.name==='demonPortal').map(e=>({x:e.coord.x,y:e.coord.y,category:e.category})).sort((a,b)=>a.x-b.x||a.y-b.y)});
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
async function main(){
 const selected=process.argv[3];
 const selectedCases=selected?cases.filter(c=>c.id===selected):cases;
 assert(selectedCases.length>0,'unknown browser case');
 const out=process.argv[2],write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n'),checks=[],rows=[];
 const check=(id,observed,expected)=>{const pass=JSON.stringify(observed)===JSON.stringify(expected);checks.push({id,observed,expected,pass});write('browser-checkpoints.json',{checkpoints:checks});assert.deepEqual(observed,expected,id);console.log('PASS '+id+' '+JSON.stringify({observed,expected}));};
 for(const c of selectedCases){
  const dir=path.join(out,c.id);fs.mkdirSync(path.join(dir,'screenshots'),{recursive:true});
  const errors=[],secrets=Array.from({length:2},()=>String(crypto.randomInt(100000000,999999999)));
  let browser,client;const sockets=[];let cleanup;
  let cancel;
  const cancelled=new Promise((_,reject)=>{cancel=()=>reject(new Error('supervisor cancelled browser journey'));});
  cancelled.catch(()=>{});
  if(process.env.TASK245_OWNERSHIP)process.once('SIGTERM',cancel);
  try{
   assert(Number(process.env.TASK242_STOP_AT)-Date.now()>300000,'reserve service cleanup budget');
   const result=await withServices({evidenceDir:dir,bounds:{scenarioMs:240000}},async service=>Promise.race([cancelled,(async()=>{
    client=await startClientServer(undefined,{emptyFavicon:true});
    const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type:'spki',format:'der'})).digest('base64');
    browser=await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
    console.log('RUNTIME '+JSON.stringify({node:process.version,chromium:browser.version(),playwright:require('playwright/package.json').version,services:service.lifecycle.runtime}));
    const {currentCoopFixtureSpec,buildCurrentCoopBoardInVm}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
    const portals=Array.from({length:12},(_,i)=>({x:2+i%6,y:5+3*Math.floor(i/6),category:categories[i%6]})).concat(Array.from({length:8},(_,i)=>({x:1+i,y:10,category:i<4?'melee':'ranged'})));
    // Current v4 admission uses valleyRowPlans: Tiny/H2 is 14, not the
    // older scaling helper's 11. This is the smallest supported network map.
    const spec={...currentCoopFixtureSpec({label:c.id,humans:2,size:'tiny',seed:1,portals,
     purpose:'TASK-242 authored initial inspection fixture, Tiny/H2/seed1', terrain:{goldmines:[{x:4,y:11,income:50},{x:5,y:11,income:50}]}, demons:[{x:3,y:9,type:'bulwark'},{x:5,y:11,type:'bulwark'},{x:6,y:11,type:'bulwark'}],
     players:[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},{rgb:{r:255,g:0,b:0},gold:100,towns:[{x:2,y:3}],units:[{x:1,y:4,type:'noob'},{x:2,y:4,type:'noob'},{x:4,y:4,type:'noob'},{x:6,y:4,type:'noob'}]},{rgb:{r:0,g:0,b:255},gold:100,towns:[{x:8,y:3}]}]}),side:14};
    // Node-only authoring UI stub; the real browser still loads shipped UI.
    global.townInterface ??= {change() {}, hide() {}};
    const board=buildCurrentCoopBoardInVm(spec);board.isFogOfWar=c.fog;
    // Author occupied portal in the serialized initial fixture before admission.
    board.players[board.gameSettings.coop.demonSlot].units.find(u=>u.coord.x===3&&u.coord.y===9).coord.y=8;
    board.gameRound=c.round;
    const setup={spec,board};
    write(c.id+'/declared-fixture.json',{purpose:'Authored Tiny/H2/seed1 six-category board; NOT generated geometry; initial occupants and landmarks declared in this fixture',...setup});
    const want={side:[14,14],fog:c.fog,initialHumans:2,portals:portals.map(p=>({x:p.x,y:p.y,category:p.category})).sort((a,b)=>a.x-b.x||a.y-b.y)};
    check(c.id+'/fixture-counts',categories.map(k=>want.portals.filter(p=>p.category===k).length),[6,6,2,2,2,2]);
    const joined=[];
    const join=async i=>{const s=await service.connectSocket();sockets.push(s);const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('join timeout')),30000);for(const e of ['gameStarted','playYourTurn','waitYouTurn'])s.client.once(e,b=>{clearTimeout(timer);resolve(JSON.parse(b));});s.client.once('error',e=>{clearTimeout(timer);reject(Error(String(e)));});});s.client.emit('startGameOrConnect',JSON.stringify({password:secrets[i],game:setup.board}));joined[i]=await response;};
    if(c.join==='sequential'){await join(0);await join(1);}else{const rs=await Promise.allSettled([join(0),join(1)]);for(const r of rs)if(r.status==='rejected')throw r.reason;}
    check(c.id+'/network-participants',joined.map(b=>b.whooseTurn).sort(),[1,2]);
    for(const [i,b] of joined.entries())check(c.id+'/network-board-'+i,project(b),want);
    const stored=await service.mongo.db(service.databaseName).collection('games').findOne({gameID:joined[0].coopCommit.gameID});
    write(c.id+'/persisted.json',stored);
    const ps=[];
    const events={write:s=>fs.appendFileSync(path.join(dir,'network-trace.jsonl'),s)};
    const inputs={write:s=>{const r=JSON.parse(s);delete r.until;fs.appendFileSync(path.join(dir,'input-trace.jsonl'),JSON.stringify(r)+'\n');}};
    for(let i=0;i<2;i++){
     const p=await BrowserPlayer.open(browser,{name:'p'+i,input:'mouse',endpoint:service.endpoint,clientUrl:client.url,errors,events,inputs,screenshotDir:path.join(dir,'screenshots')});ps.push(p);
     // Simultaneous admission need not preserve request order. Drive the
     // authored player-1 scout with the credential actually assigned slot 1.
     const credentialIndex=joined.findIndex(board=>board.whooseTurn===i+1);
     assert(credentialIndex>=0,'assigned browser slot');
     await reconnect(p,{password:secrets[credentialIndex],coop:true,fog:c.fog});
     await p.page.waitForFunction(()=>onlineSocket.connected&&!menu.visible&&whooseTurn>0,null,{timeout:60000});
     assert.equal(await p.observe(()=>whooseTurn),i+1,'reconnected assigned slot');
     console.log(`PASS ${c.id}/browser-slot-${i} expected=${i+1} observed=${i+1} credentialIndex=${credentialIndex}`);
     if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:640,y:450},'dismiss overlay','!nextTurnPauseInterface.visible');
     const actual=await p.observe(()=>({grid:grid.arr.map(col=>col.map(cell=>cell.hexagon.playerColor)),isFogOfWar,gameSettings:{coop:gameSettings.coop},external:external.map(e=>({name:e.name,coord:{...e.coord},category:e.category}))}));
     check(c.id+'/browser-board-'+i,project(actual),want);
     const render=await p.observe(()=>external.filter(e=>e.name==='demonPortal').map(e=>({category:e.category,image:e.imageName,loaded:!!assets[e.imageName]?.complete&&assets[e.imageName].naturalWidth>0,cached:!!cachedImages[e.imageName]})));
     check(c.id+'/render-assets-'+i,render.map(e=>e.loaded&&e.cached),Array(20).fill(true));
     if(i===0) rows.push(...await exercise(p,c,out,check));
    }
    check(c.id+'/browser-contexts',new Set(ps.map(p=>p.page.context())).size,2);
    // Inspect persisted initial boards recursively without assuming turn grouping.
    const boards=[];const visit=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v.grid)&&v.gameSettings?.coop&&Array.isArray(v.external))boards.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')visit(x);};visit(stored);
    assert(boards.length>0,'persisted board present');for(const [i,b]of boards.entries())check(c.id+'/persisted-board-'+i,project(b),want);
    check(c.id+'/browser-errors',errors,[]);
    check(c.id+'/server-errors',fs.readFileSync(path.join(service.logDir,'server.log'),'utf8').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)),[]);
    write(c.id+'/served-sources.json',Object.fromEntries(client.served));
    for(const s of sockets)await s.close();await browser.close();browser=null;await client.close();client=null;
   })()]));
   cleanup=result.cleanup;
  }catch(e){cleanup=e.cleanup;throw e;}
  finally{
   process.removeListener('SIGTERM',cancel);
   for(const s of sockets)await s.close();if(browser)await browser.close();if(client)await client.close();
   write(c.id+'/browser-errors.json',errors);write(c.id+'/cleanup.json',{browserClosed:true,clientClosed:true,cleanup});
   // Service logs may contain authentication tokens. Retain full logs with only
   // this run's credentials replaced; packet traces already summarize secrets.
   for(const file of fs.readdirSync(dir,{recursive:true})){const full=path.join(dir,file);if(fs.statSync(full).isFile()&&!file.endsWith('.png')){let s=fs.readFileSync(full,'utf8');for(const secret of secrets)s=s.split(secret).join('[redacted]');fs.writeFileSync(full,s);}}
  }
  assert(cleanup.processes.every(p=>!p.aliveAfter)&&cleanup.directories.every(d=>!d.existsAfter));
  check(c.id+'/cleanup',true,true);
 }
 write('selection-observations.json',{rows,pass:true});write('browser-results.json',{cases:selectedCases.map(c=>c.id),rows,pass:true});console.log(`PASS browser-network journeys=${selectedCases.length} contexts=${2*selectedCases.length} persistence=pass cleanup=pass`);
}
