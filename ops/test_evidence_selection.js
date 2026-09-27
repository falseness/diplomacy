'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('./evidence_selection'),A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
test('selection transaction rereads fresh bytes between calls and rejects changed cached proof',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-proof-'));
 try {const f=path.join(dir,'proof.json');fs.writeFileSync(f,'{"value":1}');const manifest={'proof.json':A.hash(f)};
  const first=S.transaction(()=>{assert.equal(A.read(f).value,1);A.proofKey(dir,'proof.json',manifest);A.proofKey(dir,'proof.json',manifest);});
  assert.equal(first.metrics.proofHits,1);
  assert.throws(()=>S.transaction(()=>{A.read(f);A.proofKey(dir,'proof.json',manifest);fs.writeFileSync(f,'{"value":2}');}),/selection-read-changed/);
  assert.equal(S.transaction(()=>A.read(f)).result.value,2);
  assert.throws(()=>S.transaction(()=>A.proofKey(dir,'proof.json',manifest)),/evidence-hash-mismatch/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('selection transaction retains canonical containment and rejects traversal',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-path-'));
 try {fs.mkdirSync(path.join(dir,'inside'));fs.writeFileSync(path.join(dir,'proof.json'),'{}');const manifest={'proof.json':A.hash(path.join(dir,'proof.json'))};
  assert.throws(()=>S.transaction(()=>A.proofKey(path.join(dir,'inside'),'../proof.json',manifest)),/invalid-case-proof/);
  fs.symlinkSync(path.join(dir,'proof.json'),path.join(dir,'inside/escape.json'));
  assert.throws(()=>S.transaction(()=>A.proofKey(path.join(dir,'inside'),'escape.json',manifest)),/escaped-case-proof/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
