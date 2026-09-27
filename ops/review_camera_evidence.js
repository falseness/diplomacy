'use strict';
// Persisted camera observations are facts, never their own oracle. Expectations
// below come from the declared four-human scenario and map scale contract.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const CASES=['source-10','source-12','coop-zoom'];
const STAGES=['load','combat','received-turn','reconnect'];
const HISTORICAL=[1,2,3,7],CURRENT=[1,2,3,4,5,6,7,8];
// The provider samples elapsedMs before sampling finishedAt. Compare both to
// the independently observed OS interval instead of requiring equal samples.
function timingWithinReceipt(budget,receipt){
 const start=Date.parse(budget.startedAt),finish=Date.parse(budget.finishedAt),wall=finish-start;
 return Number.isFinite(wall)&&Number.isFinite(receipt.startedMs)&&Number.isFinite(receipt.finishedMs)&&
  budget.elapsedMs>0&&budget.elapsedMs<=wall&&wall<=3600000&&
  receipt.startedMs<=start&&finish<=receipt.finishedMs&&
  receipt.finishedMs-receipt.startedMs<=3600000;
}
function review(dir,criteria=HISTORICAL,receipt=null,boundManifest=null){
 const coverage=A.read(path.join(dir,'coverage-results.json')),manifest=boundManifest||coverage.evidenceHashes,proofs={},checks=[];
 const check=(owners,id,expected,observed)=>{assert.deepEqual(observed,expected,'camera/'+id);for(const owner of owners.filter(n=>criteria.includes(n)))checks.push({owner,id:'camera/AC'+owner+'/'+id,expected,observed,pass:true});};
 const file=n=>{A.proofKey(dir,n,manifest);proofs[n]=manifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8'),lines=n=>text(n).trim().split('\n').filter(Boolean).map(JSON.parse);
 const cp=read('checkpoints.json').checkpoints,scales=read('scale-checkpoints.json'),worlds=read('visibility-checkpoints.json');
 const plan=read('verification-plan.json'),fixture=read('coop-zoom/declared-fixture.json'),trace=lines('coop-zoom/network-traces.jsonl'),inputs=lines('coop-zoom/input-trace.jsonl');
 const identities=read('source-identities.json'),observed=id=>{const rows=cp.filter(c=>c.id===id);assert.equal(rows.length,1,'missing-or-duplicate-camera-checkpoint:'+id);return rows[0].observed;};
 const source=n=>{const p=path.join(A.root,n);assert.equal(A.hash(p),identities.after.server.files[n],'missing-executed-source:'+n);proofs[p]=A.hash(p);return fs.readFileSync(p,'utf8');};
 check(CURRENT,'case-ids',CASES,coverage.cases.map(c=>c.id));check(CURRENT,'planned-case-ids',CASES,plan.cases.map(c=>c.id));
 check([1,6,7],'fixture',[4,'tiny',1,20,false],[fixture.spec.humans,fixture.spec.size,fixture.spec.seed,fixture.spec.side,fixture.b.gameSettings.withAI]);
 check([1,6,7],'browser-plan',[true,true,'simultaneous',4,'tiny',1],['coop','fog','join','humans','size','seed'].map(k=>plan.cases[2][k]));
 check([1,7],'bounded-exclusions',['live ten/twelve-player rendering','Cartesian browser matrices','long natural games'],plan.exclusions);
 for(const owner of criteria)check([owner],'participants',4,observed('coop-zoom/participants'));
 const joins=trace.filter(r=>r.stage==='api-join'),assign=trace.filter(r=>r.stage==='admission-assignments');
 check([1,6,7],'admitted-slots',[1,2,3,4],joins.map(r=>r.board.whooseTurn).sort());
 check([1,6,7],'admitted-identities',[0,1,2,3],joins.map(r=>r.identity).sort());check([1,6,7],'one-game',1,assign.length);
 check([1,6,7],'persistent-slots',[1,2,3,4],assign[0].assignments.map(r=>r.slot).sort());
 check([1,6,7],'persistent-identity-match',[true,true,true,true],assign[0].assignments.map(r=>r.matches));
 check([1,6,7],'actual-fog',[true,true,true,true],joins.map(r=>r.board.isFogOfWar));
 check([1,6,7],'actual-join',['simultaneous','simultaneous','simultaneous','simultaneous'],joins.map(r=>r.join));
 for(const count of [10,12])for(const fog of [false,true])for(const scale of [5/32,1])check([1,6,7],`source-${count}/${fog}/${scale}`,{humans:count,players:count+2,interface:true,scale,selected:'noob'},observed(`source-${count}/fog-${fog}/scale-${scale}`));
 check([1,6],'source-tier',Array(2).fill('production-source rendering inputs; synthetic canvas, no live rendering claim'),plan.cases.slice(0,2).map(c=>c.tier));
 check([1,2,3],'milestones',STAGES.flatMap(s=>['p1','p2'].flatMap(p=>['min','max'].map(b=>s+'/'+p+'/'+b))),scales.map(r=>r.id));
 for(const row of scales){
  const [stage,player,bound]=row.id.split('/'),v=row.observed,h=row.held,b=row.before,e=bound==='min'?0.25:1;
  for(const [name,value] of [['observed',v],['held',h]]){
   check([1,2],row.id+'/'+name+'/scale',e,Math.round(value.scale*1e9)/1e9);
   check([1,2],row.id+'/'+name+'/bounds',{min:0.25,max:1},value.bounds);
   check([2,3],row.id+'/'+name+'/usable',true,value.connected&&value.interface&&Number.isFinite(value.offset.x)&&Number.isFinite(value.offset.y)&&value.pixelColors>8);
   check([1,2],row.id+'/'+name+'/viewport',[1280,900,1],[value.width,value.height,value.pageScale]);
   check([1,2,3],row.id+'/'+name+'/round',STAGES.indexOf(stage)<2?0:1,value.round);
   check([2],row.id+'/'+name+'/victim',stage!=='load'&&!(stage==='combat'&&player==='p2'),value.victimAbsent);
   if(stage==='combat'&&player==='p1')check([2],row.id+'/'+name+'/selected','archer',value.selected);
  }
  check([3],row.id+'/advancing-frames',true,b.frameTime<v.frameTime&&v.frameTime<h.frameTime);
  if(b.clock.ticking)check([3],row.id+'/natural-clock',true,h.clock.left<b.clock.left);
  const png='coop-zoom/screenshots/'+row.screenshot.file;
  check([2,3,4],row.id+'/capture-hash',row.screenshot.sha256,A.hash(file(png)));
  check([2,3,4],row.id+'/png','89504e470d0a1a0a',fs.readFileSync(file(png)).subarray(0,8).toString('hex'));
 }
 for(const stage of STAGES)for(const player of ['p1','p2'])for(const width of [1440,1280])check([1],stage+'/'+player+'/resize-'+width,[width,width===1440?1000:900],observed(`coop-zoom/${stage}/${player}/resize-${width}`));
 const wheels=inputs.filter(r=>r.action==='wheel'),pinches=inputs.filter(r=>r.action==='pinch');
 check([1,3],'wheel-inputs',true,wheels.length>=16&&wheels.every(r=>r.player==='p1'&&r.device==='mouse'&&r.deltaY===(r.bound==='min'?400:-400)));
 check([1,3],'touch-inputs',16,pinches.length);check([1,3],'pinch-contract',true,pinches.every((r,i)=>r.player==='p2'&&r.device==='touch'&&r.moves===8&&r.from===(i%4<2?300:20)&&r.to===(i%4<2?20:300)));
 const world=(stage,p='p1')=>{const rows=worlds.filter(r=>r.label===stage&&r.player===p);assert.equal(rows.length,1,'missing-camera-world:'+stage+'/'+p);return rows[0].world;};
 for(const [stage,x,y,name] of [['initial',1,6,'noob'],['initial',1,7,null],['movement',1,6,null],['movement',1,7,'noob'],['initial',5,3,'noob'],['combat-death',5,3,null]])check([1,2,3],stage+'/'+x+','+y,name,world(stage).cells[x][y].unit??null);
 for(const p of ['p1','p2','p3','p4'])check([2,3],'round/'+p+'/victim-absent',null,world('round',p).cells[5][3].unit??null);
 check([2],'destroyed-selection',null,world('round').selection);
 for(const label of ['select scout','move scout','select archer','lethal combat','commit visibility actions'])check([1,3],'mouse/'+label,true,inputs.some(r=>r.label===label&&r.player==='p1'&&r.via==='mouse.click'));
 check([1,3],'four-commits',4,trace.filter(r=>r.stage==='outgoing-turn').length);
 check([1,3],'durable-round',[1],trace.filter(r=>r.stage==='durable-round').map(r=>r.stored.gameRound));
 check([1,3],'round-reconnect-world',world('round').cells,world('reconnect').cells);
 check([1,3],'round-reconnect-assets',world('round').players,world('reconnect').players);
 check([1,3],'real-reconnect-input',criteria.includes(4)?1:2,inputs.filter(r=>r.player==='p1'&&r.action==='reload').length);
 const consoleRows=lines('render-console.jsonl');check([2,3,4,5],'console-errors',[],consoleRows.filter(r=>r.type==='error'||/TypeError|ReferenceError|undefined.*drawChanceOfWinningText/.test(r.text)));
 check([2,3,5],'pageerrors',[],trace.filter(r=>r.stage==='pageerror'));check([2,3,5],'browser-errors',[],read('coop-zoom/browser-errors.json'));
 check([2,3,5],'server-errors',[],text('coop-zoom/services/server.log').split('\n').filter(l=>/Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)));
 // These exact executed harness files are unchanged in the historical provider.
 const suite=source('tests/reliability/online-zoom.test.js'),browser=source('tests/reliability/helpers/online-zoom-browser.js'),controls=source('tests/reliability/helpers/online-zoom-controls.js');
 check([3,6],'real-browser-services',true,browser.includes('await withServices(')&&browser.includes('await chromium.launch(')&&browser.includes('service.mongo.db(service.databaseName)'));
 check([3,6],'no-clock-or-draw-replacement',false,/clock\.install|clock\.pause|setSystemTime|useFakeTimers|\.fulfill\(|\.evaluate\(/.test(browser));
 check([3,6],'real-controls',true,controls.includes("p.page.mouse.wheel(")&&controls.includes("Input.dispatchTouchEvent")&&controls.includes('requestAnimationFrame'));
 check([6],'source-only-inert-canvas',true,suite.includes('synthetic canvas, no live rendering claim')&&suite.includes('grid.drawChanceOfWinningText(mainCtx)'));
 if(criteria.some(n=>[4,5,6,8].includes(n))){
  check([4,5,6,8],'current-source-hashes',[],A.compareSources(identities));
  const child=read('child-results.json'),budget=read('verification-budget.json'),log=text('verification.log');
  assert(receipt&&receipt.file&&receipt.sha256,'missing-camera-provider-receipt');assert.equal(A.hash(receipt.file),receipt.sha256,'changed-camera-receipt');proofs[receipt.file]=receipt.sha256;
  const received=A.read(receipt.file);
  check([3,4,6],'explicit-wheel-observer','--require '+path.join(A.client,'ops/camera_wheel_observer.js'),received.nodeOptions);
  const observer=path.join(A.client,'ops/camera_wheel_observer.js');check([3,6],'wheel-observer-source',identities.after.client.files['ops/camera_wheel_observer.js'],A.hash(observer));proofs[observer]=A.hash(observer);
  check([1,6,7],'initial-menu-reuse',['p1','p3','p4'],inputs.filter(r=>r.action==='initial-menu-already-loaded').map(r=>r.player));
  check([1,6,7],'touch-initial-reload',1,inputs.filter(r=>r.player==='p2'&&r.action==='reload').length);
  check([1,3,6],'participant-commit-readiness',[['p3',{canClick:true,unactive:false,waiting:false}],['p4',{canClick:true,unactive:false,waiting:false}]],inputs.filter(r=>r.action==='participant-commit-ready').map(r=>[r.player,r.state]));
  check([1,3,6],'native-peer-transports',['p2','p3','p4'],inputs.filter(r=>r.action==='native-peer-transport').map(r=>r.player));
  const openings=inputs.filter(r=>r.action==='parallel-menu-pages-ready');check([1,6,7],'parallel-initial-pages',['p1','p2','p3','p4'],openings.map(r=>r.player));check([1,6,7],'bounded-page-setup',true,openings.every(r=>r.participants===4&&r.finishedAt>=r.startedAt));
  const wheelRecords=inputs.filter(r=>r.action==='observed-standard-wheel');
  check([3,6],'wheel-observer-phases',STAGES.flatMap(s=>['p1','p2'].map(p=>[s,p])),wheelRecords.map(r=>[r.phase,r.player]));
  check([3,6],'trusted-wheel-observations',true,wheelRecords.filter(r=>r.player==='p1').every(r=>r.events.length>0&&r.events.every(e=>e.trusted&&Math.abs(e.deltaY)===400&&Number.isFinite(e.time))));
  check([4,5,8],'provider-os-exit',[0,null],[received.actualExit,received.signal]);
  check([4,5,8],'provider-receipt-command',child.invocation.argv,received.argv);check([4,5,8],'provider-receipt-cwd',A.root,received.cwd);
  check([4,5,8],'one-child',1,child.children.length);
  check([4,5,8],'child-outcomes',[[0,null,false]],child.children.map(c=>[c.exitCode,c.signal,c.timedOut]));
  check([4,5],'tap-summary',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},child.children[0].tap.summary);
  check([4],'command-cwd-runtime',true,log.includes('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+child.invocation.argv.join(' '))&&log.includes('CWD='+A.root+'\nNODE='+child.invocation.node));
  check([4],'browser-runtime',true,/^# runtime .*"chromium":"[0-9.]+".*"playwright":"[0-9.]+".*"mongod":/m.test(log));
  for(const c of child.children){const streams=['stdoutPath','stderrPath'].map(k=>text(path.relative(child.outputDir,c[k])));check([4],'complete-child-output',true,log.includes(streams.join('\n')+'\nCHILD_ACTUAL_EXIT_STATUS=0'));}
  check([4],'unique-checkpoints',cp.length,new Set(cp.map(c=>c.id)).size);
  for(const c of cp)check([4,5],'checkpoint/'+c.id,c.expected,c.observed);
  function secrets(value){if(typeof value==='string'){const s=value.startsWith('42[')?value.slice(2):value;let v;try{v=JSON.parse(s);}catch{}if(v&&typeof v==='object')secrets(v);return;}if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){if(/^(password|privateKey|userId)$/i.test(k))assert(/^\[redacted\]$|^\[secret-[1-4]\]$/.test(v),'unredacted-camera-credential');secrets(v);}}
  trace.forEach(secrets);check([4],'credential-scan',true,true);
  for(const [i,r] of inputs.entries())if(/password/i.test(r.label||''))check([4],'password-coordinates/'+i,false,'x' in r||'y' in r);
  for(const n of Object.keys(manifest).filter(n=>/\.(jsonl|log)$/.test(n)))check([4],'private-key/'+n,false,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text(n)));
  check([5],'case-results',[true,true,true],coverage.cases.map(c=>c.pass));
  const failFile=path.join(A.client,'artifacts/TASK-213/green-06/checkpoints.json');proofs[failFile]=A.hash(failFile);const failed=A.read(failFile).checkpoints.filter(c=>!c.pass);check([5],'retained-original-failure',true,failed.some(c=>c.id==='coop-zoom/load/p2/min'&&c.expected===0.25&&c.observed===0.357142857));
  check([6],'mongodb-ping',true,text('coop-zoom/services/activity.jsonl').includes('"source":"mongodb","message":"ping ok"'));
  check([8],'positive-budget-exits',[0],budget.exits);check([8],'elapsed-within-hour',true,budget.elapsedMs>0&&budget.elapsedMs<=3600000);
  check([8],'elapsed-clock-envelope',true,timingWithinReceipt(budget,received));
  check([8],'estimate',true,plan.estimateMs>0&&plan.estimateMs<=2700000);
  const cleanup=read('coop-zoom/cleanup.json');check([8],'owned-processes',['server','mongod'],cleanup.processes.map(p=>p.role));check([8],'owned-dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));check([8],'removed-directories',[false,false],cleanup.directories.map(d=>d.existsAfter));
  check([8],'cleanup-in-budget',true,Date.parse(cleanup.startedAt)>=Date.parse(budget.startedAt)&&Date.parse(cleanup.finishedAt)<=Date.parse(budget.finishedAt));
  const runner=source('tests/reliability/run.js');check([8],'cumulative-deadline',true,runner.includes('competitiveStartedMs + 3300000')&&runner.includes('env.OPENING_COMPETITIVE_STOP_AT = String(context.competitiveDeadline - 240000)')&&suite.includes('Date.now()<Number(process.env.OPENING_COMPETITIVE_STOP_AT)'));
  for(const repo of [A.client,A.root])check([4,8],'diff-and-staging/'+repo,true,log.includes('PASS diff-check:'+repo)&&log.includes('PASS artifacts-unstaged:'+repo));
 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-camera-oracle');
 return {checks,proofs,criteria,caseIds:CASES,derivation:'Independent fixed scenario, 5/20 map minimum and unit maximum; declared stage order, actual camera/frame/clock records, raw worlds, admissions, inputs and durable commits. High-count checks are source-only. No provider pass flag supplies camera expectations.'};
}
function rowFor(tasks,report,manifest,n){const text=tasks.find(t=>t.id==='TASK-213').acceptance_criteria[n-1],ref=f=>({file:f,sha256:manifest[f]});return {id:'TASK-213/AC'+n,targetSha256:R.digest(text),reviewer:'Independent camera evidence review',clauses:[{text,disposition:'reviewed',runTask:'TASK-213',tier:[1,6,7].includes(n)?'source-executed':'natural-browser',caseIds:[1,6,7].includes(n)?CASES:['coop-zoom'],sourceIdentity:ref('source-identities.json'),traces:[ref('coop-zoom/network-traces.jsonl')],contextIds:['camera/AC'+n+'/participants'],milestoneIds:['camera/AC'+n+'/'+([1,3].includes(n)?'durable-round':'case-ids')],proofs:[...Object.keys(report.proofs).filter(f=>!path.isAbsolute(f)),'camera-independent-review.json'].map(ref),assertions:report.checks.filter(c=>c.owner===n).map(c=>({id:c.id,expected:c.expected,proof:ref('camera-independent-review.json')})),reason:'Complete TASK-213/AC'+n+' independently checked; no full TASK-225 closure.',derivation:report.derivation,followUp:{scope:'Refresh only source-drifted or insufficient camera proof.',acceptance:'Complete independent observations and current source hashes with actual exits.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,timingWithinReceipt,CASES,HISTORICAL,CURRENT};
