const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const http=require('http');
const crypto=require('crypto');
const {chromium}=require('playwright');
const {audit,components}=require('./test-coop-terrain-audit');
const root=path.resolve(__dirname,'..'), index=process.argv.indexOf('--output-dir');
const out=path.resolve(index<0?'artifacts/TASK-084':process.argv[index+1]);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
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
    console.log('browser_engine=chromium version='+browser.version());
    const page=await browser.newPage({viewport:{width:1100,height:1050},deviceScaleFactor:1});
    page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof menu!=='undefined'&&imagesCountLoaded===images.length);
    const scenarios=[{reference:'open field'},{reference:'mountain wall'},
      ...['tiny','normal','big'].flatMap(size=>Array.from({length:32},(_,seed)=>({size,seed,count:4})))];
    for(const config of scenarios) {
      const label=config.reference?'reference-'+config.reference.replaceAll(' ','-'):`${config.size}-humans-4-seed-${config.seed}`;
      const result=await page.evaluate(config=>{
        const map=config.reference?maps[config.reference][0]:generateCoopGame(config.count,{size:config.size,seed:config.seed});
        // Render the real runtime's full terrain cache into an overview canvas.
        // This changes only presentation: no custom substitute terrain renderer.
        gameSlot=0;isFogOfWar=false;map.start(GameManager,false);whooseTurn=1;
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        grid.createSurfaceCache();
        let preview=document.getElementById('terrain-preview');
        if(!preview){preview=document.createElement('canvas');preview.id='terrain-preview';document.body.append(preview)}
        preview.width=1100;preview.height=1050;preview.style.cssText='position:fixed;left:0;top:0;z-index:9999;width:1100px;height:1050px';
        const ctx=preview.getContext('2d');ctx.fillStyle='#182329';ctx.fillRect(0,0,1100,1050);
        ctx.fillStyle='white';ctx.font='25px sans-serif';
        ctx.fillText(config.reference?'Authored reference: '+config.reference:`Co-op ${config.size} | 4 humans | seed ${config.seed}`,30,38);
        ctx.font='17px sans-serif';ctx.fillText(`Grid ${map.mapSize.x} × ${map.mapSize.y} | Mountains ${map.mountains.length} | Lakes ${map.lakes.length} | Bushes ${map.bushes.length}`,30,68);
        const cache=grid.surfaceCache,scale=Math.min(1040/cache.width,930/cache.height),w=cache.width*scale,h=cache.height*scale;
        ctx.drawImage(cache,(1100-w)/2,90+(930-h)/2,w,h);
        const runtimeCounts={mountains:0,lakes:0,bushes:0};
        const names={mountain:'mountains',lake:'lakes',bush:'bushes'};
        for(const col of grid.arr)for(const cell of col)if(names[cell.building.name])runtimeCounts[names[cell.building.name]]++;
        return {map:JSON.parse(JSON.stringify(map)),runtimeCounts,cache:{width:cache.width,height:cache.height},rendered:{width:w,height:h}};
      },config);
      const expected=Object.fromEntries(['mountains','lakes','bushes'].map(k=>[k,result.map[k].length]));
      assert.deepEqual(result.runtimeCounts,expected,label+' runtime-counts');
      assert(result.rendered.width>500&&result.rendered.height>500,label+' visible-map');
      if(!config.reference) audit(result.map,label);
      else {
        assert(components(result.map[config.reference==='mountain wall'?'mountains':'lakes'])[0]>=3);
      }
      const file=path.join(out,'screenshots',label+'.png'),bytes=await page.screenshot({path:file});
      assert(bytes.length>10000,label+' image-data');
      manifest.push({label,config,screenshot:path.relative(out,file),sha256:hash(bytes),expected,observed:result.runtimeCounts,...result});
      console.log(`PASS screenshot ${label} file=${path.relative(out,file)} sha256=${hash(bytes)} expected=${JSON.stringify(expected)} observed=${JSON.stringify(result.runtimeCounts)}`);
    }
    assert.deepEqual(errors,[],'browser errors');
    fs.writeFileSync(path.join(out,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors)+'\n');
    console.log('PASS map-preview screenshots=98 references=2 sizes=3 seeds=0..31 humans=4 console_errors=0 runtime_counts=matched');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));clearTimeout(deadline)}
})().catch(error=>{console.error(error);process.exitCode=1});
