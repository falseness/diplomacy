'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const hashFactory=require('./recorder'), hooks=require('./lifecycle-v2-hooks');
const recorder=(secret,domain)=>require('./lifecycle-v2-recorder').lifecycleRecorder(secret,domain,hashFactory);
const assert=require('node:assert/strict');
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
function replace(source,anchor,value){assert.equal(source.split(anchor).length,2,'harness anchor '+anchor);return source.replace(anchor,value);}
function install({serverRoot,bundle,secret,enabled,output}){
    const network=enabled?recorder(secret,path.basename(output)+':runner:'+process.pid):null;
    const compile=Module.prototype._compile, originals=[];
    const clientHook=hooks.client(bundle);
    let serverPid=null,flushed=false,pending=0;
    const browserRecords=[],clients=[],delivered=[],networkIndices=new WeakMap();
    let deliveryErrors=0;
    globalThis.__task175V2Harness={
        server(pid){serverPid=pid;},
        async setup(page,name){
            if(enabled)await page.addInitScript({content:'globalThis.__task175v2=('+require('./lifecycle-v2-recorder').lifecycleRecorder.toString()+')('+JSON.stringify(secret)+','+JSON.stringify(path.basename(output)+':browser:'+name)+',('+hashFactory.toString()+'));'});
            // Pinned CDN bytes in both arms, before the wave. No live dependency
            // fetch or arm-dependent interception latency during the wave.
            await page.route('https://cdn.socket.io/socket.io-3.0.0.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:enabled?clientHook.text:bundle}));
            page.on('response', async response => {
                if(response.url()!=='https://cdn.socket.io/socket.io-3.0.0.js')return;
                pending++;
                try{delivered.push({name,status:response.status(),original:sha(bundle),transformed:sha(clientHook.text),delivered:sha(await response.body()),enabled});}catch{deliveryErrors++;}finally{pending--;}
            });
            if(enabled)page.on('request',request=>{
                if(!request.url().includes('/socket.io/'))return;
                const post=request.postData();
                if(post)String(post).split('\x1e').forEach((packet,index)=>globalThis.__task175V2Harness.net(request,'polling','sent',packet,name,index,true));
            });
            clients.push({page,name});
        },
        pending(delta){if(enabled)pending+=delta;},
        net(object,transport,direction,text,name,index=null,requestStart=false){
            if(!enabled)return;
            if(transport==='polling'&&direction==='sent'&&!requestStart)return;
            let sid=new URL(object.url()).searchParams.get('sid');
            if(!sid && direction==='received' && text.startsWith('0')){try{sid=JSON.parse(text.slice(1)).sid;}catch{}}
            if(index===null){const counts=networkIndices.get(object)||{};index=counts[direction]||0;counts[direction]=index+1;networkIndices.set(object,counts);}
            network.wire('network-'+name,{sid,transport:object},object,direction,text,index);
        },
        async flush(){if(flushed)return;flushed=true;
            if(enabled){
                for(const {page,name} of clients){try{browserRecords.push({name,...await page.evaluate(installed=>globalThis.__task175v2.flush(installed),clientHook.manifest.map(m=>m.hook))});}catch{browserRecords.push({name,complete:false,error:'page-flush-failed'});}}
                if(serverPid)process.kill(serverPid,'SIGUSR2');
                fs.writeFileSync(path.join(output,'lifecycle-client.json'),JSON.stringify(browserRecords,null,2)+'\n',{flag:'wx'});
                fs.writeFileSync(path.join(output,'network.json'),JSON.stringify({...network.flush(['network-request','network-frame'],pending)},null,2)+'\n',{flag:'wx'});
            }
            fs.writeFileSync(path.join(output,'bundle-identities.json'),JSON.stringify({original:sha(bundle),transformed:sha(clientHook.text),delivered,deliveryErrors,pendingReads:pending},null,2)+'\n',{flag:'wx'});
        },
    };
    Module.prototype._compile=function(source,file){
        if(file===path.join(serverRoot,'tests/reliability/helpers/browser-driver.js')){
            originals.push({file,sha256:sha(source)});
            if(enabled){
            source=replace(source,'const raw = (transport, direction, text) => { if (wire)', 'const raw = (transport, direction, text, object) => { globalThis.__task175V2Harness.net(object,transport,direction,text,name); if (wire)');
            source=source.replaceAll("String(frame.payload)); note", "String(frame.payload), ws); note");
            source=source.replaceAll("raw('polling', 'sent', packet)","raw('polling', 'sent', packet, request)").replaceAll("raw('polling', 'received', packet)","raw('polling', 'received', packet, request)");
            source=replace(source,"if (!request.url().includes('/socket.io/')) return;","if (!request.url().includes('/socket.io/')) return; globalThis.__task175V2Harness.pending(1);try {");
            source=replace(source,"        });\n        await page.addInitScript(url =>", "        }finally{globalThis.__task175V2Harness.pending(-1);}});\n        await page.addInitScript(url =>");
            }
            source=replace(source,"        await page.addInitScript(url =>", "        await globalThis.__task175V2Harness.setup(page,name);\n        await page.addInitScript(url =>");
        }
        if(file===path.join(serverRoot,'tests/reliability/helpers/services.js')){
            originals.push({file,sha256:sha(source)});
            if(enabled)source=replace(source,"['--require', tlsPreload, 'index.js']","['--require', tlsPreload, '--require', "+JSON.stringify(path.join(__dirname,'lifecycle-v2-preload.js'))+", 'index.js']");
            source=replace(source,"const record = {role, pid: child.pid,", "if(role==='server')globalThis.__task175V2Harness.server(child.pid);\n    const record = {role, pid: child.pid,");
        }
        if(file===path.join(serverRoot,'tests/reliability/helpers/join-races-game.js')){
            originals.push({file,sha256:sha(source)});
            source=replace(source,"await browser.close().catch(() => {});\n                            browser = null;", "await globalThis.__task175V2Harness.flush();\n                            await browser.close().catch(() => {});\n                            browser = null;");
            source=replace(source,"    // Captures of the first wave only:","    await globalThis.__task175V2Harness.flush();\n    // Captures of the first wave only:");
        }
        return compile.call(this,source,file);
    };
    return {manifest:clientHook.manifest,originals,restore(){Module.prototype._compile=compile;delete globalThis.__task175V2Harness;}};
}
module.exports={install};
