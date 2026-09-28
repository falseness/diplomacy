'use strict';
// Diagnostic only: sample the isolated server without changing game handlers,
// clocks, inputs or deadlines. Profiles contain code locations, not game payloads.
const fs = require('node:fs');
const path = require('node:path');
const out = process.env.ONLINE_EVIDENCE_DIR;
if (!out) throw new Error('ONLINE_EVIDENCE_DIR required');
if (path.basename(process.argv[1] || '') === 'index.js') {
    const inspector = require('node:inspector');
    const session = new inspector.Session();
    session.connect();
    const post = (method, params = {}) => new Promise((resolve, reject) =>
        session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
    let sequence = 0;
    async function sample() {
        await post('Profiler.start');
        const timer = setTimeout(async () => {
            try {
                const {profile} = await post('Profiler.stop');
                fs.writeFileSync(path.join(out, `server-cpu-${++sequence}.json`), JSON.stringify(profile), {flag: 'wx'});
                await sample();
            } catch (error) { console.error('JOIN_PROFILE_FAILED', error); process.exitCode = 1; }
        }, 5000);
        timer.unref();
    }
    post('Profiler.enable').then(() => post('Profiler.setSamplingInterval', {interval: 1000}))
        .then(sample).catch(error => { console.error('JOIN_PROFILE_FAILED', error); process.exitCode = 1; });
} else {
    const services = require('/root/diplomacy_server/tests/reliability/helpers/services');
    const original = services.withServices;
    services.withServices = (options, execute) => original({...options,
        serverPreloads: [...(options.serverPreloads || []), __filename]}, execute);
    require('./trace_twelve_coop_join');
}
