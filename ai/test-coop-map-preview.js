const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const http=require('http');
const crypto=require('crypto');
// Browser tests run with NODE_PATH/PLAYWRIGHT_BROWSERS_PATH; default both so the plain command works too.
if(process.env.PLAYWRIGHT_BROWSERS_PATH===undefined)process.env.PLAYWRIGHT_BROWSERS_PATH='0';
const {chromium}=(()=>{try{return require('playwright')}catch(error){return require('/opt/diplomacy/node_modules/playwright')}})();
const {audit,components}=require('../../diplomacy_server/tests/client/test-coop-terrain-audit');
const root=path.resolve(__dirname,'..'), arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
// Renders production co-op maps (Tiny/Normal/Big x humans 1/4/12, seed 0) next to the authored references.
// --fault stale-render is a negative control; --only narrows.
// --circle renders production version-5 Circle maps (Tiny/Normal/Big x humans 1/4/12 x seeds 0/1) with the
// planned region boundaries overlaid and an in-page plan replay; it writes manifest.json.
const circleMode=process.argv.includes('--circle');
const fault=arg('--fault'), only=arg('--only')?.split(',');
const out=path.resolve(arg('--output-dir')??'artifacts/TASK-121');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const SIZES=['tiny','normal','big'], HUMANS=[1,4,12], SEEDS=circleMode?[0,1]:[0];
const FAULTS=circleMode?{'stale-render':'runtime-entities'}:{'stale-render':'runtime-counts'};
const VIEW=circleMode?{width:1400,height:1400}:{width:1100,height:1050};
const key=c=>`${c.x},${c.y}`;
// Circle only: record the plan of the successful candidate (generation itself is untouched) and
// overlay the replayed plan's region boundaries on the rendered board.
function circlePageSetup() {
  const plan=planCoopCircle,build=buildCoopCircleCandidate;
  globalThis.originalPlanCoopCircle=plan;
  planCoopCircle=function(humans,size,seed){return globalThis.lastCirclePlan=plan(humans,size,seed)};
  buildCoopCircleCandidate=function(humans,size,seed,attempt){const map=build(humans,size,seed,attempt);globalThis.circleRecord={attempt,plan:lastCirclePlan};return map};
  globalThis.circleOverlay=function(map,config,ctx,place){
    const record=globalThis.circleRecord,generation=map.coop.generation;
    // Re-derive the plan from scratch and compare it with the one the generator used.
    clearCirclePlanCache();
    const fresh=originalPlanCoopCircle(config.count,config.size,coopCircleAttemptSeed(config.seed,record.attempt));
    const R=fresh.radius,rg=fresh.regions,center=fresh.center,layer=c=>coopHexLayer(c.x,c.y,center);
    const humanTowns=map.players.slice(1,1+config.count).flatMap(p=>p.towns);
    const elite=map.portals.filter(p=>COOP_CIRCLE_ELITE_CATEGORIES.includes(p.category)),common=map.portals.filter(p=>!COOP_CIRCLE_ELITE_CATEGORIES.includes(p.category));
    const runtimeCounts={mountains:0,lakes:0,bushes:0},names={mountain:'mountains',lake:'lakes',bush:'bushes'};
    const entities={mountains:[],lakes:[],bushes:[],goldmines:[],towns:[],portals:[],units:[],other:[]};
    let maskCells=0,maskMismatch=[];
    for(let x=0;x<grid.arr.length;x++)for(let y=0;y<grid.arr[x].length;y++){
      const cell=grid.arr[x][y],b=cell.building,id=x+','+y,outside=fresh.grid[y][x]==='.';
      if(!!b.isMapEdge!==outside)maskMismatch.push(id);
      if(b.isMapEdge){maskCells++;continue}
      if(names[b.name]){runtimeCounts[names[b.name]]++;entities[names[b.name]].push(id)}
      else if(b.name==='goldmine')entities.goldmines.push(id);
      else if(b.isDemonPortal)entities.portals.push(id);
      else if(b.notEmpty()&&b.isTown())entities.towns.push(id+':'+cell.hexagon.playerColor);
      else if(b.notEmpty())entities.other.push(id+':'+b.name);
      if(cell.unit.notEmpty())entities.units.push(id+':'+cell.unit.name+':'+cell.unit.playerColor);
    }
    for(const k in entities)entities[k].sort();
    const replay={planEqual:JSON.stringify(fresh)===JSON.stringify(record.plan),
      shapeEqual:JSON.stringify(map.mapShape)===JSON.stringify(fresh.mapShape),
      sizeEqual:map.mapSize.x===fresh.side&&map.mapSize.y===fresh.side,
      townsOnTownRing:humanTowns.every(t=>fresh.grid[t.y][t.x]==='T'),
      eliteInCore:elite.every(p=>fresh.grid[p.y][p.x]==='X'),
      commonInRing:common.every(p=>fresh.grid[p.y][p.x]==='o'),
      runtimeMaskMatchesPlan:maskMismatch.length===0};
    const measured={humanTownLayers:[...new Set(humanTowns.map(layer))].sort((a,b)=>a-b),
      elitePortalLayers:elite.length?[Math.min(...elite.map(layer)),Math.max(...elite.map(layer))]:null,
      commonPortalLayers:common.length?[Math.min(...common.map(layer)),Math.max(...common.map(layer))]:null,
      maxObjectLayer:Math.max(...[...map.players.flatMap(p=>p.towns),...map.goldmines,...map.portals].map(layer)),maskCells};
    // Boundary edges: the rim (R|R+1), elite core (E|E+1), ring outer edge and both sides of the town ring.
    const bands=[{name:'rim',at:R,color:'#ffffff'},{name:'elite core',at:rg.elite,color:'#ff3b3b'},
      {name:'common ring',at:rg.ringOuter,color:'#ffb000'},{name:'town ring',at:rg.townRing,color:'#00e5ff'},{name:'town ring',at:rg.townRing-1,color:'#00e5ff'}];
    const edges=Object.fromEntries(bands.map(b=>[b.name+':'+b.at,0]));
    ctx.lineWidth=3;ctx.lineCap='round';
    for(let x=0;x<fresh.side;x++)for(let y=0;y<fresh.side;y++){
      const c=new Sprite(x,y),l=layer(c.coord);
      if(l>R)continue;
      for(const n of c.neighbours){
        const nl=coopHexLayer(n.x,n.y,center);
        for(const b of bands)if(l===b.at&&nl===b.at+1){
          const p=place(c.pos),q=place(new Sprite(n.x,n.y).pos),mx=(p.x+q.x)/2,my=(p.y+q.y)/2,dx=q.x-p.x,dy=q.y-p.y,k=0.5/Math.sqrt(3);
          ctx.strokeStyle=b.color;ctx.beginPath();ctx.moveTo(mx-dy*k,my+dx*k);ctx.lineTo(mx+dy*k,my-dx*k);ctx.stroke();edges[b.name+':'+b.at]++;
        }
      }
    }
    const portalsByCategory={};for(const p of map.portals)portalsByCategory[p.category]=(portalsByCategory[p.category]||0)+1;
    return {generationVersion:generation.version,mapShape:map.mapShape,radius:R,
      regionLayers:{elite:rg.elite,ringInner:rg.ringInner,ringOuter:rg.ringOuter,townRing:rg.townRing},
      portalsByCategory,attempt:record.attempt,planSeed:fresh.seed,replay,planReplayed:Object.values(replay).every(Boolean),
      measured,overlayEdges:edges,runtimeCounts,entities};
  };
}
if(fault!==undefined&&!FAULTS[fault]){console.error('FAIL unknown fault '+fault);process.exit(2)}
(async()=>{
  fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
  const deadline=setTimeout(()=>{console.error('FAIL preview watchdog');process.exit(1)},circleMode?900000:600000);deadline.unref();
  const started=Date.now();
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
    console.log('browser_engine=chromium version='+browser.version()+' node='+process.version+(circleMode?' mode=circle':'')+(fault?' fault='+fault:''));
    const page=await browser.newPage({viewport:VIEW,deviceScaleFactor:1});
    page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    // The shared host can be heavily loaded; asset loading alone has taken over 20 s.
    await page.waitForFunction(()=>typeof menu!=='undefined'&&imagesCountLoaded===images.length,null,{timeout:120000});
    if(circleMode)await page.evaluate(circlePageSetup);
    const scenarios=[...(circleMode?[]:[{reference:'open field'},{reference:'mountain wall'}]),
      ...SIZES.flatMap(size=>HUMANS.flatMap(count=>SEEDS.map(seed=>({size,seed,count}))))]
      .filter(c=>!only||only.includes(c.reference?'reference-'+c.reference.replaceAll(' ','-'):`${c.size}-humans-${c.count}-seed-${c.seed}`));
    for(const config of scenarios) {
      const label=config.reference?'reference-'+config.reference.replaceAll(' ','-'):`${config.size}-humans-${config.count}-seed-${config.seed}`;
      const t0=Date.now(),errorsBefore=errors.length;
      const result=await page.evaluate(({config,fault,circleMode})=>{
        globalThis.circleRecord=null;
        const map=config.reference?maps[config.reference][0]:generateCoopGame(config.count,{size:config.size,seed:config.seed});
        const shown=fault==='stale-render'&&!config.reference?generateCoopGame(config.count,{size:config.size,seed:config.seed+1}):map;
        // Render the real runtime's full terrain cache into an overview canvas.
        // This changes only presentation: no custom substitute terrain renderer.
        gameSlot=0;isFogOfWar=false;shown.start(GameManager,false);whooseTurn=1;
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        grid.createSurfaceCache();
        const W=innerWidth,H=innerHeight,top=circleMode?118:90;
        let preview=document.getElementById('terrain-preview');
        if(!preview){preview=document.createElement('canvas');preview.id='terrain-preview';document.body.append(preview)}
        preview.width=W;preview.height=H;preview.style.cssText=`position:fixed;left:0;top:0;z-index:9999;width:${W}px;height:${H}px`;
        const ctx=preview.getContext('2d');ctx.fillStyle='#182329';ctx.fillRect(0,0,W,H);
        ctx.fillStyle='white';ctx.font='25px sans-serif';
        const sizeName=config.size&&config.size[0].toUpperCase()+config.size.slice(1);
        if(circleMode)ctx.fillText(`Circle v${map.coop.generation.version} | ${sizeName} | ${config.count} humans | seed ${config.seed} | radius ${map.mapShape.radius}`,30,38);
        else ctx.fillText(config.reference?'Authored reference: '+config.reference:`Co-op ${config.size} | ${config.count} humans | seed ${config.seed} | ${map.portals.length} portals`,30,38);
        ctx.font='17px sans-serif';ctx.fillText(`Grid ${map.mapSize.x} × ${map.mapSize.y} | Mountains ${map.mountains.length} | Lakes ${map.lakes.length} | Bushes ${map.bushes.length}`,30,68);
        const cache=grid.surfaceCache,scale=Math.min((W-60)/cache.width,(H-top-20)/cache.height),w=cache.width*scale,h=cache.height*scale;
        ctx.drawImage(cache,(W-w)/2,top+(H-top-20-h)/2,w,h);
        let circle=null;
        if(circleMode&&!config.reference){
          const b=grid.surfaceCacheBounds,left=(W-w)/2,y0=top+(H-top-20-h)/2;
          circle=circleOverlay(map,config,ctx,pos=>({x:left+(pos.x-b.left)/b.width*w,y:y0+(pos.y-b.top)/b.height*h}));
          const r=circle.regionLayers;ctx.font='17px sans-serif';ctx.fillStyle='white';
          ctx.fillText(`Layers: elite core <= ${r.elite} (red) | common ring ${r.ringInner}..${r.ringOuter} (amber) | town ring ${r.townRing} (cyan) | rim ${circle.radius} (white) | portals ${map.portals.length}`,30,96);
        }
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
        return {map:JSON.parse(JSON.stringify(map)),runtimeCounts,entities,circle,
          cache:{width:cache.width,height:cache.height},rendered:{width:w,height:h,pixelsPerColumn:w/map.mapSize.x,pixelsPerRow:h/map.mapSize.y}};
      },{config,fault,circleMode});
      const generationMs=Date.now()-t0;
      const expected=Object.fromEntries(['mountains','lakes','bushes'].map(k=>[k,result.map[k].length]));
      if(circleMode) {
        // Every rendered runtime entity (outside the mask) sits exactly where the generated data places it.
        const m=result.map,c=result.circle,ids=list=>list.map(key).sort();
        const expectedEntities={mountains:ids(m.mountains),lakes:ids(m.lakes),bushes:ids(m.bushes),goldmines:ids(m.goldmines),
          towns:m.players.flatMap((p,i)=>p.towns.map(t=>key(t)+':'+i)).sort(),portals:ids(m.portals),other:[],
          units:m.players.flatMap((p,i)=>i?p.towns.map(t=>key(t)+':noob:'+i):[]).sort()};
        assert.equal(c.generationVersion,5,label+' generation-version');
        assert.equal(c.mapShape.type,'hexagonal',label+' map-shape');
        assert.deepEqual(c.entities,expectedEntities,label+' runtime-entities');
        assert.deepEqual(c.runtimeCounts,expected,label+' circle-runtime-counts');
        assert(c.planReplayed,label+' plan-replay '+JSON.stringify(c.replay));
        assert.deepEqual(c.measured.humanTownLayers,[c.regionLayers.townRing],label+' town-ring');
        assert(c.measured.elitePortalLayers[1]<=c.regionLayers.elite&&c.measured.commonPortalLayers[0]>=c.regionLayers.ringInner&&
          c.measured.commonPortalLayers[1]<=c.regionLayers.ringOuter,label+' portal-regions');
        assert(Object.values(c.overlayEdges).every(n=>n>0),label+' overlay-edges '+JSON.stringify(c.overlayEdges));
        assert(result.rendered.pixelsPerColumn>=8,label+' readable-scale '+result.rendered.pixelsPerColumn.toFixed(1));
      }
      else
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
      if(circleMode){
        const c=result.circle,pageErrors=errors.slice(errorsBefore);
        manifest.push({size:config.size,humans:config.count,seed:config.seed,generationVersion:c.generationVersion,mapShape:c.mapShape,radius:c.radius,
          regionLayers:c.regionLayers,portalsByCategory:c.portalsByCategory,planReplayed:c.planReplayed,pageErrors,
          screenshot:entry.screenshot,sha256:entry.sha256,attempt:c.attempt,planSeed:c.planSeed,replay:c.replay,measured:c.measured,overlayEdges:c.overlayEdges,
          entityCounts:Object.fromEntries(Object.entries(c.entities).map(([k,v])=>[k,v.length])),rendered:result.rendered,generationMs});
        console.log(`PASS circle ${label} file=${entry.screenshot} sha256=${entry.sha256} R=${c.radius} layers=${JSON.stringify(c.regionLayers)} measured=${JSON.stringify(c.measured)} `+
          `portals=${JSON.stringify(c.portalsByCategory)} planReplayed=${c.planReplayed} entities=matched pageErrors=${pageErrors.length} ms=${generationMs}`);
        continue;
      }
      manifest.push(entry);
      console.log(`PASS screenshot ${label} file=${path.relative(out,file)} sha256=${hash(bytes)} expected=${JSON.stringify(expected)} observed=${JSON.stringify(result.runtimeCounts)}`);
    }
    assert.deepEqual(errors,[],'browser errors');
    if(circleMode){
      fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
      assert(!only&&manifest.length===SIZES.length*HUMANS.length*SEEDS.length,'circle-coverage rendered='+manifest.length);
      console.log(`PASS circle-preview screenshots=${manifest.length} sizes=tiny,normal,big humans=1,4,12 seeds=0,1 planReplayed=${manifest.length}/${manifest.length} page_errors=0 elapsed=${Math.round((Date.now()-started)/1000)}s`);
      return;
    }
    fs.writeFileSync(path.join(out,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors)+'\n');
    console.log('PASS map-preview screenshots=11 references=2 sizes=3 seed=0 humans=1,4,12 console_errors=0 runtime_counts=matched');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));clearTimeout(deadline)}
})().catch(error=>{console.error(fault?`REJECTED fault=${fault} expected=${FAULTS[fault]} assertion=${error.message}`:'',error);process.exitCode=1});
