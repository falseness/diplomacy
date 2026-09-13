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
const out = path.join(root, 'artifacts/TASK-039');
const compare = (label, observed, expected) => {
  console.log(JSON.stringify({scenario:label, expected, observed}));
  assert.deepEqual(observed, expected, label);
  console.log('PASS '+label);
};

const serverRoot = path.resolve(root, '../diplomacy_server');
const {createRequire} = require('module');
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
const runtime = serverRequire('./server/loadGameCode');
const {getMatchmakingKey} = serverRequire('./server/matchmakingKey');
const slots = serverRequire('./server/matchmakingSlots');
const {getPlayersParallelOrder} = serverRequire('./server/getPlayersParallelOrder');
const {getLobbyStatus,joinLobby} = serverRequire('./server/lobbyStatus');
const source = fs.readFileSync(path.join(serverRoot,'server/index.js'),'utf8');
const section = (start,end) => source.slice(source.indexOf(start),source.indexOf(end));
function harness() {
    const games=[],users=[],active=new Set(),initialBoards=new Map();
    const matches=(row,q)=>Object.entries(q).every(([key,value])=>row[key]===value);
    const collection=rows=>({
        async findOne(q){return structuredClone(rows.find(r=>matches(r,q))||null)},
        find(){return {sort(){return {async *[Symbol.asyncIterator](){for(const row of [...rows].reverse())yield structuredClone(row)}}}}},
        async insertOne(row){rows.push({_id:crypto.randomUUID(),...structuredClone(row)})},
        async deleteOne(q){const i=rows.findIndex(r=>matches(r,q));if(i>=0)rows.splice(i,1)},
        async updateOne(q,u){Object.assign(rows.find(r=>matches(r,q)),structuredClone(u.$set))}
    });
    const dependencies={assert,crypto,getMatchmakingKey,...slots,getPlayersParallelOrder,
        db:{collection:name=>collection(name==='games'?games:users)},GameStatus:{JUST_STARTED:'started',IN_PROGRESS:'joined'},
        getActiveSocketCount:(_,user)=>active.has(user)?1:0};
    // Real production creation, scheduling, stale-slot selection and matchmaking;
    // only persistence and socket presence are replaced with isolated memory stores.
    const code=section('function playerHasSubmittedTurn(', 'async function loadGameWithCurrentRound(')+
        section('async function getOrCreateGame(', 'function advanceAutomatedComponent(');
    const automated=source.slice(source.indexOf('function advanceAutomatedComponent('),source.indexOf('\nfunction ',source.indexOf('function advanceAutomatedComponent(')+10));
    const api=new Function(...Object.keys(dependencies),code+automated+'\nreturn {getOrCreateGame,findLowestEligibleStalePlayerIndex};')(...Object.values(dependencies));
    return {...api,games,users,active};
}
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
  const h = harness(), requests = [], protocolErrors = [];
  let queue = Promise.resolve();
  io.on('connection', socket => socket.on('startGameOrConnect', body => {
    queue = queue.then(async () => {
      const request = JSON.parse(body);
      requests.push(request);
      const [id,slot] = await h.getOrCreateGame(request.password,request.game);
      h.active.add(request.password);
      const game = h.games.find(g=>g.gameID===id);
      joinLobby(socket,io,id,game);
      // Exercise the production client receive handler with the stored initial
      // board. Gameplay/turn preparation is outside this lobby-only fixture.
      socket.emit('waitYouTurn',JSON.stringify({...game.rounds[0][0].parallelTurnResult,whooseTurn:slot}));
    }).catch(error=>{protocolErrors.push(error.stack);console.error(error);});
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
            path.join(path.dirname(serverRequire.resolve('socket.io/package.json')),'client-dist/socket.io.js'))});
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
      await click('menu.main.buttons[2]');
      if(coop) {
        await click('menu.online.modeButton');
        await click('menu.online.playersSlider.leftButton');
        for(let i=2;i<count;i++)await click('menu.online.playersSlider.rightButton');
        if(count===4)await click('menu.online.playersSlider.rightButton');
        // Switching modes and returning retains each mode's controls.
        await click('menu.online.modeButton');
        await click('menu.online.modeButton');
      }
      for(const digit of password)await click(`menu.online.passwordButtons[${digit}]`);
      const mode=coop?'coop':'competitive';
      await capture(`settings-${password}`,{mode,humans:count,password},await page.evaluate(()=>({
        mode:menu.online.isCoop?'coop':'competitive',humans:menu.online.isCoop?menu.online.playersSlider.value:menu.online.playersSlider.value+2,
        password:menu.online.currentPassword})));
      await click('menu.online.playButton');
      await click('menu.startGame.buttons[0].movingForm.elements[0].rect');
      await page.waitForFunction(()=>onlineLobby?.occupiedHumans>0 && !menu.visible && gameEvent.waitingMode);
      await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
      const req=requests.find(r=>r.password===password);
      assert.ok(req,'browser request received');
      compare('creation-metadata-'+password,{online:req.game.gameSettings.isOnline,
        count:req.game.gameSettings.coop?.initialHumanCount || req.game.players.length-1,
        mode:req.game.gameSettings.coop?'coop':'competitive',slots:req.game.gameSettings.coop?.humanSlots || [1,2]},
        {online:true,count,mode,slots:Array.from({length:count},(_,i)=>i+1)});
      if(coop) {
        compare('creation-seed-'+password,req.game.gameSettings.coop.generation,expectedMap(count,1).coop.generation);
        compare('creation-roles-'+password,await page.evaluate(()=>players.map(p=>p.role)),['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS']);
        await checkInvariants(page,count,password);
      }
      return page;
    }
    async function checkInvariants(target,count,label) {
      await target.evaluate(count=>{window.fixtureConfig={actors:[{role:'neutral'},...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};},count);
      const f={context:{},evaluate(source){if(!this.results.has(source))throw {browserRead:source};return this.results.get(source);}};
      async function shared(fn) {
        f.results=new Map();
        for(;;)try{return fn();}catch(error){
          if(!error.browserRead)throw error;
          f.results.set(error.browserRead,await target.evaluate(({source,context})=>{
            Object.assign(window,context);return (0,eval)(source);
          },{source:error.browserRead,context:f.context}));
        }
      }
      const entities=await shared(()=>createEntityLedger(f,initialEntities(expectedMap(count,1))));
      await shared(()=>entities.check(label+'-entities'));
      const economy=createEconomyLedger(f,[{role:'neutral',gold:0},...Array.from({length:count},()=>({role:'human',gold:100})),{role:'demon',gold:0}],{});
      await shared(()=>economy.check(label+'-economy'));
      createTurnLedger(Array.from({length:count},(_,i)=>i+1)).check(label+'-turns',
        await target.evaluate(()=>({round:gameRound,terminal:gameExit,events:[]})),0,false,0);
    }
    for(const count of [2,3,4]) {
      console.log('browser_stage=human-count-'+count);
      const peers=[];
      for(let joined=1;joined<=count;joined++) {
        peers.push(await launch(count,`${count}${joined}`));
        for(const [index,peer] of peers.entries()) {
          page=peer;
          await page.waitForFunction(n=>onlineLobby.occupiedHumans===n,joined);
          const status={mode:'coop',humanCapacity:count,occupiedHumans:joined};
          await capture(`lobby-${count}-${joined}-peer-${index+1}`,{status,
            text:`Co-op — Humans: ${joined}/${count} — ${joined===count?'Full':'Waiting for players'}`},
            await page.evaluate(()=>({status:onlineLobby,text:onlineLobbyText()})));
          await checkInvariants(page,count,`lobby-${count}-${joined}-${index+1}`);
        }
      }
      const fullGame=h.games.find(g=>g.playerIndexToUserIndex.includes(`${count}1`));
      // Even a corrupt occupied controller cannot change human occupancy.
      compare('full-human-only-'+count,getLobbyStatus({...fullGame,
        playerIndexToUserIndex:fullGame.playerIndexToUserIndex.map((v,i)=>i===count+1?'controller':v)}),
        {mode:'coop',humanCapacity:count,occupiedHumans:count});
      const overflow=await launch(count,`${count}9`);
      compare('full-lobby-overflow-'+count,await overflow.evaluate(()=>onlineLobby),
        {mode:'coop',humanCapacity:count,occupiedHumans:1});
      for(const peer of peers)compare('full-lobby-stays-full-'+count,await peer.evaluate(()=>onlineLobby.occupiedHumans),count);
      if(count===2) {
        const competitive=await launch(2,'88',false);
        await capture('competitive-lobby',{status:{mode:'competitive',humanCapacity:2,occupiedHumans:1},text:'Competitive — Humans: 1/2 — Waiting for players'},
          await competitive.evaluate(()=>({status:onlineLobby,text:onlineLobbyText()})));
        compare('mode-isolation',h.games.length,3);
        await competitive.close();
      }
      await overflow.close();
      for(const peer of peers)await peer.close();
    }
    compare('server-handler-wiring',source.includes('joinLobby(socket, io, gameID, game)'),true);
    const calls=[];
    const testSocket={data:{lobbyRoom:'lobby_old'},leave:r=>calls.push(['leave',r]),join:r=>calls.push(['join',r])};
    const testIo={to:r=>({emit:(name,status)=>calls.push(['emit',r,name,status])})};
    joinLobby(testSocket,testIo,'new',h.games[0]);
    compare('room-switch',calls,[['leave','lobby_old'],['join','lobby_new'],
      ['emit','lobby_new','lobbyStatus',{mode:'coop',humanCapacity:2,occupiedHumans:2}]]);
    compare('protocol-errors',protocolErrors,[]);
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE committed revision convergence: matchmaking has no revision protocol. Stored initial boards use real client deserialization and shared entity/economy/turn invariants after every lobby operation. No gameplay actions, completed rounds, wave/demon phases, income, salaries, purchases, production or undo occur; initial phase prefix is empty. Test transport serves initial waiting snapshots; full gameplay server handlers are outside this lobby fixture.');
    console.log(`PASS online-lobby humans=2,3,4 full-lobbies=3 overflow=3 competitive-isolation=passed checkpoints=${checkpoints.length}`);
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser)await browser.close();
    await new Promise(resolve=>io.close(resolve));
    clearTimeout(deadline);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
