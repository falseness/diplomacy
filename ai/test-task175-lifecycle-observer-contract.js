#!/usr/bin/env node
'use strict';
// Offline only: the pinned client runs unchanged apart from recording insertions.
// XMLHttpRequest and timers are explicit boundary adapters; no sockets/services.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto'), cp = require('node:child_process');
const assert = require('node:assert/strict');
const hooks = require('./diagnostics/task175/lifecycle-v2-hooks');
const {lifecycleRecorder, validate} = require('./diagnostics/task175/lifecycle-v2-recorder');
const hashFactory = require('./diagnostics/task175/recorder');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const git = (cwd, ...args) => cp.execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
const scenarios = [
    {id:'successful-write', sessions:1, joins:2, terminal:'success'},
    {id:'reconnect-buffered', sessions:2, joins:2, terminal:'success'},
    {id:'late-old-response', sessions:2, joins:2, terminal:'success'},
    {id:'post-error', sessions:1, joins:1, terminal:'error'},
    {id:'explicit-abort', sessions:1, joins:1, terminal:'abort'},
    {id:'missing-terminal', sessions:1, joins:1, terminal:'pending'},
];
const declaration = {scope:'offline observer contract; no network/gameplay/timing claims', scenarios,
    adapters:{io:'In-memory XMLHttpRequest; response bytes/status delivered only by declared steps. Real Request, XHR polling, Engine, Manager and Socket execute.', timers:'Finite queue; run only delay=0 HTTP error callback or delay=5 Manager reconnect callback. Heartbeats remain scheduled and are never advanced.', abort:'Call actual Request.abort; pinned implementation detaches callbacks (does not call native xhr.abort).'},
    expected:{identicalPayloads:'Distinct application occurrences, same digest; buffered packet ancestry retained', late:'Original Request and original Engine/session, never current Manager.engine', validity:'Error and explicit abort are observed terminals, not successful delivery; missing terminal stays pending/invalid'},
    schedule:['Open Engine A and namespace via GET responses; acknowledge namespace POST', 'Emit joins per scenario; acknowledge, error, abort or withhold their POST', 'Reconnect scenarios: GET close packet, retain old POST if late, run actual reconnect timer, buffer two identical joins, open Engine B and namespace, acknowledge new POSTs, then late old POST', 'Abort remaining GET Requests individually; complete close POSTs; withhold only the declared missing POST; flush']};
const bundlePath = path.join(root, 'artifacts/TASK-175/transport-20260921/socket.io-3.0.0.js');
const source = fs.readFileSync(bundlePath, 'utf8');
assert.equal(sha(source), 'e3ea5880b996b7c89a9475540bbc0dbc0ab556beac6f42b6d8ec727218f2d51a');
const output = process.argv[process.argv.indexOf('--output-dir') + 1];
if (!process.argv.includes('--output-dir') || !output || fs.existsSync(output)) throw Error('Fresh --output-dir required');
fs.mkdirSync(output, {recursive:true});
const save = (name, value) => fs.writeFileSync(path.join(output,name), typeof value === 'string' ? value : JSON.stringify(value,null,2)+'\n', {flag:'wx'});
const log = fs.openSync(path.join(output,'verification.log'),'wx');
for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...args) => { fs.writeSync(log, chunk); return write(chunk, ...args); };
}
process.on('exit', code => fs.writeSync(log, `ACTUAL_EXIT=${code}\n`));
console.log('COMMAND='+JSON.stringify([process.execPath,...process.argv.slice(1)]));
console.log('ENV NODE_OPTIONS='+JSON.stringify(process.env.NODE_OPTIONS)+' NODE_PATH='+JSON.stringify(process.env.NODE_PATH));
console.log('cwd='+process.cwd()+' node='+process.version+' browser=none services=none network=none');
save('predeclaration.json',declaration);
const original = hooks.client(source);
// Independent branch witness. Captures real object references from source entry,
// without supplying recorder rows or replacing any protocol method.
const mod = '/***/ "./node_modules/engine.io-client/lib/transports/polling-xhr.js":';
const start = original.text.indexOf(mod), end = original.text.indexOf('\n/***/ "',start+mod.length);
const witness = hooks.transform(original.text.slice(start,end), [], [
    ['witness-create','value: function create() {','globalThis.__contract.observe("create",this);'],
    ['witness-success','value: function onSuccess() {','globalThis.__contract.observe("success",this);'],
    ['witness-error','value: function onError(err) {','globalThis.__contract.observe("error",this);'],
    ['witness-abort','value: function abort() {','globalThis.__contract.observe("abort",this);'],
]);
const transformed = original.text.slice(0,start)+witness.text+original.text.slice(end);
save('hook-manifest.json',{client:original.manifest,witness:witness.manifest,recordingOnly:true});
const scoped = ['ai/test-task175-lifecycle-observer-contract.js','ai/diagnostics/task175/lifecycle-v2-hooks.js','ai/diagnostics/task175/lifecycle-v2-recorder.js'];
const server = path.resolve(root,'../diplomacy_server');
const identities = {revisions:{client:git(root,'rev-parse','HEAD'),server:git(server,'rev-parse','HEAD')},baseline:{client:'5d01ea2f6791b01657273dc064d87ceae2300158',server:'22c7f9c7a37cdb4288185d702b2562806b56b084'}, scoped:[],dirty:[],bundle:{path:bundlePath,original:sha(source),transformed:sha(transformed),observerOnly:sha(original.text)}};
for (const file of scoped) { let baseline = null; try {baseline=sha(cp.execFileSync('git',['show',identities.baseline.client+':'+file],{cwd:root,stdio:['ignore','pipe','ignore']}));} catch {} identities.scoped.push({file,baseline,before:sha(fs.readFileSync(path.join(root,file))),after:null}); }
for (const [cwd,files] of [[root,['ai/demon-config.js','ai/test-coop-alliances.js','gameObjectSerialization.js']],[server,['server/loadGameCode.js','server/matchmakingSlots.js','tests/coop/browser-online.test.js','tests/coop/matchmaking.test.js']]]) for (const file of files) identities.dirty.push({file:path.join(cwd,file),sha256:sha(fs.readFileSync(path.join(cwd,file)))});
const checks=[],results=[],negatives=[];
function check(id, observed, expected) { const pass=JSON.stringify(observed)===JSON.stringify(expected); checks.push({id,expected,observed,pass});console.log((pass?'PASS ':'FAIL ')+id+' observed='+JSON.stringify(observed)+' expected='+JSON.stringify(expected)); }
const expectedHooks = ['manager-close','manager-reconnect','manager-reconnect-result','manager-error','encoding','application-emit','socket-packet','buffer-drain','application-packet','engine-open','engine-close','engine-error','heartbeat','engine-packet','engine-packet-create','upgrade','transport-send','transport-close','transport-error','polling-wire','polling-write','polling-encode-complete','polling-write-complete','request-create','request-success','request-error','request-abort','websocket-write','websocket-encode-complete','websocket-send','websocket-send-error','websocket-close'];
check('independent-hook-inventory',original.manifest.map(x=>x.hook).sort(),[...expectedHooks].sort());
function scenario(spec) {
    const r = lifecycleRecorder('private-contract-secret',spec.id,hashFactory);
    let serial=0, tick=0; const objects=new WeakMap(), sessions=new WeakMap(), requests=[], events=[], timers=new Map(), xhrs=[];
    const oid=o=>{if(!o)return null;if(!objects.has(o))objects.set(o,++serial);return objects.get(o);};
    const session=e=>{if(e?.id)sessions.set(e,r.digest('session',e.id));return sessions.get(e)||null;};
    const witnessEvents=[];
    const observe=(branch,req)=>{
        if(branch==='create') requests.push(req);
        const engine=req.opts.socket;
        witnessEvents.push({seq:witnessEvents.length+1,branch,request:oid(req),engine:oid(engine),session:session(engine),method:req.method,hasXHR:!!req.xhr});
    };
    const later=(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms});return id;};
    const runTimer=ms=>{const item=[...timers].find(([,t])=>t.ms===ms);assert(item,'scheduled timer '+ms);timers.delete(item[0]);events.push({action:'run-timer',delay:ms});item[1].fn();};
    class MemoryXHR {
        constructor(){this.withCredentials=false;this.responseType='';}
        open(method){this.method=method;}
        setRequestHeader(){}
        getResponseHeader(){return 'text/plain';}
        send(data){this.data=data;this.sent=true;xhrs.push(this);events.push({action:'xhr-send',xhr:oid(this),method:this.method});}
        abort(){this.aborted=true;events.push({action:'native-xhr-abort',xhr:oid(this)});}
        respond(data,status=200){assert(!this.done);this.done=true;this.responseText=data;this.status=status;this.readyState=4;events.push({action:'xhr-response',xhr:oid(this),status});this.onreadystatechange();}
    }
    const realm=vm.createContext({module:{exports:{}},exports:{},console,TextEncoder,performance,XMLHttpRequest:MemoryXHR,setTimeout:later,clearTimeout:id=>timers.delete(id),__task175v2:r,__contract:{observe}});
    vm.runInContext(transformed,realm,{filename:'pinned-socket.io-3.0.0.instrumented.js'});
    const socket=realm.module.exports('http://offline.invalid',{autoConnect:false,transports:['polling'],upgrade:false,timeout:false,reconnectionDelay:5,reconnectionDelayMax:5,randomizationFactor:0.000000001});
    const initialSocket=socket, manager=socket.io;
    const pending=(method,engine)=>requests.find(q=>q.method===method&&q.xhr&&!q.xhr.done&&(!engine||q.opts.socket===engine));
    const respond=(q,data,status)=>{assert(q,'actual pending request');q.xhr.respond(data,status);};
    const drainPosts=()=>{for(let n=0;n<20;n++){const q=pending('POST');if(!q)return;respond(q,'ok');}throw Error('POST drain bound exceeded');};
    const open=(engine,name)=>{
        respond(pending('GET',engine),'0'+JSON.stringify({sid:name,upgrades:[],pingInterval:10000,pingTimeout:10000}));
        session(engine);drainPosts();
        respond(pending('GET',engine),'40'+JSON.stringify({sid:'private-namespace-'+name}));
    };
    socket.connect(); const first=manager.engine; open(first,'private-engine-A');
    check(spec.id+':initial-connected',socket.connected,true);
    const payload='private-identical-join'; let target, late=null;
    if(spec.sessions===2) {
        if(spec.id==='late-old-response'){socket.emit('startGameOrConnect',payload);late=pending('POST',first);}
        respond(pending('GET',first),'1'); // Real parser -> transport close -> Engine -> Manager.
        check(spec.id+':disconnected',socket.connected,false);
        socket.emit('startGameOrConnect',payload);socket.emit('startGameOrConnect',payload);
        check(spec.id+':buffer-size',socket.sendBuffer.length,2);
        runTimer(5);const second=manager.engine;
        // Don't drain late old POST while establishing the new session.
        respond(pending('GET',second),'0'+JSON.stringify({sid:'private-engine-B',upgrades:[],pingInterval:10000,pingTimeout:10000}));session(second);
        respond(pending('POST',second),'ok');respond(pending('GET',second),'40{"sid":"private-namespace-B"}');
        while(pending('POST',second))respond(pending('POST',second),'ok');
        check(spec.id+':same-socket-new-engine',socket===initialSocket&&first!==second&&manager===socket.io,true);
        check(spec.id+':buffer-drained',socket.sendBuffer.length,0);
        if(late)respond(late,'ok');
    } else {
        socket.emit('startGameOrConnect',payload);target=pending('POST',first);
        if(spec.terminal==='success'){respond(target,'ok');socket.emit('startGameOrConnect',payload);drainPosts();}
        if(spec.terminal==='error'){respond(target,'',503);runTimer(0);drainPosts();}
        if(spec.terminal==='abort')target.abort();
    }
    // Explicit per-request observation boundary, not a generic close. This also
    // terminates outstanding long polls without creating any fake server data.
    for(const req of requests)if(req.method==='GET'&&req.xhr)req.abort();
    const trace=r.flush(original.manifest.map(h=>h.hook));
    const gaps=validate(trace,hooks.expectedClient);
    const entries=hook=>trace.rows.filter(x=>x.kind==='entry'&&x.hook===hook);
    const apps=trace.rows.filter(x=>x.kind==='occurrence'&&x.hook==='application-packet');
    const wires=trace.rows.filter(x=>x.kind==='occurrence'&&x.hook==='polling-wire'&&x.event==='startGameOrConnect');
    check(spec.id+':observer-validity',gaps,spec.terminal==='pending'?['pending asynchronous completion']:[]);
    check(spec.id+':real-engine-opens',entries('engine-open').length,spec.sessions);
    check(spec.id+':real-manager-reconnect',entries('manager-reconnect-result').length,spec.sessions-1);
    check(spec.id+':join-occurrences',apps.length,spec.joins+(late?1:0));
    check(spec.id+':distinct-occurrences',new Set(apps.map(x=>x.call)).size,apps.length);
    check(spec.id+':identical-payloads',new Set(apps.map(x=>x.payload)).size,1);
    check(spec.id+':wire-occurrences',wires.length,apps.length);
    const byCall=new Map(trace.rows.filter(x=>x.kind==='entry').map(x=>[x.call,x]));
    const ancestors=call=>{const seen=new Set();for(let n=0;call&&n<100;n++){seen.add(call);call=byCall.get(call)?.parent;}return seen;};
    check(spec.id+':emit-wire-ancestry',wires.every((w,i)=>ancestors(w.call).has(byCall.get(apps[i].call).parent)),true);
    check(spec.id+':sessions',new Set(wires.map(x=>x.session)).size,late?2:1);
    check(spec.id+':buffered-emits',apps.filter(x=>x.buffered).length,spec.sessions===2?2:0);
    check(spec.id+':redaction',/private-contract-secret|private-engine-|private-namespace-|private-identical-join/.test(JSON.stringify(trace)),false);
    check(spec.id+':unknown-initial-request',witnessEvents.find(x=>x.branch==='create').session,null);
    if(target){const terminal=witnessEvents.filter(x=>x.request===oid(target)&&x.branch!=='create');check(spec.id+':target-terminal',terminal.map(x=>x.branch),spec.terminal==='pending'?[]:[spec.terminal]);}
    if(late){const rows=witnessEvents.filter(x=>x.request===oid(late));check(spec.id+':late-original-binding',rows.map(x=>[x.branch,x.engine,x.session]),[['create',oid(first),session(first)],['success',oid(first),session(first)]]);check(spec.id+':late-after-new-open',witnessEvents.findIndex(x=>x.request===oid(late)&&x.branch==='success')>witnessEvents.findIndex(x=>x.branch==='success'&&x.engine===oid(manager.engine)),true);}
    const postOutcomes=requests.filter(q=>q.method==='POST').map(q=>({request:oid(q),terminal:witnessEvents.filter(x=>x.request===oid(q)&&x.branch!=='create').map(x=>x.branch)}));
    const expectedPostTerminals={'successful-write':[1,1,1],'reconnect-buffered':[1,1,1,1],'late-old-response':[1,1,1,1,1],'post-error':[1,1,1],'explicit-abort':[1,1],'missing-terminal':[1,0]};
    check(spec.id+':each-post-terminal-once',postOutcomes.map(x=>x.terminal.length),expectedPostTerminals[spec.id]);
    // Namespace POST plus declared joins; error closes with one further POST.
    // Reconnect contributes another namespace POST. No production-derived oracle.
    const expectedWrites=spec.sessions+spec.joins+(late?1:0)+(spec.terminal==='error'?1:0);
    check(spec.id+':write-and-encode-count',[entries('polling-write').length,entries('polling-encode-complete').length],[expectedWrites,expectedWrites]);
    check(spec.id+':successful-callback-count',entries('polling-write-complete').length,expectedWrites-(['error','abort','pending'].includes(spec.terminal)?1:0));
    save(spec.id+'.json',{spec,trace,witness:witnessEvents,adapterEvents:events,postOutcomes,pendingTimers:[...timers.values()].map(x=>({delay:x.ms})),gaps});
    results.push({id:spec.id,observerValid:gaps.length===0,transportOutcome:spec.terminal,gaps,requests:requests.length,posts:postOutcomes.length,liveAcceptance:'not-run'});
    return trace;
}
try {
    const traces=scenarios.map(scenario);
    function negative(id,trace,mutate){const bad=structuredClone(trace);mutate(bad);const gaps=validate(bad,hooks.expectedClient);const rejected=gaps.length>0;negatives.push({id,rejected,gaps});check('negative:'+id,rejected,true);}
    const good=traces[0];
    negative('missing-terminal-hook',good,t=>t.installed=t.installed.filter(h=>h!=='polling-write-complete'));
    negative('missing-terminal-record',good,t=>{const i=t.rows.findIndex(x=>x.hook==='polling-write-complete'&&x.kind==='entry');t.rows.splice(i,1);});
    negative('misbound-old-response',traces[2],t=>{const old=t.rows.find(x=>x.hook==='polling-write'&&x.kind==='entry');const row=t.rows.findLast(x=>x.hook==='polling-write-complete'&&x.kind==='entry');row.engine=old.engine+1000;row.session='incorrect-new-session';});
    negative('wrong-hook-count',good,t=>t.counts['engine-open']++);
    negative('wrong-sequence',good,t=>t.rows[0].seq++);
    negative('wrong-async-completion',good,t=>t.rows.find(x=>x.kind==='exit').kind='async-complete');
    negative('missing-terminal-remains-pending',traces[5],()=>{});
    // Balanced removal: rebuild metadata so rejection must concern the missing
    // request-bound terminal, not merely sequence/count corruption.
    negative('balanced-omission-of-abort',traces[4],t=>{
        t.rows=t.rows.filter(x=>!(x.hook==='request-abort'&&x.operation));
        t.rows.forEach((x,i)=>x.seq=i+1);t.finalCount=t.finalSequence=t.rows.length;
        t.counts={};t.entered=t.exited=0;
        for(const row of t.rows){if(row.kind==='entry'){t.entered++;t.counts[row.hook]=(t.counts[row.hook]||0)+1;}if(['exit','async-complete'].includes(row.kind))t.exited++;}
    });
    negative('misbound-request-terminal',traces[2],t=>{
        const row=t.rows.findLast(x=>x.kind==='entry'&&x.hook==='request-success'&&x.operation);
        if(row)row.engine+=1000;
    });
    negative('silently-cleared-pending',traces[5],t=>t.pendingAsync=[]);
} catch(error) {console.error(error.stack);checks.push({id:'execution-gap',expected:'all six real source scenarios',observed:error.message,pass:false});}
for(const item of identities.scoped)item.after=sha(fs.readFileSync(path.join(root,item.file)));
save('source-identities.json',identities);
save('dependency-identities.json',{node:{path:process.execPath,version:process.version,sha256:sha(fs.readFileSync(process.execPath))},files:Object.keys(require.cache).map(file=>({file,sha256:sha(fs.readFileSync(file))})),bundle:identities.bundle});
save('negative-controls.json',negatives);
save('checkpoints.json',{passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,checks});
const failed=checks.filter(x=>!x.pass);save('outcomes.json',{offlineContract:failed.length?'FAIL':'PASS',scenarios:results,negativeControlsRejected:negatives.filter(x=>x.rejected).length,liveAcceptance:'NOT_RUN',taskStatus:'pending'});
save('interpretation.md',`Offline observer contract: ${failed.length?'FAIL':'PASS'}. Six declared scenarios; ${results.length} executed. Network/gameplay acceptance NOT_RUN; TASK-175 remains pending.\n\n`+results.map(x=>`${x.id}: observed ${x.transportOutcome}; observer ${x.observerValid?'valid':'invalid'}; gaps ${JSON.stringify(x.gaps)}.`).join('\n')+'\n\nDetailed comparison and bounded future experiment are in the parent interpretation.md.\n');
console.log(`OBSERVER_CONTRACT_${failed.length?'FAIL':'PASS'} scenarios=${results.length}/6 checks=${checks.length-failed.length}/${checks.length} negatives=${negatives.filter(x=>x.rejected).length}/${negatives.length}`);
process.exitCode=failed.length?1:0;
