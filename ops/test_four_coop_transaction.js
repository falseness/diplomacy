'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),S=require('./evidence_selection');
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'four-transaction-'));try{const file=path.join(dir,'proof.json');fs.writeFileSync(file,'{"observed":4}');fn(dir,file);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('repeated reads and proofs cached only within a rehashed transaction',()=>fixture((dir,file)=>{
 const manifest={'proof.json':A.hash(file)},read=A.read,proof=A.proofKey;
 const tx=S.transaction(()=>{for(let i=0;i<3;i++){assert.deepEqual(A.read(file),{observed:4});assert.equal(A.proofKey(dir,'proof.json',manifest),'proof.json');}});
 assert.equal(tx.metrics.readHits,2);assert.equal(tx.metrics.proofHits,2);assert.equal(tx.metrics.finalHashes,2);assert.equal(A.read,read);assert.equal(A.proofKey,proof);
 fs.writeFileSync(file,'{"observed":3}');assert.throws(()=>S.transaction(()=>A.proofKey(dir,'proof.json',manifest)),/evidence-hash-mismatch/);
}));
test('mutation after cached read rejected during final rehash',()=>fixture((dir,file)=>{
 const read=A.read;assert.throws(()=>S.transaction(()=>{A.read(file);fs.writeFileSync(file,'{"observed":3}');assert.equal(A.read(file).observed,4);}),/selection-read-changed/);assert.equal(A.read,read);
}));
test('mutation after cached proof rejected during final rehash',()=>fixture((dir,file)=>{
 const manifest={'proof.json':A.hash(file)};assert.throws(()=>S.transaction(()=>{A.proofKey(dir,'proof.json',manifest);fs.writeFileSync(file,'{"observed":3}');A.proofKey(dir,'proof.json',manifest);}),/selection-proof-changed/);
}));
test('hash rebinding cannot reuse an earlier cached proof',()=>fixture((dir,file)=>{
 const manifest={'proof.json':A.hash(file)};assert.throws(()=>S.transaction(()=>{A.proofKey(dir,'proof.json',manifest);A.proofKey(dir,'proof.json',{'proof.json':'0'.repeat(64)});}),/evidence-hash-mismatch/);
}));
