'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const R=require('./review_terminal_ac3'),P=require('./terminal_ac3_provider');
const results=[],clone=x=>structuredClone(x);
function fixture(mode='coop') {
 // Synthetic source contract only. Historical shapes cannot grant coverage.
 const oldTrace=fs.readFileSync('/root/diplomacy/artifacts/TASK-225/join-139/run-01/provider/terminal-to-coop/network-traces.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const terminal=oldTrace.find(r=>r.stage==='mongo-terminal').stored;
 const oldRaw=oldTrace.find(r=>r.stage==='ac2-passive'&&r.kind==='page'&&r.boundary==='replay-before').raw;
 const trace=[{stage:'mongo-terminal',stored:terminal}],inputs=[];let sequence=0;
 const emit=r=>trace.push({stage:'ac3-passive',sequence:++sequence,mode,...r});
 const snapshots={};const names=['p1','p2'];const retained=['gameStarted','playYourTurn','waitYouTurn'].map(event=>({event,index:0}));
 for(const [i,participant] of names.entries()) {
  const session='source-only-'+participant,old=clone(oldRaw);old.state.whooseTurn=i+1;
  old.state.oldSocket=clone(old.state.socket);old.state.oldTimer=clone(old.state.timer);
  emit({kind:'retained',participant,session,retained,oldGameId:terminal.gameID});
  emit({kind:'page',participant,session,boundary:'menu-before',raw:old});
  const menu=clone(old);menu.ui.menu=true;menu.state.socket=null;menu.state.oldSocket.connected=false;menu.state.oldTimer.isTick=false;
  emit({kind:'page',participant,session,boundary:'menu-after',raw:menu});
  const raw=clone(menu),s=raw.state;raw.ui.menu=false;s.result=null;s.gameRound=0;s.undoLength=0;
  s.socket={identity:9000,connected:true,id:'new'};s.timer={identity:9001,isTick:true,time:240000,lastPause:1234};
  s.commit=mode==='coop'?{gameID:'new-game',revision:0}:null;
  for(const p of s.players.items){p.units.items=[];p.towns.items=[];p.gold=100;}
  for(const key of Object.keys(raw.extended))raw.extended[key].items=[];
  raw.extended.towns.items=s.players.items.map(()=>({items:[]}));
  for(const col of s.grid.items)for(const cell of col.items){cell.unit={identity:10000,name:{absent:true},killed:{absent:true}};cell.building={identity:10001,name:{absent:true},killed:{absent:true}};cell.hexagon.playerColor=1;}
  const u={identity:11000,id:{absent:true},name:'noob',hp:2,moves:2,killed:false,wasHitted:false,coord:{x:1,y:1}};
  s.players.items[1].units.items=[clone(u)];s.grid.items[1].items[1].unit=clone(u);
  snapshots[participant]=raw;
  for(const label of ['return from finished game','next online game','new game start','new game slot'])inputs.push({player:participant,label,action:'tap',via:'mouse.click'});
 }
 const documents=[terminal,{gameID:'new-game',rounds:[[{parallelTurnResult:{gameSettings:{coop:mode==='coop'?{}:null}}}]]}];
 const pair=boundary=>{for(const participant of names)emit({kind:'page',participant,session:'source-only-'+participant,boundary,raw:clone(snapshots[participant]),connection:{mode,lobby:{occupiedHumans:2}}});emit({kind:'persistence',boundary,documents:clone(documents)});};
 pair('first-move-before');
 inputs.push(...['select new game unit cell=1,1','first legal move in next game cell=2,1'].map(label=>({label,player:'p1',action:'tap',via:'mouse.click'})));
 const s=snapshots.p1.state,unit=s.players.items[1].units.items[0],empty=clone(s.grid.items[2].items[1].unit);
 unit.coord={x:2,y:1};unit.moves=1;s.grid.items[1].items[1].unit=empty;s.grid.items[2].items[1].unit=clone(unit);s.undoLength=1;
 pair('first-move-after');pair('callbacks-before');
 for(const participant of names)emit({kind:'invoked',participant,session:'source-only-'+participant,tier:'source-executed-callbacks',body:JSON.stringify(terminal.rounds.at(-1)[0].parallelTurnResult),invoked:retained.map(r=>({...r,returned:true}))});
 pair('callbacks-after');return {mode,trace,inputs};
}
const row=(x,b='callbacks-after',p='p1')=>x.trace.find(r=>r.kind==='page'&&r.boundary===b&&r.participant===p);
test('complete synthetic AC3 contract both modes, no gameplay credit',()=>{
 for(const mode of ['coop','competitive']){const r=R.reviewCase(fixture(mode));assert.equal(r.wholeCriterionCredit,false);results.push(...r.checks);}
});
const controls=[
 ['empty-retained',x=>{x.trace.find(r=>r.kind==='retained').retained=[];},/empty retained/],
 ['missing-invoked',x=>{delete x.trace.find(r=>r.kind==='invoked').invoked;},/assert|expression/i],
 ['empty-invoked',x=>{x.trace.find(r=>r.kind==='invoked').invoked=[];},/invocation receipts/],
 ['wrong-game',x=>{row(x).raw.state.commit.gameID='wrong';},/new-commit/],
 ['wrong-recipient',x=>{row(x).raw.state.whooseTurn=2;},/recipient/],
 ['missing-boundary',x=>{x.trace=x.trace.filter(r=>r!==row(x));},/row-count|sequence/],
 ['stale-socket',x=>{row(x).raw.state.oldSocket.connected=true;},/old-stopped/],
 ['stale-timer',x=>{row(x).raw.state.oldTimer.isTick=true;},/old-stopped/],
 ['changed-moves',x=>{row(x).raw.state.players.items[1].units.items[0].moves++;},/raw boundary/],
 ['changed-hp',x=>{row(x).raw.state.players.items[1].units.items[0].hp++;},/raw boundary/],
 ['changed-gold',x=>{row(x).raw.state.players.items[1].gold++;},/raw boundary/],
 ['changed-owner',x=>{row(x).raw.state.grid.items[2].items[1].hexagon.playerColor=2;},/raw boundary/],
 ['changed-turn',x=>{row(x).raw.state.gameRound++;},/raw boundary/],
 ['changed-commit',x=>{row(x).raw.state.commit.revision++;},/raw boundary/],
 ['changed-native-timer',x=>{row(x).raw.state.timerStorage[1]='tampered';},/raw boundary/],
 ['wrong-move',x=>{row(x,'first-move-after').raw.state.players.items[1].units.items[0].moves=2;},/first-move-full-raw/],
 ['peer-change',x=>{row(x,'first-move-after','p2').raw.state.players.items[1].gold++;},/first-move-full-raw/],
 ['missing-input',x=>{x.inputs.shift();},/count/],
 ['wrong-body',x=>{x.trace.find(r=>r.kind==='invoked').body='{}';},/callback-body/]
];
for(const [id,mutate,pattern] of controls)test('rehashed AC3 rejects '+id,()=>{
 const x=fixture();mutate(x);const bytes=JSON.stringify(x),digest=crypto.createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>R.reviewCase(JSON.parse(bytes)),pattern);
 results.push({id:'reject/'+id,expected:'semantic rejection after content rebind',observed:'semantic rejection after content rebind',sha256:digest,pass:true});
});
test('pinned instrumentation retains every original check and actual input',()=>{
 const source=fs.readFileSync(P.FILE,'utf8'),changed=P.instrument(source);
 for(const pattern of [/check\('[^']+'/g,/await p\.tapControl\('[^']+'/g,/await p\.tapCell\([^\n]+/g])assert.deepEqual(changed.match(pattern),source.match(pattern));
 assert.throws(()=>P.instrument(source+'\n'),/unreviewed/);
 new (require('node:vm').Script)(changed);
});
test('real integrated preload installs without launching services',()=>{
 const child=require('node:child_process').spawnSync(process.execPath,['-e',"require('./ops/terminal_ac3_provider').install(); console.log('PASS integrated AC2/AC3 provider installed')"],{encoding:'utf8'});
 process.stdout.write(child.stdout);process.stderr.write(child.stderr);assert.equal(child.status,0);
});
test('save source-tier checks',()=>{if(process.env.AC3_OUTPUT)fs.writeFileSync(process.env.AC3_OUTPUT,JSON.stringify({tier:'synthetic source only',checkpoints:results},null,2)+'\n');});
