'use strict';
// Version 2: explicit reviewed current implementation and immutable historical ancestry.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),AC2=require('./review_terminal_ac2_v2');
const {complete,reviewBoundary}=require('./review_terminal_boundary');
const P=require('./terminal_ac3_provider');
const clone=x=>structuredClone(x);
const one=(xs,label)=>{assert.equal(xs.length,1,label+' count');return xs[0];};
const live=e=>typeof e?.name==='string'&&e.name!=='Empty'&&e.killed===false;
function normalized(raw) {
 const r=clone(raw);
 // Empty objects are allocated when a unit vacates a cell. Their anonymous
 // identity is not gameplay; every occupied cell retains its exact raw alias.
 for(const col of r.state.grid.items)for(const cell of col.items)if(!live(cell.unit))cell.unit=null;
 return r;
}
function expectedMove(raw,from,to) {
 complete(raw);const e=normalized(raw),s=e.state,slot=s.whooseTurn;
 const unit=one(s.players.items[slot].units.items.filter(u=>u.coord.x===from.x&&u.coord.y===from.y),'selected raw unit');
 assert.equal(unit.name,'noob','legal opening type');assert(unit.moves>0&&unit.hp===2&&!unit.killed,'legal opening unit');
 const z=p=>p.y-(p.x-(p.x&1))/2;
 assert.equal((Math.abs(from.x-to.x)+Math.abs(z(from)-z(to))+Math.abs(from.x+z(from)-to.x-z(to)))/2,1,'adjacent legal movement');
 const src=s.grid.items[from.x]?.items[from.y],dst=s.grid.items[to.x]?.items[to.y];
 assert(dst&&dst.hexagon.playerColor===slot&&!dst.unit&&!live(dst.building),'unoccupied own destination');
 for(const key of ['external','externalProduction','nature','goldmines'])assert(!e.extended[key].items.some(u=>u.coord.x===to.x&&u.coord.y===to.y),'unblocked destination '+key);
 assert.deepEqual(src.unit,unit,'source registry occupancy');
 unit.coord=clone(to);unit.moves--;src.unit=null;dst.unit=clone(unit);s.undoLength++;
 return e;
}
function reviewCase({mode,trace,inputs}) {
 const checks=[],ck=(id,e,o)=>{assert.deepEqual(o,e,'AC3/'+mode+'/'+id);checks.push({id:'terminal/AC3/'+mode+'/'+id,expected:clone(e),observed:clone(o),pass:true});};
 const rows=trace.filter(r=>r.stage==='ac3-passive');
 ck('sequence',rows.map((_,i)=>i+1),rows.map(r=>r.sequence));
 ck('row-count',20,rows.length);
 const get=(participant,boundary)=>one(rows.filter(r=>r.kind==='page'&&r.participant===participant&&r.boundary===boundary),participant+'/'+boundary);
 const terminal=one(trace.filter(r=>r.stage==='mongo-terminal'),'terminal database').stored;
 const docs=boundary=>one(rows.filter(r=>r.kind==='persistence'&&r.boundary===boundary),boundary+' database');
 const baseDocs=docs('first-move-before'),newDoc=one(baseDocs.documents.filter(d=>d.gameID!==terminal.gameID),'new persisted game');
 ck('two-games',2,baseDocs.documents.length);
 ck('old-database-unchanged',terminal,one(baseDocs.documents.filter(d=>d.gameID===terminal.gameID),'old game'));
 ck('new-database-mode',mode,newDoc.rounds[0][0].parallelTurnResult.gameSettings.coop?'coop':'competitive');
 assert(newDoc.gameID!==terminal.gameID,'new game identity');
 for(const boundary of ['first-move-after','callbacks-before','callbacks-after'])ck(boundary+'/database',baseDocs.documents,docs(boundary).documents);
 const coordinate=label=>{
  const row=one(inputs.filter(r=>r.label?.startsWith(label+' cell=')),label);
  ck(label+'/input',['p1','tap','mouse.click'],[row.player,row.action,row.via]);
  const m=row.label.match(/cell=(\d+),(\d+)$/);assert(m,'input coordinate');return {x:+m[1],y:+m[2]};
 };
 const from=coordinate('select new game unit'),to=coordinate('first legal move in next game');
 for(const participant of ['p1','p2']) {
  const ready=one(trace.filter(r=>r.stage==='ac3-readiness'&&r.participant===participant),'native readiness');
  ck(participant+'/ready-mode',mode,ready.mode);
  ck(participant+'/ready-control',false,ready.after.unactive);
  assert(Number.isFinite(ready.before.at)&&ready.after.at>=ready.before.at,'ordered readiness timing');
  const retained=one(rows.filter(r=>r.kind==='retained'&&r.participant===participant),'named retention');
  const invoked=one(rows.filter(r=>r.kind==='invoked'&&r.participant===participant),'named invocation');
  const old=get(participant,'menu-before'),menu=get(participant,'menu-after'),pre=get(participant,'first-move-before'),post=get(participant,'first-move-after'),cb=get(participant,'callbacks-before'),after=get(participant,'callbacks-after');
  const stages=[retained,old,menu,pre,post,cb,invoked,after];
  assert(stages.every((r,i)=>i===0||r.sequence>stages[i-1].sequence),'ordered raw boundaries');
  const labels=['return from finished game','next online game','new game start','new game slot'];
  const events=labels.map(label=>one(inputs.filter(r=>r.player===participant&&r.label===label),participant+'/'+label));
  ck(participant+'/menu-inputs',labels.map(()=>['tap','mouse.click']),events.map(r=>[r.action,r.via]));
  assert(events.every((r,i)=>i===0||inputs.indexOf(r)>inputs.indexOf(events[i-1])),'ordered actual menu inputs');
  for(const r of stages)ck(participant+'/session-'+r.sequence,old.session,r.session);
  for(const r of [old,menu,pre,post,cb,after]){complete(r.raw);ck(participant+'/recipient-'+r.sequence,Number(participant.slice(1)),r.raw.state.whooseTurn);}
  ck(participant+'/retained-game',terminal.gameID,retained.oldGameId);
  ck(participant+'/old-commit',terminal.gameID,old.raw.state.commit.gameID);
  ck(participant+'/retained-socket',old.raw.state.socket,old.raw.state.oldSocket);
  ck(participant+'/retained-timer',old.raw.state.timer,old.raw.state.oldTimer);
  ck(participant+'/menu-closed',[true,null,false,false],[menu.raw.ui.menu,menu.raw.state.socket,menu.raw.state.oldSocket.connected,menu.raw.state.oldTimer.isTick]);
  for(const r of [menu,pre,post,cb,after]){
   ck(participant+'/old-socket-'+r.sequence,old.raw.state.socket.identity,r.raw.state.oldSocket.identity);
   ck(participant+'/old-timer-'+r.sequence,old.raw.state.timer.identity,r.raw.state.oldTimer.identity);
  }
  for(const r of [pre,post,cb,after]){
   const s=r.raw.state;
   ck(participant+'/connection-'+r.sequence,[mode,false,true,2],[r.connection.mode,r.raw.ui.menu,s.socket.connected,r.connection.lobby.occupiedHumans]);
   ck(participant+'/old-stopped-'+r.sequence,[false,false],[s.oldSocket.connected,s.oldTimer.isTick]);
   assert(s.socket.identity!==s.oldSocket.identity&&s.timer.identity!==s.oldTimer.identity,'new socket/timer identity');
   ck(participant+'/new-commit-'+r.sequence,mode==='coop'?newDoc.gameID:null,s.commit?.gameID??null);
  }
  const expected=participant==='p1'?expectedMove(pre.raw,from,to):normalized(pre.raw);
  ck(participant+'/first-move-full-raw',expected,normalized(post.raw));
  ck(participant+'/no-intervening-change',post.raw,cb.raw);
  ck(participant+'/callback-body',JSON.stringify(terminal.rounds.at(-1)[0].parallelTurnResult),invoked.body);
  ck(participant+'/callback-tier','source-executed-callbacks',invoked.tier);
  reviewBoundary({tier:invoked.tier,session:cb.session,beforeSession:cb.session,afterSession:after.session,
   before:cb.raw,after:after.raw,retained:retained.retained,invoked:invoked.invoked},{callbacks:true});
  ck(participant+'/named-invocations',retained.retained.map(r=>({...r,returned:true})),invoked.invoked);
  ck(participant+'/callbacks-full-raw',cb.raw,after.raw);
 }
 return {checks,wholeCriterionCredit:false};
}
function review(dir,receipt,bound=F.manifest(dir)) {
 const ac2=AC2.review(dir,receipt,bound),checks=[...ac2.checks],proofs={...ac2.proofs};
 const read=(n,jsonl=false)=>{A.proofKey(dir,n,bound);proofs[n]=bound[n];const s=fs.readFileSync(path.join(dir,n),'utf8');return jsonl?s.trim().split('\n').map(JSON.parse):JSON.parse(s);};
 for(const mode of ['coop','competitive']) {
  const id='terminal-to-'+mode,trace=read(id+'/network-traces.jsonl',true),inputs=read(id+'/input-trace.jsonl',true);
  const install=one(trace.filter(r=>r.stage==='ac3-install'),'AC3 install');
  assert.deepEqual(install,{stage:'ac3-install',mode,helperSha256:P.PIN,instrumentedSha256:require('node:crypto').createHash('sha256').update(P.instrument(fs.readFileSync(P.FILE,'utf8'))).digest('hex'),providerSha256:A.hash(path.join(__dirname,'terminal_ac3_provider.js')),tier:'browser-menu-and-movement;source-executed-callbacks'},'instrumented producer binding');
  checks.push(...reviewCase({mode,trace,inputs}).checks);
 }
 proofs[path.join(__dirname,'terminal_ac3_provider.js')]=A.hash(path.join(__dirname,'terminal_ac3_provider.js'));
 return {criteria:[3],checks,proofs,caseIds:F.CASES,wholeCriterionCredit:true,
  derivation:'Preserve and independently revalidate all four AC2 journeys and lifecycle. Join actual menu inputs in both new modes to ordered raw participant/session/socket/timer/commit boundaries. Derive the first legal adjacent own-land noob move from input coordinates and raw storage; compare full remaining state and occupancy. Named nonempty old listeners execute once with original terminal bytes using bare-call semantics; unchanged raw state and read-only databases bracket source-tier invocations on both pages. Native timer storage is compared unchanged, never frozen.'};
}
module.exports={review,reviewCase,expectedMove,normalized};
