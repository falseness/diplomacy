'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createFixture}=require('./test-coop-harness');
const {spec}=require('./test-task238-fixtures');
const {BUILD_CURRENT_COOP_BOARD}=require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');
const cases=['current-generation','current-replay','current-save-load','typed-categories','weak-stats','removed-apis',...['missing-generation','v1','v2','v3','v5','missing-balance','old-balance','weighted-wave','untyped','old-category','missing-owner','old-owner-tile'].map(k=>'reject/'+k)];
module.exports={cases,run};
if(require.main===module)run(process.argv[2]);
function run(out){
 const f=createFixture(undefined,()=>{}),checks=[];
 const check=(id,observed,expected)=>{assert.deepEqual(observed,expected,id);checks.push({id,observed,expected,pass:true});console.log('PASS '+id+' '+(id==='current-save-load'?'exact-state=true':JSON.stringify(observed)));};
 const map=f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(2,{size:"tiny",seed:1})))');
 check('current-generation',[map.coop.generation.version,map.portals.length],[4,20]);
 check('current-replay',f.evaluate(`JSON.stringify(generateCoopGame(2,{size:'tiny',seed:1}))===JSON.stringify(generateCoopGame(${map.coop.generation.playerCount},${JSON.stringify(map.coop.generation.options)}))`),true);
 f.evaluate(`(${BUILD_CURRENT_COOP_BOARD})(${JSON.stringify({spec:spec(2),browser:false})});undefined`);
 const before=f.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
 f.evaluate(`loadFromJson(${JSON.stringify(JSON.stringify(before))});undefined`);
 check('current-save-load',f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'),before);
 check('typed-categories',f.evaluate('COOP_PORTAL_CATEGORIES'),['melee','ranged','siege','heavy','support','chaos']);
 check('weak-stats',f.evaluate('[DEMON_TYPES.imp.health,DEMON_TYPES.imp.damage,DEMON_TYPES.bombard.health,DEMON_TYPES.demonLord.health]'),[2,1,4,5]);
 check('removed-apis',f.evaluate('[typeof composeCoopWave,typeof getCoopWaveConfig,typeof getCoopWaveStrength,typeof getUnlockedCoopDemonTypes,typeof placeCoopPortals,typeof growCoopTerrain]'),Array(6).fill('undefined'));
 const negatives=[];
 for(const id of cases.filter(c=>c.startsWith('reject/'))){
  const b=JSON.parse(JSON.stringify(before)),c=b.gameSettings.coop,k=id.slice(7);
  if(k==='missing-generation')delete c.generation;
  else if(/^v\d$/.test(k))c.generation.version=Number(k[1]);
  else if(k==='missing-balance')delete c.balanceVersion;
  else if(k==='old-balance')c.balanceVersion=1;
  else if(k==='weighted-wave')c.waveGeneration={version:1,seed:1,lastRound:0};
  else if(k==='untyped')delete b.external[0].category;
  else if(k==='old-category')b.external[0].category='normal';
  else if(k==='missing-owner')delete b.external[0].ownerSlot;
  else {const p=b.external[0].coord;b.grid[p.x][p.y]=1;}
  const result=f.evaluate(`(()=>{let message='';try{loadFromJson(${JSON.stringify(JSON.stringify(b))})}catch(e){message=e.message}return {rejected:/original generation metadata|Unsupported co-op wave metadata|Invalid saved portal (category|ownership)/.test(message),unchanged:JSON.stringify(getGameObject())===${JSON.stringify(JSON.stringify(before))}}})()`);
  negatives.push({id,payload:b,result});check(id,result,{rejected:true,unchanged:true});
 }
 if(out)fs.writeFileSync(path.join(out,'save-load-checkpoints.json'),JSON.stringify({checkpoints:checks,pass:true},null,2));
 if(out)fs.writeFileSync(path.join(out,'obsolete-rejection-payloads.json'),JSON.stringify(negatives,null,2));
 console.log('PASS current-save-load obsolete-rejections=12 six-categories weak-stats');
}
