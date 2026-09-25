'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,fork,execFileSync}=require('node:child_process');
const {privateFile,bindingFor,write,read,proof}=require('./release_authenticated');
function createServiceAdapter(config){
 let smoke;
 async function rehearse({outputDir,stopAt}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-service-')),extract=path.join(root,'bytes');
  const binding=bindingFor(outputDir),credentials=JSON.parse(privateFile(config.credentialsFile));
  const allowlist=JSON.parse(privateFile(config.allowlistFile));
  assert.equal(credentials.length,4,'four-private-smoke-identities');
  const ids=credentials.map(c=>crypto.createHash('sha256').update(c.password).digest('hex'));
  assert.equal(new Set(ids).size,4);
  for(const [i,c]of credentials.entries())assert(allowlist.some(e=>e.userId===ids[i]&&e.run===c.run&&e.expiresAt>stopAt),'smoke-allowlist-binding');
  const expiresAt=Math.min(...allowlist.filter(e=>ids.includes(e.userId)).map(e=>e.expiresAt));
  const log=path.join(outputDir,'service-execution.log'),commands=[],services={};
  const run=async(argv,cwd,env)=>new Promise((resolve,reject)=>{
   const child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:['ignore','pipe','pipe']});
   const timer=setTimeout(()=>child.kill('SIGKILL'),Math.max(1,stopAt-Date.now()));
   child.stdout.on('data',d=>fs.appendFileSync(log,d));child.stderr.on('data',d=>fs.appendFileSync(log,d));
   child.once('error',reject);child.once('close',(exit,signal)=>{clearTimeout(timer);resolve({exit,signal,argv,cwd});});
  });
  try{
   execFileSync('python3',[path.join(__dirname,'extract_release_probe.py'),outputDir,extract],{timeout:Math.max(1,stopAt-Date.now())});
   for(const arm of ['candidate','rollback']){
    assert(Date.now()<stopAt,'service-rehearsal-deadline');
    const base=path.join(extract,arm),serverCwd=path.join(base,arm==='candidate'?'diplomacy_server/server':'server/server');
    // Retained client and server roots keep their original relative layout.
    if(arm==='rollback')fs.symlinkSync('client',path.join(base,'diplomacy'));
    const runtime=path.join(base,'runtime/bin/node');
    const options={arm,outputDir,stopAt,serverCwd,helperRoot:config.helperRoot||path.join(config.server,'tests/reliability/helpers')};
    const optionsFile=path.join(root,arm+'.json');fs.writeFileSync(optionsFile,JSON.stringify(options),{mode:0o600});
    const env={...process.env,DIPLOMACY_SMOKE_ALLOWLIST:config.allowlistFile};
    const child=fork(path.join(__dirname,'release_service_worker.js'),[optionsFile],{execPath:runtime,env,silent:true});
    const start={id:arm+'-start',argv:[runtime,path.join(__dirname,'release_service_worker.js'),optionsFile],cwd:process.cwd()};
    child.stdout.on('data',d=>fs.appendFileSync(log,d));child.stderr.on('data',d=>fs.appendFileSync(log,d));
    let cleanup,ready,timer;
    const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exit,signal)=>resolve({exit,signal}));});
    const first=new Promise((resolve,reject)=>{child.on('message',m=>{if(m.cleanup)cleanup=m.cleanup;else{ready=m;resolve(m);}});child.once('exit',()=>reject(Error('service-exited-before-ready')));});
    timer=setTimeout(()=>child.kill('SIGTERM'),Math.max(1,stopAt-Date.now()));
    let healthResult;
    try{
     await first;
     const resultFile=path.join(root,arm+'-health.json');
     const hc={...options,...ready,resultFile,credentialsFile:config.credentialsFile};
     const healthFile=path.join(root,arm+'-health-options.json');fs.writeFileSync(healthFile,JSON.stringify(hc),{mode:0o600});
     healthResult=await run([runtime,path.join(__dirname,'release_service_health.js'),healthFile],serverCwd,env);
     assert.equal(healthResult.exit,0,'service-health-command-failed');
     services[arm]={...read(root,arm+'-health.json'),certificateFingerprint:ready.certificateFingerprint,runtime:ready.runtime,processes:ready.processes};
    }finally{
     if(child.connected)child.send({stop:true});
     const end=await exited;clearTimeout(timer);Object.assign(start,end);commands.push(start);
     if(healthResult)commands.push({id:arm+'-health',...healthResult});
     assert.equal(end.exit,0,'service-start-command-failed');assert(cleanup&&cleanup.processes.every(p=>!p.aliveAfter),'owned-service-cleanup');
     if(services[arm])services[arm].cleanup=cleanup;
    }
   }
   for(const c of commands){assert.equal(c.exit,0);fs.appendFileSync(log,`COMMAND ${JSON.stringify(c.argv)} CWD=${c.cwd}\nPASS ${c.id} ACTUAL_EXIT=${c.exit}\n`);}
   const observation={host:os.hostname(),machineId:fs.readFileSync('/etc/machine-id','utf8').trim(),observationSha256:config.observationSha256,binding,expiresAt,services,sentinelPreserved:Object.values(services).every(s=>s.sentinelPreserved)};
   write(outputDir,'host-provisioning.json',observation);
   write(outputDir,'service-rehearsal.json',{kind:'executable-service-health',diagnosticOnly:false,binding,cleanup:true,exit:0,commands,log:proof(outputDir,'service-execution.log')});
   smoke={binding:{source:binding.source,runtime:binding.runtime},expiresAt,issuer:{id:config.host,verified:true},cleanupEvent:'cleanupSmokeRun',
    cases:['competitive','coop'].map((mode,i)=>({mode,seed:1,map:'Tiny',userIds:ids.slice(i*2,i*2+2),run:credentials[i*2].run,milestones:['legal-move','one-round','reconnect']}))};
   // verified is set only after HTTPS/password admission, persisted namespace,
   // revocation, scoped cleanup and process cleanup have all been observed.
   return ['service-rehearsal.json','host-provisioning.json','service-execution.log'];
  }finally{
   fs.rmSync(root,{recursive:true,force:true});
   const redact=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())redact(f);else if(/\.(log|jsonl)$/.test(e.name)){let t=fs.readFileSync(f,'utf8');for(const c of credentials)t=t.split(c.password).join('[REDACTED]');fs.writeFileSync(f,t);}}};
   redact(outputDir);
  }
 }
 return {rehearse,issueSmoke:async()=>{assert(smoke,'service-provisioning-required');return smoke;},validateSmoke:async value=>assert.deepEqual(value,smoke,'observed-smoke-provenance')};
}
module.exports={createServiceAdapter};
