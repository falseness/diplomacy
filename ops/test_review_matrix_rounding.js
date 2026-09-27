'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),R=require('./review_matrix_evidence_v2'),old=require('./review_matrix_evidence');
const provider=path.join(A.client,'artifacts/TASK-225/review-96/provider'),receiptFile=path.join(provider,'../provider-process-exit.json'),receipt={file:receiptFile,sha256:A.hash(receiptFile)};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)).map(n=>e.name+'/'+n):[e.name]);
const manifest=d=>Object.fromEntries(files(d).map(n=>[n,A.hash(path.join(d,n))]));
test('same real provider: old strict bound rejects one ULP; corrected reader accepts',()=>{const m=manifest(provider);assert.throws(()=>old.review(provider,old.CURRENT,receipt,m),/firefox-competitive-desktop\/numeric-scale-change/);const r=R.review(provider,R.CURRENT,receipt,m);assert.equal(r.checks.length,2001);assert.deepEqual(A.compareSources(A.read(path.join(provider,'source-identities.json'))),[]);});
for(const [id,file,change,pattern] of [
 ['material scale undershoot','firefox-competitive-desktop/matrix-observations.jsonl',r=>{r.find(r=>r.kind==='scale-after').value.after=5/14-1e-8;},/numeric-scale-change/],
 ['no scale change','firefox-competitive-desktop/matrix-observations.jsonl',r=>{r.find(r=>r.kind==='scale-after').value.after=1;},/numeric-scale-change/],
 ['wrong purchase operands','chromium-coop-desktop/matrix-observations.jsonl',r=>{r.find(r=>r.kind==='gold-before').value++;},/chromium-coop-desktop\/purchase/],
 ['unexplained page error','chromium-coop-desktop/network-traces.jsonl',r=>r.push({stage:'pageerror',message:'unexpected injected renderer error'}),/unexplained-pageerrors/]
])test(id+' fails after proof hash rebinding',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-rounding-'));try{fs.cpSync(provider,dir,{recursive:true});const f=path.join(dir,file),rows=fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);change(rows);fs.writeFileSync(f,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');assert.throws(()=>R.review(dir,R.CURRENT,receipt,manifest(dir)),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
