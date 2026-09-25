'use strict';
// Offline loader/factory diagnostic only. Never invoke returned operations.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const child = require('node:child_process');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, {recursive:false});
const started = Date.now(), stopAt = started + 120000;
const cases = ['direct-factory', 'production-loader-factory', 'scope', 'host', 'machine', 'missing-field',
    ...['config', 'privateKeyFile', 'credentialsFile', 'allowlistFile'].flatMap(k => ['mode', 'symlink', 'owner'].map(t => `${k}-${t}`)),
    'sentinel-and-no-side-effects'];
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
write('verification-plan.json', {cases, estimateMs:30000, stopAt, tier:'offline production-source loader/factory only',
    exclusions:['operations', 'prerequisite gate', 'services', 'systemd', 'packaging', 'staging', 'real supervisor success'],
    fullTaskPass:false, commands:[`${process.execPath} ${__filename} ${output}`, 'git diff --check (both repositories)']});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [__filename, ...['release_authenticated.js', 'release_production.js', 'release_operations.js', 'release_service_adapter.js'].map(n => path.join(__dirname,n))];
const sources = Object.fromEntries(sourceFiles.map(f => [f, hash(fs.readFileSync(f))]));
const rows = [];
const checkpoint = (id, expected, observed) => {
    assert(Date.now() < stopAt, 'diagnostic-deadline');
    assert.deepEqual(observed, expected, id);
    rows.push({id, expected, observed, pass:true});
    console.log(`PASS ${id}`);
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-loader-only-'));
let processAttempts = 0, captures = [], code = 1;
const originalChildren = {};
for (const key of ['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync']) {
    originalChildren[key] = child[key];
    child[key] = () => { processAttempts++; throw Error('forbidden-process-execution'); };
}
const previousConfig = process.env.RELEASE_TRUSTED_CONFIG;
let ops, adapter, originalOps, originalAdapter;
try {
    const auth = require('./release_authenticated');
    ops = require('./release_operations'); adapter = require('./release_service_adapter');
    originalOps = ops.createOperations; originalAdapter = adapter.createServiceAdapter;
    // Observe actual factory arguments while delegating unchanged to both real factories.
    ops.createOperations = args => { captures.push({kind:'operations', config:structuredClone(args.config)}); return originalOps(args); };
    adapter.createServiceAdapter = config => { captures.push({kind:'service', config:structuredClone(config)}); return originalAdapter(config); };
    const production = require('./release_production');
    const privateWrite = (name, bytes) => {const f=path.join(root,name); fs.writeFileSync(f,bytes,{mode:0o600}); return f;};
    const keys = crypto.generateKeyPairSync('ed25519');
    const base = {scope:'production', host:os.hostname(), machineId:fs.readFileSync('/etc/machine-id','utf8').trim(),
        publicKey:keys.publicKey.export({type:'spki',format:'pem'}),
        privateKeyFile:privateWrite('key.pem',keys.privateKey.export({type:'pkcs8',format:'pem'})),
        credentialsFile:privateWrite('credentials.json','[]'), allowlistFile:privateWrite('allowlist.json','[]'),
        rollbackRoots:{}, observationSha256:'a'.repeat(64), service:'offline-loader-fixture.service',
        helperRoot:path.join(root,'untrusted-helper'), observerArgv:['forbidden-observer', 'must-never-run']};
    for (const key of ['client','server','sources','runtime','dependencies','runtimeReceipt','observationFile']) {
        base[key] = privateWrite(key, 'offline fixture; never executed');
    }
    for (const role of ['client','server','runtime','web','config']) {
        const dir=path.join(root,'retained-'+role); fs.mkdirSync(dir); base.rollbackRoots[role]=dir;
    }
    const sentinel=privateWrite('sentinel','preserve exact bytes');
    const inventory = () => Object.fromEntries(fs.readdirSync(root).filter(n => n !== 'factory-output' && n !== 'trusted.json' && n !== 'link.json').sort().map(n => {
        const f=path.join(root,n), s=fs.lstatSync(f);
        return [n,{mode:s.mode,uid:s.uid,ino:s.ino,content:s.isFile()?hash(fs.readFileSync(f)):fs.readdirSync(f)}];
    }));
    const before=inventory(), sentinelHash=hash(fs.readFileSync(sentinel));
    const target=path.join(root,'factory-output'); fs.mkdirSync(target);
    const file=privateWrite('trusted.json',JSON.stringify(base));
    process.env.RELEASE_TRUSTED_CONFIG=file;
    const service=adapter.createServiceAdapter(base);
    const direct=ops.createOperations({config:base,...service,rehearseService:service.rehearse});
    const operationNames=['paired-runtime-package','current-rollback','guarded-dry-run','authenticated-smoke-inputs'];
    checkpoint('direct-factory', operationNames, Object.keys(direct));
    captures=[];
    const loaded=auth.loadProductionConfig();
    const prepared=production.prepare({outputDir:target,stopAt});
    const expected={...base}; delete expected.helperRoot;
    assert.deepEqual(loaded, expected); assert.deepEqual(prepared.config, expected);
    const effective={...expected, observerArgv:['python3',path.join(__dirname,'observe_release_host.py'),'--expected-host',base.host,
        '--service',base.service,'--roots-json',path.join(target,'host-roots.json'),'--stop-at-ms',String(stopAt)]};
    assert.deepEqual(captures,[{kind:'service',config:effective},{kind:'operations',config:effective}]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'host-roots.json'))),base.rollbackRoots);
    assert.deepEqual(Object.keys(prepared.operations),operationNames);
    checkpoint('production-loader-factory', {helperRootStripped:true,pinnedObserver:true,rootsBound:true,operations:operationNames},
        {helperRootStripped:!('helperRoot' in prepared.config),pinnedObserver:true,rootsBound:true,operations:Object.keys(prepared.operations)});
    write('factory-boundary.json',{diagnosticOnly:true,directOperationNames:Object.keys(direct),productionOperationNames:Object.keys(prepared.operations),
        observerArgv:effective.observerArgv,rollbackRoots:base.rollbackRoots,helperRootStripped:true,operationsInvoked:0});
    const reject = (id, marker, change, restore) => {
        fs.writeFileSync(file,JSON.stringify(base));
        change(); captures=[];
        let observed;
        try { production.prepare({outputDir:target,stopAt}); } catch(e) { observed=e.message.split('\n')[0]; }
        finally { restore?.(); }
        checkpoint(id,marker,observed);
        assert.deepEqual(captures,[],'rejection-before-factories');
        assert.deepEqual(fs.readdirSync(target),['host-roots.json']);
    };
    for (const [id,field,value,marker] of [['scope','scope','diagnostic','diagnostic-config-not-production'],['host','host',base.host+'-wrong','host-pin-mismatch'],
        ['machine','machineId','wrong','machine-pin-mismatch'],['missing-field','service',undefined,'missing-trusted-config-fields:service']]) {
        reject(id,marker,()=>fs.writeFileSync(file,JSON.stringify({...base,[field]:value})));
    }
    for (const key of ['config','privateKeyFile','credentialsFile','allowlistFile']) {
        const selected=key==='config'?file:base[key];
        reject(`${key}-mode`,'unsafe-private-input',()=>fs.chmodSync(selected,0o644),()=>fs.chmodSync(selected,0o600));
        const link=path.join(root,'link.json');
        reject(`${key}-symlink`,'unsafe-private-input',()=>{
            fs.symlinkSync(selected,link);
            if(key==='config')process.env.RELEASE_TRUSTED_CONFIG=link;
            else fs.writeFileSync(file,JSON.stringify({...base,[key]:link}));
        },()=>{process.env.RELEASE_TRUSTED_CONFIG=file;fs.unlinkSync(link);});
        // This workspace runs as root, permitting a real ownership negative control.
        assert.equal(process.getuid(),0,'ownership-control-requires-root');
        reject(`${key}-owner`,'unsafe-private-input',()=>fs.chownSync(selected,65534,fs.statSync(selected).gid),()=>fs.chownSync(selected,0,fs.statSync(selected).gid));
    }
    assert.deepEqual(inventory(),before,'fixture-inputs-unchanged');
    assert.deepEqual(fs.readdirSync(target),['host-roots.json']);
    checkpoint('sentinel-and-no-side-effects',{sentinel:sentinelHash,processAttempts:0,outputFiles:['host-roots.json']},
        {sentinel:hash(fs.readFileSync(sentinel)),processAttempts,outputFiles:fs.readdirSync(target)});
    assert.deepEqual(rows.map(r=>r.id),cases);
    for(const [file,digest] of Object.entries(sources))assert.equal(hash(fs.readFileSync(file)),digest,'source-drift');
    code=0;
} catch(e) { console.error(e.stack); }
finally {
    if(ops)ops.createOperations=originalOps;
    if(adapter)adapter.createServiceAdapter=originalAdapter;
    Object.assign(child,originalChildren);
    if(previousConfig===undefined)delete process.env.RELEASE_TRUSTED_CONFIG; else process.env.RELEASE_TRUSTED_CONFIG=previousConfig;
    fs.rmSync(root,{recursive:true,force:true});
    write('cleanup.json',{pass:!fs.existsSync(root),ownedTemporaryRootRemoved:!fs.existsSync(root),processAttempts});
    write('checkpoints.json',rows);
    write('source-identities.json',{sources,node:process.version});
    write('coverage-results.json',{diagnosticPass:code===0,fullTaskPass:false,releaseReady:false,cases:rows.map(r=>({id:r.id,pass:r.pass,proof:'checkpoints.json'}))});
    write('verification-budget.json',{startedMs:started,finishedMs:Date.now(),elapsedMs:Date.now()-started,stopAt,diagnosticPass:code===0,fullTaskPass:false,cleanup:!fs.existsSync(root)});
}
process.exitCode=code;
