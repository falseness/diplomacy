'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2'),B=require('./review_smoke_bounds'),P=require('./smoke_exits_policy.json');
const CASES=require('/root/diplomacy_server/tests/reliability/helpers/smoke-isolation-plan').CASES;
const CLAUSES=[
 'Required positive commands must exit zero.',
 'Negative controls must be asserted by a passing parent to fail for the intended reason.',
 'Missing/skipped cases, timeout, unexpected browser/server errors, absent milestones or stale source hashes leave the task incomplete.',
 'Preserve the original failing reproduction even after a successful fix.'
];
function inputs(dir=P.original+'/provider'){
 const read=n=>A.read(path.join(dir,n)),base=path.dirname(dir),child=read('child-results.json');
 return {dir,base,child,plan:read('verification-plan.json'),coverage:read('coverage-results.json'),checkpoints:read('checkpoints.json'),raw:read('smoke-observations.json'),budget:read('verification-budget.json'),
  outer:A.read(base+'/verification-budget.json'),supervisor:A.read(base+'/process-exit.json'),
  receipts:Object.fromEntries(A.read(base+'/verification-budget.json').commands.map(c=>[c.label,A.read(base+'/'+c.label+'-exit.json')])),
  tap:fs.readFileSync(child.children[0].stdoutPath,'utf8'),stderr:fs.readFileSync(child.children[0].stderrPath,'utf8'),
  server:fs.readFileSync(dir+'/services/server.log','utf8'),mongo:fs.readFileSync(dir+'/services/mongod.log','utf8'),
  providerLog:fs.readFileSync(base+'/provider.log','utf8'),consumerLog:fs.readFileSync(base+'/consumer.log','utf8')};
}
function semantic(x){
 const checks=[],ck=(id,e,o)=>{assert.deepEqual(o,e,'AC5/'+id);checks.push({id:'smoke/AC5/'+id,expected:e,observed:o,pass:true});};
 ck('original-run',P.original,x.base);ck('provider-run',x.dir,x.child.outputDir);
 ck('required-positive-commands',['runtime','source-tests','provider','consumer','client-diff-check','client-staged-artifacts','server-diff-check','server-staged-artifacts'],x.outer.commands.map(c=>c.label));
 for(const c of x.outer.commands){
  ck('receipt/'+c.label,c,x.receipts[c.label]);ck('exit/'+c.label,0,c.actualExit);ck('timeout/'+c.label,false,c.timedOut);ck('signal/'+c.label,null,c.signal);
  assert(c.finishedMs>=c.startedMs&&c.startedMs>=x.outer.startedMs&&c.finishedMs<=x.outer.finishedMs,'command chronology');
 }
 ck('provider-output',x.dir,x.receipts.provider.argv.at(-1));ck('consumer-output',x.base,x.receipts.consumer.argv.at(-1));
 ck('supervisor-output',x.base,x.supervisor.argv.at(-1));ck('supervisor-exit',0,x.supervisor.actualRunnerExit);ck('supervisor-timeout',false,x.supervisor.timedOut);
 assert(x.supervisor.startedMs<=x.outer.startedMs&&x.supervisor.finishedMs>=x.outer.finishedMs,'outer receipt chronology');
 ck('outer-scope',true,x.outer.scopePass);ck('outer-cleanup',true,x.outer.cleanup);
 ck('provider-budget-pass',true,x.budget.pass);ck('provider-budget-exits',[0],x.budget.exits);ck('provider-budget-cleanup',true,x.budget.cleanup);
 assert(x.budget.elapsedMs<3300000&&x.outer.elapsedMs<3300000&&x.supervisor.elapsedMs<3600000,'original deadline');
 ck('one-child',1,x.child.children.length);const c=x.child.children[0];
 ck('child-exit',0,c.exitCode);ck('child-signal',null,c.signal);ck('child-timeout',false,c.timedOut);
 ck('tap-summary',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},c.tap.summary);
 ck('tap-case',[{name:'authenticated smoke namespace isolation',ok:true,directive:null}],c.tap.cases);
 for(const line of ['ok 1 - authenticated smoke namespace isolation','1..1','# tests 1','# pass 1','# fail 0','# cancelled 0','# skipped 0','# todo 0'])ck('tap/'+line,true,x.tap.split('\n').includes(line));
 ck('no-tap-rejection',false,/^not ok |^ok .*# (SKIP|TODO)\b/mi.test(x.tap));ck('child-stderr','',x.stderr);
 ck('selected-cases',CASES,x.plan.cases.map(c=>c.id));ck('covered-cases',CASES,x.coverage.cases.map(c=>c.id));
 ck('all-milestones',[...CASES,'owned-cleanup'].sort(),x.checkpoints.checkpoints.map(c=>c.id).sort());
 for(const c of x.checkpoints.checkpoints){ck('milestone/'+c.id,true,c.pass);ck('value/'+c.id,c.expected,c.observed);ck('tap-milestone/'+c.id,true,x.tap.split('\n').includes('# PASS '+c.id));}
 const denials=[[8,'cross-run-socket'],[9,'ordinary-socket-switch'],[10,'expired-credential'],[12,'live-expiry'],[13,'ordinary-cleanup-denied'],[15,'revoked-run']];
 for(const [i,id]of denials){const e={event:'error',body:'SMOKE_ISOLATION_DENIED'};ck('negative-reason/'+id,e,x.raw.requests[i].response);ck('negative-parent/'+id,e,x.checkpoints.checkpoints.find(c=>c.id===id).observed);}
 ck('lookup-denials',3,x.checkpoints.checkpoints.find(c=>c.id==='lookup-boundary').observed);
 ck('unexpected-server-errors',[],x.server.split('\n').filter(l=>/error|exception|unhandled|fatal|assertion/i.test(l)));
 const mongo=x.mongo.trim().split('\n').map(l=>JSON.parse(l));ck('mongo-errors',[],mongo.filter(l=>['E','F'].includes(l.s)));
 const warnings=[...new Set(mongo.filter(l=>l.s==='W').map(l=>l.id))].sort();ck('known-local-mongo-warnings',[22120,22138,5123300,11621101].sort(),warnings);
 ck('provider-gate',true,x.providerLog.includes('GATE PASSED suite=smoke-isolation children=1 passed=1 reasons=[]'));
 ck('consumer-stream-pass',true,x.consumerLog.includes('PASS actual cumulative smoke'));
 return checks;
}
function provenance(policy=P){
 assert.deepEqual(policy,P,'failure provenance policy');
 const checks=[];
 for(const [kind,files]of Object.entries({evidence:policy.evidence,executionSources:policy.executionSources}))for(const [file,h]of Object.entries(files)){
  assert.equal(A.hash(file),h,'failure provenance / execution binding '+file);checks.push({id:'smoke/AC5/'+kind+'/'+file,expected:h,observed:A.hash(file),pass:true});
 }
 const roots='/root/diplomacy/artifacts/';
 for(const [file,marker]of [
  ['TASK-223/green-01/children/001-reliability_smoke-isolation/stdout.log',"Cannot read properties of undefined (reading 'length')"],
  ['TASK-223/green-03/services/server.log','co-op authority: state fields'],
  ['TASK-223/verifier-20260925T054115Z/verification.log','MATCH=False'],
  ['TASK-223/green-05-console.log','RUNNER_ACTUAL_EXIT_STATUS=0'],
  ['TASK-225/smoke-158/run-01/provider.log','historical-evidence-modified:'],
  ['TASK-225/smoke-158/run-02/consumer.log','actual provider invocation binding']
 ]){assert(fs.readFileSync(roots+file,'utf8').includes(marker),'failure marker '+file);checks.push({id:'smoke/AC5/failure-marker/'+file,expected:marker,observed:marker,pass:true});}
 return checks;
}
function currentSources(ids){assert.deepEqual(A.compareSources(ids),[],'AC5 stale source');}
function review(dir,receipt,bound=F.manifest(dir)){
 assert.equal(fs.realpathSync(dir),fs.realpathSync(P.original+'/provider'),'AC5 original provider');
 const inherited=B.review(dir,receipt,bound);currentSources(A.read(dir+'/source-identities.json'));
 const checks=[...inherited.checks,...provenance(),...semantic(inputs(dir))];
 return {criteria:[5],wholeCriterionCredit:true,checks,clauses:CLAUSES.map(text=>({text,pass:true})),
  provenance:P,derivation:'Exact immutable original command/child/supervisor receipts and complete streams establish zero exits, selected unskipped milestones and error absence. Source-bound original passing test asserts six exact protocol denial reasons and three source lookup denials. Independent capture/bounds oracles derive observations; current hashes remain required. Failed historical runs and committed-source mismatch remain separately bound failures. Mongo startup warnings are explicitly classified; no browser claim. No AC4 location or AC8 aggregate-invocation credit.'};
}
function rowFor(tasks,report,m){
 const text=tasks.find(t=>t.id==='TASK-223').acceptance_criteria[4],ref=file=>({file,sha256:m[file]});
 assert.equal(text,CLAUSES.join(' '));assert.deepEqual(report.criteria,[5]);assert.equal(report.wholeCriterionCredit,true);assert.deepEqual(report.clauses,CLAUSES.map(text=>({text,pass:true})));
 return {id:'TASK-223/AC5',targetSha256:R.digest(text),reviewer:'Independent smoke exits and failure provenance review',clauses:[{
  text,disposition:'reviewed',runTask:'TASK-223-EXITS',tier:'real-network',caseIds:CASES.filter(c=>c!=='lookup-boundary'),sourceIdentity:ref('source-identities.json'),traces:[ref('smoke-observations.json')],milestoneIds:['smoke/distinct-games','smoke/exact-cleanup-inventory'],
  proofs:['smoke-exits-review.json','checkpoints.json','child-results.json','verification-plan.json','coverage-results.json','smoke-observations.json'].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('smoke-exits-review.json')})),derivation:report.derivation,reason:'Whole AC5 only; AC4 and AC8 remain independently unresolved.',
  followUp:{scope:'Revalidate exits, original failures and exact current smoke source after changes.',acceptance:'Complete independent AC5 proof without substituted receipts.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}
 }]};
}
module.exports={currentSources,inputs,semantic,provenance,review,rowFor,CLAUSES};
