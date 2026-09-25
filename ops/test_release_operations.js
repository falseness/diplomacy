'use strict';
// Dedicated diagnostic worker/parent. Fixture injection is not reachable from
// release-preparation's production entry point.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const helpers = path.resolve(__dirname, '../../diplomacy_server/tests/reliability/helpers');
const {continuePreparation, hash} = require(path.join(helpers, 'release-continuation'));
const {superviseWorker} = require(path.join(helpers, 'release-preparation-gate'));
const {createOperations} = require('./release_operations');
const {createPolicy} = require('../../diplomacy_server/server/smokeIsolation');
const stages = ['paired-runtime-package','current-rollback','guarded-dry-run','authenticated-smoke-inputs'];
const write = (root, name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name)));
const sha = value => createHash('sha256').update(value).digest('hex');
async function worker(o) {
    const calls = [], originalSentinel = hash(o.sentinel);
    let result;
    const config = structuredClone(o.config);
    if (o.scenario === 'changed-observation') {
        config.observerArgv = ['python3','-c', 'import json,sys;v=json.load(open(sys.argv[1]));v["pid"]+=1;print(json.dumps(v))', config.observationFile];
    }
    const issueSmoke = async ({binding}) => ({binding, password:'MUST_NOT_APPEAR_IN_EVIDENCE',
        expiresAt: o.scenario === 'expired-smoke' ? 1 : o.startedMs + 3300000,
        cases:['competitive','coop'].map(mode => ({mode,seed:1,map:'Tiny',run:'fixture-' + mode,
            userIds:[sha(mode + '-one'), sha(mode + '-two')],milestones:['legal-move','one-round','reconnect']}))});
    const validateSmoke = async smoke => {
        // Real isolation policy, fixture identities only. No network auth claim.
        const policy = createPolicy(smoke.cases.flatMap(c => c.userIds.map(userId => ({userId,run:c.run,expiresAt:smoke.expiresAt}))));
        for (const c of smoke.cases) for (const id of c.userIds) assert.equal(policy.authorize(id), c.run);
    };
    try {
        let operations = o.scenario === 'missing-map' ? {} : createOperations({config, issueSmoke,
            validateSmoke:o.scenario === 'missing-smoke-adapter' ? undefined : validateSmoke});
        for (const id of Object.keys(operations)) {
            const original = operations[id];
            operations[id] = async context => {
                calls.push(id);
                if (id === 'current-rollback' && o.scenario === 'tampered-receipt') fs.appendFileSync(path.join(o.outputDir,'candidate/paired-package.json'), ' ');
                if (id === 'guarded-dry-run' && o.scenario === 'tampered-archive') fs.appendFileSync(path.join(o.outputDir,'candidate/runtime-dependencies.tar.gz'), 'tamper');
                if (id === 'authenticated-smoke-inputs' && o.scenario === 'tampered-rehearsal') fs.appendFileSync(path.join(o.outputDir,'layout-rehearsal.json'), ' ');
                return original(context);
            };
        }
        result = await continuePreparation({prerequisite:{ready:true}, operations, outputDir:o.outputDir, stopAt:o.startedMs + 3300000});
    } catch (error) {result = {pass:false, releaseReady:false, reason:error.message.split('\n')[0], stages:[]};}
    assert.equal(hash(o.sentinel), originalSentinel);
    const exit = result.pass ? 0 : 1;
    write(o.outputDir, 'diagnostic-result.json', {...result, calls, sentinelUnchanged:true, diagnosticOnly:true});
    write(o.outputDir, 'coverage-results.json', {pass:result.pass, cases:[{id:'complete-current-TASK-225-proof',pass:true}, ...stages.map(id => ({id,pass:result.stages.some(s => s.id === id)}))]});
    write(o.outputDir, 'verification-budget.json', {pass:result.pass, invocationExit:exit, diagnosticOnly:true, fullTaskPass:false, releaseReady:false});
    const log = `DIAGNOSTIC_ONLY RELEASE_READY=false\nSCENARIO=${o.scenario}\nREASON=${result.reason}\nACTUAL_EXIT=${exit}\n`;
    fs.writeFileSync(path.join(o.outputDir,'verification.log'),log); console.log(log);
    return exit;
}
async function parent(o) {
    const expected = {
        'missing-map':[1,0,'missing-operation:paired-runtime-package'],
        'complete':[0,4,null],
        'tampered-receipt':[1,2,'changed-upstream-proof:candidate/paired-package.json'],
        'changed-observation':[1,2,'rollback-process-drift'],
        'missing-smoke-adapter':[1,0,'missing-authenticated-smoke-adapter'],
        'expired-smoke':[1,4,'Smoke isolation denied'],
        'tampered-archive':[1,3,'changed-upstream-proof:candidate/runtime-dependencies.tar.gz'],
        'tampered-rehearsal':[1,4,'changed-upstream-proof:layout-rehearsal.json']
    };
    const checks = [];
    for (const scenario of o.cases) {
        const outputDir = path.join(o.outputDir, scenario);
        const exit = await superviseWorker({...o, outputDir, scenario, worker:true}, __filename);
        const result = read(outputDir,'diagnostic-result.json'), budget = read(outputDir,'verification-budget.json'), cleanup = read(outputDir,'cleanup.json');
        const observed = [exit,result.calls.length,result.reason];
        assert.deepEqual(observed,expected[scenario],scenario);
        assert.equal(budget.workerReceipt.exit,exit); assert.equal(cleanup.cleanup,true); assert.deepEqual(cleanup.remaining,[]);
        assert.equal(result.sentinelUnchanged,true); assert.equal(result.releaseReady,false);
        // The shared supervisor only tracks processes. Derive retained diagnostic
        // output from disk instead of inheriting its empty staging placeholders.
        cleanup.stagedCandidates = ['candidate','rollback'].filter(name => fs.existsSync(path.join(outputDir,name)));
        cleanup.scope = 'diagnostic archives retained as evidence; no production staging';
        cleanup.readyManifestExists = fs.existsSync(path.join(outputDir,'release-manifest.json'));
        write(outputDir,'cleanup.json',cleanup);
        fs.appendFileSync(path.join(outputDir,'verification.log'), `RETAINED_DIAGNOSTIC_DIRECTORIES=${cleanup.stagedCandidates.join(',')} READY_MANIFEST=${cleanup.readyManifestExists ? 'present' : 'absent'}\n`);
        assert.deepEqual(cleanup.stagedCandidates, result.calls.length === 0 ? [] :
            ['tampered-receipt','changed-observation'].includes(scenario) ? ['candidate'] : ['candidate','rollback']);
        assert(!fs.existsSync(path.join(outputDir,'release-manifest.json')));
        if (['missing-map','missing-smoke-adapter'].includes(scenario)) assert(!fs.existsSync(path.join(outputDir,'candidate')));
        if (scenario === 'complete') {
            const pair = read(outputDir,'candidate/paired-package.json'), prior = read(outputDir,'rollback/retained-installation.json');
            assert.deepEqual(Object.keys(pair.inventory).sort(), ['diplomacy_server/server/node_modules','diplomacy_server/server/node_modules/.bin','diplomacy_server/server/node_modules/.bin/example','diplomacy_server/server/node_modules/example','diplomacy_server/server/node_modules/example/bin.js','diplomacy_server/server/node_modules/example/package.json','runtime','runtime/bin','runtime/bin/node']);
            assert.equal(pair.archive_members,9);
            assert.deepEqual(Object.keys(prior.inventory).sort(), ['client','client/game.js','config','config/service.conf','runtime','runtime/bin','runtime/bin/node','server','server/server','server/server/index.js','server/server/node_modules','server/server/node_modules/pkg','server/server/node_modules/pkg/alias.js','server/server/node_modules/pkg/index.js','web','web/index.html']);
            assert.equal(prior.archive_members,16);
            const plan = read(outputDir,'guarded-plan.json'), smoke = read(outputDir,'prepared-smoke-inputs.json');
            assert.deepEqual(plan.requiredActivationSteps,['verify-current-host','verify-staged-hashes','retain-web-layout','switch-service-and-web','health-check']);
            assert.deepEqual(plan.requiredRollbackSteps,['verify-owned-layout','restore-retained-service-and-web','health-check']);
            assert.equal(plan.source,pair.source_archive_sha256); assert.equal(plan.runtime,pair.runtime_archive_sha256); assert.equal(plan.rollback,prior.archive_sha256);
            const rehearsal = read(outputDir,'layout-rehearsal.json');
            assert.deepEqual(rehearsal.actions, ['retain-web-layout','link-candidate-web','install-owned-override',
                'unlink-owned-web','restore-prior-web','remove-owned-override']);
            assert.deepEqual(rehearsal.bindings, {'candidate/candidate.tar.gz':pair.source_archive_sha256,
                'candidate/runtime-dependencies.tar.gz':pair.runtime_archive_sha256,
                'rollback/prior-installation.tar.gz':prior.archive_sha256});
            assert.equal(rehearsal.candidateWebFiles,3); assert.equal(rehearsal.priorWebFiles,1);
            assert.equal(rehearsal.cleanup,true); assert.equal(rehearsal.releaseReady,false);
            assert.deepEqual(rehearsal.serviceActions,[]); assert.deepEqual(rehearsal.databaseActions,[]);
            assert.deepEqual(rehearsal.checks.map(c => c.id), ['candidate-web-visible','owned-override-installed',
                'prior-web-retained','prior-web-restored','owned-layout-removed','unrelated-game-unchanged','temporary-layout-cleanup']);
            assert(rehearsal.checks.every(c => c.pass && JSON.stringify(c.expected) === JSON.stringify(c.observed)));
            console.log('PASS isolated filesystem switch/rollback actions=6 candidateWebFiles=3 priorWebFiles=1 cleanup=true');
            assert.equal(smoke.binding.source,plan.source); assert.equal(smoke.binding.runtime,plan.runtime);
            assert.deepEqual(smoke.cases.map(c => [c.mode,c.seed,c.map,c.userIds.length,c.milestones]),['competitive','coop'].map(mode => [mode,1,'Tiny',2,['legal-move','one-round','reconnect']]));
            assert.equal(smoke.cleanupEvent,'cleanupSmokeRun');
            assert(!fs.readFileSync(path.join(outputDir,'prepared-smoke-inputs.json'),'utf8').includes('MUST_NOT_APPEAR'));
            assert(fs.readFileSync(path.join(outputDir,'helper-commands.log'),'utf8').includes(`STOP_AT_SECONDS=${(o.startedMs + 3300000) / 1000}`));
            console.log('PASS independent archive members runtime=9 rollback=16 guarded-plan=bound smoke-inputs=bound secret-projection=clean');
        }
        checks.push({id:scenario,expected:expected[scenario],observed,pass:true,proof:scenario + '/diagnostic-result.json'});
        console.log(`PASS ${scenario} workerExit=${budget.workerReceipt.exit} supervisorExit=${exit} calls=${result.calls.length} cleanup=true releaseReady=false`);
    }
    write(o.outputDir,'checkpoints.json',{diagnosticOnly:true,fullTaskPass:false,checks});
    write(o.outputDir,'coverage-results.json',{diagnosticOnly:true,fullTaskPass:false,releaseReady:false,pass:true,cases:checks});
    write(o.outputDir,'verification-budget.json',{startedMs:o.startedMs,elapsedMs:Date.now()-o.startedMs,pass:true,fullTaskPass:false,releaseReady:false,invocationExit:0});
    return 0;
}
const options = JSON.parse(process.argv[2]);
(options.worker ? worker(options) : parent(options)).then(exit => {process.exitCode=exit;}).catch(e => {console.error(e);process.exitCode=1;});
