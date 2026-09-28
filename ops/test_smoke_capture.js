'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('./smoke_capture_provider');
test('opt-in pinned capture preserves original assertions and real service calls',()=>{
 const original=fs.readFileSync(P.FILE,'utf8'),transformed=P.instrument(original);
 new vm.Script(transformed,{filename:P.FILE});
 for(const line of original.split('\n').filter(l=>l.includes('check(')||l.includes('assert.'))){
  const tokens=line.match(/(?:assert\.\w+|check)\([^;]+/g)||[];
  for(const token of tokens)assert(transformed.includes(token),'original assertion '+token);
 }
 assert(transformed.includes('await withServices('));assert(transformed.includes('h.client.emit(event,JSON.stringify('));
 for(const marker of ["capture.inventory('matched')","capture.inventory('cleanup-before')","capture.inventory('cleanup-after')","capture.expired('before'","capture.expired('after'","capture.scan(logDir)"])assert(transformed.includes(marker),marker);
});
test('changed provider fails closed',()=>assert.throws(()=>P.instrument(fs.readFileSync(P.FILE,'utf8')+'\n'),/unreviewed smoke provider/));
