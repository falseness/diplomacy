'use strict';
// Intermediate local operation factory. Production callers must independently
// validate TASK-225 and authenticate collectors/identity issuance before use.
// This module cannot publish a ready manifest or activate a service.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (root, name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name)));

function createOperations({config, issueSmoke, validateSmoke}) {
    // Complete preflight occurs before any archive or candidate is created.
    for (const key of ['client','server','sources','runtime','dependencies','runtimeReceipt','observationFile']) {
        assert(typeof config?.[key] === 'string' && path.isAbsolute(config[key]) && fs.existsSync(config[key]), 'missing-operation-input:' + key);
    }
    assert.deepEqual(Object.keys(config.rollbackRoots || {}).sort(), ['client','config','runtime','server','web'], 'missing-rollback-roots');
    assert(/^[a-f0-9]{64}$/.test(config.observationSha256), 'missing-observation-hash');
    assert(Array.isArray(config.observerArgv) && config.observerArgv.length && config.observerArgv.every(x => typeof x === 'string'), 'missing-observer-command');
    assert(typeof issueSmoke === 'function' && typeof validateSmoke === 'function', 'missing-authenticated-smoke-adapter');
    const priorProofs = [];
    const audit = root => {
        for (const p of priorProofs) assert.equal(hash(path.join(root, p.path)), p.sha256, 'changed-upstream-proof:' + p.path);
    };
    const receipt = (root, names, checks) => {
        const proofs = names.map(name => ({path:name, sha256:hash(path.join(root, name))}));
        priorProofs.push(...proofs);
        return {pass:true, exit:0, checks, proofs};
    };
    const check = (id, expected, observed) => {
        assert.deepEqual(observed, expected, id);
        return {id, expected, observed, pass:true};
    };
    async function helper(stage, {outputDir, stopAt}) {
        assert(Date.now() < stopAt, 'preparation-deadline');
        audit(outputDir);
        const argv = [path.join(__dirname, 'release_helper_bridge.py')];
        const log = fs.openSync(path.join(outputDir, 'helper-commands.log'), 'a');
        fs.writeSync(log, `COMMAND python3 ${argv.join(' ')} STAGE=${stage} CWD=${__dirname} STOP_AT_MS=${stopAt} STOP_AT_SECONDS=${stopAt / 1000}\n`);
        let timer;
        try {
            await new Promise((resolve, reject) => {
                const child = spawn('python3', argv, {cwd:__dirname, stdio:['pipe','pipe','pipe']});
                let failure = '', tail = '';
                const capture = chunk => {
                    fs.writeSync(log, chunk);
                    tail = (tail + chunk.toString()).slice(-8192);
                    const match = tail.match(/HELPER_FAILURE=([^\r\n]+)/);
                    if (match) failure = match[1];
                };
                child.stdout.on('data', capture); child.stderr.on('data', capture);
                child.once('error', reject);
                child.stdin.on('error', () => {}); // close reports the real child failure
                child.once('close', (code, signal) => {
                    clearTimeout(timer);
                    fs.writeSync(log, `ACTUAL_EXIT=${code} SIGNAL=${signal}\n`);
                    code === 0 ? resolve() : reject(Error(failure || `helper-failed:${stage}:${code}:${signal}`));
                });
                timer = setTimeout(() => child.kill('SIGKILL'), Math.max(1, stopAt - Date.now()));
                child.stdin.end(JSON.stringify({stage, config, outputDir, stopAtMs:stopAt}));
            });
        } finally {clearTimeout(timer); fs.closeSync(log);}
        assert(Date.now() < stopAt, 'preparation-deadline');
    }
    return {
        'paired-runtime-package': async context => {
            await helper('paired-runtime-package', context);
            const pair = read(context.outputDir, 'candidate/paired-package.json');
            return receipt(context.outputDir, ['candidate/paired-package.json','candidate/candidate-manifest.json','candidate/candidate.tar.gz','candidate/runtime-dependencies.tar.gz'],
                [check('source-receipt-binding', hash(config.sources), pair.source_manifest_sha256), check('intermediate-package-only', false, pair.releaseReady)]);
        },
        'current-rollback': async context => {
            await helper('current-rollback', context);
            const prior = read(context.outputDir, 'rollback/retained-installation.json');
            return receipt(context.outputDir, ['rollback/retained-installation.json','rollback/prior-installation.tar.gz'],
                [check('observation-binding', config.observationSha256, prior.observation_sha256), check('no-database-actions', [], prior.databaseActions), check('no-service-actions', [], prior.serviceActions)]);
        },
        'guarded-dry-run': async context => {
            await helper('archive-readback', context);
            const pair = read(context.outputDir, 'candidate/paired-package.json');
            const prior = read(context.outputDir, 'rollback/retained-installation.json');
            // Declarative preparation only. TASK-227 needs an authenticated host
            // plan and executable switch adapter; this is not a switch dry-run.
            const plan = {releaseReady:false, scope:'local archive guard only', activation:false,
                guards:priorProofs.map(p => ({...p})),
                source:pair.source_archive_sha256, runtime:pair.runtime_archive_sha256, rollback:prior.archive_sha256,
                requiredActivationSteps:['verify-current-host','verify-staged-hashes','retain-web-layout','switch-service-and-web','health-check'],
                requiredRollbackSteps:['verify-owned-layout','restore-retained-service-and-web','health-check'],
                databaseActions:[]};
            write(context.outputDir, 'guarded-plan.json', plan);
            fs.writeFileSync(path.join(context.outputDir, 'archive-guard.log'), 'PASS candidate/runtime/rollback archive hashes and readback\nACTIVATION=false RELEASE_READY=false\n', {flag:'wx'});
            return receipt(context.outputDir, ['guarded-plan.json','archive-guard.log'], [check('no-activation', false, plan.activation)]);
        },
        'authenticated-smoke-inputs': async context => {
            audit(context.outputDir);
            const pair = read(context.outputDir, 'candidate/paired-package.json');
            const binding = {source:pair.source_archive_sha256, runtime:pair.runtime_archive_sha256};
            const smoke = await issueSmoke({binding, stopAt:context.stopAt});
            await validateSmoke(smoke, {binding, stopAt:context.stopAt});
            assert(Date.now() < context.stopAt, 'preparation-deadline');
            assert.deepEqual(smoke.binding, binding, 'smoke-package-binding');
            assert.deepEqual(smoke.cases.map(c => [c.mode,c.seed,c.map,c.userIds.length,c.milestones]),
                ['competitive','coop'].map(mode => [mode,1,'Tiny',2,['legal-move','one-round','reconnect']]), 'smoke-case-manifest');
            const ids = smoke.cases.flatMap(c => c.userIds);
            assert.equal(new Set(ids).size, 4, 'smoke-distinct-identities');
            assert(ids.every(id => /^[a-f0-9]{64}$/.test(id)), 'invalid-smoke-identity');
            assert(Number.isSafeInteger(smoke.expiresAt) && smoke.expiresAt > Date.now(), 'expired-smoke-input');
            assert(smoke.cases.every(c => typeof c.run === 'string' && c.run.length) && new Set(smoke.cases.map(c => c.run)).size === 2, 'smoke-run-isolation');
            // Allowlist projection only: credentials and unrecognized fields are
            // never serialized to evidence, even if an issuer includes secrets.
            write(context.outputDir, 'prepared-smoke-inputs.json', {releaseReady:false, binding,
                expiresAt:smoke.expiresAt, cases:smoke.cases.map(({mode,seed,map,userIds,milestones,run}) => ({mode,seed,map,userIds,milestones,run})), cleanupEvent:'cleanupSmokeRun'});
            audit(context.outputDir);
            return receipt(context.outputDir, ['prepared-smoke-inputs.json'], [check('two-isolated-smoke-cases', 2, smoke.cases.length)]);
        }
    };
}
module.exports = {createOperations};
