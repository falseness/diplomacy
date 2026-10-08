'use strict';
// Real shipped service + MongoDB + TLS + Socket.IO; no production access.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('node:assert/strict');
const {spawn}=require('child_process');
const server=process.env.DIPLOMACY_SERVER_ROOT || '/root/diplomacy_server';
const {launchServices}=require(path.join(server,'tests/reliability/helpers/services'));
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
function child(argv,env=process.env){return new Promise((resolve,reject)=>{
 let output='';
 const p=spawn(argv[0],argv.slice(1),{env,stdio:['ignore','pipe','pipe']});
 p.stdout.on('data',d=>{output+=d;process.stdout.write(d)});p.stderr.on('data',d=>process.stderr.write(d));
 p.on('error',reject);p.on('exit',code=>{console.log('CHILD_EXIT_STATUS='+code);code===0?resolve(output):reject(Error('live child exit '+code))});
});}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'deploy-smoke-'));
 const run='deploy'+crypto.randomBytes(8).toString('hex'), expires=Date.now()+3600000;
 const key=path.join(temp,'key'), allow=path.join(temp,'allowlist.json');
 fs.writeFileSync(key,crypto.randomBytes(48),{mode:0o600});
 fs.writeFileSync(allow,JSON.stringify([run,run+'auth',run+'action'].map(run=>({run,expiresAt:expires,identities:[1,2].map(i=>`prod_smoke_${run}_game_p${i}`)}))));
 process.env.DIPLOMACY_SMOKE_AUTH_KEY_FILE=key;process.env.DIPLOMACY_SMOKE_ALLOWLIST=allow;
 let service;
 try{
  service=await launchServices({evidenceDir:out,label:'services',enforce:true,hiddenInfo:'default',storage:'default',freshMongod:true,serverPreloads:[path.join(__dirname,'candidate_tls.js')]});
  const db=service.mongo.db(service.databaseName);
  await db.collection('accounts').insertOne({accountId:'foreign-account',identity:'foreign-real'});

  const ca=path.join(temp,'ca.pem');fs.writeFileSync(ca,service.certificate.pem);
  console.log('IDENTITY '+JSON.stringify({client:process.env.DIPLOMACY_CLIENT_ROOT,server,runtime:process.version,namespace:run,readiness:service.lifecycle.readiness}));
  const smokeArgs=[process.execPath,path.join(__dirname,'live_game.js'),'--url',service.endpoint.replace('https:','wss:'),'--client-root',process.env.DIPLOMACY_CLIENT_ROOT,'--server-root',server,'--run',run,'--game','game','--smoke-key-file',key,'--expires-at',String(expires),'--server-log',path.join(service.logDir,'server.log'),'--out',path.join(out,'gameplay'),'--ca',ca];
  const baselineArgs=[...smokeArgs];baselineArgs[baselineArgs.indexOf('--out')+1]=path.join(out,'baseline-game');
  await child([...baselineArgs,'--no-cleanup','true']);
  const gamesEnv={...process.env,DIPLOMACY_LOCAL_MONGO_URI:service.mongoUri,DIPLOMACY_TEST_DB:service.databaseName};
  // Two fresh loader processes on the persisted save. Same revision fixture: no cross-version claim.
  const script=`import sys;sys.path.insert(0,${JSON.stringify(__dirname)});from pathlib import Path;import verify_live as v; a=v.games(Path(${JSON.stringify(process.execPath)}),Path(${JSON.stringify(path.join(server,'server'))}),Path(sys.argv[1])); b=v.games(Path(${JSON.stringify(process.execPath)}),Path(${JSON.stringify(path.join(server,'server'))}),Path(sys.argv[2])); assert a and all(x['ok'] for x in a.values()); v.compare_games(a,b)`;
  await child(['python3','-B','-c',script,path.join(out,'prior-save-before.log'),path.join(out,'prior-save-after.log')],gamesEnv);
  console.log('PASS prior-save open through independent loader processes; same-revision fixture baseline (cross-version coverage requires production baseline)');
  await db.collection('games').insertOne({gameID:'foreign-game',marker:'preserve'});
  await child(smokeArgs);
  const owned=JSON.parse(fs.readFileSync(path.join(out,'gameplay/owned.json')));
  for(const c of ['games','accounts','lobbies']) assert.equal(await db.collection(c).countDocuments({smokeRun:run}),0);
  for(const c of ['turns','gameRounds']) assert.equal(await db.collection(c).countDocuments({gameID:{$in:owned.gameIDs}}),0);
  assert.equal(await db.collection('sessions').countDocuments({accountId:{$in:owned.accountIds}}),0);
  assert.equal(await db.collection('accounts').countDocuments({accountId:'foreign-account'}),1);
  assert.equal(await db.collection('games').countDocuments({gameID:'foreign-game',marker:'preserve'}),1);
  console.log('PASS real Mongo smoke residue empty including retained game/account IDs; real sentinel accounts/games preserved');
  // Stall protocol acknowledgements in the client only; real auth, DB and cleanup.
  const stall=path.join(temp,'stall.js');
  fs.writeFileSync(stall, `const lib=require('socket.io-client');const original=lib.io;
lib.io=(...args)=>{const socket=original(...args),emit=socket.emitWithAck;
socket.emitWithAck=function(event,...body){if(event===process.env.STALL_EVENT){console.log('STALL '+event);return new Promise(()=>{});}return emit.call(this,event,...body);};return socket;};`);
  for (const event of ['auth:smoke','game:action']) {
    const name=event.replace(':','-'), cancelledOut=path.join(out,name);
    fs.mkdirSync(cancelledOut);
    const cancelledRun=run+(event==='auth:smoke'?'auth':'action');
    const argv=[...smokeArgs];argv.splice(1,0,'--require',stall);
    argv[argv.indexOf('--run')+1]=cancelledRun;
    argv[argv.indexOf('--out')+1]=cancelledOut;
    const wrapper=`import sys;sys.path.insert(0,${JSON.stringify(__dirname)});from pathlib import Path;import verify_live as v
try: v.run(${JSON.stringify(argv)},Path(${JSON.stringify(path.join(cancelledOut,'child.log'))}),timeout=5)
except RuntimeError as e:
 assert 'timeout' in str(e); print('PASS expected timeout:',e)
else: raise AssertionError('timeout accepted')`;
    await child(['python3','-B','-c',wrapper],{...process.env,STALL_EVENT:event});
    const log=fs.readFileSync(path.join(cancelledOut,'child.log'),'utf8');console.log(log);
    assert.ok(log.includes('STALL '+event));assert.ok(log.includes('TERMINATION graceful'));assert.ok(log.includes('EXIT_STATUS=1'));
    const result=JSON.parse(fs.readFileSync(path.join(cancelledOut,'result.json')));
    assert.equal(result.ok,false);assert.match(result.failure,/SIGTERM/);
    assert.equal(result.cleanup.status,event==='auth:smoke'?'skipped':'complete');
    const ids=JSON.parse(fs.readFileSync(path.join(cancelledOut,'owned.json')));
    if(event==='game:action'){assert.equal(ids.accountIds.length,2);assert.equal(ids.gameIDs.length,1);}
    for(const c of ['games','accounts','lobbies']) assert.equal(await db.collection(c).countDocuments({smokeRun:cancelledRun}),0);
    for(const c of ['turns','gameRounds']) assert.equal(await db.collection(c).countDocuments({gameID:{$in:ids.gameIDs}}),0);
    assert.equal(await db.collection('sessions').countDocuments({accountId:{$in:ids.accountIds}}),0);
    assert.equal(await db.collection('accounts').countDocuments({accountId:'foreign-account'}),1);
    assert.equal(await db.collection('games').countDocuments({gameID:'foreign-game',marker:'preserve'}),1);
    console.log('PASS timeout '+event+' cleanup='+result.cleanup.status+' persisted owned IDs; residue empty; foreign records preserved; terminal EXIT_STATUS=1');
  }
  fs.writeFileSync(path.join(out,'lifecycle.json'),JSON.stringify(service.lifecycle,null,2));
 }finally{
  if(service) console.log('FIXTURE_CLEANUP '+JSON.stringify(await service.stop()));
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
