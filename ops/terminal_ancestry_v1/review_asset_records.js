// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Independent AC4 evidence-record review; no gameplay claims from filenames.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const RECEIPT={file:path.join(A.client,'artifacts/TASK-225/review-60/verification-budget.json'),sha256:'b5444274708b093dcdb6ac50d31f6cc8fefdfe4af3001f71782c9fea9f1ef79f'};
const CASES=['cold-warm-delay','failed-recovery','old-client','old-server'];
function review(prepared,receipt){
 assert.deepEqual(receipt,RECEIPT,'wrong-final-parent-receipt');
 const selected=path.join(prepared,'selected-211'),manifest=A.read(path.join(selected,'evidence-hashes.json')),checks=[],proofs={};
 const check=(id,expected,observed)=>{assert.deepEqual(observed,expected,'asset-records:'+id);checks.push({id:'records/'+id,expected,observed,pass:true});};
 const file=name=>{const key=A.proofKey(selected,name,manifest);proofs[key]=manifest[key];return path.join(selected,key);};
 const read=name=>A.read(file(name));
 const log=fs.readFileSync(file('verification.log'),'utf8'),children=read('child-results.json');
 const invocation=children.invocation;
 check('command-cwd','/root/diplomacy_server',invocation.cwd);
 check('command-selector',['--suite','assets-versions','--output-dir'],invocation.argv.slice(2,5));
 check('literal-parent-command',true,log.includes('COMMAND '+invocation.argv.join(' ')));
 check('literal-cwd-runtime',true,log.includes('CWD='+invocation.cwd+'\nNODE='+invocation.node));
 check('one-child',1,children.children.length);
 for(const child of children.children){
  check('child-cwd',invocation.cwd,child.command.cwd);
  check('child-command',true,log.includes('CHILD_COMMAND '+child.command.argv.join(' ')+' CWD='+child.command.cwd));
  check('child-exit',0,child.exitCode);check('child-signal',null,child.signal);check('child-timeout',false,child.timedOut);
  const streams=['stdoutPath','stderrPath'].map(k=>{
   const original=A.read(path.join(prepared,'provenance.json')).original;
   const rel=path.relative(fs.realpathSync(original),fs.realpathSync(child[k]));
   assert(!rel.startsWith('..'),'escaped-child-output');return fs.readFileSync(file(rel),'utf8');
  });
  check('full-stdout-stderr-and-exit',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));
  check('tap-no-failures',true,streams[0].includes('# fail 0\n')&&streams[0].includes('# skipped 0\n')&&streams[0].includes('# tests 1\n')&&streams[0].includes('ok 1 - bounded shipped assets and recorded release combinations\n'));
 }
 const runtimes=[...log.matchAll(/^# runtime (.+)$/gm)].map(m=>JSON.parse(m[1]));
 check('four-runtime-records',4,runtimes.length);
 for(let i=0;i<4;i++)check('runtime/'+i,{node:'v20.20.2',chromium:'125.0.6422.26',services:{node:'v20.20.2',mongod:'db version v7.0.37',socketIoClient:'4.8.3',platform:'linux 5.15.0-113-generic'}},runtimes[i]);
 assert(receipt&&path.isAbsolute(receipt.file),'missing-final-parent-receipt');
 check('parent-receipt-hash',receipt.sha256,A.hash(receipt.file));
 const parent=A.read(receipt.file),provider=A.read(path.join(prepared,'provenance.json')).original;
 const commands=parent.commands.filter(c=>c.argv.includes('--suite')&&c.argv.includes('assets-versions')&&fs.realpathSync(c.argv.at(-1))===fs.realpathSync(provider));
 check('parent-command-count',1,commands.length);check('parent-actual-exit',0,commands[0].actualExit);check('parent-signal',null,commands[0].signal);
 check('parent-finished',true,parent.finishedMs>parent.startedMs&&parent.cleanup===true&&parent.passScoped===true);
 proofs[receipt.file]=receipt.sha256;
 const identities=read('source-identities.json');check('source-current',[],require('../historical_source_binding').observation('asset-records',selected,identities));
 const plan=read('verification-plan.json'),cp=read('checkpoints.json').checkpoints;
 check('exact-checkpoint-manifest',plan.requiredCheckpoints.slice().sort(),cp.map(c=>c.id).sort());
 for(const c of cp){check('checkpoint/'+c.id,c.expected,c.observed);check('checkpoint-pass/'+c.id,true,c.pass);}
 // Independent expectations are already recomputed by the retained semantic
 // readers. Require those observations to occur there, rather than accepting
 // matching expected/observed pairs written by the provider itself.
 const independent=read('ac7-independent-review.json').checks;
 for(const c of CASES)for(const suffix of ['initial/exact','round0/move/exact','round0/persisted/exact','round0/round/p1','round0/round/p2']){
  const observed=cp.find(x=>x.id===c+'/'+suffix),prefix=c.startsWith('old-')?'gameplay/':'recovery/';
  const oracle=independent.find(x=>x.id===prefix+c+'/'+suffix);assert(oracle,'missing-independent-check');
  check('independent/'+c+'/'+suffix,oracle.expected,observed.observed);
 }
 read('version-matrix.json');
 const requests=fs.readFileSync(file('asset-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 check('network-records',true,CASES.every(c=>requests.some(r=>r.id===c&&r.status===200&&/^[a-f0-9]{64}$/.test(r.sha256||''))));
 for(const c of CASES){
  const names=Object.keys(manifest).filter(n=>n.startsWith('screenshots/')&&n.endsWith(c+'-p1-round0-recovered.png'));check('capture-count/'+c,1,names.length);const n=names[0];
  const data=fs.readFileSync(file(n));check('png/'+c,'89504e470d0a1a0a',data.subarray(0,8).toString('hex'));
 }
 // Inspect structured traces for credential fields and input digit coordinates.
 let redacted=0;
 function walk(value,where){
  if(Array.isArray(value)){value.forEach((x,i)=>walk(x,where+'/'+i));return;}
  if(!value||typeof value!=='object')return;
  for(const [k,v] of Object.entries(value)){
   if(/^(password|privateKey|userId)$/i.test(k)){check('redaction/'+where+'/'+k,'[redacted]',v);redacted++;}
   walk(v,where+'/'+k);
  }
 }
 const events=fs.readFileSync(file('asset-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 events.forEach((e,i)=>{walk(e,'event/'+i);if(e.stage==='input'&&/password/.test(e.label||''))check('password-input/'+i,false,Object.hasOwn(e,'x')||Object.hasOwn(e,'y'));});
 walk(read('persistence-checkpoints.json'),'database');check('redaction-observed',true,redacted>0);
 for(const name of Object.keys(manifest).filter(n=>/\.(jsonl|log)$/.test(n))){
  const text=fs.readFileSync(file(name),'utf8');
  check('no-private-key/'+name,false,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text));
  check('no-numeric-password/'+name,false,/"password"\s*:\s*"[0-9]+"/.test(text));
 }
 for(const repo of ['/root/diplomacy','/root/diplomacy_server'])check('local-unstaged/'+repo,true,log.includes('PASS artifacts-unstaged:'+repo));
 const provenance=A.read(path.join(prepared,'provenance.json'));
 for(const [name,sha] of Object.entries(provenance.originalFiles))check('immutable/'+name,sha,A.hash(path.join(provenance.original,name)));
 return {checks,proofs,scope:'Complete TASK-211/AC4 evidence-record review',derivation:'Original command, cwd, runtime and full captured streams are compared byte-for-byte to child records and actual parent exit receipt. Exact checkpoint observations match recomputed fixture-derived board expectations. Hashed PNG signatures and request content identities establish named proof availability, not gameplay by themselves. Structured credential fields, password-input coordinate removal and private-key/numeric-password patterns are independently audited against redacted traces; original bytes are hash bound and preserved.'};
}
function rowFor(tasks,report,manifest){
 const text=tasks.find(t=>t.id==='TASK-211').acceptance_criteria[3],ref=n=>({file:n,sha256:manifest[n]});
 return {id:'TASK-211/AC4',targetSha256:R.digest(text),reviewer:'Independent complete original evidence-record and finalized receipt review',clauses:[{text,disposition:'reviewed',runTask:'TASK-211',tier:'source-executed',caseIds:CASES,sourceIdentity:ref('source-identities.json'),proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),'ac4-independent-review.json'].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('ac4-independent-review.json')})),reason:'Complete artifact, command/output/exit, independent expectation, redaction and immutable-local-record clauses checked from original proof.',derivation:report.derivation,followUp:{scope:'Refresh only affected evidence-record clauses if tested source changes.',acceptance:'Fresh bounded provider command, full outputs, actual exits, independent observations and redaction proof.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};
}
module.exports={review,rowFor,RECEIPT};
