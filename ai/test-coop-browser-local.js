const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {expectedMap,initialEntities} = require('./test-coop-generation-fixtures');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts/TASK-054');
const compare = (label, observed, expected) => {
  console.log(JSON.stringify({scenario:label, expected, observed}));
  assert.deepEqual(observed, expected, label);
  console.log('PASS '+label);
};

(async () => {
  const started = Date.now();
  let stage = 'server startup';
  const progress = label => {
    stage = label;
    console.log(`browser_stage=${label} elapsed_ms=${Date.now()-started}`);
  };
  // Bound the whole run, including evaluation and cleanup, which Playwright's
  // per-operation timeouts do not cover. A hung browser must fail with context.
  const deadline = setTimeout(() => {
    console.error(`FAIL browser deadline stage=${stage} elapsed_ms=${Date.now()-started}`);
    process.exit(1);
  }, 240000);
  deadline.unref();
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
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      console.log(JSON.stringify({browserConsole:{type:m.type(),text:m.text()}}));
      if(m.type()==='error') errors.push(m.text());
    });
    // This offline render fixture uses no networking, downloads or learned AI.
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
    async function click(expression) {
      const pos=await page.evaluate(expression => {
        const control=(0,eval)(expression), rect=control.rect || control;
        return {x:rect.centerX,y:rect.centerY};
      },expression);
      await page.mouse.click(pos.x,pos.y);
    }
    async function capture(label, expected, observed) {
      compare(label+'-asserted-state',observed,expected);
      await page.evaluate(()=>{
        if(menu.visible) menu.draw(interfaceCtx);
        else {nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime(); drawAll();}
      });
      const screenshot=path.join(out,'screenshots',label+'.png');
      const bytes=await page.screenshot({path:screenshot});
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      checkpoints.push({checkpoint:label,screenshot,sha256,expected,observed,assertions:'passed'});
      console.log(`PASS browser-checkpoint ${label} screenshot=${screenshot} sha256=${sha256}`);
    }
    const f={context:{},evaluate(source) {
      if(!this.results.has(source)) throw {browserRead:source};
      return this.results.get(source);
    }};
    async function shared(fn) {
      f.results=new Map();
      for(;;) try {return fn();} catch(e) {
        if(!e.browserRead) throw e;
        f.results.set(e.browserRead,await page.evaluate(({source,context})=>{
          Object.assign(window,context);return (0,eval)(source);
        },{source:e.browserRead,context:f.context}));
      }
    }
    await page.evaluate(()=>{
      window.painted=[];
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...args){painted.push(String(t));return fill.call(this,t,...args)};
      AiRuntime.trainFromHumanCommands=()=>{};
      window.fixtureConfig={actors:[{role:'neutral'},{role:'human'},{role:'human'},{role:'demon'}]};
    });
    let entities,economy,turns=createTurnLedger([1,2]),round=0,prefix=1,serial=0;
    const actors=[{role:'neutral',gold:0},{role:'human',gold:100},{role:'human',gold:100},{role:'demon',gold:0}];
    const rules={income:{town:4,suburb:1},salary:{noob:1,archer:2},production:{noob:20}};
    function income(owner,archer=false) {
      for(const [type,rule,count] of [['income','town',1],['income','suburb',7],['salary','noob',1],...(archer?[['salary','archer',1]]:[])])
        economy.record({id:'e'+serial++,owner,type,rule,count});
    }
    async function check(label,extra={}) {
      progress(label);
      if(/attack|demon-phase|saved|reloaded/.test(label)) await page.evaluate(()=>gameEvent.screen.moveTo(grid.getHexagon({x:16,y:6}).pos));
      await shared(()=>entities.check(label+'-entities'));
      await shared(()=>economy.check(label+'-economy'));
      turns.check(label+'-turns',await page.evaluate(()=>({round:gameRound,terminal:menu.visible,events:trace})),round,false,prefix);
      const observed=await page.evaluate(()=>{
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();painted=[];drawAll();
        return {round:gameRound,human:whooseTurn,menu:menu.visible,online:gameSettings.isOnline,
          objective:painted.includes('Co-op: destroy all portals and demons'),roundLabel:painted.includes('Round '+gameRound)};
      });
      await capture(label,{round,human:prefix===2?2:1,menu:false,online:false,objective:true,roundLabel:true},observed);
      checkpoints.at(-1).game=await page.evaluate(()=>JSON.parse(JSON.stringify(getGameObject())));
      checkpoints.at(-1).entityExpectations=entities.expected();
      checkpoints.at(-1).balanceExpectations=economy.expected();
      checkpoints.at(-1).details=extra;
    }
    await click('menu.main.buttons[1]');
    await click('menu.coop.playButton');
    await click('menu.startCoopGame.buttons[0].movingForm.elements[0].rect');
    await page.waitForFunction(()=>!menu.visible&&whooseTurn===1);
    await page.evaluate(()=>{window.trace=[{type:'human',round:0,player:1}]});
    entities=await shared(()=>createEntityLedger(f,initialEntities(expectedMap(2,1))));
    economy=createEconomyLedger(f,actors,rules);income(1);
    await check('menu-launch');

    // A declared combat board makes action/economy expectations independent of
    // generator layout and AI choices. Real production dispatch/rendering runs.
    const mountains=[];
    for(let x=14;x<19;x++) for(let y=0;y<9;y++)
      if(![[14,6],[15,6],[16,6],[18,8]].some(([a,b])=>a===x&&b===y)) mountains.push({x,y});
    const rows=[{id:'t1',kind:'town',name:'town',owner:1,x:3,y:2},
      {id:'u1',kind:'unit',name:'noob',owner:1,x:3,y:2},
      {id:'t2',kind:'town',name:'town',owner:2,x:9,y:2},
      {id:'u2',kind:'unit',name:'noob',owner:2,x:9,y:2},
      {id:'archer',kind:'unit',name:'archer',owner:1,x:14,y:6},
      {id:'brute',kind:'unit',name:'brute',owner:3,x:16,y:6},
      {id:'portal',kind:'portal',name:'demonPortal',owner:3,x:18,y:8},
      ...mountains.map(({x,y})=>({id:`m${x}-${y}`,kind:'nature',name:'mountain',owner:0,x,y}))];
    await page.evaluate(({mountains,rows})=>{
      const map=new GameMap({x:19,y:9},[{rgb:{r:208,g:208,b:208},towns:[],gold:0},
        {rgb:{r:255,g:0,b:0},towns:[{x:3,y:2}],gold:100},
        {rgb:{r:98,g:168,b:222},towns:[{x:9,y:2}],gold:100}],[],[],mountains,[],[],{type:'rectangular'},{});
      map.portals=[{x:18,y:8}];gameSlot=0;GameManager.start(map,false,false,false);
      grid.getHexagon({x:14,y:6}).playerColor=1;new Archer(14,6);new Brute(16,6);
      for(const row of rows.filter(r=>r.kind==='unit'||r.kind==='portal'))
        (row.kind==='unit'?grid.getUnit(row):grid.getBuilding(row)).id=row.id;
      window.trace=[{type:'human',round:0,player:1}];
      const save=saveManager.save.bind(saveManager);
      window.recordHuman=false;
      saveManager.save=()=>{if(recordHuman)trace.push({type:'human',round:gameRound,player:whooseTurn});return save()};
      const spawn=spawnCoopWave;
      spawnCoopWave=r=>{trace.push({type:'wave',round:gameRound});return spawn(r)};
      const play=players[3].play.bind(players[3]);
      players[3].play=()=>{trace.push({type:'demon',round:gameRound});return play()};
      const neutral=players[0].nextTurn.bind(players[0]);
      players[0].nextTurn=()=>{neutral();trace.push({type:'complete',round:gameRound-1})};
    },{mountains,rows});
    entities=await shared(()=>createEntityLedger(f,rows));
    economy=createEconomyLedger(f,actors,rules);income(1);
    await check('fixture-ready');
    async function snapshot() {
      return page.evaluate(()=>JSON.parse(JSON.stringify({game:getGameObject(),
        cells:grid.arr.map(col=>col.map(c=>({unit:c.unit,building:c.building}))),
        units:players.flatMap(p=>p.units.filter(u=>!u.killed).map(u=>({id:u.id,hp:u.hp,moves:u.moves,wasHitted:u.wasHitted}))) })));
    }
    const beforeMove=await snapshot();
    compare('move-legal',await page.evaluate(()=>{
      const u=grid.getUnit({x:3,y:2});u.select();return u.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,{x:3,y:3}));
    }),true);
    await page.evaluate(()=>grid.getUnit({x:3,y:2}).sendInstructions(grid.getCell({x:3,y:3})));
    entities.record({type:'move',id:'u1',destination:{x:3,y:3}});
    await check('move');
    await click('undoButton');
    entities=await shared(()=>createEntityLedger(f,rows));
    compare('undo-exact-state',await snapshot(),beforeMove);
    await check('undo-move');

    await page.evaluate(()=>{gameEvent.removeSelection();const t=grid.getBuilding({x:3,y:2});t.select();gameEvent.selected=t;drawAll()});
    compare('purchase-ui-visible',await page.evaluate(()=>townInterface.visible),true);
    await click('townInterface.trainInterfaces.unit.noob.button');
    economy.record({id:'purchase',owner:1,type:'production',rule:'noob',count:1});
    compare('purchase-queue',await page.evaluate(()=>grid.getBuilding({x:3,y:2}).unitProduction.name),'noob');
    await check('buy-noob');
    await click('undoButton');
    economy.record({id:'refund',owner:1,type:'reversal',reverses:'purchase'});
    entities=await shared(()=>createEntityLedger(f,rows));
    compare('undo-purchase-exact-state',await snapshot(),beforeMove);
    await check('undo-purchase');

    const beforeAttack=await snapshot();
    compare('attack-demon-legal',await page.evaluate(()=>{const u=grid.getUnit({x:14,y:6});u.select();
      return u.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,{x:16,y:6}));}),true);
    await page.evaluate(()=>grid.getUnit({x:14,y:6}).sendInstructions(grid.getCell({x:16,y:6})));
    compare('attack-demon-damage',await page.evaluate(()=>({hp:grid.getUnit({x:16,y:6}).hp,moves:grid.getUnit({x:14,y:6}).moves})),{hp:8,moves:0});
    await check('attack-demon',{expectedHP:8});
    await click('undoButton');
    entities=await shared(()=>createEntityLedger(f,rows));
    compare('undo-attack-exact-state',await snapshot(),beforeAttack);
    await check('undo-attack');

    await page.evaluate(()=>{gameEvent.removeSelection();recordHuman=true});
    await click('nextTurnButton');prefix=2;income(2);
    await check('human-two');
    await click('nextTurnButton');round=1;prefix=6;income(1,true);
    entities.record({type:'move',id:'brute',destination:{x:15,y:6}});
    await check('demon-phase-complete');
    compare('phase-undo-cleared',await page.evaluate(()=>actionManager.arr.length),0);
    await page.evaluate(()=>{recordHuman=false;saveManager.save()});
    await check('saved');
    const saved=await snapshot();
    // Navigate the actual menu load slot after a full page reload: no in-memory
    // game objects survive. Persistence comes from browser localStorage.
    progress('page-reload');
    await page.reload({waitUntil:'load'});
    console.log('reload-state='+JSON.stringify(await page.evaluate(()=>({menu:menu.visible,loaded:imagesCountLoaded,total:images.length}))));
    await page.waitForFunction(()=>menu.visible&&imagesCountLoaded===images.length);
    await click('menu.main.buttons[5]');
    await click('menu.load.buttons[0].movingForm.elements[0].rect');
    await page.waitForFunction(()=>!menu.visible);
    await page.evaluate(trace=>{
      window.trace=trace;window.fixtureConfig={actors:[{role:'neutral'},{role:'human'},{role:'human'},{role:'demon'}]};
      window.painted=[];const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){painted.push(String(t));return fill.call(this,t,...a)};
    },turns.expected(1));
    entities=await shared(()=>createEntityLedger(f,rows.map(r=>r.id==='brute'?{...r,x:15,y:6}:r)));
    compare('save-reload-complete-state',await snapshot(),saved);
    await check('reloaded');
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE online convergence: local browser has no committed revisions. A single open corridor constrains the real brute AI to one move; the blocked portal spawns zero units. Purchased training is undone before production completes. Timer disabled; no learned AI or external network service used.');
    console.log('PASS browser-local menu move buy attack undo demon-phase save reload checkpoints='+checkpoints.length);
  } finally {
    progress('cleanup');console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));clearTimeout(deadline);
    console.log('browser_run_elapsed_ms='+(Date.now()-started));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
