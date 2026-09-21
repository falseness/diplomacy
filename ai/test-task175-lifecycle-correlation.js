#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),serverRoot=path.resolve(root,'../diplomacy_server');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const outputArg=option('--output-dir');assert(outputArg,'--output-dir required');const output=path.resolve(outputArg);
const bundlePath=path.join(root,'artifacts/TASK-175/transport-20260921/socket.io-3.0.0.js');
const historical=path.join(root,'artifacts/TASK-175/final-after-discovery-20260921T024003Z');
const pinned={client:'a9f291c2049278491ea2745ed8bc61679577b980',server:'22c7f9c7a37cdb4288185d702b2562806b56b084',bundle:'e3ea5880b996b7c89a9475540bbc0dbc0ab556beac6f42b6d8ec727218f2d51a'};
const scoped=['ai/test-task175-lifecycle-correlation.js',...['recorder','hooks','preload','harness','offline','classify'].map(n=>'ai/diagnostics/task175/lifecycle-v2-'+n+'.js')];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f));
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const ORDER=['H10-OFF','H10-ON','H12-ON','H12-OFF','H12-OFF','H12-ON','H10-ON','H10-OFF'];
function baseline() {
    const saved=read(path.join(historical,'source-identities.json')),deps=read(path.join(historical,'setup/dependency-identities.json'));
    const comparison=[];
    for(const [role,dir] of [['client',root],['server',serverRoot]]) {
        assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim(),pinned[role],'pinned '+role+' base');
        for(const [file,hash] of Object.entries(saved.after[role].files)) {
            assert.equal(sha(fs.readFileSync(path.join(dir,file))),hash,'baseline source '+file);
        }
        comparison.push({role,matched:Object.keys(saved.after[role].files).length,head:pinned[role]});
    }
    for(const [file,hash] of Object.entries(deps))assert.equal(sha(fs.readFileSync(file)),hash,'dependency '+file);
    const scopedHashes=Object.fromEntries(scoped.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
    save('source-identities.json',{pinned,comparison,scoped:scopedHashes,historicalSnapshotSha256:sha(fs.readFileSync(path.join(historical,'source-identities.json'))),historical:saved});
    save('dependency-identities.json',deps);
    save('source-comparison-snapshot.json',read(path.join(root,'artifacts/TASK-175/diagnosis-lifecycle-review/source-comparison.json')));
    console.log('PINNED_BASELINE_PASS '+JSON.stringify({comparison,dependencies:Object.keys(deps).length,scoped:scoped.length}));
    return scopedHashes;
}
async function sample() {
    fs.mkdirSync(output);
    const enabled=option('--record')==='ON', humans=Number(option('--humans'));
    assert([10,12].includes(humans));const secret=crypto.randomBytes(32).toString('hex');
    process.env.TASK175_RECORD=enabled?'1':'0';process.env.TASK175_SECRET=secret;process.env.TASK175_FLUSH=path.join(output,'lifecycle-server.json');
    const harness=require('./diagnostics/task175/lifecycle-v2-harness').install({serverRoot,bundle:fs.readFileSync(bundlePath,'utf8'),secret,enabled,output});
    save('hook-manifest.json',{enabled,client:harness.manifest});
    try {
        const {runJoinRaces}=require(path.join(serverRoot,'tests/reliability/helpers/join-races-game'));
        const {report}=await runJoinRaces({evidenceDir:output,repetitions:1,caseIds:['coop-'+humans],diagnostic:{arm:'A',observers:false,priority:JSON.parse(option('--priority'))}});
        console.log(`LIFECYCLE_V2_ORIGINAL_CHECKS humans=${humans} record=${enabled} passed=${report.passed} failed=${report.failed}`);
        process.exitCode=report.failed?1:0;
    }finally{save('harness-originals.json',harness.originals);harness.restore();delete process.env.TASK175_SECRET;}
}
function inspect(dir, enabled, humans) {
    const get=f=>read(path.join(dir,f)),checks=get('checkpoints.json'),attempt=get('attempt-manifest.json'),ids=get('source-identities.json');
    assert(checks.checkpoints.length>0);assert.equal(checks.passed+checks.failed,checks.checkpoints.length);
    assert.equal(attempt.attempts.length,1);assert.equal(attempt.attempts[0].executions,1);assert.equal(ids.stale.length,0);
    for(const phase of ['before-wave','after-wave'])assert.equal(get(`repetitions/coop-${humans}-01/priority-${phase}.json`).valid,true);
    const bundles=get('bundle-identities.json');assert.equal(bundles.deliveryErrors,0);assert.equal(bundles.pendingReads,0);
    assert.equal(bundles.original,pinned.bundle);assert.equal(bundles.delivered.length,humans+1);
    for(const b of bundles.delivered){assert.equal(b.status,200);assert.equal(b.delivered,enabled?bundles.transformed:pinned.bundle);}
    let gaps=[],classification=null;
    if(enabled) {
        const clients=get('lifecycle-client.json'),server=get('lifecycle-server.json'),network=get('network.json');
        const {validate}=require('./diagnostics/task175/lifecycle-v2-recorder'),hooks=require('./diagnostics/task175/lifecycle-v2-hooks');
        if(clients.length!==humans+1)gaps.push('client flush count');
        for(const c of clients)gaps.push(...validate(c,hooks.expectedClient).map(g=>c.name+':'+g));
        gaps.push(...validate(server,hooks.expectedServer),...validate(network,['network-request','network-frame']));
        classification=require('./diagnostics/task175/lifecycle-v2-classify')(clients,network,server);gaps.push(...classification.gaps);
        fs.writeFileSync(path.join(dir,'occurrence-links.json'),JSON.stringify(classification,null,2)+'\n',{flag:'wx'});
    }
    return {passed:checks.passed,failed:checks.failed,failedChecks:checks.checkpoints.filter(c=>!c.pass).map(c=>c.id),captureValid:!gaps.length,gaps,classification:classification?.links.map(l=>({page:l.page,emit:l.emit,classification:l.classification}))};
}
async function main() {
    assert(!process.env.NODE_OPTIONS,'requires empty NODE_OPTIONS');assert.equal(sha(fs.readFileSync(bundlePath)),pinned.bundle);
    if(process.argv.includes('--sample'))return sample();
    assert(process.argv.includes('--offline')!==process.argv.includes('--live'),'choose --offline or --live');fs.mkdirSync(output);
    const scopedHashes=baseline();const bundle=fs.readFileSync(bundlePath,'utf8');
    save('runtime.json',{node:process.version,cwd:process.cwd(),playwright:require('playwright/package.json').version,browser:process.argv.includes('--offline')?'not run (pure fixtures)':'actual Chromium; version in child evidence'});
    if(process.argv.includes('--offline'))return require('./diagnostics/task175/lifecycle-v2-offline')({output,bundle,serverRoot,save});
    assert.equal(option('--plan'),'h10-h12-eight');
    const offlineDir=path.join(path.dirname(output),'offline');assert.equal(read(path.join(offlineDir,'checkpoints.json')).failed,0,'offline contract passed');
    assert.deepEqual(read(path.join(offlineDir,'source-identities.json')).scoped,scopedHashes,'same offline-tested sources');
    const resource=require(path.join(serverRoot,'tests/reliability/helpers/browser-priority')).feasibility();
    const priority={arm:'C',allowed:resource.allowed,baselineNice:resource.baselineNice};
    const cases=require(path.join(serverRoot,'tests/reliability/helpers/join-races')).CASES;
    save('predeclaration.json',{pinned,order:ORDER,scopedHashes,priority,resource,identities:ORDER.map((wave,index)=>({wave,index:index+1,caseId:'coop-'+wave.slice(1).split('-')[0],declaration:cases.find(c=>c.id==='coop-'+wave.slice(1).split('-')[0])})),
        setup:'Fresh owned HTTPS/MongoDB per once-only child; natural games, no initial board fixture; shipped UI barrier actions. A routing/1000ms hold; native priority/full allowed affinity; empty NODE_OPTIONS; original flags, deadlines, oracle, batching and strict discovery unchanged.',
        fulfillment:'Both OFF and ON fulfill the pinned original Socket.IO CDN bundle locally. ON alone adds declared source-body instrumentation. This shared difference from the standard full runner does not test CDN availability.',
        stopping:'At most eight waves in declared order, no replacements. Invalid setup/capture stops. Original race failures do not stop valid captures. No failed ON wave => INCONCLUSIVE. Full acceptance remains pending; no production repair or full gate.'});
    const outcomes=[];let invalid=false;
    for(const [index,wave] of ORDER.entries()) {
        const [h,arm]=wave.split('-'),humans=Number(h.slice(1)),dir=path.join(output,`${index+1}-${wave}`);
        const args=[__filename,'--sample','--output-dir',dir,'--humans',String(humans),'--record',arm,'--priority',JSON.stringify(priority)];
        const logFile=path.join(output,`${index+1}-${wave}.log`),fd=fs.openSync(logFile,'wx');
        fs.writeSync(fd,`cwd=${root}\nCOMMAND=${JSON.stringify([process.execPath,...args])}\nNODE_OPTIONS=\nNODE_PATH=${process.env.NODE_PATH}\n`);fs.fsyncSync(fd);
        console.log('LIFECYCLE_V2_WAVE_START '+wave+' '+(index+1)+'/8');
        const child=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:['ignore',fd,fd]});
        fs.writeSync(fd,`\nACTUAL_CHILD_EXIT=${child.status} SIGNAL=${child.signal}\n`);fs.fsyncSync(fd);fs.closeSync(fd);
        const item={index:index+1,wave,actualChildExit:child.status,signal:child.signal};
        try{Object.assign(item,inspect(dir,arm==='ON',humans));assert.equal(child.status,item.failed?1:0,'original assertion exit');if(!item.captureValid)invalid=true;}
        catch(e){item.captureValid=false;item.gaps=[e.message];invalid=true;}
        outcomes.push(item);save(`outcome-${index+1}.json`,item);console.log('LIFECYCLE_V2_WAVE_RESULT '+JSON.stringify(item));
        if(invalid)break;
    }
    for(const [file,hash] of Object.entries(scopedHashes))assert.equal(sha(fs.readFileSync(path.join(root,file))),hash,'scoped source unchanged '+file);
    const failedOn=outcomes.filter(o=>o.wave.endsWith('-ON')&&o.failed>0);
    const result=invalid?'CAPTURE_INCOMPLETE':failedOn.length?'OBSERVED_LIFECYCLE':'INCONCLUSIVE';
    save('outcomes.json',{result,planned:ORDER.length,executed:outcomes.length,unexecuted:ORDER.slice(outcomes.length),diagnosticConsumed:true,acceptance:'pending',outcomes});
    const next=invalid?'Resolve the explicitly recorded capture gaps with isolated offline fixtures before requesting a new finite live contract; do not replace or rerun these waves.':failedOn.length?'Use the exact recorded failed-ON occurrence chains to scope an isolated lifecycle hypothesis test; no production repair or full gate is yet justified.':'No failed ON wave reproduced. Preserve this consumed batch and require a new evidence-based experiment or independently justified repair before any further network batch or full gate.';
    fs.writeFileSync(path.join(output,'interpretation.md'),`${result}\n\nExecuted ${outcomes.length}/8 once-only waves. Original connection assertions and actual child exits are retained in outcomes.json. Diagnostic validity is separate from gameplay.\n\n${next}\n\nNo host/CDN causality or production repair is established. No 70/70 acceptance claim.\n`,{flag:'wx'});
    console.log('LIFECYCLE_V2_RESULT '+result+' executed='+outcomes.length+'/8');process.exitCode=invalid?2:0;
}
main().catch(e=>{console.error(e.stack);process.exitCode=2;});
