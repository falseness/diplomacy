#!/usr/bin/env bash
# Offline, checkpointed comparison. Originals and runtime codecs are never changed.
set -euo pipefail
/usr/local/bin/node20 --max-old-space-size=4096 - "$@" <<'JS'
'use strict';
const fs=require('fs'),path=require('path'),z=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const {encodeProof,decodeProof}=require('/root/diplomacy_server/tests/helpers/proofCodec');
const start=performance.now(),task=fs.realpathSync('/root/diplomacy/artifacts')+'/TASK-998';
const out=path.resolve(process.argv[2]||'');assert(out.startsWith(task+'/'));fs.mkdirSync(out,{recursive:true});assert(fs.realpathSync(out).startsWith(task+'/'));
const group=Number(process.argv[3]);assert(Number.isInteger(group)&&group>=0&&group<12);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),size=o=>Buffer.byteLength(JSON.stringify(o));
const read=p=>JSON.parse(fs.readFileSync(p)),indexBytes=fs.readFileSync(task+'/receipt-index.json'),index=JSON.parse(indexBytes);
const baseline=read(task+'/recovery-9/file-measurements.json'),byPath=new Map(baseline.map(f=>[f.logicalPath,f]));
const samples=read(task+'/recovery-8/checkpoint.json');
const town=index.find(r=>r.moduleID==='town-capture-coop-v1');assert(town);
const townFiles=[],townProofs=new Map();
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())townFiles.push(fs.realpathSync(p));}}
for(const f of town.fragments){const b=fs.readFileSync(f.executionPath);assert.equal(hash(b),f.executionSHA256);const e=JSON.parse(b);walk(path.dirname(fs.realpathSync(f.executionPath)));townProofs.set(fs.realpathSync(e.proofPath),e.proofSHA256);}
samples.push({matrixID:town.matrixID,moduleID:town.moduleID,receiptBytes:size(town),files:[...new Set(townFiles)]});
assert.equal(samples.length,67);const rows=[],blobs={};
for(const s of samples.slice(group*6,group*6+6)){
 let manifestBytes=0,blobBytes=0,sidecarBytes=0,baselineBytes=s.receiptBytes,framingBytes=0;const ids=new Set(),files=[];
 for(const p of s.files){
 assert(performance.now()-start<560000,'checkpoint deadline');const stored=fs.readFileSync(p),storedHash=hash(stored),old=byPath.get(p);if(old)assert.equal(storedHash,old.storedSHA256);
 const isProof=old?.kind==='cas-v1-proof'||townProofs.has(p);
 if(!isProof&&old){sidecarBytes+=old.compressedBytes+old.manifestBytes;baselineBytes+=old.compressedBytes+old.manifestBytes;files.push({path:p,storedSHA256:storedHash,reusedBaseline:true});continue;}
 const raw=p.endsWith('.gz')?z.gunzipSync(stored):stored;if(old)assert.equal(hash(raw),old.originalSHA256);if(townProofs.has(p))assert.equal(hash(raw),townProofs.get(p));
 if(!isProof){const packed=z.deflateSync(raw,{level:9});assert.deepEqual(z.inflateSync(packed),raw);const n=packed.length+size({logicalPath:p,originalSHA256:hash(raw),nativeSHA256:hash(raw),nativeBytes:raw.length,kind:'exact-byte-sidecar'})+1;sidecarBytes+=n;baselineBytes+=n;continue;}
 const parsed=JSON.parse(raw),encoded=parsed.proofEncoding?parsed:encodeProof(parsed),{casBlobs,...root}=encoded;
 if(old){assert.equal(hash(JSON.stringify(encoded)),old.nativeSHA256);baselineBytes+=old.compressedBytes+old.manifestBytes;}else{baselineBytes+=z.deflateSync(Buffer.from(JSON.stringify(encoded)),{level:9}).length+size({logicalPath:p,originalSHA256:hash(raw),nativeSHA256:hash(JSON.stringify(encoded)),nativeBytes:size(encoded),kind:'cas-v1-proof'})+1;}
 const restored={};
 for(const [id,v] of Object.entries(casBlobs)){
 const rawBlob=Buffer.from(JSON.stringify(v)),digest=hash(rawBlob),packed=z.deflateSync(rawBlob,{level:9});assert.deepEqual(z.inflateSync(packed),rawBlob);restored[id]=JSON.parse(z.inflateSync(packed));
 if(blobs[id])assert.equal(blobs[id].storedSHA256,digest);else blobs[id]={bytes:packed.length,storedSHA256:digest};
 ids.add(id);blobBytes+=packed.length;
 }
 const manifest={...root,sharedBlobIDs:Object.keys(casBlobs)};const packedManifest=z.deflateSync(Buffer.from(JSON.stringify(manifest)),{level:9});
 const recovered=JSON.parse(z.inflateSync(packedManifest));delete recovered.sharedBlobIDs;
 assert.equal(JSON.stringify(decodeProof({...recovered,casBlobs:restored})),JSON.stringify(decodeProof(parsed)),'complete reconstruction');
 const first=Object.keys(restored)[0];assert(first);const missing={...restored};delete missing[first];assert.throws(()=>decodeProof({...root,casBlobs:missing}),/missing proof blob/);
 assert.throws(()=>decodeProof({...root,casBlobs:{...restored,[first]:{corrupt:true}}}),/proof blob hash mismatch/);
 manifestBytes+=packedManifest.length;framingBytes+=size({logicalPath:p,originalSHA256:hash(raw),manifestSHA256:hash(z.inflateSync(packedManifest)),kind:'compressed-shared-cas-v1'})+1;
 assert.equal(hash(fs.readFileSync(p)),storedHash);files.push({path:p,storedSHA256:storedHash,reusedBaseline:!!old});
 }
 const row={matrixID:s.matrixID,moduleID:s.moduleID,receiptBytes:s.receiptBytes,manifestBytes,framingBytes,sidecarBytes,blobBytes,blobIDs:[...ids],baselineBytes,unsharedBytes:s.receiptBytes+manifestBytes+framingBytes+sidecarBytes+blobBytes,files};rows.push(row);
 console.log('PASS complete reconstruction; missing/corrupt blob rejection; baseline hashes matched '+s.matrixID);
}
assert.equal(hash(fs.readFileSync(task+'/receipt-index.json')),hash(indexBytes));
fs.writeFileSync(out+'/group-'+group+'.json',JSON.stringify({rows,blobs,elapsedMs:performance.now()-start,indexSHA256:hash(indexBytes),codecSHA256:hash(fs.readFileSync('/root/diplomacy_server/tests/helpers/proofCodec.js')),baselineSHA256:hash(fs.readFileSync(task+'/recovery-9/file-measurements.json')),originalsModified:false,retainedCandidateBytes:0})+'\n');
console.log('PASS group='+group+' cases='+rows.length+' originals/index unchanged');
JS
