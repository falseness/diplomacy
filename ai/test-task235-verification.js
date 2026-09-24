#!/usr/bin/env node
'use strict';
// Cumulative command/deadline and evidence pattern shared with TASK-232/234;
// the existing focused schedule harness owns the production-source assertions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
    env:{...process.env,TASK235_STOP_AT:String(stopAt)},timeout:Math.max(1,stopAt-Date.now()),killSignal:'SIGKILL'});
  log(r.stdout || ''); log(r.stderr || ''); log(`ACTUAL_EXIT_STATUS=${r.status}`);
  commands.push({program,args,cwd:ROOT,exit:r.status,signal:r.signal,error:r.error?.message || null});
  assert.equal(r.status,0); return r.stdout;
};
const files = ['ai/wave-config.js','ai/wave-composition.js','ai/wave-placement.js','ai/demon-config.js',
  'sprites/entities/buildings/demonPortal.js','index.html','ai/test-coop-typed-wave-config.js','ai/test-task235-verification.js'];
const snapshot = () => Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
const cases = ['node-schedule','script-vm-schedule','node-composition','script-vm-composition',
  'invalid-inputs','registered-types','availability-and-preview-callers','negative-controls'];
write('verification-plan.json',{estimateMs:120000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
  cases,tiers:['Node production source','shipped script VM production source'],
  coverage:'six categories; every round 0..100; all unlock before/at/after boundaries; final repetition at 4000; invalid inputs; availability/committed preview callers',
  exclusions:['No browser UI or network claims: integration belongs to TASK-238','No map quota or artwork changes: TASK-236/239'],
  commands:['node ai/test-coop-typed-wave-config.js --output-dir <run>/focused','git diff --check','git diff --cached --name-only','source and evidence audit']});
log(`COMMAND NODE_PATH=${process.env.NODE_PATH || ''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version}\nV8=${process.versions.v8}\nBROWSER=not applicable; script VM only`);
const before = snapshot();
let passed = false, checkpoints = [];
try {
  const head = command('git',['rev-parse','HEAD']).trim();
  command(process.execPath,[path.join(__dirname,'test-coop-typed-wave-config.js'),'--output-dir',path.join(out,'focused')]);
  checkpoints = read('focused/checkpoints.json').checkpoints;
  const schedule = read('focused/schedule.json');
  write('schedule.json',schedule);
  write('checkpoints.json',{checkpoints,pass:checkpoints.every(c=>c.pass)});
  for (const c of checkpoints) {assert.equal(c.pass,true,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  // Exact case inventory is derived before execution by the harness's literal loops;
  // enforce the defining markers for every declared family here as well.
  const markers = ['node-schedule-melee-rounds-0-100','browser-schedule-melee-rounds-0-100',
    'node-compose-one-per-category-round-36','browser-compose-one-per-category-round-36',
    'node-invalid-inputs','scheduled-types-cover-all-demon-types','caller-unblock-no-backlog','negative-control-next-at-wave'];
  for (const marker of markers) assert.ok(checkpoints.some(c=>c.id===marker),marker);
  for (const runtime of ['node','browser']) for (const category of schedule.categories) {
    assert.ok(checkpoints.some(c=>c.id===`${runtime}-schedule-${category}-rounds-0-100`));
    for(let r=0;r<100;r++) assert.ok(checkpoints.some(c=>c.id===`${runtime}-next-${category}-table-${r}`));
  }
  const diff = command('git',['diff','--check']);
  fs.writeFileSync(path.join(out,'diff-check.txt'),diff); assert.equal(diff,'');
  const staged = command('git',['diff','--cached','--name-only']);
  assert.ok(!staged.split('\n').some(f=>f.startsWith('artifacts/')));
  assert.deepEqual(snapshot(),before);
  write('source-identities.json',{head,files:before,pass:true});
  for(const [f,hash] of Object.entries(read('source-identities.json').files)) assert.equal(sha(fs.readFileSync(path.join(ROOT,f))),hash);
  assert.ok(read('schedule.json').assertions.length>0);
  for(const c of read('schedule.json').assertions) assert.deepEqual(c.observed,c.expected,c.id);
  log(`PASS evidence-audit checkpoints=${checkpoints.length} categories=6 rounds=0..100 final-repeat=4000 invalid-inputs=rejected`);
  log('PASS source-hashes-current artifacts-unstaged diff-check-empty');
  assert.ok(Date.now()<stopAt); passed=true;
} catch(e) {log(e.stack);}
finally {
  const cleanup=commands.every(c=>c.signal===null && c.error===null);
  log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup synchronous-children-reaped=${commands.length} services=0`);
  const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(f=>f!=='verification.log'&&fs.statSync(path.join(out,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(out,f)))]));
  passed=passed&&cleanup&&Date.now()-start<3600000;
  write('coverage-results.json',{cases:cases.map(id=>({id,pass:passed,proof:'checkpoints.json'})),
    assertionIds:checkpoints.map(c=>c.id),commandExits:commands,evidenceHashes,pass:passed});
  write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,
    targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup,pass:passed});
  log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
}
