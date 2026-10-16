#!/usr/bin/env bash
# Offline disk-backed prototype. Does not modify the runtime proof codec.
set -euo pipefail
/usr/local/bin/node20 --max-old-space-size=4096 - "$@" <<'JS'
'use strict';
const fs=require('fs'),path=require('path'),z=require('zlib'),crypto=require('crypto'),assert=require('assert/strict');
const {encodeProof,decodeProof}=require('/root/diplomacy_server/tests/helpers/proofCodec');
const base=fs.realpathSync('/root/diplomacy/artifacts')+'/TASK-998',out=path.resolve(process.argv[2]||''),start=performance.now();
assert(out.startsWith(base+'/'));fs.mkdirSync(out,{recursive:true});assert(fs.realpathSync(out).startsWith(base+'/'));
const read=p=>JSON.parse(fs.readFileSync(p)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const groups=Array.from({length:12},(_,i)=>read(base+'/recovery-11/group-'+i+'.json'));
const rows=groups.flatMap(g=>g.rows),baseline=new Map(read(base+'/recovery-9/file-measurements.json').map(f=>[f.logicalPath,f]));
const mode=process.argv[3];assert(['largest-pack','largest-sidecars'].includes(mode));
const row=[...rows].sort((a,b)=>mode==='largest-pack'?b.candidateBytes-a.candidateBytes:b.sidecarBytes-a.sidecarBytes)[0];
const prior=groups.find(g=>g.rows.some(r=>r.matrixID===row.matrixID));
assert.equal(hash(fs.readFileSync(base+'/receipt-index.json')),prior.indexSHA256);
assert.equal(hash(fs.readFileSync('/root/diplomacy_server/tests/helpers/proofCodec.js')),prior.codecSHA256);
// Use the complete hash-checked file inventory, not just the proof subset in recovery-11.
const inventory=read(prior.baselineReference).rows.find(r=>r.matrixID===row.matrixID).files;
assert(inventory.every(f=>baseline.has(f.path)),'sidecar classification must have measured baseline');
const owned=fs.mkdtempSync(out+'/writer-'),blobs=new Map(),proofs=[],sidecars=[],components={pack:0,index:0,root:0,sidecar:0};
let peak=0,live=0,rawSidecarPeak=0,serial=0;
const measure=()=>{live=fs.readdirSync(owned).reduce((n,f)=>n+fs.statSync(owned+'/'+f).size,0);peak=Math.max(peak,live);};
function write(kind,bytes){const name=(serial++)+'-'+kind;fs.writeFileSync(owned+'/'+name+'.tmp',bytes);measure();fs.renameSync(owned+'/'+name+'.tmp',owned+'/'+name);measure();components[kind]+=bytes.length;return name;}
function unpack(p,i){const data=fs.readFileSync(owned+'/'+p),desc=JSON.parse(z.inflateSync(fs.readFileSync(owned+'/'+i)));assert.equal(hash(data),desc.packSHA256,'pack hash mismatch');const raw=z.inflateSync(data);assert.equal(hash(raw),desc.decodedSHA256);return new Map(desc.index.map(e=>{const b=raw.subarray(e.offset,e.offset+e.length);assert.equal(hash(b),e.sha256,'blob hash mismatch');return[e.id,JSON.parse(b)];}));}
let report;
try {
 for(const f of inventory){
  assert(performance.now()-start<540000,'writer checkpoint deadline');const stored=fs.readFileSync(f.path);assert.equal(hash(stored),f.storedSHA256);
  const raw=f.path.endsWith('.gz')?z.gunzipSync(stored):stored,old=baseline.get(f.path);
  if(old.kind!=='cas-v1-proof'){
   // Model a service-produced plain sidecar coexisting with its compressed replacement.
   fs.writeFileSync(owned+'/sidecar.raw',raw);rawSidecarPeak=Math.max(rawSidecarPeak,raw.length);measure();
   const file=write('sidecar',z.deflateSync(raw,{level:9}));assert.equal(hash(z.inflateSync(fs.readFileSync(owned+'/'+file))),hash(raw));
   fs.unlinkSync(owned+'/sidecar.raw');measure();sidecars.push({path:f.path,sha256:hash(raw),file});continue;
  }
  const parsed=JSON.parse(raw),encoded=parsed.proofEncoding?parsed:encodeProof(parsed);assert.equal(hash(JSON.stringify(encoded)),old.nativeSHA256);
  const {casBlobs,...root}=encoded;let batch=[],size=0;
  function flush(){if(!batch.length)return;let offset=0;const index=batch.map(([id,b])=>{const e={id,offset,length:b.length,sha256:hash(b)};offset+=b.length;return e;});
   const raw=Buffer.concat(batch.map(e=>e[1])),data=z.deflateSync(raw,{level:9}),desc={packSHA256:hash(data),decodedSHA256:hash(raw),decodedBytes:raw.length,index};
   const p=write('pack',data),i=write('index',z.deflateSync(Buffer.from(JSON.stringify(desc)),{level:9}));
   for(const [id] of batch)blobs.set(id,[p,i]);batch=[];size=0;
  }
  for(const [id,v] of Object.entries(casBlobs)){if(blobs.has(id))continue;const b=Buffer.from(JSON.stringify(v));if(size+b.length>1048576)flush();batch.push([id,b]);size+=b.length;}flush();
  const manifest={root,blobs:Object.keys(casBlobs).map(id=>[id,...blobs.get(id)])};
  const file=write('root',z.deflateSync(Buffer.from(JSON.stringify(manifest)),{level:9}));
  const saved=JSON.parse(z.inflateSync(fs.readFileSync(owned+'/'+file))),restored={},cache=new Map();
  for(const [id,p,i] of saved.blobs){if(!cache.has(p))cache.set(p,unpack(p,i));assert(cache.get(p).has(id),'missing blob');restored[id]=cache.get(p).get(id);}
  assert.equal(JSON.stringify(decodeProof({...saved.root,casBlobs:restored})),JSON.stringify(decodeProof(parsed)));
  delete restored[saved.blobs[0][0]];assert.throws(()=>decodeProof({...saved.root,casBlobs:restored}),/missing proof blob/);
  proofs.push({path:f.path,file,storedSHA256:f.storedSHA256});
 }
 const [p,i]=blobs.values().next().value,data=fs.readFileSync(owned+'/'+p),bad=Buffer.from(data);bad[0]^=1;
 fs.writeFileSync(owned+'/'+p,bad);assert.throws(()=>unpack(p,i),/pack hash mismatch/);fs.writeFileSync(owned+'/'+p,data);
 fs.renameSync(owned+'/'+p,owned+'/'+p+'.absent');assert.throws(()=>unpack(p,i),/ENOENT/);fs.renameSync(owned+'/'+p+'.absent',owned+'/'+p);
 const manifest=write('root',Buffer.from(JSON.stringify({proofs,sidecars,inputIndexSHA256:prior.indexSHA256,codecSHA256:prior.codecSHA256})));
 measure();assert.equal(live,Object.values(components).reduce((a,b)=>a+b,0));
 report={matrixID:row.matrixID,selection:mode,inventoryFiles:inventory.length,proofs:proofs.length,sidecars:sidecars.length,components,committedBytes:live,simultaneousWriterPeakBytes:peak,largestPlainSidecarBytes:rawSidecarPeak,manifest,originalReferences:inventory,baselineReference:prior.baselineReference,indexSHA256:prior.indexSHA256,codecSHA256:prior.codecSHA256};
 console.log('PASS disk-backed complete proof reconstruction; exact sidecars; corrupt pack/missing pack/missing blob rejected');
 // Simulate failure after all files were written, at the maximum retained transaction size.
 if(mode==='largest-pack')throw new Error('injected writer failure');
} catch(error) {
 assert.equal(error.message,'injected writer failure');assert(report,'failure must occur after complete staged transaction');
 console.log('PASS injected writer failure propagated through transaction');
} finally {fs.rmSync(owned,{recursive:true,force:true});assert(!fs.existsSync(owned));console.log('PASS '+(mode==='largest-pack'?'failure':'success')+' owned writer cleanup temporaryFilesRemaining=0');}
for(const f of inventory)assert.equal(hash(fs.readFileSync(f.path)),f.storedSHA256);
assert.equal(hash(fs.readFileSync(base+'/receipt-index.json')),prior.indexSHA256);
Object.assign(report,{elapsedMs:performance.now()-start,temporaryFilesRemaining:0,originalsModified:false,reservationAdmitted:false,limitations:'Historical disk-backed prototype, not installed service writer. Plain proof is encoded in memory. Report growth, unmeasured strata and service-specific staging remain unbounded.'});
fs.writeFileSync(out+'/'+mode+'.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS '+mode+' '+row.matrixID+' peakBytes='+peak+' committedBytes='+report.committedBytes+' originals/index unchanged');
JS
