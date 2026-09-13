const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts/TASK-032');
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

    // Replay each shared helper's synchronous runtime reads against this actual
    // browser. Assertions and independently declared ledgers remain in Node.
    const f = {context:{}, evaluate(source) {
      if (!this.results.has(source)) throw {browserRead:source};
      return this.results.get(source);
    }};
    async function shared(fn) {
      f.results=new Map();
      for (;;) {
        try {return fn();} catch(error) {
          if (!error.browserRead) throw error;
          const source=error.browserRead;
          const result=await page.evaluate(({source,context})=>{
            Object.assign(window,context); return (0,eval)(source);
          },{source,context:f.context});
          f.results.set(source,result);
        }
      }
    }
    const initial=[['neutral-town','town',0,4,5],['human-one-town','town',1,1,1],
      ['human-two-town','town',2,7,1],['human-one-unit','unit',1,2,2],
      ['human-one-garrison','unit',1,1,1],['human-two-garrison','unit',2,7,1],
      ['demon-unit','unit',3,7,5],['portal','portal',3,3,2]].map(([id,kind,owner,x,y])=>
        ({id,kind,owner,x,y,name:kind==='unit'?'noob':kind==='portal'?'demonPortal':'town'}));
    const entities=await shared(()=>createEntityLedger(f,initial));
    const economy=createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
    const turns=createTurnLedger([1,2]);
    async function check(label,hp) {
      await shared(()=>entities.check(label+'-entities'));
      await shared(()=>economy.check(label+'-economy'));
      turns.check(label+'-turn',await page.evaluate(()=>({round:gameRound,terminal:gameExit,
        events:[{type:'human',round:gameRound,player:whooseTurn}]})),0);
      const observed=await page.evaluate(()=>({hp:portal.hp, owner:portal.playerColor, role:portal.player.role,
        killed:portal.killed, live:external.filter(e=>e.isDemonPortal).length,
        empty:grid.getBuilding({x:3,y:2}).isEmpty(), selected:gameEvent.selected===portal,
        visible:entityInterface.visible, title:entityInterface.visible ? entityInterface.entity.name.text : null,
        info:entityInterface.visible ? entityInterface.entity.info.text : null,
        green:portal.hpBar.rects.filter(r=>r.color===portal.hpBar.healthColor).length,
        cached:grid.surfaceCacheBuildings.includes(portal)}));
      const expected={hp,owner:3,role:'DEMONS',killed:hp===0,live:hp ? 1 : 0,empty:hp===0,
        selected:hp>0,visible:hp>0,title:hp?'Demon Portal':null,
        info:hp?`hp: ${hp} / 30\nowner: DEMONS`:null,green:hp,cached:hp>0};
      compare(label+'-asserted-state',observed,expected);
      const screenshot=path.join(out,'screenshots',label+'.png');
      const bytes=await page.screenshot({path:screenshot});
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      checkpoints.push({checkpoint:label,screenshot,sha256,expected,observed,assertions:'passed'});
      console.log(`PASS browser-checkpoint ${label} screenshot=${screenshot} sha256=${sha256}`);
    }
    await check('undamaged',30);
    console.log('ACTION portal.hit(13): selected portal damage; no economic event');
    await page.evaluate(()=>{portal.hit(13);drawAll();});
    await check('damaged',17);
    console.log('ACTION portal.hit(17): selected portal destruction; declared portal death');
    await page.evaluate(()=>{portal.hit(17);drawAll();});
    entities.record({type:'death',id:'portal'});
    await check('destroyed',0);
    compare('distinct-browser-captures',new Set(checkpoints.map(c=>c.sha256)).size,3);
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({
      engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE online convergence and completed round/phase counts: offline damage/selection fixture, no round advancement; unchanged round 0 and human 1 checked at every checkpoint. No income or expense events.');
    console.log('PASS co-op portal render checkpoints=3 invariant_checkpoints=3');
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
