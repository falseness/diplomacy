#!/usr/bin/env bash
# Prospective NEW-proof measurement only. No original evidence is rewritten.
set -euo pipefail
/usr/local/bin/node20 --max-old-space-size=4096 - "$@" <<'JS'
'use strict';
const fs=require('fs'),path=require('path'),z=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const {encodeProof,decodeProof}=require('/root/diplomacy_server/tests/helpers/proofCodec');
const start=performance.now(),root=fs.realpathSync('/root/diplomacy/artifacts'),task=root+'/TASK-998';
const out=path.resolve(process.argv[2]||'');
assert(out.startsWith(task+'/'),'output must be inward');fs.mkdirSync(out,{recursive:true});assert(fs.realpathSync(out).startsWith(task+'/'),'output must resolve inward');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const index=fs.readFileSync(task+'/receipt-index.json');
const samples=JSON.parse(fs.readFileSync(task+'/recovery-8/checkpoint.json'));
const sources=JSON.parse(fs.readFileSync(task+'/recovery-8/file-measurements.json'));
const plans=['/recovery-7/storage-plan.json','/recovery-7/encoded/storage-plan.json'].flatMap(p=>JSON.parse(fs.readFileSync(task+p)).rows);
const proofPaths=new Set(plans.flatMap(r=>r.parts.map(p=>fs.realpathSync(p.proofPath))));
const files=new Map(),objects=new Map(),controls=new Set();let peak=0;
function decode(bytes,digest){const result=z.inflateSync(bytes);assert.equal(hash(result),digest,'stream hash mismatch');return result;}
for(const s of sources){
 assert(performance.now()-start<570000,'measurement deadline');
 const stored=fs.readFileSync(s.path);assert.equal(hash(stored),s.storedSHA256,'original stored hash');
 const raw=s.path.endsWith('.gz')?z.gunzipSync(stored):stored;assert.equal(hash(raw),s.rawSHA256);
 let native=raw,kind='exact-byte-sidecar';
 if(proofPaths.has(s.path)){
  const parsed=JSON.parse(raw),plain=decodeProof(parsed),encoded=parsed.proofEncoding?parsed:encodeProof(parsed);
  const reference=JSON.stringify(plain);assert.equal(JSON.stringify(decodeProof(encoded)),reference,'complete proof reconstruction');
  native=Buffer.from(JSON.stringify(encoded));kind='cas-v1-proof';
  const id=Object.keys(encoded.casBlobs)[0];assert(id,'expected reference blob');
  for(const mode of ['missing','corrupt']){
   const broken={...encoded,casBlobs:{...encoded.casBlobs}};
   if(mode==='missing')delete broken.casBlobs[id];else broken.casBlobs[id]={corrupted:true};
   assert.throws(()=>decodeProof(broken),mode==='missing'?/missing proof blob/:/proof blob hash mismatch/);controls.add(mode+'-cas-blob');
  }
 }
 const digest=hash(native),compressed=z.deflateSync(native,{level:9});assert.deepEqual(decode(compressed,digest),native);
 assert.throws(()=>decode(compressed,'0'.repeat(64)),/stream hash mismatch/);controls.add('wrong-stream-hash');
 assert.throws(()=>decode(compressed.subarray(0,compressed.length-1),digest));controls.add('truncated-stream');
 const corrupt=Buffer.from(compressed);corrupt[Math.floor(corrupt.length/2)]^=1;
 assert.throws(()=>decode(corrupt,digest));controls.add('corrupt-stream');
 const manifest={logicalPath:s.path,originalSHA256:s.rawSHA256,nativeSHA256:digest,nativeBytes:native.length,kind};
 const manifestBytes=Buffer.byteLength(JSON.stringify(manifest))+1;
 const row={...manifest,storedSHA256:s.storedSHA256,rawBytes:raw.length,compressedBytes:compressed.length,manifestBytes};files.set(s.path,row);
 if(objects.has(digest))assert.equal(objects.get(digest),compressed.length);else objects.set(digest,compressed.length);
 peak=Math.max(peak,raw.length+native.length+compressed.length);
 assert.equal(hash(fs.readFileSync(s.path)),s.storedSHA256,'original unchanged');
}
const rows=samples.map(r=>{
 const f=r.files.map(p=>{assert(files.has(p));return files.get(p);});
 return {matrixID:r.matrixID,moduleID:r.moduleID,dimensions:r.dimensions,receiptBytes:r.receiptBytes,proofBytes:f.filter(x=>x.kind==='cas-v1-proof').reduce((n,x)=>n+x.compressedBytes,0),sidecarBytes:f.filter(x=>x.kind!=='cas-v1-proof').reduce((n,x)=>n+x.compressedBytes,0),manifestBytes:f.reduce((n,x)=>n+x.manifestBytes,0),nativeBytes:f.reduce((n,x)=>n+x.compressedBytes+x.manifestBytes,0)+r.receiptBytes};
});
const total=rows.reduce((n,r)=>n+r.nativeBytes,0),unique=[...objects.values()].reduce((n,x)=>n+x,0),manifests=[...files.values()].reduce((n,r)=>n+r.manifestBytes,0),receipts=rows.reduce((n,r)=>n+r.receiptBytes,0);
const accounting=require('child_process').execFileSync('python3',['-c',`import os,stat
seen=set();n=0
for d,ds,fs in os.walk(${JSON.stringify(root)},followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in fs:
  s=os.lstat(os.path.join(d,f));k=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and k not in seen:seen.add(k);n+=s.st_size
print(n)`],{encoding:'utf8',timeout:60000});
const storedBytes=Number(accounting),headroom=40*1024**3-storedBytes;
assert.equal(hash(fs.readFileSync(task+'/receipt-index.json')),hash(index));
const report={sampleCount:rows.length,uniqueFiles:files.size,uniqueObjects:objects.size,sampleNativeBytes:total,uniqueCompressedBytes:unique,manifestBytes:manifests,receiptBytes:receipts,linearProjectionBytes:Math.ceil(total*3900/rows.length),optimisticExactDedupProjectionBytes:Math.ceil((unique+manifests+receipts)*3900/rows.length),sampleMaximumProjectionBytes:Math.max(...rows.map(r=>r.nativeBytes))*3900,storedBytes,headroomBytes:headroom,largestBufferLowerBoundBytes:peak,measurementMaxRSSBytes:process.resourceUsage().maxRSS*1024,runtimeStagingPeakBytes:null,retainedCandidateBytes:0,originalsModified:false,receiptIndexSHA256:hash(index),negativeControls:[...controls].sort(),reservationAdmitted:false,elapsedMs:performance.now()-start,format:'Prospective NEW cas-v1 JSON proof compressed with zlib level 9; exact-byte compressed sidecars. Exact duplicate streams counted separately and once. No runtime codec installed.',reconstruction:'Complete decoded JSON including identity, obligations and checkpoints is equal; original proof whitespace/byte layout is NOT represented by this prospective new-proof format. Sidecars reconstruct exact bytes. Original proof hashes remain unchanged and are not rewritten.',uncertainty:'Purposive 66 saved cases across 18 modules, not a confidence bound. Dynamic content and runtime staging remain unknown. Maximum sample is not an upper bound. Index charged per case; new full collection reports additional. No admission based on these projections alone.',rows};
fs.writeFileSync(out+'/cas-stream-plan.json',JSON.stringify(report,null,2)+'\n');fs.writeFileSync(out+'/file-measurements.json',JSON.stringify([...files.values()],null,2)+'\n');
for(const r of rows)console.log('PASS complete proof/sidecar reconstruction '+r.matrixID+' nativeBytes='+r.nativeBytes);
console.log('PASS negative controls: '+report.negativeControls.join(','));console.log('PASS original hashes and receipt index unchanged; retainedCandidateBytes=0');
console.log('HEADROOM '+headroom+' LINEAR '+report.linearProjectionBytes+' EXACT_DEDUP '+report.optimisticExactDedupProjectionBytes+' SAMPLED_MAXIMUM '+report.sampleMaximumProjectionBytes);
console.log('NOT ADMITTED: runtime peak and full-volume bound unmeasured');
JS
