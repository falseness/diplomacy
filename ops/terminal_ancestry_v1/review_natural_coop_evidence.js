// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Read observations and derive expectations; never use an archived pass flag as an oracle.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const O=require('/root/diplomacy_server/tests/reliability/helpers/observations');
const {timingWithinReceipt}=require('./review_camera_evidence');
const CASES=['network','browser'],HISTORICAL=[1,2,3,8],CURRENT=[1,2,3,4,5,6,7,8,9];
const NET='network/network-tiny-h2-s1-fog-on-simultaneous/';
function review(dir,criteria=HISTORICAL,receipt=null,boundManifest=null){
 const coverage=A.read(path.join(dir,'coverage-results.json')),manifest=boundManifest||coverage.evidenceHashes,proofs={},checks=[];
 const file=n=>{A.proofKey(dir,n,manifest);proofs[n]=manifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8'),lines=n=>text(n).split('\n').filter(Boolean).map(JSON.parse);
 const check=(owners,id,expected,observed)=>{assert.deepEqual(observed,expected,'natural/'+id);for(const owner of owners.filter(n=>criteria.includes(n)))checks.push({owner,id:'natural/AC'+owner+'/'+id,expected,observed,pass:true});};
 const cp=read('checkpoints.json').checkpoints,plan=read('verification-plan.json'),identities=read('source-identities.json');
 const row=id=>{const rows=cp.filter(c=>c.id===id);assert.equal(rows.length,1,'missing-or-duplicate-natural-checkpoint:'+id);return rows[0];};
 const observed=id=>row(id).observed;
 const one=(rows,label)=>{assert.equal(rows.length,1,'missing-or-duplicate-natural-record:'+label);return rows[0];};
 const source=n=>{const p=path.join(A.root,n);assert.equal(A.hash(p),identities.after.server.files[n],'changed-executed-natural-source:'+n);proofs[p]=A.hash(p);return fs.readFileSync(p,'utf8');};
 // This normalizer only projects serialized observations, not game rules.
 source('tests/reliability/helpers/observations.js');
 check(CURRENT,'case-ids',CASES,coverage.cases.map(c=>c.id));check(CURRENT,'planned-cases',CASES,plan.cases.map(c=>c.id));
 for(const [i,id] of CASES.entries())check([1,2,3,8],id+'/manifest',[2,'tiny',1,i===0,i===0?'simultaneous':'sequential',i+1],['humans','size','seed','fog','join','rounds'].map(k=>plan.cases[i][k]));
 check([3,8],'exclusions',['18/36-case browser matrix','100-round games','high-count browsers','natural terminal guarantee','combat/production claims'],plan.exclusions);
 check([2,3,8],'no-fixtures','none; production generation and natural AI, real clocks',plan.fixtures);
 const initial=read(NET+'initial-board.json'),events=read(NET+'events.json'),persist=read(NET+'persistence.json');
 const nc=s=>observed('network/network-tiny-h2-s1-fog-on-simultaneous:'+s);
 check([1],'network/generated',[2,1,'tiny',14],[initial.gameSettings.coop.generation.playerCount,initial.gameSettings.coop.generation.seed,initial.gameSettings.coop.generation.size,initial.grid.length]);
 for(const n of ['connected','distinct sockets','persisted participants'])check([1],'network/'+n,2,nc(n));
 check([1],'network/slots',[1,2],nc('distinct slots'));check([1],'network/rounds',[1,1],nc('round reached'));
 check([1],'network/persisted-counts',[2,2,1],[persist.participants,persist.rounds,persist.canonical.gameRound]);
 for(const kind of ['submit-hold','outgoing-hold','persisted-hold'])check([1,3],'network/'+kind,[[1,0],[2,0]],events.filter(r=>r.event===kind).map(r=>[r.slot,r.round]));
 for(const slot of [1,2]){
  const sent=one(events.filter(r=>r.event==='outgoing-hold'&&r.slot===slot),'hold/'+slot).board;
  const stored=one(events.filter(r=>r.event==='persisted-hold'&&r.slot===slot),'stored/'+slot).board;
  check([1,3],'network/hold-exact/'+slot,O.sharedGameplay(sent),O.sharedGameplay(stored));
  check([1],'network/opening-income/'+slot,100+4+7-1,sent.players[slot].gold);
  check([1],'network/canonical-income/'+slot,110,persist.canonical.players[slot].gold);
  const received=events.filter(r=>r.board&&r.slot===slot&&r.board.gameRound===1&&r.event!=='persisted-hold').at(-1);assert(received,'missing-network-final-board');
  check([1],'network/convergence/'+slot,O.sharedGameplay(persist.presentation),O.sharedGameplay(received.board));
  check([1],'network/fog/'+slot,true,received.board.isFogOfWar);
  check([1],'network/roster/'+slot,[[1,2],3,4],[received.board.gameSettings.coop.humanSlots,received.board.gameSettings.coop.demonSlot,received.board.players.length]);
 }
 check([1],'network/next-activation',120,persist.presentation.players[1].gold);
 const records=read('browser/per-action-checkpoints.json');check([2],'browser/one-natural-game',1,records.length);
 const record=records[0],ledger=lines('browser/action-ledger.jsonl'),wire=read('browser/opening-event-ledger.json'),inputs=lines('browser/input-traces.jsonl');
 const bc=s=>observed('browser/coop:'+s);
 for(const [id,expected] of [['participants',2],['distinct-browser-contexts',2],['connected-browsers',[true,true]],['seed-size-fog',{seed:1,size:'tiny',fog:false}]])check(CURRENT,'browser/'+id,expected,bc(id));
 check([2],'browser/initial-components',[[1,2]],record.initialComponents.map(c=>c.slots));
 check([2],'browser/fixtures','none; natural games created through shipped menus',record.fixtures);
 check([2,3],'browser/action-tags',['coop:r0:p1','coop:r0:p2','coop:r1:p1','coop:r1:p2'],record.actions.map(r=>r.tag));
 const sent=wire.filter(r=>r.direction==='sent'&&r.event==='nextTurn');check([2,3],'browser/commit-count',4,sent.length);
 for(const label of ['legal single-step move','end turn'])check([2,3],'browser/input/'+label,4,inputs.filter(r=>(r.label===label||r.label?.startsWith(label+' cell='))&&r.via==='mouse.click').length);
 check([2],'browser/menu-joins',2,inputs.filter(r=>r.label==='join slot').length);
 const reload=inputs.filter(r=>r.action==='reload');check([2],'browser/reload-count',1,reload.length);
 for(const [i,action] of record.actions.entries()){
  const round=Math.floor(i/2),slot=i%2+1,tag=action.tag,player=slot===1?'host':'peer',before=action.before.game;
  check([2,3],tag+'/action','move',action.action);check([2],tag+'/eligible',[round,slot,false],[before.gameRound,action.before.controls.slot,action.before.controls.waiting]);
  check([2,3],tag+'/income',110+round*10,before.players[slot].gold);
  const units=before.players[slot].units;check([2,3],tag+'/one-mover',1,units.length);const u=units[0];check([2,3],tag+'/mover',['noob',2,2],[u.name,u.hp,u.moves]);
  check([2],tag+'/source',{x:u.x,y:u.y},action.source);
  const a=action.source,b=action.target,az=a.y-(a.x-(a.x&1))/2,bz=b.y-(b.x-(b.x&1))/2;
  check([2,3],tag+'/adjacent',1,Math.max(Math.abs(a.x-b.x),Math.abs(az-bz),Math.abs(a.x+az-b.x-bz)));
  check([2],tag+'/owned-target',slot,before.ownership[b.x][b.y]);
  const expected=structuredClone(before);Object.assign(expected.players[slot].units[0],{x:b.x,y:b.y,moves:u.moves-1});
  check([2,3],tag+'/derived-move',expected,action.after.game);check([2,3],tag+'/archived-oracle',expected,action.expected);
  check([2,3],tag+'/wire',expected,O.sharedGameplay(O.packetBoard(sent[i])));
  check([2,3],tag+'/wire-player',player,sent[i].player);
  const committed=one(ledger.filter(r=>r.stage==='committed'&&r.round===round&&r.slot===slot),tag+'/commit');check([2,3],tag+'/stored',expected,committed.stored);
  const post=one(ledger.filter(r=>r.stage==='round-complete'&&r.player===player&&r.state.game.gameRound===round+1),tag+'/complete').state;
  const refreshed=structuredClone(expected.players[slot]);if(slot===1){refreshed.gold+=10;refreshed.units.forEach(u=>u.moves=2);}
  check([2,3],tag+'/refresh',refreshed,post.game.players[slot]);check([2,3],tag+'/ownership',expected.ownership,post.game.ownership);
  check([2],tag+'/controls',{tick:slot===1,undo:slot===1,enabled:slot===1,waiting:slot!==1,slot},post.controls);
  if(round===1)check([2],tag+'/play-after-reload',true,Date.parse(reload[0].at)<sent[i].at);
 }
 for(const round of [0,1]){
  const phase=one(ledger.filter(r=>r.stage==='round-phase'&&r.round===round),'round-phase/'+round);
  check([2,3],'browser/phase/'+round,['@@handleNextTurn 1','@@handleNextTurn 2','@@createNewRound'],phase.phase.map(l=>l.replace(/^(@@createNewRound).*/,'$1')));
  check([2,3],'browser/persisted-rounds/'+round,round+2,phase.roundCount);
 }
 // Reconnect is between the first round completion and the next active observation.
 const prior=one(ledger.filter(r=>r.stage==='round-complete'&&r.player==='host'&&r.state.game.gameRound===1),'reconnect-before').state.game;
 const after=one(ledger.filter(r=>r.stage==='active'&&r.player==='host'&&r.state.game.gameRound===1),'reconnect-after').state.game;
 check([2],'browser/reconnect',prior,after);check([2],'browser/reconnect-checkpoint',prior,bc('reconnect-exact'));
 for(const r of ledger.filter(r=>r.stage==='broadcast')){
  const state=one(ledger.filter(s=>s.stage===r.observation&&s.player===r.player&&s.state?.opening.commit.revision===O.packetBoard(r.packet)?.coopCommit.revision),'broadcast/'+r.player+'/'+O.packetBoard(r.packet)?.coopCommit.revision).state;
  check([2,3],'broadcast/'+r.player+'/'+state.game.gameRound+'/'+r.observation,O.sharedGameplay(O.packetBoard(r.packet)),state.game);
 }
 const shots=Object.keys(manifest).filter(n=>n.startsWith('browser/screenshots/')&&n.endsWith('.png')).sort();check([2,5],'browser/screenshots',7,shots.length);
 for(const n of shots)check([2,5],'png/'+n,'89504e470d0a1a0a',fs.readFileSync(file(n)).subarray(0,8).toString('hex'));
 check([3,8],'outcomes',[['network',1,false],['browser',2,false]],read('outcomes.json').map(r=>[r.id,r.completedRounds,r.terminalClaim]));
 if(criteria.some(n=>[4,5,6,7,9].includes(n))){
  check([5,6,7],'current-sources',[],require('../historical_source_binding').observation('natural',dir,identities));
  const browser=source('tests/reliability/helpers/natural-coop-browser.js'),network=source('tests/reliability/helpers/natural-coop-network.js'),suite=source('tests/reliability/natural-coop-2.test.js');
  check([7],'real-services',true,[browser,network].every(s=>s.includes('await withServices(')&&s.includes('service.mongo.db(')));
  check([7],'natural-inputs',true,browser.includes("await join(host,mode,passwords.host);await join(peer,mode,passwords.peer)")&&network.includes('generateCoopGame(')&&network.includes('await Promise.allSettled('));
  check([7],'no-fake-clock-network',false,/clock\.install|clock\.pause|useFakeTimers|\.fulfill\(/.test(browser+network));
  check([7],'tiers',['real HTTPS/Socket.IO/MongoDB; no browser claim','shipped Chromium UI and real HTTPS/Socket.IO/MongoDB'],plan.cases.map(r=>r.tier));
  for(const [id,life,cleanup] of [['network',read('network/lifecycle.json').lifecycle,read('network/lifecycle.json').cleanup],['browser',read('browser/lifecycle.json'),read('browser/cleanup.json')]]){
   check([5,6,7],id+'/ready',[1,200,true,true],[life.readiness.database.ping,life.readiness.https.statusCode,life.readiness.https.authorized,life.readiness.socketIo.connected]);
   check([9],id+'/roles',['server','mongod'],cleanup.processes.map(p=>p.role));check([9],id+'/dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));check([9],id+'/removed',[false,false],cleanup.directories.map(d=>d.existsAfter));
   check([5,6],id+'/exit',[0,null,null],['exit','signal','error'].map(k=>read(id+'/exit.json')[k]));
  }
  check([5,6],'browser-errors',[],read('browser/browser-errors.json'));
  for(const n of ['network/services/server.log','browser/coop/services/server.log'])check([5,6],'errors/'+n,[],text(n).split('\n').filter(l=>/Error handling|Unhandled|TypeError|AssertionError|ReferenceError|RangeError/.test(l)));
  const controls=read('browser/negative-controls.json');check([6],'negative-controls',['teleport','hp','moves','gold','ownership'],controls.map(c=>c.name));check([6],'negative-reasons',Array(5).fill('ERR_ASSERTION'),controls.map(c=>c.reason));
  const served=read('browser/served-sources.json');check([5,7],'served-count',true,Object.keys(served).length>50);for(const [n,h] of Object.entries(served))if(identities.after.client.files[n])check([5,7],'served/'+n,identities.after.client.files[n],h);
  check([5],'runtime',true,['node','chromium','playwright'].every(k=>/\d+\.\d+/.test(record.runtime[k])));
  function secrets(v){if(typeof v==='string'){let x;try{x=JSON.parse(v.startsWith('42[')?v.slice(2):v);}catch{}if(x&&typeof x==='object')secrets(x);return;}if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/^(password|privateKey|userId)$/i.test(k))assert(/^\[redacted\]$|^\*$/.test(x),'natural-unredacted-credential');secrets(x);}}
  for(const n of Object.keys(manifest).filter(n=>/\.(json|jsonl|log)$/.test(n))){const s=text(n);assert(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(s),'natural-private-key');if(n.endsWith('.json'))secrets(JSON.parse(s));else if(n.endsWith('.jsonl'))s.split('\n').filter(Boolean).map(JSON.parse).forEach(secrets);}
  for(const r of inputs.filter(r=>/password/i.test(r.label||'')))assert(!('x'in r)&&!('y'in r),'natural-password-coordinates');check([5],'credentials-redacted',true,true);
  const child=read('child-results.json'),budget=read('verification-budget.json'),log=text('verification.log');
  assert(receipt?.file&&receipt.sha256,'missing-natural-receipt');assert.equal(A.hash(receipt.file),receipt.sha256);proofs[receipt.file]=receipt.sha256;const received=A.read(receipt.file);
  check([5,6,9],'os-exit',[0,null],[received.actualExit,received.signal]);check([5,9],'receipt-command',child.invocation.argv,received.argv);check([5,9],'receipt-cwd',A.root,received.cwd);
  check([5,6],'children',[[0,null,false]],child.children.map(c=>[c.exitCode,c.signal,c.timedOut]));check([6],'tap',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},child.children[0].tap.summary);
  check([5],'literal-command',true,log.includes('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+child.invocation.argv.join(' '))&&log.includes('CWD='+A.root+'\nNODE='+child.invocation.node));
  for(const c of child.children){const streams=['stdoutPath','stderrPath'].map(k=>text(path.relative(child.outputDir,c[k])));check([5],'full-child-streams',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));}
  for(const [i,c] of cp.entries())check([5,6],'checkpoint/'+i+'/'+c.id,c.expected,c.observed);
  const failure=path.join(A.client,'artifacts/TASK-215/green-20260925T031403Z/verification.log');proofs[failure]=A.hash(failure);const failed=fs.readFileSync(failure,'utf8');
  check([4,6],'retained-first-failure',true,failed.includes('hold opening gold slot')&&failed.includes('CHILD_ACTUAL_EXIT_STATUS=1'));
  check([4],'replayed-opening-income',[110,110],[nc('hold opening gold slot 1'),nc('hold opening gold slot 2')]);
  check([9],'receipt-envelope',true,timingWithinReceipt(budget,received));check([9],'budget-exits',[0],budget.exits);check([9],'estimate',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  check([9],'deadline',true,source('tests/reliability/run.js').includes('competitiveStartedMs + 3300000')&&suite.includes('deadline-Date.now()'));
  for(const repo of [A.client,A.root])check([5,9],'diff-and-staging/'+repo,true,log.includes('PASS diff-check:'+repo)&&log.includes('PASS artifacts-unstaged:'+repo));
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-natural-assertion');
 return {checks,proofs,criteria,caseIds:CASES,derivation:'Two distinct protocol clients hold one generated tiny seed-1 fog-on round; two browser contexts play two fog-off rounds through sequential menu joins. Expected income is 100+4+7-1, then +10 per activation; each observed adjacent owned-cell move changes only the selected noob coordinates and one move point. Independently compare whole states with outgoing commits, stored turns, broadcasts and reconnect; no natural terminal or high-count claim.'};
}
function rowFor(tasks,report,manifest,n){const text=tasks.find(t=>t.id==='TASK-215').acceptance_criteria[n-1],ref=f=>({file:f,sha256:manifest[f]}),checks=report.checks.filter(c=>c.owner===n);return {id:'TASK-215/AC'+n,targetSha256:R.digest(text),reviewer:'Independent natural co-op evidence review',clauses:[{text,disposition:'reviewed',runTask:'TASK-215',tier:n===1?'real-network':'natural-browser',caseIds:n===1?['network']:['browser'],sourceIdentity:ref('source-identities.json'),traces:[NET+'events.json','browser/opening-event-ledger.json','browser/action-ledger.jsonl'].map(ref),contextIds:['natural/AC'+n+'/browser/distinct-browser-contexts'],milestoneIds:['natural/AC'+n+'/case-ids'],proofs:[...Object.keys(report.proofs).filter(f=>!path.isAbsolute(f)),'natural-independent-review.json'].map(ref),assertions:checks.map(c=>({id:c.id,expected:c.expected,proof:ref('natural-independent-review.json')})),reason:'Complete independently reviewed TASK-215 criterion; full audit remains prerequisite-gated.',derivation:report.derivation,followUp:{scope:'Refresh only stale or insufficient natural co-op evidence.',acceptance:'Independent observations bound to current sources',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,CASES,HISTORICAL,CURRENT};
