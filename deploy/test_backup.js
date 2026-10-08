'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {backup, verifyBackup} = require('./backup');
const {BSON} = require(path.join(process.env.DIPLOMACY_SERVER_ROOT, 'server/node_modules/mongodb'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-fixtures-'));
try {
    const tools = path.join(temp, 'tools'); fs.mkdirSync(tools);
    const shell = path.join(tools, 'mongosh');
    fs.writeFileSync(shell, '#!/bin/sh\nprintf \'%s\\n\' \'{"empty":0,"games":2}\'\n', {mode: 0o700});
    const dump = path.join(tools, 'mongodump');
    const parent = path.join(temp, 'backups'); fs.mkdirSync(parent);
    fs.writeFileSync(path.join(parent, 'previous-release'), 'preserved');
    const valid = Buffer.concat([BSON.serialize({_id: 1}), BSON.serialize({_id: 2})]);
    function fake(mode) {
        fs.writeFileSync(dump, '#!' + process.execPath + '\n' + `
const fs=require('fs'),path=require('path');
if (${JSON.stringify(mode)}==='command') process.exit(7);
const dest=path.join(process.argv[process.argv.indexOf('--out')+1],'gameDB');fs.mkdirSync(dest);
let b=Buffer.from('${valid.toString('base64')}','base64');
if (${JSON.stringify(mode)}==='truncation') b=b.subarray(0,b.length-1);
if (${JSON.stringify(mode)}==='count') b=b.subarray(0,b.readInt32LE(0));
if (${JSON.stringify(mode)}==='corrupt') b[b.length-1]=5;
fs.writeFileSync(path.join(dest,'games.bson'),b);
fs.writeFileSync(path.join(dest,'games.metadata.json'),'{}');
if (${JSON.stringify(mode)}!=='missing') {
fs.writeFileSync(path.join(dest,'empty.bson'),'');fs.writeFileSync(path.join(dest,'empty.metadata.json'),'{}');}
`, {mode: 0o700});
    }
    const opts = {directory: parent, quiesced: true, BSON, mongosh: shell, mongodump: dump};
    assert.throws(() => backup({...opts, quiesced: false}), /quiesce/);
    console.log('PASS caller quiescence required');
    fake('valid'); const a = backup(opts), b = backup(opts); assert.notEqual(a.path, b.path);
    verifyBackup(a.path);
    fs.appendFileSync(path.join(a.path, 'gameDB/games.bson'), 'corrupt');
    assert.throws(() => verifyBackup(a.path), /Corrupt/);
    fs.writeFileSync(path.join(a.path, 'gameDB/games.bson'), valid);
    verifyBackup(a.path);
    assert.throws(() => verifyBackup(path.join(temp, 'absent')));
    console.log('PASS activation support rejects missing/corrupt saved backup');
    console.log('PASS unique backups preserve previous backups/releases; empty collection valid');
    for (const mode of ['command', 'truncation', 'count', 'corrupt', 'missing']) {
        fake(mode); assert.throws(() => backup(opts));
        console.log('PASS rejected ' + mode + '; no validated receipt activation or restore');
    }
    fake('valid');
    fs.writeFileSync(shell, '#!/bin/sh\nif [ -f "' + temp + '/counted" ]; then echo \'{"empty":0,"games":3}\'; else touch "' + temp + '/counted"; echo \'{"empty":0,"games":2}\'; fi\n');
    assert.throws(() => backup(opts), /changed/);
    console.log('PASS quiescent before/after count mismatch rejected');
    assert.equal(fs.readFileSync(path.join(parent, 'previous-release'), 'utf8'), 'preserved');
    const receipts = fs.readdirSync(parent).filter(n => n.startsWith('gameDB-')).filter(n => fs.existsSync(path.join(parent,n,'validated.json')));
    assert.equal(receipts.length, 2);
    console.log('PASS failed backups have no success receipt; previous backups/releases preserved');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
