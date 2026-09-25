'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const cases=['source/hidden-landmarks','source/instruction-priority','source/original-rejection-control'];
module.exports={cases,run};
function run(out){
 const source=fs.readFileSync(path.join(__dirname,'../events/events.js'),'utf8');
 function probe(code,building,instructions=false){
  class Empty{removeSelect(){} needInstructions(){return false;} }
  const noClick={click:()=>false};let selected=0,sent=0;
  const b={...building,select(){selected++;}};
  const cell={building:b,get unit(){throw Error('hidden occupant accessed');}};
  // This source-only click fixture models desktop input; touch listeners need a DOM.
  const env={Empty,mobilePhone:false,grid:{arr:[[cell]],fogOfWar:[[0]]},isFogOfWar:true,
   getCoord:()=>({x:0,y:0}),isCoordNotOnMap:()=>false,coordsEqually:()=>true,
   undoButton:noClick,backToMenuButton:noClick,nextTurnButton:noClick,iButton:noClick};
  const Events=vm.runInNewContext(code+';Events',env);
  const event=Object.create(Events.prototype);event.selected=new Empty();event.selected.needInstructions=()=>instructions;
  event.interface=Object.fromEntries(['nextTurnPause','statistics','entity','barrack','town'].map(k=>[k,noClick]));
  event.hideAll=()=>{};event.sendInstructions=()=>sent++;
  event.click({},{});return {selected,sent};
 }
 const checks=[];const check=(id,observed,expected)=>{assert.deepEqual(observed,expected,id);checks.push({id,observed,expected,pass:true});console.log('PASS '+id+' '+JSON.stringify(observed));};
 check(cases[0],[{name:'goldmine'},{name:'demonPortal',isDemonPortal:true},{name:'town'},{name:'Empty'},{name:'demonPortal',isDemonPortal:true,killed:true}].map(b=>probe(source,b)),
  [{selected:1,sent:0},{selected:1,sent:0},{selected:0,sent:0},{selected:0,sent:0},{selected:0,sent:0}]);
 check(cases[1],probe(source,{name:'goldmine'},true),{selected:0,sent:1});
 // Restore the old blanket fog rejection as an asserted failing control.
 const old=source.replace("if (!building.killed && (building.name === 'goldmine' || building.isDemonPortal))",'if (false)');
 assert.notEqual(old,source);
 const rejected=probe(old,{name:'goldmine'});
 assert.throws(()=>assert.equal(rejected.selected,1),/0 !== 1/);
 check(cases[2],rejected,{selected:0,sent:0});
 fs.writeFileSync(path.join(out,'source-checkpoints.json'),JSON.stringify({checkpoints:checks,pass:true},null,2));
 return checks;
}
if(require.main===module)run(process.argv[2]);
