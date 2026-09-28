'use strict';
// Production-source fixture only: no browser/network claim. Native timers run.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {createFixture,defaultFixture}=require('../ai/test-coop-harness');
const rows=[];
function check(id,expected,observed) {
 rows.push({id,expected,observed,pass:require('node:util').isDeepStrictEqual(expected,observed)});
 if(process.env.COMMAND_BOUNDARY_OUTPUT)fs.writeFileSync(process.env.COMMAND_BOUNDARY_OUTPUT,JSON.stringify(rows,null,2)+'\n');
 assert.deepEqual(observed,expected,id);
}
for(const mode of ['coop','competitive'])test(mode+' production command preserves clean registry identities',()=>{
 const config=defaultFixture();config.coop=mode==='coop';
 const f=createFixture(config,()=>{});
 const r=f.evaluate(`(() => {
  const references=players.map(p=>p.units),members=references.map(a=>a.slice());
  const gold=players.map(p=>p.gold),commands=humanCommands.length,calls=[];
  const original=Player.prototype.updateUnits;
  Player.prototype.updateUnits=function(...args) {
   calls.push({slot:players.indexOf(this),stack:new Error().stack});
   return Reflect.apply(original,this,args);
  };
  const selected=grid.getUnit({x:2,y:2});
  selected.select();
  let result;
  try {
   // Actual production Events handler, unit command and training vectorization.
   Events.prototype.sendInstructions.call({selected},{x:2,y:3});
   result={identities:players.map((p,i)=>p.units===references[i]),
    members:players.map((p,i)=>p.units.length===members[i].length&&p.units.every((u,j)=>u===members[i][j])),
    goldBefore:gold,goldAfter:players.map(p=>p.gold),added:humanCommands.length-commands,
    unit:{x:selected.coord.x,y:selected.coord.y,hp:selected.hp,moves:selected.moves},
    undo:actionManager.arr.length,calls};
  } finally {Player.prototype.updateUnits=original;}
  return result;
 })()`);
 check(mode+'/one-real-recorded-command',1,r.added);
 check(mode+'/legal-move',{x:2,y:3,hp:2,moves:1},r.unit);
 check(mode+'/one-undo',1,r.undo);
 check(mode+'/gold-unchanged',r.goldBefore,r.goldAfter);
 check(mode+'/members-unchanged',[true,true,true,true],r.members);
 check(mode+'/production-call-chain',true,r.calls.some(c=>['sendInstructions','recordHumanCommand','vectoriseGrid','playerIncome','armySalary'].every(n=>c.stack.includes(n))));
 // Preserve stacks even when the independently required identity check fails.
 if(process.env.COMMAND_BOUNDARY_OUTPUT)fs.writeFileSync(process.env.COMMAND_BOUNDARY_OUTPUT+'.'+mode+'.trace.json',JSON.stringify(r,null,2)+'\n');
 check(mode+'/clean-registry-identities',[true,true,true,true],r.identities);
});
test('production cleanup retains removal and adjacent deduplication semantics',()=>{
 const f=createFixture(undefined,()=>{});
 const r=f.evaluate(`(() => {
  const p=players[1],a={killed:false,salary:2},b={killed:false,salary:3},dead={killed:true,salary:99};
  p.units=[dead,a,a,dead,b,b,a]; p.updateUnits();
  const first=p.units,expected=[a,b,a];
  const result={members:p.units.length===3&&p.units.every((u,i)=>u===expected[i]),salary:p.armySalary};
  result.stable=p.units===first;return result;
 })()`);
 check('cleanup/survivors-and-salary',{members:true,salary:7,stable:true},r);
});
test('peer readiness uses native one-second production deactivation',async()=>{
 const f=createFixture(undefined,()=>{});
 const r=f.evaluate(`(() => {
  nextTurnButton={unactive:false,deactivate:gameLogicButtons.prototype.deactivate};
  globalThis.mainCtx={measureText:text=>({width:String(text).length*8})};
  timer=new Timer();
  const before=Date.now();
  new NextTurnPauseInterface().visible=false;
  return {before,unactive:nextTurnButton.unactive};
 })()`);
 check('readiness/overlay-dismissal-deactivates',true,r.unactive);
 // Observe the native callback; never substitute a timer or modify its duration.
 const deadline=Date.now()+5000;
 while(f.evaluate('nextTurnButton.unactive')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 const after=f.evaluate('({at:Date.now(),unactive:nextTurnButton.unactive})');
 check('readiness/native-callback-enables',false,after.unactive);
 check('readiness/not-before-one-second',true,after.at-r.before>=1000);
 check('readiness/bounded',true,after.at-r.before<5000);
});
