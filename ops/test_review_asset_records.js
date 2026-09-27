'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),S=require('./evidence_selection'),P=require('./review_asset_records');
const receiptFile=path.join(A.client,'artifacts/TASK-225/review-60/verification-budget.json'),receipt={file:receiptFile,sha256:A.hash(receiptFile)};
for(const [id,name,mutate,pattern] of [
 ['omitted-command','verification.log',text=>text.replace(/^COMMAND .+\n/m,''),/literal-parent-command/],
 ['truncated-output','verification.log',text=>text.replace('TAP version 13','TAP truncated'),/full-stdout-stderr-and-exit/],
 ['wrong-runtime','verification.log',text=>text.replace(/125\.0\.6422\.26/g,'0.0.0.0'),/full-stdout-stderr-and-exit|runtime/],
 ['credential-leak','asset-events.jsonl',text=>text.replace('"password":"[redacted]"','"password":"123456789012"'),/redaction/],
 ['false-checkpoint','checkpoints.json',text=>{const x=JSON.parse(text);x.checkpoints[0].observed={wrong:true};return JSON.stringify(x);},/checkpoint\//],
 ['missing-capture','screenshots/001-cold-warm-delay-p1-round0-recovered.png',()=>null,/ENOENT/]
])test('AC4 rejects '+id+' even after local proof hash rebinding',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-records-'));
 try {fs.cpSync(path.join(S.BASE,'prepared'),dir,{recursive:true});const file=path.join(dir,'selected-211',name),value=mutate(fs.readFileSync(file,'utf8'));
  if(value===null)fs.unlinkSync(file);else fs.writeFileSync(file,value);
  const mf=path.join(dir,'selected-211/evidence-hashes.json'),manifest=A.read(mf);if(value!==null)manifest[name]=A.hash(file);fs.writeFileSync(mf,JSON.stringify(manifest));
  assert.throws(()=>S.transaction(()=>P.review(dir,receipt)),pattern);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
