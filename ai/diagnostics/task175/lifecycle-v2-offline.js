'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),Module=require('node:module');
const {lifecycleRecorder,validate}=require('./lifecycle-v2-recorder'), hashFactory=require('./recorder'), hooks=require('./lifecycle-v2-hooks');
async function offline({output,bundle,serverRoot,save}) {
    const checks=[];
    const check=(id,actual,expected)=>{checks.push({id,actual,expected,pass:JSON.stringify(actual)===JSON.stringify(expected)});assert.deepEqual(actual,expected,id);console.log('PASS '+id);};
    try {
        const make=(limit)=>lifecycleRecorder('offline-secret','offline',hashFactory,limit);
        const r=make(), engine={id:'old-session'}, socket={io:{engine},connected:false,nsp:'/'}, packet={data:['startGameOrConnect','identical-private-payload']};
        const emit=r.enter('emit',{socket});r.bind(packet,emit);r.event('application-packet',{socket},packet,emit);r.leave(emit);
        const other={data:[...packet.data]},second=r.enter('emit',{socket});r.bind(other,second);r.event('application-packet',{socket},other,second);r.leave(second);
        check('identical-payload-distinct-occurrences',r.parent(packet).call!==r.parent(other).call,true);
        socket.connected=true;
        const write=r.enter('write',{socket},packet);check('buffered-packet-retains-emit',write.parent,emit.call);r.leave(write);
        const lateRequest={},newRequest={};
        r.wire('network',{sid:'old-session'},lateRequest,'sent','42["startGameOrConnect","identical-private-payload"]');
        r.wire('network',{sid:'new-session'},newRequest,'received','0{}');
        r.wire('network',{sid:'old-session'},lateRequest,'received','42["gameStarted"]');
        r.wire('network',{}, {},'received','6');
        const receipt=r.enter('receipt',{socket},null,null,true);
        const mid=r.flush(['emit','write','application-packet','network','receipt']);
        check('receipt-awaiting-queue-is-incomplete',validate(mid,[]).includes('incomplete entry/exit/async accounting'),true);
        const app=mid.rows.filter(x=>x.kind==='occurrence'&&x.hook==='application-packet');
        check('identical-payload-digest',app[0].payload,app[1].payload);
        check('buffered-state-recorded',app.map(x=>[x.connected,x.buffered]),[[false,true],[false,true]]);
        const net=mid.rows.filter(x=>x.kind==='occurrence'&&x.hook==='network');
        check('late-old-session-exact-request',net[0].object===net[2].object&&net[0].session===net[2].session&&net[1].session!==net[2].session,true);
        check('unknown-session-not-inferred',net[3].binding,'unknown');
        check('emit-without-receipt-not-invented',mid.rows.filter(x=>x.hook==='queue').length,0);
        check('redaction',/offline-secret|old-session|new-session|identical-private-payload/.test(JSON.stringify(mid)),false);
        check('unknown-reason',r.reason('private error'),{value:null,absent:false,redacted:true,unknown:true});
        check('absent-reason',r.reason(),{value:null,absent:true,redacted:false,unknown:true});
        check('known-reason',r.reason('ping timeout'),{value:'ping timeout',absent:false,redacted:false,unknown:false});
        const good=make(), a=good.enter('async',{},null,null,true);good.leave(a);const trace=good.flush(['async']);
        check('positive-complete',validate(trace,['async']),[]);
        for(const [name,mutate] of [
            ['missing-hook',t=>t.installed=[]], ['overflow',t=>t.overflow=true], ['observer-error',t=>t.errors=1],
            ['pending-read',t=>t.pendingReads=1], ['missing-flush',t=>t.flushed=false], ['truncated',t=>t.rows.pop()],
            ['wrong-final-count',t=>t.finalCount++], ['wrong-sequence',t=>t.rows[0].seq=3],
            ['wrong-domain',t=>t.rows[0].domain='other'], ['missing-async-completion',t=>t.rows[1].kind='exit'],
            ['false-complete-flag',t=>{t.complete=true;t.entered++;}], ['wrong-hook-count',t=>t.counts.async=7], ['pending-async',t=>t.pendingAsync=['missing']],
        ]) {const bad=structuredClone(trace);mutate(bad);check('negative-'+name,validate(bad,['async']).length>0,true);}
        const tiny=make(1);tiny.leave(tiny.enter('test'));check('actual-overflow',validate(tiny.flush(['test']),['test']).includes('observer error/overflow/pending-read'),true);
        const bad=make();bad.enter('bad',{engine:{get id(){throw Error('secret');}}});check('actual-observer-error',bad.flush().errors,1);
        const manifest={},transformed={};
        const client=hooks.client(bundle);new vm.Script(client.text);manifest.client=client.manifest;
        check('independent-client-hook-inventory',client.manifest.map(x=>x.hook).sort(),[...hooks.expectedClient].sort());
        for(const relative of ['server/index.js','server/node_modules/engine.io/build/socket.js','server/node_modules/socket.io/dist/client.js','server/node_modules/socket.io/dist/socket.js']) {
            const file=path.join(serverRoot,relative), source=fs.readFileSync(file,'utf8'), result=hooks.server(file,source);
            new vm.Script(result.text);manifest[relative]=result.manifest;transformed[relative]=result.text;
            check('pinned-hooks-compile-'+relative,!!result,true);
        }
        const installed=Object.values(manifest).flat().map(x=>x.hook);
        for(const hook of hooks.expectedServer)check('required-server-hook-'+hook,installed.includes(hook),true);
        assert.throws(()=>hooks.client(bundle.replace('value: function emit(ev) {','value: function renamedEmit(ev) {')),/CAPTURE_CONTRACT/);
        check('negative-missing-pinned-anchor',true,true);
        // Actual transformed Socket.IO client module, disconnected fixture only:
        // no server, socket transport, timers or networking are started.
        const realm=vm.createContext({module:{exports:{}},exports:{},console,setTimeout,clearTimeout,TextEncoder,performance,__task175v2:make()});
        vm.runInContext(client.text,realm);const io=realm.module.exports;
        const s=io('http://offline.invalid',{autoConnect:false,reconnection:false});
        s.emit('startGameOrConnect','private-fixture');s.emit('startGameOrConnect','private-fixture');
        check('actual-transformed-buffer-size',s.sendBuffer.length,2);
        const writes=[];s.io.engine={id:'fixture-engine',transport:{writable:true},write(data){writes.push(data);}};s.connected=true;s.emitBuffered();
        check('actual-transformed-buffer-flush',writes.length,2);
        const fixture=realm.__task175v2.flush(hooks.expectedClient);
        check('actual-transformed-callback-accounting',validate(fixture,hooks.expectedClient),[]);
        check('actual-transformed-distinct-emit-tokens',new Set(fixture.rows.filter(x=>x.hook==='application-emit'&&x.kind==='entry').map(x=>x.call)).size,2);
        // Execute the actual instrumented application listener in an isolated
        // declared fixture. Prove await completion and lexical queue ancestry.
        const appSource=transformed['server/index.js'];const at=appSource.indexOf('socket.on("startGameOrConnect", async (json_string) => {');
        const end=appSource.indexOf('\n\n    socket.on("nextTurn"',at);
        let handler;const rr=make();let release;
        const pending=new Promise(resolve=>{release=resolve;});
        const ctx=vm.createContext({__task175v2:rr,socket:{conn:{id:'server-fixture'},on(event,fn){handler=fn;}},
            enqueueMatchmakingOperation:async fn=>{await pending;return fn();},enqueueGameOperation:async(id,fn)=>fn(),
            hashPassword:()=>0,console:{log(){}},getOrCreateGame:async()=>{throw Error('declared stop after queue');},
            handleErrorWithProbablyPrivateInfo(){},assert});
        vm.runInContext(appSource.slice(at,end),ctx);const promise=handler('{"password":"private","game":{}}');release();await promise;
        const appTrace=rr.flush(['handler-receipt','queue-entry','queue-execution']);
        check('actual-handler-async-accounting',validate(appTrace,[]),[]);
        check('actual-queue-explicit-parent',appTrace.rows.find(r=>r.hook==='queue-execution'&&r.kind==='entry').parent,appTrace.rows.find(r=>r.hook==='handler-receipt'&&r.kind==='entry').call);
        ctx.getOrCreateGame=async()=>['fixture-game',0,'started'];
        ctx.trackSocketAssignment=()=>{};ctx.loadGameWithCurrentRound=async()=>({});
        ctx.getCurrentParalleTurnInfo=()=>({whoNewToPlay:[0],gameObject:{}});
        ctx.io={};ctx.socket.join=()=>{};ctx.joinLobby=()=>{};ctx.GameStatus={JUST_STARTED:'started'};
        ctx.getTurnGameObjectForEmit=async()=>({fixture:true});ctx.socket.emit=()=>{};
        const rr2=make();ctx.__task175v2=rr2;await handler('{"password":"private","game":{}}');
        const completed=rr2.flush([]);
        check('actual-handler-through-opening',completed.rows.filter(r=>r.kind==='entry').map(r=>r.hook),['handler-receipt','queue-entry','queue-execution','assignment','game-queue-entry','game-queue-execution','opening-emission']);
        check('actual-handler-through-opening-accounting',validate(completed,[]),[]);
        // Independent fixture of two identical protocol occurrences. Explicit
        // ancestry and session order must distinguish them without timestamps.
        const cc=make(), nn=lifecycleRecorder('offline-secret','network',hashFactory), ss=lifecycleRecorder('offline-secret','server',hashFactory);
        const ce={id:'same-session'}, se={id:'same-session'}, sock={io:{engine:ce},connected:true,nsp:'/'};
        for(let i=0;i<2;i++) {
            const pkt={data:['startGameOrConnect','same']}, e=cc.enter('application-emit',{socket:sock});
            cc.event('application-packet',{socket:sock},pkt,e);cc.leave(e);
            cc.wire('polling-wire',{engine:ce},{},'sent','42["startGameOrConnect","same"]',i,e);
            nn.wire('network-p1',{sid:'same-session'},{},'sent','42["startGameOrConnect","same"]',i);
            const decoded=ss.enter('server-engine-decode',{engine:se});
            ss.wire('server-wire',{engine:se},{},'received','42["startGameOrConnect","same"]',0,decoded);
            const received=ss.enter('handler-receipt',{engine:se},null,decoded,true);ss.leave(decoded);
            const queued=ss.enter('queue-execution',{engine:se},null,received,true);
            ss.event('assignment',{engine:se},null,received);ss.event('opening-emission',{engine:se},null,received);
            ss.leave(queued);ss.leave(received);
        }
        const clientTrace={name:'p1',...cc.flush([])},networkTrace=nn.flush([]),serverTrace=ss.flush([]);
        const classify=require('./lifecycle-v2-classify'), linked=classify([clientTrace],networkTrace,serverTrace);
        check('ordered-identical-occurrence-links',linked.links.map(l=>l.classification),['emit-write-decode-handler-queue-opening','emit-write-decode-handler-queue-opening']);
        check('ordered-identical-occurrences-unambiguous',linked.gaps,[]);
        const withoutReceipt=structuredClone(serverTrace);withoutReceipt.rows=[];
        check('send-without-receipt-classification',classify([clientTrace],networkTrace,withoutReceipt).links[0].classification,'network-send-without-server-decode');
        const unknownNetwork=structuredClone(networkTrace);unknownNetwork.rows.filter(r=>r.kind==='occurrence').forEach(r=>r.session=null);
        check('unbound-session-fails-classification',classify([clientTrace],unknownNetwork,serverTrace).gaps.length>0,true);
        // Compile both existing real harness adaptations without loading them.
        const install=require('./lifecycle-v2-harness').install;
        const native=Module.prototype._compile;
        for(const enabled of [false,true]) {
            const captured=[];Module.prototype._compile=function(text,file){new vm.Script(text);captured.push({text,file});};
            let harness;
            try {harness=install({serverRoot,bundle,secret:'offline',enabled,output});
                for(const name of ['browser-driver','services','join-races-game']) {const file=path.join(serverRoot,'tests/reliability/helpers',name+'.js');new Module(file)._compile(fs.readFileSync(file,'utf8'),file);}
            } finally {harness?.restore();Module.prototype._compile=native;}
            check('harness-adapter-count-'+enabled,captured.length,3);
            check('preload-only-ON-'+enabled,captured[1].text.includes('lifecycle-v2-preload.js'),enabled);
            check('original-race-oracle-preserved-'+enabled,captured[2].text.replace('await globalThis.__task175V2Harness.flush();\n                            ','').replace('    await globalThis.__task175V2Harness.flush();\n','')===fs.readFileSync(captured[2].file,'utf8'),true);
        }
        save('hook-manifest.json',manifest);save('fixture-traces.json',{declaration:'Pure offline fixtures; no network/gameplay claims',buffered:fixture,handler:appTrace,negativePending:mid});
        save('checkpoints.json',{passed:checks.length,failed:0,checks});console.log('LIFECYCLE_V2_OFFLINE_PASS checks='+checks.length);
    }catch(e){save('checkpoints.json',{passed:checks.filter(x=>x.pass).length,failed:1,checks,error:e.stack});throw e;}
}
module.exports=offline;
