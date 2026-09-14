'use strict';
// Each generated game runs in an isolated process with a hard wall-clock limit.
// Observers delegate to the original methods; only presentation/persistence and
// training side effects are stubbed. No gameplay state is edited after startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createFixture} = require('./test-coop-harness');
const arg = process.argv.indexOf('--output-dir');
const out = path.resolve(arg < 0 ? 'artifacts/TASK-133' : process.argv[arg + 1]);
const fault = process.argv.includes('--fault-noop-demons');
fs.mkdirSync(out, {recursive:true});
const write = (file, data) => fs.writeFileSync(path.join(out,file), JSON.stringify(data,null,2)+'\n');
const cases = fault ? [{size:'tiny',humans:2,mapSeed:0,fog:false}] :
  ['tiny','normal','big'].flatMap(size=>[1,2,4].flatMap(humans=>[0,1].flatMap(mapSeed=>
    [false,true].map(fog=>({size,humans,mapSeed,fog})))));
for (const c of cases) c.id=`${c.size}-H${c.humans}-seed${c.mapSeed}-fog${Number(c.fog)}`;

function installObservers() {
  gameEvent.nextTurn=()=>{};
  timer.pauseAndSaveTime=()=>{}; timer.setNextTurnTime=()=>{};
  nextTurnPauseInterface={visible:false};
  globalThis.saveManager={save(){}};
  AiRuntime.trainFromHumanCommands=()=>{};
  // The real terminal evaluator sets coop.result; the menu's only required
  // gameplay side effect is gameExit. Never assign a result in the harness.
  menuBack=()=>{gameExit=true; emit({type:'terminal',round:gameRound,result:gameSettings.coop.result});};
  globalThis.assetIds=new Map();
  let serial=0, action=null;
  const describe=e=>{
    if(!assetIds.has(e)) assetIds.set(e,++serial);
    return {id:assetIds.get(e),owner:e.playerColor,role:e.player.role,kind:e.name,
      coord:{...e.coord},hp:e.hp,killed:e.killed,moves:e.moves};
  };
  globalThis.initialHumans=players.filter(p=>p.role==='HUMAN').flatMap(p=>[...p.units,...p.towns]);
  initialHumans.forEach(describe);
  globalThis.removals=[];
  globalThis.observe=()=>({round:gameRound,turn:whooseTurn,terminal:gameExit,
    result:gameSettings.coop.result,threshold:suddenDeathRound,fog:isFogOfWar,
    waveGeneration:gameSettings.coop.waveGeneration || null,
    humans:players.filter(p=>p.role==='HUMAN').map(p=>({owner:players.indexOf(p),gold:p.gold,income:p.income,
      units:p.units.filter(u=>!u.killed).map(describe),towns:p.towns.filter(t=>!t.killed).map(describe)})),
    demons:players.filter(p=>p.role==='DEMONS').flatMap(p=>p.units.filter(u=>!u.killed).map(describe)),
    portals:external.filter(e=>e.isDemonPortal&&!e.killed).map(describe),
    initialHumanIds:initialHumans.map(e=>assetIds.get(e)),removals:[...removals]});
  const send=Unit.prototype.sendInstructions;
  Unit.prototype.sendInstructions=function(cell) {
    if(this.player.role!=='DEMONS') throw Error('unexpected human unit command');
    const before=describe(this), destination={...cell.coord};
    const legal=this.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,destination));
    if(!legal) throw Error('illegal production demon action');
    action={actor:before,destination,legal};
    emit({type:'action-start',round:gameRound,...action});
    try { return send.call(this,cell); }
    finally {emit({type:'action-end',round:gameRound,...action,after:describe(this)});action=null;}
  };
  for(const proto of [Entity.prototype,Town.prototype]) {
    const hit=proto.hit;
    proto.hit=function(damage) {
      const target=describe(this);
      emit({type:'damage',round:gameRound,actor:action&&action.actor,target,damage});
      const result=hit.call(this,damage);
      emit({type:'damage-result',round:gameRound,target:describe(this)});
      return result;
    };
  }
  for(const [proto,method] of [[Unit.prototype,'kill'],[Town.prototype,'destroy']]) {
    const original=proto[method];
    proto[method]=function(...args) {
      const target=describe(this), wasKilled=this.killed;
      const result=original.apply(this,args);
      if(!wasKilled&&this.killed) {
        const event={type:'removal',round:gameRound,method,target,actor:action&&action.actor,
          destination:action&&action.destination,cause:action?'demon-combat':'outside-demon-action'};
        emit(event);
        if(initialHumans.includes(this)) removals.push(event);
      }
      return result;
    };
  }
  const spawn=spawnCoopWave;
  spawnCoopWave=function(...args) {
    const result=spawn(...args);
    emit({type:'spawn',round:gameRound,waveRound:args[0],waveSeed:gameSettings.coop.waveGeneration.seed,...result});
    return result;
  };
  for(const p of players.filter(p=>p.role==='HUMAN')) {
    const refresh=p.nextTurn;
    p.nextTurn=function(...args) {
      const before={gold:this.gold,income:this.income};
      const result=refresh.apply(this,args);
      emit({type:'economy-refresh',round:gameRound,owner:players.indexOf(this),before,gold:this.gold,income:this.income});
      return result;
    };
  }
  // Guard every normal human economic command in addition to unit orders.
  for(const method of ['prepare','sendInstructions']) {
    const original=Town.prototype[method];
    Town.prototype[method]=function(...args) {
      if(this.player.role==='HUMAN') throw Error('unexpected human economic command');
      return original.apply(this,args);
    };
  }
}

function terminalAssertion(final) {
  assert(final.terminal && final.result==='defeat' && final.round<40 &&
    final.humans.every(p=>p.units.length===0&&p.towns.length===0) &&
    final.demons.length+final.portals.length>0,
  `missing-combat-defeat: expected terminal defeat before round 40; observed round=${final.round} result=${final.result} terminal=${final.terminal} humanAssets=${final.humans.reduce((n,p)=>n+p.units.length+p.towns.length,0)}`);
  assert.equal(final.threshold,40,'unchanged flooding threshold');
  assert.deepEqual(final.removals.map(e=>e.target.id).sort((a,b)=>a-b),final.initialHumanIds.slice().sort((a,b)=>a-b),'every initial human asset removed exactly once');
  assert(final.removals.every(e=>e.cause==='demon-combat'&&e.actor.role==='DEMONS'), 'every human elimination caused by demon combat');
}

function runCase(c) {
  const row={...c,waveSeed:0,timeoutSeconds:120,status:'running',rounds:[],journal:`${c.id}-journal.jsonl`};
  const events=[];
  const journal=path.join(out,row.journal);
  fs.writeFileSync(journal,'');
  const save=()=>write(`${c.id}.json`,row);
  save();
  const f=createFixture(undefined,()=>{}, {nativeIntrinsics:true});
  f.context.emit=event=>{
    const copy=JSON.parse(JSON.stringify(event)); events.push(copy);
    fs.appendFileSync(journal,JSON.stringify(copy)+'\n');
  };
  try {
    f.evaluate(`globalThis.generated=generateCoopGame(${c.humans},{size:'${c.size}',seed:${c.mapSeed}}); undefined`);
    row.generated=f.evaluate('JSON.parse(JSON.stringify(generated))');
    f.evaluate(`isFogOfWar=${c.fog}; generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);
      whooseTurn=0; actionManager.clear();
      (${installObservers.toString()})(); nextTurn(); undefined`);
    if(fault) f.evaluate('players[gameSettings.coop.demonSlot].combatAI={play(){}}; undefined');
    row.configuration=f.evaluate('({coop:gameSettings.coop,suddenDeathRound,isFogOfWar,aiActionLimit:gameSettings.aiActionLimit})');
    assert.equal(row.configuration.coop.balanceVersion,2);
    assert.equal(row.configuration.suddenDeathRound,40);
    row.initial=f.evaluate('observe()'); row.final=row.initial; save();
    while(row.final.round<40&&!row.final.terminal) {
      const round=row.final.round, start=events.length;
      let turns=0;
      do {
        assert(++turns<=c.humans,'stalled dispatcher: too many human end-turn calls');
        const active=f.evaluate('({role:players[whooseTurn].role,lost:players[whooseTurn].isLost,owner:whooseTurn})');
        assert.equal(active.role,'HUMAN'); assert.equal(active.lost,false);
        f.context.emit({type:'human-end-turn',round,owner:active.owner});
        f.evaluate('nextTurn(); undefined');
        row.final=f.evaluate('observe()');
      } while(row.final.round===round&&!row.final.terminal);
      assert.equal(row.final.threshold,40);
      const roundEvents=events.slice(start);
      row.rounds.push({completedFrom:round,turns,spawns:roundEvents.filter(e=>e.type==='spawn'),...row.final});
      save();
      console.log(`ROUND ${c.id} round=${row.final.round} turns=${turns} humans=${row.final.humans.reduce((n,p)=>n+p.units.length+p.towns.length,0)} demons=${row.final.demons.length} portals=${row.final.portals.length} result=${row.final.result}`);
    }
    terminalAssertion(row.final);
    row.status='passed';
    console.log(`PASS idle-humans ${c.id} round=${row.final.round} result=defeat combatRemovals=${row.final.removals.length} threshold=40`);
  } catch(error) {
    row.status='failed'; row.error=error.stack;
    console.error(error.stack); process.exitCode=1;
  } finally {save();}
}
const childIndex=process.argv.indexOf('--case');
if(childIndex>=0) {
  const c=cases.find(c=>c.id===process.argv[childIndex+1]);
  assert(c,'unknown case'); runCase(c);
} else {
  const results=[];
  for(const c of cases) {
    const args=[__filename,'--output-dir',out,'--case',c.id];
    if(fault)args.push('--fault-noop-demons');
    const started=Date.now();
    const child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000,maxBuffer:64*1024*1024});
    process.stdout.write(child.stdout||''); process.stderr.write(child.stderr||'');
    const file=path.join(out,`${c.id}.json`);
    const row=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{...c,status:'failed'};
    row.exitStatus=child.status;row.signal=child.signal;row.elapsedSeconds=(Date.now()-started)/1000;
    if(child.error||child.status!==0) {row.status='failed';row.processError=child.error&&child.error.message;}
    console.log(`CASE_EXIT ${c.id} status=${child.status} signal=${child.signal} elapsed=${row.elapsedSeconds}`);
    results.push(row);write('checkpoints.json',results);
  }
  const passed=results.filter(r=>r.status==='passed').length;
  console.log(`${passed===cases.length?'PASS':'FAIL'} idle-humans scenarios=${results.length} passed=${passed} failed=${results.length-passed}`);
  if(passed!==cases.length)process.exitCode=1;
}
