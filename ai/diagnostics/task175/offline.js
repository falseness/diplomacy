'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto'),Module=require('node:module');
const hooks=require('./hooks'),recorder=require('./recorder');
const root=path.resolve(__dirname,'../../..'),serverRoot=path.resolve(root,'../diplomacy_server');
const output=path.resolve(process.argv[2]);fs.mkdirSync(output);
const checks=[];function check(id,actual,expected){assert.deepEqual(actual,expected,id);checks.push({id,actual,expected,pass:true});console.log('PASS '+id);}
const bundle=fs.readFileSync(path.join(root,'artifacts/TASK-175/transport-20260921/socket.io-3.0.0.js'),'utf8');
async function main(){
    const record=recorder('declared-offline-secret','unit');
    for(const sid of ['short','x'.repeat(100),'unicode-π'])check('secret-label-'+sid.length,record.label(sid),crypto.createHash('sha256').update('declared-offline-secret\0'+sid).digest('hex'));
    const engine={id:'raw-engine-sid'},transport={};
    const a=record.enter('engine-close',engine,transport,null,'ping timeout');engine.id=null;record.leave(a);
    const b=record.enter('manager-close',engine,transport);record.leave(b);
    record.network({url(){}},'raw-engine-sid','polling','received','42["gameStarted",{"password":"private"}]');
    const trace=record.flush();check('same-session-after-id-clear',a.session,b.session);check('same-transport-epoch',a.epoch,b.epoch);
    check('no-raw-sid-or-payload',/raw-engine-sid|private|declared-offline-secret/.test(JSON.stringify(trace)),false);
    record.enter('ignored',engine,transport);check('flush-disables-recording',record.flush().rows.length,5);
    const tiny=recorder('s','tiny',1);tiny.leave(tiny.enter('x',engine,transport));check('overflow-invalidates',tiny.flush().overflow,true);
    const n=recorder('binding-secret','network'),oldRequest={},newRequest={},ws={};
    n.network(newRequest,'new-sid','polling','received','0{}');
    n.network(oldRequest,'old-sid','polling','received','42[\"gameStarted\"]');
    n.network(ws,'old-sid','websocket','sent','5');n.network(ws,'old-sid','websocket','received','2');
    n.network({},null,'polling','received','6');
    const nr=n.flush().rows;
    check('delayed-old-response-not-latest-session',nr[0].session!==nr[1].session && nr[1].session===nr[2].session,true);
    check('exact-websocket-object-binding',nr[2].object===nr[3].object && nr[1].object!==nr[2].object,true);
    check('unknown-session-not-inferred',nr[4].session,null);
    const bad=recorder('s','bad');bad.enter('x',{get id(){throw Error('private');}},null);check('recording-errors-invalidate',bad.flush().errors,1);
    const source='function f(x) { if(x<0) throw problem; this.seen=arguments.length; return this.value+x; }\nasync function g(x) { await Promise.resolve(); return this.value+x; }';
    const result=hooks.bracket(source,[['sync','function f(x) {','this','null'],['async','async function g(x) {','this','null']]);
    const problem=new Error('declared throw'),context=vm.createContext({__task175:recorder('s','callbacks'),problem});vm.runInContext(result.text,context);
    const receiver={value:7,id:'fixture'};check('return-receiver-args',context.f.call(receiver,4),11);check('arguments-preserved',receiver.seen,1);
    let caught;try{context.f.call(receiver,-1);}catch(e){caught=e;}check('throw-identity',caught===problem,true);check('async-return',await context.g.call(receiver,2),9);
    const rows=context.__task175.flush().rows;check('entry-exit-on-return-throw-await',rows.map(x=>x.kind),['callback-entry','callback-exit','callback-entry','callback-exit','callback-entry','callback-exit']);
    const manifests={};
    for(const [key,file] of [['client',path.join(root,'artifacts/TASK-175/transport-20260921/socket.io-3.0.0.js')],['server',path.join(serverRoot,'server/node_modules/engine.io/build/socket.js')],['app',path.join(serverRoot,'server/index.js')]]){
        const before=fs.readFileSync(file,'utf8'),r=hooks[key](before);new vm.Script(r.text);manifests[key]=r.manifest;
        let restored=r.text.replace(/\nconst __t175=globalThis\.__task175\.enter\([^\n]+\);try \{\n/g,'').replace(/\n\} finally \{globalThis\.__task175\.leave\(__t175\);\}\n/g,'');
        if(key==='server')restored=restored.replace('const __accepted=globalThis.__task175.enter("server-upgrade-accepted",this,transport);try {this.emit("upgrade", transport);} finally {globalThis.__task175.leave(__accepted);}','this.emit("upgrade", transport);');
        check(key+'-bodies-byte-preserved',restored,before);checks.at(-1).actual=checks.at(-1).expected=crypto.createHash('sha256').update(before).digest('hex');
    }
    check('client-required-hooks',manifests.client.length,13);check('server-required-hooks',manifests.server.length,4);check('application-required-hooks',manifests.app.length,3);
    // Compile both harness arms without services/browser execution. The original
    // compiler is restored exactly; only these three test modules are adapted.
    const install=require('./harness').install;
    const native=Module.prototype._compile;
    for(const enabled of [false,true]){
        const captured=[];Module.prototype._compile=function(text,file){captured.push({text,file});new vm.Script(text);};
        const prior=Module.prototype._compile;
        const h=install({serverRoot,bundle,secret:'offline-secret',enabled,output});
        for(const name of ['browser-driver','services','join-races-game']){
            const file=path.join(serverRoot,'tests/reliability/helpers',name+'.js');new Module(file)._compile(fs.readFileSync(file,'utf8'),file);
        }
        h.restore();check('compiler-cleanup-'+enabled,Module.prototype._compile===prior,true);Module.prototype._compile=native;
        check('three-harness-adapters-'+enabled,captured.length,3);
        check('preload-opt-in-'+enabled,captured[1].text.includes('server-preload.js'),enabled);
        check('network-recording-opt-in-'+enabled,captured[0].text.includes('__task175Harness.net('),enabled);
        check('oracle-byte-preserved-'+enabled,captured[2].text.replace('await globalThis.__task175Harness.flush();\n                            ','').replace('    await globalThis.__task175Harness.flush();\n',''),fs.readFileSync(captured[2].file,'utf8'));
        checks.at(-1).actual=checks.at(-1).expected='original harness restored by removing two post-wave flush calls';
    }
    const beforeCompile=Module.prototype._compile;require('./server-preload');check('default-preload-off',Module.prototype._compile===beforeCompile && globalThis.__task175===undefined,true);
    fs.writeFileSync(path.join(output,'hook-manifest.json'),JSON.stringify(manifests,null,2)+'\n');
    fs.writeFileSync(path.join(output,'checkpoints.json'),JSON.stringify({passed:checks.length,failed:0,checks},null,2)+'\n');
    console.log(`CORRELATION_OFFLINE_PASSED ${checks.length}/${checks.length}`);
}
main().catch(e=>{console.error(e);fs.writeFileSync(path.join(output,'checkpoints.json'),JSON.stringify({passed:checks.length,failed:1,checks,error:e.message},null,2));process.exitCode=1;});
