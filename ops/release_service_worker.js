'use strict';
// IPC-only owned service probe. No public endpoint or production database input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function main() {
 const c=JSON.parse(fs.readFileSync(process.argv[2]));
 assert(Date.now()<c.stopAt,'probe-deadline');
 // Shipped startup reads local cert files before the verified-TLS preload
 // replaces HTTPS options. Supply fresh private probe certificates, never copy
 // a production key into the archive or evidence.
 require('node:child_process').execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
  '-keyout',path.join(c.serverCwd,'mydomain.key'),'-out',path.join(c.serverCwd,'mydomain.crt')],{stdio:'ignore',timeout:Math.max(1,c.stopAt-Date.now())});
 fs.chmodSync(path.join(c.serverCwd,'mydomain.key'),0o600);
 const {launchServices}=require(path.join(c.helperRoot,'services'));
 const service=await launchServices({evidenceDir:c.outputDir,label:c.arm,serverCwd:c.serverCwd,
   bounds:{startupMs:Math.min(30000,c.stopAt-Date.now()),responseMs:10000}});
 process.send({runtime:service.lifecycle.runtime,endpoint:service.endpoint,ca:service.certificate.pem,certificateFingerprint:service.certificate.fingerprint256,
   databaseName:service.databaseName,mongoUri:service.mongoUri,health:service.https,
   processes:service.owned.processes.map(p=>p.record)});
 let requested=false;
 const stop=async()=>{if(requested)return;requested=true;const cleanup=await service.stop();process.send({cleanup});process.disconnect();};
 process.once('message',stop);process.once('disconnect',stop);
 setTimeout(stop,Math.max(1,c.stopAt-Date.now())).unref();
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;if(process.connected)process.disconnect();});
