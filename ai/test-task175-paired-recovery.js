#!/usr/bin/env node
'use strict';
// Offline protocol oracle. Only timer execution and transport I/O are synthetic.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const {createRequire} = require('module');
const {EventEmitter} = require('events');
const args = process.argv.slice(2);
function option(k) { const i = args.indexOf(k); assert(i >= 0 && args[i + 1], k); return path.resolve(args[i + 1]); }
const output = option('--output-dir');
const bundlePath = option('--bundle');
const historyPath = option('--source-inventory');
const serverRoot = option('--server-root');
assert(!fs.existsSync(output), 'refuse historical evidence overwrite');
fs.mkdirSync(output, {recursive:true});
const identities = new Map(), checks = [], traces = [];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function read(p) { const b = fs.readFileSync(p); identities.set(p, sha(b)); return b.toString(); }
function save(n, v) { fs.writeFileSync(path.join(output,n), JSON.stringify(v,null,2)+'\n'); }
function check(name, actual, expected) {
  actual = JSON.parse(JSON.stringify(actual));
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({name,actual,expected,passed});
  assert.deepStrictEqual(actual,expected,name); console.log('PASS '+name);
}
function clock() {
  let now = 0, serial = 0; const tasks = [], trace = [];
  function add(fn, delay, interval=false) {
    const t = {fn,delay,due:now+delay,id:++serial,active:true,interval,refresh(){this.active=true;this.due=now+this.delay;return this;}};
    tasks.push(t); return t;
  }
  const clear = t => { if(t) t.active=false; };
  return {trace,tasks, get now(){return now;}, setTimeout:(f,d)=>add(f,d), clearTimeout:clear,
    setInterval:(f,d)=>add(f,d,true),clearInterval:clear,
    advance(end) { let count=0; while(true) {
      const t=tasks.filter(t=>t.active && t.due<=end).sort((a,b)=>a.due-b.due || a.id-b.id)[0];
      if(!t) break; assert(++count<2000,'timer loop'); now=t.due;
      if(t.interval) t.due+=t.delay; else t.active=false;
      trace.push({at:now,delay:t.delay,id:t.id}); t.fn();
    } now=end; }
  };
}
try {
  read(__filename); const bundle=read(bundlePath);
  check('client-bundle-sha256',sha(bundle),'e3ea5880b996b7c89a9475540bbc0dbc0ab556beac6f42b6d8ec727218f2d51a');
  check('shipped-cdn-url',read(path.resolve(__dirname,'../index.html')).includes('src="https://cdn.socket.io/socket.io-3.0.0.js"'),true);
  const serverRequire=createRequire(path.join(serverRoot,'server/index.js'));
  const socketIoPath=serverRequire.resolve('socket.io');
  const engineEntry=createRequire(socketIoPath).resolve('engine.io');
  const engineRoot=path.dirname(path.dirname(engineEntry));
  const enginePackage=JSON.parse(read(path.join(engineRoot,'package.json')));
  check('actual-server-engine-version',enginePackage.version,'6.6.4');
  const parserEntry=createRequire(engineEntry).resolve('engine.io-parser');
  let parserRoot=path.dirname(parserEntry);
  while(!fs.existsSync(path.join(parserRoot,'package.json')) || !JSON.parse(fs.readFileSync(path.join(parserRoot,'package.json'))).version) {
    assert(path.dirname(parserRoot)!==parserRoot,'parser package root'); parserRoot=path.dirname(parserRoot);
  }
  const parserPackage=JSON.parse(read(path.join(parserRoot,'package.json')));
  check('actual-server-parser-version',parserPackage.version,'5.2.3');
  const defaults=read(path.join(engineRoot,'build/server.js'));
  check('installed-server-default-deadlines',[defaults.includes('pingTimeout: 20000'),defaults.includes('pingInterval: 25000'),defaults.includes('upgradeTimeout: 10000')],[true,true,true]);
  const history=JSON.parse(read(historyPath));
  const comparisons=[];
  for(const [rel,expected] of Object.entries(history.before.server.files)) {
    if(/(?:package(?:-lock)?\.json|server\/index\.js)$/.test(rel)) {
      const p=path.join(serverRoot,rel); const actual=sha(read(p));
      comparisons.push({path:p,expected,actual,matches:actual===expected});
    }
  }
  check('saved-lock-source-identities-present',comparisons.length>=3,true);
  check('saved-lock-source-identities-match',comparisons.every(x=>x.matches),true);
  save('dependency-resolution.json',{socketIoPath,engineEntry,engineVersion:enginePackage.version,parserEntry,parserVersion:parserPackage.version,comparisons,
    historicalDependencyBytes:'ABSENT: saved inventory omits node_modules; lock equality does not prove historical dependency byte identity',
    historicalCdnBytes:'ABSENT: historical browser responses not archived; pinned saved bundle is not proof of historical CDN byte identity'});
  const anchor='return __webpack_require__(__webpack_require__.s = "./build/index.js");';
  check('unique-loader-anchor',bundle.split(anchor).length,2);
  for(const mode of ['before-deadline','deadline-first','non-writable-poll','socket-close']) {
    for(const order of ['poll-drain','drain-poll']) {
      const name=mode+'/'+order, c=clock(), events=[], incoming=[], outgoing=[];
      const log=(kind,data)=>events.push({at:c.now,kind,data});
      const context=vm.createContext({console,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});
      vm.runInContext(bundle.replace(anchor,'globalThis.bundleRequire=__webpack_require__; '+anchor),context);
      const req=context.bundleRequire;
      const Engine=req('./node_modules/engine.io-client/lib/socket.js');
      const Polling=req('./node_modules/engine.io-client/lib/transports/polling.js');
      const Emitter=req('./node_modules/component-emitter/index.js');
      const Manager=req('./build/manager.js').Manager;
      const cache=new Map();
      function load(file) {
        if(cache.has(file)) return cache.get(file).exports;
        const m={exports:{}}; cache.set(file,m); const local=createRequire(file);
        const custom=id=> {
          if(id==='timers') return c;
          const resolved=local.resolve(id);
          if(resolved.startsWith(engineRoot+path.sep) && resolved.endsWith('.js')) return load(resolved);
          return local(id);
        };
        const scope=vm.createContext({console,Buffer,process:{nextTick:fn=>c.setTimeout(fn,0)},setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,setInterval:c.setInterval,clearInterval:c.clearInterval});
        vm.runInContext('(function(require,module,exports){'+read(file)+'\n})',scope)(custom,m,m.exports);
        return m.exports;
      }
      const ServerSocket=load(path.join(engineRoot,'build/socket.js')).Socket;
      const ServerPolling=load(path.join(engineRoot,'build/transports/polling.js')).Polling;
      const serverPoll=new ServerPolling({_query:{EIO:'4'}});
      // Real server Polling.send/parser/doClose. Synthetic HTTP response sink.
      serverPoll.write=data=>{log('server-poll-payload',data);incoming.push(data);};
      const client=Object.create(Engine.prototype);
      Object.assign(client,{readyState:'open',writeBuffer:[],prevBufferLen:0,upgrading:false,pingInterval:25000,pingTimeout:20000});
      const old=Object.create(Polling.prototype);
      Object.assign(old,{readyState:'open',polling:true,writable:true,socket:client,doPoll(){log('new-poll');}});
      let completeWrite;
      old.doWrite=(data,cb)=>{log('client-poll-payload',data);outgoing.push(data);completeWrite=cb;};
      client.setTransport(old);
      // Real Polling.write creates the pending POST and its actual drain callback.
      old.write([{type:'message',data:'declared-pending-write'}]);
      const server=new EventEmitter();
      server.opts={pingInterval:25000,pingTimeout:20000,upgradeTimeout:10000,maxHttpBufferSize:1000000,transports:['polling','websocket']};
      server.upgrades=()=>['websocket'];
      const peer=new ServerSocket('synthetic-session',server,serverPoll,null,4);
      // The opening handshake is a declared initial fixture, not a replayed network claim.
      peer.writeBuffer=[]; serverPoll.writable=mode!=='non-writable-poll';
      const sp=new EventEmitter(), cp=new Emitter();
      const wire=[];
      Object.assign(sp,{name:'websocket',readyState:'open',writable:true,protocol:4,discard(){this.discarded=true;},
        send(packets){log('server-probe-send',packets);wire.push(()=>packets.forEach(p=>cp.emit('packet',p)));},
        close(cb){if(this.readyState==='closed')return;this.readyState='closed';log('server-probe-close');this.emit('close');cp.emit('close');if(cb)cb();}});
      Object.assign(cp,{name:'websocket',readyState:'open',writable:true,
        send(packets){log('client-probe-send',packets);wire.push(()=>packets.forEach(p=>sp.emit('packet',p)));},
        open(){this.emit('open');},close(){if(this.readyState==='closed')return;this.readyState='closed';log('client-probe-close');sp.close();}});
      const pump=()=>{while(wire.length)wire.shift()();};
      const manager=new Manager('https://offline.invalid',{autoConnect:false,reconnection:true});
      manager.engine=client; manager.onopen(); // Installs the shipped Engine close -> Manager close subscription.
      let reconnects=0,opens=0,clientUpgrades=0,serverUpgrades=0;
      manager.on('reconnect',()=>{reconnects++;log('manager-reconnect');});
      manager.open=cb=>{opens++;log('synthetic-successful-reconnect-open');cb();};
      client.on('close',reason=>log('client-close',reason));
      peer.on('close',reason=>log('server-close',reason));
      client.on('upgrade',()=>clientUpgrades++);peer.on('upgrade',()=>serverUpgrades++);
      client.on('upgradeError',e=>log('upgrade-error',e.message));
      client.resetPingTimeout(); client.createTransport=()=>cp;
      peer._maybeUpgrade(sp);client.probe('websocket');pump();
      c.advance(100);
      check(name+'/noop-writable-guard',incoming,mode==='non-writable-poll'?[]:['6']);
      check(name+'/pause-waits-for-both',old.readyState,'pausing');
      if(mode==='socket-close') { peer.close(true);pump(); }
      if(mode==='before-deadline') c.advance(9999); else c.advance(10000);
      if(mode==='non-writable-poll') {
        serverPoll.writable=true; serverPoll.send([{type:'noop'}]);
      }
      const poll=()=>{assert(incoming.length===1,'one pending poll response');old.onData(incoming.shift());};
      const drain=()=>{serverPoll.onData(outgoing.shift());completeWrite();};
      for(const action of order.split('-')) (action==='poll'?poll:drain)();pump();
      const upgraded=mode==='before-deadline';
      check(name+'/completion-state',{client:client.readyState,old:old.readyState,transport:client.transport.name,clientUpgrades,serverUpgrades},
        {client:'open',old:'paused',transport:upgraded?'websocket':'polling',clientUpgrades:upgraded?1:0,serverUpgrades:upgraded?1:0});
      check(name+'/pause-listeners-cleaned',{poll:old.listeners('pollComplete').length,drain:old.listeners('drain').length}, {poll:0,drain:upgraded?0:1});
      check(name+'/upgrade-timers-cleaned',c.tasks.filter(t=>t.active && (t.delay===100 || t.delay===10000)).length,0);
      check(name+'/probe-listeners-cleaned',sp.listenerCount('packet'),upgraded?1:0);
      check(name+'/client-probe-cleanup',[cp.listeners('open').length,cp.listeners('error').length,cp.listeners('close').length],[0,upgraded?1:0,upgraded?1:0]);
      check(name+'/exact-probe-packets',events.filter(e=>e.kind==='client-probe-send').flatMap(e=>e.data).map(p=>p.type+':'+(p.data||'')),upgraded?['ping:probe','upgrade:']:['ping:probe']);
      check(name+'/exact-server-probe-pong',events.filter(e=>e.kind==='server-probe-send').flatMap(e=>e.data).map(p=>p.type+':'+(p.data||'')),['pong:probe']);
      if(upgraded) {
        c.advance(25000);pump(); // Shipped ping/pong follows the upgraded transport.
        check(name+'/heartbeat-pong',events.filter(e=>e.kind==='client-probe-send').flatMap(e=>e.data).map(p=>p.type),['ping','upgrade','pong']);
        check(name+'/heartbeat-keeps-session-open',[client.readyState,peer.readyState,reconnects],['open','open',0]);
        peer.close(true);pump();
      }
      c.advance(80000);pump();
      check(name+'/heartbeat-or-transport-close-recovers',{client:client.readyState,server:peer.readyState,reconnects,opens}, {client:'closed',server:'closed',reconnects:1,opens:1});
      check(name+'/close-reason',events.filter(e=>e.kind==='client-close').map(e=>e.data),[upgraded?'transport close':'ping timeout']);
      const closedAt=events.find(e=>e.kind==='client-close').at;
      const reconnectDelay=events.find(e=>e.kind==='manager-reconnect').at-closedAt;
      check(name+'/default-reconnect-jitter-bounds',reconnectDelay>=500 && reconnectDelay<=1500,true);
      check(name+'/all-timers-cleaned',c.tasks.filter(t=>t.active).length,0);
      check(name+'/engine-manager-subscriptions-cleaned',client.listeners('close').length,1); // Only our trace observer remains; synthetic open retains the expired reconnect timer subscription.
      check(name+'/synthetic-open-expired-timer-subscription',manager.subs.length,1);
      check(name+'/transport-listeners-cleaned',{client:old.listeners('packet').length,server:serverPoll.listenerCount('packet'),probe:sp.listenerCount('packet')},{client:0,server:0,probe:0});
      const sends=()=>events.filter(e=>/payload|send/.test(e.kind)).length;
      const before=sends(); client.send('after-close');peer.send('after-close');c.advance(100000);pump();
      check(name+'/no-post-close-send-or-duplicate-reconnect',[sends()-before,reconnects,opens],[0,1,1]);
      check(name+'/no-poll-resumption',events.filter(e=>e.kind==='new-poll').length,0);
      traces.push({name,fixture:{pendingPoll:true,pendingWrite:true,serverPollInitiallyWritable:mode!=='non-writable-poll',completionOrder:order,completionAt:upgraded?9999:10000,serverSocketCloseAt:mode==='socket-close'?100:null,upgradeTimeout:10000,pingInterval:25000,pingTimeout:20000},events,timers:c.trace});
    }
  }
  // Pin transitive parser/debug dependencies actually loaded by unchanged modules.
  for(const p of Object.keys(require.cache)) if(p.includes('node_modules') && fs.existsSync(p)) read(p);
  save('transition-traces.json',{boundaries:'Synthetic clock, HTTP response delivery/POST completion and WebSocket I/O. Transition bodies unchanged. Manager.open success is synthetic AFTER actual Engine heartbeat/close -> subscribed Manager recovery. No browser, network, gameplay or historical causation claim.',traces});
  save('conclusion.json',{hypothesis:'permanently live open-but-paused client after upgrade deadline',decision:'REJECTED',result:'Polling does not resume, but the actual 45000ms heartbeat timeout closes the Engine and its existing Manager subscription schedules exactly one reconnect. The actual server heartbeat/close and polling close timeout clean remaining timers. Successful reconnect network establishment is a declared synthetic boundary, not proved.',next:'Require session-correlated failed-wave Engine callback execution and server acceptance/close evidence to distinguish delayed callbacks, heartbeat recovery/new session and application join refresh delivery. Saved redacted SIDs and response-read timestamps cannot establish this. No supported production repair; no new comparison or full gate authorized.'});
  console.log(`PAIRED RECOVERY PASSED ${checks.length}/${checks.length}; permanent liveness hypothesis REJECTED; no live gate`);
} catch(e) {console.error(e.stack);process.exitCode=1;} finally {
  save('checkpoints.json',{passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks});
  save('source-identities.json',[...identities].map(([path,sha256])=>({path,sha256})));
  save('partial-traces.json',traces);
}
