'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./test-coop-harness');
function configuration(count) {
  return {coop:true,size:{x:53,y:13},actors:[
    {role:'neutral',rgb:{r:208,g:208,b:208},gold:0,towns:[],units:[]},
    ...Array.from({length:count},(_,i)=>({role:'human',rgb:{r:20+i*15,g:70,b:90},gold:100,towns:[],units:[{x:2+i*4,y:3,hp:2}]})),
    {role:'demon',rgb:{r:160,g:40,b:180},gold:0,economyEnabled:false,towns:[],units:[]}]};
}
// Literal even-column, radius-one hex offsets, independent of VisionWay.
function cells(slots) {return slots.flatMap(i=>{const x=2+(i-1)*4;return [[x-1,2],[x-1,3],[x,2],[x,3],[x,4],[x+1,2],[x+1,3]].map(p=>p.join(','))}).sort()}
const mask='grid.fogOfWar.flatMap((col,x)=>col.flatMap((v,y)=>v?[x+","+y]:[])).sort()';
function run() {
 for(const count of [1,4,5,6,7,8,9,10,11,12]) {
  const f=createFixture(configuration(count),()=>{}),e=s=>f.evaluate(s),slots=Array.from({length:count},(_,i)=>i+1);
  const check=(name,code,expected)=>{const observed=e(code);console.log(JSON.stringify({name:`H${count}-${name}`,expected,observed}));assert.deepEqual(observed,expected,name);console.log(`PASS H${count}-${name}`)};
  e(`new DemonPortal(50,10); gameSettings.coop.waveGeneration={version:1,seed:42,lastRound:0};
    isFogOfWar=true;Noob.visionRange=1;grid.visionUsed=[];grid.visionDistance=[];
    grid.fullInitArr(53,13,grid.visionUsed,0);grid.fullInitArr(53,13,grid.visionDistance,0);grid.newVisionUsedValue=0;grid.visionWay=new VisionWay();
    players[1].changeFogOfWarByVision();
    globalThis.phases=[];const spawn=spawnCoopWave;spawnCoopWave=r=>{phases.push(['wave',r]);return spawn(r)};
    SimpleAiPlayer.prototype.play=function(){};const play=DemonPlayer.prototype.play;DemonPlayer.prototype.play=function(){phases.push(['demon',gameRound+1]);return play.call(this)};
    menu.updateSlotManagers=()=>{};gameEvent.nextTurn=()=>{};AiRuntime.trainFromHumanCommands=()=>{};
    timer={pauseAndSaveTime(){},setNextTurnTime(){}};nextTurnPauseInterface={visible:false,backToMenu(){}};globalThis.saveManager={save(){}};undefined`);
  check('shared-vision',mask,cells(slots));
  for(let round=0;round<3;round++) {
   for(const slot of slots) {check(`round-${round}-human-${slot}`,'whooseTurn',slot);e('nextTurn()')}
   check(`round-${round+1}-phase-count`,'phases',Array.from({length:round+1},(_,i)=>[['wave',i+1],['demon',i+1]]).flat());
   check(`round-${round+1}-spawns`,`players[${count+1}].units.map(u=>({name:u.name,x:u.coord.x,y:u.coord.y}))`,round<2?[]:[{name:'imp',x:50,y:10}]);
  }
  if(count>1)e(`players[${count}].units[0].kill();undefined`);
  const survivors=count===1?slots:slots.slice(0,-1);
  check('initial-versus-surviving',`({initial:gameSettings.coop.initialHumanCount,surviving:players.filter(p=>p.role==='HUMAN'&&!p.isLost).length,size:{x:grid.arr.length,y:grid.arr[0].length},portals:external.filter(p=>p.isDemonPortal&&!p.killed).length})`,{initial:count,surviving:survivors.length,size:{x:53,y:13},portals:1});
  check('eliminated-vision',mask,cells(survivors));
  for(const slot of survivors){check('survivor-turn-'+slot,'whooseTurn',slot);e('nextTurn()')}
  check('skipped-dead-no-resize','({turn:whooseTurn,round:gameRound,size:{x:grid.arr.length,y:grid.arr[0].length}})',{turn:1,round:4,size:{x:53,y:13}});
  check('occupied-no-backlog',`players[${count+1}].units.length`,1);
  // Stored legacy dimensions and phase marker must survive even if generation is unavailable.
  e(`gameSettings.coop.localPhase={round:4,stage:'complete'};globalThis.before=JSON.stringify(getGameObject());globalThis.visionBefore=JSON.stringify(grid.fogOfWar);loadFromJson(before)`);
  check('legacy-save-exact','JSON.stringify(getGameObject())===before',true);
  check('save-vision-exact','JSON.stringify(grid.fogOfWar)===visionBefore',true);
  e('globalThis.savedWave=JSON.stringify(gameSettings.coop.waveGeneration);advanceCoopLocalPhase();advanceCoopLocalPhase()');
  check('committed-phase-no-replay','JSON.stringify(gameSettings.coop.waveGeneration)===savedWave',true);
  e(`players.filter(p=>p.role==='HUMAN').forEach(p=>p.units.slice().forEach(u=>u.kill()));delete gameSettings.coop.localPhase;nextTurn()`);
  check('terminal-defeat','({result:gameSettings.coop.result,ended:gameExit})',{result:'defeat',ended:true});
 }
 console.log('PASS expanded-recovery counts=1,4,5,6,7,8,9,10,11,12 first_spawn=3 turn_order=human-only shared_vision=exact legacy_save=exact terminal=defeat');
}
if(require.main===module)run();
module.exports={run,configuration,cells,mask};
