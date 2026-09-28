'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const F=require('./review_sequence_evidence');
const original=path.resolve('artifacts/TASK-220/green-20260925-03');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
test('immutable sequence observations pass independent action checks without whole-criterion credit',()=>{const r=F.review(original);assert.equal(r.checks.length,157);assert.deepEqual(r.criteria,[]);assert.equal(r.fullCriterionReview,false);});
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
