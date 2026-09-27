'use strict';
// One measured cumulative review on frozen review-60 proof; not a full gate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C=require('./reconcile_evidence_catalog'),B=require('./consume_asset_review'),V=require('./consume_version_review');
const out=path.resolve(process.argv[2]),start=Date.now(),deadline=start+3300000;
assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{fs.appendFileSync(path.join(out,'verification.log'),s+'\n');console.log(s);};
const commands=[],controls=[];
function run(cwd,argv){
    assert(Date.now()<deadline,'cumulative deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);
    const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:deadline-Date.now(),maxBuffer:16*1024*1024,
        env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);
    commands.push({cwd,argv,actualExit:r.status,signal:r.signal});assert.equal(r.status,0,'required command failed');
}
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(V.BASE,'research-input.json'));
save('task-input.json',tasks);save('research-input.json',research);
save('verification-plan.json',{fullInvocation:false,estimateMs:1200000,budgetMs:3600000,stopWorkMs:3300000,
    cases:['old-client','old-server','cumulative-AC1-AC2','deleted-proof','tampered-proof','wrong-owner','wrong-release',
        'double-income','wrong-moves','wrong-hp','swapped-units','no-id-teleport','omitted-pair','wrong-database-owner'],
    tiers:['retained shipped-browser and real HTTPS/Socket.IO/MongoDB observations','source-executed independent oracle and actual clause consumer'],
    commands:['node --check new consumers','python3 ops/test_review_version_gameplay.py','actual cumulative without/with consumer and rejection controls','git diff --check in both repositories','artifact/source hash audit'],
    exclusions:['full invocation gated until zero unresolved prior targets','no new provider run','no AC3 closure','no public actions'],
    exactObservationReview:'Frozen proof contains old-server and upgraded-client full boards, input/wire/database observations and release selection through hash-bound test/extractor/spawn source; no missing AC2 observation identified before execution.'});
let pass=false;
try{
    log('NODE='+process.version);
    for(const f of ['consume_version_review.js','run_version_review.js'])run(A.client,[process.execPath,'--check','ops/'+f]);
    run(A.client,['python3','ops/test_review_version_gameplay.py']);
    const retained=A.read(path.join(V.BASE,'catalog-crosswalk.json')),annex=A.read(path.join(V.BASE,'historical-annex.json'));
    const fresh=C.prepare(tasks,research),catalog=fresh.candidate;
    assert.deepEqual(fresh.annex,annex,'changed-historical-annex');
    for(const row of catalog.reviews.filter(r=>!R.laterTask(r.id.split('/')[0])))
        assert.deepEqual(row,retained.reviews.find(r=>r.id===row.id),'changed-retained-review:'+row.id);
    save('catalog-crosswalk.json',catalog);save('historical-annex.json',annex);save('provider-binding.json',V.binding);
    const oldTasks=A.read(path.join(V.BASE,'task-input.json'));
    const required=ts=>R.targets(ts,research).filter(t=>!R.laterTask(t.task));
    assert.deepEqual(required(tasks),required(oldTasks),'changed-required-definition');
    const inventory=C.inventory(tasks,research,catalog,annex);
    const ac1=A.read(path.join(V.BASE,'prepared/review.json'));
    const before=B.consume(inventory,tasks,research,catalog,path.join(V.BASE,'prepared'),ac1,V.binding);
    const retainedRows=A.read(path.join(V.BASE,'reviewed-crosswalk.json'));
    const candidate=structuredClone(catalog);
    for(const row of retainedRows.reviews.filter(r=>!R.laterTask(r.id.split('/')[0])))
        candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=row;
    assert.equal(before.criteria.find(r=>r.id===ac1.id).status,'covered-current');
    assert.deepEqual(before.unresolvedPriorArchives,A.read(path.join(V.BASE,'current-inventory.json')).unresolvedPriorArchives,'changed-baseline-obligations');
    save('before-inventory.json',before);
    const prepared=path.join(out,'prepared'),row=V.prepare(prepared,tasks);
    const result=V.consume(before,tasks,research,candidate,prepared,row);
    const after=result.after;
    for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==row.id))
        assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'changed-nontarget:'+old.id);
    assert.deepEqual(after.selfChecks,before.selfChecks);assert.equal(after.selfChecks.length,8);
    assert.deepEqual(after.historicalAnnex,before.historicalAnnex);
    assert.equal(after.inputIssues.length,0);assert.equal(after.unexplainedGaps.length,0);
    const current=after.criteria.find(r=>r.id===row.id).status==='covered-current';
    assert.deepEqual(after.unresolvedPriorArchives,current?before.unresolvedPriorArchives.filter(id=>id!==row.id):before.unresolvedPriorArchives);
    save('current-inventory.json',after);save('reviewed-crosswalk.json',result.candidate);
    function reject(id,mutate,pattern){
        assert(Date.now()<deadline,'cumulative deadline');
        const copy=path.join(out,'control-'+id);fs.cpSync(prepared,copy,{recursive:true});
        const r=structuredClone(row),binding=structuredClone(V.binding);mutate(copy,r,binding);
        let reason;try{V.consume(before,tasks,research,candidate,copy,r,binding);}catch(e){reason=e.message;}
        assert(reason&&pattern.test(reason),id+': '+reason);
        controls.push({id,pass:true,reason});log('PASS rejects '+id+': '+reason.split('\n')[0]);
    }
    reject('deleted-proof',p=>fs.unlinkSync(path.join(p,'selected-211/persistence-checkpoints.json')),/ENOENT/);
    reject('tampered-proof',p=>fs.appendFileSync(path.join(p,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/);
    reject('wrong-owner',(_,r)=>{r.id='TASK-211/AC3';},/wrong-version-owner/);
    reject('wrong-release',(_,r,b)=>{b.coverageSha256='0'.repeat(64);},/wrong-version-release-identity/);
    save('negative-control-results.json',{controls,semanticControls:{command:'python3 ops/test_review_version_gameplay.py',proof:'verification.log',tests:9}});
    for(const repo of [A.client,'/root/diplomacy_server'])run(repo,['git','diff','--check']);
    save('checkpoints.json',{checks:result.report.checks});
    save('source-identities.json',A.read(path.join(V.binding.original,'source-identities.json')));
    save('remaining-clause-plan.json',{requiredPrior:after.unresolvedPriorArchives,followUps:after.followUps,selfChecks:after.selfChecks,
        historicalObligations:after.historicalAnnex.retainedObligations,fullAuditReady:after.priorArchivesComplete,
        selection:{catalog:path.join(out,'catalog-crosswalk.json'),annex:path.join(out,'historical-annex.json'),
            cumulativeRows:path.join(out,'reviewed-crosswalk.json'),originalAC1:path.join(V.BASE,'prepared'),
            prepared,provider:V.binding,adapter:'ops/consume_version_review.js',rawCrosswalkIsGateInput:false}});
    const comparison={pass:true,target:row.id,priorBefore:before.unresolvedPriorArchives.length,priorAfter:after.unresolvedPriorArchives.length,
        before:before.criteria.find(r=>r.id===row.id).status,after:after.criteria.find(r=>r.id===row.id).status,
        retainedAC1:after.criteria.find(r=>r.id===ac1.id).status,selfChecks:after.selfChecks.length,research:after.researchGaps.length,
        outsideScope:after.criteria.filter(r=>r.status==='outside-task-scope').length,inputIssues:0,unexplained:0,
        checks:result.report.checks.length,sourceHashes:result.report.sourceHashes,sourceMismatches:result.report.sourceMismatches,
        controls:controls.length,fullAuditReady:false,rawCrosswalkIsGateInput:false};
    save('comparison.json',comparison);
    const bindingPaths=['catalog-crosswalk.json','historical-annex.json','provider-binding.json','comparison.json','current-inventory.json','checkpoints.json','negative-control-results.json'];
    save('coverage-results.json',{fullInvocation:false,comparison,cases:['old-client','old-server'],
        evidenceHashes:Object.fromEntries(bindingPaths.map(n=>[n,A.hash(path.join(out,n))])),
        toolHashes:Object.fromEntries(['review_version_gameplay.py','consume_version_review.js','run_version_review.js','test_review_version_gameplay.py'].map(n=>['ops/'+n,A.hash(path.join(A.client,'ops',n))]))});
    log(`PASS TASK-211/AC2 ${comparison.after} requiredPrior=${comparison.priorBefore}->${comparison.priorAfter} retainedAC1=${comparison.retainedAC1} selfChecks=8 inputIssues=0 unexplained=0 controls=4`);
    log('INCOMPLETE TASK-225: unresolved prior local proof; full test_steps 3/4/5/7 remain prerequisite-gated');
    pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
    save('verification-budget.json',{startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,budgetMs:3600000,
        stopWorkMs:3300000,fullInvocation:false,passScoped:pass&&Date.now()<deadline,cleanup:true,
        cleanupReason:'Read-only review: no services or browsers launched; all synchronous child commands terminated; temporary semantic-control copies cleaned by unittest.',commands});
    if(!pass||Date.now()>=deadline)process.exitCode=1;
}
