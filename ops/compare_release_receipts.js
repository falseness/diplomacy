'use strict';
// Explicit offline diagnostic. Never registered with production test discovery.
// Uses saved helper outputs, but cannot authenticate their historical provenance.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = file => digest(fs.readFileSync(file));
const write = (root, name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name)));
const RECEIPTS = {
    package: 'candidate/paired-package.json', rollback: 'rollback/retained-installation.json',
    smoke: 'prepared-smoke-inputs.json', rehearsal: 'layout-rehearsal.json'
};
const ARCHIVES = ['candidate/candidate.tar.gz', 'candidate/runtime-dependencies.tar.gz', 'rollback/prior-installation.tar.gz'];
const FILES = [...Object.values(RECEIPTS), ...ARCHIVES, 'candidate/candidate-manifest.json', 'layout-dry-run.log'];

function compare({savedDir, outputDir, serverDir, stopAt}) {
    const startedMs = Date.now();
    assert(Number.isSafeInteger(stopAt) && startedMs < stopAt, 'comparison-deadline');
    savedDir = fs.realpathSync(savedDir);
    serverDir = fs.realpathSync(serverDir);
    outputDir = path.resolve(outputDir);
    assert(!fs.existsSync(outputDir), 'fresh-comparison-directory-required');
    assert(!outputDir.startsWith(savedDir + path.sep), 'comparison-must-not-modify-saved-directory');
    const helper = path.join(serverDir, 'tests/reliability/helpers');
    const {auditProofs} = require(path.join(helper, 'release-continuation'));
    const {constructFinalOutputs} = require(path.join(helper, 'release-final-construction'));
    const {FILES: finalNames} = require(path.join(helper, 'release-final-output'));
    const frozen = FILES.map(name => ({path: name, sha256: hash(path.join(savedDir, name))}));
    auditProofs(savedDir, frozen);
    const closure = [__filename, ...['release-final-construction.js', 'release-final-output.js', 'release-continuation.js'].map(n => path.join(helper, n))];
    const sources = Object.fromEntries(closure.map(file => [file, hash(file)]));
    fs.mkdirSync(outputDir, {recursive: true});
    outputDir = fs.realpathSync(outputDir);
    write(outputDir, 'verification-plan.json', {fullTaskPass: false, estimateMs: 60000, stopAt,
        tier: 'offline real-producer receipt comparison with fixture archives; no authentication, service, network or browser claim',
        cases: ['frozen-inputs', 'direct-constructor', 'normalized-constructor', 'package-proofs', 'rollback-proofs',
            'issuer-provenance', 'service-receipts', 'expiry', 'no-final-outputs', 'saved-inputs-unchanged'],
        exclusions: ['full release gate: finalized TASK-225 and authenticated production inputs required', 'activation', 'public games'],
        command: {argv: process.argv, cwd: process.cwd(), node: process.version}});
    write(outputDir, 'source-identities.json', {fullTaskPass: false, scope: 'diagnostic source closure, not tested release pair', files: sources});
    write(outputDir, 'frozen-inputs.json', {fullTaskPass: false, savedDir, stopAt, files: frozen});
    const variants = [];
    for (const name of ['direct', 'normalized']) {
        assert(Date.now() < stopAt, 'comparison-deadline');
        const root = path.join(outputDir, name);
        fs.mkdirSync(root);
        for (const file of FILES) {
            fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
            fs.copyFileSync(path.join(savedDir, file), path.join(root, file), fs.constants.COPYFILE_EXCL);
        }
        // This synthetic prerequisite exists ONLY inside this diagnostic tree.
        // It is never offered to the production worker, supervisor or CLI.
        write(root, 'diagnostic-prerequisite.json', {ready: true, diagnosticOnly: true, fullTaskPass: false});
        const pair = read(root, RECEIPTS.package), prior = read(root, RECEIPTS.rollback);
        const binding = {source: pair.source_archive_sha256, runtime: pair.runtime_archive_sha256,
            prerequisite: hash(path.join(root, 'diagnostic-prerequisite.json'))};
        const proof = file => ({path: file, sha256: hash(path.join(root, file))});
        // Verify producer claims against the frozen bytes before deriving proofs.
        assert.equal(binding.source, hash(path.join(root, ARCHIVES[0])), 'source-archive-drift');
        assert.equal(binding.runtime, hash(path.join(root, ARCHIVES[1])), 'runtime-archive-drift');
        assert.equal(prior.archive_sha256, hash(path.join(root, ARCHIVES[2])), 'rollback-archive-drift');
        const refs = {...RECEIPTS, prerequisite: 'diagnostic-prerequisite.json'};
        if (name === 'normalized') {
            write(root, 'normalized-package.json', {...pair, proofs: ARCHIVES.slice(0, 2).map(proof)});
            write(root, 'normalized-rollback.json', {...prior, proofs: [proof(ARCHIVES[2])]});
            const rehearsal = read(root, RECEIPTS.rehearsal);
            for (const file of ARCHIVES) assert.equal(rehearsal.bindings[file], hash(path.join(root, file)), 'layout-archive-drift');
            // Add only a binding derived from actual archive bytes. Do not add
            // kind, commands, exit, issuer, verified, or fabricated service logs.
            write(root, 'normalized-rehearsal.json', {...rehearsal, binding});
            refs.package = 'normalized-package.json'; refs.rollback = 'normalized-rollback.json';
            refs.rehearsal = 'normalized-rehearsal.json';
        }
        const inputs = Object.fromEntries(Object.entries(refs).map(([key, file]) => [key, proof(file)]));
        const contracts = [];
        const probe = (id, fn) => {
            try {fn(); contracts.push({id, met: true});}
            catch (e) {contracts.push({id, met: false, reason: e.message.split('\n')[0]});}
        };
        probe('package-proofs', () => auditProofs(root, read(root, refs.package).proofs));
        probe('rollback-proofs', () => auditProofs(root, read(root, refs.rollback).proofs));
        const smoke = read(root, refs.smoke), rehearsal = read(root, refs.rehearsal);
        probe('issuer-provenance', () => assert(smoke.issuer?.id && smoke.issuer?.verified === true, 'missing-issuer-provenance'));
        probe('service-receipts', () => {
            assert.equal(rehearsal.kind, 'executable-service-health', 'missing-executable-service-health');
            assert.deepEqual(rehearsal.commands?.map(c => c.id), ['candidate-start', 'candidate-health', 'rollback-start', 'rollback-health']);
        });
        probe('expiry', () => assert(smoke.expiresAt > startedMs, 'saved-smoke-expired'));
        let constructor;
        try {constructor = {accepted: true, result: constructFinalOutputs({outputDir: root, binding, inputs, stopAt})};}
        catch (e) {constructor = {accepted: false, reason: e.message.split('\n')[0], detail: e.message};}
        assert.equal(constructor.accepted, false, 'saved-fixtures-must-not-construct-final-evidence');
        assert.match(constructor.reason, name === 'direct' ? /service-rehearsal-binding/ : /diagnostic-only-dry-run/);
        assert(finalNames.every(file => !fs.existsSync(path.join(root, file))), 'unexpected-final-output');
        for (const file of ARCHIVES) assert.equal(hash(path.join(root, file)), frozen.find(p => p.path === file).sha256);
        const result = {name, fullTaskPass: false, binding, stopAt, contracts, constructor, finalOutputsAbsent: true};
        write(root, 'comparison.json', result); variants.push(result);
    }
    assert.deepEqual(variants[0].binding, variants[1].binding);
    for (const id of ['package-proofs', 'rollback-proofs']) {
        assert.equal(variants[0].contracts.find(c => c.id === id).met, false);
        assert.equal(variants[1].contracts.find(c => c.id === id).met, true);
    }
    for (const result of variants) for (const id of ['issuer-provenance', 'service-receipts']) {
        assert.equal(result.contracts.find(c => c.id === id).met, false);
    }
    auditProofs(savedDir, frozen);
    assert.deepEqual(Object.fromEntries(closure.map(file => [file, hash(file)])), sources);
    assert(Date.now() < stopAt, 'comparison-deadline');
    const result = {diagnosticPass: true, fullTaskPass: false, releaseReady: false,
        savedInputsUnchanged: true, sourceClosureUnchanged: true, variants,
        remaining: ['authenticated acquisition and issuer integration', 'executable service/health rehearsal',
            'production operations wiring', 'authenticated final consumer for worker and supervisor', 'finalized current TASK-225 proof']};
    write(outputDir, 'comparison.json', result);
    write(outputDir, 'verification-budget.json', {fullTaskPass: false, diagnosticPass: true, startedMs,
        finishedMs: Date.now(), elapsedMs: Date.now() - startedMs, stopAt, ownedProcesses: [], cleanup: true});
    for (const variant of variants) {
        console.log(`CONSTRUCTOR ${variant.name} REJECT ${variant.constructor.reason}`);
        for (const c of variant.contracts) console.log(`CONTRACT ${variant.name} ${c.id} met=${c.met}${c.reason ? ' reason=' + c.reason : ''}`);
    }
    console.log('PASS frozen-archives equal=true source-bindings equal=true deadline equal=true');
    console.log('PASS saved-inputs-unchanged source-closure-unchanged no-final-outputs');
    console.log('DIAGNOSTIC_PASS=true FULL_TASK_PASS=false RELEASE_READY=false');
    return result;
}
if (require.main === module) {
    const [savedDir, outputDir, serverDir, deadline] = process.argv.slice(2);
    compare({savedDir, outputDir, serverDir, stopAt: Number(deadline)});
}
module.exports = {compare};
