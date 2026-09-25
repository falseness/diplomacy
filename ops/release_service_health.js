'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),https=require('node:https'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
async function main(){
 const c=JSON.parse(fs.readFileSync(process.argv[2])),secrets=JSON.parse(fs.readFileSync(c.credentialsFile));
 const {io}=createRequire(path.join(c.helperRoot,'services.js'))('socket.io-client');
 const {MongoClient}=createRequire(path.join(c.serverCwd,'index.js'))('mongodb');
 const mongo=await MongoClient.connect(c.mongoUri);
 const sockets=[];
 try{
  const health=await new Promise((resolve,reject)=>{const req=https.get(c.endpoint+'/socket.io/?EIO=4&transport=polling',{ca:c.ca,rejectUnauthorized:true,agent:false},res=>{
   const socket=res.socket,peer=socket.getPeerCertificate();let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({statusCode:res.statusCode,authorized:socket.authorized,peerFingerprint256:peer.fingerprint256,engineHandshake:body.includes('"sid"')}));
  });req.setTimeout(10000,()=>req.destroy(Error('health-timeout')));req.on('error',reject);});
  assert.equal(health.statusCode,200);assert.equal(health.authorized,true);assert.equal(health.engineHandshake,true);assert.equal(health.peerFingerprint256,c.certificateFingerprint);
  const fixture=require(path.join(c.helperRoot,'../../coop/helpers/current-coop-fixture'));
  global.townInterface??={change(){},hide(){}};
  const board=fixture.buildCurrentCoopBoardInVm(fixture.remoteTransportFixtureSpec());
  const db=mongo.db(c.databaseName),sentinel={_id:'release-probe-sentinel',value:crypto.randomBytes(16).toString('hex')};
  await db.collection('releaseSentinel').insertOne(sentinel);
  const request=(socket,event,password,game)=>new Promise((resolve,reject)=>{
   const names=['gameStarted','playYourTurn','waitYouTurn','smokeRunCleaned','error'];
   const done=()=>{clearTimeout(timer);names.forEach((n,i)=>socket.off(n,handlers[i]));};
   const handlers=names.map(n=>body=>{done();resolve({event:n,body});});
   const timer=setTimeout(()=>{done();reject(Error('authentication-timeout'));},10000);
   names.forEach((n,i)=>socket.on(n,handlers[i]));socket.emit(event,JSON.stringify({password,...(game?{game}:{} )}));
  });
  const rows=[];
  for(const entry of secrets){
   assert(Date.now()<c.stopAt,'authentication-deadline');
   const userId=crypto.createHash('sha256').update(entry.password).digest('hex');
   const socket=io(c.endpoint,{transports:['websocket'],reconnection:false,forceNew:true,ca:c.ca,rejectUnauthorized:true,timeout:10000});sockets.push(socket);
   await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
   const response=await request(socket,'startGameOrConnect',entry.password,structuredClone(board));assert.notEqual(response.event,'error','smoke-admission');
   const user=await db.collection('users').findOne({userId});assert.equal(user.smokeRun,entry.run,'persisted-smoke-namespace');
   rows.push({userId,run:entry.run,namespaceVerified:true,transport:socket.io.engine.transport.name,socket,password:entry.password});
  }
  for(const run of new Set(rows.map(r=>r.run))){const row=rows.find(r=>r.run===run);const response=await request(row.socket,'cleanupSmokeRun',row.password);assert.equal(response.event,'smokeRunCleaned');}
  for(const row of rows){const response=await request(row.socket,'startGameOrConnect',row.password,structuredClone(board));assert.equal(response.body,'SMOKE_ISOLATION_DENIED');row.deniedAfterCleanup=true;delete row.socket;delete row.password;}
  assert.deepEqual(await db.collection('releaseSentinel').findOne({_id:sentinel._id}),sentinel);
  assert.equal(await db.collection('games').countDocuments({smokeRun:{$in:rows.map(r=>r.run)}}),0);
  fs.writeFileSync(c.resultFile,JSON.stringify({health,authenticated:rows,sentinelPreserved:true})+'\n',{flag:'wx'});
 }finally{for(const s of sockets)s.disconnect();await mongo.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
