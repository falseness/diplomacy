'use strict';
// Real dispatcher workload: no round assignment, artificial units or skipped AI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const {createFixture}=require('./test-coop-harness');
const arg=process.argv.indexOf('--output-dir'),out=path.resolve(arg<0?'artifacts/TASK-127':process.argv[arg+1]);
fs.mkdirSync(out,{recursive:true});
const report={machine:{cpu:os.cpus()[0].model,cpus:os.cpus().length,platform:os.platform(),arch:os.arch(),memory:os.totalmem(),runtime:process.version,executable:process.execPath},seed:0,waveSeed:0,fastForward:false,watchdogMs:60000,phases:[],rounds:[],limits:'One Big seed-0 idle-human sample; UI, persistence and training side effects stubbed. Not a balance or broad performance claim.'};
const f=createFixture(undefined,()=>{});
function save(){fs.writeFileSync(path.join(out,'workload.json'),JSON.stringify(report,null,2)+'\n')}
function phase(name,code){const start=performance.now(),before=process.memoryUsage();try{const value=vm.runInContext(code,f.context,{timeout:60000});const row={name,milliseconds:performance.now()-start,before,after:process.memoryUsage(),status:'passed'};report.phases.push(row);console.log('PASS phase '+JSON.stringify(row));return value}catch(e){report.phases.push({name,milliseconds:performance.now()-start,status:'FAILED',error:String(e)});save();throw e}}
phase('generation','globalThis.generated=generateCoopGame(12,{size:"big",seed:0});void 0');
phase('start',`generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();
grid.visionUsed=[];grid.visionDistance=[];grid.fullInitArr(68,68,grid.visionUsed,0);grid.fullInitArr(68,68,grid.visionDistance,0);grid.newVisionUsedValue=0;grid.visionWay=new VisionWay();gameSettings.isOnline=false;gameSettings.aiActionLimit=0;gameEvent.nextTurn=()=>{};timer={pauseAndSaveTime(){},setNextTurnTime(){}};nextTurnPauseInterface={visible:false};globalThis.saveManager={save(){}};AiRuntime.trainFromHumanCommands=()=>{};menuBack=()=>{gameSettings.coop.result=players[0].coopResult;gameExit=true};
globalThis.aiPhases=[];globalThis.actionCount=0;const originalPlay=DemonPlayer.prototype.play;DemonPlayer.prototype.play=function(){const start=Date.now(),units=this.units.length;const result=originalPlay.call(this);aiPhases.push({round:gameRound,units,milliseconds:Date.now()-start});return result};const originalSend=Unit.prototype.sendInstructions;Unit.prototype.sendInstructions=function(c){if(this.player instanceof DemonPlayer)actionCount++;return originalSend.call(this,c)};void 0`);
assert.deepEqual(f.evaluate('[grid.arr.length,grid.arr[0].length,external.filter(p=>p.isDemonPortal).length,players.filter(p=>p.role==="HUMAN").length]'),[68,68,36,12]);
function capture(){const row=f.evaluate('({round:gameRound,turn:whooseTurn,humans:players.filter(p=>p.role==="HUMAN"&&!p.isLost).length,humanUnits:players.filter(p=>p.role==="HUMAN").reduce((n,p)=>n+p.units.length,0),demons:players[13].units.length,portals:external.filter(p=>p.isDemonPortal&&!p.killed).length,actions:actionCount,terminal:gameExit,result:gameSettings.coop.result})');report.rounds.push(row);console.log('CHECKPOINT '+JSON.stringify(row));save();return row}
capture();
for(let round=0;round<30;round++){
 let turns=0;const owners=[];
 while(f.evaluate(`gameRound===${round}&&!gameExit`)){assert(++turns<=12,'dispatcher stalled');const owner=f.evaluate('whooseTurn');assert(owner>=1&&owner<=12);assert(!owners.includes(owner));owners.push(owner);phase(`round-${round}-human-${owner}`, 'nextTurn();void 0');}
 const row=capture();assert.equal(row.round,round+1,'genuine completed round');assert.equal(row.terminal,false,'sample must reach round 30');
 if([0,2,29].includes(round)){
  phase(`round-${round+1}-shared-vision`,`isFogOfWar=true;globalThis.masks=[];for(let i=1;i<=12;i++){whooseTurn=i;players[i].changeFogOfWarByVision();masks.push(JSON.stringify(grid.fogOfWar))}whooseTurn=1;isFogOfWar=false;void 0`);
  assert.equal(f.evaluate('new Set(masks).size'),1,'all twelve humans share the same mask');
 }
}
report.ai=f.evaluate('aiPhases');assert.equal(report.ai.length,30);assert(report.ai.every(p=>p.milliseconds<60000));assert(report.rounds.at(-1).actions>0);assert(report.rounds.at(-1).demons>0);
fs.writeFileSync(path.join(out,'round-30-state.json'),f.evaluate('JSON.stringify(getGameObject())')+'\n');save();
console.log('PASS twelve-human workload dimensions=68x68 portals=36 round=30 seed=0 fastForward=false actual_AI_phases=30 shared_vision=identical watchdog_ms=60000');
