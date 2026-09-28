'use strict';
// Independent archived-action inspection. This deliberately grants no whole-criterion
// coverage until failure linkage, all recipient state and receipt checks are complete.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const O=require('/root/diplomacy_server/tests/reliability/helpers/observations');
const CASES=['coop','competitive'].flatMap(mode=>[0,1].map(actionSeed=>({id:`${mode}-actions-${actionSeed}`,mode,actionSeed,mapSeed:1,fog:!!actionSeed,join:actionSeed?'simultaneous':'sequential',humans:2,actions:12,tier:'shipped browser UI + real HTTPS/Socket.IO/MongoDB'})));
const distance=(a,b)=>{const z=p=>p.y-(p.x-(p.x&1))/2;return Math.max(Math.abs(a.x-b.x),Math.abs(z(a)-z(b)),Math.abs(a.x+z(a)-b.x-z(b)));};
function destination(g,u,slot,seed){
 const occupied=g.players.flatMap(p=>p.units),blocked=[...g.players.flatMap(p=>p.towns),...['external','externalProduction','nature','goldmines'].flatMap(k=>g[k])],choices=[];
 for(let x=0;x<g.ownership.length;x++)for(let y=0;y<g.ownership[x].length;y++)if(g.ownership[x][y]===slot&&distance(u,{x,y})===1&&!occupied.concat(blocked).some(v=>v.x===x&&v.y===y))choices.push({x,y});
 assert(u.name==='noob'&&u.moves>0&&choices.length,'sequence-illegal-mover');return choices[seed%choices.length];
}
function projection(coverage){
 const result=structuredClone(coverage);assert.deepEqual(result.cases.map(c=>c.id),CASES.map(c=>c.id),'sequence-case-ids');
 for(const c of result.cases){assert.equal(c.proof,c.id,'sequence-directory-format');c.proof=Object.keys(coverage.evidenceHashes).filter(n=>n.startsWith(c.id+'/')).sort();assert(c.proof.length,'sequence-empty-proof');}
 return result;
}
function review(dir){
 const coverage=A.read(path.join(dir,'coverage-results.json')),manifest=coverage.evidenceHashes,proofs={},checks=[];
 const file=n=>{A.proofKey(dir,n,manifest);proofs[n]=manifest[n];return path.join(dir,n);};
 const read=n=>A.read(file(n)),text=n=>fs.readFileSync(file(n),'utf8');
 const check=(id,expected,observed)=>{assert.deepEqual(observed,expected,'sequence/'+id);checks.push({id,expected,observed,pass:true});};
 const ids=read('source-identities.json'),normalizer='tests/reliability/helpers/observations.js';assert.equal(A.hash(path.join(A.root,normalizer)),ids.after.server.files[normalizer],'changed-observation-normalizer');
 check('manifest',CASES,read('sequence-manifest.json').cases);check('plan',CASES,read('verification-plan.json').cases);
 check('results',CASES.map(c=>({...c,pass:true,exit:0,proof:c.id})),coverage.cases);
 for(const c of CASES){
  const ck=(id,e,o)=>check(c.id+'/'+id,e,o),cp=read(c.id+'/checkpoints.json').checkpoints;
  const observed=s=>{const rows=cp.filter(r=>r.id.endsWith(s));assert.equal(rows.length,1,'sequence-checkpoint:'+s);return rows[0].observed;};
  const prefix=c.mode==='coop'?c.id:c.id+'/'+(c.fog?'competitive-1-tiny-deathmatch-h2-fog-on-simultaneous':'competitive-1-tiny-deathmatch-h2-fog-off-sequential');
  const journal=c.mode==='coop'?text(prefix+'/action-ledger.jsonl').split('\n').filter(Boolean).map(JSON.parse):read(prefix+'/journal.json');
  const actions=c.mode==='coop'?read(prefix+'/per-action-checkpoints.json')[0].actions:journal.filter(r=>['buy','undo','move','commit'].includes(r.stage));
  ck('contexts',2,observed(c.mode==='coop'?'coop:distinct-browser-contexts':':r-1:distinct-contexts'));
  ck('action-order',['buy','undo','move','commit','buy','undo','move','commit','move','commit','move','commit'],actions.map(r=>r.stage||r.action));
  const stdout=text(c.id+'/stdout.log'),logged=[...stdout.matchAll(/SEQUENCE_ACTION (\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]));
  ck('logged-actions',actions.map((r,i)=>({index:i+1,kind:r.stage||r.action})),logged);
  ck('exit',{exit:0,signal:null,error:null},read(c.id+'/exit.json'));
  const wire=read(prefix+(c.mode==='coop'?'/opening-event-ledger.json':'/wire.json')).filter(r=>r.direction==='sent'&&r.event==='nextTurn');ck('wire-count',4,wire.length);
  let moveIndex=0,buyBase;
  for(const [i,r] of actions.entries()){
   const kind=r.stage||r.action,slot=r.slot||r.before?.controls.slot;
   if(kind==='buy'){
    buyBase=structuredClone(r.before);const expected=structuredClone(buyBase);ck('buy-available/'+i,[null,true],[expected.players[slot].towns[0].production,expected.players[slot].gold>=20]);expected.players[slot].gold-=20;expected.players[slot].towns[0].production={name:'noob',turns:1};ck('buy/'+i,expected,r.after);
   }else if(kind==='undo'){ck('undo/'+i,buyBase,r.after);
   }else if(kind==='move'){
    const before=c.mode==='coop'?r.before.game:O.localGameplay(r.before),after=c.mode==='coop'?r.after.game:O.localGameplay(r.after),expected=structuredClone(before),u=expected.players[slot].units.find(u=>u.x===r.source.x&&u.y===r.source.y);
    assert(u,'sequence-missing-mover');ck('map-size/'+i,c.mode==='coop'?[14,14]:[20,10],[before.ownership.length,before.ownership[0].length]);
    ck('destination/'+i,destination(before,u,slot,c.actionSeed),r.target);Object.assign(u,r.target);u.moves--;for(const p of expected.players)p.units.sort((a,b)=>a.x-b.x||a.y-b.y||a.name.localeCompare(b.name));
    ck('move/'+i,expected,after);ck('wire/'+i,expected,O.sharedGameplay(O.packetBoard(wire[moveIndex])));
    const commit=actions[i+1];ck('commit-slot/'+i,slot,commit.slot);
    const stored=c.mode==='coop'?journal.find(j=>j.stage==='committed'&&j.round===Math.floor(moveIndex/2)&&j.slot===slot)?.stored:O.sharedGameplay(commit.stored.gameObject);
    ck('persisted/'+i,expected,stored);moveIndex++;
   }
  }
  ck('moves',4,moveIndex);
  if(c.mode==='coop'){
   ck('seed-size-fog',{seed:1,size:'tiny',fog:c.fog},observed('coop:seed-size-fog'));
   const before=journal.find(r=>r.stage==='round-complete'&&r.player==='host'&&r.state.game.gameRound===1)?.state.game;
   assert(before,'sequence-missing-reconnect-before');ck('reconnect',before,observed('coop:reconnect-exact'));
  }else{
   const reconnect=journal.find(r=>r.stage==='reconnected'),prior=journal.find(r=>r.stage==='round-received'&&r.slot===1&&r.state.gameRound===1);assert(prior&&reconnect,'sequence-missing-reconnect');ck('reconnect',O.localGameplay(prior.state),O.localGameplay(reconnect.state));
   if(!c.actionSeed){const attack=journal.find(r=>r.stage==='attack'),initial=journal.find(r=>r.stage==='attack-initial-fixture');assert(initial&&attack,'sequence-missing-attack');ck('fixture-size',{x:12,y:12},initial.spec.size);const expected=structuredClone(attack.before);ck('attack-units',[['noob',4,5,2,2],['noob',4,4,2,2]],expected.players.slice(1).flatMap(p=>p.units.map(u=>[u.name,u.x,u.y,u.hp,u.moves])));expected.players[1].units[0].moves=0;expected.players[2].units[0].hp=1;expected.players[2].units[0].wasHitted=true;ck('attack',expected,attack.after);ck('attack-undo',attack.before,observed(':attack-undo-exact'));}
  }
 }
 return {fullCriterionReview:false,criteria:[],checks,proofs,caseIds:CASES.map(c=>c.id),unresolved:['complete recipient-state and grid-occupancy derivation','original failure/minimized-prefix/regression linkage','whole-criterion tier/source/receipt/budget/cleanup reviews'],tier:'source-executed reader of archived browser/network observations; no new browser execution'};
}
module.exports={CASES,destination,projection,review};
