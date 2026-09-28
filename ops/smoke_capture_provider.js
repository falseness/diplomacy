'use strict';
// Opt-in observation of a pinned test, never of production handlers. Keep all
// existing statements/assertions; additions author only explicit sentinel fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const FILE='/root/diplomacy_server/tests/reliability/smoke-isolation.test.js';
const PIN='70c03f64e9a7706de7d97eb18edb4dab4161a95080abd9b31504c2b4ba151bec';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function instrument(source){
 assert.equal(hash(source),PIN,'unreviewed smoke provider');
 const add=(from,to)=>{assert.equal(source.split(from).length,2,'unique smoke boundary '+from);source=source.replace(from,to);};
 add(' let lifecycle,logDir;',` let lifecycle,logDir;
 const capture=require('/root/diplomacy/ops/smoke_capture_provider').recorder(out,credentials,ids,entries);
 capture.install();`);
 add('   const peers={};',`   await capture.services(service);
   const peers={};`);
 add("    const response=await bounded('response '+n",`    const sent=capture.sent(n,peerName,h.client,event,extra);
    const response=await bounded('response '+n`);
 add('    trace.push({identity:n',`    capture.received(sent,response);
    trace.push({identity:n`);
 add('   const liveGame=await join',`   await capture.inventory('matched');
   const liveGame=await join`);
 add("await new Promise(r=>setTimeout(r,Math.max(0,liveUntil-Date.now()+30)));",`await capture.expired('before',liveBefore,peers.live.client);
   await new Promise(r=>setTimeout(r,Math.max(0,liveUntil-Date.now()+30)));`);
 add("   assert.deepEqual(await games.findOne({gameID:liveGame.gameID}),liveBefore",`   await capture.expired('after',await games.findOne({gameID:liveGame.gameID}),peers.live.client);
   assert.deepEqual(await games.findOne({gameID:liveGame.gameID}),liveBefore`);
 add('   const before=await snapshot();',`   await capture.inventory('cleanup-before');
   const before=await snapshot();`);
 add('   const after=await snapshot();',`   await capture.inventory('cleanup-after');
   const after=await snapshot();`);
 add("  if(logDir)for(const name",`  capture.finish();
  if(logDir)for(const name`);
 // Secret scan runs after original service-log sanitation.
 add("fs.readFileSync(file,'utf8'),secrets));}\n",`fs.readFileSync(file,'utf8'),secrets));}
  capture.scan(logDir);
`);
 return source;
}
function recorder(out,credentials,ids,entries){
 const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
 const data={schema:1,tier:'real HTTPS/Socket.IO/MongoDB',identities:ids,allowlist:entries,requests:[],inventories:{},expired:{}};
 let service;
 const safe=v=>JSON.parse(JSON.stringify(v,(k,x)=>k==='password'?'[redacted]':x));
 const inventory=async label=>{
  const db=service.mongo.db(service.databaseName),collections={};
  for(const {name}of(await db.listCollections().toArray()).sort((a,b)=>a.name.localeCompare(b.name)))
   collections[name]=await db.collection(name).find({}).sort({_id:1}).toArray();
  data.inventories[label]={at:Date.now(),database:service.databaseName,collections,other:await service.mongo.db('smoke_unrelated_sentinel').collection('sentinel').find({}).sort({_id:1}).toArray()};
  write('smoke-observations.json',data);
 };
 return {
  install(){write('smoke-policy-binding.json',require('./smoke_capture_policy.json'));write('smoke-install.json',{file:FILE,originalSha256:PIN,instrumentedSha256:hash(instrument(fs.readFileSync(FILE,'utf8'))),observerSha256:hash(fs.readFileSync(__filename))});},
  async services(s){service=s;data.lifecycle=s.lifecycle;
   // Declared before any admission: orphan account exercises run-only deletion;
   // sentinel turn has no participating game and must survive exact cleanup.
   data.fixtures={orphan:{userId:'smoke-capture-orphan',smokeRun:'run-a'},turn:{_id:'smoke-capture-sentinel',gameID:'unrelated-declared-sentinel',value:421}};
   await s.mongo.db(s.databaseName).collection('users').insertOne({...data.fixtures.orphan});
   await s.mongo.db(s.databaseName).collection('turns').insertOne({...data.fixtures.turn});
   await inventory('initial');
  },
  sent(identity,peer,socket,event,extra){const r={sequence:data.requests.length,identity,identityHash:ids[identity],peer,socketId:socket.id,engineId:socket.io.engine.id,sentAt:Date.now(),event,extra:safe(extra)};data.requests.push(r);return r;},
  received(r,response){Object.assign(r,{receivedAt:Date.now(),response:safe(response)});write('smoke-observations.json',data);},
  inventory,
  async expired(label,document,socket){data.expired[label]={at:Date.now(),document,connected:socket.connected,socketId:socket.id??null};await inventory('expired-'+label);},
  finish(){write('smoke-observations.json',data);},
  scan(logDir){const files=[];const walk=d=>{if(!d||!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile())files.push(f);}};walk(out);if(logDir&&!logDir.startsWith(out+'/'))walk(logDir);
   const leaks=[];for(const f of files){const b=fs.readFileSync(f,'utf8');for(const [label,secret]of Object.entries(credentials))if(b.includes(secret))leaks.push({file:f,label});if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(b))leaks.push({file:f,label:'private-key'});}
   write('smoke-secret-scan.json',{pass:leaks.length===0,credentialCount:Object.keys(credentials).length,files:files.map(f=>({file:f,sha256:hash(fs.readFileSync(f))})),leaks,identityHashes:'Explicit non-secret authenticated identity mapping retained for independent comparison.'});assert.equal(leaks.length,0,'actual generated credentials excluded');
  }
 };
}
function install(){const Module=require('node:module'),load=Module._extensions['.js'];assert(!require.cache[FILE]);Module._extensions['.js']=function(module,filename){if(filename!==FILE)return load(module,filename);Module._extensions['.js']=load;return module._compile(instrument(fs.readFileSync(filename,'utf8')),filename);};}
if(process.env.SMOKE_CAPTURE==='1'&&path.basename(process.argv[1]||'')==='smoke-isolation.test.js')install();
module.exports={FILE,PIN,instrument,recorder};
