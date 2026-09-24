#!/usr/bin/env node
'use strict';
// Cumulative command/deadline and evidence pattern shared with TASK-232/234;
// the shipped-map harness and independent valley contract own the assertions.
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
    env:{...process.env,TASK236_STOP_AT:String(stopAt)},timeout:Math.max(1,stopAt-Date.now()),killSignal:'SIGKILL'});
  log(r.stdout || ''); log(r.stderr || ''); log(`ACTUAL_EXIT_STATUS=${r.status}`);
  commands.push({program,args,cwd:ROOT,exit:r.status,signal:r.signal,error:r.error?.message || null});
  assert.equal(r.status,0); return r.stdout;
};
const snapshot = () => sourceSnapshot();
const {inputs,idOf} = require('./test-task236-maps');
const browserCases=require('./test-task236-browser').cases.map(c=>c.id);
const cases = [...inputs.map(idOf),...browserCases];
write('verification-plan.json',{estimateMs:1200000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
  cases,tiers:['shipped script VM production source','independent hex BFS contract','real Chromium menu inputs and HTTPS/Socket.IO/MongoDB'],
  fixtures:'Two authored Tiny/H2/seed1 six-category boards, sequential fog off and simultaneous fog on; separate from generated maps.json',
  coverage:'40 inputs generated twice; six categories; first strict feasible side; two fronts; fairness and approach reach in both mine models; 80 negative controls',
  exclusions:['Remaining seed products are optional diagnostics','Server creation of enlarged generated boards is TASK-237; network journeys use declared valid authored Tiny/H2 fixtures with all six categories'],
  commands:['node ai/test-task236-maps.js --output-dir <run>/focused','node ai/test-task236-browser.js <run>','git diff --check','git diff --cached --name-only','source and evidence audit']});
log(`COMMAND NODE_PATH=${process.env.NODE_PATH || ''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version}\nV8=${process.versions.v8}\nBROWSER=Chromium version logged by browser child`);
const before = snapshot();
let passed = false, checkpoints = [];
try {
  const head = command('git',['rev-parse','HEAD']).trim();
  write('source-identities.json',{head,files:before,pass:false});
  command(process.execPath,[path.join(__dirname,'test-task236-maps.js'),'--output-dir',path.join(out,'focused')]);
  checkpoints = read('focused/checkpoints.json').checkpoints;
  const maps = read('focused/maps.json');
  write('maps.json',maps);
  write('checkpoints.json',{checkpoints,pass:checkpoints.every(c=>c.pass)});
  for (const c of checkpoints) {assert.equal(c.pass,true,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  assert.deepEqual(maps.map(m=>m.id),inputs.map(idOf));
  for(const m of maps) {
    assert.equal(m.identical,true); assert.equal(m.contract.valid,true);
    assert.equal(m.map.portals.length,6*m.input.h);
    for(const marker of ['categories','first-feasible','mine-endpoint-reach','negative-dropped-portal','negative-blocked-approach'])
      assert.ok(checkpoints.some(c=>c.id===m.id+'-'+marker && c.pass));
  }
  command(process.execPath,[path.join(__dirname,'test-task236-browser.js'),out]);
  const browser=read('browser-results.json');
  assert.deepEqual(browser.cases,browserCases);assert.equal(browser.pass,true);
  checkpoints.push(...read('browser-checkpoints.json').checkpoints);
  for(const c of checkpoints){assert.equal(c.pass,true,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  for(const row of browser.rows)assert.ok(fs.statSync(path.join(out,row.screenshot)).size>1000);
  assert.equal(browser.rows.length,4);
  for(const id of browserCases){
    for(const suffix of ['fixture-counts','network-participants','network-board-0','network-board-1','browser-board-0','browser-board-1','render-assets-0','render-assets-1','browser-contexts','browser-errors','server-errors','cleanup'])
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
  log(`PASS evidence-audit maps=40/40 checkpoints=${checkpoints.length} categories=6 negative-controls=80 fairness=pass reachability=pass`);
  log('PASS source-hashes-current artifacts-unstaged diff-check-empty');
  assert.ok(Date.now()<stopAt); passed=true;
} catch(e) {log(e.stack);}
finally {
  const cleanup=commands.every(c=>c.signal===null && c.error===null) && browserCases.every(id=>{const f=path.join(out,id,'cleanup.json');if(!fs.existsSync(f))return false;const c=JSON.parse(fs.readFileSync(f));return c.browserClosed&&c.clientClosed&&c.cleanup?.processes.every(p=>!p.aliveAfter)&&c.cleanup.directories.every(d=>!d.existsAfter);});
  log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup synchronous-children-reaped=${commands.length} browser-and-network-services-reaped`);
  const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(f=>f!=='verification.log'&&fs.statSync(path.join(out,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(out,f)))]));
  passed=passed&&cleanup&&Date.now()-start<3600000;
  write('coverage-results.json',{cases:cases.map(id=>({id,pass:passed,proof:browserCases.includes(id)?['browser-results.json',id+'/input-trace.jsonl',id+'/network-trace.jsonl',id+'/screenshots/',id+'/persisted.json']:'checkpoints.json'})),
    assertionIds:checkpoints.map(c=>c.id),commandExits:commands,evidenceHashes,pass:passed});
  write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,
    targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup,pass:passed});
  log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
}
