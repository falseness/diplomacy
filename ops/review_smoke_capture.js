'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const P=require('./smoke_capture_provider'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2');
const CASES=require('/root/diplomacy_server/tests/reliability/helpers/smoke-isolation-plan').CASES;
function semantic(d){
 const checks=[];const ck=(id,e,o)=>{assert.deepEqual(o,e,id);checks.push({id:'smoke/'+id,expected:e,observed:o,pass:true});};
 ck('network-tier','real HTTPS/Socket.IO/MongoDB',d.tier);
 ck('identity-labels',['a1','a2','b1','b2','expired','live','o1','o2'],Object.keys(d.identities).sort());
 ck('unique-identities',8,new Set(Object.values(d.identities)).size);
 for(const h of Object.values(d.identities))assert(/^[0-9a-f]{64}$/.test(h),'hashed authenticated identity');
 ck('allowlist-count',6,d.allowlist.length);
 for(const n of ['a1','a2','b1','b2','expired','live']){
  const e=d.allowlist.filter(e=>e.userId===d.identities[n]);ck('allowlist/'+n,1,e.length);
  ck('authorized-run/'+n,n.startsWith('a')?'run-a':n.startsWith('b')?'run-b':n,e[0].run);
  assert(Number.isFinite(e[0].expiresAt),'expiry binding');
 }
 const requests=[['o1','o1','startGameOrConnect'],['a1','a1','startGameOrConnect'],['o2','o2','startGameOrConnect'],['a2','a2','startGameOrConnect'],['b1','b1','startGameOrConnect'],['b2','b2','startGameOrConnect'],['a1','a1','startGameOrConnect'],['a1','a1','nextTurn'],['b1','a1','startGameOrConnect'],['a1','o1','startGameOrConnect'],['expired','expired','startGameOrConnect'],['live','live','startGameOrConnect'],['live','live-reconnected','nextTurn'],['o1','o1','cleanupSmokeRun'],['a1','a1','cleanupSmokeRun'],['a2','a2','startGameOrConnect']];
 ck('exact-request-sequence',requests,d.requests.map(r=>[r.identity,r.peer,r.event]));
 const peers=new Map();
 for(const [i,r]of d.requests.entries()){
  ck('sequence/'+i,i,r.sequence);ck('request-identity/'+i,d.identities[r.identity],r.identityHash);
  assert(typeof r.socketId==='string'&&r.socketId.length>0&&typeof r.engineId==='string'&&r.engineId.length>0,'session binding');
  const session=[r.socketId,r.engineId];if(peers.has(r.peer))ck('stable-session/'+i,peers.get(r.peer),session);else peers.set(r.peer,session);
  assert(Number.isFinite(r.sentAt)&&r.receivedAt>=r.sentAt,'event timing');
  if(i)assert(r.sentAt>=d.requests[i-1].receivedAt,'serial actual events');
  const e=d.allowlist.find(e=>e.userId===r.identityHash);
  if(e)ck('expiry/'+i,![10,12].includes(i),r.sentAt<e.expiresAt);
 }
 ck('distinct-socket-sessions',peers.size,new Set([...peers.values()].map(x=>x[0])).size);
 const inv=d.inventories,matched=inv.matched.collections;
 const game=n=>{const found=matched.games.filter(g=>g.playerIndexToUserIndex.includes(d.identities[n]));ck('game/'+n,1,found.length);return found[0];};
 const games=[game('o1'),game('a1'),game('b1')];
 ck('distinct-games',3,new Set(games.map(g=>g.gameID)).size);
 for(const [i,names]of [['o1','o2'],['a1','a2'],['b1','b2']].entries()){
  const g=games[i];ck('participants/'+i,names.map(n=>d.identities[n]).sort(),g.playerIndexToUserIndex.filter(Boolean).sort());ck('namespace/'+i,[null,'run-a','run-b'][i],g.smokeRun??null);
  for(const n of names){const u=matched.users.filter(u=>u.userId===d.identities[n]);ck('account-count/'+n,1,u.length);ck('account-game/'+n,g.gameID,u[0].gameID);ck('account-run/'+n,[null,'run-a','run-b'][i],u[0].smokeRun??null);}
 }
 const expectedForged={1:{smokeRun:null,gameID:games[0].gameID,bypassIsolation:true},3:{namespace:'ordinary'},4:{smokeRun:'run-a',gameID:games[1].gameID},6:{smokeRun:'run-b',gameID:games[2].gameID,namespace:null,bypass:true},14:{smokeRun:'run-b',gameID:games[0].gameID}};
 for(const [i,e]of Object.entries(expectedForged))ck('forged-values/'+i,e,d.requests[i].extra);
 for(const i of [8,9,10,12,13,15])ck('denied/'+i,{event:'error',body:'SMOKE_ISOLATION_DENIED'},d.requests[i].response);
 for(const i of [0,1,2,3,4,5,6,7,11])assert(['gameStarted','playYourTurn','waitYouTurn'].includes(d.requests[i].response.event),'real admission/turn response');
 ck('authorized-revision',1,games[1].coopRevision);
 const exp=d.expired,liveExpiry=d.allowlist.find(e=>e.userId===d.identities.live).expiresAt;
 assert(exp.before.at<liveExpiry&&exp.after.at>=liveExpiry&&d.requests[12].sentAt>=liveExpiry,'live expiry timeline');
 ck('expired-connected-before',true,exp.before.connected);ck('expired-connected-after',false,exp.after.connected);
 ck('expired-before-socket',d.requests[11].socketId,exp.before.socketId);
 ck('expired-live-identity',true,exp.before.document.playerIndexToUserIndex.includes(d.identities.live));
 ck('expired-live-namespace','live',exp.before.document.smokeRun);
 ck('expired-state',exp.before.document,exp.after.document);
 ck('expired-inventories',inv['expired-before'].collections,inv['expired-after'].collections);
 ck('expired-no-account',0,inv['expired-after'].collections.users.filter(u=>u.userId===d.identities.expired).length);
 const before=inv['cleanup-before'],after=inv['cleanup-after'];
 const owned=before.collections.games.filter(g=>g.smokeRun==='run-a').map(g=>g.gameID);
 ck('owned-games',[games[1].gameID],owned);
 ck('orphan-inventory',1,before.collections.users.filter(u=>u.userId===d.fixtures.orphan.userId&&u.smokeRun==='run-a'&&!u.gameID).length);
 const expected=structuredClone(before.collections);
 expected.games=expected.games.filter(g=>!owned.includes(g.gameID));expected.users=expected.users.filter(u=>u.smokeRun!=='run-a');
 assert(Array.isArray(expected.turns),'complete turns inventory');
 expected.turns=expected.turns.filter(t=>!owned.includes(t.gameID));
 ck('exact-cleanup-inventory',expected,after.collections);
 ck('other-database-preserved',before.other,after.other);
 ck('sentinel-turn-present',1,after.collections.turns.filter(t=>t._id==='smoke-capture-sentinel'&&t.value===421).length);
 ck('cleanup-response',{event:'smokeRunCleaned',body:{games:owned.length}},d.requests[14].response);
 const life=d.lifecycle;assert(life.endpoints.https.startsWith('https://127.0.0.1:'),'local HTTPS');ck('same-network-endpoint',life.endpoints.https,life.endpoints.socketIo);
 ck('real-processes',['mongod','server'],life.processes.map(p=>p.role).sort());
 return checks;
}
function review(dir,receipt,bound=F.manifest(dir)){
 const checks=[],read=n=>{A.proofKey(dir,n,bound);return A.read(path.join(dir,n));};
 const ck=(id,e,o)=>{assert.deepEqual(o,e,id);checks.push({id:'smoke/'+id,expected:e,observed:o,pass:true});};
 ck('receipt-hash',receipt.sha256,A.hash(receipt.file));const command=A.read(receipt.file);
 ck('provider-exit',0,command.actualExit);ck('capture-environment','1',command.environment.SMOKE_CAPTURE);
 ck('capture-preload','--require /root/diplomacy/ops/smoke_capture_provider.js',command.environment.NODE_OPTIONS);
 assert(command.argv.includes('smoke-isolation')&&fs.realpathSync(command.argv[command.argv.indexOf('--output-dir')+1])===fs.realpathSync(dir),'actual provider invocation binding');
 const install=read('smoke-install.json');ck('capture-install',{file:P.FILE,originalSha256:P.PIN,instrumentedSha256:require('node:crypto').createHash('sha256').update(P.instrument(fs.readFileSync(P.FILE,'utf8'))).digest('hex'),observerSha256:A.hash(require.resolve('./smoke_capture_provider'))},install);
 const ids=read('source-identities.json');ck('current-sources',[],A.compareSources(ids));
 // Reviewed implementation remains byte-bound; changing policy requires review.
 const policy=read('smoke-policy-binding.json');ck('pinned-policy-review',require('./smoke_capture_policy.json'),policy);
 for(const [file,h]of Object.entries(policy.files))ck('implementation/'+file,h,A.hash(file));
 ck('required-policy-files',['/root/diplomacy/ops/task225-smoke-policy-review.md','/root/diplomacy_server/server/index.js','/root/diplomacy_server/server/smokeIsolation.js'],Object.keys(policy.files).sort());
 for(const file of Object.keys(policy.files).filter(f=>f.startsWith('/root/diplomacy_server/'))){const rel=path.relative('/root/diplomacy_server',file);ck('tested-implementation/'+rel,policy.files[file],ids.after.server.files[rel]);}
 checks.push(...semantic(read('smoke-observations.json')));
 ck('preserved-cases',CASES,read('verification-plan.json').cases.map(c=>c.id));
 const cp=read('checkpoints.json');ck('original-count',15,cp.checkpoints.length);for(const c of cp.checkpoints){assert(c.pass);ck('provider/'+c.id,c.expected,c.observed);}
 const scan=read('smoke-secret-scan.json');ck('secrets',[],scan.leaks);ck('secret-count',8,scan.credentialCount);ck('secret-scan-pass',true,scan.pass);assert(scan.files.some(f=>f.file.endsWith('/smoke-observations.json'))&&scan.files.some(f=>f.file.endsWith('/server.log')),'secret scan observation and service streams');
 for(const f of scan.files)ck('scanned-file/'+f.file,f.sha256,A.hash(f.file));
 const cleanup=read('cleanup.json');ck('cleanup-processes',2,cleanup.processes.length);assert(cleanup.processes.every(p=>!p.aliveAfter)&&cleanup.directories.every(d=>!d.existsAfter)&&cleanup.allowlistRemoved,'complete cleanup');
 const children=read('child-results.json');assert(children.children.length===1&&children.children[0].exitCode===0,'actual child receipt');
 return {criteria:[1,2,3],checks,wholeCriterionCredit:true,derivation:'Pinned source review derives authentication and lookup enforcement. Independent comparison of actual HTTPS/Socket.IO identities, forged values, session/expiry ordering and complete Mongo inventories derives isolation and exact cleanup; raw credential scan and real provider receipts are required. No UI claim and no literal TASK-223 acquisition-location credit.'};
}
function rowFor(tasks,n,report,manifest){
 assert([1,2,3].includes(n)&&report.wholeCriterionCredit);
 const text=tasks.find(t=>t.id==='TASK-223').acceptance_criteria[n-1],ref=file=>({file,sha256:manifest[file]});
 return {id:'TASK-223/AC'+n,targetSha256:R.digest(text),reviewer:'Independent smoke capture and pinned implementation review',clauses:[{text,disposition:'reviewed',runTask:'TASK-223-SMOKE',tier:'real-network',caseIds:CASES.filter(c=>c!=='lookup-boundary'),sourceIdentity:ref('source-identities.json'),traces:[ref('smoke-observations.json')],milestoneIds:['smoke/distinct-games','smoke/exact-cleanup-inventory'],proofs:['smoke-observations.json','smoke-install.json','smoke-secret-scan.json','smoke-policy-binding.json','smoke-review.json','cleanup.json','child-results.json'].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('smoke-review.json')})),derivation:report.derivation,reason:'Whole AC'+n+'; other smoke criteria remain independent unresolved obligations.',followUp:{scope:'Reacquire exact smoke proof if bound sources change.',acceptance:'All source/network/cleanup clauses independently verified.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}}]};
}
module.exports={semantic,review,rowFor};
