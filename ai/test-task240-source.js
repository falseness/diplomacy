'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createFixture}=require('./test-coop-harness');
const cases=['source/schedule-upgrades','source/committed-wave','source/blocked','source/removal','source/legacy','source/all-category-upgrades','source/inspection-no-mutation'];
module.exports={cases};
if(require.main===module){
 const f=createFixture(undefined,()=>{}),checks=[];
 const check=(id,observed,expected)=>{observed=JSON.parse(JSON.stringify(observed));checks.push({id,observed,expected,pass:JSON.stringify(observed)===JSON.stringify(expected)});assert.deepEqual(observed,expected,id);console.log('PASS '+id);};
 f.evaluate(`
 var authored=generateCoopGame(2,{seed:1,size:'tiny'}); authored.start({updateCameraBorders(){},clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false}},false);
 var mainCtx=document.createElement('canvas').getContext('2d'); var ctx=mainCtx; undoButton={}; entityInterface=new EntityInterface();
 gameSettings.coop.typedWaves={lastRound:0}; var portal240=external.find(e=>e.category==='melee');
 var inspectionSnapshot240=()=>JSON.stringify({counts:players.map(p=>[p.units.length,p.towns.length]),gold:players.map(p=>p.gold),external:external.length,undo:actionManager.arr,commands:humanCommands});
 var before240=inspectionSnapshot240(); gameEvent.selected=portal240;
 portal240.select(false);
 entityInterface.refreshPortal(portal240,true);
 `);
 check(cases[0],f.evaluate(`(() => {
 const rows=[];
 for(const round of [0,3,4,7,8,12,15,16,36]) {
 gameRound=round; gameSettings.coop.typedWaves.lastRound=0;
 portal240.drawNextProduction(ctx);
 rows.push([round,entityInterface.entity.name.text,entityInterface.portalDescription]);
 }
 return rows;
 })()`),[[0,'imp',true],[3,'imp',true],[4,'clawling',true],[7,'clawling',true],[8,'clawling',true],[12,'brute',true],[15,'brute',true],[16,'brute',true],[36,'brute',true]]);
 check(cases[1],f.evaluate(`(() => {gameRound=3;gameSettings.coop.typedWaves.lastRound=4;portal240.drawNextProduction(ctx);return [portal240.nextProduction.round,entityInterface.entity.name.text,entityInterface.portalDescription]})()`),[8,'clawling',true]);
 check(cases[5],f.evaluate(`(() => {
 const result=[];gameSettings.coop.typedWaves.lastRound=0;
 for(const category of ['melee','ranged','siege','heavy','support','chaos']){
 const p=external.find(e=>e.category===category);gameEvent.selected=p;p.select(false);entityInterface.refreshPortal(p,true);
 const names=[];for(const r of [0,4,8,12,16,20,24,28]){gameRound=r;p.drawNextProduction(ctx);names.push(entityInterface.entity.name.text)}
 result.push(names);
 }
 gameEvent.selected=portal240;gameRound=3;gameSettings.coop.typedWaves.lastRound=4;entityInterface.refreshPortal(portal240,true);
 return result;
 })()`),[
 ['imp','clawling','clawling','brute','brute','brute','brute','brute'],
 ['spitter','spitter','ember archer','ember archer','hexcaster','hexcaster','hexcaster','hexcaster'],
 Array(8).fill('bombard'),Array(8).fill('bulwark'),
 ['ravager','ravager','ravager','ravager','ravager','hound','hound','hound'],Array(8).fill('demon lord')]);
 check(cases[6],f.evaluate('inspectionSnapshot240()===before240'),true);
 check(cases[2],f.evaluate(`(() => {
 // Source-only blocked placement fixture, independent of browser gameplay.
 for(const col of grid.arr)for(const cell of col)if(cell.unit.isEmpty())new Imp(cell.hexagon.coord.x,cell.hexagon.coord.y);
 const before=inspectionSnapshot240();
 portal240.drawNextProduction(ctx);return {emptyCells:grid.arr.flat().filter(c=>c.unit.isEmpty()).length,
 name:entityInterface.entity.name.text,description:entityInterface.portalDescription,nextRound:portal240.nextProduction.round,unchanged:before===inspectionSnapshot240()}
 })()`),{emptyCells:0,name:'clawling',description:true,nextRound:8,unchanged:true});
 check(cases[3],f.evaluate(`(() => {gameEvent.removeSelection=()=>{gameEvent.selected.removeSelect();gameEvent.selected=new Empty()};portal240.kill();return [entityInterface.visible,entityInterface.portalDescription,gameEvent.selected.isEmpty(),external.includes(portal240)]})()`),[false,false,true,false]);
 check(cases[4],f.evaluate(`(() => {const p=external.find(e=>e.isDemonPortal);gameSettings.coop.generation.version=3;p.select(false);return [entityInterface.portalStatsButton.canClick,entityInterface.portalBackButton.canClick,entityInterface.entity.name.text]})()`),[false,false,'demon portal']);
 fs.writeFileSync(path.join(process.argv[2],'source-checkpoints.json'),JSON.stringify({checkpoints:checks,pass:true},null,2)+'\n');
}
