'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const recorder=require('./recorder'),hooks=require('./hooks');
const assert=require('node:assert/strict');
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
function replace(source,anchor,value){assert.equal(source.split(anchor).length,2,'harness anchor '+anchor);return source.replace(anchor,value);}
function install({serverRoot,bundle,secret,enabled,output}){
    const network=enabled?recorder(secret,'network'):null;
    const compile=Module.prototype._compile, originals=[];
    const clientHook=hooks.client(bundle);
    let serverPid=null,flushed=false,pending=0;
    const browserRecords=[],clients=[];
    globalThis.__task175Harness={
        server(pid){serverPid=pid;},
        async setup(page,name){
            if(enabled)await page.addInitScript({content:'globalThis.__task175=('+recorder.toString()+')('+JSON.stringify(secret)+','+JSON.stringify('client:'+name)+');'});
            // Pinned CDN bytes in both arms, before the wave. No live dependency
            // fetch or arm-dependent interception latency during the wave.
            await page.route('https://cdn.socket.io/socket.io-3.0.0.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:enabled?clientHook.text:bundle}));
            clients.push({page,name});
        },
        pending(delta){if(enabled)pending+=delta;},
        net(object,transport,direction,text){
            if(!enabled)return;
            let sid=new URL(object.url()).searchParams.get('sid');
            if(!sid && direction==='received' && text.startsWith('0')){try{sid=JSON.parse(text.slice(1)).sid;}catch{}}
            network.network(object,sid,transport,direction,text);
        },
        async flush(){if(flushed)return;flushed=true;
            if(enabled){
                for(const {page,name} of clients){try{browserRecords.push({name,...await page.evaluate(()=>globalThis.__task175.flush())});}catch{browserRecords.push({name,complete:false,error:'page-flush-failed'});}}
                if(serverPid)process.kill(serverPid,'SIGUSR2');
                fs.writeFileSync(path.join(output,'callbacks-client.json'),JSON.stringify(browserRecords,null,2)+'\n',{flag:'wx'});
                fs.writeFileSync(path.join(output,'network.json'),JSON.stringify({...network.flush(),pendingReads:pending},null,2)+'\n',{flag:'wx'});
            }
        },
    };
    Module.prototype._compile=function(source,file){
        if(file===path.join(serverRoot,'tests/reliability/helpers/browser-driver.js')){
            originals.push({file,sha256:sha(source)});
            if(enabled){
            source=replace(source,'const raw = (transport, direction, text) => { if (wire)', 'const raw = (transport, direction, text, object) => { globalThis.__task175Harness.net(object,transport,direction,text); if (wire)');
            source=source.replaceAll("String(frame.payload)); note", "String(frame.payload), ws); note");
            source=source.replaceAll("raw('polling', 'sent', packet)","raw('polling', 'sent', packet, request)").replaceAll("raw('polling', 'received', packet)","raw('polling', 'received', packet, request)");
            source=replace(source,"if (!request.url().includes('/socket.io/')) return;","if (!request.url().includes('/socket.io/')) return; globalThis.__task175Harness.pending(1);try {");
            source=replace(source,"        });\n        await page.addInitScript(url =>", "        }finally{globalThis.__task175Harness.pending(-1);}});\n        await page.addInitScript(url =>");
            }
            source=replace(source,"        await page.addInitScript(url =>", "        await globalThis.__task175Harness.setup(page,name);\n        await page.addInitScript(url =>");
        }
        if(file===path.join(serverRoot,'tests/reliability/helpers/services.js')){
            originals.push({file,sha256:sha(source)});
            if(enabled)source=replace(source,"['--require', tlsPreload, 'index.js']","['--require', tlsPreload, '--require', "+JSON.stringify(path.join(__dirname,'server-preload.js'))+", 'index.js']");
            source=replace(source,"const record = {role, pid: child.pid,", "if(role==='server')globalThis.__task175Harness.server(child.pid);\n    const record = {role, pid: child.pid,");
        }
        if(file===path.join(serverRoot,'tests/reliability/helpers/join-races-game.js')){
            originals.push({file,sha256:sha(source)});
            source=replace(source,"await browser.close().catch(() => {});\n                            browser = null;", "await globalThis.__task175Harness.flush();\n                            await browser.close().catch(() => {});\n                            browser = null;");
            source=replace(source,"    // Captures of the first wave only:","    await globalThis.__task175Harness.flush();\n    // Captures of the first wave only:");
        }
        return compile.call(this,source,file);
    };
    return {manifest:clientHook.manifest,originals,restore(){Module.prototype._compile=compile;delete globalThis.__task175Harness;}};
}
module.exports={install};
