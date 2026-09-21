#!/usr/bin/env node
'use strict';
// Once-only callback provenance diagnostic. Never a repair or a gate runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),serverRoot=path.resolve(root,'../diplomacy_server');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const output=path.resolve(option('--output-dir'));
const bundlePath=path.resolve(option('--bundle')||path.join(root,'artifacts/TASK-175/transport-20260921/socket.io-3.0.0.js'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const expectedHeads={client:'ef526669f3c14ab4412d502975f570690c7514d2',server:'90a1176d871c0c87f51d481f7e55dec5cfa6170e'};
function dependencies(){const entries={};const seen=new Set();function walk(file){file=fs.realpathSync(file);if(seen.has(file))return;seen.add(file);const st=fs.statSync(file);if(st.isDirectory()){for(const e of fs.readdirSync(file))walk(path.join(file,e));}else if(/\.(js|json|node)$/.test(file))entries[file]=sha(fs.readFileSync(file));}walk(path.join(serverRoot,'server/node_modules'));walk('/opt/diplomacy/node_modules/playwright');walk('/opt/diplomacy/node_modules/playwright-core');walk('/usr/share/nodejs/esprima');return entries;}
async function sample(){
    const enabled=option('--record')==='ON';fs.mkdirSync(output);
    const secret=crypto.randomBytes(32).toString('hex');
    process.env.TASK175_RECORD=enabled?'1':'0';process.env.TASK175_SECRET=secret;process.env.TASK175_FLUSH=path.join(output,'callbacks-server.json');
    const harness=require('./diagnostics/task175/harness').install({serverRoot,bundle:fs.readFileSync(bundlePath,'utf8'),secret,enabled,output});
    save('hook-manifest.json',{enabled,client:harness.manifest,scope:'source body entry/finally exit; opening/acceptance event invocation separately labeled; network observer is not callback execution'});
    try{
        const {runJoinRaces}=require(path.join(serverRoot,'tests/reliability/helpers/join-races-game'));
        const {report}=await runJoinRaces({evidenceDir:output,repetitions:1,caseIds:['coop-12'],diagnostic:{arm:'A',observers:false,priority:JSON.parse(option('--priority'))}});
        console.log(`CORRELATION_SAMPLE ${enabled?'ON':'OFF'} passed=${report.passed} failed=${report.failed}`);process.exitCode=report.failed?1:0;
    }finally{save('harness-originals.json',harness.originals);harness.restore();delete process.env.TASK175_SECRET;}
}
function inspect(dir,enabled){
    const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f)));
    const checks=read('checkpoints.json'),manifest=read('attempt-manifest.json'),ids=read('source-identities.json');
    assert.equal(checks.passed+checks.failed,34);assert.equal(manifest.attempts.length,1);assert.equal(manifest.attempts[0].executions,1);assert.equal(ids.stale.length,0);
    for(const phase of ['before-wave','after-wave'])assert.equal(read('repetitions/coop-12-01/priority-'+phase+'.json').valid,true);
    const missing=[];
    if(enabled){
        let clients=[],server,net;
        try{clients=read('callbacks-client.json');server=read('callbacks-server.json');net=read('network.json');}catch{missing.push('missing flush');}
        if(clients.length!==13)missing.push('not thirteen client flushes');
        for(const trace of [...clients,server,net].filter(Boolean)){
            if(!trace.complete||trace.overflow||trace.errors)missing.push('incomplete/overflow/error '+trace.domain);
            if(trace.pendingReads)missing.push('unfinished response reads '+trace.pendingReads);
            const entered=new Set();for(const row of trace.rows||[]){if(row.kind.endsWith('-entry'))entered.add(row.call);if(row.kind.endsWith('-exit'))entered.delete(row.call);}
            if(entered.size)missing.push('unmatched callback entries '+trace.domain+':'+entered.size);
        }
        for(const c of clients)if(!(c.rows||[]).some(r=>r.hook==='handshake'))missing.push('no handshake '+c.name);
        const installed=server?.installed||[];for(const hook of ['server-upgrade-packet','server-probe-close','server-upgrade-timeout','server-close','join-receipt','join-queued','join-game-queued','opening-emission','server-upgrade-accepted'])if(!installed.includes(hook))missing.push('missing server hook '+hook);
    }else{for(const f of ['callbacks-client.json','callbacks-server.json','network.json'])assert(!fs.existsSync(path.join(dir,f)),'OFF recording absent');}
    return {failedChecks:checks.checkpoints.filter(c=>!c.pass).map(c=>c.id),passed:checks.passed,failed:checks.failed,missing,provenanceComplete:enabled && !missing.length};
}
async function main(){
    assert(!process.env.NODE_OPTIONS,'requires empty NODE_OPTIONS');
    assert.equal(sha(fs.readFileSync(bundlePath)),'e3ea5880b996b7c89a9475540bbc0dbc0ab556beac6f42b6d8ec727218f2d51a','pinned CDN bytes');
    if(process.argv.includes('--sample'))return sample();
    fs.mkdirSync(output);
    const {sourceSnapshot}=require(path.join(serverRoot,'tests/reliability/helpers/browser-game'));
    const before=sourceSnapshot(),dep=dependencies();
    for(const [role,dir] of [['client',root],['server',serverRoot]])assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim(),expectedHeads[role]);
    const resource=require(path.join(serverRoot,'tests/reliability/helpers/browser-priority')).feasibility();
    const priority={arm:'C',allowed:resource.allowed,baselineNice:resource.baselineNice};
    const order=['OFF','ON','ON','OFF'];
    save('predeclaration.json',{createdAt:new Date().toISOString(),order,expectedHeads,before,dependencies:dep,cdn:{file:bundlePath,sha256:sha(fs.readFileSync(bundlePath))},resource,priority,
        unchanged:'13 independent contexts; one UI wave; all original 34 checks; A routing; 1000ms hold; native priority; ordinary observers OFF; empty NODE_OPTIONS; unchanged fixtures, flags and deadlines. No retries, additional network traffic, timer replacement or periodic probes. Pinned CDN routing is identical setup in both arms.',
        treatment:'ON only: source-body synchronous recorder, exact request/WebSocket network labels, post-wave flush; no zero-overhead claim',
        stoppingRule:'Exactly four waves, no repeat. No failed instrumented wave or incomplete provenance => INCONCLUSIVE. Final gate forbidden without supported repair and separate both-ordering recording-OFF comparison.'});
    save('dependency-identities.json',dep);
    const outcomes=[];
    for(const [i,arm] of order.entries()){
        const dir=path.join(output,`${i+1}-${arm}`),args=[__filename,'--sample','--output-dir',dir,'--bundle',bundlePath,'--record',arm,'--priority',JSON.stringify(priority)];
        const fd=fs.openSync(path.join(output,`${i+1}-${arm}.log`),'wx');fs.writeSync(fd,`cwd=${root}\ncommand=${JSON.stringify([process.execPath,...args])}\nNODE_OPTIONS=\nNODE_PATH=${process.env.NODE_PATH}\n`);
        const child=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:['ignore',fd,fd]});
        fs.writeSync(fd,`\nACTUAL_CHILD_EXIT=${child.status} SIGNAL=${child.signal}\n`);fs.closeSync(fd);
        if(fs.existsSync(dir))fs.copyFileSync(path.join(output,`${i+1}-${arm}.log`),path.join(dir,'verification.log'));
        const item={index:i+1,arm,actualExit:child.status,signal:child.signal};
        try{Object.assign(item,inspect(dir,arm==='ON'));assert.equal(child.status,item.failed?1:0);const ids=JSON.parse(fs.readFileSync(path.join(dir,'source-identities.json')));for(const phase of ['before','after'])for(const role of ['client','server'])assert.deepEqual(ids[phase][role].files,before[role].files);item.valid=true;}catch(e){item.valid=false;item.auditError=e.message;}
        outcomes.push(item);save(`outcome-${i+1}.json`,item);console.log('CORRELATION_CHILD '+JSON.stringify(item));
    }
    const after=sourceSnapshot();for(const role of ['client','server'])assert.deepEqual(after[role].files,before[role].files);assert.deepEqual(dependencies(),dep);
    save('source-identities.json',{before,after,stale:[],dependencyCount:Object.keys(dep).length});
    save('outcomes.json',outcomes);
    // Attribution is intentionally conservative. Human review must connect exact
    // sessions and callback sequences, never cross-process wall-clock proximity.
    const failedOn=outcomes.filter(x=>x.arm==='ON'&&x.actualExit===1);
    const decision={result:'INCONCLUSIVE',fullGateAllowed:false,failedInstrumented:failedOn.length,
        missing:failedOn.length?failedOn.flatMap(x=>x.missing||['invalid wave evidence']):['No failed instrumented wave; failure mechanism has not been observed with callbacks'],
        classification:'unknown',observationEffects:'Four samples cannot establish zero overhead or a reliable difference in failure rate.',
        nextAction:'Review this completed experiment, not another batch. A repair needs a supported failed-session mechanism, independent proof and a new pinned recording-OFF comparison in both orderings before the 70/70 gate.'};
    save('decision.json',decision);console.log('CORRELATION_DIAGNOSTIC_INCONCLUSIVE waves=4 failedInstrumented='+failedOn.length);
    process.exitCode=1; // diagnostic inconclusive is never a positive gate exit
}
main().catch(e=>{console.error(e);process.exitCode=1;});
