'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const F=require('./review_sequence_evidence');
const original=path.resolve('artifacts/TASK-220/green-20260925-03');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
test('immutable sequence observations pass action, whole-recipient, occupancy and failure-link checks without whole-criterion credit',()=>{const r=F.review(original);assert.equal(r.checks.length,365);assert.deepEqual(r.criteria,[]);assert.equal(r.fullCriterionReview,false);assert.equal(r.failureLink.smallestObservedFailingLegalPrefix,2);assert.equal(r.failureLink.originalCleanup,false);for(const c of JSON.parse(JSON.stringify(r)).checks)assert.deepEqual(c.observed,c.expected,'persisted checkpoint: '+c.id);});
for(const [name,mutate,pattern] of [
 ['wrong-destination',a=>{a[2].target={x:0,y:0};},/destination/],
 ['wrong-hp',a=>{a[2].after.game.players[1].units[0].hp++;},/move/],
 ['double-purchase',a=>{a[0].after.players[1].gold-=20;},/buy/],
 ['omitted-action',a=>{a.pop();},/action-order/]
])test('rebound '+name+' fails semantic inspection',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-reader-'));
 try{fs.cpSync(original,dir,{recursive:true});const n='coop-actions-0/per-action-checkpoints.json',p=path.join(dir,n),v=JSON.parse(fs.readFileSync(p));mutate(v[0].actions);fs.writeFileSync(p,JSON.stringify(v));const c=JSON.parse(fs.readFileSync(path.join(dir,'coverage-results.json')));c.evidenceHashes[n]=hash(p);fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(c));assert.throws(()=>F.review(dir),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('projection retains observations and replaces only directory proof representation',()=>{const c=JSON.parse(fs.readFileSync(path.join(original,'coverage-results.json'))),p=F.projection(c);for(const row of p.cases){assert(row.proof.length>0);assert(row.proof.every(n=>n.startsWith(row.id+'/')&&c.evidenceHashes[n]));row.proof=row.id;}assert.deepEqual(p,c);});
test('projection rejects omitted case and foreign directory',()=>{const c=JSON.parse(fs.readFileSync(path.join(original,'coverage-results.json')));const a=structuredClone(c);a.cases.pop();assert.throws(()=>F.projection(a),/sequence-case-ids/);c.cases[0].proof='../escape';assert.throws(()=>F.projection(c),/sequence-directory-format/);});

const competitive='competitive-actions-0/competitive-1-tiny-deathmatch-h2-fog-off-sequential/journal.json';
for(const [name,n,mutate,pattern] of [
 ['other-recipient-hp',competitive,j=>{j.find(r=>r.stage==='round-received').state.players[2].units[0].hp++;},/whole-recipient/],
 ['double-income',competitive,j=>{j.find(r=>r.stage==='round-received').state.players[1].gold+=10;},/whole-recipient/],
 ['wrong-grid-paint',competitive,j=>{j.find(r=>r.stage==='round-received').state.ownership[0][0]=2;},/whole-recipient/],
 ['omitted-recipient',competitive,j=>{j.splice(j.findIndex(r=>r.stage==='round-received'),1);},/sequence-record:receipt/],
 ['canonical-gold',competitive,j=>{j.find(r=>r.stage==='round-persisted').stored.rounds[1][0].parallelTurnResult.players[2].gold++;},/canonical-round/],
 ['wrong-eligibility',competitive,j=>{j.find(r=>r.stage==='round-received').state.waiting=true;},/recipient-context/],
 ['rebound-live-occupancy','competitive-actions-0/checkpoints.json',j=>{j.checkpoints.find(r=>r.id.endsWith(':r0:1:round-receipt-live-occupancy')).observed[0][0]={owner:2,name:'noob'};},/recipient-occupancy/],
 ['coop-recipient-other-hp','coop-actions-0/action-ledger.jsonl',j=>{j.find(r=>r.stage==='round-complete').state.game.players[2].units[0].hp++;},/whole-recipient/],
 ['coop-occupancy','coop-actions-0/checkpoints.json',j=>{const at=j.checkpoints.findIndex(r=>r.id==='coop:host:r1:round-complete:broadcast-exact-all-assets');j.checkpoints.slice(0,at).filter(r=>r.id==='host:exact-grid-occupancy').at(-1).observed[0][0]={owner:1,name:'noob'};},/recipient-occupancy/],
 ['missing-shape-regression','checkpoints.json',j=>{j.checkpoints=j.checkpoints.filter(r=>r.id!=='source-regression/projected/1');},/observation-shapes/]
])test('hash-rebound '+name+' fails independent round inspection',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-round-'));
 try{
  fs.cpSync(original,dir,{recursive:true});const p=path.join(dir,n),lines=n.endsWith('.jsonl'),s=fs.readFileSync(p,'utf8'),v=lines?s.trim().split('\n').map(JSON.parse):JSON.parse(s);mutate(v);
  fs.writeFileSync(p,lines?v.map(r=>JSON.stringify(r)).join('\n')+'\n':JSON.stringify(v));
  const c=JSON.parse(fs.readFileSync(path.join(dir,'coverage-results.json')));c.evidenceHashes[n]=hash(p);fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(c));
  assert.throws(()=>F.review(dir),pattern);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('occupancy rejects duplicate and out-of-bounds units',()=>{
 const {occupancy}=require('./review_sequence_rounds'),g={ownership:[[1]],players:[{index:1,units:[{x:0,y:0,name:'noob'},{x:0,y:0,name:'noob'}]}]};
 assert.throws(()=>occupancy(g),/duplicate-occupancy/);g.players[0].units.pop();g.players[0].units[0].x=-1;assert.throws(()=>occupancy(g),/out-of-grid/);
});
test('hash-rebound minimized-prefix corruption fails semantics',()=>{
 const {reviewFailure}=require('./review_sequence_failure'),source=path.resolve('artifacts/TASK-220/green-20260925-01'),manifest=structuredClone(require('./sequence_failure_hashes.json')),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-failure-'));
 try{
  for(const n of Object.keys(manifest)){fs.mkdirSync(path.dirname(path.join(dir,n)),{recursive:true});fs.copyFileSync(path.join(source,n),path.join(dir,n));}
  const n='minimized-replays/coop-actions-0.json',p=path.join(dir,n),v=JSON.parse(fs.readFileSync(p));v.smallestFailingPrefix=1;fs.writeFileSync(p,JSON.stringify(v));manifest[n]=hash(p);
  assert.throws(()=>reviewFailure((id,e,o)=>assert.deepEqual(o,e,id),{},dir,manifest),/failure\/summary/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
