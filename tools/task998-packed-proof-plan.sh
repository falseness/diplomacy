#!/usr/bin/env bash
# Offline bounded pack experiment; never used to certify gameplay receipts.
set -euo pipefail
/usr/local/bin/node20 --max-old-space-size=4096 - "$@" <<'JS'
'use strict';
const fs=require('fs'),path=require('path'),z=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const {encodeProof,decodeProof}=require('/root/diplomacy_server/tests/helpers/proofCodec');
const task=fs.realpathSync('/root/diplomacy/artifacts')+'/TASK-998',start=performance.now();
const out=path.resolve(process.argv[2]||'');assert(out.startsWith(task+'/'));fs.mkdirSync(out,{recursive:true});assert(fs.realpathSync(out).startsWith(task+'/'));
const group=Number(process.argv[3]);assert(Number.isInteger(group)&&group>=0&&group<12);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const priorPath=task+'/recovery-10/group-'+group+'.json',prior=read(priorPath),baseline=new Map(read(task+'/recovery-9/file-measurements.json').map(f=>[f.logicalPath,f]));
assert.equal(hash(fs.readFileSync(task+'/receipt-index.json')),prior.indexSHA256);
assert.equal(hash(fs.readFileSync('/root/diplomacy_server/tests/helpers/proofCodec.js')),prior.codecSHA256);
const rows=[],packs=[],seen=new Map();let writePeak=0;
// Bound packs by 1 MiB decoded bytes, except an indivisible larger blob.
// Shared IDs reuse the first immutable pack across this checkpoint only.
function packBlobs(entries){
 let batch=[],bytes=0;
 function flush(){
  if(!batch.length)return;
  const index=[],buffers=[];let offset=0;
  for(const [id,b] of batch){index.push({id,offset,length:b.length,sha256:hash(b)});buffers.push(b);offset+=b.length;}
  const raw=Buffer.concat(buffers),packed=z.deflateSync(raw,{level:9});
  const descriptor={packSHA256:hash(packed),decodedSHA256:hash(raw),decodedBytes:raw.length,index};
  const manifest=z.deflateSync(Buffer.from(JSON.stringify(descriptor)),{level:9});
  const p=out+'/candidate-pack.tmp',m=out+'/candidate-index.tmp';
  try{
   fs.writeFileSync(p,packed);fs.writeFileSync(m,manifest);writePeak=Math.max(writePeak,fs.statSync(p).size+fs.statSync(m).size);
   const recover=(data,desc)=>{assert.equal(hash(data),desc.packSHA256,'pack hash mismatch');const raw=z.inflateSync(data);assert.equal(hash(raw),desc.decodedSHA256);return new Map(desc.index.map(e=>{const b=raw.subarray(e.offset,e.offset+e.length);assert.equal(hash(b),e.sha256,'blob offset/hash mismatch');return[e.id,JSON.parse(b)];}));};
   const saved=fs.readFileSync(p),desc=JSON.parse(z.inflateSync(fs.readFileSync(m))),restored=recover(saved,desc);
   const bad=Buffer.from(saved);bad[0]^=1;assert.throws(()=>recover(bad,desc),/pack hash mismatch/);
   const wrong=structuredClone(desc);wrong.index[0].offset++;assert.throws(()=>recover(saved,wrong),/blob offset\/hash mismatch/);
   const n=packs.length;packs.push({bytes:packed.length,indexBytes:manifest.length,decodedBytes:raw.length,blobCount:batch.length,sha256:hash(packed)});
   for(const [id,b] of batch){assert.equal(JSON.stringify(restored.get(id)),b.toString());seen.set(id,{pack:n,value:restored.get(id),rawBytes:b.length});}
  }finally{for(const f of [p,m])if(fs.existsSync(f))fs.unlinkSync(f);}
  batch=[];bytes=0;
 }
 for(const [id,v] of entries){if(seen.has(id))continue;const b=Buffer.from(JSON.stringify(v));if(bytes+b.length>1048576)flush();batch.push([id,b]);bytes+=b.length;}
 flush();
}
for(const r of prior.rows){
 const ids=new Set();let rootBytes=0;const files=[];
 for(const f of r.files){
  assert(performance.now()-start<560000,'checkpoint deadline');const stored=fs.readFileSync(f.path);assert.equal(hash(stored),f.storedSHA256);
  const old=baseline.get(f.path);if(old&&old.kind!=='cas-v1-proof')continue;
  const raw=f.path.endsWith('.gz')?z.gunzipSync(stored):stored,parsed=JSON.parse(raw),encoded=parsed.proofEncoding?parsed:encodeProof(parsed),{casBlobs,...root}=encoded;
  if(old)assert.equal(hash(JSON.stringify(encoded)),old.nativeSHA256);
  packBlobs(Object.entries(casBlobs));const restored={};
  for(const [id,v] of Object.entries(casBlobs)){assert.equal(JSON.stringify(seen.get(id).value),JSON.stringify(v));restored[id]=seen.get(id).value;ids.add(id);}
  const manifest={root,blobs:Object.keys(casBlobs).map(id=>[id,seen.get(id).pack])},packed=z.deflateSync(Buffer.from(JSON.stringify(manifest)),{level:9});
  const decoded=JSON.parse(z.inflateSync(packed));assert.equal(JSON.stringify(decodeProof({...decoded.root,casBlobs:restored})),JSON.stringify(decodeProof(parsed)));
  const first=Object.keys(restored)[0];assert(first);delete restored[first];assert.throws(()=>decodeProof({...root,casBlobs:restored}),/missing proof blob/);
  rootBytes+=packed.length;files.push({path:f.path,storedSHA256:f.storedSHA256});assert.equal(hash(fs.readFileSync(f.path)),f.storedSHA256);
 }
 rows.push({matrixID:r.matrixID,moduleID:r.moduleID,baselineBytes:r.baselineBytes,sidecarBytes:r.sidecarBytes,framingBytes:r.framingBytes,receiptBytes:r.receiptBytes,rootBytes,blobIDs:[...ids],files});
 console.log('PASS pack reconstruction; corrupt pack/offset and missing blob rejected '+r.matrixID);
}
// Allocate each bounded pack proportionally to decoded blob bytes, then across sample users.
const uses=new Map();for(const r of rows)for(const id of r.blobIDs)uses.set(id,(uses.get(id)||0)+1);
for(const r of rows){r.packBytes=r.blobIDs.reduce((n,id)=>{const b=seen.get(id),p=packs[b.pack];return n+(p.bytes+p.indexBytes)*b.rawBytes/p.decodedBytes/uses.get(id);},0);r.candidateBytes=r.packBytes+r.rootBytes+r.sidecarBytes+r.framingBytes+r.receiptBytes;delete r.blobIDs;}
assert.equal(hash(fs.readFileSync(task+'/receipt-index.json')),prior.indexSHA256);
fs.writeFileSync(out+'/group-'+group+'.json',JSON.stringify({rows,packs,writePeakBytes:writePeak,elapsedMs:performance.now()-start,baselineReference:priorPath,baselineSHA256:hash(fs.readFileSync(priorPath)),indexSHA256:prior.indexSHA256,codecSHA256:prior.codecSHA256,originalsModified:false,temporaryFilesRemaining:0,reservationAdmitted:false})+'\n');
console.log('PASS group='+group+' cases='+rows.length+' originals/index unchanged; temporaryFilesRemaining=0');
JS
