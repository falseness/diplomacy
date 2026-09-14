const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const index = process.argv.indexOf('--output-dir');
const out = path.resolve(index < 0 ? 'artifacts/TASK-116/browser' : process.argv[index + 1]);
(async () => {
  const deadline=setTimeout(()=>{console.error('FAIL hotseat browser deadline');process.exit(1);},120000);
  deadline.unref();
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204);res.end();return;}
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,data) => {res.writeHead(err ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});res.end(err ? 'missing' : data);});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' : route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>menu.visible && imagesCountLoaded===images.length);
    await page.evaluate(()=>{
      window.goldTrace=[];
      const create=GameMap.prototype.createPlayers;
      GameMap.prototype.createPlayers=function() {
        create.apply(this,arguments);
        goldTrace.push({event:'createPlayers',configured:this.players.map(p=>p.gold ?? 'omitted'),actual:players.map(p=>p.gold)});
      };
      const turn=Player.prototype.nextTurn;
      Player.prototype.nextTurn=function() {
        const row={event:'nextTurn',slot:players.indexOf(this),round:gameRound,before:this.gold,towns:this.towns.map(t=>t.income),salary:this.armySalary,mines:this.goldminesIncome,income:this.income};
        turn.call(this);row.after=this.gold;goldTrace.push(row);
      };
    });
    async function click(expr) {
      const p=await page.evaluate(expr=>{const c=(0,eval)(expr),r=c.rect||c;return {x:r.centerX,y:r.centerY};},expr);
      await page.mouse.click(p.x,p.y);
    }
    await click('menu.main.buttons[0]');
    const selected=await page.evaluate(()=>({map:menu.play.mapSlider.realValue,humans:menu.play.playersSlider.realValue,mode:menu.play.modeButton.text.text}));
    await click('menu.play.playButton');
    await click('menu.startGame.buttons[0].movingForm.elements[0].rect');
    await page.waitForFunction(()=>!menu.visible && whooseTurn===1);
    const states=[];
    for(let slot=1;slot<=Number(selected.humans);slot++) {
      states.push(await page.evaluate(()=>{
        nextTurnPauseInterface.visible=true;nextTurnPauseInterface.draw(interfaceCtx);
        const displayed=nextTurnPauseInterface.goldInfo.textString;
        nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();drawAll();
        return {slot:whooseTurn,round:gameRound,actual:players[whooseTurn].gold,displayed,trace:goldTrace};
      }));
      await page.screenshot({path:path.join(out,`first-turn-${slot}.png`)});
      await page.evaluate(()=>{nextTurnPauseInterface.visible=true;drawAll();});
      await page.screenshot({path:path.join(out,`balance-${slot}.png`)});
      if(slot<Number(selected.humans)) await page.evaluate(()=>nextTurn());
    }
    const report={selected,states,errors,browser:browser.version()};
    fs.writeFileSync(path.join(out,'snapshots.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    assert.deepEqual(errors,[]);
    for(const state of states) {assert.equal(state.actual,100);assert.equal(String(state.displayed),'100');}
    console.log('PASS hotseat browser first-turn actual=100 displayed=100 every-human=2 console_errors=0');
  } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve));clearTimeout(deadline);}
})().catch(error=>{console.error(error);process.exitCode=1;});
