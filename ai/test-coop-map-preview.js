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
// --valley renders production version-4 Divided Valley maps (Tiny/Normal/Big x humans 1/4/12 x seeds 0/1)
// next to the authored references. --fault drop-ridge|stale-render are negative controls; --only narrows.
const valleyMode=process.argv.includes('--valley'), fault=arg('--fault'), only=arg('--only')?.split(',');
const out=path.resolve(arg('--output-dir')??'artifacts/TASK-121');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const key=c=>`${c.x},${c.y}`;
const SIZES=['tiny','normal','big'], HUMANS=[1,4,12], SEEDS=valleyMode?[0,1]:[0];
const FAULTS={'drop-ridge':'valley-ridge','stale-render':'runtime-entities'};
const SOURCES=['ai/test-coop-map-preview.js','ai/test-coop-terrain-audit.js','ai/test-coop-valley-contract.js','ai/generateMap.js',
  'ai/coop-valley-plan.js','ai/coop-map-scaling.js','index.html','groups/grid.js','options/gamestart.js','render/loadassets.js'];
const VIEW=valleyMode?{width:1400,height:1400}:{width:1100,height:1050};
if(fault!==undefined&&!FAULTS[fault]){console.error('FAIL unknown fault '+fault);process.exit(2)}
// Separating ridge, both advance passages (fronts), forward objectives and laterals from the reproduced plan.
function valleyFindings(map,plan,label) {
  const valley=require('./coop-valley-plan.js'), {verifyValley}=require('./test-coop-valley-contract.js');
  const {playerCount,size,seed}=map.coop.generation, attemptSeed=plan.seed;
  const replay=valley.planDividedValley(playerCount,size,attemptSeed);
  assert.deepEqual(replay.grid,plan.grid,label+' plan-replay');
  const mountains=new Set(map.mountains.map(key)), blocking=new Set([...map.mountains,...map.lakes].map(key));
  const ridgeRows=[], [top,bottom]=[plan.rows.ridge[0],plan.rows.ridge[1]];
  const ridgeMissing=plan.masks.ridge.filter(c=>!mountains.has(key(c))).map(key);
  for(let y=top;y<bottom;y++)ridgeRows.push({y,ridgeCells:plan.masks.ridge.filter(c=>c.y===y).length});
  const openColumns=Array.from({length:plan.side},(_,x)=>x).filter(x=>plan.grid.slice(top,bottom+1).every(row=>!'M'.includes(row[x])));
  assert(plan.masks.ridge.length>0&&!ridgeMissing.length,label+' valley-ridge');
  const passages=['leftPassage','rightPassage'].map(name=>({name,cells:plan.masks[name].length,blocked:plan.masks[name].filter(c=>blocking.has(key(c))).map(key),
    x:[Math.min(...plan.masks[name].map(c=>c.x)),Math.max(...plan.masks[name].map(c=>c.x))]}));
  assert(passages.every(p=>p.cells>0&&!p.blocked.length)&&passages[0].x[1]<passages[1].x[0],label+' valley-fronts');
  const exitRow=plan.rows.exitRow, portalFront=p=>plan.grid[p.y][p.x];
  const fronts={west:map.portals.filter(p=>portalFront(p)==='W').length,east:map.portals.filter(p=>portalFront(p)==='E').length};
  assert.equal(fronts.west+fronts.east,map.portals.length,label+' valley-portal-regions');
  const forward={neutralTowns:map.players[0].towns.filter(c=>c.y<top).length,goldmines:map.goldmines.filter(c=>c.y<top).length,portals:map.portals.filter(c=>c.y<top).length};
  const humanTowns=map.players.slice(1,1+playerCount).map(p=>p.towns[0]);
  assert(forward.neutralTowns+forward.goldmines>0&&forward.portals===map.portals.length&&humanTowns.every(t=>t.y>bottom),label+' valley-forward-objectives');
  const laterals=['rearLateral','forwardLateral'].map(name=>({name,cells:plan.masks[name].length,blocked:plan.masks[name].filter(c=>blocking.has(key(c))).map(key)}));
  assert(laterals.every(l=>l.cells>0&&!l.blocked.length),label+' valley-laterals');
  const contract=verifyValley({size,mapSize:map.mapSize,coop:{initialHumanCount:playerCount},players:map.players.slice(0,1+playerCount),
    goldmines:map.goldmines,portals:map.portals,mountains:map.mountains,lakes:map.lakes,bushes:map.bushes,hills:map.hills,valley:plan.valley});
  assert(contract.valid,label+' valley-contract '+contract.failed.join(','));
  return {requestedSeed:seed,planSeed:attemptSeed,planReplayed:true,rows:{...plan.rows,exitRow},
    ridge:{cells:plan.masks.ridge.length,allMountains:true,rows:ridgeRows,openColumnsThroughRidge:openColumns},
    fronts:{advancePassages:passages,portalGroups:fronts},forwardObjectives:{aboveRidge:forward,humanTownsBelowRidge:humanTowns.length},
    laterals,contract:{valid:contract.valid,assertions:contract.results.map(r=>r.name)}};
}
(async()=>{
  fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
  const deadline=setTimeout(()=>{console.error('FAIL preview watchdog');process.exit(1)},valleyMode?2700000:600000);deadline.unref();
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});res.end(error?'Not found':data)});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const errors=[],manifest=[],started=Date.now();
  const sources=Object.fromEntries(SOURCES.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
  try {
    browser=await chromium.launch({headless:true});
    console.log('browser_engine=chromium version='+browser.version()+' node='+process.version+(valleyMode?' mode=valley':'')+(fault?' fault='+fault:''));
    const page=await browser.newPage({viewport:VIEW,deviceScaleFactor:1});
    page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    // The shared host can be heavily loaded; asset loading alone has taken over 20 s.
    await page.waitForFunction(()=>typeof menu!=='undefined'&&imagesCountLoaded===images.length,null,{timeout:120000});
    // Record the plan of the successful candidate; generation itself is untouched.
    if(valleyMode)await page.evaluate(()=>{
      const plan=planDividedValley,build=buildCoopValleyCandidate;
      planDividedValley=function(humans,size,seed){return globalThis.lastValleyPlan=plan(humans,size,seed)};
      buildCoopValleyCandidate=function(humans,size,seed,attempt){const map=build(humans,size,seed,attempt);globalThis.valleyRecord={attempt,plan:lastValleyPlan};return map};
    });
    const scenarios=[{reference:'open field'},{reference:'mountain wall'},
      ...SIZES.flatMap(size=>HUMANS.flatMap(count=>SEEDS.map(seed=>({size,seed,count}))))]
      .filter(c=>!only||only.includes(c.reference?'reference-'+c.reference.replaceAll(' ','-'):`${c.size}-humans-${c.count}-seed-${c.seed}`));
    for(const config of scenarios) {
      const label=config.reference?'reference-'+config.reference.replaceAll(' ','-'):`${config.size}-humans-${config.count}-seed-${config.seed}`;
      const t0=Date.now();
      const result=await page.evaluate(({config,valleyMode,fault})=>{
        globalThis.valleyRecord=null;
        const map=config.reference?maps[config.reference][0]:generateCoopGame(config.count,{size:config.size,seed:config.seed});
        const record=globalThis.valleyRecord;
        if(fault==='drop-ridge'&&!config.reference){const ridge=new Set(record.plan.masks.ridge.map(c=>c.x+','+c.y));map.mountains=map.mountains.filter(c=>!ridge.has(c.x+','+c.y))}
        const shown=fault==='stale-render'&&!config.reference?generateCoopGame(config.count,{size:config.size,seed:config.seed+1}):map;
        // Render the real runtime's full terrain cache into an overview canvas.
        // This changes only presentation: no custom substitute terrain renderer.
        gameSlot=0;isFogOfWar=false;shown.start(GameManager,false);whooseTurn=1;
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        grid.createSurfaceCache();
        const W=innerWidth,H=innerHeight,top=valleyMode?118:90;
        let preview=document.getElementById('terrain-preview');
        if(!preview){preview=document.createElement('canvas');preview.id='terrain-preview';document.body.append(preview)}
        preview.width=W;preview.height=H;preview.style.cssText=`position:fixed;left:0;top:0;z-index:9999;width:${W}px;height:${H}px`;
        const ctx=preview.getContext('2d');ctx.fillStyle='#182329';ctx.fillRect(0,0,W,H);
        ctx.fillStyle='white';ctx.font='25px sans-serif';
        const sizeName=config.size&&config.size[0].toUpperCase()+config.size.slice(1);
        ctx.fillText(config.reference?'Authored reference: '+config.reference:valleyMode?`Divided Valley v${map.coop.generation.version} | ${sizeName} | ${config.count} humans | seed ${config.seed}`:`Co-op ${config.size} | ${config.count} humans | seed ${config.seed} | ${map.portals.length} portals`,30,38);
        ctx.font='17px sans-serif';ctx.fillText(`Grid ${map.mapSize.x} × ${map.mapSize.y} | Mountains ${map.mountains.length} | Lakes ${map.lakes.length} | Bushes ${map.bushes.length}`,30,68);
        if(valleyMode&&!config.reference)ctx.fillText(`Human towns ${config.count} | Neutral towns ${map.players[0].towns.length} | Goldmines ${map.goldmines.length} | Portals ${map.portals.length} | north = portals, south = humans`,30,96);
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
        return {map:JSON.parse(JSON.stringify(map)),plan:record&&record.plan,attempt:record&&record.attempt,runtimeCounts,entities,
          cache:{width:cache.width,height:cache.height},rendered:{width:w,height:h,pixelsPerColumn:w/map.mapSize.x,pixelsPerRow:h/map.mapSize.y}};
      },{config,valleyMode,fault});
      const generationMs=Date.now()-t0;
      const expected=Object.fromEntries(['mountains','lakes','bushes'].map(k=>[k,result.map[k].length]));
      let findings=null,terrainAudit=null;
      if(valleyMode&&!config.reference) {
        // Every rendered runtime entity sits exactly where the generated data places it.
        const m=result.map, ids=list=>list.map(key).sort();
        const expectedEntities={mountains:ids(m.mountains),lakes:ids(m.lakes),bushes:ids(m.bushes),goldmines:ids(m.goldmines),
          towns:m.players.flatMap((p,i)=>p.towns.map(c=>key(c)+':'+i)).sort(),portals:ids(m.portals),other:[],
          // Game start places one starting unit on every human town.
          units:m.players.flatMap((p,i)=>i?p.towns.map(c=>key(c)+':noob:'+i):[]).sort()};
        assert.equal(m.coop.generation.version,4,label+' generation-version');
        assert.deepEqual(result.entities,expectedEntities,label+' runtime-entities');
      }
      assert.deepEqual(result.runtimeCounts,expected,label+' runtime-counts');
      assert(result.rendered.width>500&&result.rendered.height>500,label+' visible-map');
      if(valleyMode&&!config.reference) {
        const m=result.map;
        assert(result.rendered.pixelsPerColumn>=12&&result.rendered.pixelsPerRow>=12,label+' readable-scale');
        findings=valleyFindings(m,result.plan,label);
        terrainAudit=audit(m,label);
      }
      else if(!config.reference) audit(result.map,label);
      else {
        assert(components(result.map[config.reference==='mountain wall'?'mountains':'lakes'])[0]>=3);
      }
      const file=path.join(out,'screenshots',label+'.png'),bytes=await page.screenshot({path:file});
      assert(bytes.length>10000,label+' image-data');
      const errorsSoFar=errors.length;
      const entry={label,config,screenshot:path.relative(out,file),sha256:hash(bytes),bytes:bytes.length,expected,observed:result.runtimeCounts,generationMs,browserErrorsSoFar:errorsSoFar,...result};
      if(valleyMode){
        const snapshot=path.join(out,'maps',label+'.json');fs.mkdirSync(path.dirname(snapshot),{recursive:true});
        const json=JSON.stringify(result.map);fs.writeFileSync(snapshot,json+'\n');
        Object.assign(entry,{mapSnapshot:path.relative(out,snapshot),mapSha256:hash(json),valleyFindings:findings,terrainAudit});
        delete entry.map;delete entry.plan;
      }
      manifest.push(entry);
      console.log(`PASS screenshot ${label} file=${path.relative(out,file)} sha256=${hash(bytes)} expected=${JSON.stringify(expected)} observed=${JSON.stringify(result.runtimeCounts)}`+
        (findings?` entities=matched portals=${result.entities.portals.length} towns=${result.entities.towns.length} goldmines=${result.entities.goldmines.length} ridge=${findings.ridge.cells} fronts=${findings.fronts.portalGroups.west}W/${findings.fronts.portalGroups.east}E forward=${JSON.stringify(findings.forwardObjectives.aboveRidge)} laterals=clear contract=valid px_per_column=${result.rendered.pixelsPerColumn.toFixed(1)} ms=${generationMs}`:''));
    }
    assert.deepEqual(errors,[],'browser errors');
    fs.writeFileSync(path.join(out,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors)+'\n');
    if(!valleyMode) {console.log('PASS map-preview screenshots=11 references=2 sizes=3 seed=0 humans=1,4,12 console_errors=0 runtime_counts=matched');return}
    const generated=manifest.filter(e=>!e.config.reference);
    fs.writeFileSync(path.join(out,'source-identities.json'),JSON.stringify(sources,null,2)+'\n');
    fs.writeFileSync(path.join(out,'checkpoints.json'),JSON.stringify({mode:'valley',browser:{engine:'chromium',version:browser.version()},node:process.version,
      viewport:VIEW,elapsedMs:Date.now()-started,browserErrors:errors,sources,narrowed:!!only,
      images:manifest.map(({label,config,screenshot,sha256,bytes,mapSnapshot,mapSha256,expected,observed,entities,rendered,cache,generationMs,attempt,valleyFindings,terrainAudit})=>
        ({label,config,screenshot,sha256,bytes,mapSnapshot,mapSha256,runtimeCounts:{expected,observed},entityCounts:entities&&Object.fromEntries(Object.entries(entities).map(([k,v])=>[k,v.length])),
          rendered,cache,generationMs,successfulAttempt:attempt,valleyFindings,terrainAudit,visualReview:null}))},null,2)+'\n');
    assert(!only&&generated.length===SIZES.length*HUMANS.length*SEEDS.length,'valley-coverage generated='+generated.length);
    console.log(`PASS valley-preview screenshots=${manifest.length} generated=${generated.length} references=${manifest.length-generated.length} sizes=tiny,normal,big humans=1,4,12 seeds=0,1 `+
      `console_errors=0 runtime_entities=matched valley_findings=${generated.length}/${generated.length} elapsed=${Math.round((Date.now()-started)/1000)}s`);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));clearTimeout(deadline)}
})().catch(error=>{console.error(fault?`REJECTED fault=${fault} expected=${FAULTS[fault]} assertion=${error.message}`:'',error);process.exitCode=1});
