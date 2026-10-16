#!/usr/bin/env bash
# Offline measurement only: never rewrites proofs or changes their acceptance.
set -euo pipefail
/usr/local/bin/node20 --max-old-space-size=4096 - "$@" <<'JS'
'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto'), zlib=require('zlib'), assert=require('assert/strict');
const {encodeProof,decodeProof}=require('/root/diplomacy_server/tests/helpers/proofCodec');
const start=performance.now(), root=fs.realpathSync('/root/diplomacy/artifacts'), task=path.join(root,'TASK-998');
const out=path.resolve(process.argv[2]||'');
assert(out.startsWith(task+'/'), 'output must be inside real TASK-998');
fs.mkdirSync(out,{recursive:true}); assert(fs.realpathSync(out).startsWith(task+'/'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const size=x=>Buffer.byteLength(JSON.stringify(x));
const deadline=()=>assert(performance.now()-start<570000,'measurement deadline exceeded');
const indexBytes=fs.readFileSync(task+'/receipt-index.json'), index=JSON.parse(indexBytes);
const refs=JSON.parse(fs.readFileSync(task+'/recovery-5/proof-references.json')).references;
const candidates=[],unknown=[];
for(const r of index){
 deadline();
 try {
 const parts=r.fragments.map(f=>{
 const bytes=fs.readFileSync(f.executionPath); assert.equal(hash(bytes),f.executionSHA256);
 const e=JSON.parse(bytes), ref=refs.find(x=>x.executionSHA256===f.executionSHA256);
 const p=fs.existsSync(e.proofPath)?e.proofPath:ref?.referencePath;
 assert(p && fs.existsSync(p),'unreadable proof');
 return {executionPath:f.executionPath,executionSHA256:f.executionSHA256,proofPath:p,proofSHA256:e.proofSHA256,storedBytes:fs.statSync(p).size,logBytes:fs.statSync(e.logPath).size,executionBytes:bytes.length};
 });
 const m=r.matrixID.match(/-(competitive|coop)-(\d)-fog([01])-(.+)$/); assert(m,'unknown case dimensions');
 candidates.push({matrixID:r.matrixID,moduleID:r.moduleID,dimensions:[r.moduleID,'players:'+m[2],'fog:'+m[3],'sequence:'+m[4]],parts,bytes:parts.reduce((n,p)=>n+p.storedBytes,0)});
 } catch(e){unknown.push({matrixID:r.matrixID,reason:e.message});}
}
// Include both current pilots, the largest saved proofs, then greedy dimension coverage.
const selected=[],seen=new Set(),covered=new Set();
function add(c){if(c&&!seen.has(c.matrixID)){selected.push(c);seen.add(c.matrixID);c.dimensions.forEach(d=>covered.add(d));}}
index.slice(0,2).forEach(r=>add(candidates.find(c=>c.matrixID===r.matrixID)));
[...candidates].sort((a,b)=>b.bytes-a.bytes).slice(0,8).forEach(add);
while(selected.length<48){
 const rest=candidates.filter(c=>!seen.has(c.matrixID)); if(!rest.length)break;
 rest.sort((a,b)=>b.dimensions.filter(d=>!covered.has(d)).length-a.dimensions.filter(d=>!covered.has(d)).length || a.matrixID.localeCompare(b.matrixID));add(rest[0]);
}
if(process.argv[3]) {
 const selectionPath=fs.realpathSync(process.argv[3]);assert(selectionPath.startsWith(task+'/'),'sample list must be inward');
 const ids=JSON.parse(fs.readFileSync(selectionPath));assert(ids.length>0&&ids.length<=48&&new Set(ids).size===ids.length,'invalid sample list');
 selected.length=0;seen.clear();covered.clear();
 for(const id of ids){const c=candidates.find(c=>c.matrixID===id);assert(c,'requested sample unavailable: '+id);add(c);}
}
const blobs=new Map(), rows=[];let encodedTotal=0,manifestTotal=0,rawTotal=0,overheadTotal=0,maxTransient=0;
for(const c of selected){
 deadline(); const before=blobs.size; let encodedBytes=0,manifestBytes=0,originalBytes=0,overheadBytes=size(index.find(r=>r.matrixID===c.matrixID)),incrementalBlobBytes=0;
 const parts=[];
 for(const p of c.parts){
 let bytes=fs.readFileSync(p.proofPath);if(p.proofPath.endsWith('.gz'))bytes=zlib.gunzipSync(bytes);
 assert.equal(hash(bytes),p.proofSHA256,'original proof hash');
 const parsed=JSON.parse(bytes), decoded=decodeProof(parsed), encoded=parsed.proofEncoding?parsed:encodeProof(parsed);
 assert.equal(JSON.stringify(decodeProof(encoded)),JSON.stringify(decoded),'lossless reconstruction');
 const {casBlobs,...manifest}=encoded;
 // Representation under measurement: unchanged cas-v1 blob values in a global dictionary,
 // per-proof manifest lists original blob IDs; no further subtree or compression savings.
 const manifestSize=size({...manifest,sharedBlobIDs:Object.keys(casBlobs)});
 let uniqueBytes=0;
 for(const [id,value] of Object.entries(casBlobs)){
 const text=JSON.stringify(value), contentHash=hash(text);
 if(blobs.has(id)) assert.equal(blobs.get(id).contentHash,contentHash,'different stored content under same expanded hash');
 else {const n=Buffer.byteLength(text);blobs.set(id,{bytes:n,contentHash,uses:0});uniqueBytes+=n;}
 blobs.get(id).uses++;
 }
 const compact=size(encoded);encodedBytes+=compact;manifestBytes+=manifestSize;originalBytes+=bytes.length;incrementalBlobBytes+=uniqueBytes;
 overheadBytes+=p.logBytes+p.executionBytes;
 maxTransient=Math.max(maxTransient,bytes.length+compact+size(decoded));
 parts.push({...p,originalBytes:bytes.length,originalEncoding:parsed.proofEncoding||'plain',encodedBytes:compact,manifestBytes:manifestSize,blobCount:Object.keys(casBlobs).length});
 assert.equal(hash(p.proofPath.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(p.proofPath)):fs.readFileSync(p.proofPath)),p.proofSHA256,'original unchanged');
 }
 const row={matrixID:c.matrixID,moduleID:c.moduleID,dimensions:c.dimensions,parts,originalBytes,encodedBytes,manifestBytes,overheadBytes,incrementalBlobBytes,newBlobs:blobs.size-before};rows.push(row);
 rawTotal+=originalBytes;encodedTotal+=encodedBytes;manifestTotal+=manifestBytes;overheadTotal+=overheadBytes;
 fs.writeFileSync(out+'/sample-checkpoint.json',JSON.stringify(rows,null,2)+'\n');
 console.log('PASS lossless unchanged '+c.matrixID+' manifestBytes='+manifestBytes+' incrementalBlobBytes='+incrementalBlobBytes);
}
let sharedBytes=0,singleUseBytes=0;for(const b of blobs.values()){if(b.uses>1)sharedBytes+=b.bytes;else singleUseBytes+=b.bytes;}
const blobBytes=sharedBytes+singleUseBytes, nativeBytes=blobBytes+manifestTotal+overheadTotal;
// Canonical retained bytes count regular inodes once, excluding mounted archive views.
const accounting=require('child_process').execFileSync('python3',['-c',`import os,stat,json
root=${JSON.stringify(root)}
seen=set();n=0
for d,ds,fs in os.walk(root,followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in fs:
  s=os.lstat(os.path.join(d,f));k=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and k not in seen:seen.add(k);n+=s.st_size
print(n)
`],{timeout:60000,encoding:'utf8'});
const storedBytes=Number(accounting.trim()),capBytes=40*1024**3,headroomBytes=capBytes-storedBytes;
const projectedManifestAndLogs=Math.ceil((manifestTotal+overheadTotal)/rows.length*3900);
const optimisticProjection=projectedManifestAndLogs+blobBytes;
const linearProjection=Math.ceil(nativeBytes/rows.length*3900);
const report={mode:'offline measurement, not certification or reservation',sampleCount:rows.length,population:3900,selectedDimensions:[...covered].sort(),unreadable:unknown,unsampledCases:index.length-rows.length,rawTotal,encodedTotal,manifestTotal,overheadTotal,uniqueBlobCount:blobs.size,sharedBytes,singleUseBytes,blobBytes,nativeBytes,crossProofSavingsOnly:encodedTotal-(blobBytes+manifestTotal),storedBytes,capBytes,headroomBytes,transientBytes:maxTransient,transientQualification:'conservative saved-data staging estimate: raw + compact encoded + expanded largest individual proof; runtime logs and DB peak unmeasured',optimisticProjection,linearProjection,peakOptimistic:storedBytes+optimisticProjection+maxTransient,peakLinear:storedBytes+linearProjection+maxTransient,uncertainty:'Purposive sample, includes largest historical encoded files and both current pilots. Not a random confidence interval. Optimistic estimate assumes no new blobs outside sample; linear estimate assumes sample reuse rate repeats. Neither bounds unknown future dynamic content, changed source identities or fragment overhead. Full-volume admission requires a justified upper bound and runtime staging reservation.',reservationAdmitted:false,originalsModified:false,sourceChanges:false,rows};
report.decision=optimisticProjection+maxTransient>headroomBytes?'NOT ADMITTED: even sample-based optimistic estimate exceeds retained-byte headroom':'NOT ADMITTED: sample estimate requires further bounds for unknown cases/runtime peak';
fs.writeFileSync(out+'/blob-manifest.json',JSON.stringify(Object.fromEntries(blobs),null,2)+'\n');
fs.writeFileSync(out+'/storage-plan.json',JSON.stringify(report,null,2)+'\n');
assert.equal(hash(fs.readFileSync(task+'/receipt-index.json')),hash(indexBytes));deadline();
console.log('PASS offline shared-blob measurement sampleCount='+rows.length+' crossProofSavingsOnly='+report.crossProofSavingsOnly);
console.log(report.decision);console.log('HEADROOM '+headroomBytes+' OPTIMISTIC '+optimisticProjection+' LINEAR '+linearProjection+' TRANSIENT '+maxTransient);
console.log('PASS originals and index unchanged; no source changes or services');
JS
