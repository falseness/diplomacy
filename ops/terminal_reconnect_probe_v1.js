'use strict';
// Opt-in acquisition diagnostics only. Preserve every input, wait and assertion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FILE = '/root/diplomacy_server/tests/reliability/helpers/browser-driver.js';
const PIN = 'cd99d63051da689a098a3170ebb507f6e0aa28dfc9f74aeb5efd28d467fd6348';
const BEFORE = `            try {
                await this.page.waitForFunction(until, null, {timeout: 8000, polling: 50});
            } catch (error) {
                throw new Error(\`${'${this.name}'}: input "${'${label}'}" had no observed effect (${'${until}'})\`);
            }`;
const ADDED = [
    "            const reconnectProbe = label === 'reconnect slot' && until === '!menu.visible';\n            const reconnectStarted = reconnectProbe ? Date.now() : null;\n            if (reconnectProbe) this.trace({action:'reconnect-wait', boundary:'before', timeoutMs:8000, pollingMs:50, predicate:'!menu.visible'});\n",
    "\n                if (reconnectProbe) this.trace({action:'reconnect-wait', boundary:'success', elapsedMs:Date.now()-reconnectStarted});",
    "\n                if (reconnectProbe) this.trace({action:'reconnect-wait', boundary:'failure', elapsedMs:Date.now()-reconnectStarted, causeName:error.name, causeMessage:error.message});"
];
function instrument(source) {
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), PIN, 'unreviewed browser driver');
    assert.equal(source.split(BEFORE).length, 2, 'unique original settle wait');
    const after = ADDED[0] + BEFORE
        .replace('polling: 50});', 'polling: 50});' + ADDED[1])
        .replace('} catch (error) {', '} catch (error) {' + ADDED[2]);
    return source.replace(BEFORE, after);
}
function install() {
    assert(!require.cache[FILE], 'reconnect probe must precede browser driver');
    const Module = require('node:module'), original = Module._extensions['.js'];
    Module._extensions['.js'] = (module, filename) => filename === FILE
        ? module._compile(instrument(fs.readFileSync(FILE, 'utf8')), filename)
        : original(module, filename);
    try { require(FILE); } finally { Module._extensions['.js'] = original; }
    // The screenshot-free map adapter installs its original AC2/AC3 composition.
    require('./terminal_map_provider_v2');
}
if (process.env.TERMINAL_MAP_CAPTURE === '1' && path.basename(process.argv[1] || '') === 'terminal-flow.test.js') install();
module.exports = {FILE, PIN, ADDED, instrument, install};
