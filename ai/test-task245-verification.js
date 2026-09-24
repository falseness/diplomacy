#!/usr/bin/env node
'use strict';
// Cumulative command/deadline and evidence pattern shared with TASK-236;
// shared real browser/network helpers and explicit static expectations own the assertions.
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
// Capture even module initialization output and stderr in this invocation's log.
for(const stream of [process.stdout,process.stderr]) {
  const original=stream.write.bind(stream);
  stream.write=(chunk,...args)=>{fs.appendFileSync(path.join(out,'verification.log'),chunk);return original(chunk,...args);};
}
const log = s => console.log(s);
const {sourceSnapshot} = require('../../diplomacy_server/tests/reliability/helpers/browser-game');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const commands = [];
const command = (program,args) => {
  assert.ok(Date.now()<stopAt, 'cumulative stop-work deadline');
  log(`COMMAND ${program} ${args.join(' ')}\nCWD=${ROOT}`);
  const journal=path.join(out,`owned-${commands.length}.jsonl`);
  const r = spawnSync(process.execPath,[path.join(__dirname,'task245-supervisor.js'),journal,String(stopAt),program,...args],{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024,
    env:{...process.env,TASK242_STOP_AT:String(stopAt),TASK246_STOP_AT:String(stopAt),TASK238_STOP_AT:String(stopAt),TASK244_STOP_AT:String(stopAt),COOP_EVIDENCE_DIR:path.join(out,"movement")}});
  log(r.stdout || ''); log(r.stderr || ''); log(`ACTUAL_EXIT_STATUS=${r.status}`);
  const supervision=JSON.parse(fs.readFileSync(journal+'.cleanup.json','utf8'));
  commands.push({program,args,cwd:ROOT,exit:r.status,signal:r.signal,error:r.error?.message || null,supervision});
  assert.equal(r.status,0); return r.stdout;
};
const snapshot = () => sourceSnapshot();
const browserCases=['browser-fog-upgraded'];
const fixtureCommands = [
 ['supervisor-cleanup','test-task245-supervisor.js','PASS forced-timeout failure=true detached-processes-stopped=true owned-directories-removed=true sentinel-preserved=true'],
 ["compact-health-bars", "test-compact-health-bars.js", "PASS compact-health-bars literal_cases=15 transitions=5 healing=2 load=1 undo=1"],
 ["coop-demon-ai", "test-coop-demon-ai.js", "PASS rejects-economic-trace-corruption expected_exit=1 observed_exit=1"],
 ["coop-demon-tile-ownership", "test-coop-demon-tile-ownership.js", "PASS rejects-registry-corruption expected_exit=1 observed_exit=1 unit=imp coord=(4,3)"],
 ["coop-demon-town-raze-undo", "test-coop-demon-town-raze-undo.js", "PASS demon-town-raze-undo scenarios=5 snapshots=25 last_town_surviving_units=covered last_human_asset=defeat"],
 ["coop-demon-town-raze", "test-coop-demon-town-raze.js", "PASS demon-town-raze scenarios=8 portal_controls=1 same_action_raze=3 ranged_no_raze=2 temporary_registration=0"],
 ["coop-expanded-recovery", "test-coop-expanded-recovery.js", "PASS expanded-recovery counts=1,4,5,6,7,8,9,10,11,12 first_spawn=4 turn_order=human-only shared_vision=exact current_save=exact terminal=defeat"],
 ["coop-flooding", "test-coop-flooding.js", "PASS rejects-wrong-flood-boundary expected_exit=1 observed_exit=1"],
 ["coop-results", "test-coop-results.js", "PASS rejects-wrong-result expected_exit=1 observed_exit=1"],
 ["coop-serialization", "test-coop-serialization.js", "PASS co-op serialization counts=1,2,4,5,6,7,8,9,10,11,12 types=10 legacy=2 fault_probes=3"],
 ["coop-undo-kills", "test-coop-undo-kills.js", "PASS co-op undo kills scenarios=4 lethal_actions=8 exact_reversals=8 corruption_probes=5"],
 ['portal','test-coop-portal.js','PASS co-op portal fault_probes=2'],
 ['local-round','test-coop-local-round.js','PASS rejects-duplicate-phase expected_exit=1 observed_exit=1'],
 ['save-phase','test-coop-save-phase.js','PASS co-op save-phase snapshots=3 restored=3 typed-wave-no-duplicate'],
 ['bush-movement','test-coop-demon-bush-movement.js','PASS demon-bush-movement'],
 ['fog-movement','test-coop-demon-fog-movement.js','PASS demon-fog-movement'],
 ['map-scaling','test-coop-map-scaling.js','PASS co-op map scaling presets=3 humans=1..12 independent_cases=36 metadata_save_load=3']
];
const {inputs,idOf}=require('./test-task246-maps');
const cases=[...inputs.map(idOf),...require('./test-task240-source').cases,'source/non-coop-landmarks','source/bombard-contract','source/bombard-integration','source/current-demon-stats','source/current-schedule','source/portal-artwork','server/current-protocol',...require('./test-task242-source').cases,...require('./test-task242-interactions').cases.filter(id=>id.startsWith(browserCases[0]+'/')),...require('./test-task243-source').cases,...fixtureCommands.map(([id])=>'fixture/'+id)];
for(const h of [1,2,12])for(let r=1;r<=32;r++)for(const suffix of ['', '/reload-no-duplicate','/marker'])cases.push(`local/H${h}/r${r}${suffix}`);
for(const id of ['blocked-upgrade/12','blocked-upgrade/16','unblock-intermediate-no-backlog','unblock-next-scheduled','placement/occupied','placement/destroyed','placement/terrain'])cases.push('local/'+id);
const scaledCases=[];
for(const [h,size] of [[1,'normal'],[4,'normal'],[12,'tiny'],[12,'normal'],[12,'big']])
 for(const suffix of ['metadata','dimensions-counts','all-registries-and-markers-exact',...(h>1?['eliminated-initial-versus-surviving']:[])])
  scaledCases.push(`scaled/scaled-save-H${h}-${size}-${suffix}`);
cases.push(...scaledCases);
for(const id of browserCases){
 for(const suffix of ['persisted-board-0','persisted-board-1','persisted-board-2','persisted-board-3','fixture-counts','network-participants','network-board-0','network-board-1','browser-board-0','browser-board-1','render-assets-0','render-assets-1','browser-contexts','browser-errors','server-errors','cleanup']) cases.push(id+'/'+suffix);
}
write('verification-plan.json',{estimateMs:1200000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,
 cases,subcases:{mapInputs:inputs,protocol:require('../../diplomacy_server/tests/coop/task244-network').caseIDs,sourceWaveHumans:[1,2,12],sourceWaveRounds:'1..32',scheduleCategories:['melee','ranged','siege','heavy','support','chaos']},tiers:['real Chromium board and stats/back clicks and screenshots','real HTTPS/Socket.IO/MongoDB','source and on-disk evidence audit'],
 fixtures:'Generated seed-1 H1/H4 Normal and H12 Tiny/Normal/Big saves; one authored Tiny/H2/seed1 board with initial mines and demon occupants; round 4; no runtime board mutation.',
 coverage:'Real clicks: empty/occupied mines and portals, hidden unit alone, empty cell, visible control; fog enabled; stats/back after upgrade; real scout movement/undo gains and loses vision with reselection; exact unchanged serialized board, vision, commands, outgoing Socket.IO events and undo during inspection.',
 exclusions:['Long natural games','Cartesian join/seed/map-size products','Rendering stress','Exhaustive reliability profile (not run or claimed)' , 'Historical evidence not reused'],
 commands:[...fixtureCommands.map(([,file])=>'node20 ai/'+file),'node20 ai/test-task245-source.js <run> (current demon stats, local/server bombard fixtures, typed schedule, portal art, task244 protocol)','node20 ai/test-task240-source.js <run>/portal-ui','node20 ai/test-task246-maps.js --output-dir <run>/matrix','node20 ai/test-task243-source.js <run>','node20 ai/test-task238-source.js local <run>','node20 ai/test-coop-scaled-save.js','node20 ai/test-task242-source.js <run>','node20 ai/test-task242-browser.js <run> browser-fog-upgraded','git diff --check','git diff --cached --name-only','source and evidence audit including cleanup']});
log(`COMMAND NODE_PATH=${process.env.NODE_PATH || ''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version}\nV8=${process.versions.v8}\nBROWSER=Chromium version logged by browser child`);
const before = snapshot();
let passed = false, checkpoints = [];
try {
  const head = command('git',['rev-parse','HEAD']).trim();
  write('source-identities.json',{head,files:before,pass:false});
  require('./test-task243-inventory')(out);
  command(process.execPath,[path.join(__dirname,'test-task245-source.js'),out]);
  checkpoints.push(...read('integrated-source.json').checkpoints);
  const uiOut=path.join(out,'portal-ui');fs.mkdirSync(uiOut);
  command(process.execPath,[path.join(__dirname,'test-task240-source.js'),uiOut]);
  checkpoints.push(...read('portal-ui/source-checkpoints.json').checkpoints);

  for(const [id,file,marker] of fixtureCommands) {
    const output=command(process.execPath,[path.join(__dirname,file)]);
    fs.writeFileSync(path.join(out,'fixture-'+id+'.log'),output);
    const observed={exit:commands.at(-1).exit,marker:output.split('\n').find(line=>line===marker)};
    const expected={exit:0,marker};assert.deepEqual(observed,expected,id);
    checkpoints.push({id:'fixture/'+id,observed,expected,pass:true});
  }
  command(process.execPath,[path.join(__dirname,'test-task243-source.js'),out]);
  checkpoints.push(...read('save-load-checkpoints.json').checkpoints);
  command(process.execPath,[path.join(__dirname,'test-task238-source.js'),'local',out]);
  checkpoints.push(...read('local.json').checks);
  const scaledLog=command(process.execPath,[path.join(__dirname,'test-coop-scaled-save.js')]);
  const scaledRows=scaledLog.split('\n').filter(line=>line.startsWith('{"name":')).map(line=>JSON.parse(line));
  assert.deepEqual(scaledRows.map(row=>'scaled/'+row.name),scaledCases);
  checkpoints.push(...scaledRows.map(row=>({id:'scaled/'+row.name,observed:row.observed,expected:row.expected,pass:require('node:util').isDeepStrictEqual(row.observed,row.expected)})));
  command(process.execPath,[path.join(__dirname,'test-task242-source.js'),out]);
  checkpoints.push(...read('source-checkpoints.json').checkpoints);
  command(process.execPath,[path.join(__dirname,'test-task242-browser.js'),out,browserCases[0]]);
  const browser=read('browser-results.json');
  assert.deepEqual(browser.cases,browserCases);assert.equal(browser.pass,true);
  checkpoints.push(...read('browser-checkpoints.json').checkpoints);
  command(process.execPath,[path.join(__dirname,'test-task246-maps.js'),'--output-dir',path.join(out,'matrix')]);
  const maps=read('matrix/maps.json');
  assert.deepEqual(maps.map(m=>m.id),inputs.map(idOf));
  const matrixChecks=read('matrix/checkpoints.json').checkpoints;
  for(const c of matrixChecks){assert(c.pass,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  checkpoints.push(...maps.map(m=>({id:m.id,expected:{identical:true,valid:true,portals:10*m.input.h},observed:{identical:m.identical,valid:m.contract.valid,portals:m.map.portals.length},pass:true})));
  for(const c of checkpoints){assert.equal(c.pass,true,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
  for(const row of browser.rows)assert.ok(fs.statSync(path.join(out,row.screenshot)).size>1000);
  assert.equal(browser.rows.length,12);
  const rows=read('selection-observations.json').rows;assert.deepEqual(rows,browser.rows);
  assert.deepEqual(checkpoints.map(c=>c.id).sort(),[...cases].sort(),'exact case inventory');
  for(const id of cases)assert.equal(checkpoints.filter(c=>c.id===id&&c.pass).length,1,id);
  for(const row of rows){const b=fs.readFileSync(path.join(out,row.screenshot));assert.equal(b.subarray(1,4).toString(),'PNG');}
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
  write('checkpoints.json',{checkpoints,matrixChecks,pass:true});
  write('coverage.json',{expected:cases,executed:checkpoints.map(c=>c.id),pass:true,exhaustiveProfile:false,priorEvidenceReused:false});
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
  for(const file of ['removed-runtime-rg.txt','removed-fixture-rg.txt']) assert.equal(fs.statSync(path.join(out,file)).size,0);
  log('PASS matrix inputs=40 generated=80 categories=3:3:1:1:1:1 fairness=pass distances=pass approaches=pass');
  log('PASS obsolete-fixtures-absent typed-portal lifecycle local-round save-phase bush-movement fog-movement map-scaling');
  log('PASS obsolete-runtime-absent current-save-load wave-boundaries=96 obsolete-rejections=12');
  log(`PASS evidence-audit cases=${cases.length} checkpoints=${checkpoints.length} building-selection=pass hidden-unit-selection=absent captures=12`);
  log('PASS source-hashes-current artifacts-unstaged diff-check-empty');
  assert.ok(Date.now()<stopAt); passed=true;
} catch(e) {log(e.stack);}
finally {
  const cleanup=commands.every(c=>c.signal===null && c.error===null && c.supervision.cleanup && !c.supervision.timedOut) && browserCases.every(id=>{const f=path.join(out,id,'cleanup.json');if(!fs.existsSync(f))return false;const c=JSON.parse(fs.readFileSync(f));return c.browserClosed&&c.clientClosed&&c.cleanup?.processes.every(p=>!p.aliveAfter)&&c.cleanup.directories.every(d=>!d.existsAfter);});
  log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup synchronous-children-reaped=${commands.length} browser-and-network-services-reaped`);
  if(passed&&cleanup){
    for(const f of ['verification-plan.json','source-identities.json','checkpoints.json','selection-observations.json','removal-inventory.json','remaining-references-rg.txt','save-load-checkpoints.json','obsolete-rejection-payloads.json','local.json','coverage.json','integrated-source.json'])
      assert.ok(fs.statSync(path.join(out,f)).size>0,f);
    log('PASS final-audit required-files-present exact-case-inventory source-hashes screenshots-PNG cleanup=true');
  }
  const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(f=>f!=='verification.log'&&fs.statSync(path.join(out,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(out,f)))]));
  passed=passed&&cleanup&&Date.now()-start<3600000;
  write('coverage-results.json',{cases:cases.map(id=>({id,pass:passed,proof:['checkpoints.json']})),
    assertionIds:checkpoints.map(c=>c.id),commandExits:commands,evidenceHashes,pass:passed});
  write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,
    targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup,pass:passed});
  log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
}
