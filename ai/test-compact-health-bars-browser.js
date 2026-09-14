const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {defaultFixture} = require('./test-coop-harness');
const {checkBar,readBar} = require('./test-compact-health-bars');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const out = outputIndex < 0 ? path.join(root, 'artifacts/TASK-115') :
  path.resolve(root, process.argv[outputIndex+1]);

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
    page.on('response', r=>{if(r.status()>=400) errors.push('HTTP '+r.status()+' '+r.url());});
    page.on('requestfailed', r=>errors.push('requestfailed '+r.url()));
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    // This offline render fixture uses no networking, downloads or learned AI.
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    async function setup(viewport) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
      await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
      const config = defaultFixture(); config.coop=true;
      await page.evaluate(config => {
        window.fixtureConfig=config;
        isFogOfWar=false; gameSettings.isOnline=false;
        const configured=config.actors.map(a=>({...a, units:a.units.map(u=>({...u,type:Noob}))}));
        new GameMap(config.size, configured.slice(0,-1), [],[],[],[],[],{type:'rectangular'},
          {units:configured[3].units}).start(GameManager,false);
        whooseTurn=1; actionManager.clear();
        nextTurnPauseInterface.hideButDontUpdateTimer();
        timer.pauseAndSaveTime();
        otherSettings.alwaysDisplayHPBar=false;
        window.portal=new DemonPortal(3,2);
        gameEvent.screen.moveTo({x:portal.pos.x+assets.size/2,y:portal.pos.y+assets.size/2+130});
        gameEvent.selectSomethingOnCell(grid.getCell({x:3,y:2}));
        drawAll();
      }, config);

      await page.evaluate(()=>{
        // Only the fixture raises this ordinary unit's cap to show all box sizes.
        Normchel.maxHP=30;
        grid.getHexagon({x:4,y:2}).repaint(1,false);
        window.unit=new Normchel(4,2);unit.moves=1;
        otherSettings.alwaysDisplayHPBar=true;otherSettings.alwaysDisplayMovesBar=true;
        gameEvent.removeSelection();
      });
    }
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
      await setup(viewport);
      for(const zoom of [0.8,1]) {
        for(const hp of [27,6]) {
          const label=`${viewport.width}x${viewport.height}-zoom${zoom}-hp${hp}`;
          const state=await page.evaluate(({zoom,hp})=>{
            portal.hp=hp;portal.updateHPBar();unit.hp=hp;unit.updateHPBar();
            // Exercise the game's camera scale transform, including resize.
            Screen.prototype.scale.call(gameEvent.screen,{x:innerWidth/2,y:innerHeight/2},Math.log(zoom/canvas.scale)*1000);
            gameEvent.screen.moveTo({x:(portal.pos.x+unit.pos.x)/2+assets.size/2,
              y:portal.pos.y+assets.size/2+40});
            drawAll();
            return {zoom:canvas.scale,r:basis.r,unitHP:unit.hp,maxHP:unit.maxHP,
              moves:unit.movesBar.rects.map(q=>({w:q.width,h:q.height,color:q.color})),
              transform:{offset:canvas.offset,scale:canvas.scale}};
          },{zoom,hp});
          assert.ok(Math.abs(state.zoom-zoom)<1e-7,'actual camera zoom');
          for(const name of ['portal','unit']) {
            const bar=await page.evaluate(source=>(0,eval)(source),`${readBar}(${name}.hpBar)`);
            checkBar(label+'-'+name,bar,hp,30,hp===27?[2,7,3,0]:[0,6,4,2]);
            const expectedSmall=state.r*.15*zoom;
            const observedSmall=bar.rects.find(q=>q.w<state.r*.2).w*state.zoom;
            assert.ok(Math.abs(expectedSmall-observedSmall)<1e-7);
            assert.ok(Math.abs(Math.max(...bar.rects.map(q=>q.w))*state.zoom-2*expectedSmall)<1e-7);
            state[name]={bar,expectedSmallPixels:expectedSmall,observedSmallPixels:observedSmall,
              expectedBigPixels:2*expectedSmall,observedBigPixels:Math.max(...bar.rects.map(q=>q.w))*state.zoom};
          }
          assert.deepEqual(state.moves,[{w:state.r*.4,h:state.r*.225,color:'#ffa500'},
            {w:state.r*.4,h:state.r*.225,color:'#b3b3b3'}]);
          const screenshot=path.join(out,'screenshots',label+'.png');
          const bytes=await page.screenshot({path:screenshot});
          const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
          checkpoints.push({label,viewport,requestedZoom:zoom,expectedHP:hp,observed:state,screenshot,sha256});
          console.log(`PASS screenshot ${label} portal+ordinary-unit movement=unchanged path=${screenshot} sha256=${sha256}`);
        }
      }
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({engine:'chromium',
      version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('PASS compact-health-bars-browser screenshots=8 viewports=2 zooms=2 hp=27,6 console_errors=0 missing_assets=0');
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
