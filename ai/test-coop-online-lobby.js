const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const out = outputIndex < 0 ? (process.env.COOP_LOBBY_EVIDENCE_DIR || path.join(root, 'artifacts/TASK-083')) : path.resolve(process.argv[outputIndex + 1]);
const {checkSizeLayout} = require('./test-coop-size-controls');
const sizeFor = count => ({2:'tiny',5:'normal',12:'big'}[count]);
const compare = (label, observed, expected) => {
  console.log(JSON.stringify({scenario:label, expected, observed}));
  assert.deepEqual(observed, expected, label);
  console.log('PASS '+label);
};

const serverRoot = path.resolve(root, '../diplomacy_server');
const {createRequire} = require('module');
const serverRequire = createRequire(path.join(serverRoot, 'server/package.json'));
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
  }, 300000);
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
  const io = serverRequire('socket.io')(server);
  // TASK-083 checks the actual client request over Socket.IO. Server validation,
  // matching and gameplay belong to TASK-088; the prior integration fixture is
  // preserved in test-coop-online-matchmaking.js.
  const requests = [];
  io.on('connection', socket => socket.on('startGameOrConnect', body => {
    requests.push(JSON.parse(body));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], checkpoints = [];
  try {
    browser = await chromium.launch({headless:true});
    console.log('browser_engine=chromium browser_version='+browser.version());
    let page = await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    async function prepare(page) {
      page.setDefaultTimeout(30000);
      page.on('pageerror', e=>errors.push(e.message));
      page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
      await page.addInitScript(endpoint=>{window.DIPLOMACY_SERVER=endpoint;},`http://127.0.0.1:${server.address().port}`);
      await page.route('https://**/*', async route => {
        if(route.request().url().includes('socket.io')) {
          return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(
            path.join(path.dirname(serverRequire.resolve('socket.io')),'../client-dist/socket.io.js'))});
        }
        return route.fulfill({contentType:'application/javascript',body:route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
      await page.waitForFunction(()=>menu.visible && imagesCountLoaded===images.length);
    }
    await page.close();
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
    async function launch(count, password, coop=true) {
      page = await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
      await prepare(page);
      await click('menu.main.buttons[1]');
      if(coop) {
        await click('menu.online.modeButton');
        compare('new-size-default-'+password,await page.evaluate(()=>menu.online.sizeSlider.realValue),'Normal');
        const size=sizeFor(count);
        if(size!=='normal')await click('menu.online.sizeSlider.'+(size==='tiny'?'leftButton':'rightButton'));
        await click('menu.online.playersSlider.leftButton');
        for(let i=2;i<count;i++)await click('menu.online.playersSlider.rightButton');
        if(count===12)await click('menu.online.playersSlider.rightButton');
        // Switching modes and returning retains each mode's controls.
        await click('menu.online.modeButton');
        await click('menu.online.modeButton');
      }
      await click('menu.online.backButton');
      await click('menu.main.buttons[1]');
      if(coop) {
        compare('retained-size-'+password,await page.evaluate(()=>menu.online.sizeSlider.realValue.toLowerCase()),sizeFor(count));
        await checkSizeLayout(page,'online',compare);
      }
      for(const digit of password)await click(`menu.online.passwordButtons[${digit}]`);
      const mode=coop?'coop':'competitive';
      await capture(`settings-${password}`,{mode,humans:count,password},await page.evaluate(()=>({
        mode:menu.online.isCoop?'coop':'competitive',humans:menu.online.isCoop?menu.online.playersSlider.value:menu.online.playersSlider.value+2,
        password:menu.online.currentPassword})));
      await click('menu.online.playButton');
      await click('menu.startGame.buttons[0].movingForm.elements[0].rect');
      await page.waitForFunction(()=>!menu.visible);
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('request capture deadline'));},10000);
        const poll=setInterval(()=>{if(requests.some(r=>r.password===password)){clearInterval(poll);clearTimeout(timeout);resolve();}},10);
      });
      await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
      const req=requests.find(r=>r.password===password);
      assert.ok(req,'browser request received');
      compare('creation-metadata-'+password,{online:req.game.gameSettings.isOnline,
        count:req.game.gameSettings.coop?.initialHumanCount || req.game.players.length-1,
        mode:req.game.gameSettings.coop?'coop':'competitive',slots:req.game.gameSettings.coop?.humanSlots || [1,2]},
        {online:true,count,mode,slots:Array.from({length:count},(_,i)=>i+1)});
      if(coop) {
        compare('requested-size-'+password,req.game.gameSettings.coop.generation.size,sizeFor(count));
        compare('requested-grid-'+password,[req.game.grid.length,...new Set(req.game.grid.map(c=>c.length))],Array(2).fill(Math.max({tiny:11,normal:15,big:21}[sizeFor(count)],Math.ceil({tiny:15,normal:25,big:39}[sizeFor(count)]*Math.sqrt(count/4)))));
        compare('creation-seed-'+password,req.game.gameSettings.coop.generation,{version:4,playerCount:count,seed:1,size:sizeFor(count),options:{seed:1,size:sizeFor(count)}});
        compare('creation-roles-'+password,await page.evaluate(()=>players.map(p=>p.role)),['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS']);
      }
      if(coop && count===12) {
        await page.evaluate(()=>statisticsInterface.show());
        await capture('online-roster-12',{roles:['NEUTRAL',...Array(12).fill('HUMAN'),'DEMONS'],inside:true},
          await page.evaluate(()=>({roles:players.map(p=>p.role),inside:statisticsInterface.playersInfo.every(p=>p.rect.bottom<=HEIGHT)})));
      }
      return page;
    }
    for(const count of [2,5,12]) {
      const peer=await launch(count,`${count}1`);
      await peer.close();
    }
    const competitive=await launch(2,'88',false);
    compare('competitive-request-no-coop',!!requests.find(r=>r.password==='88').game.gameSettings.coop,false);
    await competitive.close();
    page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    await prepare(page);
    await click('menu.main.buttons[1]');
    await click('menu.online.modeButton');
    for(let i=2;i<12;i++)await click('menu.online.playersSlider.rightButton');
    await click('menu.online.sizeSlider.leftButton');
    for(const size of ['tiny','normal','big']) {
      await checkSizeLayout(page,'online',compare);
      await capture('online-mobile-'+size,size,await page.evaluate(()=>menu.online.sizeSlider.realValue.toLowerCase()));
      await click('menu.online.sizeSlider.rightButton');
    }
    await page.close();
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'online-browser-checkpoints.json'),JSON.stringify({engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    fs.writeFileSync(path.join(out,'online-requests.json'),JSON.stringify(requests,null,2)+'\n');
    console.log('INAPPLICABLE server acceptance/matching/authoritative gameplay: TASK-088. Actual client generation, serialization and Socket.IO submission are exercised here.');
    console.log(`PASS online-lobby sizes=tiny,normal,big requests=4 competitive=passed checkpoints=${checkpoints.length}`);
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser)await browser.close();
    await new Promise(resolve=>io.close(resolve));
    clearTimeout(deadline);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
