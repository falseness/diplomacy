const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {defaultFixture} = require('./test-coop-harness');

// Browser proof of the undead look: demon-owned Noob, mirrored KOHb and
// Catapult draw cachedImages/assets['undead/<key>'] on the direct path
// (unit.draw), the grid surface cache path (createSurfaceCache ->
// drawEntityBody) and the selection portrait; a human Noob keeps its art.
// Usage: PLAYWRIGHT_BROWSERS_PATH=0 node ai/test-coop-undead-render-browser.js --output-dir <dir>
const started = Date.now();
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const out = path.resolve(root, outputIndex < 0 ? 'artifacts/TASK-417/out' : process.argv[outputIndex+1]);
const UNITS = [
  {id:'demon-noob', cls:'Noob', owner:3, x:3, y:3, mirrorX:false, expectedKey:'undead/noob'},
  {id:'demon-KOHb', cls:'KOHb', owner:3, x:4, y:3, mirrorX:true, expectedKey:'undead/KOHbLeft'},
  {id:'demon-catapult', cls:'Catapult', owner:3, x:5, y:3, mirrorX:false, expectedKey:'undead/catapult'},
  {id:'human-noob', cls:'Noob', owner:1, x:4, y:4, mirrorX:false, expectedKey:'noob'}
];
const PATHS = ['direct', 'grid-cache', 'portrait'];

(async () => {
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive:true});
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.'+decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, failed = 0;
  const errors = [], checkpoints = [];
  try {
    browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    console.log('browser_engine=chromium browser_version='+browser.version());
    const page = await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    page.on('requestfailed', req => errors.push(req.url()+': '+req.failure().errorText));
    page.on('response', res => {if(res.status()>=400) errors.push(res.url()+': '+res.status());});
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    // Offline fixture: stub CDN scripts (socket.io, FileSaver, tf).
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
    const config = defaultFixture(); config.coop = true;
    // Co-op start validates the full typed portal set (22): rows 0 and 6 plus the side cells.
    const portalCells=[...Array.from({length:9},(_,x)=>[x,0]),...Array.from({length:9},(_,x)=>[x,6]),[0,3],[8,3]];
    config.portals=[...portalCells.map(([x,y],i)=>({x,y,category:['melee','melee','melee','ranged','ranged','ranged','siege','heavy','support','chaos'][i%10]})),
      {x:0,y:4,category:'mage'},{x:8,y:4,category:'mage'}];
    await page.evaluate(({config, units}) => {
      isFogOfWar=false; gameSettings.isOnline=false;
      const configured=config.actors.map(a=>({...a, units:a.units.map(u=>({...u,type:Noob}))}));
      const map=new GameMap(config.size, configured.slice(0,-1), [],[],[],[],[],{type:'rectangular'},
        {units:configured[3].units});
      map.coop.generation={version:5,playerCount:2,seed:1,size:'tiny',options:{seed:1,size:'tiny'},
        testFixture:{label:'undead-render',kind:'declared-local-fixture',generated:false}};
      map.portals=config.portals.map(p=>({...p}));
      map.start(GameManager,false);
      whooseTurn=1; actionManager.clear();
      nextTurnPauseInterface.hideButDontUpdateTimer();
      timer.pauseAndSaveTime();
      otherSettings.alwaysDisplayHPBar=false;
      window.testUnits={};
      for (const u of units) {
        grid.getHexagon({x:u.x,y:u.y}).repaint(u.owner,false);
        const unit=new (eval(u.cls))(u.x,u.y);
        unit.mirrorX=u.mirrorX;
        testUnits[u.id]=unit;
      }
      const c=testUnits['demon-KOHb'];
      gameEvent.screen.moveTo({x:c.pos.x+assets.size/2,y:c.pos.y+assets.size/2+130});
      gameEvent.removeSelection();
      grid.surfaceCache=null;
      drawAll();
    }, {config, units:UNITS});

    // Maps a drawn image object back to its asset key among this unit's candidates.
    const observe = (u, p) => page.evaluate(({u, p}) => {
      const unit=testUnits[u.id];
      const candidates=[unit.name, unit.name+'Left', 'undead/'+unit.name, 'undead/'+unit.name+'Left'];
      const keyOf=(image, table)=>candidates.find(k=>table[k] && table[k]===image) || null;
      const proto=CanvasRenderingContext2D.prototype, original=proto.drawImage;
      const drawn=[];
      let table=cachedImages, result={};
      try {
        if (p==='direct') {
          proto.drawImage=function(image,...args){drawn.push(image);return original.call(this,image,...args)};
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=900;
          unit.draw(canvas.getContext('2d'));
        } else if (p==='grid-cache') {
          // Rebuild the real surface cache; attribute draws to the entity being drawn.
          let current=null;
          const drawEntityBody=grid.drawEntityBody;
          grid.drawEntityBody=function(ctx,entity){current=entity;try{return drawEntityBody.call(this,ctx,entity)}finally{current=null}};
          proto.drawImage=function(image,...args){if(current===unit) drawn.push(image);return original.call(this,image,...args)};
          try {
            grid.surfaceCache=null;
            result.cacheBuilt=grid.createSurfaceCache();
            result.cacheIsCanvas=grid.surfaceCache instanceof HTMLCanvasElement;
          } finally {delete grid.drawEntityBody}
        } else {
          gameEvent.selectSomethingOnCell(grid.getCell(unit.coord));
          table=assets;
          proto.drawImage=function(image,...args){drawn.push(image);return original.call(this,image,...args)};
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=900;
          entityInterface.drawContents(canvas.getContext('2d'));
          result.panelKey=entityInterface.img.image;
          result.panelVisible=entityInterface.visible;
        }
      } finally {proto.drawImage=original}
      const keys=drawn.map(i=>keyOf(i,table)).filter(Boolean);
      result.observedKey=keys.length ? keys[0] : null;
      result.allKeys=[...new Set(keys)];
      result.bodyImageName=unit.bodyImageName;
      result.role=unit.player.role;
      const key=result.observedKey;
      result.asset=key ? {complete:assets[key].complete, naturalWidth:assets[key].naturalWidth,
        src:new URL(assets[key].src).pathname, cached:!!cachedImages[key] && cachedImages[key].width>0} : null;
      if (p!=='portrait') gameEvent.removeSelection();
      drawAll();
      return result;
    }, {u, p});

    for (const u of UNITS) {
      for (const p of PATHS) {
        const checkpoint = `${u.id}-${p}`;
        const obs = await observe(u, p);
        const expectedRole = u.owner === 3 ? 'DEMONS' : 'HUMAN';
        const expectedSrc = '/assets/'+(u.expectedKey.startsWith('undead/') ? u.expectedKey : 'sprites/'+u.expectedKey)+'.svg';
        let ok = obs.observedKey === u.expectedKey && obs.allKeys.length === 1 &&
          obs.bodyImageName === u.expectedKey && obs.role === expectedRole &&
          obs.asset && obs.asset.complete && obs.asset.naturalWidth > 0 && obs.asset.cached &&
          obs.asset.src === expectedSrc;
        if (p === 'grid-cache') ok = ok && obs.cacheBuilt === true && obs.cacheIsCanvas;
        if (p === 'portrait') ok = ok && obs.panelKey === u.expectedKey && obs.panelVisible;
        const screenshot = path.join(out, 'screenshots', checkpoint+'.png');
        const bytes = await page.screenshot({path:screenshot});
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (p === 'portrait') await page.evaluate(()=>{gameEvent.removeSelection();drawAll();});
        checkpoints.push({checkpoint, unit:u.cls, owner:u.owner, mirrorX:u.mirrorX, path:p,
          expectedKey:u.expectedKey, observedKey:obs.observedKey, observed:obs, screenshot:path.relative(root, screenshot),
          bytes:bytes.length, sha256, pass:!!ok});
        console.log(`${ok ? 'PASS' : 'FAIL'} ${checkpoint} expected=${u.expectedKey} observed=${obs.observedKey} `+
          `asset=${JSON.stringify(obs.asset)} screenshot=${path.relative(root, screenshot)} sha256=${sha256}`);
        if (!ok) {failed++; console.log(JSON.stringify(obs));}
      }
    }
    // Overview with everything drawn through the normal frame.
    await page.evaluate(()=>{gameEvent.removeSelection();grid.surfaceCache=null;drawAll();});
    const overview = path.join(out, 'screenshots', 'overview.png');
    const bytes = await page.screenshot({path:overview});
    checkpoints.push({checkpoint:'overview', expectedKey:null, observedKey:null,
      screenshot:path.relative(root, overview), bytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'), pass:true});
    console.log('page_errors='+errors.length+' '+JSON.stringify(errors));
    if (errors.length) {failed++; console.log('FAIL page errors');} else console.log('PASS zero page errors');
    fs.writeFileSync(path.join(out, 'render.json'), JSON.stringify({engine:'chromium', version:browser.version(),
      pass:failed === 0, pageErrors:errors, checkpoints}, null, 2)+'\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const seconds = ((Date.now()-started)/1000).toFixed(1);
  console.log(`wall_time_seconds=${seconds}`);
  assert.ok(Date.now()-started < 15*60*1000, 'wall time under 15 minutes');
  console.log(failed ? `FAIL ${failed} checkpoint(s)` : `PASS undead render: ${checkpoints.length-1} checkpoints (3 demon units x 3 paths + human control x 3 paths)`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {console.error(error); process.exitCode = 1;});
