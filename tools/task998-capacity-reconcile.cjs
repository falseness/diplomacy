'use strict';
// Offline complete-launch capacity reconciliation from saved measurements only.
// Measures one lossless reduction (byte-exact proofCodec.compressEvidence
// envelopes for plain JSON worker sidecars) and combines it with recovery-28
// proof roots and recovery-37 successful finalization. Never launches anything.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const codec = require('/root/diplomacy_server/tests/helpers/proofCodec');
const task = fs.realpathSync('/root/diplomacy/artifacts/TASK-998');
const out = fs.realpathSync(process.argv[2]);
assert(out.startsWith(task + path.sep), 'output must be inside TASK-998');
const headroom = JSON.parse(fs.readFileSync(process.argv[3]));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const load = rel => { const b = fs.readFileSync(path.join(task, rel)); return {rel, sha256: sha(b), value: JSON.parse(b)}; };
const ledger = load('recovery-13/ledger-completed.json'), proofs = load('recovery-28/measurements.json');
const success = load('recovery-37/success-finalization.json');
const configs = {current: load('recovery-36/current/sidecar-lifecycle.json'), candidate: load('recovery-36/candidate/sidecar-lifecycle.json')};
assert.equal(ledger.value.rows.length, 3900);
assert.equal(success.value.successfulParentFinalizationExercised, true);
const strata = id => { const m = id.match(/-([234])-fog([01])-(undo|chain|redo|redirect|empty|committed)-([a-z-]+)$/);
    assert(m, 'unparsed ID ' + id); return {humans: m[1], fog: m[2], behavior: m[3], interruption: m[4]}; };
// Mutable ownership state stays plain; only completed worker JSON sidecars qualify.
const eligible = h => h.writer.category === 'otherSidecars' && /\.json(\.gz)?$/.test(h.source) && !/storage-[0-9a-f-]+\.json/.test(h.source);
const reductions = new Map();
function reduce(h) {
    if (reductions.has(h.source)) return reductions.get(h.source);
    const raw = fs.readFileSync(h.source), logical = h.source.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
    assert.equal(sha(logical), h.inputLogicalSHA256, 'saved input changed ' + h.source);
    const candidates = [logical, codec.compressEvidence(logical), codec.compressEvidence(logical, codec.BROTLI_ENCODING)].map(Buffer.from);
    const best = candidates.reduce((a, b) => b.length < a.length ? b : a);
    // Byte-exact: the strict reader must reproduce the original logical bytes.
    assert.equal(sha(codec.decodeEvidenceBytes(best)), h.inputLogicalSHA256, 'lossy reduction ' + h.source);
    const r = {source: h.source, logicalBytes: logical.length, storedBefore: h.storedBytes, storedAfter: best.length,
        encoding: best === candidates[0] ? 'plain' : JSON.parse(best).proofEncoding};
    reductions.set(h.source, r); return r;
}
const population = {}, measuredStrata = {};
for (const row of ledger.value.rows) {
    const s = strata(row.matrixID), key = row.moduleID;
    population[key] ||= {ids: 0, strata: {}}; population[key].ids++;
    for (const [k, v] of Object.entries(s)) {
        population[key].strata[k] ||= {}; population[key].strata[k][v] ||= {population: 0, measured: 0};
        population[key].strata[k][v].population++; if (row.measured) population[key].strata[k][v].measured++;
    }
}
assert.equal(Object.keys(population).length, 18);
const proofByModule = Object.fromEntries(proofs.value.rows.map(r => [r.module, r.storedBytes]));
assert.equal(Object.keys(proofByModule).length, 18);
// Finalization residual: sealed root minus replayed sidecars, native proof and budget metadata.
const fin = Object.values(success.value.results).map(r => {
    const proof = r.success.files.find(f => f.path.endsWith('/scenario.json')).bytes;
    return {matrixID: r.success.matrixID, usedBytes: r.success.usedBytes, peakBytes: r.success.peakBytes,
        sidecarBytes: r.baseline.sidecarBytes, proofBytes: proof,
        residualBytes: r.success.usedBytes - r.baseline.sidecarBytes - proof - 4096,
        transientBytes: r.success.peakBytes - r.success.usedBytes, indexEntryBytes: r.index.entryBytes};
});
const residual = Math.max(...fin.map(f => f.residualBytes)), transient = Math.max(...fin.map(f => f.transientBytes));
const entry = Math.max(...fin.map(f => f.indexEntryBytes));
// Final index replacement holds old+new aggregate during rename staging.
const indexBytes = 3900 * entry, indexStagingBytes = 2 * indexBytes;
const result = {admitted: false, measuredIDs: 69, unmeasuredIDs: 3831, moduleCount: 18,
    inputs: Object.fromEntries([ledger, proofs, success, ...Object.values(configs)].map(x => [x.rel, x.sha256])),
    headroom, finalization: {fixtures: fin, maxResidualBytes: residual, maxTransientBytes: transient, maxIndexEntryBytes: entry},
    reduction: {policy: 'byte-exact proofCodec.compressEvidence (gzip|brotli, smallest incl. plain) for completed plain JSON worker sidecars; storage-* ownership manifests stay plain',
        wiredInProduction: false}, configurations: {}, strata: population,
    uncertainty: 'Per-module maxima from 69 historical IDs (1-11 per module) weighted by population; 3831 IDs unmeasured; future outputs and strata absent from the sample may exceed these maxima. Not a proven bound.'};
for (const [name, cfg] of Object.entries(configs)) {
    const modules = [];
    for (const m of cfg.value.modules) {
        const frags = cfg.value.fragments.filter(f => f.moduleID === m.moduleID);
        const perID = {}, perIDReduced = {};
        for (const f of frags) {
            const saved = f.fileHashes.filter(eligible).reduce((n, h) => { const r = reduce(h); return n + r.storedBefore - r.storedAfter; }, 0);
            perID[f.matrixID] = (perID[f.matrixID] || 0) + f.retainedSidecarBytes;
            perIDReduced[f.matrixID] = (perIDReduced[f.matrixID] || 0) + f.retainedSidecarBytes - saved;
        }
        const before = Math.max(...Object.values(perID)), after = Math.max(...Object.values(perIDReduced));
        assert.equal(before, m.sampleMaxBytes, 'sidecar sample max drifted ' + m.moduleID);
        const pop = population[m.moduleID].ids, proof = proofByModule[m.moduleID];
        modules.push({moduleID: m.moduleID, population: pop, measuredIDs: m.measuredIDs, sidecarMaxBefore: before, sidecarMaxAfter: after,
            proofRootBytes: proof, perLaunchBytes: after + proof + residual,
            weightedBefore: (before + proof + residual) * pop, weightedAfter: (after + proof + residual) * pop});
    }
    assert.equal(modules.length, 18);
    const sum = k => modules.reduce((n, m) => n + m[k], 0);
    const total = sum('weightedAfter') + indexBytes + indexStagingBytes + transient;
    result.configurations[name] = {policy: cfg.value.configuration, modules,
        weightedSidecarBefore: modules.reduce((n, m) => n + m.sidecarMaxBefore * m.population, 0),
        weightedSidecarAfter: modules.reduce((n, m) => n + m.sidecarMaxAfter * m.population, 0),
        weightedProof: modules.reduce((n, m) => n + m.proofRootBytes * m.population, 0),
        weightedFinalizationResidual: residual * 3900, indexBytes, indexStagingBytes, transientBytes: transient,
        totalBeforeReduction: sum('weightedBefore') + indexBytes + indexStagingBytes + transient,
        totalAfterReduction: total, headroomBytes: headroom.headroom, marginBytes: headroom.headroom - total};
}
const reds = [...reductions.values()];
result.reduction.files = reds.length;
result.reduction.storedBefore = reds.reduce((n, r) => n + r.storedBefore, 0);
result.reduction.storedAfter = reds.reduce((n, r) => n + r.storedAfter, 0);
result.reduction.byEncoding = reds.reduce((a, r) => (a[r.encoding] = (a[r.encoding] || 0) + 1, a), {});
result.reduction.largest = reds.sort((a, b) => b.storedBefore - a.storedBefore).slice(0, 10);
fs.writeFileSync(path.join(out, 'capacity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`PASS lossless reduction verified byte-exact on ${reds.length} sidecar files: ${result.reduction.storedBefore} -> ${result.reduction.storedAfter} stored bytes`);
for (const [n, c] of Object.entries(result.configurations))
    console.log(`${n}: sidecars ${c.weightedSidecarBefore} -> ${c.weightedSidecarAfter}; proof ${c.weightedProof}; finalization ${c.weightedFinalizationResidual}; index ${c.indexBytes}+staging ${c.indexStagingBytes}; transient ${c.transientBytes}; TOTAL ${c.totalBeforeReduction} -> ${c.totalAfterReduction} vs headroom ${c.headroomBytes} margin ${c.marginBytes}`);
const missing = [];
for (const [mod, p] of Object.entries(population)) for (const [k, vals] of Object.entries(p.strata))
    for (const [v, c] of Object.entries(vals)) if (!c.measured) missing.push(`${mod}:${k}=${v}(${c.population})`);
result.unmeasuredStrata = missing;
fs.writeFileSync(path.join(out, 'capacity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`EXPLICIT unmeasured strata (${missing.length}): ${missing.slice(0, 12).join(' ')}${missing.length > 12 ? ' ...' : ''}`);
console.log('NOT ADMITTED: sample maxima are not future bounds; reduction is not wired in production');
