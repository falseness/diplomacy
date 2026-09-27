'use strict';
// Clause-specific review of original fog records. Saved coverage verdicts are
// never expectations; the visibility reader independently derives the worlds.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_fog_visibility');
const RECEIPT={file:path.join(A.client,'artifacts/TASK-225/review-77/verification-budget.json'),sha256:'6e28a3fc16e89e11c384fdee2bd75389d3489e5235f8b976be80f09618a27f75'};
function review(number,dir,manifest,receipt=RECEIPT){
 assert([4,5,6,7,8].includes(number),'unknown-fog-record-criterion');
 const checks=[],proofs={},check=(id,expected,observed)=>{assert.deepEqual(observed,expected,'fog-records/AC'+number+'/'+id);checks.push({id:'fog-records/AC'+number+'/'+id,expected,observed,pass:true});};
 const file=n=>{const key=A.proofKey(dir,n,manifest);proofs[key]=manifest[key];return path.join(dir,key);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8');
 const plan=read('verification-plan.json'),coverage=read('original-coverage.json'),cp=read('checkpoints.json').checkpoints;
 check('selected-cases',F.CASES,coverage.cases.map(c=>c.id));check('declared-cases',F.CASES,plan.cases.map(c=>c.id));
 const identities=read('source-identities.json');check('current-sources',[],A.compareSources(identities));
 const observed=id=>{const rows=cp.filter(c=>c.id===id);assert.equal(rows.length,1,'missing-or-duplicate-checkpoint:'+id);return rows[0].observed;};
 if(number===4){
  assert.deepEqual(receipt,RECEIPT,'wrong-fog-command-receipt');check('receipt-hash',receipt.sha256,A.hash(receipt.file));proofs[receipt.file]=receipt.sha256;
  const children=read('child-results.json'),log=text('verification.log'),inv=children.invocation;
  check('cwd','/root/diplomacy_server',inv.cwd);check('command-selector',['--suite','fog-recovery','--output-dir'],inv.argv.slice(2,5));
  check('literal-command',true,log.includes('COMMAND '+inv.argv.join(' ')));check('literal-runtime',true,log.includes('CWD='+inv.cwd+'\nNODE='+inv.node));
  check('one-child',1,children.children.length);
  for(const child of children.children){
   check('child-command',true,log.includes('CHILD_COMMAND '+child.command.argv.join(' ')+' CWD='+inv.cwd));
   check('child-exit',[0,null,false],[child.exitCode,child.signal,child.timedOut]);
   const streams=['stdoutPath','stderrPath'].map(k=>{const n=path.relative(children.outputDir,child[k]);assert(!n.startsWith('..')&&!path.isAbsolute(n),'escaped-fog-stream');return text(n);});
   check('full-output-and-exit',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));
   check('named-test-and-no-skips',true,streams[0].includes('ok 1 - bounded recipient visibility actions and recovery\n')&&['tests 1','fail 0','skipped 0','cancelled 0','todo 0'].every(s=>streams[0].includes('# '+s+'\n')));
  }
  const commands=A.read(receipt.file).commands.filter(c=>c.argv.includes('fog-recovery')&&c.argv.at(-1)===children.outputDir);
  check('one-provider-receipt',1,commands.length);check('actual-provider-exit',[0,null],[commands[0].actualExit,commands[0].signal]);
  check('runtime-records',Array(2).fill({node:'v20.20.2',chromium:'125.0.6422.26',playwright:'1.44.1',services:{node:'v20.20.2',mongod:'db version v7.0.37',socketIoClient:'4.8.3',platform:'linux 5.15.0-113-generic'}}),[...log.matchAll(/^# runtime (.+)$/gm)].map(m=>JSON.parse(m[1])));
  check('checkpoint-count',91,cp.length);check('unique-checkpoints',91,new Set(cp.map(c=>c.id)).size);
  for(const c of cp){check('checkpoint/'+c.id,c.expected,c.observed);check('checkpoint-pass/'+c.id,true,c.pass);}
  // Recompute, rather than accepting the saved independent review or provider's
  // matching expected/observed pair. All visibility records are independently read.
  const v=read('visibility-checkpoints.json'),traces={},inputs={};
  for(const c of F.BROWSER){traces[c]=text(c+'/network-traces.jsonl').trim().split('\n').map(JSON.parse);inputs[c]=text(c+'/input-trace.jsonl').trim().split('\n').map(JSON.parse);}
  const semantic=F.analyze(v,cp,traces,inputs);check('independent-visibility-assertions',550,semantic.checks.length);
  for(const c of semantic.checks)checks.push({...c,id:'fog-records/AC4/independent/'+c.id});
  for(const c of F.BROWSER)for(const suffix of ['actions.png','reconnected.png']){
   const names=Object.keys(manifest).filter(n=>n.startsWith('screenshots/'+c+'-')&&n.endsWith(suffix));check('capture-count/'+c+'/'+suffix,1,names.length);
   check('png/'+c+'/'+suffix,'89504e470d0a1a0a',fs.readFileSync(file(names[0])).subarray(0,8).toString('hex'));
  }
  let redacted=0;
  function walk(value,where){
   if(typeof value==='string'){
    // Socket.IO frames contain nested JSON strings. Inspect these too.
    const s=value.startsWith('42[')?value.slice(2):value;
    if(s.startsWith('{')||s.startsWith('[')){let parsed;try{parsed=JSON.parse(s);}catch{}if(parsed&&typeof parsed==='object')walk(parsed,where+'/encoded');}return;
   }
   if(!value||typeof value!=='object')return;
   for(const [k,v] of Object.entries(value)){if(/^(password|privateKey|userId)$/i.test(k)){check('redaction/'+where+'/'+k,true,['[redacted]','[secret-1]','[secret-2]'].includes(v));redacted++;}walk(v,where+'/'+k);}
  }
  for(const c of F.BROWSER){
   traces[c].forEach((r,i)=>walk(r,c+'/'+i));
   inputs[c].forEach((r,i)=>{if(/password/i.test(r.label||''))check('password-coordinate/'+c+'/'+i,false,Object.hasOwn(r,'x')||Object.hasOwn(r,'y'));});
  }
  check('credential-redaction-observed',true,redacted>0);
  for(const n of Object.keys(manifest).filter(n=>/\.(jsonl|log)$/.test(n))){const t=text(n);check('no-private-key/'+n,false,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(t));check('no-numeric-password/'+n,false,/"password"\s*:\s*"[0-9]+"/.test(t));}
  for(const repo of [A.client,A.root])check('unstaged/'+repo,true,log.includes('PASS artifacts-unstaged:'+repo));
  check('historical-unmodified',[],children.historicalEvidence.modified);
 }
 if(number===5||number===6){
  const visibility=read('visibility-checkpoints.json'),traces={},inputs={};
  for(const c of F.BROWSER){traces[c]=text(c+'/network-traces.jsonl').trim().split('\n').map(JSON.parse);inputs[c]=text(c+'/input-trace.jsonl').trim().split('\n').map(JSON.parse);check('participants/'+c,2,observed(c+'/participants'));}
  for(const c of F.analyze(visibility,cp,traces,inputs).checks)checks.push({...c,id:'fog-records/AC'+number+'/independent/'+c.id});
  if(number===5){
   assert.deepEqual(receipt,RECEIPT,'wrong-fog-command-receipt');check('receipt-hash',receipt.sha256,A.hash(receipt.file));proofs[receipt.file]=receipt.sha256;
   const child=read('child-results.json'),parent=A.read(receipt.file),commands=parent.commands.filter(c=>c.argv.includes('fog-recovery')&&c.argv.at(-1)===child.outputDir);
   check('provider-command-exits',[[0,null]],commands.map(c=>[c.actualExit,c.signal]));
   check('child-outcomes',[[0,null,false]],child.children.map(c=>[c.exitCode,c.signal,c.timedOut]));
   check('required-tap-summary',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},child.children[0].tap.summary);
   for(const c of coverage.cases)check('case-pass/'+c.id,true,c.pass);
   for(const c of F.BROWSER){check('browser-errors/'+c,[],read(c+'/browser-errors.json'));check('server-errors/'+c,[],text(c+'/services/server.log').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)));check('proxy-errors/'+c,[],observed(c+'/proxy-errors'));
    for(const n of ['navigation-errors.json',...(c==='competitive-clear'?['peer-navigation-errors.json']:[])])for(const [i,e] of read(c+'/'+n).entries())check('expected-navigation-abort/'+c+'/'+n+'/'+i,true,e.type==='requestfailed'&&e.text==='net::ERR_ABORTED'&&/^https:\/\/(127\.0\.0\.1|localhost):\d+\/socket\.io\//.test(e.url));
   }
   for(const [n,sha] of [['verification-budget.json','daa2f9893357ecaf6f14ce0b9f9e3a6779b3344b070f92b55c23d094a92e12ef'],['checkpoints.json','b089adf5b359919819e2bb1bf25c4c40eff016d04e6ab30b4b377268824bcf81']]){const f=path.join(A.client,'artifacts/TASK-212/green-06',n);check('original-failure-hash/'+n,sha,A.hash(f));proofs[f]=sha;}
   check('original-failed-exit',[1],A.read(path.join(A.client,'artifacts/TASK-212/green-06/verification-budget.json')).exits);
   check('original-selection-failure',[['coop-fog/round/p1/selection-live',true,false]],A.read(path.join(A.client,'artifacts/TASK-212/green-06/checkpoints.json')).checkpoints.filter(c=>!c.pass).map(c=>[c.id,c.expected,c.observed]));
  }else{
   const source=n=>{const f=path.join(A.root,n);check('source/'+n,identities.after.server.files[n],A.hash(f));proofs[f]=A.hash(f);return fs.readFileSync(f,'utf8');};
   const suite=source('tests/reliability/fog-recovery.test.js'),browser=source('tests/reliability/helpers/fog-recovery-browser.js');
   check('source-tiers',Array(4).fill('shipped source; independent visibility oracle'),plan.cases.slice(0,4).map(c=>c.tier));
   check('browser-tiers',Array(2).fill('real HTTPS/Socket.IO/MongoDB; shipped browser mouse input'),plan.cases.slice(4).map(c=>c.tier));
   check('real-service-and-browser',true,browser.includes('await withServices(')&&browser.includes('await chromium.launch(')&&browser.includes('service.mongo.db(service.databaseName)'));
   check('source-fixture-production-execution',true,suite.includes('createFixture(shared.config')&&suite.includes('players[whooseTurn].changeFogOfWarByVision()'));
   check('declared-before-admission',true,browser.indexOf('const board=initial(c)')<browser.indexOf("s.client.emit('startGameOrConnect'"));
   check('no-browser-state-evaluation',0,(browser.match(/\.evaluate\(/g)||[]).length);
   check('no-fake-time-or-response',false,/\.fulfill\(|clock\.install|clock\.pause|setSystemTime|useFakeTimers/.test(browser+suite));
   check('normal-input-actions',true,browser.includes("'move scout'")&&browser.includes("'lethal combat'")&&browser.includes("p.tapControl('nextTurnButton','commit visibility actions'"));
   for(const c of F.BROWSER){check('no-ai/'+c,false,read(c+'/declared-fixture.json').b.gameSettings.withAI);check('real-mongo/'+c,true,text(c+'/services/activity.jsonl').includes('"source":"mongodb","message":"ping ok"'));check('commits/'+c,2,traces[c].filter(r=>r.stage==='outgoing-turn').length);check('durable-round/'+c,[1],traces[c].filter(r=>r.stage==='durable-round').map(r=>r.stored.gameRound));}
  }
 }
 if(number===7){
  check('source-pairings',[[false,false],[false,true],[true,false],[true,true]],plan.cases.slice(0,4).map(c=>[c.coop,c.fog]));
  check('bounded-browser-pairings',[[true,true,'simultaneous',2,'tiny',1],[false,false,'sequential',2,'tiny',1]],plan.cases.slice(4).map(c=>[c.coop,c.fog,c.join,c.humans,c.size,c.seed]));
  check('diagnostic-exclusions',['Cartesian browser matrices','long natural games','high-count rendering'],plan.exclusions);
  for(const c of F.BROWSER){const fixture=read(c+'/declared-fixture.json'),spec=fixture.spec,b=fixture.b;
   check('fixture-contract/'+c,[2,'tiny',1,14],[spec.humans,spec.size,spec.seed,spec.side]);check('no-ai/'+c,false,b.gameSettings.withAI);
   check('connected-humans/'+c,2,observed(c+'/participants'));check('initial-dimensions/'+c,[14,14],[b.grid.length,b.grid[0].length]);
   const trace=text(c+'/network-traces.jsonl').trim().split('\n').map(JSON.parse),joins=trace.filter(r=>r.stage==='api-join');
   check('actual-join-mode/'+c,[c==='coop-fog'?'simultaneous':'sequential',c==='coop-fog'?'simultaneous':'sequential'],joins.map(r=>r.join));
   check('slots/'+c,[1,2],joins.map(r=>r.board.whooseTurn).sort());check('actual-fog/'+c,[c==='coop-fog',c==='coop-fog'],joins.map(r=>r.board.isFogOfWar));
   check('durable-round/'+c,[1],trace.filter(r=>r.stage==='durable-round').map(r=>r.stored.gameRound));
  }
  const v=read('visibility-checkpoints.json'),traces={},inputs={};for(const c of F.BROWSER){traces[c]=text(c+'/network-traces.jsonl').trim().split('\n').map(JSON.parse);inputs[c]=text(c+'/input-trace.jsonl').trim().split('\n').map(JSON.parse);}
  for(const c of F.analyze(v,cp,traces,inputs).checks)checks.push({...c,id:'fog-records/AC7/independent/'+c.id});
 }
 if(number===8){
  const budget=read('verification-budget.json'),children=read('child-results.json');
  check('estimate-within-target',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  check('wall-clock',Date.parse(budget.finishedAt)-Date.parse(budget.startedAt),budget.elapsedMs);
  check('within-hour',true,budget.elapsedMs>0&&budget.elapsedMs<=3600000);check('actual-exits',[0],budget.exits);
  check('child-start-within-budget',true,Date.parse(children.startedAt)>=Date.parse(budget.startedAt));
  for(const child of children.children){check('child-end-within-budget',true,Date.parse(child.finishedAt)<=Date.parse(budget.finishedAt));check('no-timeout',false,child.timedOut);check('exit',0,child.exitCode);}
  for(const c of F.BROWSER){const clean=read(c+'/cleanup.json');check('owned-roles/'+c,['server','mongod'],clean.processes.map(p=>p.role));check('owned-dead/'+c,[false,false],clean.processes.map(p=>p.aliveAfter));check('owned-dirs-removed/'+c,[false,false],clean.directories.map(d=>d.existsAfter));check('cleanup-time/'+c,true,Date.parse(clean.startedAt)>=Date.parse(budget.startedAt)&&Date.parse(clean.finishedAt)<=Date.parse(budget.finishedAt));}
  const source=n=>{const f=path.join(A.root,n);check('source/'+n,identities.after.server.files[n],A.hash(f));proofs[f]=A.hash(f);return fs.readFileSync(f,'utf8');};
  const runner=source('tests/reliability/run.js'),suite=source('tests/reliability/fog-recovery.test.js');
  check('one-cumulative-start',true,runner.includes('const competitiveStartedMs = Date.now()')&&runner.includes('competitiveStartedMs + 3300000'));
  check('inherited-deadline',true,runner.includes('env.OPENING_COMPETITIVE_STOP_AT = String(context.competitiveDeadline - 240000)')&&suite.includes("Date.now()<Number(process.env.OPENING_COMPETITIVE_STOP_AT)"));
  check('predeclared-plan',true,suite.indexOf("json('verification-plan.json'")<suite.indexOf('for(const c of sourceCases)'));
  const log=text('verification.log');for(const repo of [A.client,A.root])check('diff-check/'+repo,true,log.includes('PASS diff-check:'+repo));
  for(const n of Object.keys(coverage.evidenceHashes))file(n);
  for(const c of coverage.cases)check('case-pass/'+c.id,true,c.pass);
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-fog-record-check');
 return {checks,proofs,scope:'Complete TASK-212/AC'+number,derivation:'Original hash-bound command, runtime, complete streams, case declarations, independent raw-world expectations and cleanup records are checked against explicit clause-specific expectations. Provider OS exit is separate from its failed outer launcher. Review executes no new browser scenario and claims no full TASK-225 pass.'};
}
function rowFor(tasks,report,manifest,number){const text=tasks.find(t=>t.id==='TASK-212').acceptance_criteria[number-1],name='fog-ac'+number+'-review.json',ref=n=>({file:n,sha256:manifest[n]});return {id:'TASK-212/AC'+number,targetSha256:R.digest(text),reviewer:'Independent complete fog AC'+number+' record review',clauses:[{text,disposition:'reviewed',runTask:'TASK-212',tier:'source-executed',caseIds:F.CASES,sourceIdentity:ref('source-identities.json'),proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),name].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(name)})),reason:report.scope,derivation:report.derivation,followUp:{scope:'Refresh only affected complete fog criteria if source or original records change.',acceptance:'Matching current source, exact independent observations and finalized original invocation records.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,RECEIPT};
