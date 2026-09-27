'use strict';
// One bounded provider refresh and actual current-clause consumption. Not the full gate.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C = require('./reconcile_evidence_catalog'), S = require('./continue_scoped_review');
const B = require('./consume_asset_review');
const out = path.resolve(process.argv[2]), start = Date.now(), stop = start + 3300000;
assert(!fs.existsSync(out), 'fresh output required'); fs.mkdirSync(out,{recursive:true});
const save = (name, value) => fs.writeFileSync(path.join(out,name), JSON.stringify(value,null,2)+'\n');
const log = line => {fs.appendFileSync(path.join(out,'verification.log'),line+'\n'); console.log(line);};
const commands = [], controls = [];
function run(cwd, argv) {
    assert(Date.now()<stop, 'cumulative stop-work deadline');
    log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);
    const result = spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',maxBuffer:32*1024*1024,
        timeout:stop-Date.now(),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    log(result.stdout || ''); log(result.stderr || ''); log('ACTUAL_EXIT='+result.status+' SIGNAL='+result.signal);
    commands.push({cwd,argv,actualExit:result.status,signal:result.signal});
    assert.equal(result.status,0,'required command failed');
}
const tasks = A.read(path.join(A.client,'artifacts/tasks.json'));
const research = A.read(path.join(A.client,'artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json'));
save('task-input.json',tasks); save('research-input.json',research);
const node = process.execPath, provider = path.join(out,'provider');
save('verification-plan.json',{fullInvocation:false,estimateMs:1500000,budgetMs:3600000,stopWorkMs:3300000,
    cases:['cold-warm-delay','failed-recovery','old-client','old-server','current-AC1-consumption',
        'deleted-proof','tampered-proof','wrong-owner','wrong-manifest','escaped-provider'],
    tiers:['real HTTPS/Socket.IO/MongoDB and shipped browser','source-executed independent clause consumer'],
    commands:['syntax and retained oracle preflight','bounded assets-versions provider','prepare and consume AC1',
        'five consumer rejection controls','paired git diff --check','source and evidence audit'],
    reason:'review-53 established complete historical AC1 ownership; final reader and consumer now accept a hash-bound explicitly selected fresh provider.',
    exclusions:['no full TASK-225 audit while other required local targets remain','no AC2/AC3 closure','no public actions']});
let pass = false, cleanup = false;
try {
    log('NODE='+process.version);
    for (const file of ['consume_asset_review.js','refresh_asset_review.js']) run(A.client,[node,'--check','ops/'+file]);
    run(A.client,['python3','-c',"import ast; ast.parse(open('ops/prepare_asset_review.py').read())"]);
    const selected = S.select(tasks,research);
    save('catalog-crosswalk.json',selected.candidate); save('historical-annex.json',selected.annex);
    const before = C.inventory(tasks,research,selected.candidate,selected.annex);
    save('before-inventory.json',before);
    assert.equal(before.inputIssues.length,0); assert.equal(before.unexplainedGaps.length,0);
    // Cheap retained oracle check verifies the parameterized consumer did not alter prior semantics.
    const retained = path.join(A.client,'artifacts/TASK-225/review-53/prepared');
    B.inspect(tasks,retained); log('PASS retained hash-bound AC1 oracle');
    run('/root/diplomacy_server',[node,'tests/reliability/run.js','--suite','assets-versions','--output-dir',provider]);
    const budget = A.read(path.join(provider,'verification-budget.json'));
    assert.equal(budget.pass,true); assert.equal(budget.cleanup,true); cleanup=true;
    const binding = {original:provider,coverageSha256:A.hash(path.join(provider,'coverage-results.json'))};
    save('provider-binding.json',binding);
    const prepared = path.join(out,'prepared');
    run(A.client,['python3','ops/prepare_asset_review.py',prepared,path.join(out,'task-input.json'),
        '--archive',provider,'--manifest-sha256',binding.coverageSha256]);
    const row = A.read(path.join(prepared,'review.json'));
    const after = B.consume(before,tasks,research,selected.candidate,prepared,row,binding);
    save('current-inventory.json',after);
    assert.equal(after.criteria.find(r=>r.id===row.id).status,'covered-current');
    for (const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==row.id))
        assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'changed-nontarget:'+old.id);
    assert.deepEqual(after.selfChecks,before.selfChecks);
    assert.equal(after.inputIssues.length,0); assert.equal(after.unexplainedGaps.length,0);
    assert.deepEqual(after.unresolvedPriorArchives,before.unresolvedPriorArchives.filter(id=>id!==row.id));
    const candidate=structuredClone(selected.candidate);
    candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=row;
    save('reviewed-crosswalk.json',candidate);
    function reject(id,mutate,pattern) {
        assert(Date.now()<stop,'cumulative control deadline');
        const copy=path.join(out,'control-'+id);fs.cpSync(prepared,copy,{recursive:true});
        const changed=structuredClone(row), bound=structuredClone(binding);mutate(copy,changed,bound);
        let reason;try{B.consume(before,tasks,research,selected.candidate,copy,changed,bound);}catch(e){reason=e.message;}
        assert(reason && pattern.test(reason),id+': '+reason);
        controls.push({id,pass:true,reason}); log('PASS rejects '+id+': '+reason.split('\n')[0]);
    }
    reject('deleted-proof',p=>fs.unlinkSync(path.join(p,'selected-211/asset-requests.jsonl')),/ENOENT/);
    reject('tampered-proof',p=>fs.appendFileSync(path.join(p,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/);
    reject('wrong-owner',(_,r)=>{r.clauses[0].runTask='TASK-212';},/wrong-asset-run-owner/);
    reject('wrong-manifest',(_,r,b)=>{b.coverageSha256='0'.repeat(64);},/wrong-asset-coverage/);
    reject('escaped-provider',(_,r,b)=>{b.original='/tmp';},/escaped-asset-provider/);
    save('negative-control-results.json',controls);
    for (const repo of [A.client,'/root/diplomacy_server']) run(repo,['git','diff','--check']);
    const inspected=B.inspect(tasks,prepared,binding); assert.equal(inspected.run.currentSourceValid,true);
    save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
    save('checkpoints.json',{checks:inspected.report.checks});
    const comparison={pass:true,target:row.id,before:before.criteria.find(r=>r.id===row.id).status,
        after:'covered-current',currentCoverageAdded:1,priorBefore:before.unresolvedPriorArchives.length,
        priorAfter:after.unresolvedPriorArchives.length,inputIssues:0,unexplained:0,selfChecks:after.selfChecks.length,
        controls:controls.length,fullAuditReady:false,rawCrosswalkIsGateInput:false};
    save('comparison.json',comparison);
    save('coverage-results.json',{fullInvocation:false,cases:controls,comparison,provider:binding,
        evidenceHashes:Object.fromEntries(['provider-binding.json','current-inventory.json','comparison.json','checkpoints.json',
            'source-identities.json','negative-control-results.json'].map(n=>[n,A.hash(path.join(out,n))]))});
    log(`PASS TASK-211/AC1 covered-current requiredPrior=${comparison.priorBefore}->${comparison.priorAfter} selfChecks=8 inputIssues=0 unexplained=0 controls=5`);
    log('INCOMPLETE TASK-225 full audit: remaining required local proof and current invocation self checks');
    pass=true;
} catch(e) {log(e.stack);process.exitCode=1;}
finally {
    if(fs.existsSync(path.join(provider,'verification-budget.json')))
        cleanup=A.read(path.join(provider,'verification-budget.json')).cleanup===true;
    save('verification-budget.json',{startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,
        budgetMs:3600000,stopWorkMs:3300000,fullInvocation:false,passScoped:pass&&cleanup&&Date.now()<stop,
        cleanup,commands});
    if(!pass || !cleanup || Date.now()>=stop)process.exitCode=1;
}
