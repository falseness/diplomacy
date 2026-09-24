'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {supervise} = require('./task245-supervisor');
(async () => {
  const out = process.argv[2] || path.join(process.env.COOP_EVIDENCE_DIR, 'supervisor'); fs.mkdirSync(out, {recursive:true});
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task245-sentinel-'));
  try {
    const fixture = path.join(out, 'stalled.js');
    fs.writeFileSync(fixture, `const fs=require('node:fs'),cp=require('node:child_process');
fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'task245-owned-'));
cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    const r = await supervise({program:process.execPath,args:[fixture],journal:path.join(out,'forced.jsonl'),stopAt:Date.now()+1000,graceMs:200});
    assert.equal(r.status,1); assert.equal(r.timedOut,true); assert.equal(r.cleanup,true);
    assert(r.processes.length>=2); assert(r.directories.length>=1);
    assert(fs.existsSync(sentinelDir)); process.kill(sentinel.pid,0);
    console.log('PASS forced-timeout failure=true detached-processes-stopped=true owned-directories-removed=true sentinel-preserved=true');
    const g = await supervise({program:process.execPath,args:['-e',"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],journal:path.join(out,'graceful.jsonl'),stopAt:Date.now()+1000,graceMs:500});
    assert.equal(g.timedOut,true);assert.equal(g.cleanup,true);assert.equal(g.status,1);
    console.log('PASS graceful-cancellation cleanup=true timeout-remains-failure=true');
  } finally { sentinel.kill();fs.rmSync(sentinelDir,{recursive:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
