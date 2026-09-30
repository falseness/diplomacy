const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const http=require('http');
const crypto=require('crypto');
// Browser tests run with NODE_PATH/PLAYWRIGHT_BROWSERS_PATH; default both so the plain command works too.
if(process.env.PLAYWRIGHT_BROWSERS_PATH===undefined)process.env.PLAYWRIGHT_BROWSERS_PATH='0';
const {chromium}=(()=>{try{return require('playwright')}catch(error){return require('/opt/diplomacy/node_modules/playwright')}})();
const {audit,components}=require('./test-coop-terrain-audit');
const root=path.resolve(__dirname,'..'), arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
// Renders production co-op maps (Tiny/Normal/Big x humans 1/4/12, seed 0) next to the authored references.
// --fault stale-render is a negative control; --only narrows.
const fault=arg('--fault'), only=arg('--only')?.split(',');
const out=path.resolve(arg('--output-dir')??'artifacts/TASK-121');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const SIZES=['tiny','normal','big'], HUMANS=[1,4,12], SEEDS=[0];
const FAULTS={'stale-render':'runtime-counts'};
const VIEW={width:1100,height:1050};
if(fault!==undefined&&!FAULTS[fault]){console.error('FAIL unknown fault '+fault);process.exit(2)}
(async()=>{
  fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
  const deadline=setTimeout(()=>{console.error('FAIL preview watchdog');process.exit(1)},600000);deadline.unref();
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});res.end(error?'Not found':data)});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const errors=[],manifest=[];
  try {
    browser=await chromium.launch({headless:true});
    console.log('browser_engine=chromium version='+browser.version()+' node='+process.version+(fault?' fault='+fault:''));
    const page=await browser.newPage({viewport:VIEW,deviceScaleFactor:1});
    page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    // The shared host can be heavily loaded; asset loading alone has taken over 20 s.
    await page.waitForFunction(()=>typeof menu!=='undefined'&&imagesCountLoaded===images.length,null,{timeout:120000});
    const scenarios=[{reference:'open field'},{reference:'mountain wall'},
      ...SIZES.flatMap(size=>HUMANS.flatMap(count=>SEEDS.map(seed=>({size,seed,count}))))]
      .filter(c=>!only||only.includes(c.reference?'reference-'+c.reference.replaceAll(' ','-'):`${c.size}-humans-${c.count}-seed-${c.seed}`));
    for(const config of scenarios) {
      const label=config.reference?'reference-'+config.reference.replaceAll(' ','-'):`${config.size}-humans-${config.count}-seed-${config.seed}`;
      const t0=Date.now();
      const result=await page.evaluate(({config,fault})=>{
        const map=config.reference?maps[config.reference][0]:generateCoopGame(config.count,{size:config.size,seed:config.seed});
        const shown=fault==='stale-render'&&!config.reference?generateCoopGame(config.count,{size:config.size,seed:config.seed+1}):map;
        // Render the real runtime's full terrain cache into an overview canvas.
        // This changes only presentation: no custom substitute terrain renderer.
        gameSlot=0;isFogOfWar=false;shown.start(GameManager,false);whooseTurn=1;
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        grid.createSurfaceCache();
        const W=innerWidth,H=innerHeight,top=90;
        let preview=document.getElementById('terrain-preview');
        if(!preview){preview=document.createElement('canvas');preview.id='terrain-preview';document.body.append(preview)}
        preview.width=W;preview.height=H;preview.style.cssText=`position:fixed;left:0;top:0;z-index:9999;width:${W}px;height:${H}px`;
        const ctx=preview.getContext('2d');ctx.fillStyle='#182329';ctx.fillRect(0,0,W,H);
        ctx.fillStyle='white';ctx.font='25px sans-serif';
        ctx.fillText(config.reference?'Authored reference: '+config.reference:`Co-op ${config.size} | ${config.count} humans | seed ${config.seed} | ${map.portals.length} portals`,30,38);
        ctx.font='17px sans-serif';ctx.fillText(`Grid ${map.mapSize.x} × ${map.mapSize.y} | Mountains ${map.mountains.length} | Lakes ${map.lakes.length} | Bushes ${map.bushes.length}`,30,68);
        const cache=grid.surfaceCache,scale=Math.min((W-60)/cache.width,(H-top-20)/cache.height),w=cache.width*scale,h=cache.height*scale;
        ctx.drawImage(cache,(W-w)/2,top+(H-top-20-h)/2,w,h);
        const runtimeCounts={mountains:0,lakes:0,bushes:0};
        const names={mountain:'mountains',lake:'lakes',bush:'bushes'};
        const entities={mountains:[],lakes:[],bushes:[],goldmines:[],towns:[],portals:[],units:[],other:[]};
        for(let x=0;x<grid.arr.length;x++)for(let y=0;y<grid.arr[x].length;y++){
          const cell=grid.arr[x][y],b=cell.building,id=x+','+y;
          if(names[b.name]){runtimeCounts[names[b.name]]++;entities[names[b.name]].push(id)}
          else if(b.name==='goldmine')entities.goldmines.push(id);
          else if(b.isDemonPortal)entities.portals.push(id);
          else if(b.notEmpty()&&b.isTown())entities.towns.push(id+':'+cell.hexagon.playerColor);
          else if(b.notEmpty())entities.other.push(id+':'+b.name);
          if(cell.unit.notEmpty())entities.units.push(id+':'+cell.unit.name+':'+cell.unit.playerColor);
        }
        for(const k in entities)entities[k].sort();
        return {map:JSON.parse(JSON.stringify(map)),runtimeCounts,entities,
          cache:{width:cache.width,height:cache.height},rendered:{width:w,height:h,pixelsPerColumn:w/map.mapSize.x,pixelsPerRow:h/map.mapSize.y}};
      },{config,fault});
      const generationMs=Date.now()-t0;
      const expected=Object.fromEntries(['mountains','lakes','bushes'].map(k=>[k,result.map[k].length]));
      assert.deepEqual(result.runtimeCounts,expected,label+' runtime-counts');
      assert(result.rendered.width>500&&result.rendered.height>500,label+' visible-map');
      if(!config.reference) audit(result.map,label);
      else {
        assert(components(result.map[config.reference==='mountain wall'?'mountains':'lakes'])[0]>=3);
      }
      const file=path.join(out,'screenshots',label+'.png'),bytes=await page.screenshot({path:file});
      assert(bytes.length>10000,label+' image-data');
      const errorsSoFar=errors.length;
      const entry={label,config,screenshot:path.relative(out,file),sha256:hash(bytes),bytes:bytes.length,expected,observed:result.runtimeCounts,generationMs,browserErrorsSoFar:errorsSoFar,...result};
      manifest.push(entry);
      console.log(`PASS screenshot ${label} file=${path.relative(out,file)} sha256=${hash(bytes)} expected=${JSON.stringify(expected)} observed=${JSON.stringify(result.runtimeCounts)}`);
    }
    assert.deepEqual(errors,[],'browser errors');
    fs.writeFileSync(path.join(out,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors)+'\n');
    console.log('PASS map-preview screenshots=11 references=2 sizes=3 seed=0 humans=1,4,12 console_errors=0 runtime_counts=matched');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));clearTimeout(deadline)}
})().catch(error=>{console.error(fault?`REJECTED fault=${fault} expected=${FAULTS[fault]} assertion=${error.message}`:'',error);process.exitCode=1});
