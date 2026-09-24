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
   assert(Number(process.env.TASK239_STOP_AT)-Date.now()>300000,'reserve service cleanup budget');
   const result=await withServices({evidenceDir:dir,bounds:{scenarioMs:240000}},async service=>{
    client=await startClientServer(undefined,{emptyFavicon:true});
    const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type:'spki',format:'der'})).digest('base64');
    browser=await chromium.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
    console.log('RUNTIME '+JSON.stringify({node:process.version,chromium:browser.version(),playwright:require('playwright/package.json').version,services:service.lifecycle.runtime}));
    const {currentCoopFixtureSpec,buildCurrentCoopBoardInVm}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
    const portals=Array.from({length:12},(_,i)=>({x:2+i%6,y:5+3*Math.floor(i/6),category:categories[i%6]})).concat(Array.from({length:8},(_,i)=>({x:1+i,y:10,category:i<4?'melee':'ranged'})));
    const spec={...currentCoopFixtureSpec({label:c.id,humans:2,size:'tiny',seed:1,portals,
     purpose:'TASK-239 six-category render fixture with scouts; authored 14x14 Tiny H2 map, not generated geometry',
     players:[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},{rgb:{r:255,g:0,b:0},gold:100,towns:[{x:2,y:3}],units:[{x:2,y:4,type:'noob'},{x:4,y:4,type:'noob'},{x:6,y:4,type:'noob'}]},{rgb:{r:0,g:0,b:255},gold:100,towns:[{x:8,y:3}]}]}),side:14};
    const board=buildCurrentCoopBoardInVm(spec);board.isFogOfWar=c.fog;
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
     if(i===0) for(const zoom of ['initial','reduced']) {
      if(zoom==='reduced') {
       p.trace({action:'wheel',deltaY:180,label:'reduce map zoom'});
       await p.page.mouse.move(640,300);await p.page.mouse.wheel(0,180);
       await p.page.waitForTimeout(250);
      }
      for(const category of categories) {
       const coord=portals.find(v=>v.category===category);
       // Keyboard camera motion and mouse selection; page evaluation observes only.
       let point=await p.cellPoint(coord);
       if(point.y>430){await p.pan(0,point.y-380,await p.observe(()=>({...canvas.offset})));point=await p.cellPoint(coord);}
       await p.tap(point,'select '+category,`gameEvent.selected.category === '${category}' && entityInterface.visible`);
       const frame=await p.observe(()=>lastGameFrameTime);await p.page.waitForFunction(v=>lastGameFrameTime>v,frame);
       const observed=await p.observe(()=>{
        const e=gameEvent.selected, a=assets[e.imageName],cache=cachedImages[e.imageName];
        const x=(e.pos.x-canvas.offset.x)*canvas.scale,y=(e.pos.y-canvas.offset.y)*canvas.scale;
        const bounds={x,y,width:cache.width*canvas.scale,height:cache.height*canvas.scale};
        const info=entityInterface.entity.info;
        return {category:e.category,image:e.imageName,src:new URL(a.src).pathname,loaded:a.complete&&a.naturalWidth===512,
         label:info.text.split('\n').find(l=>l.startsWith('category: ')),text:info.text,portrait:entityInterface.img.image,
         scale:canvas.scale,supported:canvas.scale>=mapBorder.scale.min&&canvas.scale<=mapBorder.scale.max,
         bounds,viewport:{width:WIDTH,height:HEIGHT},panel:{x:entityInterface.pos.x,y:entityInterface.pos.y,width:entityInterface.width,height:entityInterface.height},
         textBounds:{left:info.left,right:info.right,top:info.y,bottom:info.y+info.height*info.text.split('\n').length},
         visible:entityInterface.visible,alias:assets.bombard===assets.catapult&&cachedImages.bombard===cachedImages.catapult};
       });
       const image='demonPortal'+category[0].toUpperCase()+category.slice(1);
       const id=c.id+'/'+zoom+'/'+category;
       check(id+'/identity',{category:observed.category,image:observed.image,src:observed.src,label:observed.label,portrait:observed.portrait,loaded:observed.loaded},
        {category,image,src:'/assets/sprites/'+image+'.svg',label:'category: '+category,portrait:image,loaded:true});
       const b=observed.bounds,t=observed.textBounds,panel=observed.panel;
       check(id+'/bounds',observed.supported&&b.x>=0&&b.y>=0&&b.x+b.width<=observed.viewport.width&&b.y+b.height<=panel.y&&
        panel.x+panel.width<=observed.viewport.width&&panel.y+panel.height<=observed.viewport.height&&t.left>=panel.x&&t.right<=panel.x+panel.width&&t.top>=panel.y&&t.bottom<=panel.y+panel.height,true);
       if(category==='siege')check(id+'/bombard',observed.text.includes('train: bombard')&&observed.alias,true);
       const shot=await p.screenshot(zoom+'-'+category);
       rows.push({id,category,zoom,observed,screenshot:c.id+'/screenshots/'+shot.file});
       write('render-checkpoints.json',{rows});
      }
     }
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
