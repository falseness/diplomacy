'use strict';
// Only loaded by the standalone diagnostic ON child via explicit --require.
const fs = require('node:fs'), Module = require('node:module'), crypto = require('node:crypto');
const hooks = require('./lifecycle-v2-hooks');
if (process.env.TASK175_RECORD === '1') {
    const secret = process.env.TASK175_SECRET;
    if (!secret || !process.env.TASK175_FLUSH) throw Error('CAPTURE_CONTRACT missing diagnostic environment');
    globalThis.__task175v2 = require('./lifecycle-v2-recorder').lifecycleRecorder(secret, 'server:' + process.pid, require('./recorder'));
    delete process.env.TASK175_SECRET;
    const compile = Module.prototype._compile, installed = [], sources = [];
    Module.prototype._compile = function(source, file) {
        const r = hooks.server(file, source);
        if (r) {
            sources.push({file,original:crypto.createHash('sha256').update(source).digest('hex'),transformed:crypto.createHash('sha256').update(r.text).digest('hex'),manifest:r.manifest});
            installed.push(...r.manifest.map(m => m.hook)); source = r.text;
        }
        return compile.call(this, source, file);
    };
    process.once('SIGUSR2', () => {
        const trace = globalThis.__task175v2.flush(installed);
        fs.writeFileSync(process.env.TASK175_FLUSH, JSON.stringify({...trace,sources},null,2)+'\n', {flag:'wx'});
    });
}
