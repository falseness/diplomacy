'use strict';
// Browser screenshots of the entity panel stats (TASK-401/402): real mouse clicks on
// a demon ember archer, a demon imp, an own unit, a demon portal and its stats button.
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const outputIndex=process.argv.indexOf('--output-dir');
if(outputIndex<0||!process.argv[outputIndex+1]){console.error('usage: test-unit-panel-stats-browser.js --output-dir <dir>');process.exit(2);}
const out=path.resolve(root,process.argv[outputIndex+1]);
const lines=(text,key)=>text.split('\n').filter(l=>l.startsWith(key+': '));

(async()=>{
  fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{
      res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':
        file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
      res.end(error?'Not found':data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,failed=0;
  const errors=[],checkpoints=[];
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    console.log('browser_engine=chromium browser_version='+browser.version());
    const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    // Offline fixture: no networking, downloads or learned AI.
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':
        route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof menu!=='undefined'&&menu.visible&&imagesCountLoaded===images.length);
    const fixture=await page.evaluate(()=>{
      gameSlot=0;
      GameManager.start(generateCoopGame(2,{seed:1,size:'tiny'}),false,false);
      isFogOfWar=false;gameSettings.isOnline=false;
      whooseTurn=1;actionManager.clear();
      nextTurnPauseInterface.hideButDontUpdateTimer();
      timer.pauseAndSaveTime();
      const slot=gameSettings.coop.demonSlot;
      const portal=external.find(e=>e.isDemonPortal&&e.category==='ranged');
      // Free cells next to the portal: two for demons, one repainted for a fresh own unit.
      const free=[];
      for(let dx=-3;dx<=3;dx++) for(let dy=-3;dy<=3;dy++){
        const c={x:portal.coord.x+dx,y:portal.coord.y+dy};
        if((dx||dy)&&!isCoordNotOnMap(c,grid.arr.length,grid.arr[0].length)&&grid.getBuilding(c).isEmpty()&&grid.getUnit(c).isEmpty())
          free.push(c);
      }
      free.sort((a,b)=>Math.hypot(a.x-portal.coord.x,a.y-portal.coord.y)-Math.hypot(b.x-portal.coord.x,b.y-portal.coord.y));
      const [ca,ci,co]=free;
      grid.getHexagon(ca).repaint(slot,false);grid.getHexagon(ci).repaint(slot,false);grid.getHexagon(co).repaint(1,false);
      window.panelTargets={emberArcher:new EmberArcher(ca.x,ca.y),imp:new Imp(ci.x,ci.y),own:new Noob(co.x,co.y),portal};
      gameEvent.screen.moveTo({x:portal.pos.x+assets.size/2,y:portal.pos.y+assets.size/2+130});
      gameEvent.removeSelection();
      drawAll();
      const next=panelTargets.portal.nextProduction;
      return {demonSlot:slot,portal:portal.coord,cells:{emberArcher:ca,imp:ci,own:co},ownOwner:panelTargets.own.playerColor,
        next:next&&{type:next.type,cfg:DEMON_TYPES[next.type]}};
    });
    console.log('fixture='+JSON.stringify(fixture));
    const next=fixture.next;
    const expectations={
      'ember-archer':{target:'emberArcher',title:'ember archer',speed:'2',range:'3',moves:null},
      'imp':{target:'imp',title:'imp',speed:'2',range:null,moves:null},
      'portal':{target:'portal',title:'demon portal',category:'ranged'},
      'portal-stats':{button:'stats',title:next&&next.cfg.name,speed:next&&String(next.cfg.movement),
        range:!next||!next.cfg.ranged?null:next.cfg.buildingDamage!==undefined?`2 - ${next.cfg.range}`:String(next.cfg.range),
        movement:null},
      // Last: a selected own unit would treat the next map click as a move order.
      'own-unit':{target:'own',title:'noob',moves:true,speed:null,range:null},
    };
    async function clickPoint(cp){
      return page.evaluate(cp=>{
        if(cp.button){
          const r=entityInterface.portalStatsButton.rect;
          return {x:(r.x+r.width/2)/window.devicePixelRatio,y:(r.y+r.height/2)/window.devicePixelRatio,
            canClick:entityInterface.portalStatsButton.canClick};
        }
        const e=panelTargets[cp.target];
        return {x:(e.pos.x+assets.size/2-canvas.offset.x)*canvas.scale,y:(e.pos.y+assets.size/2-canvas.offset.y)*canvas.scale};
      },cp);
    }
    for(const [label,exp] of Object.entries(expectations)){
      const point=await clickPoint(exp);
      await page.mouse.click(point.x,point.y);
      await page.evaluate(()=>drawAll());
      const observed=await page.evaluate(()=>({visible:entityInterface.visible,title:entityInterface.entity.name.text,
        text:entityInterface.entity.info.text,portalDescription:entityInterface.portalDescription,
        selected:gameEvent.selected&&gameEvent.selected.name}));
      const problems=[];
      if(!observed.visible)problems.push('panel hidden');
      if(observed.title!==exp.title)problems.push(`title ${JSON.stringify(observed.title)}!=${JSON.stringify(exp.title)}`);
      for(const key of ['speed','range','moves','movement','category']){
        if(!(key in exp))continue;
        const found=lines(observed.text,key),want=exp[key];
        if(want===null){if(found.length)problems.push('unexpected '+found.join('|'));}
        else if(want===true){if(found.length!==1)problems.push('missing '+key+':');}
        else if(found.length!==1||found[0]!==`${key}: ${want}`)problems.push(`want "${key}: ${want}" got ${JSON.stringify(found)}`);
      }
      if(exp.button&&observed.portalDescription!==true)problems.push('stats view not open');
      const screenshot=path.join(out,'screenshots',label+'.png');
      const bytes=await page.screenshot({path:screenshot});
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      const expected=Object.fromEntries(Object.entries(exp).filter(([k])=>k!=='target'&&k!=='button'));
      checkpoints.push({checkpoint:label,input:{type:'mouse.click',...point},text:observed.text,title:observed.title,
        expected,screenshot:path.relative(out,screenshot),sha256,bytes:bytes.length,pass:!problems.length,problems});
      if(problems.length){failed++;console.log(`FAIL ${label} ${problems.join('; ')} text=${JSON.stringify(observed.text)}`);}
      else console.log(`PASS ${label} text=${JSON.stringify(observed.text)} screenshot=${screenshot} sha256=${sha256}`);
    }
    if(errors.length){failed++;console.log('FAIL page-errors '+JSON.stringify(errors));}
    fs.writeFileSync(path.join(out,'browser-panel.json'),JSON.stringify({engine:'chromium',version:browser.version(),
      fixture,pageErrors:errors,pass:!failed,checkpoints},null,2)+'\n');
  }finally{
    console.log('page_errors='+errors.length+' '+JSON.stringify(errors));
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
  console.log(failed?`FAIL ${failed} checkpoint(s)`:`ALL PASS ${checkpoints.length} checkpoints`);
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
