// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Validate serialized execution evidence, never infer a current run from archived pass flags.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
function reviewLifecycle(dir,cases,boundManifest,receipt=null){
 const proofs={},checks=[];
 const file=n=>{A.proofKey(dir,n,boundManifest);proofs[n]=boundManifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8');
 const check=(id,e,o)=>{assert.deepEqual(o,e,'sequence-lifecycle/'+id);checks.push({id:'lifecycle/'+id,expected:structuredClone(e),observed:structuredClone(o),pass:true});};
 const plan=read('verification-plan.json'),budget=read('verification-budget.json'),child=read('child-results.json'),ids=read('source-identities.json'),log=text('verification.log');
 check('cases',cases,plan.cases);
 check('focused-tier','competitive-actions-0/attack-exact (initial local hotseat fixture; UI only)',plan.focusedCase);
 check('source-tier','geometry/expected-state oracle self-checks; browser assertions execute shipped production source',plan.sourceTier);
 check('exclusions',['optional 100-trajectory/200-action diagnostic','class Cartesian products','long natural combat games','terminal guarantee'],plan.exclusions);
 check('bounds',[3600000,3300000,2700000,3600000,3300000],[plan.budgetMs,plan.stopWorkMs,budget.targetMs,budget.budgetMs,budget.stopWorkMs]);
 check('estimate',true,Number.isFinite(plan.estimateMs)&&plan.estimateMs>0&&plan.estimateMs<=2700000);
 const start=Date.parse(budget.startedAt),end=Date.parse(budget.finishedAt);
 check('elapsed',true,Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=3600000&&Math.abs(end-start-budget.elapsedMs)<=2);
 check('budget-outcome',[[0],true,true],[budget.exits,budget.cleanup,budget.pass]);
 for(const repo of ['client','server'])check('stable-tested-sources/'+repo,ids.before[repo].files,ids.after[repo].files);
 check('reported-stale',[],ids.stale);
 check('child-count',1,child.children.length);
 const c=child.children[0];
 check('suite','tests/reliability/sequence-exploration.test.js',c.file);
 check('suite-hash',[ids.before.server.files[c.file],ids.after.server.files[c.file]],[c.suiteSha256.before,c.suiteSha256.after]);
 check('child-exit',[0,null,false],[c.exitCode,c.signal,c.timedOut]);
 check('child-tap',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},c.tap.summary);
 check('child-case',[{name:'four seeded legal UI trajectories',ok:true,directive:null}],c.tap.cases);
 check('child-envelope',true,Date.parse(c.startedAt)>=start&&Date.parse(c.finishedAt)<=end&&Math.abs(Date.parse(c.finishedAt)-Date.parse(c.startedAt)-c.durationMs)<=2);
 check('command-suite',['--suite','sequence-exploration','--output-dir',child.outputDir],child.invocation.argv.slice(2));
 check('command-cwd',A.root,child.invocation.cwd);
 check('literal-command',true,log.startsWith('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+child.invocation.argv.join(' ')+'\nCWD='+A.root+'\nNODE='+child.invocation.node+'\n'));
 const streams=['stdoutPath','stderrPath'].map(k=>text(path.relative(child.outputDir,c[k])));
 check('complete-child-streams',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));
 const commands=cases.map(v=>({id:v.id,program:child.invocation.argv[0],args:['--test',v.mode==='coop'?'tests/reliability/helpers/natural-coop-browser.js':'tests/reliability/natural-competitive.test.js'],cwd:A.root}));
 check('planned-commands',commands,plan.commands);
 check('required-commands',[...commands,'git diff --check in client and server','source/evidence/cleanup audit'],plan.requiredCommands);
 for(const [i,v] of cases.entries()){
  const prefix=v.mode==='coop'?v.id:v.id+'/'+(v.fog?'competitive-1-tiny-deathmatch-h2-fog-on-simultaneous':'competitive-1-tiny-deathmatch-h2-fog-off-sequential');
  const ck=(id,e,o)=>check(v.id+'/'+id,e,o),life=read(prefix+(v.mode==='coop'?'/lifecycle.json':'/service-lifecycle.json')),cleanup=read(prefix+'/cleanup.json');
  ck('command',commands[i],read(v.id+'/command.json'));ck('exit',{exit:0,signal:null,error:null},read(v.id+'/exit.json'));
  const stdout=text(v.id+'/stdout.log');text(v.id+'/stderr.log');
  for(const [name,count] of [['tests',v.mode==='coop'?2:1],['pass',v.mode==='coop'?2:1],['fail',0],['cancelled',0],['skipped',0],['todo',0]])ck('tap-'+name,[String(count)],[...stdout.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))].map(m=>m[1]));
  ck('runtime',true,['node','chromium','playwright'].every(k=>new RegExp('"'+k+'":"v?\\d+\\.\\d+').test(stdout)));
  ck('ready',[1,200,true,true,true],[life.readiness.database.ping,life.readiness.https.statusCode,life.readiness.https.authorized,life.readiness.https.engineHandshake,life.readiness.socketIo.connected]);
  ck('isolated-endpoints',true,Object.values(life.endpoints).every(s=>/^(https|mongodb):\/\/127\.0\.0\.1:\d+$/.test(s))&&/^diplomacy_test_/.test(life.databaseName));
  ck('cleanup-envelope',true,Date.parse(life.startedAt)>=Date.parse(c.startedAt)&&Date.parse(cleanup.startedAt)>=Date.parse(life.startedAt)&&Date.parse(cleanup.finishedAt)>=Date.parse(cleanup.startedAt)&&Date.parse(cleanup.finishedAt)<=Date.parse(c.finishedAt)&&life.stoppedAt===cleanup.finishedAt);
  ck('owned-roles',['mongod','server'],life.processes.map(p=>p.role).sort());
  ck('cleanup-identities',life.processes.map(p=>[p.role,p.pid]).sort(),cleanup.processes.map(p=>[p.role,p.pid]).sort());
  ck('cleanup-exits',life.processExits,cleanup.processes.map(p=>({role:p.role,pid:p.pid,exit:p.exit})));
  ck('cleanup-dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));
  ck('directory-identities',life.temporaryDirectories,cleanup.directories.map(({role,path})=>({role,path})));
  ck('cleanup-directories',[false,false],cleanup.directories.map(p=>p.existsAfter));ck('cleanup-clients',0,cleanup.clients);
  ck('browser-errors',[],read(prefix+'/browser-errors.json'));const navigation=read(prefix+'/navigation-errors.json');
  ck('navigation-errors',[],navigation.filter(e=>!(e.type==='requestfailed'&&e.text==='net::ERR_ABORTED'&&e.url.startsWith(life.endpoints.https+'/socket.io/')&&e.expectedCancellation===true)));
  if(v.mode==='competitive'&&!v.fog)ck('attack-navigation-errors',[],read(prefix+'/attack-navigation-errors.json'));
  ck('service-stderr',{mongod:'',server:''},life.stderr);
  ck('server-errors',[],text(prefix+(v.mode==='coop'?'/coop/services/server.log':'/services/server.log')).split('\n').filter(l=>/Error handling|Unhandled|TypeError|AssertionError|ReferenceError|RangeError/.test(l)));
  const served=read(prefix+'/served-sources.json');ck('served-count',true,Object.keys(served).length>50);
  for(const [n,h] of Object.entries(served)){assert(ids.after.client.files[n],'sequence-lifecycle/unidentified-served-source:'+n);ck('served/'+n,ids.after.client.files[n],h);}
  const inputs=text(prefix+(v.mode==='coop'?'/input-traces.jsonl':'/input-trace.jsonl')).trim().split('\n').map(JSON.parse);
  for(const [label,count] of [['buy noob',2],['undo buy',2],['end turn',4]])ck('input/'+label,count,inputs.filter(r=>r.label===label&&r.via==='mouse.click').length);
  ck('input/moves',4,inputs.filter(r=>r.label?.startsWith(v.mode==='coop'?'legal single-step move':'first legal move')&&r.via==='mouse.click').length);
  ck('input/reconnect',1,inputs.filter(r=>r.action==='reload'&&r.label==='identity reconnect').length);
  ck('input/time-envelope',true,inputs.every(r=>Date.parse(r.at)>=Date.parse(life.startedAt)&&Date.parse(r.at)<=Date.parse(cleanup.startedAt)));
 }
 for(const repo of [A.client,A.root])check('diff-and-staging/'+repo,true,log.includes('PASS '+repo+':diff-check')&&log.includes('PASS '+repo+':artifacts-unstaged'));
 for(const r of read('checkpoints.json').checkpoints)check('persisted/'+r.id,r.expected,r.observed);
 const sourceDifferences=A.compareSources(ids);
 const unresolved=[];
 if(sourceDifferences.length)unresolved.push('current-source-mismatch');
 if(!receipt)unresolved.push('independent-parent-OS-receipt-missing');
 else{
  assert.equal(A.hash(receipt.file),receipt.sha256,'sequence-lifecycle/receipt-hash');proofs[receipt.file]=receipt.sha256;
  const actual=A.read(receipt.file);check('parent-os-exit',[0,null],[actual.actualExit,actual.signal]);check('parent-argv',child.invocation.argv,actual.argv);check('parent-cwd',A.root,actual.cwd);
  check('parent-envelope',true,require('./review_camera_evidence').timingWithinReceipt(budget,actual));
 }
 return {checks,proofs,sourceDifferences,unresolved,fullCriterionReview:false,tier:'source reader of archived execution records; no new service or browser execution'};
}
module.exports={reviewLifecycle};
