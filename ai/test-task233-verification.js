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
const {cases:attackCases,fixture,expected:expectedAttack}=require('./test-bombard');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>{try {assert.deepEqual(a,b);return true;}catch{return false;}};
main();
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
  const cases=['stats','save-roundtrip',...['browser-source','server-source'].flatMap(t=>attackCases.map(c=>`${t}/${c.id}`)), 'network-sequential-fog-false','network-simultaneous-fog-true'];
  write('verification-plan.json',{estimateMs:300000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
    cases,tier:'shipped source commands, actual server loader, real HTTPS/Socket.IO/MongoDB automatic siege',
    exclusions:['No browser UI/rendering claims; zero browser journeys','No full class/seed/map Cartesian product','No long natural games or stress'],
    commands:['browser-source child','server loader child','network child: two humans, tiny map, seed 1, sequential/fog off and simultaneous/fog on','git diff --check (client and server)','source/evidence audit'],
    browserVersion:'not applicable: source VM and network clients',fixtures:'fixtures.json and network-*-fixture.json are declared setup'});
  process.env.TASK233_STOP_AT=String(start+3300000);
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
    write('fixtures.json',{fixture,cases:attackCases});
    const parse=text=>JSON.parse(text.split('\n').find(l=>l.startsWith('TASK233_RESULTS=')).slice(16));
    const browser=parse(command(process.execPath,[path.join(__dirname,'test-bombard.js')]));
    const server=parse(command(process.execPath,[path.join(__dirname,'test-bombard.js'),'--server'],ROOT,JSON.stringify(browser.input)));
    const stats=browser.rows[0].stats;
    check('stats',stats,{hp:4,damage:0,buildingDamage:4,speed:2,range:2,salary:0,heal:0,role:'DEMONS',economy:false,recruitable:false,
      description:{hp:4,'heal speed':0,dmg:'0\nbuilding dmg: 4',speed:2,salary:0,range:'2 - 2',target:'enemy buildings only'},
      info:{name:'bombard',info:{hp:'4 / 4',dmg:'0\nbuilding dmg: 4',moves:'2 / 2',range:'2 - 2',target:'enemy buildings only'},displayName:'bombard',canSkipMoves:true},saveClass:true});
    check('save-roundtrip',browser.roundtrip,{name:'bombard',hp:4,moves:2,range:2,owner:3,interaction:true});
    assert.deepEqual(server.rows[0].stats,stats);
    const rows=[];
    for(const [tier,observations] of [['browser-source',browser.rows],['server-source',server.rows]]) {
      assert.deepEqual(observations.map(r=>r.id),attackCases.map(c=>c.id));
      for(let i=0;i<observations.length;i++) {
        const row=observations[i],want=expectedAttack(row,attackCases[i]),id=`${tier}/${row.id}`;
        rows.push({...row,id,expected:want});
        write('attacks.json',{rows});
        check(id,{before:row.before,after:row.after,command:row.command,incoming:row.incoming},want);
      }
    }
    write('attacks.json',{rows,pass:true});
    // Reserve startup, the bounded three-minute scenario, and service cleanup
    // before launching detached services; never let the outer child deadline
    // cut off the lifecycle helper while it owns processes.
    assert.ok(start+3300000-Date.now()>300000,'insufficient cumulative budget for network setup and cleanup');
    command(process.execPath,[path.join(__dirname,'test-bombard-network.js'),out]);
    const network=JSON.parse(fs.readFileSync(path.join(out,'network-attacks.json'),'utf8'));
    for(const row of network.rows)check(row.id,[...row.observed,row.persisted],Array(3).fill(row.expected));
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
    assert.equal(read('attacks.json').rows.length,attackCases.length*2);
    assert.deepEqual(read('checkpoints.json').checkpoints.map(c=>c.id),cases);
    for(const c of read('checkpoints.json').checkpoints)assert.deepEqual(c.observed,c.expected);
    for(const [repo,{files}] of Object.entries(read('source-identities.json').after))
      for(const [file,hash] of Object.entries(files))assert.equal(sha(fs.readFileSync(path.join(repo,file))),hash);
    for(const repo of [ROOT,SERVER]) assert.equal(fs.statSync(path.join(out,path.basename(repo)+'-diff-check.txt')).size,0);
    log('PASS exact-selected-cases=46 source-command-cases=42 network-cases=2');
    log('PASS source-hashes-current evidence-readback-equality artifacts-unstaged');
    guard();passed=true;
  } catch(error) {
    log(error.stack);write('checkpoints.json',{checkpoints,pass:false});
    write('source-identities.json',{...identities,pass:false});
  } finally {
    // Synchronous children have exited or were killed/reaped before returning.
    // The network lifecycle helper reports its owned services and temporary DB cleanup.
    const networkCleanup=fs.existsSync(path.join(out,'network-cleanup.json')) ? JSON.parse(fs.readFileSync(path.join(out,'network-cleanup.json'),'utf8')).cleanup : null;
    const cleanup=commands.every(c=>c.signal===null && c.error===null) && !!networkCleanup &&
      networkCleanup.processes.every(p=>!p.aliveAfter) && networkCleanup.directories.every(d=>!d.existsAfter);
    log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup children-reaped=${commands.length} network service cleanup recorded in network-cleanup.json`);
    const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(n=>n!=='verification.log' && fs.statSync(path.join(out,n)).isFile())
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
