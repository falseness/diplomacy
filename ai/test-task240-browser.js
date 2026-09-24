'use strict';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const helpers='../../diplomacy_server/tests/reliability/helpers/';
const {withServices}=require(helpers+'services');
const {BrowserPlayer,startClientServer}=require(helpers+'browser-driver');
const {reconnect}=require(helpers+'movement-identity-reconnect');
const cases=[{id:'browser-sequential-fog-false',fog:false,join:'sequential'},{id:'browser-simultaneous-fog-true',fog:true,join:'simultaneous'}];
module.exports={cases};
const categories=['melee','ranged','siege','heavy','support','chaos'];
const project=b=>({side:[b.grid.length,b.grid[0].length],fog:b.isFogOfWar,initialHumans:b.gameSettings.coop.initialHumanCount,
 portals:b.external.filter(e=>e.name==='demonPortal').map(e=>({x:e.coord.x,y:e.coord.y,category:e.category})).sort((a,b)=>a.x-b.x||a.y-b.y)});
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
async function main(){
 const out=process.argv[2],write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n'),checks=[],rows=[];
 const check=(id,observed,expected)=>{const pass=JSON.stringify(observed)===JSON.stringify(expected);checks.push({id,observed,expected,pass});write('browser-checkpoints.json',{checkpoints:checks});assert.deepEqual(observed,expected,id);console.log('PASS '+id+' '+JSON.stringify({observed,expected}));};
 for(const c of cases){
  const dir=path.join(out,c.id);fs.mkdirSync(path.join(dir,'screenshots'),{recursive:true});
  const errors=[],secrets=Array.from({length:2},()=>String(crypto.randomInt(100000000,999999999)));
  let browser,client;const sockets=[];let cleanup;
  try{
   assert(Number(process.env.TASK240_STOP_AT)-Date.now()>300000,'reserve service cleanup budget');
   const result=await withServices({evidenceDir:dir,bounds:{scenarioMs:240000}},async service=>{
    client=await startClientServer(undefined,{emptyFavicon:true});
    const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type:'spki',format:'der'})).digest('base64');
    browser=await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
    console.log('RUNTIME '+JSON.stringify({node:process.version,chromium:browser.version(),playwright:require('playwright/package.json').version,services:service.lifecycle.runtime}));
    const {currentCoopFixtureSpec,buildCurrentCoopBoardInVm}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
    const portals=Array.from({length:12},(_,i)=>({x:2+i%6,y:5+3*Math.floor(i/6),category:categories[i%6]})).concat(Array.from({length:8},(_,i)=>({x:1+i,y:10,category:i<4?'melee':'ranged'})));
    const spec={...currentCoopFixtureSpec({label:c.id,humans:2,size:'tiny',seed:1,portals,
     purpose:'TASK-240 six-category render fixture with scouts; authored 14x14 Tiny H2 map, not generated geometry',
     players:[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},{rgb:{r:255,g:0,b:0},gold:100,towns:[{x:2,y:3}],units:[{x:2,y:4,type:'noob'},{x:4,y:4,type:'noob'},{x:6,y:4,type:'noob'}]},{rgb:{r:0,g:0,b:255},gold:100,towns:[{x:8,y:3}]}]}),side:14};
    const board=buildCurrentCoopBoardInVm(spec);board.isFogOfWar=c.fog;
    if(c.fog)board.gameRound=3;
    const setup={spec,board};
    write(c.id+'/declared-fixture.json',{purpose:'Authored Tiny/H2/seed1 six-category board; NOT generated geometry; no runtime board mutation',...setup});
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
     await reconnect(p,{password:secrets[i],coop:true,fog:c.fog});
     await p.page.waitForFunction(()=>onlineSocket.connected&&!menu.visible&&whooseTurn>0,null,{timeout:60000});
     if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:640,y:450},'dismiss overlay','!nextTurnPauseInterface.visible');
     const actual=await p.observe(()=>({grid:grid.arr.map(col=>col.map(cell=>cell.hexagon.playerColor)),isFogOfWar,gameSettings:{coop:gameSettings.coop},external:external.map(e=>({name:e.name,coord:{...e.coord},category:e.category}))}));
     check(c.id+'/browser-board-'+i,project(actual),want);
     const render=await p.observe(()=>external.filter(e=>e.name==='demonPortal').map(e=>({category:e.category,image:e.imageName,loaded:!!assets[e.imageName]?.complete&&assets[e.imageName].naturalWidth>0,cached:!!cachedImages[e.imageName]})));
     check(c.id+'/render-assets-'+i,render.map(e=>e.loaded&&e.cached),Array(20).fill(true));
     if(i===0) {
      for(const category of categories) {
       const coord=portals.find(v=>v.category===category);
       // Keyboard camera motion and mouse selection; page evaluation observes only.
       let point=await p.cellPoint(coord);
       if(point.y>430){await p.pan(0,point.y-380,await p.observe(()=>({...canvas.offset})));point=await p.cellPoint(coord);}
       await p.tap(point,'select '+category,`gameEvent.selected.category === '${category}' && entityInterface.visible`);
       const id=c.id+'/'+category;
       const snapshot=()=>p.observe(()=>({counts:players.map(v=>[v.units.length,v.towns.length]),external:external.length,
        gold:players.map(v=>v.gold),undo:JSON.stringify(actionManager.arr),commands:JSON.stringify(humanCommands)}));
       const before=await snapshot();
       await p.tapControl('entityInterface.portalStatsButton','stats '+category,'entityInterface.portalDescription');
       const frame=await p.observe(()=>lastGameFrameTime);
       await p.page.waitForFunction(v=>lastGameFrameTime>v+200,frame);
       const observed=await p.observe(()=>({name:entityInterface.entity.name.text,text:entityInterface.entity.info.text,
        type:gameEvent.selected.nextProduction.type,description:entityInterface.portalDescription,
        stats:entityInterface.portalStatsButton.canClick,back:entityInterface.portalBackButton.canClick}));
       const expected={melee:['imp',2,1,2,1],ranged:['spitter',2,1,2,1],siege:['bombard',4,0,2,2],
        heavy:['bulwark',7,1,2,1],support:['ravager',4,1,3,1],chaos:['demonLord',5,3,2,1]}[category];
       const [type,hp,dmg,movement,range]=expected;
       const text=`hp: ${hp}\ndmg: ${dmg}\nmovement: ${movement}\nrange: ${range}`+
        (category==='siege'?'\nbuilding dmg: 4\ntarget: enemy buildings only':'');
       check(id+'/stats',observed,{name:type==='demonLord'?'demon lord':type,text,type,description:true,stats:false,back:true});
       const shot=await p.screenshot('stats-'+category);
       rows.push({id,category,observed,screenshot:c.id+'/screenshots/'+shot.file});
       await p.tapControl('entityInterface.portalBackButton','back '+category,'!entityInterface.portalDescription');
       check(id+'/back',await p.observe(()=>({selected:gameEvent.selected.category,name:entityInterface.entity.name.text,stats:entityInterface.portalStatsButton.canClick})),
        {selected:category,name:'demon portal',stats:true});
       await p.tapControl('entityInterface.portalStatsButton','stats before reselection','entityInterface.portalDescription');
       await p.tap(await p.cellPoint(portals.find(v=>v.category!==category)),'select other portal',`gameEvent.selected.category !== '${category}'`);
       await p.tap(await p.cellPoint(coord),'reselect portal',`gameEvent.selected.category === '${category}'`);
       check(id+'/reselection',await p.observe(()=>entityInterface.portalDescription),false);
       check(id+'/no-mutation',await snapshot(),before);
       write('ui-state.json',{rows});
      }
     }
    }
    if(c.fog){
     await ps[0].page.waitForFunction(()=>!nextTurnButton.unactive&&!gameEvent.waitingMode);
     await ps[0].tapControl('nextTurnButton','commit before upgrade','gameEvent.waitingMode');
     await ps[1].page.waitForFunction(()=>whooseTurn===2&&!gameEvent.waitingMode,null,{timeout:60000});
     if(await ps[1].observe(()=>nextTurnPauseInterface.visible))await ps[1].tap({x:640,y:450},'dismiss second turn overlay','!nextTurnPauseInterface.visible');
     await ps[1].page.waitForFunction(()=>!nextTurnButton.unactive);
     await ps[1].tapControl('nextTurnButton','commit wave four','gameEvent.waitingMode || gameRound===4');
     const p=ps[0];await p.page.waitForFunction(()=>gameRound===4&&!gameEvent.waitingMode,null,{timeout:60000});
     if(await p.observe(()=>nextTurnPauseInterface.visible))await p.tap({x:640,y:450},'dismiss wave overlay','!nextTurnPauseInterface.visible');
     const coord=portals.find(v=>v.category==='melee');
     await p.tap(await p.cellPoint(coord),'select upgraded portal cell',"gameEvent.selected.coord?.x===2 && gameEvent.selected.coord?.y===5");
     // Normal selection gives an occupying unit priority; a second click selects its building.
     if(await p.observe(()=>gameEvent.selected.isUnit))
      await p.tap(await p.cellPoint(coord),'cycle occupying unit to portal',"gameEvent.selected.category==='melee'");
     await p.tapControl('entityInterface.portalStatsButton','stats after committed wave','entityInterface.portalDescription');
     const observed=await p.observe(()=>({round:gameRound,committed:gameSettings.coop.typedWaves.lastRound,
      next:gameEvent.selected.nextProduction,name:entityInterface.entity.name.text,text:entityInterface.entity.info.text}));
     check(c.id+'/committed-upgrade',observed,{round:4,committed:4,next:{round:8,type:'clawling',roundsRemaining:4},
      name:'clawling',text:'hp: 1\ndmg: 2\nmovement: 2\nrange: 1'});
     const shot=await p.screenshot('committed-upgrade');rows.push({id:c.id+'/committed-upgrade',observed,screenshot:c.id+'/screenshots/'+shot.file});
     write('ui-state.json',{rows});
     const committed=await service.mongo.db(service.databaseName).collection('games').findOne({gameID:joined[0].coopCommit.gameID});
     write(c.id+'/committed-wave.json',committed);
     const markers=[];const scan=v=>{if(!v||typeof v!=='object')return;if(v.gameSettings?.coop?.typedWaves)markers.push(v.gameSettings.coop.typedWaves.lastRound);for(const x of Object.values(v))if(x&&typeof x==='object')scan(x);};scan(committed);
     check(c.id+'/persisted-wave',markers.includes(4),true);
    }
    check(c.id+'/browser-contexts',new Set(ps.map(p=>p.page.context())).size,2);
    // Inspect persisted initial boards recursively without assuming turn grouping.
    const boards=[];const visit=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v.grid)&&v.gameSettings?.coop&&Array.isArray(v.external))boards.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')visit(x);};visit(stored);
    assert(boards.length>0,'persisted board present');for(const [i,b]of boards.entries())check(c.id+'/persisted-board-'+i,project(b),want);
    check(c.id+'/browser-errors',errors,[]);
    check(c.id+'/server-errors',fs.readFileSync(path.join(service.logDir,'server.log'),'utf8').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)),[]);
    write(c.id+'/served-sources.json',Object.fromEntries(client.served));
    for(const s of sockets)await s.close();await browser.close();browser=null;await client.close();client=null;
   });
   cleanup=result.cleanup;
  }catch(e){cleanup=e.cleanup;throw e;}
  finally{
   for(const s of sockets)await s.close();if(browser)await browser.close();if(client)await client.close();
   write(c.id+'/browser-errors.json',errors);write(c.id+'/cleanup.json',{browserClosed:true,clientClosed:true,cleanup});
   // Service logs may contain authentication tokens. Retain full logs with only
   // this run's credentials replaced; packet traces already summarize secrets.
   for(const file of fs.readdirSync(dir,{recursive:true})){const full=path.join(dir,file);if(fs.statSync(full).isFile()&&!file.endsWith('.png')){let s=fs.readFileSync(full,'utf8');for(const secret of secrets)s=s.split(secret).join('[redacted]');fs.writeFileSync(full,s);}}
  }
  assert(cleanup.processes.every(p=>!p.aliveAfter)&&cleanup.directories.every(d=>!d.existsAfter));
  check(c.id+'/cleanup',true,true);
 }
 write('browser-results.json',{cases:cases.map(c=>c.id),rows,pass:true});console.log('PASS browser-network journeys=2 contexts=4 fog=off,on joins=sequential,simultaneous persistence=pass cleanup=pass');
}
