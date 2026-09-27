'use strict';
// Separate complete AC5/6/8 record reviews. Each returns its own expectations;
// no one criterion inherits another criterion's consumer verdict.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const {RECEIPT}=require('./review_asset_records');
const CASES=['cold-warm-delay','failed-recovery','old-client','old-server'];
function review(number,prepared,receipt){
 assert.deepEqual(receipt,RECEIPT,'wrong-requirements-receipt');assert([5,6,8].includes(number));
 const dir=path.join(prepared,'selected-211'),manifest=A.read(path.join(dir,'evidence-hashes.json')),checks=[],proofs={};
 const check=(id,expected,observed)=>{assert.deepEqual(observed,expected,'asset-AC'+number+':'+id);checks.push({id:'requirements/AC'+number+'/'+id,expected,observed,pass:true});};
 const file=name=>{const key=A.proofKey(dir,name,manifest);proofs[key]=manifest[key];return path.join(dir,key);};
 const read=name=>A.read(file(name)),text=name=>fs.readFileSync(file(name),'utf8');
 const sources=read('source-identities.json');check('source-current',[],A.compareSources(sources));
 const source=name=>{const f=path.join(A.root,name);check('source/'+name,sources.after.server.files[name],A.hash(f));proofs[f]=A.hash(f);return fs.readFileSync(f,'utf8');};
 const plan=read('verification-plan.json'),coverage=read('coverage-results.json'),cp=read('checkpoints.json').checkpoints;
 const semantic=read('ac7-independent-review.json').checks;
 const seen=new Set();
 const observed=id=>{const found=cp.filter(c=>c.id===id);if(!seen.has(id)){check('unique/'+id,1,found.length);seen.add(id);}return found[0].observed;};
 check('exact-cases',CASES,coverage.cases.map(c=>c.id));check('declared-cases',CASES,plan.cases.map(c=>c.id));
 if(number===5||number===6){
  text('asset-events.jsonl');read('persistence-checkpoints.json');
  for(const c of CASES)check('connected-contexts/'+c,2,observed(c+'/participants').contexts);
 }
 if(number===5){
  check('parent-receipt-hash',receipt.sha256,A.hash(receipt.file));proofs[receipt.file]=receipt.sha256;
  const parent=A.read(receipt.file),child=read('child-results.json').children;
  check('provider-actual-exits',[0],parent.commands.filter(c=>c.argv.includes('--suite')&&c.argv.includes('assets-versions')).map(c=>c.actualExit));
  check('all-required-positive-commands',true,parent.commands.every(c=>c.actualExit===0&&c.signal===null));
  check('child-exits',[0],child.map(c=>c.exitCode));check('child-no-timeouts',[false],child.map(c=>c.timedOut));
  const stdout=text(path.relative(fs.realpathSync(A.read(path.join(prepared,'provenance.json')).original),fs.realpathSync(child[0].stdoutPath)));
  check('no-skips',true,/^# skipped 0$/m.test(stdout)&&/^# cancelled 0$/m.test(stdout)&&/^# todo 0$/m.test(stdout));
  for(const c of CASES){check('browser-errors/'+c,[],read(c+'/browser-errors.json'));check('server-errors/'+c,0,observed(c+'/server-errors'));check('case-pass/'+c,true,coverage.cases.find(x=>x.id===c).pass);
   for(const k of ['initial/exact','round0/move/exact','round0/persisted/exact','round0/round/p1','round0/round/p2']){
    const expected=semantic.find(x=>x.id===(c.startsWith('old-')?'gameplay/':'recovery/')+c+'/'+k).expected;check('milestone/'+c+'/'+k,expected,observed(c+'/'+k));
   }
  }
  check('intended-asset-failure',[{player:'failed-recovery-p1',type:'requestfailed',url:'https://cdn.socket.io/socket.io-3.0.0.js',text:'net::ERR_FAILED'},{player:'failed-recovery-p1',type:'console.error',text:'Failed to load resource: net::ERR_FAILED'}],read('failed-recovery/induced-errors.json'));
  check('negative-before-recovery',{failed:true,io:'undefined'},observed('failed-recovery/dependency-failure'));
  check('recovery-after-negative','function',observed('failed-recovery/dependency-recovered'));
  for(const p of [1,2]){check('legacy-rejection/'+p,{message:true,authoritativeBoards:0},observed('old-client/version-rejected/p'+p));check('legacy-turn/'+p,{submitted:1,rejected:2,authoritativeBoards:0},observed('old-client/rejected-turn/p'+p));}
  const old=path.join(A.client,'artifacts/TASK-225/review-57/provider/verification-budget.json'),sha='7f8f6c29c733b97b75f3be444ab9643a0dd638aea3ec258c76ec6769be0cc5b7';check('original-failure-preserved',sha,A.hash(old));proofs[old]=sha;check('original-failure-not-green',false,A.read(old).pass);check('original-failing-exit',[1],A.read(old).exits);
  const oldCoverage=path.join(path.dirname(old),'coverage-results.json'),oldSha='3f990555d5fd741d012587822131c6c1443faab8d50896ff0b995604dd754bfd';check('original-failing-coverage',oldSha,A.hash(oldCoverage));proofs[oldCoverage]=oldSha;check('original-failed-case',false,A.read(oldCoverage).cases.find(c=>c.id==='failed-recovery').pass);
 }
 if(number===6){
  check('declared-real-tiers',CASES.map(()=> 'real HTTPS/Socket.IO/MongoDB and shipped browser UI'),plan.cases.map(c=>c.tier));
  const harness=source('tests/reliability/assets-versions.test.js'),assets=source('tests/reliability/helpers/assets-browser.js');
  check('real-services',true,harness.includes('await withServices(')&&harness.includes('await chromium.launch(')&&harness.includes('service.mongo.db(service.databaseName)'));
  check('normal-browser-inputs',true,harness.includes("await p.tapCell(from,'select fresh mover'")&&harness.includes("await p.tapControl('nextTurnButton','commit fresh recovered turn'"));
  check('no-fixture-after-admission',true,harness.indexOf('fixture.buildCurrentCoopBoardInVm(spec)')<harness.indexOf("s.client.emit('startGameOrConnect'"));
  check('no-fulfillment-or-clock-freeze',false,/\.fulfill\(|clock\.install|clock\.pause|setSystemTime|useFakeTimers/.test(harness+assets));
  check('network-fault-is-real-abort',true,assets.includes("return r.abort('failed')")&&assets.includes("cdp.send('Fetch.continueRequest'"));
  check('read-only-evaluation-shapes',3,(harness.match(/\.evaluate\(/g)||[]).length+(assets.match(/\.evaluate\(/g)||[]).length);
  // The three expressions inspected above are a two-frame await and typeof io
  // twice, not assignments to game state. Other reads use BrowserPlayer.observe.
  check('evaluation-is-frame-await',true,harness.includes('page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))'));
  check('asset-evaluations-read-io',2,(assets.match(/page\.evaluate\(\(\)=>typeof io\)/g)||[]).length);
  const events=text('asset-events.jsonl').trim().split('\n').map(JSON.parse),durable=read('persistence-checkpoints.json');
  for(const c of CASES){
   check('two-contexts/'+c,{contexts:2,persisted:2},observed(c+'/participants'));
   check('no-ai/'+c,false,read(c+'/declared-fixture.json').board.gameSettings.withAI);
   check('real-activity/'+c,true,text(c+'/services/activity.jsonl').includes('"source":"mongodb","message":"ping ok"'));
   check('wire-and-input/'+c,true,events.some(e=>e.id===c&&e.stage==='input')&&events.some(e=>e.id===c&&e.stage==='wire'&&e.event==='nextTurn'&&e.direction==='sent'));
   check('two-persistence-stages/'+c,['accepted','round-complete'],durable.filter(d=>d.id===c).map(d=>d.stage));
   for(const k of ['initial/exact','round0/move/exact','round0/persisted/exact','round0/round/p1','round0/round/p2'])check('independent/'+c+'/'+k,semantic.find(x=>x.id===(c.startsWith('old-')?'gameplay/':'recovery/')+c+'/'+k).expected,observed(c+'/'+k));
  }
 }
 if(number===8){
  const budget=read('verification-budget.json'),runner=source('tests/reliability/run.js'),harness=source('tests/reliability/assets-versions.test.js');
  check('plan-estimate-bounded',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  check('elapsed-wall-clock',Date.parse(budget.finishedAt)-Date.parse(budget.startedAt),budget.elapsedMs);
  check('complete-under-hour',true,budget.elapsedMs>0&&budget.elapsedMs<=3600000);check('exits',[0],budget.exits);
  check('single-start',true,runner.includes('const competitiveStartedMs = Date.now()'));
  check('global-deadline',true,runner.includes('competitiveStartedMs + 3300000')&&runner.includes('env.OPENING_COMPETITIVE_STOP_AT = String(context.competitiveDeadline - 240000)'));
  check('inherited-deadline',true,harness.includes('Number(process.env.OPENING_COMPETITIVE_STOP_AT||Date.now()+3060000)'));
  check('predeclared-plan',true,harness.indexOf("json('verification-plan.json'")<harness.indexOf('const release=await'));
  check('release-cleanup',{removed:true,unchanged:true},read('release-cleanup.json'));
  for(const c of CASES){const cleanup=read(c+'/cleanup.json');
   check('owned-process-roles/'+c,['server','mongod'],cleanup.processes.map(p=>p.role));check('dead-owned-processes/'+c,[false,false],cleanup.processes.map(p=>p.aliveAfter));
   check('removed-owned-directories/'+c,[false,false],cleanup.directories.map(d=>d.existsAfter));
   check('cleanup-within-invocation/'+c,true,Date.parse(cleanup.startedAt)>=Date.parse(budget.startedAt)&&Date.parse(cleanup.finishedAt)<=Date.parse(budget.finishedAt));
   check('case-proof-paths/'+c,true,coverage.cases.find(x=>x.id===c).proofPaths.length>=7);
   for(const name of coverage.cases.find(x=>x.id===c).proofPaths)file(name);
  }
  for(const name of Object.keys(manifest).filter(n=>!/^ac[4568]-independent-review\.json$/.test(n)))file(name);
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-requirements-checkpoint');
 return {checks,proofs,scope:'Complete TASK-211/AC'+number,derivation:'Independent original record inspection for AC'+number+': exact case ownership, source identities and clause-specific expected values are checked against trace, persisted state, executed harness and finalized process/command records. No saved covered/current verdict is used; retained semantic reports are freshly recomputed by the selection adapter. Browser and real-network claims stay tied to four recorded journeys; this reader executes no new gameplay.'};
}
function rowFor(number,tasks,report,manifest){const text=tasks.find(t=>t.id==='TASK-211').acceptance_criteria[number-1],ref=n=>({file:n,sha256:manifest[n]}),name='ac'+number+'-independent-review.json';return {id:'TASK-211/AC'+number,targetSha256:R.digest(text),reviewer:'Independent complete AC'+number+' record and source review',clauses:[{text,disposition:'reviewed',runTask:'TASK-211',tier:number===8?'source-executed':'natural-browser',caseIds:CASES,sourceIdentity:ref('source-identities.json'),proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),name].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(name)})),...(number===8?{}:{contextIds:CASES.map(c=>'requirements/AC'+number+'/connected-contexts/'+c),milestoneIds:CASES.map(c=>'requirements/AC'+number+'/'+(number===5?'milestone/':'independent/')+c+'/round0/persisted/exact'),traces:['asset-events.jsonl','persistence-checkpoints.json'].map(ref)}),reason:report.scope+' reviewed from exact original proof and clause-specific independent observations.',derivation:report.derivation,followUp:{scope:'Refresh affected AC'+number+' proof if bound sources change.',acceptance:'Fresh complete bounded invocation, matching source and independent expectations.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={reader:number=>({RECEIPT,review:(p,r)=>review(number,p,r),rowFor:(t,r,m)=>rowFor(number,t,r,m)})};
