'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spec,expected,project}=require('./test-task238-fixtures');
const {BUILD_CURRENT_COOP_BOARD}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
const tier=process.argv[2],out=process.argv[3];let ev;
if(tier==='server'){require('../../diplomacy_server/server/loadGameCode');ev=s=>JSON.parse(JSON.stringify(require('node:vm').runInThisContext(s))??'null');}
else {const {createFixture,defaultFixture}=require('./test-coop-harness');ev=createFixture(defaultFixture(),()=>{}).evaluate;}
const checks=[],waves=[],roundtrips=[],fixtures=[];
const write=()=>fs.writeFileSync(path.join(out,tier+'.json'),JSON.stringify({checks,waves,roundtrips,fixtures},null,2)+'\n');
const check=(id,observed,expected)=>{checks.push({id:tier+'/'+id,observed,expected,pass:require('node:util').isDeepStrictEqual(observed,expected)});if(!checks.at(-1).pass)write();assert.deepEqual(observed,expected,id);console.log('PASS '+tier+'/'+id);};
const load=b=>ev(`loadFromJson(${JSON.stringify(JSON.stringify(b))});undefined`);
const save=()=>ev('JSON.parse(JSON.stringify(getGameObject()))');
function init(h,r){const s=spec(h);ev(`(${BUILD_CURRENT_COOP_BOARD})(${JSON.stringify({spec:s,browser:false})});gameRound=${r-1};whooseTurn=${h+1};gameSettings.isOnline=${tier==='server'};gameSettings.coop.typedWaves={lastRound:${r-1}};undefined`);fixtures.push({h,r,s,board:save()});return s;}
function dispatch(r){if(tier==='local')ev(`gameSettings.coop.localPhase={round:${r},stage:'wave'};advanceCoopLocalPhase();undefined`);else ev(`spawnCoopWave(${r});undefined`);return ev(project);}
for(const h of [1,2,12])for(let r=1;r<=32;r++){
 const s=init(h,r),before=save();load(before);const observed=dispatch(r),want=expected(s,r);
 check(`H${h}/r${r}`,observed,want);
 const after=save();load(after);const again=dispatch(r);check(`H${h}/r${r}/reload-no-duplicate`,again,want);
 const marker=ev('gameSettings.coop.typedWaves');check(`H${h}/r${r}/marker`,marker,{lastRound:r});
 waves.push({id:`${tier}/H${h}/r${r}`,expected:{attempts:want.length,successfulSpawns:want,skipReasons:[]},observed:{attempts:observed.length,successfulSpawns:observed,skipReasons:[]},commit:marker});
 roundtrips.push({id:`${tier}/H${h}/r${r}`,before,after,expected:want,observed:again,commit:marker});
}
// A blocker persists through the melee upgrade; removed/destroyed portals never backlog.
const s=init(2,12),p=s.portals[0],d=s.portals[3];
ev(`new Imp(${p.x},${p.y});grid.getBuilding(${JSON.stringify(d)}).kill();undefined`);
for(const r of [12,16]){
 const actual=dispatch(r).filter(u=>u.x!==p.x||u.y!==p.y),want=expected(s,r,[0,3]);check('blocked-upgrade/'+r,actual,want);
 waves.push({id:tier+'/blocked-upgrade/'+r,expected:{attempts:want.length,successfulSpawns:want,skipReasons:['occupied melee','destroyed ranged']},observed:{attempts:actual.length,successfulSpawns:actual,skipReasons:ev(`[(grid.getUnit(${JSON.stringify(p)}).notEmpty()?'occupied melee':null),(grid.getBuilding(${JSON.stringify(d)}).isDemonPortal?'unexpected portal':'destroyed ranged')]`)},commit:ev('gameSettings.coop.typedWaves')});
 ev(`for(const u of [...players[3].units])if(u.coord.x!==${p.x}||u.coord.y!==${p.y})u.kill();undefined`);
}
ev(`grid.getUnit(${JSON.stringify(p)}).kill();undefined`);check('unblock-intermediate-no-backlog',dispatch(17),[]);check('unblock-next-scheduled',dispatch(20),expected(s,20,[3]));
// Stale selections are rejected after occupancy, destruction and terrain changes.
for(const condition of ['occupied','destroyed','terrain']){
 init(2,16);const q=s.portals[6];
 ev(condition==='occupied'?`new Imp(${q.x},${q.y});undefined`:condition==='destroyed'?`grid.getBuilding(${JSON.stringify(q)}).kill();undefined`:`new Sea(${q.x},${q.y});undefined`);
 const result=ev(`placeCoopWave({selections:[{type:'bombard',x:${q.x},y:${q.y}}]})`);check('placement/'+condition,result,{spawned:[],skipped:1});
}
write();console.log('PASS source '+tier+' boundaries=96 blocked-upgrade bombard reload-no-duplicate');
