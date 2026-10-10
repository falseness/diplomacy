'use strict';
// Run only the focused packaged Destroy regression with the shared TAP judge.
const fs = require('node:fs');
const path = require('node:path');
const server = path.resolve(__dirname, '../../diplomacy_server');
const {execute} = require(path.join(server, 'tests/helpers/runMultiplayerGate'));
const {REGISTRY} = require(path.join(server, 'tests/reliability/registry'));
const FILE = 'tests/online/destroy-button-browser.test.js';
const CASE = 'packaged Chromium Destroy building and bush records once and Undo restores; ineligible target is inert';
function entry() {
    const found = REGISTRY.find(e => e.file === FILE);
    if (!found || !found.cases.includes(CASE) || !fs.existsSync(path.join(server, FILE))) {
        throw Error('missing required Destroy browser suite/case');
    }
    return found;
}
function judge(result, output) {
    const reasons = [...result.reasons];
    if (/BROWSER_ERROR\b/.test(output)) reasons.push('browser-exception');
    return reasons;
}
async function run(output) {
    const client = path.resolve(__dirname, '..');
    const result = await execute(entry(), output, {...process.env,
        DIPLOMACY_CLIENT_ROOT: client, DESTROY_PACKAGE_ROOT: client});
    const log = fs.readFileSync(result.log, 'utf8');
    process.stdout.write(log);
    result.reasons = judge(result, log);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    if (result.reasons.length) throw Error('Destroy gate rejected: ' + result.reasons.join(','));
    console.log('PASS required Destroy browser execution; zero required skips');
}
if (require.main === module) run(path.resolve(process.argv[2])).catch(e => {console.error(e); process.exitCode = 1;});
module.exports = {entry, judge, run};
