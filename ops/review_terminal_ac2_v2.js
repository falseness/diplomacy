'use strict';
// Version 2: explicit reviewed current implementation and immutable historical ancestry.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'), J=require('./review_terminal_ac2_join');
// The original independent outcome reader remains frozen. Reuse its complete
// initial -> legal commits -> terminal derivation, never provider PASS values.
function review(dir, receipt, bound=F.manifest(dir)) {
    const outcome=F.review(dir,[1],null,bound), checks=[...outcome.checks], proofs={...outcome.proofs};
    const read=(n,jsonl=false)=>{A.proofKey(dir,n,bound);proofs[n]=bound[n];const s=fs.readFileSync(path.join(dir,n),'utf8');return jsonl?s.trim().split('\n').map(JSON.parse):JSON.parse(s);};
    const ck=(id,e,o)=>{assert.deepEqual(o,e,'AC2/'+id);checks.push({id:'terminal/AC2/'+id,expected:structuredClone(e),observed:structuredClone(o),pass:true});};
    for(const id of F.CASES) {
        const trace=read(id+'/network-traces.jsonl',true),fixtureFile=id+'/declared-fixture.json';
        read(fixtureFile);
        const installs=trace.filter(r=>r.stage==='ac2-install');ck(id+'/installation-count',1,installs.length);
        ck(id+'/installation-binding',[id,bound[fixtureFile]],[installs[0].caseId,installs[0].fixtureSha256]);
        const names=['terminal_ac2_provider.js','terminal_page_capture.js','terminal_passive_capture.js'];
        ck(id+'/capture-tools',names.sort(),Object.keys(installs[0].tools).sort());
        for(const n of names) { const file=path.join(__dirname,n);ck(id+'/capture-tool/'+n,A.hash(file),installs[0].tools[n]);proofs[file]=A.hash(file); }
        const terminal=trace.find(r=>r.stage==='mongo-terminal').stored;
        const joined=J.reviewJoin({caseId:id,fixtureBytes:fs.readFileSync(path.join(dir,fixtureFile)),trace,terminal});
        checks.push(...joined.checks);
        const lifecycles=trace.filter(r=>r.stage==='ac2-lifecycle');
        ck(id+'/lifecycle-count',1,lifecycles.length);
        const life=lifecycles[0].lifecycle,cleanup=read(id+'/cleanup.json');
        ck(id+'/owned-roles',['mongod','server'],life.processes.map(p=>p.role).sort());
        ck(id+'/cleanup-identities',life.processes.map(p=>[p.role,p.pid]).sort(),cleanup.processes.map(p=>[p.role,p.pid]).sort());
        ck(id+'/cleanup-dead',[false,false],cleanup.processes.map(p=>p.aliveAfter));
        ck(id+'/cleanup-directories',[false,false],cleanup.directories.map(p=>p.existsAfter));
        ck(id+'/directory-identities',life.temporaryDirectories,cleanup.directories.map(({role,path})=>({role,path})));
        ck(id+'/readiness',[1,200,true,true,true],[life.readiness.database.ping,life.readiness.https.statusCode,life.readiness.https.authorized,life.readiness.https.engineHandshake,life.readiness.socketIo.connected]);
        ck(id+'/browser-errors',[],read(id+'/browser-errors.json'));
        const served=read(id+'/served-sources.json'),ids=read('source-identities.json');
        assert(Object.keys(served).length>50,'served production source count');
        for(const [n,h] of Object.entries(served))ck(id+'/served/'+n,ids.after.client.files[n],h);
    }
    const budget=read('verification-budget.json'),child=read('child-results.json'),ids=read('source-identities.json');
    ck('budget-success',[true,true,[0]],[budget.pass,budget.cleanup,budget.exits]);
    const elapsed=Date.parse(budget.finishedAt)-Date.parse(budget.startedAt);
    assert(elapsed>0&&elapsed<=3600000&&Math.abs(elapsed-budget.elapsedMs)<=2,'cumulative provider budget');
    ck('child-count',1,child.children.length);
    const c=child.children[0];ck('child-suite','tests/reliability/terminal-flow.test.js',c.file);
    ck('child-exit',[0,null,false],[c.exitCode,c.signal,c.timedOut]);
    ck('child-tap',{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},c.tap.summary);
    ck('child-source',[ids.before.server.files[c.file],ids.after.server.files[c.file]],[c.suiteSha256.before,c.suiteSha256.after]);
    for(const repo of ['client','server'])ck('stable-sources/'+repo,ids.before[repo].files,ids.after[repo].files);
    ck('reported-stale',[],ids.stale);
    assert(receipt?.file&&receipt.sha256,'independent parent OS receipt required');
    assert.equal(A.hash(receipt.file),receipt.sha256,'parent receipt hash');proofs[receipt.file]=receipt.sha256;
    const os=A.read(receipt.file);ck('parent-os-exit',[0,null],[os.actualExit,os.signal]);
    ck('parent-cwd',A.root,os.cwd);ck('parent-argv',child.invocation.argv,os.argv);
    assert(require('./review_camera_evidence').timingWithinReceipt(budget,os),'parent timing envelope');
    for(const c of read('checkpoints.json').checkpoints)ck('provider/'+c.id,c.expected,c.observed);
    const run=A.inspectRun({id:'TASK-221'},dir);assert(run.historicalValid,'complete provider archive: '+run.issues.join(','));
    return {criteria:[2],checks,proofs,caseIds:F.CASES,wholeCriterionCredit:true,
        derivation:'Independent frozen initial-fixture/commit/outcome oracle plus raw terminal registry/grid/control interpretation. Authenticate fixture policy, both slot assignments, database identity, ordered page/dispatch/reconnect boundaries and exact unchanged read-only persistence. Preserve page-local identities only within each document. Validate all four original journeys, real replay packet/dispatch, winner UI, source hashes, OS exits and cleanup. Source contract positives alone never grant gameplay coverage.'};
}
module.exports={review};
