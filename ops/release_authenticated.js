'use strict';
// Host-local trusted configuration and authenticated final evidence. Trust is
// supplied by the caller, never recovered from an evidence directory.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write=(root,n,v)=>fs.writeFileSync(path.join(root,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const read=(root,n)=>JSON.parse(fs.readFileSync(path.join(root,n)));
const REQUIRED=['host','machineId','publicKey','privateKeyFile','credentialsFile','allowlistFile','client','server','sources','runtime','dependencies','runtimeReceipt','rollbackRoots','observationFile','observationSha256','service'];
function privateFile(file) {
    assert(typeof file==='string'&&path.isAbsolute(file),'missing-private-input-path');
    const s=fs.lstatSync(file);
    assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'unsafe-private-input');
    return fs.readFileSync(file);
}
function loadProductionConfig(file=process.env.RELEASE_TRUSTED_CONFIG) {
    assert(file,'missing-trusted-config:RELEASE_TRUSTED_CONFIG; fields='+REQUIRED.join(','));
    const c=JSON.parse(privateFile(file));
    const missing=REQUIRED.filter(k=>c[k]===undefined||c[k]==='');
    assert(!missing.length,'missing-trusted-config-fields:'+missing.join(','));
    assert.equal(c.scope,'production','diagnostic-config-not-production');
    assert.equal(c.host,os.hostname(),'host-pin-mismatch');
    assert.equal(c.machineId,fs.readFileSync('/etc/machine-id','utf8').trim(),'machine-pin-mismatch');
    for(const k of ['privateKeyFile','credentialsFile','allowlistFile'])privateFile(c[k]);
    // Observe and retain on the same host that owns the installation paths.
    delete c.helperRoot;
    return c;
}
function proof(root,name){return {path:name,sha256:hash(path.join(root,name))};}
function bindingFor(root){const p=read(root,'candidate/paired-package.json');return {source:p.source_archive_sha256,runtime:p.runtime_archive_sha256,prerequisite:hash(path.join(root,'prerequisite.json'))};}
function finalize({outputDir,config,invocation,stopAt,serverDir}) {
    const h=path.join(serverDir,'tests/reliability/helpers');
    const binding=bindingFor(outputDir);
    const pair=read(outputDir,'candidate/paired-package.json'),prior=read(outputDir,'rollback/retained-installation.json');
    for(const [name,digest] of [['candidate/candidate.tar.gz',binding.source],['candidate/runtime-dependencies.tar.gz',binding.runtime],['rollback/prior-installation.tar.gz',prior.archive_sha256]])assert.equal(hash(path.join(outputDir,name)),digest,'archive-binding');
    write(outputDir,'final-package-input.json',{...pair,proofs:['candidate/candidate.tar.gz','candidate/runtime-dependencies.tar.gz','candidate/paired-package.json'].map(n=>proof(outputDir,n))});
    write(outputDir,'final-rollback-input.json',{...prior,proofs:['rollback/prior-installation.tar.gz','rollback/retained-installation.json'].map(n=>proof(outputDir,n))});
    const inputs=Object.fromEntries(Object.entries({package:'final-package-input.json',rollback:'final-rollback-input.json',prerequisite:'prerequisite.json',rehearsal:'service-rehearsal.json',smoke:'prepared-smoke-inputs.json'}).map(([k,n])=>[k,proof(outputDir,n)]));
    require(path.join(h,'release-final-construction')).constructFinalOutputs({outputDir,binding,inputs,stopAt});
    const files=['release-manifest.json','rollback-manifest.json','smoke-inputs.json','dry-run.log',...Object.values(inputs).map(p=>p.path),'host-provisioning.json','candidate/candidate.tar.gz','candidate/runtime-dependencies.tar.gz','rollback/prior-installation.tar.gz'];
    const observation=read(outputDir,'host-provisioning.json');
    assert.equal(observation.host,config.host,'host-observation-pin');
    assert.equal(observation.machineId,config.machineId,'machine-observation-pin');
    assert.equal(observation.observationSha256,config.observationSha256,'retained-host-observation-binding');
    assert.deepEqual(observation.binding,binding,'provisioning-binding');
    const payload={schema:1,scope:config.scope,invocation,outputDir:fs.realpathSync(outputDir),binding,host:config.host,machineId:config.machineId,
        issuedAt:Date.now(),expiresAt:Math.min(stopAt,observation.expiresAt),proofs:[...new Set(files)].map(n=>proof(outputDir,n))};
    assert(payload.issuedAt<payload.expiresAt,'expired-authentication');
    const bytes=JSON.stringify(payload);
    const signature=crypto.sign(null,Buffer.from(bytes),privateFile(config.privateKeyFile)).toString('base64');
    assert(crypto.verify(null,Buffer.from(bytes),config.publicKey,Buffer.from(signature,'base64')),'signer-public-pin-mismatch');
    write(outputDir,'authenticated-final.json',{payload:bytes,signature});
    return verify({outputDir,prerequisite:read(outputDir,'prerequisite.json'),config,invocation,stopAt,serverDir});
}
function verify({outputDir,prerequisite,config,invocation,stopAt,serverDir}) {
    assert(Date.now()<stopAt,'finalization-deadline');
    assert(prerequisite?.ready===true,'prerequisite-not-ready');
    assert(config&&invocation,'missing-authenticated-final-trust');
    const {auditProofs}=require(path.join(serverDir,'tests/reliability/helpers/release-continuation'));
    const envelope=read(outputDir,'authenticated-final.json');
    assert(crypto.verify(null,Buffer.from(envelope.payload),config.publicKey,Buffer.from(envelope.signature,'base64')),'invalid-final-signature');
    const p=JSON.parse(envelope.payload);
    assert.equal(p.scope,config.scope,'final-trust-scope');assert.equal(p.invocation,invocation,'copied-final-invocation');
    assert.equal(p.outputDir,fs.realpathSync(outputDir),'copied-final-directory');
    assert.equal(p.host,config.host,'final-host-pin');assert.equal(p.machineId,config.machineId,'final-machine-pin');
    assert(p.issuedAt<=Date.now()&&p.expiresAt>Date.now()&&p.expiresAt<=stopAt,'expired-final-authentication');
    auditProofs(outputDir,p.proofs);
    assert.deepEqual(read(outputDir,'prerequisite.json'),prerequisite,'current-prerequisite-binding');
    assert.deepEqual(bindingFor(outputDir),p.binding,'current-final-binding');
    if(config.scope==='production') assert.equal(hash(config.sources),read(outputDir,'candidate/paired-package.json').source_manifest_sha256,'current-source-receipt-binding');
    const {validateShape}=require(path.join(serverDir,'tests/reliability/helpers/release-final-output'));
    validateShape({outputDir,binding:p.binding});
    const obs=read(outputDir,'host-provisioning.json'),dry=read(outputDir,'service-rehearsal.json');
    assert.deepEqual(obs.binding,p.binding,'authenticated-provisioning-binding');
    assert.equal(obs.observationSha256,config.observationSha256,'current-host-observation');
    assert.equal(obs.sentinelPreserved,true,'sentinel-not-preserved');
    assert.deepEqual(dry.commands.map(c=>c.id),['candidate-start','candidate-health','rollback-start','rollback-health']);
    for(const arm of ['candidate','rollback']) {
        const row=obs.services[arm];
        assert.equal(row.runtime.node,'v20.20.2','required-node-runtime');
        assert(row.health.statusCode===200&&row.health.authorized===true&&row.health.engineHandshake===true,'failed-authenticated-health');
        assert.equal(row.health.peerFingerprint256,row.certificateFingerprint,'health-certificate-pin');
        assert(row.cleanup.processes.length>=2&&row.cleanup.processes.every(p=>!p.aliveAfter),'service-process-cleanup');
        assert(row.cleanup.directories.every(p=>!p.existsAfter),'service-directory-cleanup');
        assert.equal(row.authenticated.length,4,'missing-authenticated-identities');
        assert.deepEqual(row.authenticated.map(x=>x.userId).sort(),read(outputDir,'smoke-inputs.json').cases.flatMap(c=>c.userIds).sort(),'authenticated-identity-binding');
        assert(row.authenticated.every(x=>x.deniedAfterCleanup===true&&x.namespaceVerified===true),'smoke-authentication-failed');
    }
    return {pass:true,diagnosticPass:config.scope==='diagnostic',fullTaskPass:config.scope==='production',releaseReady:false,authenticated:true,binding:p.binding};
}
module.exports={REQUIRED,privateFile,loadProductionConfig,proof,bindingFor,finalize,verify,write,read};
