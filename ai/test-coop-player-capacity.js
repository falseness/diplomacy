'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');

const root = path.resolve(__dirname, '..');
const option = process.argv.indexOf('--output-dir');
const out = path.resolve(root, option < 0 ? 'artifacts/TASK-123' : process.argv[option + 1]);
fs.mkdirSync(out, {recursive:true});
const checkpoints = [];
function compare(name, observed, expected) {
  console.log(JSON.stringify({name, expected, observed}));
  assert.deepEqual(observed, expected, name);
  checkpoints.push({name, expected, observed});
  console.log('PASS '+name);
}
const palette = [[255,0,0],[98,168,222],[60,190,100],[230,170,40],
  [0,110,120],[245,120,180],[100,70,210],[135,80,35],
  [170,200,40],[20,55,125],[255,110,0],[80,80,80]];
const rgb = a => ({r:a[0],g:a[1],b:a[2]});
function config(count) {
  return {coop:true,size:{x:39,y:9},actors:[
    {role:'neutral',rgb:rgb([208,208,208]),gold:0,towns:[],units:[]},
    ...Array.from({length:count},(_,i)=>({role:'human',rgb:rgb(palette[i]),gold:100,
      towns:[{x:2+i*3,y:2}],units:[]})),
    {role:'demon',rgb:rgb([160,40,180]),gold:0,economyEnabled:false,towns:[],units:[]}]};
}
function identity(f) {
  return f.evaluate(`({slots:gameSettings.coop.humanSlots, count:gameSettings.coop.initialHumanCount,
    demon:gameSettings.coop.demonSlot, unique:new Set(players).size,
    players:players.map((p,i)=>({slot:i,role:p.role,team:p.team,color:p.color,
      gold:p.gold,economy:p.economyEnabled,units:p.units.map(u=>u.playerColor),
      towns:p.towns.map(t=>t.playerColor),controller:p instanceof DemonPlayer}))})`);
}
async function run() {
  for (let count=1;count<=12;count++) {
    const f=createFixture(config(count),()=>{});
    compare('palette-'+count,f.evaluate(`Array.from({length:${count}},(_,i)=>coopPlayerColor(i+1))`),palette.slice(0,count).map(rgb));
    const slots=Array.from({length:count},(_,i)=>i+1);
    const expected={slots,count,demon:count+1,unique:count+2,players:[
      {slot:0,role:'NEUTRAL',team:0,color:rgb([208,208,208]),gold:0,economy:true,units:[],towns:[],controller:false},
      ...slots.map(slot=>({slot,role:'HUMAN',team:'HUMANS',color:rgb(palette[slot-1]),gold:100,economy:true,units:[slot],towns:[slot],controller:false})),
      {slot:count+1,role:'DEMONS',team:'DEMONS',color:rgb([160,40,180]),gold:0,economy:false,units:[],towns:[],controller:true}]};
    const entities=slots.flatMap(slot=>[{id:'t'+slot,kind:'town',name:'town',owner:slot,x:2+(slot-1)*3,y:2},
      {id:'u'+slot,kind:'unit',name:'noob',owner:slot,x:2+(slot-1)*3,y:2}]);
    compare('roster-'+count,identity(f),expected);
    createEntityLedger(f,entities).check('capacity-'+count+'-registries');
    f.evaluate('loadFromJson(JSON.stringify(getGameObject()))');
    compare('serialized-roster-'+count,identity(f),expected);
    createEntityLedger(f,entities).check('capacity-'+count+'-restored-registries');
    // Deliberately duplicate display colors: numeric ownership must stay separate.
    f.evaluate('players.slice(1,-1).forEach(p=>p.color={r:255,g:0,b:0})');
    compare('ownership-independent-of-color-'+count,f.evaluate('players.slice(1,-1).map(p=>p.units[0].playerColor)'),slots);
  }
  const f=createFixture(undefined,()=>{});
  compare('unique-palette',new Set(palette.map(String)).size,12);
  compare('reserved-colors-excluded',palette.some(p=>['208,208,208','160,40,180'].includes(String(p))),false);
  compare('local-online-limits',f.evaluate(`(()=>{const m=new Menu();menu=m;m.play.toggleMode();m.online.toggleMode();
    return [m.play.playersSlider.minimumValue(),m.play.playersSlider.maximumValue(),m.online.playersSlider.minimumValue(),m.online.playersSlider.maximumValue()]})()`),[1,12,2,12]);
  for(const n of [0,1.5,13]) {
    assert.throws(()=>f.evaluate(`generateCoopGame(${n})`),{name:'RangeError'});
    assert.throws(()=>f.evaluate(`coopPlayerColor(${n})`),{name:'RangeError'});
    console.log(`PASS invalid-local-wave-palette-${n} expected=RangeError observed=RangeError`);
  }
  for(const n of [0,1,1.5,13]) {
    assert.throws(()=>f.evaluate(`menu.online.playersSlider.value=${n};menu.online.selectedMap`),{name:'RangeError'});
    console.log(`PASS invalid-online-${n} expected=RangeError observed=RangeError`);
  }
  for(const count of [0,13]) {
    assert.throws(()=>createFixture(config(count===13?12:0),()=>{}).evaluate(`new GameMap({x:9,y:9},Array(${count+1}).fill({}),[],[],[],[],[],{}, {})`));
    console.log(`PASS invalid-roster-${count} expected=rejection observed=rejection`);
  }
  compare('competitive-limits',f.evaluate('Object.values(maps).flatMap(g=>g.map(m=>m.players.length-1)).reduce((a,n)=>[Math.min(a[0],n),Math.max(a[1],n)],[99,0])'),[2,4]);
  compare('competitive-training-colors',f.evaluate('Array.from({length:4},(_,i)=>trainingPlayerColor(i+1))'),palette.slice(0,4).map(rgb));
  await browserProof();
  fs.writeFileSync(path.join(out,'checkpoints.json'),JSON.stringify(checkpoints,null,2)+'\n');
  console.log('PASS co-op player capacity counts=1..12 serialization=12 registries=24 unique_colors=12 browser_errors=0');
}
async function browserProof() {
  const {chromium}=require('playwright');
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});res.end(err?'Not found':data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route('https://**/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().includes('socket.io')?'window.io=()=>({on(){},emit(){}})':route.request().url().includes('FileSaver')?'window.saveAs=()=>{}':'window.tf={}'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>typeof menu!=='undefined'&&imagesCountLoaded===images.length);
    const observed=await page.evaluate(()=>{
      const roster=[{rgb:{r:208,g:208,b:208},towns:[],units:[],gold:0},...Array.from({length:12},(_,i)=>({rgb:coopPlayerColor(i+1),gold:100,towns:[{x:2+(i%4)*4,y:2+Math.floor(i/4)*4}],units:[]}))];
      const map=new GameMap({x:17,y:13},roster,[],[],[],[],[],{type:'rectangular'},{});
      map.portals=[{x:16,y:12}];
      AiRuntime.trainFromHumanCommands=()=>{};gameSlot=0;
      GameManager.start(map,false,false,false);
      nextTurnPauseInterface.hideButDontUpdateTimer();timer.pauseAndSaveTime();
      Screen.prototype.scale.call(gameEvent.screen,{x:750,y:500},-10000);
      gameEvent.screen.moveTo(grid.center);drawAll();
      return {roles:players.map(p=>p.role),active:!gameExit&&!menu.visible};
    });
    compare('browser-roster',observed,{roles:['NEUTRAL',...Array(12).fill('HUMAN'),'DEMONS'],active:true});
    async function shot(name) {
      const file=path.join(out,name+'.png'),bytes=await page.screenshot({path:file});
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      checkpoints.push({name,screenshot:file,sha256});console.log(`PASS screenshot ${name} path=${file} sha256=${sha256}`);
    }
    await shot('in-game-roster');
    const colors=await page.evaluate(()=>Array.from({length:12},(_,i)=>coopPlayerColor(i+1)));
    const html='<html><body style="font:24px sans-serif;background:#fafafa;padding:32px"><h1>Co-op human palette — slots 1–12</h1><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px">'+colors.map((c,i)=>`<div style="padding:16px;border:1px solid #888"><div style="height:120px;background:rgb(${c.r},${c.g},${c.b})"></div><p>Human ${i+1}</p><small>RGB ${c.r}, ${c.g}, ${c.b}</small></div>`).join('')+'</div></body></html>';
    fs.writeFileSync(path.join(out,'palette.html'),html);
    await page.setContent(html);await shot('palette-preview');
    compare('browser-errors',errors,[]);
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
