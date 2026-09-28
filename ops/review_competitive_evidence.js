'use strict';
// Independent arithmetic and state deltas; archived expected/pass fields are not oracles.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const O=require('/root/diplomacy_server/tests/reliability/helpers/observations');
const {timingWithinReceipt}=require('./review_camera_evidence');
const CASES=['competitive-1-attack-and-protect-h2-fog-off-sequential','competitive-2-open-field-h4-fog-on-simultaneous'];
const HISTORICAL=[1,2,3,7],CURRENT=[1,2,3,4,5,6,7,8];
const INVENTORY=[['open field',2,21,21],['open field',3,26,26],['open field',4,25,25],['tiny deathmatch',2,20,10],['stationary warfare',2,21,21],['two rivers',2,21,23],['mountain wall',2,21,23],['two in one',2,21,23],['tower defense',2,21,23],['capture rush',2,21,21],['strategic war',2,21,21],['reinforcement',2,21,23],['rush or defend',2,21,23],['sneak attack',2,21,23],['flank attack',2,21,21],['attack and protect',2,21,21],['fight forever',2,40,30],['fight forever',3,39,39]];
const distance=(a,b)=>{const z=p=>p.y-(p.x-(p.x&1))/2;return Math.max(Math.abs(a.x-b.x),Math.abs(z(a)-z(b)),Math.abs(a.x+z(a)-b.x-z(b)));};
function groups(state,humans){
 const fields=Array.from({length:humans},(_,i)=>{const slot=i+1,units=state.players[slot].units;assert(units.every(u=>u.name==='noob'),'unsupported competitive roster');const cells=new Set();state.ownership.forEach((col,x)=>col.forEach((owner,y)=>{if(owner===slot||units.some(u=>state.ownership[u.x][u.y]===slot&&distance(u,{x,y})<=2))cells.add(x+','+y);}));return cells;});
 const remaining=new Set(fields.map((_,i)=>i)),result=[];
 while(remaining.size){const component=[remaining.values().next().value];remaining.delete(component[0]);for(let i=0;i<component.length;i++)for(const j of [...remaining])if([...fields[component[i]]].some(c=>fields[j].has(c))){component.push(j);remaining.delete(j);}result.push(component.map(i=>i+1).sort((a,b)=>a-b));}return result;
}
function review(dir,criteria=HISTORICAL,receipt=null,boundManifest=null){
 const coverage=A.read(path.join(dir,'coverage-results.json')),manifest=boundManifest||coverage.evidenceHashes,proofs={},checks=[];
 const file=n=>{A.proofKey(dir,n,manifest);proofs[n]=manifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8');
 const check=(owners,id,expected,observed)=>{assert.deepEqual(observed,expected,'competitive/'+id);for(const owner of owners.filter(n=>criteria.includes(n)))checks.push({owner,id:'competitive/AC'+owner+'/'+id,expected,observed,pass:true});};
 const cp=read('checkpoints.json').checkpoints,plan=read('verification-plan.json'),identities=read('source-identities.json');
 const observed=id=>{const rows=cp.filter(r=>r.id===id);assert.equal(rows.length,1,'missing-or-duplicate-competitive-checkpoint:'+id);return rows[0].observed;};
 const one=(rows,label)=>{assert.equal(rows.length,1,'missing-or-duplicate-competitive-record:'+label);return rows[0];};
 const source=n=>{const p=path.join(A.root,n);assert.equal(A.hash(p),identities.after.server.files[n],'changed-executed-competitive-source:'+n);proofs[p]=A.hash(p);return fs.readFileSync(p,'utf8');};
 source('tests/reliability/helpers/observations.js');
 const inventory=read('inventory.json').inventory;
 check([1],'inventory',INVENTORY,inventory.map(r=>[r.map,r.humans,r.size.x,r.size.y]));
 check([1],'inventory-indices',INVENTORY.map((r,i)=>INVENTORY.slice(0,i).filter(p=>p[0]===r[0]).length),inventory.map(r=>r.index));
 const sorted=inventory.slice().sort((a,b)=>a.map.localeCompare(b.map)||a.humans-b.humans);
 const expectedCases=[2,4].map((humans,i)=>({...sorted.find(c=>c.humans===humans),fog:!!i,join:i?'simultaneous':'sequential',seed:1,id:CASES[i]}));
 check(CURRENT,'case-ids',CASES,coverage.cases.map(c=>c.id));
 check([1,2,7],'planned-cases',expectedCases,plan.cases.map(({tier,...c})=>c));
 check([1,2,7],'case-manifest',expectedCases,read('case-manifest.json').cases);
 check([1,2,7],'seed-convention','Static competitive maps have no seed input; seed 1 is the manifest convention',read('case-manifest.json').seedApplicability);
 check([2,3,7],'no-fixture','none; shipped menu maps',read('case-manifest.json').fixtures);
 check([2,3,7],'exclusions',['full inventory cross-product','100 rounds','combat','production','guaranteed terminal'],plan.exclusions);
 for(const [ci,c] of expectedCases.entries()){
  const prefix=c.id+'/',tag=c.id+'/',j=read(prefix+'journal.json'),wire=read(prefix+'wire.json'),inputs=text(prefix+'input-trace.jsonl').trim().split('\n').map(JSON.parse);
  const ck=(owners,id,e,o)=>check(owners,tag+id,e,o),pc=(round,s)=>observed(c.id+':r'+round+':'+s);
  const initial=one(j.filter(r=>r.stage==='initial'),'initial'),moves=j.filter(r=>r.stage==='move'),commits=j.filter(r=>r.stage==='commit'),received=j.filter(r=>r.stage==='round-received'),persisted=j.filter(r=>r.stage==='round-persisted'),reconnect=one(j.filter(r=>r.stage==='reconnected'),'reconnect');
  const sent=wire.filter(r=>r.direction==='sent'&&r.event==='nextTurn');
  ck(CURRENT,'contexts',c.humans,pc(-1,'distinct-contexts'));
  ck([1],'occupied',c.humans,initial.stored.playerIndexToUserIndex.filter(Boolean).length);
  ck([1],'slots',Array.from({length:c.humans},(_,i)=>i+1),pc(-1,'slots'));
  ck([1,2,3],'actions',[2*c.humans,2*c.humans,2*c.humans,2*c.humans,2],[moves.length,commits.length,sent.length,received.length,persisted.length]);
  ck([1,2],'joins',Array.from({length:c.humans},(_,i)=>'p'+(i+1)).sort(),j.filter(r=>r.stage==='join-dispatch').map(r=>r.player).sort());
  for(const label of ['first legal move','end turn'])ck([2,3],label,2*c.humans,inputs.filter(r=>r.label?.startsWith(label)&&r.via==='mouse.click').length);
  ck([1,2],'menu-inputs',c.humans+1,inputs.filter(r=>r.label==='online menu'&&r.via==='mouse.click').length);
  ck([2,3],'reload',1,inputs.filter(r=>r.action==='reload').length);
  ck([1,2,3],'initial-components',groups(O.localGameplay(initial.state),c.humans),initial.stored.rounds[0].slice(1).map(g=>g.turns.map(t=>t.playerIndex)));
  // Pinned maps have two/one seven-cell towns, no buildings, and two/one noobs.
  const towns=ci===0?2:1,income=towns*(4+7)-towns;
  const initialBoard=initial.stored.rounds[0][0].parallelTurnResult;
  for(let slot=1;slot<=c.humans;slot++){
   const p=initialBoard.players[slot];ck([3],'opening/'+slot,[1000,towns,towns],[p.gold,p.towns.length,p.units.length]);
   for(const [i,t] of p.towns.entries())ck([3],'town/'+slot+'/'+i,[7,0,true],[t.suburbs.filter(s=>s.isSuburb&&initialBoard.grid[s.x][s.y]===slot).length,t.buildings.length,t.suburbs.every(s=>s.isSuburb)]);
  }
  for(let round=0;round<2;round++){
   const roundMoves=moves.slice(round*c.humans,(round+1)*c.humans),merged=O.localGameplay(roundMoves[0].before);
   ck([2,3],'move-order/'+round,Array.from({length:c.humans},(_,i)=>i+1),roundMoves.map(m=>m.slot));
   for(const [i,m] of roundMoves.entries()){
    const slot=i+1,k=round*c.humans+i,b=m.before,expected=O.localGameplay(b),u=expected.players[slot].units.find(u=>u.x===m.source.x&&u.y===m.source.y);
    assert(u,'missing-competitive-mover');ck([2,3],'eligible/'+k,[round,slot,false,c.fog,true],[b.gameRound,b.whooseTurn,b.waiting,b.fog,b.socket.connected]);
    ck([3],'active-income/'+k,1000+(round+1)*income,b.players[slot].gold);
    ck([3],'mover/'+k,['noob',2,2,slot],[u.name,u.hp,u.moves,m.source.owner]);
    ck([2,3],'adjacent/'+k,1,distance(m.source,m.target));ck([3],'owned-target/'+k,slot,b.ownership[m.target.x][m.target.y]);
    u.x=m.target.x;u.y=m.target.y;u.moves--;for(const p of expected.players)p.units.sort((a,b)=>a.x-b.x||a.y-b.y||a.name.localeCompare(b.name));
    ck([2,3],'derived-move/'+k,expected,O.localGameplay(m.after));ck([3],'archived-oracle/'+k,expected,m.expected);
    ck([3],'commit-slot/'+k,slot,commits[k].slot);ck([3],'stored/'+k,expected,O.sharedGameplay(commits[k].stored.gameObject));
    ck([3],'wire/'+k,expected,O.sharedGameplay(O.packetBoard(sent[k])));
    const sender=sent[k].player;ck([1,3],'sender-slot/'+k,slot,initial.stored.playerIndexToUserIndex.indexOf('[user-'+sender.slice(1)+']'));
    merged.players[slot]=structuredClone(expected.players[slot]);
   }
   merged.gameRound=round+1;
   const nextGroups=groups(merged,c.humans),eligible=nextGroups.map(g=>g[0]),stored=persisted[round].stored;
   ck([2,3],'round-count/'+round,round+2,stored.rounds.length);
   ck([3],'next-components/'+round,nextGroups,stored.rounds[round+1].slice(1).map(g=>g.turns.map(t=>t.playerIndex)));
   for(const slot of eligible){merged.players[slot].gold+=income;merged.players[slot].units.forEach(u=>u.moves=2);}
   const occupancy=merged.ownership.map(col=>col.map(()=>null));for(const p of merged.players)for(const u of p.units){assert.equal(occupancy[u.x][u.y],null);occupancy[u.x][u.y]={owner:p.index,name:u.name};}
   for(let slot=1;slot<=c.humans;slot++){
    const state=one(received.filter(r=>r.slot===slot&&r.state.gameRound===round+1),'receipt').state;
    ck([3],'receipt/'+round+'/'+slot,merged,O.localGameplay(state));ck([3],'waiting/'+round+'/'+slot,!eligible.includes(slot),state.waiting);
    ck([3],'occupancy/'+round+'/'+slot,occupancy,pc(round,slot+':round-receipt-live-occupancy'));
    for(const field of ['other-unit','paint','occupancy'])ck([5],'negative/'+round+'/'+slot+'/'+field,true,pc(round,slot+':negative-receipt-'+field));
   }
   if(round===0){ck([2,3],'reconnect-state',merged,O.localGameplay(reconnect.state));ck([2,3],'reconnect-slot',1,reconnect.slot);ck([2,3],'play-after-reconnect',true,j.indexOf(reconnect)<j.indexOf(moves[c.humans]));}
  }
  ck([1,2,3,7],'outcome',[c.humans,2,false,false,false],['participants','rounds','terminalClaim','combatClaim','productionClaim'].map(k=>coverage.cases[ci][k]));
  ck([4],'trace-copy',{journal:j,wire},read('action-traces/'+c.id+'.json'));
  const shots=Object.keys(manifest).filter(n=>n.startsWith(prefix+'screenshots/')&&n.endsWith('.png'));ck([2,4],'screenshots',2*c.humans,shots.length);for(const n of shots)ck([2,4],'png/'+n,'89504e470d0a1a0a',fs.readFileSync(file(n)).subarray(0,8).toString('hex'));
  if(criteria.some(n=>[4,5,6,8].includes(n))){
   const life=read(prefix+'service-lifecycle.json'),cleanup=read(prefix+'cleanup.json');
   ck([4,5,6],'ready',[1,200,true,true],[life.readiness.database.ping,life.readiness.https.statusCode,life.readiness.https.authorized,life.readiness.socketIo.connected]);
   ck([8],'cleanup-roles',['server','mongod'],cleanup.processes.map(p=>p.role));ck([8],'dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));ck([8],'removed',[false,false],cleanup.directories.map(d=>d.existsAfter));
   ck([4,5],'browser-errors',[],read(prefix+'browser-errors.json'));
   ck([4,5],'server-errors',[],text(prefix+'services/server.log').split('\n').filter(l=>/Error handling|Unhandled|TypeError|AssertionError|ReferenceError|RangeError/.test(l)));
   const served=read(prefix+'served-sources.json');ck([4,6],'served-count',true,Object.keys(served).length>50);for(const [n,h] of Object.entries(served))if(identities.after.client.files[n])ck([4,6],'served/'+n,identities.after.client.files[n],h);
  }
 }
 if(criteria.some(n=>[4,5,6,8].includes(n))){
  check([4,5,6],'current-sources',[],A.compareSources(identities));
  check([4],'matrix',coverage.cases,read('matrix.json').results);check([4],'outcomes',coverage.cases,read('outcomes.json'));
  const browser=source('tests/reliability/helpers/natural-competitive-browser.js');
  check([6],'real-services',true,browser.includes('await withServices(')&&browser.includes('service.mongo.db(')&&browser.includes('await BrowserPlayer.open('));
  check([6],'no-fake-clock',false,/clock\.install|clock\.pause|useFakeTimers|\.fulfill\(/.test(browser));
  check([6,7],'tiers',Array(2).fill('shipped browser UI + real HTTPS/Socket.IO/MongoDB'),plan.cases.map(c=>c.tier));
  check([6],'source-tier','source metadata only',plan.inventoryTier);
  const child=read('child-results.json'),budget=read('verification-budget.json'),log=text('verification.log');
  assert(receipt?.file&&receipt.sha256,'missing-competitive-receipt');assert.equal(A.hash(receipt.file),receipt.sha256);proofs[receipt.file]=receipt.sha256;const actual=A.read(receipt.file);
  check([4,5,8],'os-exit',[0,null],[actual.actualExit,actual.signal]);check([4,8],'receipt-command',child.invocation.argv,actual.argv);check([4,8],'receipt-cwd',A.root,actual.cwd);
  check([4,5],'children',[[0,null,false]],child.children.map(c=>[c.exitCode,c.signal,c.timedOut]));check([5],'tap',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},child.children[0].tap.summary);
  check([4],'literal-command',true,log.includes('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+child.invocation.argv.join(' '))&&log.includes('CWD='+A.root+'\nNODE='+child.invocation.node));
  for(const c of child.children){const streams=['stdoutPath','stderrPath'].map(k=>text(path.relative(child.outputDir,c[k])));check([4],'full-streams',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));const runtime=streams[0].split('\n').filter(l=>l.includes('runtime {'));check([4],'runtime-versions',true,runtime.length===2&&runtime.every(l=>['node','chromium','playwright'].every(k=>new RegExp('"'+k+'":"v?\\d+\\.\\d+').test(l))));}
  for(const [i,c] of cp.entries())check([4,5],'checkpoint/'+i+'/'+c.id,c.expected,c.observed);
  function secrets(v){if(typeof v==='string'){let x;try{x=JSON.parse(v.startsWith('42[')?v.slice(2):v);}catch{}if(x&&typeof x==='object')secrets(x);return;}if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/^(password|privateKey|userId)$/i.test(k))assert(/^\[redacted\]$|^\*$/.test(x),'competitive-unredacted-credential');secrets(x);}}
  for(const n of Object.keys(manifest).filter(n=>/\.(json|jsonl|log)$/.test(n))){const s=text(n);assert(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(s),'competitive-private-key');if(n.endsWith('.json'))secrets(JSON.parse(s));else if(n.endsWith('.jsonl'))s.split('\n').filter(Boolean).map(JSON.parse).forEach(secrets);}
  check([4],'credentials-redacted',true,true);
  // Earlier run passed its own checker. Retain it without inventing a failure:
  // green-02 added the stronger full-recipient state and occupancy assertions.
  const prior=path.join(A.client,'artifacts/TASK-219/green-20260925-01/verification-budget.json');proofs[prior]=A.hash(prior);
  check([5],'retained-earlier-run-exits',[0],A.read(prior).exits);
  check([8],'receipt-envelope',true,timingWithinReceipt(budget,actual));check([8],'exits',[0],budget.exits);check([8],'estimate',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  check([8],'deadline',true,source('tests/reliability/run.js').includes('competitiveStartedMs + 3300000')&&browser.includes('stopAt-Date.now()'));
  for(const repo of [A.client,A.root])check([4,8],'diff-and-staging/'+repo,true,log.includes('PASS '+repo+':diff-check')&&log.includes('PASS '+repo+':artifacts-unstaged'));
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-competitive-assertion');
 return {checks,proofs,criteria,caseIds:CASES,derivation:'Pinned 18-map inventory and lexical two/four-player selection. Two natural rounds, one adjacent owned-cell noob move per player per round. Derive income from two/one seven-cell towns minus two/one noobs; independently merge moves and connected influence components, then activation income and movement refresh. Compare whole states to wire, MongoDB commits, all browser recipients and reconnect; no combat, production or terminal claim.'};
}
function rowFor(tasks,report,manifest,n){const text=tasks.find(t=>t.id==='TASK-219').acceptance_criteria[n-1],ref=f=>({file:f,sha256:manifest[f]}),checks=report.checks.filter(c=>c.owner===n);return {id:'TASK-219/AC'+n,targetSha256:R.digest(text),reviewer:'Independent natural competitive evidence review',clauses:[{text,disposition:'reviewed',runTask:'TASK-219',tier:'natural-browser',caseIds:CASES,sourceIdentity:ref('source-identities.json'),traces:CASES.map(c=>ref(c+'/journal.json')),contextIds:CASES.map(c=>'competitive/AC'+n+'/'+c+'/contexts'),milestoneIds:['competitive/AC'+n+'/case-ids'],proofs:[...Object.keys(report.proofs).filter(f=>!path.isAbsolute(f)),'competitive-independent-review.json'].map(ref),assertions:checks.map(c=>({id:c.id,expected:c.expected,proof:ref('competitive-independent-review.json')})),reason:'Complete independently reviewed TASK-219 criterion; full audit remains prerequisite-gated.',derivation:report.derivation,followUp:{scope:'Refresh only stale or insufficient natural competitive evidence.',acceptance:'Independent current observations',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,CASES,HISTORICAL,CURRENT};
