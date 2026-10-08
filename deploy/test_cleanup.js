'use strict';
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {cleanup} = require('./cleanup');
(async()=>{
 let emits=0;
 const unauth={authenticated:false,socket:{connected:true,emit(){emits++;throw Error('unauthenticated emit')}}};
 assert.equal((await cleanup([unauth],20)).status,'skipped'); assert.equal(emits,0);
 console.log('PASS authentication failure: zero unauthenticated cleanup operations; immediate return');
 for(const failure of [false,true]) {
   const db=[{run:'real',id:1},{run:'otherSmoke',id:2},{run:'ours',id:3}];
   const socket=new EventEmitter();socket.connected=true;
   socket.on('cleanupSmokeRun',()=>{
     db.splice(db.findIndex(x=>x.run==='ours'),1);
     socket.emit('smokeRunCleaned',{deleted:1});
   });
   // Cleanup is called in finally for both original outcomes; records are a mocked server policy.
   try {if(failure) throw Error('original gameplay failure')} catch {} finally {
     assert.equal((await cleanup([{authenticated:true,socket}],20)).status,'complete');
   }
   assert.deepEqual(db,[{run:'real',id:1},{run:'otherSmoke',id:2}]);
   assert.equal(socket.listenerCount('smokeRunCleaned'),0);
   console.log(`PASS ${failure?'failure':'success'} authenticated cleanup preserves real/other smoke records (mock policy); listeners removed`);
 }
 const socket=new EventEmitter();socket.connected=true;
 await assert.rejects(cleanup([{authenticated:true,socket}],10),/timeout/);
 assert.equal(socket.listenerCount('smokeRunCleaned'),0);
 console.log('PASS bounded cleanup timeout retains failure; listeners removed');
})().catch(e=>{console.error(e);process.exitCode=1});
