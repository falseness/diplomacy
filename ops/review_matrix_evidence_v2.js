'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const {timingWithinReceipt}=require('./review_camera_evidence');
// IEEE-754 multiplication after clamping can differ from 5/14 by one ULP.
// This reader permits 1e-12 absolute error at the lower bound; decrease remains strict.
const CASES=['chromium-coop-desktop','firefox-competitive-desktop','webkit-coop-mobile','chromium-attack-fixture'];
const HISTORICAL=[1,7],CURRENT=[1,2,3,4,5,6,7,8];
const SETTINGS=[['chromium',true,true,'simultaneous'],['firefox',false,false,'sequential'],['webkit',true,true,'sequential'],['chromium',true,false,'sequential']];
function review(dir,criteria=HISTORICAL,receipt=null,boundManifest=null){
 const coverage=A.read(path.join(dir,'coverage-results.json')),manifest=boundManifest||coverage.evidenceHashes,proofs={},checks=[];
 const file=n=>{A.proofKey(dir,n,manifest);proofs[n]=manifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8'),lines=n=>text(n).split('\n').filter(Boolean).map(JSON.parse);
 const check=(owners,id,expected,observed)=>{assert.deepEqual(observed,expected,'matrix/'+id);for(const owner of owners.filter(n=>criteria.includes(n)))checks.push({owner,id:'matrix/AC'+owner+'/'+id,expected,observed,pass:true});};
 const cp=read('checkpoints.json').checkpoints,plan=read('verification-plan.json'),identities=read('source-identities.json');
 const row=id=>{const rows=cp.filter(c=>c.id===id);assert.equal(rows.length,1,'missing-or-duplicate-matrix-checkpoint:'+id);return rows[0];};
 const source=n=>{const p=path.join(A.root,n);assert.equal(A.hash(p),identities.after.server.files[n],'changed-executed-matrix-source:'+n);proofs[p]=A.hash(p);return fs.readFileSync(p,'utf8');};
 const browser=source('tests/reliability/helpers/browser-matrix-browser.js'),suite=source('tests/reliability/browser-matrix.test.js');
 check(CURRENT,'case-ids',CASES,coverage.cases.map(c=>c.id));check(CURRENT,'planned-cases',CASES,plan.cases.map(c=>c.id));
 check([1,6,7],'bounded-exclusions',['both modes on every engine','three rounds per engine','extra viewport products','native WebKit drag/pinch','automatic responsive rotation (landscape uses reload/rejoin)'],plan.exclusions);
 check([1,6,7],'real-context-count-source',true,browser.includes('for(let i=0;i<2;i++){')&&browser.includes('await browser.newContext(')&&browser.includes('new Set(ps.map(p=>p.page.context())).size'));
 check([6],'services-and-browser',true,browser.includes('await withServices(')&&browser.includes('await engines[c.engine].launch(')&&browser.includes('service.mongo.db(service.databaseName)'));
 check([6],'no-fake-time-or-network',false,/clock\.install|clock\.pause|setSystemTime|useFakeTimers|\.fulfill\(/.test(browser));
 for(const [index,id] of CASES.entries()){
  const [engine,coop,fog,join]=SETTINGS[index],owners=[1,6,7],cfg=plan.cases[index],fixture=read(id+'/declared-fixture.json'),runtime=read(id+'/runtime.json'),trace=lines(id+'/network-traces.jsonl'),inputs=lines(id+'/input-trace.jsonl');
  const observed=s=>row(id+'/'+s).observed;
  check(owners,id+'/plan',[engine,coop,fog,join,2,'tiny',1],[cfg.engine,cfg.coop,cfg.fog,cfg.join,cfg.humans,cfg.size,cfg.seed]);
  check(owners,id+'/fixture',[2,'tiny',1,14,false],[fixture.spec.humans,fixture.spec.size,fixture.spec.seed,fixture.spec.side,fixture.b.gameSettings.withAI]);
  check(CURRENT,id+'/participants',2,observed('participants'));
  check([1,3,4,6,7],id+'/engine',engine,runtime.engine);check([1,3,4],id+'/runtime-present',true,[runtime.version,runtime.node,runtime.playwright].every(v=>typeof v==='string'&&/\d+\.\d+/.test(v)));
  const joins=trace.filter(r=>r.stage==='api-join'),assign=trace.filter(r=>r.stage==='admission-assignments');
  check(owners,id+'/slots',[1,2],joins.map(r=>r.board.whooseTurn).sort());check(owners,id+'/identities',[0,1],joins.map(r=>r.identity).sort());
  check(owners,id+'/actual-mode',[coop,coop],joins.map(r=>!!r.board.gameSettings.coop));
  check(owners,id+'/fixture-mode',coop,!!fixture.b.gameSettings.coop);
  check([1,6,7],id+'/input-tier',index===2?'native taps; DOM TouchEvents for drag/pinch (no native multitouch claim)':'native mouse/keyboard',cfg.gestureTier);
  check(owners,id+'/fog',[fog,fog],joins.map(r=>r.board.isFogOfWar));check(owners,id+'/join',[join,join],joins.map(r=>r.join));
  check(owners,id+'/one-game',1,assign.length);check(owners,id+'/persistent-slots',[1,2],assign[0].assignments.map(r=>r.slot).sort());check(owners,id+'/persistent-identities',[true,true],assign[0].assignments.map(r=>r.matches));
  for(const p of ['p1','p2'])check([1,2,6],id+'/'+p+'/connection',true,observed(p+'/connection'));
  if(index===2){check([1,7],id+'/portrait',[390,844],observed('portrait'));check([1,7],id+'/landscape',[844,390,844,390],observed('landscape'));for(const p of ['p1','p2'])check([1,7],id+'/'+p+'/orientation',row(id+'/'+p+'/orientation-state').expected,observed(p+'/orientation-state'));}
  check([2],id+'/first-move',{name:'noob',x:1,y:7,moves:1},observed('first-move'));
  for(const label of ['first move cell=1,7','purchase archer','commit first player','commit second player'])check([2,6],id+'/input/'+label,1,inputs.filter(r=>r.label===label&&r.via===(index===2?'touchscreen.tap':'mouse.click')).length);
  const commits=trace.filter(r=>r.stage==='outgoing-turn');check([2,6],id+'/commit-players',[1,2],commits.map(r=>r.player));
  const games=commits.map(r=>{const p=JSON.parse(r.packet.slice(2));assert.equal(p[0],'nextTurn');return JSON.parse(p[1]).game;});
  const at=(b,slot,x,y)=>b.players[slot].units.filter(u=>u.coord.x===x&&u.coord.y===y);
  check([2],id+'/wire-mover',[[['noob',1]],[]],[at(games[0],1,1,7).map(u=>[u.name,u.moves]),at(games[0],1,1,6)]);
  if(index===3){check([2],id+'/attack',{victimAbsent:true,hp:1,moves:0},observed('legal-attack'));check([2],id+'/wire-victim',[],at(games[0],0,5,3));check([2],id+'/wire-attacker',[[1,0]],at(games[0],1,5,1).map(u=>[u.hp,u.moves]));}
  const durable=trace.filter(r=>r.stage==='durable-round');check([2,6],id+'/durable-round',[1],durable.map(r=>r.stored.gameRound));
  const reconnect=row(id+'/reconnect/public-board');check([2],id+'/reconnect',reconnect.expected,reconnect.observed);check([2],id+'/reconnected-round',1,reconnect.observed.gameRound);
  check([2],id+'/real-reloads',index===2?3:2,inputs.filter(r=>r.player==='p1'&&r.action==='reload').length);
  for(const label of ['scale','actions','reconnected',...(index===2?['portrait','landscape']:[])]){
   const names=Object.keys(manifest).filter(n=>n.startsWith(id+'/screenshots/')&&n.endsWith('-'+label+'.png'));check([1,2,4,7],id+'/capture/'+label,1,names.length);check([1,2,4,7],id+'/png/'+label,'89504e470d0a1a0a',fs.readFileSync(file(names[0])).subarray(0,8).toString('hex'));
  }
  if(criteria.includes(2)){
   const samples=lines(id+'/matrix-observations.jsonl'),sample=k=>{const rows=samples.filter(r=>r.kind===k&&r.player==='p1');assert.equal(rows.length,1,'missing-matrix-sample:'+id+'/'+k);return rows[0].value;};
   const before=sample('scale-before'),after=sample('scale-after'),gold=sample('gold-before');
   check([2],id+'/scale-input-binding',before,after.before);check([2],id+'/numeric-scale-change',true,Number.isFinite(before)&&Number.isFinite(after.after)&&after.after>=5/14-1e-12&&after.after<before);
   check([2],id+'/purchase',{gold:gold-40,queue:'archer'},observed('purchase'));check([2],id+'/wire-purchase',[gold-40,'archer',2,40],[games[0].players[1].gold,...['name','turns','cost'].map(k=>games[0].players[1].towns.find(t=>t.coord.x===1&&t.coord.y===1).unitProduction[k])]);
  }
  const navFiles=[id+'/navigation-errors.json',...(index===2?['p1','p2'].map(p=>id+'/'+p+'-orientation-navigation.json'):[])];
  const navigations=navFiles.map(read);
  check([3,4,5],id+'/unexplained-pageerrors',[],trace.filter(r=>r.stage==='pageerror').filter(r=>!navigations.some(n=>typeof n.oldSession==='string'&&n.oldSession.length>0&&r.message.includes('sid='+n.oldSession+' due to access control checks.')&&n.events.some(e=>e.type==='pageerror'&&e.text===r.message))));
  check([3,4,5],id+'/browser-errors',[],read(id+'/browser-errors.json'));check([3,4,5],id+'/server-errors',[],text(id+'/services/server.log').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)));
  const cleanup=read(id+'/cleanup.json');check([8],id+'/process-roles',['server','mongod'],cleanup.processes.map(p=>p.role));check([8],id+'/dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));check([8],id+'/removed',[false,false],cleanup.directories.map(d=>d.existsAfter));
  if(criteria.includes(4)){
   const served=read(id+'/served-sources.json');check([4,6],id+'/served-source-count',true,Object.keys(served).length>50);for(const [n,h] of Object.entries(served))if(identities.after.client.files[n])check([4,6],id+'/served/'+n,identities.after.client.files[n],h);
   function secrets(v){if(typeof v==='string'){let x;try{x=JSON.parse(v.startsWith('42[')?v.slice(2):v);}catch{}if(x&&typeof x==='object')secrets(x);return;}if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/^(password|privateKey|userId)$/i.test(k))assert(/^\[redacted\]$|^\[secret-[12]\]$/.test(x),'matrix-unredacted-credential');secrets(x);}}
   trace.forEach(secrets);for(const r of inputs)if(/password/i.test(r.label||''))assert(!('x'in r)&&!('y'in r),'matrix-password-coordinates');check([4],id+'/credentials-redacted',true,true);
  }
 }
 if(criteria.some(n=>[3,4,5,6,8].includes(n))){
  check([3,4,5,6,8],'current-sources',[],A.compareSources(identities));
  const child=read('child-results.json'),budget=read('verification-budget.json'),log=text('verification.log');
  assert(receipt?.file&&receipt.sha256,'missing-matrix-receipt');assert.equal(A.hash(receipt.file),receipt.sha256);proofs[receipt.file]=receipt.sha256;const received=A.read(receipt.file);
  check([3,4,5,8],'os-exit',[0,null],[received.actualExit,received.signal]);check([4,8],'receipt-command',child.invocation.argv,received.argv);check([4,8],'receipt-cwd',A.root,received.cwd);
  check([2,4,6],'observer','--require '+path.join(A.client,'ops/matrix_observer.js'),received.nodeOptions);
  const observer=path.join(A.client,'ops/matrix_observer.js');check([2,4,6],'observer-hash',identities.after.client.files['ops/matrix_observer.js'],A.hash(observer));proofs[observer]=A.hash(observer);
  check([3,4,5,8],'children',[[0,null,false]],child.children.map(c=>[c.exitCode,c.signal,c.timedOut]));
  check([3,4,5],'tap',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},child.children[0].tap.summary);
  check([4],'command-runtime',true,log.includes('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+child.invocation.argv.join(' '))&&log.includes('CWD='+A.root+'\nNODE='+child.invocation.node));
  for(const c of child.children){const streams=['stdoutPath','stderrPath'].map(k=>text(path.relative(child.outputDir,c[k])));check([4],'full-child-streams',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));}
  for(const n of ['dependencies','provisioning']){check([3,4,5],n+'/exit',0,row(n+'-exit').observed);check([3,4],n+'/log',true,text(n+'.log').includes('ACTUAL_EXIT_STATUS=0 SIGNAL=null'));}
  check([4,5],'unique-checkpoints',cp.length,new Set(cp.map(c=>c.id)).size);for(const c of cp)check([4,5],'checkpoint/'+c.id,c.expected,c.observed);
  const failure=path.join(A.client,'artifacts/TASK-214/green-20260925T022204Z/verification.log');proofs[failure]=A.hash(failure);
  check([5],'retained-failure',true,fs.readFileSync(failure,'utf8').includes('CHILD_ACTUAL_EXIT_STATUS=1'));
  for(const n of Object.keys(manifest).filter(n=>/\.(jsonl|log)$/.test(n)))check([4],'private-key/'+n,false,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text(n)));
  check([5],'cases-pass',[true,true,true,true],coverage.cases.map(c=>c.pass));
  check([8],'receipt-envelope',true,timingWithinReceipt(budget,received));check([8],'budget-exits',[0],budget.exits);check([8],'estimate',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  check([8],'deadline',true,source('tests/reliability/run.js').includes('competitiveStartedMs + 3300000')&&suite.includes('Date.now()<Number(process.env.OPENING_COMPETITIVE_STOP_AT)'));
  for(const repo of [A.client,A.root])check([4,8],'diff-and-staging/'+repo,true,log.includes('PASS diff-check:'+repo)&&log.includes('PASS artifacts-unstaged:'+repo));
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length);
 return {checks,proofs,criteria,caseIds:CASES,derivation:'Declared four fixed journeys, tiny seed 1, two distinct human contexts, raw admissions/inputs/commits/durable round and numeric scale/gold samples (1e-12 absolute lower-bound tolerance, strict decrease); 40-gold archer purchase, one-cell noob move and lethal fixture attack. Historical AC1/7 only: historical boolean scale/purchase summaries do not supply numeric before/after proof. DOM pinch is not native multitouch and orientation uses reload.'};
}
function rowFor(tasks,report,manifest,n){const text=tasks.find(t=>t.id==='TASK-214').acceptance_criteria[n-1],ref=f=>({file:f,sha256:manifest[f]});return {id:'TASK-214/AC'+n,targetSha256:R.digest(text),reviewer:'Independent browser matrix evidence review',clauses:[{text,disposition:'reviewed',runTask:'TASK-214',tier:'natural-browser',caseIds:CASES,sourceIdentity:ref('source-identities.json'),traces:CASES.map(id=>ref(id+'/network-traces.jsonl')),contextIds:['matrix/AC'+n+'/'+CASES[0]+'/participants'],milestoneIds:['matrix/AC'+n+'/case-ids'],proofs:[...Object.keys(report.proofs).filter(f=>!path.isAbsolute(f)),'matrix-independent-review.json'].map(ref),assertions:report.checks.filter(c=>c.owner===n).map(c=>({id:c.id,expected:c.expected,proof:ref('matrix-independent-review.json')})),reason:'Complete independently reviewed TASK-214 criterion; no full audit closure.',derivation:report.derivation,followUp:{scope:'Refresh only stale or insufficient matrix evidence.',acceptance:'Independent observations bound to current sources',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,CASES,HISTORICAL,CURRENT};
