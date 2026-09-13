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
const out = path.join(root, 'artifacts/TASK-033');
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
      window.demons=[new Imp(2,3),new Clawling(3,3),new Hound(4,3),new Brute(5,3),new Bulwark(6,3)];
      gameEvent.screen.moveTo({x:demons[2].pos.x+assets.size/2,y:demons[2].pos.y+assets.size/2+130});
      gameEvent.removeSelection();
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
      ['demon-unit','unit',3,7,5]].map(([id,kind,owner,x,y])=>
        ({id,kind,owner,x,y,name:kind==='unit'?'noob':kind==='portal'?'demonPortal':'town'}));
    ['imp','clawling','hound','brute','bulwark'].forEach((name,i)=>initial.push({id:name,kind:'unit',owner:3,x:i+2,y:3,name}));
    const entities=await shared(()=>createEntityLedger(f,initial));
    const economy=createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
    const turns=createTurnLedger([1,2]);
    const types=['imp','clawling','hound','brute','bulwark'];
    const names=['Imp','Clawling','Hound','Brute','Bulwark'];
    async function check(label, selected=null) {
      await shared(()=>entities.check(label+'-entities'));
      await shared(()=>economy.check(label+'-economy'));
      turns.check(label+'-turn',await page.evaluate(()=>({round:gameRound,terminal:gameExit,
        events:[{type:'human',round:gameRound,player:whooseTurn}]})),0);
      const observed=await page.evaluate(()=>({units:demons.map(d=>({type:d.name,
        configured: d.constructor.type, label:d.info.displayName, owner:d.info.info.owner,
        x:d.coord.x,y:d.coord.y,live:grid.getUnit(d.coord)===d})),
        selected:entityInterface.visible ? entityInterface.entity.name.text : null}));
      const expected={units:types.map((type,i)=>({type,configured:type,label:names[i],owner:'DEMONS',
        x:i+2,y:3,live:true})),selected};
      compare(label+'-asserted-state',observed,expected);
      const screenshot=path.join(out,'screenshots',label+'.png');
      const bytes=await page.screenshot({path:screenshot});
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      checkpoints.push({checkpoint:label,screenshot,sha256,expected,observed,assertions:'passed'});
      console.log(`PASS browser-checkpoint ${label} screenshot=${screenshot} sha256=${sha256}`);
    }
    // Observe production drawing calls and compare against literal type/name mapping.
    // Also render symbols without labels in real browser canvases: name-only
    // differentiation or a missing renderer fails the pixel checks.
    const mapping=await page.evaluate(()=>{
      const calls=[],labels=[], original=EarlyMeleeDemon.drawSymbol;
      EarlyMeleeDemon.drawSymbol=function(ctx,type,...args){calls.push(type);return original.call(this,ctx,type,...args);};
      try {
        for(const d of demons){
          const canvas=document.createElement('canvas');canvas.width=canvas.height=160;
          const ctx=canvas.getContext('2d');
          ctx.fillText=text=>labels.push(text);
          d.draw(ctx);
        }
      } finally {EarlyMeleeDemon.drawSymbol=original;}
      return {calls,labels};
    });
    compare('production-renderer-type-and-label-mapping',mapping,{calls:types,labels:names});
    const symbols=await page.evaluate(()=>demons.map(d=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=160;
      const ctx=canvas.getContext('2d');
      EarlyMeleeDemon.drawSymbol(ctx,d.name,80,80,150);
      const pixels=ctx.getImageData(0,0,160,160).data;
      return {type:d.name,ink:pixels.filter((v,i)=>i%4===3&&v>0).length,png:canvas.toDataURL()};
    }));
    for (const symbol of symbols) {
      compare(symbol.type+'-nonempty-symbol',symbol.ink>1000,true);
      console.log('symbol_pixels type='+symbol.type+' ink='+symbol.ink);
    }
    compare('distinct-silhouettes-without-labels',new Set(symbols.map(s=>s.png)).size,5);
    await check('all-five');
    for(let i=0;i<types.length;i++) {
      const portrait=await page.evaluate(i=>{
        const calls=[], original=EarlyMeleeDemon.drawSymbol;
        EarlyMeleeDemon.drawSymbol=function(ctx,type,...args){calls.push(type);return original.call(this,ctx,type,...args);};
        try {
          gameEvent.selectSomethingOnCell(grid.getCell(demons[i].coord));
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=900;
          entityInterface.drawContents(canvas.getContext('2d'));
        } finally {EarlyMeleeDemon.drawSymbol=original;}
        drawAll();
        return calls;
      },i);
      compare(types[i]+'-selection-portrait-mapping',portrait,[types[i]]);
      await check('selected-'+types[i],names[i]);
    }
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({
      engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('INAPPLICABLE online convergence and completed round/phase counts: offline rendering/selection fixture, no round advancement; unchanged round 0 and human 1 checked at all six checkpoints. No income or expense events.');
    console.log('PASS co-op early render types=5 distinct_symbols=5 checkpoints=6 invariant_checkpoints=6');
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
