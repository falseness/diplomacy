const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {config,setup,mask,union} = require('./test-coop-shared-vision');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const out = path.resolve(root, outputIndex < 0 ? 'artifacts/TASK-090' : process.argv[outputIndex+1]);
const compare = (label, observed, expected) => {
  console.log(JSON.stringify({scenario:label, expected, observed}));
  assert.deepEqual(observed, expected, label);
  console.log('PASS '+label);
};

(async () => {
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive:true});
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.'+(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], checkpoints = [];
  try {
    browser = await chromium.launch({headless:true});
    console.log('browser_engine=chromium browser_version='+browser.version());
    const page = await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    // This offline render fixture uses no networking, downloads or learned AI.
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
    await page.evaluate(config => {
      isFogOfWar=true; gameSettings.isOnline=false;
      const actors=config.actors.map(a=>({...a,units:a.units.map(u=>({...u,type:Noob}))}));
      new GameMap(config.size,actors.slice(0,-1),[],[],[],[],[],{type:'rectangular'},
        {units:actors[3].units}).start(GameManager,false);
      nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
    },config);
    await page.evaluate(setup);
    for (const human of [1,2]) {
      await page.evaluate(human=>{
        if(human===2) offlineNextTurn();
        nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
        nextTurnButton.setNextPlayerColor(players[human].hexColor);
        grid.createSurfaceCache();
        // Use the actual fog-aware runtime surface cache for a full-board view.
        let preview=document.getElementById('vision-preview');
        if(!preview){preview=document.createElement('canvas');preview.id='vision-preview';document.body.append(preview)}
        preview.width=1280;preview.height=900;preview.style.cssText='position:fixed;left:0;top:0;z-index:9999;width:1280px;height:900px';
        const ctx=preview.getContext('2d');ctx.fillStyle='#182329';ctx.fillRect(0,0,1280,900);
        ctx.fillStyle='white';ctx.font='25px sans-serif';ctx.fillText('Co-op shared vision — Human '+human+' turn',30,38);
        const cache=grid.surfaceCache,scale=Math.min(1200/cache.width,800/cache.height);
        ctx.drawImage(cache,(1280-cache.width*scale)/2,75,cache.width*scale,cache.height*scale);
      },human);
      compare('browser-active-human-'+human,await page.evaluate(()=>whooseTurn),human);
      const observed=await page.evaluate(mask);
      compare('browser-human-'+human+'-literal-mask',observed,union('left','right','leftTown','rightTown'));
      compare('browser-human-'+human+'-hidden-enemy',await page.evaluate(()=>({
        hidden:!grid.fogOfWar[6][4],neutralHidden:!grid.fogOfWar[6][7],
        alliedUnits:[!!grid.fogOfWar[2][2],!!grid.fogOfWar[9][2]],
        alliedSuburbs:[!!grid.fogOfWar[2][6],!!grid.fogOfWar[9][6]]})),
        {hidden:true,neutralHidden:true,alliedUnits:[true,true],alliedSuburbs:[true,true]});
      const file=path.join(out,'screenshots','human-'+human+'.png');
      const bytes=await page.screenshot({path:file});assert(bytes.length>10000);
      checkpoints.push({human,expected:union('left','right','leftTown','rightTown'),observed,
        screenshot:path.relative(out,file),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
      console.log('PASS screenshot human-'+human+' file='+file+' bytes='+bytes.length);
    }
    compare('browser-identical-turn-masks',checkpoints[0].observed,checkpoints[1].observed);
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({checkpoints,consoleErrors:errors},null,2)+'\n');
    console.log('PASS co-op shared vision browser screenshots=2 console_errors=0');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
