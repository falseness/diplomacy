'use strict';
// Entity panel stats: foreign units show speed (and range when ranged); own units keep moves.
// Demon portal stats views show the same speed/range lines as the unit panel for that type.
const fs=require('node:fs'),path=require('node:path');
const {createFixture,defaultFixture}=require('../../diplomacy_server/tests/client/test-coop-harness');
const outDir=process.argv[2];
if(!outDir){console.error('usage: test-unit-panel-stats.js <output-dir>');process.exit(2);}
fs.mkdirSync(outDir,{recursive:true});
const config=defaultFixture();config.coop=true;
const f=createFixture(config,()=>{});
f.evaluate(`
 var mainCtx=document.createElement('canvas').getContext('2d'); var ctx=mainCtx; undoButton={};
 entityInterface=new EntityInterface(); whooseTurn=1;
 var panelStats=(className,owner)=>{
  const at={x:5,y:3}; grid.getHexagon(at).playerColor=owner;
  const Klass=typeof className==='string'?getClass(className):className, unit=new Klass(at.x,at.y);
  unit.select(); const result={owner:unit.playerColor,mine:unit.isMyTurn,text:entityInterface.entity.info.text};
  unit.removeSelect(); unit.kill(); return result;
 };
 undefined`);
const types=f.evaluate('JSON.parse(JSON.stringify(DEMON_TYPES))');
const demonOwner=f.evaluate('players.findIndex(p=>p&&p.role==="DEMONS")');
const rows=[];let failed=0;
function run(name,type,owner,expected){
 const observed=f.evaluate(`panelStats(${type.startsWith('class:')?type.slice(6):JSON.stringify(type)},${owner})`);
 const lines=observed.text.split('\n'),errors=[];
 const has=prefix=>lines.filter(l=>l.startsWith(prefix+': '));
 for(const [key,value] of Object.entries(expected)){
  const found=has(key);
  if(value===null){if(found.length)errors.push(`unexpected ${found.join('|')}`);}
  else if(value===true){if(!found.length)errors.push(`missing ${key}:`);}
  else if(found.length!==1||found[0]!==`${key}: ${value}`)errors.push(`want "${key}: ${value}" got ${JSON.stringify(found)}`);
 }
 if(observed.owner!==owner)errors.push(`owner ${observed.owner}!=${owner}`);
 rows.push({case:name,type,owner,mine:observed.mine,text:observed.text,expected,pass:!errors.length,errors});
 if(errors.length){failed++;console.log(`FAIL ${name} ${errors.join('; ')} text=${JSON.stringify(observed.text)}`);}
 else console.log(`PASS ${name} text=${JSON.stringify(observed.text)}`);
}
for(const [t,cfg] of Object.entries(types)){
 const range=!cfg.ranged?null:cfg.buildingDamage!==undefined?`2 - ${cfg.range}`:cfg.range;
 run('demon-'+t,t,demonOwner,{speed:cfg.movement,range,moves:null});
}
run('own-melee','class:Noob',1,{moves:true,speed:null,range:null});
run('own-ranged','class:Archer',1,{moves:true,speed:null,range:null});
run('other-player-ranged','class:Archer',2,{speed:f.evaluate('Archer.speed'),range:f.evaluate('Archer.range'),moves:null});
fs.writeFileSync(path.join(outDir,'unit-panel.json'),JSON.stringify({pass:!failed,cases:rows},null,2)+'\n');
// Portal 'stats' view: every scheduled type shows the same speed/range lines as its unit panel.
const statLines=(text,key)=>text.split('\n').filter(l=>l.startsWith(key+': '));
const unitPanel=Object.fromEntries(rows.filter(r=>r.case.startsWith('demon-')).map(r=>[r.type,r.text]));
const g=createFixture(undefined,()=>{});
g.evaluate(`
 var authored=generateCoopGame(2,{seed:1,size:'tiny'}); authored.start({updateCameraBorders(){},clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false}},false);
 var mainCtx=document.createElement('canvas').getContext('2d'); var ctx=mainCtx; undoButton={}; entityInterface=new EntityInterface();
 gameSettings.coop.typedWaves={lastRound:0};
 undefined`);
const portalCases=g.evaluate(`(() => {
 const result=[];
 for(const category of COOP_PORTAL_CATEGORIES){
  const p=external.find(e=>e.isDemonPortal&&e.category===category),seen=new Set();
  for(let round=0;round<=100;round++){
   gameRound=round;const type=p.nextProduction.type;if(seen.has(type))continue;seen.add(type);
   gameEvent.selected=p;p.select(false);entityInterface.refreshPortal(p,true);
   result.push({category,round,type,name:entityInterface.entity.name.text,description:entityInterface.portalDescription,text:entityInterface.entity.info.text});
   entityInterface.refreshPortal(p,false);
  }
 }
 return result;
})()`);
let portalFailed=0;
for(const c of portalCases){
 const errors=[],panel=unitPanel[c.type];
 if(panel===undefined)errors.push('no unit panel case for '+c.type);
 else for(const key of ['speed','range']){
  const want=statLines(panel,key),got=statLines(c.text,key);
  if(JSON.stringify(want)!==JSON.stringify(got))errors.push(`${key} want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
 }
 if(!statLines(c.text,'speed').length)errors.push('missing speed:');
 if(/(^|\n)movement:/.test(c.text))errors.push('has movement:');
 if(c.name!==types[c.type].name||c.description!==true)errors.push(`panel ${c.name}/${c.description}`);
 const name=`portal-${c.category}-${c.type}@${c.round}`;
 if(errors.length){portalFailed++;console.log(`FAIL ${name} ${errors.join('; ')} text=${JSON.stringify(c.text)}`);}
 else console.log(`PASS ${name} text=${JSON.stringify(c.text)}`);
}
fs.writeFileSync(path.join(outDir,'portal-stats.json'),JSON.stringify(portalCases.map(({category,round,type,text})=>({category,round,type,text})),null,2)+'\n');
failed+=portalFailed;
console.log(failed?`FAIL ${failed} case(s)`:`ALL PASS ${rows.length+portalCases.length} cases`);
process.exit(failed?1:0);
