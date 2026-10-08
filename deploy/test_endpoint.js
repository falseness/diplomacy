'use strict';
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {Server} = require('socket.io');
const {probe} = require('./endpoint');
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tmp+'/key',
        '-out', tmp+'/cert', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], {stdio:'ignore'});
    const opts = {key: fs.readFileSync(tmp+'/key'), cert: fs.readFileSync(tmp+'/cert')};
    const right = https.createServer(opts), wrong = https.createServer(opts, (req,res) => res.end('HTTP OK'));
    const io = new Server(right);
    let connections = 0, events = 0;
    io.on('connection', socket => {connections++; socket.onAny(() => events++);});
    await Promise.all([right,wrong].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
    // Child uses the same CLI as production; trust only this disposable fixture CA.
    const {spawn} = require('node:child_process');
    const child = (port, trust=true) => new Promise(resolve => {
        const p = spawn(process.execPath, [path.join(__dirname,'endpoint.js'), 'wss://localhost:'+port],
            {env:{...process.env, ...(trust ? {NODE_EXTRA_CA_CERTS:tmp+'/cert'} : {})}});
        p.stdout.pipe(process.stdout);p.stderr.pipe(process.stdout);p.on('exit',resolve);
    });
    try {
        assert.equal(await child(wrong.address().port), 1);
        console.log('PASS wrong endpoint HTTP success is not Socket.IO readiness');
        assert.equal(await child(right.address().port, false), 1);
        console.log('PASS untrusted TLS rejected');
        assert.equal(await child(right.address().port), 0);
        assert.equal(connections, 1);assert.equal(events, 0);
        await assert.rejects(probe('ws://localhost:8080'), /credential-free wss/);
        console.log('PASS right endpoint TLS Engine.IO Socket.IO connected; application events=0; TLS required');
    } finally {
        await new Promise(r => io.close(r));
        await new Promise(r => wrong.close(r));
        fs.rmSync(tmp,{recursive:true,force:true});
    }
})().catch(e => {console.error(e);process.exitCode=1;});
