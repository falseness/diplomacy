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
const outputIndex = process.argv.indexOf('--output-dir');
const out = outputIndex < 0 ? path.join(root, 'artifacts/TASK-081') : path.resolve(process.argv[outputIndex + 1]);
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
    for (const count of [1,4]) {
      progress('co-op-'+count);
      if(count===4) {
        await page.reload({waitUntil:'load'});
        await page.waitForFunction(()=>menu.visible && imagesCountLoaded===images.length);
      }
      await page.evaluate(()=>{
        window.generationCalls=[]; window.startCalls=[];
        const generate=generateCoopGame, start=GameManager.start;
        generateCoopGame=function(count, options) {
          const map=generate(count,options);
          generationCalls.push({count,options,map:JSON.parse(JSON.stringify(map))});
          return map;
        };
        GameManager.start=function(map,fog,timer,online,password) {
          startCalls.push({fog,timer,online});
          return start.call(this,map,fog,timer,online,password);
        };
      });
      await click('menu.main.buttons[0]');
      await click('menu.play.modeButton');
      compare('hotseat-mode-'+count, await page.evaluate(()=>({label:menu.play.modeButton.text.text,
        onlineLabel:menu.online.modeButton.text.text,buttons:menu.play.buttons.length,
        unique:new Set(menu.play.buttons).size})), {label:'Co-op',onlineLabel:'Competitive',buttons:7,unique:7});
      // Lower bound cannot decrement below one; upper bound cannot exceed four.
      await click('menu.play.playersSlider.leftButton');
      if(count===4) for(let i=0;i<3;i++) await click('menu.play.playersSlider.rightButton');
      if(count===4) {
        await click('menu.play.mapSlider.rightButton');
        await click('menu.play.fogOfWarCheckBox');
        await click('menu.play.timerCheckBox');
      }
      compare('human-label-spacing-'+count,await page.evaluate(()=> {
        const label=menu.play.playersText; mainCtx.save();
        mainCtx.font=label.fontSize+'px Arial';
        const right=label.x+mainCtx.measureText(label.text).width; mainCtx.restore();
        return right < menu.play.playersSlider.leftButton.x;
      }),true);
      await click(count===1?'menu.play.playersSlider.leftButton':'menu.play.playersSlider.rightButton');
      const seed=count===1?1:2, enabled=count===4;
      // Separate map/player selections survive repeated mode changes and Back.
      for(let toggle=0;toggle<2;toggle++) {
        await click('menu.play.modeButton');
        compare('competitive-restored-'+count+'-'+toggle,await page.evaluate(()=>({
          players:menu.play.playersSlider.value,map:menu.play.mapSlider.value,
          sameMap:menu.play.selectedMap===maps[menu.play.mapSlider.realValue][0],
          fog:menu.play.isFogOfWar,timer:menu.play.isDynamicTimer})),
          {players:0,map:0,sameMap:true,fog:enabled,timer:enabled});
        await click('menu.play.playersSlider.rightButton');
        await click('menu.play.playersSlider.leftButton');
        await click('menu.play.mapSlider.rightButton');
        await click('menu.play.mapSlider.leftButton');
        await click('menu.play.modeButton');
      }
      await click('menu.play.backButton');
      compare('hotseat-back-main-'+count,await page.evaluate(()=>menu.selectedTree===menu.main),true);
      await click('menu.main.buttons[0]');
      await capture('settings-'+count,{humans:count,seed,fog:enabled,timer:enabled},
        await page.evaluate(()=>({humans:menu.play.playersSlider.value,seed:menu.play.mapSlider.value,
          fog:menu.play.isFogOfWar,timer:menu.play.isDynamicTimer})));
      // Exercise slot Back and return: co-op settings and options survive.
      await click('menu.play.playButton');
      await click('menu.startGame.buttons[1]');
      compare('slot-back-'+count,await page.evaluate(()=>menu.selectedTree===menu.play),true);
      await click('menu.play.playButton');
      await click('menu.startGame.buttons[0].movingForm.elements['+(count===1?0:1)+'].rect');
      compare('selected-slot-'+count,await page.evaluate(()=>gameSlot),count===1?0:1);
      await page.waitForFunction(()=>!menu.visible && whooseTurn===1);
      const expected=expectedMap(count,seed);
      compare('generateCoopGame-'+count,await page.evaluate(()=>generationCalls),[{count,options:{seed},map:expected}]);
      compare('launch-options-'+count,await page.evaluate(()=>startCalls),[{fog:enabled,timer:enabled,online:false}]);
      await page.evaluate(count=>{window.fixtureConfig={actors:[{role:'neutral'},
        ...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};},count);
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

      const entities=await shared(()=>createEntityLedger(f,initialEntities(expected)));
      const economy=createEconomyLedger(f,[{role:'neutral',gold:0},
        ...Array.from({length:count},()=>({role:'human',gold:100})),{role:'demon',gold:0}],
        {income:{town:4,suburb:1},salary:{noob:1}});
      economy.record({id:'first-town-income',type:'income',owner:1,rule:'town',count:1});
      economy.record({id:'first-suburb-income',type:'income',owner:1,rule:'suburb',count:7});
      economy.record({id:'first-unit-salary',type:'salary',owner:1,rule:'noob',count:1});
      await shared(()=>entities.check('launched-'+count+'-entities'));
      await shared(()=>economy.check('launched-'+count+'-economy'));
      const turns=createTurnLedger(Array.from({length:count},(_,i)=>i+1));
      turns.check('launched-'+count+'-turn',await page.evaluate(()=>({round:gameRound,terminal:gameExit,
        events:[{type:'human',round:gameRound,player:whooseTurn}]})),0);
      await capture('launched-'+count,{coop:{...expected.coop,result:null},roles:['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS'],
        fog:enabled,timer:enabled?'Timer':'LongTimer',online:false,round:0,human:1,menu:false},
        await page.evaluate(()=>({coop:gameSettings.coop,roles:players.map(p=>p.role),fog:isFogOfWar,
          timer:timer.constructor.name,online:gameSettings.isOnline,round:gameRound,human:whooseTurn,menu:menu.visible})));
      // Cancel another setup, then resume the saved game through its selected slot.
      const before=await page.evaluate(()=>({round:gameRound,human:whooseTurn,coop:gameSettings.coop,
        roles:players.map(p=>p.role),gold:players.map(p=>p.gold),slot:gameSlot}));
      await page.evaluate(()=>menuBack());
      await click('menu.main.buttons[0]');
      await click('menu.play.modeButton');
      await click('menu.play.playButton');
      await click('menu.startGame.buttons[1]');
      await click('menu.play.backButton');
      compare('cancel-no-launch-'+count,await page.evaluate(()=>startCalls.length),1);
      await click('menu.main.buttons[4]');
      await click('menu.load.buttons[0].movingForm.elements['+(count===1?0:1)+'].rect');
      await page.waitForFunction(()=>!menu.visible);
      compare('resume-saved-mode-'+count,await page.evaluate(()=>({round:gameRound,human:whooseTurn,
        coop:gameSettings.coop,roles:players.map(p=>p.role),gold:players.map(p=>p.gold),slot:gameSlot})),before);
    }
    progress('competitive-menu-reload');
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>menu.visible && imagesCountLoaded===images.length);
    await capture('main-menu',{labels:['hot seat','play online','play AI','settings','load game'],visible:true},
      await page.evaluate(()=>({labels:menu.main.buttons.map(b=>b.text.text),
        visible:menu.main.buttons.every(b=>b.y>=0 && b.bottom<=HEIGHT)})));
    await click('menu.main.buttons[0]');
    await capture('competitive-settings',{mode:'Competitive',players:'2',map:0,fog:false,timer:false},
      await page.evaluate(()=>({mode:menu.play.modeButton.text.text,players:menu.play.playersSlider.realValue,
        map:menu.play.mapSlider.value,fog:menu.play.isFogOfWar,timer:menu.play.isDynamicTimer})));
    progress('competitive-launch');
    await click('menu.play.playButton');
    await click('menu.startGame.buttons[0].movingForm.elements[0].rect');
    await page.waitForFunction(()=>!menu.visible && whooseTurn===1);
    await capture('competitive-launch',{coop:false,roles:['NEUTRAL','HUMAN','HUMAN'],online:false},
      await page.evaluate(()=>({coop:!!gameSettings.coop,roles:players.map(p=>p.role),online:gameSettings.isOnline})));
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({
      engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE online convergence and completed rounds: local launch only; first human income/salary and round 0 checked. Menu clicks do not mutate game entities. Competitive launch is a menu regression outside co-op ledgers.');
    console.log('PASS co-op local menu minimum=1 maximum=4 generation_calls=2 checkpoints='+checkpoints.length+' competitive_launch=passed');
  } finally {
    progress('cleanup');
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
    clearTimeout(deadline);
    console.log('browser_run_elapsed_ms='+(Date.now()-started));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
