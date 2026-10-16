#!/usr/bin/env bash
# Bounded storage experiment, deliberately outside the runtime input closure.
# This is not installed in the native service runner and cannot admit refreshes.
set -euo pipefail
/usr/local/bin/node20 - "$@" <<'JS'
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const base=fs.realpathSync('/root/diplomacy/artifacts')+'/TASK-998';
const out=fs.realpathSync(process.argv[2]);
assert(out.startsWith(base+'/'),'evidence must be inward');
const owned=fs.mkdtempSync(out+'/budget-owned-');
// A single coordinator owns the ledger. All native writers would have to route
// through it; independent per-process budgets do NOT enforce a shared ceiling.
class Budget {
 constructor(root,limit,reserve) {
  assert(Number.isSafeInteger(limit)&&Number.isSafeInteger(reserve)&&reserve>=0&&limit>reserve);
  this.root=root;this.limit=limit;this.reserve=reserve;this.live=0;this.peak=0;this.serial=0;
  this.files=new Map();this.failed=false;
 }
 file(name) {assert(/^[a-z0-9.-]+$/.test(name)&&!['.','..'].includes(name));return path.join(this.root,name);}
 append(name,bytes,emergency=false) {
  assert(Buffer.isBuffer(bytes));if(this.failed&&!emergency)throw Error('transaction failed');
  const ceiling=this.limit-(emergency?0:this.reserve);
  if(bytes.length>ceiling-this.live){this.failed=true;throw Error('byte budget exceeded');}
  const p=this.file(name);assert(!fs.existsSync(p)||this.files.has(name),'unowned file');
  // Charge the full request BEFORE the filesystem call, including partial-write
  // failures. A failed transaction may only emit reserved failure metadata.
  this.live+=bytes.length;this.peak=Math.max(this.peak,this.live);
  this.files.set(name,(this.files.get(name)||0)+bytes.length);
  let fd;
  try {fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);}
  catch(e){this.failed=true;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 replace(name,bytes) {
  const tmp='atomic-'+this.serial++;
  this.append(tmp,bytes); // old and entire replacement coexist, never charge only delta
  try {fs.renameSync(this.file(tmp),this.file(name));}
  catch(e){this.failed=true;throw e;}
  this.live-=this.files.get(name)||0;this.files.delete(name);
  this.files.set(name,this.files.get(tmp));this.files.delete(tmp);
 }
 failure(reason) {
  this.failed=true;
  // Fixed vocabulary: never serialize arbitrary producer text into reserve.
  assert(['quota','io','producer'].includes(reason));
  this.append('failure.json',Buffer.from(JSON.stringify({result:'FAIL',reason})+'\n'),true);
 }
 cleanup(){for(const name of this.files.keys())fs.rmSync(this.file(name),{force:true});this.files.clear();this.live=0;}
}
const measurements=[];
function test(name,fn){const dir=fs.mkdtempSync(owned+'/case-');const b=new Budget(dir,4096,128);try{fn(b);measurements.push({name,peakBytes:b.peak,limitBytes:b.limit,failed:b.failed});assert(b.peak<=b.limit);console.log('PASS '+name);}finally{b.cleanup();assert.equal(fs.readdirSync(dir).length,0);fs.rmdirSync(dir);}}
(async()=>{
 try {
 test('exact boundary accepts complete bytes; next byte rejected before write',b=>{
  b.append('log',Buffer.alloc(3968,97));assert.throws(()=>b.append('log',Buffer.alloc(1)),/byte budget/);
  assert.equal(fs.statSync(b.file('log')).size,3968);b.failure('quota');assert.equal(JSON.parse(fs.readFileSync(b.file('failure.json'))).result,'FAIL');
  assert.throws(()=>b.append('later',Buffer.alloc(0)),/transaction failed/);
 });
 test('atomic replacement charges old plus new; rejected replacement preserves original',b=>{
  b.append('report',Buffer.alloc(2000,97));assert.throws(()=>b.replace('report',Buffer.alloc(2000,98)),/byte budget/);
  assert.equal(fs.readFileSync(b.file('report')).toString(),'a'.repeat(2000));assert.equal(fs.readdirSync(b.root).length,1);
 });
 test('successful atomic replacement releases old bytes only after rename',b=>{
  b.append('report',Buffer.alloc(1000,97));b.replace('report',Buffer.alloc(2000,98));assert.equal(b.peak,3000);assert.equal(b.live,2000);
  assert.equal(fs.readFileSync(b.file('report')).toString(),'b'.repeat(2000));
 });
 test('interleaved log and proof writers share one ceiling',b=>{
  b.append('log',Buffer.alloc(1800));b.append('proof',Buffer.alloc(1800));assert.throws(()=>b.append('log',Buffer.alloc(369)),/byte budget/);
  assert.equal(fs.statSync(b.file('proof')).size+fs.statSync(b.file('log')).size,3600);
 });
 test('filesystem failure fails closed and reserve retains failure marker',b=>{
  const original=fs.writeFileSync;fs.writeFileSync=()=>{const e=Error('injected ENOSPC');e.code='ENOSPC';throw e;};
  try{assert.throws(()=>b.append('blocked',Buffer.alloc(16)),/ENOSPC/);}finally{fs.writeFileSync=original;}
  assert.equal(b.failed,true);assert.equal(b.live,16);b.failure('io');
 });
 test('path escape and unowned file rejected',b=>{
  assert.throws(()=>b.append('../escape',Buffer.alloc(1)));fs.symlinkSync('/dev/null',b.file('link'));
  assert.throws(()=>b.append('link',Buffer.alloc(1)),/unowned/);fs.unlinkSync(b.file('link'));
 });
 // Actual child stdout/stderr are piped through the coordinator, never inherited
 // file descriptors (native runner currently uses inherited fds and bypasses it).
 const dir=fs.mkdtempSync(owned+'/producer-'),b=new Budget(dir,4096,128);
 const command=[process.execPath,'-e','setInterval(()=>{process.stdout.write(Buffer.alloc(512,65));process.stderr.write(Buffer.alloc(512,66));},1)'];
 const child=spawn(command[0],command.slice(1),{stdio:['ignore','pipe','pipe']});let rejected=false,expired=false,spawnError=null;
 const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},5000);
 const receive=name=>chunk=>{if(rejected)return;try{b.append(name,chunk);}catch(e){assert.match(e.message,/byte budget/);rejected=true;child.kill('SIGKILL');}};
 child.stdout.on('data',receive('stdout'));child.stderr.on('data',receive('stderr'));
 child.on('error',e=>{spawnError=e.message;});
 const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 clearTimeout(timer);
 try {
  assert.equal(spawnError,null);assert.equal(expired,false);assert(rejected);assert.equal(result.signal,'SIGKILL');b.failure('quota');
  const actual=fs.readdirSync(dir).reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);assert.equal(actual,b.live);assert(actual<=4096);
  measurements.push({name:'owned producer overflow',command,exit:result,peakBytes:b.peak,limitBytes:b.limit,failed:true});
  console.log('PASS owned producer overflow killed; bounded prefix marked FAIL; no receipt certification');
 }finally{b.cleanup();fs.rmdirSync(dir);}
 assert.equal(fs.readdirSync(owned).length,0);
 fs.writeFileSync(out+'/budget-results.json',JSON.stringify({measurements,servicesStarted:false,nativeInstalled:false,reservationAdmitted:false,temporaryFilesRemaining:0,closedTerm:'Writes routed through a sole coordinator cannot exceed its byte ceiling, including atomic overlap and bounded failure metadata.',unresolved:['Native inherited log fds bypass coordinator','Scenario direct writes bypass coordinator','Runtime database/browser files need independent disposable-resource handling','Full-volume retained allocation and report quotas not chosen','Oversized proof fails; a quota does not prove every scenario will fit']},null,2)+'\n');
 console.log('PASS success/failure owned cleanup temporaryFilesRemaining=0');
 console.log('NOT ADMITTED: native routing and full-volume successful-proof capacity unresolved');
 }finally{fs.rmSync(owned,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
JS
