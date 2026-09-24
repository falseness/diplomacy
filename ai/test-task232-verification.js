#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {parseArgs}=require('node:util');
const ROOT=path.resolve(__dirname,'..');
const SERVER=path.resolve(ROOT,'../diplomacy_server');
const {expected,versions,expectedUnit,browserSource}=require('./test-coop-demon-config');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>{try {assert.deepEqual(a,b);return true;}catch{return false;}};
if (process.argv.includes('--browser-source-child')) {
  console.log('TASK232_BROWSER_RESULTS='+JSON.stringify(browserSource()));
} else {
  main();
}
function main() {
  const start=Date.now();
  const {values}=parseArgs({options:{'output-dir':{type:'string'}}});
  assert.ok(values['output-dir'],'--output-dir is required');
  const out=path.resolve(values['output-dir']);
  assert.ok(!fs.existsSync(out),'Refusing to overwrite historical evidence');
  fs.mkdirSync(out,{recursive:true});
  const write=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
  const log=s=>{fs.appendFileSync(path.join(out,'verification.log'),s+'\n');console.log(s);};
  const checkpoints=[], commands=[];
  const check=(id,observed,expectedValue)=>{
    const pass=equal(observed,expectedValue);
    checkpoints.push({id,expected:expectedValue,observed,pass});
    log(`${pass?'PASS':'FAIL'} ${id}`);
    assert.ok(pass,id);
  };
  const guard=()=>assert.ok(Date.now()-start<3300000,'cumulative stop-work deadline');
  const command=(program,args,cwd=ROOT,input)=>{
    guard();
    log(`COMMAND ${program} ${args.join(' ')}\nCWD=${cwd}\nNODE_PATH=${process.env.NODE_PATH || ''}`);
    const r=spawnSync(program,args,{cwd,input,encoding:'utf8',maxBuffer:32*1024*1024,
      timeout:Math.max(1,3300000-(Date.now()-start)),killSignal:'SIGKILL'});
    log(r.stdout || ''); log(r.stderr || '');
    const record={program,args,cwd,exit:r.status,signal:r.signal,error:r.error?.message || null};
    commands.push(record);log('ACTUAL_EXIT_STATUS='+r.status);
    assert.equal(r.status,0,JSON.stringify(record));
    return r.stdout;
  };
  const ids=Object.keys(expected);
  const cases=['node-table','frozen-table','removed-selectors',
    ...['browser-source','server-source'].flatMap(t=>versions.flatMap(v=>ids.map(id=>`${t}/${v}/${id}`)))];
  write('verification-plan.json',{estimateMs:120000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
    cases,tier:'production source execution: shipped browser scripts and actual server loader',
    exclusions:['No browser UI, rendering, HTTP, Socket.IO or MongoDB claims','No gameplay or wave schedule retuning','No full combat cross product'],
    commands:['browser-source child','server loader child','git diff --check (client and server)','source/evidence audit'],
    browserVersion:'not applicable: source VM, no browser launched',fixtures:'fixtures.json (declared setup, not observed gameplay)'});
  log(`COMMAND NODE_PATH=${process.env.NODE_PATH || ''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version}\nV8=${process.versions.v8}\nBROWSER=not used; source VM only`);
  const identities={before:{},after:{}};
  const snapshot=()=>Object.fromEntries([ROOT,SERVER].map(repo=>{
    const names=command('git',['ls-files','--cached','--others','--exclude-standard'],repo).split('\n')
      .filter(f=>f && !f.startsWith('artifacts/') && /\.(js|json|html)$/.test(f) && fs.existsSync(path.join(repo,f)));
    return [repo,{commit:command('git',['rev-parse','HEAD'],repo).trim(),
      files:Object.fromEntries(names.map(f=>[f,sha(fs.readFileSync(path.join(repo,f)))]))}];
  }));
  let passed=false;
  try {
    identities.before=snapshot();
    const expectedTable=Object.fromEntries(Object.entries(expected).map(([id,[name,role,health,damage,movement,ranged,range]])=>
      [id,{name,role,health,damage,movement,melee:true,ranged,range}]));
    const table=require('./demon-config');
    check('node-table',table,expectedTable);
    check('frozen-table',Object.isFrozen(table)&&Object.values(table).every(Object.isFrozen),true);
    const removed=['TUNED_DEMON_TYPES','getDemonTypes','currentDemonTypes'];
    const updatedCallers={
      'ai/demon-config.js':'one immutable current DEMON_TYPES table; no combat selectors',
      'sprites/entities/units/earlyDemons.js':'all registered demon constructor getters read DEMON_TYPES directly (shared by browser and server)',
      'options/save.js':'removed combat-version validation during restore',
      'ai/test-coop-economy-bot-defeat.js':'runtime rules report reads DEMON_TYPES',
      'ai/test-coop-wave-regressions.js':'installed rules report reads DEMON_TYPES',
      'ai/test-coop-demon-config.js':'literal current stats/constructor/description coverage',
      'ai/test-coop-fixed-balance.js':'obsolete strong/weak table compatibility test removed'};
    const scanned=Object.keys(identities.before[ROOT].files).filter(f=>f.endsWith('.js') && f!=='ai/test-task232-verification.js');
    const matches=scanned.flatMap(file=>removed.filter(name=>fs.readFileSync(path.join(ROOT,file),'utf8').includes(name)).map(selector=>({file,selector})));
    fs.writeFileSync(path.join(out,'removed-selectors-grep.txt'),matches.map(m=>`${m.file}:${m.selector}`).join('\n'));
    check('removed-selectors',{matches,obsoleteTestExists:fs.existsSync(path.join(ROOT,'ai/test-coop-fixed-balance.js'))},
      {matches:[],obsoleteTestExists:false});
    write('selector-inventory.json',{removed,updatedCallers,scanned,matches,pass:true,
      retained:'balanceVersion selects wave progression only; combat has no version argument'});
    const browserText=command(process.execPath,[__filename,'--browser-source-child']);
    const browser=JSON.parse(browserText.split('\n').find(l=>l.startsWith('TASK232_BROWSER_RESULTS=')).slice('TASK232_BROWSER_RESULTS='.length));
    write('fixtures.json',{configuration:browser.fixture,serverInputs:browser.inputs});
    const serverText=command(process.execPath,[path.join(__dirname,'test-coop-demon-config.js'),'--server'],ROOT,JSON.stringify(browser.inputs));
    const server=JSON.parse(serverText.split('\n').find(l=>l.startsWith('TASK232_SERVER_RESULTS=')).slice('TASK232_SERVER_RESULTS='.length));
    const stats=[];
    for(const [tier,observations] of [['browser-source',browser.observations],['server-source',server]]) {
      assert.deepEqual(observations.map(o=>o.version),versions);
      for(const {version,rows} of observations) {
        assert.deepEqual(rows.map(r=>r.id),ids);
        for(const observed of rows) {
          const id=`${tier}/${version}/${observed.id}`,want=expectedUnit(observed.id);
          check(id,observed,want);stats.push({id,expected:want,observed,pass:true});
        }
      }
    }
    write('stats.json',{expectedTable,observedTable:table,rows:stats,pass:true});
    for(const repo of [ROOT,SERVER]) {
      const diff=command('git',['diff','--check'],repo);
      fs.writeFileSync(path.join(out,path.basename(repo)+'-diff-check.txt'),diff);
      const staged=command('git',['diff','--cached','--name-only'],repo);
      assert.ok(!staged.split('\n').some(f=>f.startsWith('artifacts/')),'artifacts must remain unstaged');
    }
    identities.after=snapshot();
    assert.deepEqual(identities.after,identities.before,'source changed during invocation');
    write('source-identities.json', {...identities,pass:true});
    assert.deepEqual(checkpoints.map(c=>c.id),cases,'exact selected cases');
    write('checkpoints.json',{checkpoints,pass:checkpoints.every(c=>c.pass)});
    // Re-read on-disk evidence, independently check equality and current hashes.
    const read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
    assert.ok(read('stats.json').rows.length===60 && read('stats.json').rows.every(r=>equal(r.expected,r.observed)));
    assert.deepEqual(read('checkpoints.json').checkpoints.map(c=>c.id),cases);
    for(const c of read('checkpoints.json').checkpoints)assert.deepEqual(c.observed,c.expected);
    for(const [repo,{files}] of Object.entries(read('source-identities.json').after))
      for(const [file,hash] of Object.entries(files))assert.equal(sha(fs.readFileSync(path.join(repo,file))),hash);
    assert.equal(fs.statSync(path.join(out,'removed-selectors-grep.txt')).size,0);
    log('PASS exact-selected-cases=63 constructor-description-cases=60 types=10 metadata-modes=3');
    log('PASS source-hashes-current evidence-readback-equality artifacts-unstaged');
    guard();passed=true;
  } catch(error) {
    log(error.stack);write('checkpoints.json',{checkpoints,pass:false});
    write('source-identities.json',{...identities,pass:false});
  } finally {
    // Synchronous children have exited or were killed/reaped before returning.
    // No services, sockets, timers, browser contexts or temporary DBs are created.
    const cleanup=commands.every(c=>c.signal===null && c.error===null);
    log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup children-reaped=${commands.length} services-created=0`);
    const evidenceHashes=Object.fromEntries(fs.readdirSync(out).filter(n=>n!=='verification.log')
      .map(n=>[n,sha(fs.readFileSync(path.join(out,n)))]));
    write('coverage-results.json',{cases:cases.map(id=>({id,pass:checkpoints.some(c=>c.id===id&&c.pass),proof:'checkpoints.json'})),
      commandExits:commands,sourceIdentities:'source-identities.json',evidenceHashes,pass:passed&&cleanup});
    const elapsedMs=Date.now()-start;
    passed=passed&&cleanup&&elapsedMs<3600000;
    write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs,
      targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup,pass:passed});
    log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
  }
}
