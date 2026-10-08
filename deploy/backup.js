'use strict';
// Standalone support only: caller must stop all writers and retain that state
// until activation/abort. No restore, drop, service or activation command exists here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

function backup({directory, uri = 'mongodb://127.0.0.1:27017', quiesced = false,
                 mongosh = 'mongosh', mongodump = 'mongodump', BSON}) {
    if (!quiesced) throw new Error('Caller must quiesce all production writes');
    if (!BSON) throw new Error('Pinned candidate mongodb.BSON required');
    // Credentials belong in protected local MongoDB configuration, never CLI/logs.
    const url = new URL(uri);
    if (url.protocol !== 'mongodb:' || url.username || url.password || url.search ||
        !['127.0.0.1', 'localhost'].includes(url.hostname) || !['', '/'].includes(url.pathname))
        throw new Error('Expected credential-free loopback MongoDB URI');
    const execute = (cmd, args) => {
        try { return execFileSync(cmd, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}); }
        catch { throw new Error('Backup command failed: ' + path.basename(cmd)); }
    };
    const counts = () => {
        const data = JSON.parse(execute(mongosh, [uri + '/gameDB', '--quiet', '--eval',
            'const cols=db.getCollectionInfos(); if(cols.some(c=>c.type!=="collection")) throw Error("unsupported collection"); print(JSON.stringify(Object.fromEntries(cols.map(c=>[c.name,db.getCollection(c.name).countDocuments({})]).sort((a,b)=>a[0].localeCompare(b[0])))));']));
        for (const [name, n] of Object.entries(data)) {
            if (!name || name.includes('/') || name.includes('\\') || name === '..' || !Number.isSafeInteger(n) || n < 0)
                throw new Error('Invalid collection counts');
        }
        return Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
    };
    const before = counts();
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    const dest = fs.mkdtempSync(path.join(directory, 'gameDB-' + new Date().toISOString().replace(/[:.]/g, '-') + '-'));
    fs.chmodSync(dest, 0o700);
    // Failed directories deliberately remain for diagnosis; no success receipt.
    execute(mongodump, ['--uri', uri, '--db', 'gameDB', '--out', dest]);
    const after = counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Database changed while quiesced');
    const dumped = path.join(dest, 'gameDB');
    const expected = Object.keys(before).flatMap(n => [n + '.bson', n + '.metadata.json']).sort();
    if (JSON.stringify(fs.readdirSync(dumped).sort()) !== JSON.stringify(expected)) throw new Error('Incomplete dump collection set');
    const files = {};
    let bytes = 0;
    for (const [name, expectedCount] of Object.entries(before)) {
        const file = path.join(dumped, name + '.bson');
        if (!fs.lstatSync(file).isFile()) throw new Error('Nonregular BSON file');
        const data = fs.readFileSync(file);
        let offset = 0, count = 0;
        while (offset < data.length) {
            if (offset + 4 > data.length) throw new Error('Truncated BSON');
            const size = data.readInt32LE(offset);
            if (size < 5 || offset + size > data.length) throw new Error('Truncated BSON');
            BSON.deserialize(data.subarray(offset, offset + size));
            count++; offset += size;
        }
        if (count !== expectedCount) throw new Error('BSON count mismatch');
        const meta = path.join(dumped, name + '.metadata.json');
        if (!fs.lstatSync(meta).isFile()) throw new Error('Nonregular metadata');
        JSON.parse(fs.readFileSync(meta, 'utf8'));
        for (const p of [file, meta]) {
            fs.chmodSync(p, 0o600);
            const content = fs.readFileSync(p); bytes += content.length;
            files[path.basename(p)] = crypto.createHash('sha256').update(content).digest('hex');
        }
    }
    const receipt = {complete: true, database: 'gameDB', path: dest, bytes, counts: before, files};
    fs.writeFileSync(path.join(dest, 'validated.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    console.log('PASS count-validated unique full gameDB dump ' + JSON.stringify(receipt));
    return receipt;
}
// Later activation must call this immediately before using the receipt.
function verifyBackup(dest) {
    const receipt = JSON.parse(fs.readFileSync(path.join(dest, 'validated.json'), 'utf8'));
    if (receipt.complete !== true || receipt.database !== 'gameDB' || receipt.path !== dest)
        throw new Error('Invalid backup receipt');
    const expected = Object.keys(receipt.counts).flatMap(n => [n + '.bson', n + '.metadata.json']).sort();
    if (JSON.stringify(expected) !== JSON.stringify(Object.keys(receipt.files).sort()) ||
        JSON.stringify(expected) !== JSON.stringify(fs.readdirSync(path.join(dest, 'gameDB')).sort()))
        throw new Error('Incomplete backup receipt/files');
    let bytes = 0;
    for (const name of expected) {
        if (path.basename(name) !== name || name.includes('\\')) throw new Error('Unsafe backup path');
        const file = path.join(dest, 'gameDB', name);
        if (!fs.lstatSync(file).isFile()) throw new Error('Nonregular backup file');
        const data = fs.readFileSync(file); bytes += data.length;
        if (crypto.createHash('sha256').update(data).digest('hex') !== receipt.files[name])
            throw new Error('Corrupt backup');
    }
    if (bytes !== receipt.bytes) throw new Error('Backup size mismatch');
    return receipt;
}
module.exports = {backup, verifyBackup};
if (require.main === module) {
    const [directory, candidate, flag] = process.argv.slice(2);
    if (!directory || !candidate || flag !== '--writes-quiesced') throw new Error('Usage: backup.js BACKUP_PARENT CANDIDATE --writes-quiesced');
    const {BSON} = require(path.resolve(candidate, 'diplomacy_server/server/node_modules/mongodb'));
    backup({directory, quiesced: true, BSON});
}
