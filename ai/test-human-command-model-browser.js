// Browser diagnosis only: production model, command logger and event dispatch are unmodified.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const marker = "Cannot read properties of undefined (reading 'predict')";
async function run({regression = false} = {}) {
  const arg = process.argv.indexOf('--output-dir');
  const out = path.resolve(arg < 0 ? path.join(root, 'artifacts/TASK-103') : process.argv[arg + 1]);
  fs.mkdirSync(out, {recursive:true});
  const prefix = regression ? 'regression' : 'browser';
  const traces = [], cases = [], network = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403); res.end(); return;}
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  function compare(label, observed, expected) {
    console.log(JSON.stringify({scenario:label, expected, observed}));
    assert.deepEqual(observed, expected, label);
    console.log('PASS ' + label);
  }
  try {
    browser = await chromium.launch({headless:true});
    console.log('browser_version=' + browser.version());
    for (const state of regression ? ['absent'] : ['absent','loading','failed','ready']) {
      const page = await browser.newPage({viewport:{width:1280,height:900}, deviceScaleFactor:1});
      const errors = [];
      page.on('pageerror', e => {errors.push({message:e.message, stack:e.stack}); traces.push({state,kind:'pageerror',stack:e.stack});});
      page.on('console', m => traces.push({state,kind:m.type(),text:m.text()}));
      page.on('response', r => {if(r.url().includes('readiness-model')) network.push({state,url:r.url(),status:r.status()});});
      await page.route('https://**/*', route => {
        const url = route.request().url();
        return route.fulfill({contentType:'application/javascript', body:url.includes('tensorflow') ? fs.readFileSync(require.resolve('@tensorflow/tfjs/dist/tf.min.js'), 'utf8') : url.includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' : 'window.saveAs=()=>{}'});
      });
      let heldRoute;
      await page.route('**/readiness-model.json', route => {
        network.push({state,url:route.request().url(),event:'requested'});
        if(state === 'loading') {heldRoute = route; return;}
        return route.fulfill({status:404,body:'Deliberately missing model'});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
      await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
      await page.evaluate(async state => {
        await tf.setBackend('cpu'); await tf.ready();
        window.modelState = state;
        if(state === 'ready') ai_model = createAlphaZeroModel(9,7);
        if(state === 'loading' || state === 'failed') {
          window.modelLoad = loadModel('/readiness-model.json').then(model => {ai_model=model; modelState='ready';}, e => {modelState='failed'; console.error('EXPECTED model load failure: '+e.message);});
          if(state === 'failed') await modelLoad;
        }
      }, state);
      console.log('tensorflow_version=' + await page.evaluate(() => tf.version.tfjs));
      for (const fog of regression ? [false] : [false,true]) {
        for (const action of regression ? ['archer-move'] : ['archer-move','archer-ranged','ordinary-move']) {
          await page.evaluate(({fog,action}) => {
            isFogOfWar=fog; gameSettings.isOnline=false; gameSettings.coop=null;
            const actors=[{rgb:{r:100,g:100,b:100},towns:[],gold:0},
              {rgb:{r:220,g:40,b:40},towns:[{x:1,y:1}],gold:100},
              {rgb:{r:40,g:120,b:220},towns:[{x:7,y:1}],gold:100}];
            new GameMap({x:9,y:7},actors,[],[],[],[],[],{type:'rectangular'},null).start(GameManager,false);
            whooseTurn=1; humanCommands=[]; actionManager.clear();
            grid.getHexagon({x:4,y:3}).playerColor=1;
            window.actor=action === 'ordinary-move' ? new Normchel(4,3) : new Archer(4,3);
            window.victim=null;
            if(action === 'archer-ranged') {grid.getHexagon({x:4,y:5}).playerColor=2; victim=new Normchel(4,5);}
            if(fog) players[1].changeFogOfWarByVision();
            nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
            gameEvent.removeSelection(); gameEvent.screen.moveTo(actor.pos); gameEvent.screen.stop(); drawAll();
          }, {fog,action});
          for(let repeat=0;repeat<(regression?1:2);repeat++) {
            if(repeat) {
              const turns=await page.evaluate(() => {
                const turns=[];
                for(let i=0;i<2;i++) {nextTurn(); turns.push(whooseTurn); nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();}
                return turns;
              });
              compare(`${state}/${fog}/${action}/turn-order`,turns,[2,1]);
            }
            const source=await page.evaluate(()=>({...actor.coord}));
            const destination=action === 'archer-ranged' ? {x:4,y:5} : {x:4,y:repeat?3:4};
            const snapshot=()=>page.evaluate(()=>({modelState,modelDefined:ai_model!==undefined,fog:isFogOfWar,turn:whooseTurn,round:gameRound,
              actor:actor.toJSON(),victim:victim?victim.toJSON():null,commands:humanCommands.length,undoDepth:actionManager.arr.length,selected:gameEvent.selected.name}));
            async function clickCell(coord) {
              const point=await page.evaluate(coord=>{
                const p=grid.getHexagon(coord).pos, rect=mainCanvas.getBoundingClientRect();
                return {x:(p.x+assets.size/2-canvas.offset.x+rect.left)*canvas.scale,y:(p.y+assets.size/2-canvas.offset.y+rect.top)*canvas.scale};
              },coord);
              await page.mouse.click(point.x,point.y);
            }
            await clickCell(source);
            compare(`${state}/${fog}/${action}/${repeat}/selected`,await page.evaluate(()=>gameEvent.selected===actor),true);
            compare(`${state}/${fog}/${action}/${repeat}/legal`,await page.evaluate(destination=>actor.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,destination)),destination),true);
            const before=await snapshot(), start=errors.length;
            compare(`${state}/${fog}/${action}/${repeat}/model-state`, {state:before.modelState,defined:before.modelDefined}, {state,defined:state==='ready'});
            await clickCell(destination);
            const after=await snapshot(), actionErrors=errors.slice(start);
            const row={state,fog,action,repeat,mode:'local competitive hotseat',map:'fixed 9x7; towns (1,1)/(7,1); actor (4,3); ranged target (4,5)',seed:'none; explicitly authored map',source,destination,before,after,errors:actionErrors};
            cases.push(row); console.log(JSON.stringify(row));
            compare(`${state}/${fog}/${action}/${repeat}/action-applied`,action==='archer-ranged'?after.victim.hp:after.actor.coord,action==='archer-ranged'?(repeat?1:3):destination);
            compare(`${state}/${fog}/${action}/${repeat}/recorded`,after.commands,before.commands+1);
            if(regression) compare('valid human action completes without exception',actionErrors,[]);
            else {
              compare(`${state}/${fog}/${action}/${repeat}/exception-count`,actionErrors.length,state==='ready'?0:1);
              if(state!=='ready') {
                assert.equal(actionErrors[0].message,marker);
                for(const frame of ['ai/model.js','recordHumanCommand','sendInstructions','click']) assert.ok(actionErrors[0].stack.includes(frame),frame);
                console.log('PASS confirmed predict -> recordHumanCommand -> sendInstructions -> click');
              }
            }
          }
        }
      }
      compare(`${state}/all-page-errors`,errors.length,state==='ready'?0:12);
      if(state==='loading') {assert.ok(heldRoute,'model request held in flight'); await heldRoute.abort();}
      await page.close();
    }
    console.log(`PASS ${prefix} scenarios=${cases.length}`);
  } finally {
    fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify({cases,network,traces},null,2)+'\n');
    fs.writeFileSync(path.join(out,prefix+'-console.log'),traces.map(t=>JSON.stringify(t)).join('\n')+'\n');
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
if(require.main===module) run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
