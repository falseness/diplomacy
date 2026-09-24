#!/usr/bin/env node
'use strict';
// Cumulative command/deadline and evidence pattern shared with TASK-236;
// shared real browser/network helpers and explicit static expectations own the assertions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {sourceSnapshot} = require('../../diplomacy_server/tests/reliability/helpers/browser-game');
const {spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const ROOT = path.resolve(__dirname, '..');
const start = Date.now(), stopAt = start + 3300000;
const {values} = parseArgs({options: {'output-dir': {type:'string'}}});
assert.ok(values['output-dir'], '--output-dir required');
const out = path.resolve(values['output-dir']);
assert.ok(!fs.existsSync(out), 'Refusing to overwrite evidence');
fs.mkdirSync(out, {recursive:true});
const write = (name, data) => fs.writeFileSync(path.join(out,name), JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const log = s => {fs.appendFileSync(path.join(out,'verification.log'),s+'\n'); console.log(s);};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const commands = [];
const command = (program,args) => {
  assert.ok(Date.now()<stopAt, 'cumulative stop-work deadline');
  log(`COMMAND ${program} ${args.join(' ')}\nCWD=${ROOT}`);
  const r = spawnSync(program,args,{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024,
    env:{...process.env,TASK241_STOP_AT:String(stopAt)},timeout:Math.max(1,stopAt-Date.now()),killSignal:'SIGKILL'});
  log(r.stdout || ''); log(r.stderr || ''); log(`ACTUAL_EXIT_STATUS=${r.status}`);
  commands.push({program,args,cwd:ROOT,exit:r.status,signal:r.signal,error:r.error?.message || null});
  assert.equal(r.status,0); return r.stdout;
};
const snapshot = () => sourceSnapshot();
const browserCases=require('./test-task241-browser').cases.map(c=>c.id);
const cases=['source/non-coop-landmarks',...require('./test-task241-render').cases];
for(const id of browserCases){
 for(const suffix of ['persisted-board-0','persisted-board-1','persisted-board-2','persisted-board-3','fixture-counts','network-participants','network-board-0','network-board-1','browser-board-0','browser-board-1','render-assets-0','render-assets-1','browser-contexts','browser-errors','server-errors','cleanup']) cases.push(id+'/'+suffix);
}
write('verification-plan.json',{estimateMs:600000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
 cases,tiers:['real Chromium captures, keyboard pan, wheel zoom and instrumented production draw calls','real HTTPS/Socket.IO/MongoDB','source and on-disk evidence audit'],
 fixtures:'Two authored Tiny/H2/seed1 boards, sequential fog off and simultaneous fog on. After reconnect, declared rendering fixtures add empty/occupied goldmines and portals, ordinary town control, enemy bulwark occupants and explicit visibility states. No natural-gameplay claim.',
 coverage:'32 captured render cases: fog enabled/disabled, vision on/off, cached/uncached, initial/repeat/pan/zoom; two portal destruction cases; real network joins and persistence.',
 exclusions:['Long natural games','Cartesian join/seed/map-size products','Rendering stress','Unrelated wave mechanics'],
 commands:['node20 ai/test-task241-browser.js <run>','git diff --check','git diff --cached --name-only','source and evidence audit including cleanup']});
log(`COMMAND NODE_PATH=${process.env.NODE_PATH || ''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version}\nV8=${process.versions.v8}\nBROWSER=Chromium version logged by browser child`);
const before = snapshot();
let passed = false, checkpoints = [];
try {
  const head = command('git',['rev-parse','HEAD']).trim();
  write('source-identities.json',{head,files:before,pass:false});
  // Run the real Grid helper with no co-op globals and poison occupant/draw
  // accessors: only the two explicitly public landmark images may be used.
  const source=fs.readFileSync(path.join(ROOT,'groups/grid.js'),'utf8');
  const calls=[];
  const sandbox={SpritesGroup:class {},cachedImages:{goldmine:'gold',portal:'portal'},drawCachedImage:(_ctx,img)=>calls.push(img)};
  const Grid=require('node:vm').runInNewContext(source+';Grid',sandbox);
  const grid=new Grid();
  for(const props of [{name:'goldmine'},{name:'demonPortal',isDemonPortal:true,imageName:'portal'},
    {name:'town'},{name:'demonPortal',isDemonPortal:true,imageName:'portal',killed:true}]){
    const b={...props,pos:{x:0,y:0},get unit(){throw Error('occupant accessed');},draw(){throw Error('indirect draw');}};
    grid.drawFogLandmark({},b);
  }
  assert.deepEqual(calls,['gold','portal']);
  checkpoints.push({id:'source/non-coop-landmarks',expected:['gold','portal'],observed:calls,pass:true});
  log('PASS source/non-coop-landmarks gold,portal; no co-op globals or occupant access');
  command(process.execPath,[path.join(__dirname,'test-task241-browser.js'),out]);
  const browser=read('browser-results.json');
  assert.deepEqual(browser.cases,browserCases);assert.equal(browser.pass,true);
  checkpoints.push(...read('browser-checkpoints.json').checkpoints);
  for(const c of checkpoints){assert.equal(c.pass,true,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  for(const row of browser.rows)assert.ok(fs.statSync(path.join(out,row.screenshot)).size>1000);
  assert.equal(browser.rows.length,34);
  const render=read('draw-order.json').rows;assert.deepEqual(render,browser.rows);
  assert.deepEqual(render.map(r=>r.id).sort(),require('./test-task241-render').cases.sort());
  assert.deepEqual(checkpoints.map(c=>c.id).sort(),[...cases].sort(),'exact case inventory');
  for(const id of cases)assert.equal(checkpoints.filter(c=>c.id===id&&c.pass).length,1,id);
  for(const row of render.filter(r=>!r.id.endsWith('/destroyed'))){
    const [journey,variant]=row.id.split('/');
    const phase=variant.split('-').at(-1);
    if(phase==='pan'||phase==='zoom'){
      const previous=render.find(r=>r.id===journey+'/'+variant.replace(/(pan|zoom)$/,phase==='pan'?'repeat':'pan'));
      if(phase==='pan')assert.notDeepEqual(row.camera.offset,previous.camera.offset,'actual keyboard pan');
      else assert.notEqual(row.camera.scale,previous.camera.scale,'actual wheel zoom');
    }
    if(row.cached){
      assert.ok(row.calls.some(c=>c.kind==='cache-blit'));
      if(phase==='initial')assert.equal(row.rebuilt,true);
      else if(!row.rebuilt){
        const initial=render.find(r=>r.id===journey+'/'+variant.replace(/(repeat|pan|zoom)$/, 'initial'));
        assert.equal(row.revision,initial.revision,'reused surface must reference proven initial raster');
        row.cacheProof=initial.id;
      }
    }
    assert.deepEqual(row.cells.filter(c=>c.kind==='portal').map(c=>c.preview),[
      {round:4,type:'imp',roundsRemaining:journey.includes('true')?1:4},
      {round:4,type:'spitter',roundsRemaining:journey.includes('true')?1:4}
    ],'scheduled preview independent of bulwark occupant');
  }
  write('draw-order.json',{rows:render,pass:true});
  for(const row of render){const b=fs.readFileSync(path.join(out,row.screenshot));assert.equal(b.subarray(1,4).toString(),'PNG');}
  for(const id of browserCases){
    for(const suffix of ['persisted-board-0','persisted-board-1','persisted-board-2','persisted-board-3','fixture-counts','network-participants','network-board-0','network-board-1','browser-board-0','browser-board-1','render-assets-0','render-assets-1','browser-contexts','browser-errors','server-errors','cleanup'])
      assert.ok(checkpoints.some(c=>c.id===id+'/'+suffix&&c.pass),id+'/'+suffix);
    assert.deepEqual(read(id+'/browser-errors.json'),[]);
    const inputs=fs.readFileSync(path.join(out,id,'input-trace.jsonl'),'utf8');
    assert.ok(inputs.includes('mouse.click')&&inputs.includes('reconnect slot'));
    const trace=fs.readFileSync(path.join(out,id,'network-trace.jsonl'),'utf8');
    assert.ok(trace.includes('startGameOrConnect')&&/playYourTurn|waitYouTurn|gameStarted/.test(trace));
    for(const [file,hash] of Object.entries(read(id+'/served-sources.json')))
      assert.equal(sha(fs.readFileSync(path.join(ROOT,file))),hash,'served source '+file);
  }
  write('checkpoints.json',{checkpoints,pass:true});
  const diff = command('git',['diff','--check']);
  fs.writeFileSync(path.join(out,'diff-check.txt'),diff); assert.equal(diff,'');
  const staged = command('git',['diff','--cached','--name-only']);
  assert.ok(!staged.split('\n').some(f=>f.startsWith('artifacts/')));
  const serverDiff=command('git',['-C',path.resolve(ROOT,'../diplomacy_server'),'diff','--check']);
  fs.writeFileSync(path.join(out,'server-diff-check.txt'),serverDiff);assert.equal(serverDiff,'');
  const serverStaged=command('git',['-C',path.resolve(ROOT,'../diplomacy_server'),'diff','--cached','--name-only']);
  assert.ok(!serverStaged.split('\n').some(f=>f.startsWith('artifacts/')));
  assert.deepEqual(snapshot(),before);
  write('source-identities.json',{head,files:before,pass:true});
  for(const repo of Object.values(read('source-identities.json').files)) for(const [f,hash] of Object.entries(repo.files)) assert.equal(sha(fs.readFileSync(path.join(repo.repo,f))),hash);
  log(`PASS evidence-audit cases=${cases.length} checkpoints=${checkpoints.length} fog-before-landmark=pass hidden-occupants=absent captures=34`);
  log('PASS source-hashes-current artifacts-unstaged diff-check-empty');
  assert.ok(Date.now()<stopAt); passed=true;
} catch(e) {log(e.stack);}
finally {
  const cleanup=commands.every(c=>c.signal===null && c.error===null) && browserCases.every(id=>{const f=path.join(out,id,'cleanup.json');if(!fs.existsSync(f))return false;const c=JSON.parse(fs.readFileSync(f));return c.browserClosed&&c.clientClosed&&c.cleanup?.processes.every(p=>!p.aliveAfter)&&c.cleanup.directories.every(d=>!d.existsAfter);});
  log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup synchronous-children-reaped=${commands.length} browser-and-network-services-reaped`);
  if(passed&&cleanup){
    for(const f of ['verification-plan.json','source-identities.json','checkpoints.json','draw-order.json'])
      assert.ok(fs.statSync(path.join(out,f)).size>0,f);
    log('PASS final-audit required-files-present exact-case-inventory source-hashes screenshots-PNG cleanup=true');
  }
  const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(f=>f!=='verification.log'&&fs.statSync(path.join(out,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(out,f)))]));
  passed=passed&&cleanup&&Date.now()-start<3600000;
  write('coverage-results.json',{cases:cases.map(id=>({id,pass:passed,proof:['checkpoints.json','draw-order.json']})),
    assertionIds:checkpoints.map(c=>c.id),commandExits:commands,evidenceHashes,pass:passed});
  write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,
    targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup,pass:passed});
  log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
}
