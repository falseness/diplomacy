'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),R=require('./review_camera_evidence');
const provider='/root/diplomacy/artifacts/TASK-213/green-09';
test('original camera observations independently satisfy four complete historical criteria',()=>{const r=R.review(provider);assert.equal(r.checks.length,608);assert.deepEqual(r.criteria,[1,2,3,7]);});
for(const [name,file,mutate,reason] of [
 ['wrong scale','scale-checkpoints.json',x=>x[0].observed.scale=0.5,/observed\/scale/],
 ['wrong rebound expectation','scale-checkpoints.json',x=>{x[0].observed.scale=x[0].expected.scale=0.5;},/observed\/scale/],
 ['frozen frames','scale-checkpoints.json',x=>x[0].held.frameTime=x[0].before.frameTime,/advancing-frames/],
 ['frozen active clock','scale-checkpoints.json',x=>x[0].held.clock.left=x[0].before.clock.left,/natural-clock/],
 ['wrong victim','scale-checkpoints.json',x=>x[4].observed.victimAbsent=false,/victim/],
 ['wrong selection','scale-checkpoints.json',x=>x[4].observed.selected='noob',/selected/],
 ['blank rendered board','scale-checkpoints.json',x=>x[0].observed.pixelColors=1,/usable/],
 ['omitted milestone','scale-checkpoints.json',x=>x.pop(),/milestones/],
 ['wrong map seed','coop-zoom/declared-fixture.json',x=>x.spec.seed=2,/fixture/],
 ['wrong high count shape','checkpoints.json',x=>x.checkpoints[0].observed.players=10,/source-10/],
 ['uncaught console error','render-console.jsonl',x=>x.push({type:'error',text:'undefined drawChanceOfWinningText'}),/console-errors/]
])test('rejects '+name+' after rebinding evidence hash',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'camera-semantic-'));try{
 fs.cpSync(provider,dir,{recursive:true});const p=path.join(dir,file),jsonl=file.endsWith('.jsonl'),x=jsonl?fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):A.read(p);mutate(x);fs.writeFileSync(p,jsonl?x.map(JSON.stringify).join('\n')+'\n':JSON.stringify(x)+'\n');const c=A.read(path.join(dir,'coverage-results.json'));c.evidenceHashes[file]=A.hash(p);fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(c));assert.throws(()=>R.review(dir),reason);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// Source-only observer regression: fake DOM dispatch tests the counter, not UI.
test('standard wheel observer is passive, idempotent and independent of game state',async()=>{
 const vm=require('node:vm'),listeners=[],sandbox={window:{},performance:{now:()=>12},document:{addEventListener:(name,callback,options)=>listeners.push({name,callback,options})}};
 const player={page:{evaluate:fn=>vm.runInNewContext('('+fn.toString()+')()',sandbox)}};
 const {install}=require('./camera_wheel_observer');await install(player);await install(player);
 assert.equal(listeners.length,1);assert.equal(listeners[0].name,'wheel');assert.equal(listeners[0].options.passive,true);
 listeners[0].callback({deltaY:400,isTrusted:true});assert.equal(sandbox.window.__zoomWheels,1);
 assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.__task225WheelEvents)),[{time:12,deltaY:400,trusted:true}]);
 assert.deepEqual(Object.keys(sandbox.window).sort(),['__task225WheelEvents','__zoomWheels']);
});
test('four initial pages open concurrently; original named/device order is retained',async()=>{
 const {pooledOpen}=require('./camera_wheel_observer'),calls=[],releases=[],browser={},errors=[],trace=[];
 const open=pooledOpen((b,o)=>{calls.push([o.name,o.input]);return new Promise(resolve=>releases.push(()=>resolve({name:o.name,trace:r=>trace.push([o.name,r])})));});
 const options={name:'p1',input:'mouse',screenshotDir:'/test/coop-zoom/screenshots',endpoint:'local',clientUrl:'local-client',errors};
 const first=open(browser,options);assert.deepEqual(calls,[['p1','mouse'],['p2','touch'],['p3','mouse'],['p4','mouse']]);
 releases.forEach(release=>release());assert.equal((await first).name,'p1');
 for(const n of [2,3,4])assert.equal((await open(browser,{...options,name:'p'+n,input:n===2?'touch':'mouse'})).name,'p'+n);
 assert.equal(calls.length,4);assert.equal(trace.length,4);assert(trace.every(([,r])=>r.participants===4&&r.finishedAt>=r.startedAt));
});
test('failed page opening fails the pool without retrying or dropping a context',async()=>{
 const {pooledOpen}=require('./camera_wheel_observer');let calls=0;
 const open=pooledOpen(async(b,o)=>{calls++;if(o.name==='p2')throw Error('declared opening failure');return {trace(){}};});
 await assert.rejects(open({},{name:'p1',screenshotDir:'/test/coop-zoom/screenshots'}),/declared opening failure/);assert.equal(calls,4);
});
test('initial join uses an already loaded menu; later recovery retains real reload',async()=>{
 const {reuseInitialMenu}=require('./camera_wheel_observer'),calls=[],trace=[],p={screenshotDir:'/test/coop-zoom/screenshots',trace:r=>trace.push(r)};
 const reconnect=reuseInitialMenu(async(player,options)=>calls.push(options));
 const options={password:'fixture-only',coop:true};await reconnect(p,options);await reconnect(p,options);
 assert.deepEqual(calls,[{...options,alreadyAtMenu:true},options]);assert.deepEqual(trace,[{action:'initial-menu-already-loaded'}]);assert.deepEqual(options,{password:'fixture-only',coop:true});
});
test('touch initial join retains the original reload option',async()=>{
 const {reuseInitialMenu}=require('./camera_wheel_observer'),calls=[],trace=[],p={input:'touch',screenshotDir:'/test/coop-zoom/screenshots',trace:r=>trace.push(r)};
 const reconnect=reuseInitialMenu(async(player,options)=>calls.push(options)),options={coop:true};await reconnect(p,options);await reconnect(p,options);
 assert.deepEqual(calls,[options,options]);assert.deepEqual(trace,[{action:'initial-menu-reload-retained'}]);
});

test('separately sampled budget timestamps must fit the actual OS interval',()=>{
 const start=Date.parse('2026-09-27T16:37:40.051Z');
 const budget={startedAt:new Date(start).toISOString(),finishedAt:new Date(start+972729).toISOString(),elapsedMs:972723};
 const receipt={startedMs:start-477,finishedMs:start+973415};
 assert(R.timingWithinReceipt(budget,receipt));
 assert(!R.timingWithinReceipt({...budget,elapsedMs:972730},receipt));
 assert(!R.timingWithinReceipt(budget,{...receipt,startedMs:start+1}));
 assert(!R.timingWithinReceipt(budget,{...receipt,finishedMs:start+972728}));
 assert(!R.timingWithinReceipt(budget,{...receipt,finishedMs:receipt.startedMs+3600001}));
 assert(!R.timingWithinReceipt({...budget,finishedAt:new Date(start+3600001).toISOString()},{...receipt,finishedMs:start+3600002}));
});
test('participant commit waits for readiness then performs exactly one original input',async()=>{
 const {readyParticipantCommit}=require('./camera_wheel_observer'),order=[];
 const player={screenshotDir:'/test/coop-zoom/screenshots',page:{waitForFunction:async(fn,arg,options)=>{assert.equal(options.timeout,10000);assert(fn.toString().includes('nextTurnButton.canClick&&!nextTurnButton.unactive'));order.push('ready');}},observe:async()=>({canClick:true,unactive:false,waiting:false}),trace:r=>order.push(r.action)};
 const tap=readyParticipantCommit(async function(...args){assert.equal(this,player);order.push('input');assert.deepEqual(args,['nextTurnButton','commit participant','original effect']);});
 await tap.call(player,'nextTurnButton','commit participant','original effect');assert.deepEqual(order,['ready','participant-commit-ready','input']);
});
test('participant readiness failure propagates without clicking or retrying',async()=>{
 const {readyParticipantCommit}=require('./camera_wheel_observer');let clicks=0,waits=0;
 const player={screenshotDir:'/test/coop-zoom/screenshots',page:{waitForFunction:async()=>{waits++;throw Error('readiness timeout');}}};
 const tap=readyParticipantCommit(async()=>{clicks++;});await assert.rejects(tap.call(player,'nextTurnButton','commit participant'),/readiness timeout/);assert.equal(clicks,0);assert.equal(waits,1);
});

test('HTTP failure observer records only safe error facts and ignores successful payloads',async()=>{
 const {observeHttpFailures}=require('./camera_wheel_observer'),rows=[];let callback;
 const player={page:{on:(name,fn)=>{assert.equal(name,'response');callback=fn;}},trace:r=>rows.push(r)};
 assert.equal(observeHttpFailures(player),player);
 await callback({status:()=>200,json:()=>{throw Error('must not inspect successful response');}});
 await callback({status:()=>400,json:async()=>({code:1,message:'Session ID unknown',password:'must-not-log'})});
 await callback({status:()=>500,json:async()=>({code:'must-not-log',message:'arbitrary-sensitive-content'})});
 assert.deepEqual(rows,[{action:'http-error-response',status:400,code:1,message:'Session ID unknown'},{action:'http-error-response',status:500,code:null,message:null}]);
});
test('passive peers preserve real packet observations without installing routes or responses',async()=>{
 const {passivePeerTransport}=require('./camera_wheel_observer'),handlers=new Map(),rows=[],inputs=[];
 const player={name:'p3',page:{on:(n,f)=>handlers.set(n,f),off:n=>handlers.delete(n)},trace:r=>inputs.push(r)};
 const transport=passivePeerTransport(player,(stage,data)=>rows.push({stage,...data}));
 const packet='42'+JSON.stringify(['nextTurn',JSON.stringify({gameRound:0})]);
 handlers.get('request')({url:()=> 'https://local/socket.io/',postData:()=>packet});
 handlers.get('response')({url:()=> 'https://local/socket.io/',status:()=>200,text:async()=> '42["playYourTurn",{}]'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(transport.turns.length,1);assert.equal(transport.packets.length,1);assert.deepEqual(transport.failures,[]);
 assert.deepEqual(rows.map(r=>r.stage),['outgoing-turn','upstream-receipt']);
 assert.equal(inputs[0].action,'native-peer-transport');
 handlers.get('response')({url:()=> 'https://local/socket.io/',status:()=>400,text:async()=> '{"code":1}'});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(transport.failures,['HTTP 400']);
 await transport.close();assert.equal(handlers.size,0);assert.equal(rows.at(-1).mode,'native-peer-observation');
});
