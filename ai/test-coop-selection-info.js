const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const {defaultFixture} = require('./test-coop-harness');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const out = path.resolve(root, outputIndex < 0 ? 'artifacts/TASK-112' : process.argv[outputIndex+1], 'selection');
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
      for (let x=2;x<=6;x++) for(let y=3;y<=4;y++) grid.getHexagon({x,y}).repaint(3,false);
      window.demons=[new Imp(2,3),new Clawling(3,3),new Hound(4,3),new Brute(5,3),new Bulwark(6,3),
        new Spitter(2,4),new EmberArcher(3,4),new Hexcaster(4,4),new Ravager(5,4),new DemonLord(6,4)];
      gameEvent.screen.moveTo({x:demons[2].pos.x+assets.size/2,y:demons[2].pos.y+assets.size/2+130});
      gameEvent.removeSelection();
      drawAll();
    }, config);

    // Independent expected panel lines: enemy moves and attack range were never
    // selection rows. Literal TASK-108 version-2 stats; do not derive expectations
    // from the rendered object or the production stat table.
    const cases = [
      ['imp','imp',1,1], ['clawling','clawling',2,1], ['hound','hound',2,1],
      ['brute','brute',5,2], ['bulwark','bulwark',8,1], ['spitter','spitter',1,1],
      ['emberArcher','ember archer',2,1], ['hexcaster','hexcaster',3,2],
      ['ravager','ravager',4,3], ['demonLord','demon lord',10,3]
    ].map(([type,title,hp,dmg],i)=>({type,title,i,owner:3,role:'DEMONS',
      lines:[title,`hp: ${hp} / ${hp}`,`dmg: ${dmg}`]}));
    await page.evaluate(()=>{window.portal=new DemonPortal(3,2);});
    cases.push({type:'portal',title:'demon portal',owner:3,role:'DEMONS',
      lines:['demon portal','hp: 30 / 30']});
    cases.push({type:'human',title:'noob',owner:1,role:'HUMAN',
      lines:['noob','hp: 2 / 2','dmg: 1','moves: 2 / 2','salary: 1','skip moves']});
    cases.push({type:'human-zero',title:'noob',owner:1,role:'HUMAN',
      lines:['noob','hp: 2 / 2','dmg: 1','moves: 2 / 2','salary: 0','skip moves']});
    let before = await page.evaluate(()=>JSON.stringify(getGameObject()));
    for (const phase of ['before', 'damaged', 'reloaded']) {
      if (phase === 'reloaded') await page.evaluate(saved=>{
        loadFromJson(saved);
        window.demons=players[3].units.filter(u=>u.constructor.type);
        window.portal=external.find(e=>e.isDemonPortal);
        nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
      },before);
      compare(phase+'-serialized-state',await page.evaluate(()=>JSON.stringify(getGameObject())),before);
      compare(phase+'-demon-salaries',await page.evaluate(()=>demons.map(u=>u.salary)),Array(10).fill(0));
      for (const base of cases) {
        const damaged = phase !== 'before' && base.i !== undefined;
        const scenario = {...base, damage:phase === 'damaged' && damaged,
          lines:base.lines.map((line, i) => damaged && i === 1
            ? `hp: ${Number(line.split(' ')[1]) - 0.5} / ${line.split(' / ')[1]}` : line)};
        const observed = await page.evaluate(({type,i,damage})=>{
          const selected=type==='portal' ? portal : type.startsWith('human') ? grid.getUnit({x:2,y:2}) : demons[i];
          // Fixture-only own getter exercises a zero-salary human without changing class rules.
          if (type==='human-zero') Object.defineProperty(selected,'salary',{value:0,configurable:true});
          gameEvent.selectSomethingOnCell(grid.getCell(selected.coord));
          if (damage) {
            // Fractional fixture damage keeps the one-HP Imp/Spitter alive.
            selected.hit(0.5);
            selected.select(); // Normal selection refresh after health changes.
          }
          // Capture text sent to the actual visible panel's canvas render cache,
          // forwarding every draw unchanged. This inspects rendering, not just info.
          const lines=[], original=CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText=function(text,...args) {
            lines.push(String(text));return original.call(this,text,...args);
          };
          try { entityInterface.renderCacheDirty=true; entityInterface.createRenderCache(); }
          finally { CanvasRenderingContext2D.prototype.fillText=original; }
          drawAll();
          const panelInfo=selected.info.info;
          if (type==='human-zero') delete selected.salary;
          return {panelInfo,visible:entityInterface.visible,selected:gameEvent.selected===selected,
            title:entityInterface.entity.name.text,lines,owner:selected.playerColor,
            role:selected.player.role,registered:type==='portal' ? external.includes(selected) : selected.player.units.includes(selected)};
        },scenario);
        const panelInfo={hp:scenario.lines[1].slice(4)};
        if (scenario.type!=='portal') panelInfo.dmg=Number(scenario.lines[2].slice(5));
        if (scenario.type.startsWith('human')) {
          panelInfo.moves='2 / 2'; panelInfo.salary=scenario.type==='human-zero'?0:1;
        }
        const expected={panelInfo,visible:true,selected:true,title:scenario.title,lines:scenario.lines,
          owner:scenario.owner,role:scenario.role,registered:true};
        compare(phase+'-'+scenario.type+'-rendered-panel',observed,expected);
        compare(phase+'-'+scenario.type+'-no-owner-row',observed.lines.some(line=>/owner|^demons?$/i.test(line)),false);
        const screenshot=path.join(out,'screenshots',phase+'-'+scenario.type+'.png');
        const bytes=await page.screenshot({path:screenshot});
        const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
        checkpoints.push({phase,scenario:scenario.type,screenshot,sha256,expected,observed});
        console.log(`PASS screenshot ${scenario.type} path=${screenshot} sha256=${sha256}`);
      }
      if (phase === 'damaged') {
        const expectedState = JSON.parse(before);
        for (const unit of expectedState.players[3].units) {
          if (cases.some(scenario => scenario.i !== undefined && scenario.type === unit.name)) {
            unit.hp -= 0.5;
            unit.wasHitted = true;
          }
        }
        before = JSON.stringify(expectedState);
      }
      compare(phase+'-selection-preserves-state',await page.evaluate(()=>JSON.stringify(getGameObject())),before);
    }
    compare('browser-console-errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify({
      engine:'chromium',version:browser.version(),consoleErrors:errors,checkpoints},null,2)+'\n');
    console.log('PASS co-op selection info demon_types=10 portals=1 human_controls=2 phases=3 rendered_panels=39 ownership_preserved=39');
  } finally {
    console.log('browser_console_errors='+JSON.stringify(errors));
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
