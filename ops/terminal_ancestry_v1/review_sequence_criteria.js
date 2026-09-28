// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Whole-criterion ownership sits above the frozen observation readers. Historical
// reviews never erase freshness; execution receipt clauses require a real receipt.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('../review_sequence_evidence'),L=require('./review_sequence_lifecycle');
const CASES=F.CASES.map(c=>c.id),HISTORICAL=[1,2,3,6,7],CURRENT=[1,2,3,4,5,6,7,8];
const prefix=c=>c.mode==='coop'?c.id:c.id+`/competitive-1-tiny-deathmatch-h2-fog-${c.fog?'on':'off'}-${c.join}`;
const implementation={
 'tests/reliability/helpers/natural-coop-browser.js':'04457df560d92ac0b7e7d412e08fb63444260897335a69d95fdcb0cacf70f7df',
 'tests/reliability/helpers/natural-competitive-browser.js':'516b2c23614ee21e036e7a94997741248a6ac0b1af4c82513001a28b95901ac2',
 'tests/reliability/helpers/browser-driver.js':'cd99d63051da689a098a3170ebb507f6e0aa28dfc9f74aeb5efd28d467fd6348',
 'tests/reliability/helpers/sequence-actions.js':'89b81d9c346659e52a23cb724f1fcd5d4beed9a3c64b10df80c912c9f49a44d3',
 'tests/reliability/sequence-exploration.test.js':'27e5c4ea822595c45555e1e0c52b01d907ae7c7869d02431d42948cc9b058bf1'
};
function review(dir,criteria=HISTORICAL,receipt=null,boundManifest){
 assert(boundManifest,'sequence criterion manifest required');
 assert(criteria.length&&criteria.every(n=>CURRENT.includes(n))&&new Set(criteria).size===criteria.length,'wrong-sequence-owner');
 const observations=F.review(dir),lifecycle=L.reviewLifecycle(dir,F.CASES,boundManifest,receipt),proofs={...observations.proofs,...lifecycle.proofs},checks=[];
 const add=(owners,id,e,o)=>{assert.deepEqual(o,e,'sequence-criteria/'+id);for(const owner of owners.filter(n=>criteria.includes(n)))checks.push({owner,id:`sequence/AC${owner}/${id}`,expected:structuredClone(e),observed:structuredClone(o),pass:true});};
 const read=n=>{A.proofKey(dir,n,boundManifest);proofs[n]=boundManifest[n];return A.read(path.join(dir,n));};
 const identities=read('source-identities.json');
 for(const [n,h] of Object.entries(implementation)){
  add(HISTORICAL,'implementation/'+n,h,identities.after.server.files[n]);
  assert.equal(A.hash(path.join(A.root,n)),h,'changed-reviewed-sequence-implementation:'+n);proofs[path.join(A.root,n)]=h;
 }
 // All state observations support AC2; AC1 needs legality/completion, AC3 the
 // retained failure and repair. UI/network tier and scope retain the same checks.
 for(const c of observations.checks){
  const owners=c.id.endsWith('/contexts')?CURRENT:/failure|regression/.test(c.id)?[3,4,5]:[1,2,6,7];
  add(owners,c.id,c.expected,c.observed);
 }
 for(const [i,c] of lifecycle.checks.entries()){
  const owners=/input\/|ready|served|isolated-endpoints|tiers|source-tier|focused-tier|exclusions/.test(c.id)?[1,2,4,5,6,7,8]:[4,5,8];
  add(owners,`${c.id}/record-${i}`,c.expected,c.observed);
 }
 const inventory=[['open field',2,21,21],['open field',3,26,26],['open field',4,25,25],['tiny deathmatch',2,20,10],['stationary warfare',2,21,21],['two rivers',2,21,23],['mountain wall',2,21,23],['two in one',2,21,23],['tower defense',2,21,23],['capture rush',2,21,21],['strategic war',2,21,21],['reinforcement',2,21,23],['rush or defend',2,21,23],['sneak attack',2,21,23],['flank attack',2,21,21],['attack and protect',2,21,21],['fight forever',2,40,30],['fight forever',3,39,39]];
 for(const c of F.CASES){
  const p=prefix(c),cp=read(c.id+'/checkpoints.json').checkpoints;
  const observed=id=>{const rows=cp.filter(r=>r.id.endsWith(id));assert.equal(rows.length,1,'sequence-criteria missing observation '+id);return rows[0].observed;};
  add(CURRENT,c.id+'/completed-actions',12,observed(c.mode==='coop'?'coop:twelve-legal-actions':':twelve-legal-actions'));
  if(c.mode==='competitive'){
   add([1,7],c.id+'/inventory',inventory,read(c.id+'/inventory.json').inventory.map(r=>[r.map,r.humans,r.size.x,r.size.y]));
   const m=read(c.id+'/case-manifest.json');
   add([1,7],c.id+'/minimum-map',[{map:'tiny deathmatch',index:0,humans:2,size:{x:20,y:10},fog:c.fog,join:c.join,seed:1,id:p.slice(c.id.length+1)}],m.cases);
   add([1,7],c.id+'/seed-convention','Static competitive maps have no seed input; seed 1 is the manifest convention',m.seedApplicability);
   const initial=read(p+'/journal.json').filter(r=>r.stage==='initial');assert.equal(initial.length,1);
   add([1,7],c.id+'/actual-fog',c.fog,initial[0].state.fog);
   add([1,6,7],c.id+'/connected',true,initial[0].state.socket.connected);
  }else add([1,6,7],c.id+'/connected',[true,true],observed('coop:connected-browsers'));
 }
 if(criteria.some(n=>[4,5,8].includes(n))){
  assert(receipt,'sequence-criteria independent-parent-OS-receipt-missing');
  add([4,5,8],'current-sources',[],lifecycle.sourceDifferences);
  function secrets(v){if(typeof v==='string'){let x;try{x=JSON.parse(v.startsWith('42[')?v.slice(2):v);}catch{}if(x&&typeof x==='object')secrets(x);return;}if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/^(password|privateKey|userId)$/i.test(k))assert(/^\[redacted\]$|^\*$/.test(x),'sequence-unredacted-credential');secrets(x);}}
  for(const n of Object.keys(boundManifest).filter(n=>/\.(json|jsonl|log)$/.test(n))){
   A.proofKey(dir,n,boundManifest);proofs[n]=boundManifest[n];const s=fs.readFileSync(path.join(dir,n),'utf8');assert(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(s),'sequence-private-key');if(n.endsWith('.json'))secrets(JSON.parse(s));else if(n.endsWith('.jsonl'))s.split('\n').filter(Boolean).map(JSON.parse).forEach(secrets);
  }
  add([4],'credentials-redacted',true,true);
  for(const name of ['original-failures','minimized-replays'])add([4,5],name+'/no-new-failures',[],fs.readdirSync(path.join(dir,name)));

 }
 assert.equal(new Set(checks.map(c=>c.id)).size,checks.length,'duplicate-owned-sequence-check');
 return {criteria,checks,proofs,caseIds:CASES,unresolved:lifecycle.unresolved,derivation:'Four menu-created two-human trajectories with fixed seeds 0/1; independently enumerate odd-column adjacent owned unoccupied cells, subtract 20 gold for a noob purchase, undo exactly, decrement movement, merge rounds with independent income/eligibility and compare all recipients, wire and MongoDB. Attack/undo is a declared initial local fixture only. Static competitive maps use manifest seed 1. Full source inspection is bound to implementation hashes; original failed prefixes and repair remain retained.'};
}
function rowFor(tasks,report,manifest,n){
 const text=tasks.find(t=>t.id==='TASK-220').acceptance_criteria[n-1],ref=file=>({file,sha256:manifest[file]}),name='sequence-independent-review.json';
 return {id:'TASK-220/AC'+n,targetSha256:R.digest(text),reviewer:'Independent complete sequence criterion review',clauses:[{text,disposition:'reviewed',runTask:'TASK-220',tier:'natural-browser',caseIds:CASES,sourceIdentity:ref('source-identities.json'),traces:F.CASES.map(c=>ref(prefix(c)+(c.mode==='coop'?'/opening-event-ledger.json':'/wire.json'))),contextIds:CASES.map(c=>`sequence/AC${n}/${c}/contexts`),milestoneIds:CASES.map(c=>`sequence/AC${n}/${c}/completed-actions`),proofs:[...Object.keys(report.proofs).filter(f=>!path.isAbsolute(f)),name].map(ref),assertions:report.checks.filter(c=>c.owner===n).map(c=>({id:c.id,expected:c.expected,proof:ref(name)})),reason:'Whole criterion reviewed independently; freshness and full TASK-225 closure remain separately required.',derivation:report.derivation,followUp:{scope:'Refresh only affected sequence evidence when stale or insufficient.',acceptance:'Complete current-source independent observations and actual OS receipt.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};
}
module.exports={review,rowFor,CASES,HISTORICAL,CURRENT,projection:F.projection,implementation};
