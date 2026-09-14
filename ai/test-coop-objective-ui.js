const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex !== -1 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--')))
  throw new Error('--output-dir requires a directory');
const out = path.resolve(root, outputIndex === -1 ? 'artifacts/TASK-128' : process.argv[outputIndex + 1]);
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
  }, 120000);
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
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    // This offline render fixture uses no networking, downloads or learned AI.
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
      body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
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
    // Record actual canvas text calls while still drawing through the browser.
    await page.evaluate(()=>{
      window.painted=[];
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...args) {
        painted.push(String(text)); return fill.call(this,text,...args);
      };
    });
    const mountains=[];
    for(let x=14;x<19;x++) for(let y=0;y<9;y++)
      if(!(x===16&&y===6) && !(x===18&&y===8)) mountains.push({x,y});
    const base=[
      {id:'t1',kind:'town',name:'town',owner:1,x:3,y:2},
      {id:'u1',kind:'unit',name:'noob',owner:1,x:3,y:2},
      {id:'t2',kind:'town',name:'town',owner:2,x:9,y:2},
      {id:'u2',kind:'unit',name:'noob',owner:2,x:9,y:2},
      {id:'p',kind:'portal',name:'demonPortal',owner:3,x:16,y:6},
      {id:'d',kind:'unit',name:'noob',owner:3,x:18,y:8},
      ...mountains.map(({x,y})=>({id:`m${x}-${y}`,kind:'nature',name:'mountain',owner:0,x,y}))
    ];
    const f={context:{},evaluate(source) {
      if(!this.results.has(source)) throw {browserRead:source};
      return this.results.get(source);
    }};
    async function shared(fn) {
      f.results=new Map();
      for(;;) try {return fn();} catch(e) {
        if(!e.browserRead) throw e;
        const source=e.browserRead;
        f.results.set(source,await page.evaluate(({source,context})=>{
          Object.assign(window,context);return (0,eval)(source);
        },{source,context:f.context}));
      }
    }
    let entities,economy,turns,round,serial;
    async function launch(competitive=false) {
      await page.evaluate(({mountains,competitive})=>{
        const map=new GameMap({x:19,y:9},[
          {rgb:{r:208,g:208,b:208},towns:[],gold:0},
          {rgb:{r:255,g:0,b:0},towns:[{x:3,y:2}],gold:100},
          {rgb:{r:98,g:168,b:222},towns:[{x:9,y:2}],gold:100}
        ],[],[],mountains,[],[],{type:'rectangular'},competitive?null:{units:[{x:18,y:8}]});
        map.portals=[{x:16,y:6}];gameSlot=0;
        AiRuntime.trainFromHumanCommands=()=>{}; // No learned model in this UI fixture.
        GameManager.start(map,false,false,false);
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        window.fixtureConfig={actors:[{role:'neutral'},{role:'human'},{role:'human'},
          ...(competitive?[]:[{role:'demon'}])]};
        window.trace=[{type:'human',round:0,player:1}];
        const save=saveManager.save.bind(saveManager);
        saveManager.save=()=>{if(!gameExit) trace.push({type:'human',round:gameRound,player:whooseTurn});save()};
        if(!competitive) {
          const spawn=spawnCoopWave;
          spawnCoopWave=r=>{trace.push({type:'wave',round:gameRound});return spawn(r)};
          const play=players[3].play.bind(players[3]);
          players[3].play=()=>{trace.push({type:'demon',round:gameRound});play()};
        }
        const neutral=players[0].nextTurn.bind(players[0]);
        players[0].nextTurn=()=>{neutral();trace.push({type:'complete',round:gameRound-1})};
      },{mountains,competitive});
      round=0;serial=0;
      entities=await shared(()=>createEntityLedger(f,base.filter(r=>!competitive||r.owner!==3)));
      economy=createEconomyLedger(f,[{role:'neutral',gold:0},{role:'human',gold:100},
        {role:'human',gold:100},...(competitive?[]:[{role:'demon',gold:0}])],
        {income:{town:4,suburb:1},salary:{noob:1}});
      // Competitive hotseat defers opening economy; co-op refreshes immediately.
      if (!competitive) income(1);
      turns=createTurnLedger([1,2]);
      await check('launch');
    }
    function income(owner) {
      for(const [type,rule,count] of [['income','town',1],['income','suburb',7],['salary','noob',1]])
        economy.record({id:'e'+serial++,owner,type,rule,count});
    }
    // gameExit is consumed/reset by the animation loop; the visible menu is
    // the stable browser observation that gameplay has terminated.
    async function check(label,terminal=false,partial) {
      await shared(()=>entities.check(label+'-entities'));
      await shared(()=>economy.check(label+'-economy'));
      turns.check(label+'-turn',await page.evaluate(terminal=>({round:gameRound,terminal:menu.visible,
        events:terminal?trace.slice(0,-1):trace}),terminal),round,terminal,partial);
    }
    async function remove(id) {
      const row=base.find(r=>r.id===id);
      await page.evaluate(row=>{
        const e=row.kind==='unit'?grid.getUnit(row):grid.getBuilding(row);
        if(row.kind==='town')e.destroy();else e.kill();
      },row);
      entities.record({type:'death',id});
      await check('remove-'+id);
    }
    async function screenshot(label,result=null,terminal=false) {
      const observed=await page.evaluate(()=>{
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
        painted=[];if(menu.visible) menu.draw(interfaceCtx);else drawAll();
        return {lines:painted.filter(t=>t.startsWith('Co-op:')||t.startsWith('Round ')||t.startsWith('Shared ')),
          round:gameRound,result:(gameSettings.coop && gameSettings.coop.result)||null,terminal:menu.visible,menu:menu.visible,
          lost:players.slice(1,3).map(p=>p.isLost)};
      });
      const expected={lines:[],round,result,terminal,menu:terminal,
        lost:label.includes('defeat')||label.includes('draw')?[true,true]:
          label.includes('eliminated')||label.includes('survivor')||label.includes('victory')?[false,true]:[false,false]};
      await capture(label,expected,observed);
    }
    progress('objective and survivor round');
    await launch();
    await screenshot('objective');
    await remove('u2');await remove('t2');turns.eliminate(2,0);
    await screenshot('eliminated-human-continues');
    await page.evaluate(()=>nextTurn());round=1;income(1);
    await check('survivor-round');
    await screenshot('survivor-round');
    await remove('p');
    await screenshot('survivor-demons-remain');
    await remove('d');
    await page.evaluate(()=>nextTurn());await check('shared-victory',true);
    await screenshot('shared-victory','victory',true);
    for(const outcome of ['defeat','draw']) {
      // Reload so test instrumentation never accumulates between games.
      await page.reload({waitUntil:'load'});
      await page.waitForFunction(()=>menu.visible&&imagesCountLoaded===images.length);
      await page.evaluate(()=>{window.painted=[];const fill=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(t,...args){painted.push(String(t));return fill.call(this,t,...args)}});
      progress('shared-'+outcome);await launch();
      for(const id of ['u1','t1','u2','t2',...(outcome==='draw'?['p','d']:[])]) await remove(id);
      await page.evaluate(()=>nextTurn());await check('shared-'+outcome,true);
      await screenshot('shared-'+outcome,outcome,true);
    }
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>menu.visible&&imagesCountLoaded===images.length);
    await page.evaluate(()=>{window.painted=[];const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...args){painted.push(String(t));return fill.call(this,t,...args)}});
    progress('competitive regression');await launch(true);
    await screenshot('competitive-playing');
    for(const id of ['u1','t1','u2','t2']) await remove(id);
    // Existing competitive termination occurs on the neutral turn.
    await page.evaluate(()=>nextTurn());round=1;
    await shared(()=>entities.check('competitive-terminal-entities'));
    await shared(()=>economy.check('competitive-terminal-economy'));
    await capture('competitive-result-menu',{coop:false,terminal:true,menu:true,round:1},
      await page.evaluate(()=>({coop:!!gameSettings.coop,terminal:menu.visible,menu:menu.visible,round:gameRound})));
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({
      engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE online convergence: offline browser fixtures have no committed revisions. Blocked portals spawn zero units; trapped demon performs no combat. Purchases/production are absent; real human income/salary and every removal and co-op round are checked. Competitive neutral termination uses existing non-co-op scheduling outside the co-op phase ledger.');
    console.log('PASS co-op panels absent opening eliminated survivor remaining-demons victory defeat draw competitive checkpoints=9');
  } finally {
    progress('cleanup');
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
    clearTimeout(deadline);
    console.log('browser_run_elapsed_ms='+(Date.now()-started));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
