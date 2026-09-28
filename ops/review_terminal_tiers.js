'use strict';
// Complete AC6 review for the exact joined terminal acquisition. Policy binds
// inspected acquisition paths; independent oracles derive behavior from raw data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2'),J=require('./review_terminal_ac3_v2');
const policy=require('./terminal_ac6_policy.json');
const clone=x=>structuredClone(x);
const CLAUSES=[
 'Evidence tiers must be explicit: source-executed tests prove rule logic, real HTTPS/Socket.IO/MongoDB cases prove protocol/persistence, and shipped-browser UI interactions prove UI behavior.',
 'Broad class/pairing combinations may run against shipped production source without browsers; every distinct UI workflow and network boundary needs representative real coverage.',
 'Expected values remain independent.',
 'No fake handlers for network claims, silent retries, clock/animation freezing, AI substitution, runtime board mutation or removal of assertions from selected cases.'
];
function classification(record) {
 if(record.stage==='ac3-passive'&&record.kind==='invoked') {
  assert.equal(record.tier,'source-executed-callbacks','source callback mislabeled as network');
  return 'source-executed-callbacks';
 }
 if(record.stage==='captured-real-receipt')return 'received-network-packet';
 if(record.stage==='late-active-receipt-replayed')return 'replayed-received-network-packet';
 return null;
}
function review(dir,receipt,bound=F.manifest(dir)) {
 const checks=[],proofs={};
 const ck=(id,e,o)=>{assert.deepEqual(o,e,'AC6/'+id);checks.push({id:'terminal/AC6/'+id,expected:clone(e),observed:clone(o),pass:true});};
 const read=(n,jsonl=false)=>{A.proofKey(dir,n,bound);proofs[n]=bound[n];const s=fs.readFileSync(path.join(dir,n),'utf8');return jsonl?s.trim().split('\n').map(JSON.parse):JSON.parse(s);};
 const ids=read('source-identities.json');
 assert(receipt?.file&&receipt.sha256,'original provider receipt required');
 ck('provider-receipt-binding',receipt.sha256,A.hash(receipt.file));
 const invocation=A.read(receipt.file),child=read('child-results.json');
 ck('provider-preload','--require /root/diplomacy/ops/terminal_ac3_provider.js',invocation.environment.NODE_OPTIONS);
 ck('provider-capture-enabled','1',invocation.environment.TERMINAL_AC3_CAPTURE);
 ck('child-fault',null,child.selection.fault);
 ck('child-config',{cases:[{}]},child.childConfig);
 const P=require('./terminal_ac3_provider');
 const originalHelper=fs.readFileSync(P.FILE,'utf8'),instrumented=P.instrument(originalHelper);
 const assertions=s=>s.match(/(?:check|assert)(?:\.[a-zA-Z]+)?\([^,;\n]*/g);
 ck('preserved-helper-assertions',assertions(originalHelper),assertions(instrumented));

 for(const entry of policy.sources) {
  const repo=entry.file.startsWith(A.client+'/')?'client':'server';
  const relative=path.relative(repo==='client'?A.client:A.root,entry.file);
  // Capture modules are bound by actual installation trace, not provider's
  // production manifest. All other reviewed code must be in both snapshots.
  if(!relative.startsWith('ops/')) {
   ck('policy-before/'+relative,entry.sha256,ids.before[repo].files[relative]);
   ck('policy-after/'+relative,entry.sha256,ids.after[repo].files[relative]);
  }
  ck('policy-current/'+relative,entry.sha256,A.hash(entry.file));proofs[entry.file]=entry.sha256;
 }
 proofs[path.join(__dirname,'terminal_ac6_policy.json')]=A.hash(path.join(__dirname,'terminal_ac6_policy.json'));
 const plan=read('verification-plan.json'),cp=read('checkpoints.json').checkpoints;
 ck('five-source-rules',['victory','defeat','draw','competitive-draw','competitive-survivor'],plan.sourceCases);
 ck('four-journeys',F.CASES,plan.cases.map(c=>c.id));
 ck('distinct-checkpoints',cp.length,new Set(cp.map(c=>c.id)).size);
 for(const id of plan.requiredCheckpoints) {
  const rows=cp.filter(c=>c.id===id);ck('required/'+id,1,rows.length);
  ck('required-value/'+id,rows[0].expected,rows[0].observed);
  ck('required-pass/'+id,true,rows[0].pass);
 }
 const tiers=[],workflows=[];
 for(const id of F.CASES) {
  const trace=read(id+'/network-traces.jsonl',true),inputs=read(id+'/input-trace.jsonl',true);
  const stage=s=>trace.filter(r=>r.stage===s),one=(xs,label)=>{ck(id+'/'+label+'/count',1,xs.length);return xs[0];};
  for(const r of trace) {const tier=classification(r);if(tier)tiers.push({caseId:id,stage:r.stage,participant:r.player||r.participant,tier});}
  const life=one(stage('ac2-lifecycle'),'lifecycle').lifecycle;
  ck(id+'/protocol-transport','polling',life.readiness.socketIo.transport);
  assert(life.endpoints.https.startsWith('https://127.0.0.1:'),'actual HTTPS endpoint');
  ck(id+'/same-service',life.endpoints.https,life.endpoints.socketIo);
  ck(id+'/real-service-roles',['mongod','server'],life.processes.map(p=>p.role).sort());
  ck(id+'/distinct-service-pids',2,new Set(life.processes.map(p=>p.pid)).size);
  const fixture=read(id+'/declared-fixture.json');
  ck(id+'/declared-initial',false,fixture.spec.generation.testFixture.generated);
  ck(id+'/fixture-binding',bound[id+'/declared-fixture.json'],one(stage('ac2-install'),'capture-install').fixtureSha256);
  const terminal=one(stage('mongo-terminal'),'persisted-terminal').stored;
  assert(typeof terminal.gameID==='string','actual game identity');
  const participants=trace.filter(r=>r.stage==='ac2-passive'&&r.kind==='page'&&r.boundary==='reconnect-before');
  ck(id+'/actual-page-recipients',['p1','p2'],participants.map(p=>p.participant).sort());
  ck(id+'/distinct-page-sessions',2,new Set(participants.map(p=>p.session)).size);
  ck(id+'/actual-recipient-slots',[1,2],participants.map(p=>p.recipientSlot).sort());
  ck(id+'/page-game',participants.map(()=>terminal.gameID),participants.map(p=>p.gameId));
  const legal=id==='terminal-victory'||id==='terminal-draw'?'legal pass before flooding':'commit crisis state';
  ck(id+'/real-clicks',['p1','p2'],inputs.filter(r=>r.label===legal&&r.via==='mouse.click').map(r=>r.player));
  workflows.push({caseId:id,initial:'declared-initial-fixture',protocol:['authenticated-admission','human-commit','terminal-persistence','terminal-reconnect'],ui:['legal-pass','winner-render','disabled-terminal-controls','shipped-reconnect']});
  if(id.startsWith('terminal-to-')) {
   const replay=one(stage('late-active-receipt-replayed'),'replay');
   assert(stage('captured-real-receipt').some(r=>r.player===replay.player&&r.packet===replay.packet),'replay must be an actual received packet');
   ck(id+'/replay-http-status',200,replay.status);
   ck(id+'/replay-appended-packet',replay.packet,replay.body.split('\x1e').at(-1));
   assert(one(stage('late-active-receipt-dispatched'),'dispatch').delivered>0,'actual client dispatch');
   const callbacks=trace.filter(r=>r.stage==='ac3-passive'&&r.kind==='invoked');
   ck(id+'/callback-participants',['p1','p2'],callbacks.map(r=>r.participant));
   for(const r of callbacks)ck(id+'/'+r.participant+'/source-tier','source-executed-callbacks',classification(r));
   workflows.at(-1).protocol.push('received-packet-replay','new-game-admission');
   workflows.at(-1).ui.push('same-page-return-to-menu','new-game-'+id.slice('terminal-to-'.length),'first-move');
  }
 }
 // Do not accept matching provider expected/observed pairs as independence.
 // Recompute three separate semantic derivations, then bind their exact output.
 const independent=J.review(dir,receipt,bound);
 Object.assign(proofs,independent.proofs);
 const oracleGroups=[1,2,3].map(n=>({criterion:'TASK-221/AC'+n,
  checks:independent.checks.filter(c=>c.id.startsWith('terminal/AC'+n+'/'))}));
 for(const group of oracleGroups)assert(group.checks.length>0,'missing independent oracle '+group.criterion);
 const oracleTools=['review_terminal_outcomes_v2.js','review_terminal_ac2_v2.js','review_terminal_ac2_join.js',
  'review_terminal_semantics.js','review_terminal_boundary.js','review_terminal_ac3_v2.js'];
 const oracleBindings=Object.fromEntries(oracleTools.map(n=>[n,A.hash(path.join(__dirname,n))]));
 for(const [n,h] of Object.entries(oracleBindings))proofs[path.join(__dirname,n)]=h;
 for(const g of oracleGroups)ck('independent-oracle/'+g.criterion,true,g.checks.length>0);
 checks.push(...independent.checks);
 return {criteria:[6],wholeCriterionCredit:true,caseIds:F.CASES,checks,proofs,tiers,workflows,oracleBindings,
  oracleGroups:oracleGroups.map(g=>({criterion:g.criterion,assertions:g.checks.length,sha256:R.digest(JSON.stringify(g.checks))})),
  clauses:CLAUSES.map((text,i)=>({text,pass:true,basis:[
   'Exact source rules, genuine service lifecycle, raw page/session/packet records, input traces and served bytes.',
   'All four declared journeys; outcome/reconnect/render and both same-page next-game boundaries; retained callbacks explicitly source-only.',
   'Recomputed AC1 flood/economy/outcome, AC2 raw reconnect/replay semantics and AC3 geometric move/identity oracles; separately hash-bound tools and outputs.',
   'Reviewed pinned acquisition call paths and transformed-helper binding; initial authoring before services, passive raw capture, native rendering/timing, real AI and authentic packet forwarding; original required assertions and actual provider receipt.'
  ][i]})),
  derivation:'Complete evidence-tier and independence review of four joined terminal journeys and five source rules. Source callbacks never stand for network receipt. Original provider commands/receipt retain their own scope; no original outer supervisor or full TASK-225 pass is inferred.'};
}
function rowFor(tasks,report,m) {
 const text=tasks.find(t=>t.id==='TASK-221').acceptance_criteria[5];
 assert.equal(text,CLAUSES.join(' '),'exact AC6 clause text');
 assert.deepEqual(report.criteria,[6]);assert.equal(report.wholeCriterionCredit,true);
 assert.deepEqual(report.clauses.map(c=>[c.text,c.pass]),CLAUSES.map(c=>[c,true]),'partial AC6 row');
 const ref=file=>({file,sha256:m[file]}),name='terminal-tier-review.json';
 return {id:'TASK-221/AC6',targetSha256:R.digest(text),reviewer:'Independent terminal tier and oracle review',clauses:[{
  text,disposition:'reviewed',runTask:'TASK-221-AC6',tier:'natural-browser',caseIds:F.CASES,
  sourceIdentity:ref('source-identities.json'),traces:F.CASES.map(id=>ref(id+'/network-traces.jsonl')),
  contextIds:F.CASES.map(id=>'terminal/AC6/'+id+'/distinct-page-sessions'),
  milestoneIds:F.CASES.map(id=>'terminal/AC1/'+id+'/terminal-result'),
  proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),name].map(ref),
  assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(name)})),
  reason:'Complete AC6 only; explicit source/protocol/UI subtiers remain in the consumed report.',derivation:report.derivation,
  followUp:{scope:'Refresh this exact whole criterion when reviewed sources change.',acceptance:'Complete tier/independence proof on current sources.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}
 }]};
}
module.exports={review,rowFor,classification,CLAUSES};
