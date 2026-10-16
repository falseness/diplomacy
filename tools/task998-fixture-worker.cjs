'use strict';
// OFFLINE FIXTURE CHILD for tools/task998-success-finalization.cjs. It replays
// saved historical sidecars, proof and worker output under the inherited
// evidence budget. It never starts services or plays a game; its output is a
// storage fixture and must never be counted as a gameplay receipt.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const {finished} = require('node:stream/promises');
const server = '/root/diplomacy_server';
const budget = require(server + '/tests/helpers/evidenceBudget');
const sidecars = require(server + '/tests/helpers/sidecarStorage');
const codec = require(server + '/tests/helpers/proofCodec');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const logical = file => file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file);
async function main() {
    const out = process.argv[2], spec = JSON.parse(fs.readFileSync(process.env.TASK998_FIXTURE_SPEC));
    assert(process.env[budget.ENV], 'fixture child must inherit the admitted budget');
    for (const entry of spec.replay) {
        const bytes = logical(entry.source), target = path.join(out, entry.relative);
        assert.equal(sha(bytes), entry.logicalSHA256, 'saved input changed: ' + entry.source);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        const stream = (entry.framed ? sidecars : budget.fs).createWriteStream(target);
        const done = finished(stream); stream.end(bytes); await done;
    }
    const proof = logical(spec.proof.source);
    assert.equal(sha(proof), spec.proof.logicalSHA256, 'saved proof changed');
    // Current workers write the proof through the native serializer, not the
    // historical pretty-printed bytes; the strict reader must reconstruct it.
    const target = path.join(out, 'scenario.json'), value = JSON.parse(proof);
    budget.fs.writeFileSync(target, codec.serializeEvidence('scenario.json', value, target));
    assert.equal(sha(JSON.stringify(codec.parseProof(fs.readFileSync(target), target))), sha(JSON.stringify(value)),
        'native proof serialization is not lossless');
    const worker = logical(spec.worker.source);
    assert.equal(sha(worker), spec.worker.logicalSHA256, 'saved worker output changed');
    for (let offset = 0; offset < worker.length; offset += 65536)
        if (!process.stdout.write(worker.subarray(offset, offset + 65536)))
            await new Promise(resolve => process.stdout.once('drain', resolve));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
