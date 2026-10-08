'use strict';
// Verification only. The tracked service launcher generates private per-run
// certificates outside the release, but index.js first reads the legacy dev
// paths. Redirect only those two reads to the launcher's generated pair.
const fs = require('node:fs');
const path = require('node:path');
if (process.env.LOCAL_DEV === '1' && process.env.COOP_LOCAL_TLS_DIR &&
    /^diplomacy_test_[a-z0-9_]+$/.test(process.env.DIPLOMACY_TEST_DB || '')) {
    const server = path.resolve(__dirname, '../../diplomacy_server/server');
    const read = fs.readFileSync;
    const replacements = new Map([
        [path.join(server, 'mydomain.key'), path.join(process.env.COOP_LOCAL_TLS_DIR, 'key.pem')],
        [path.join(server, 'mydomain.crt'), path.join(process.env.COOP_LOCAL_TLS_DIR, 'cert.pem')],
    ]);
    fs.readFileSync = function(file, ...args) {
        return read.call(this, replacements.get(String(file)) || file, ...args);
    };
}
