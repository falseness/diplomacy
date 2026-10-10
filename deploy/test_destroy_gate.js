'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {entry, judge} = require('./destroy_gate');
const {execute} = require('../../diplomacy_server/tests/helpers/runMultiplayerGate');
async function main() {
    assert(entry().cases.length > 0);
    console.log('PASS focused Destroy registry selection');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-gate-controls-'));
    const output = path.resolve(process.argv[2]);
    fs.mkdirSync(output, {recursive: true});
    try {
        for (const [label, source, reason] of [
            ['absent-execution', '', 'missing-case:critical'],
            ['required-skip', "require('node:test').test('critical',{skip:true},()=>{})", 'skipped-cases'],
            ['browser-exception', "require('node:test').test('critical',()=>console.log('BROWSER_ERROR ReferenceError: injected'))", 'browser-exception'],
            ['assertion-failure', "require('node:test').test('critical',()=>require('node:assert/strict').equal(1,2))", 'failed-cases'],
            ['timeout', "require('node:test').test('critical',()=>new Promise(r=>setTimeout(r,10000)))", 'timeout'],
        ]) {
            const file = path.join(scratch, label + '.js');
            fs.writeFileSync(file, source);
            const result = await execute({file, kind:'tap', cases:['critical'], timeoutMs:label === 'timeout' ? 200 : 10000}, path.join(output,label));
            const log = fs.readFileSync(result.log,'utf8');
            process.stdout.write(log);
            const reasons = judge(result,log);
            assert(reasons.includes(reason), JSON.stringify(reasons));
            console.log('GATE BLOCKED ' + label + ' activation=false reasons=' + reasons.join(','));
        }
    } finally {
        fs.rmSync(scratch, {recursive:true, force:true});
        assert(!fs.existsSync(scratch));
        console.log('PASS negative controls temporary resources removed');
    }
}
main().catch(e => {console.error(e);process.exitCode=1;});
