'use strict';
// Explicit --require only on diagnostic ON services. No NODE_OPTIONS use.
const fs=require('node:fs'), Module=require('node:module'), path=require('node:path');
const hooks=require('./hooks');
const enabled=process.env.TASK175_RECORD==='1';
if(enabled){
    const secret=process.env.TASK175_SECRET;
    if(!secret || !process.env.TASK175_FLUSH)throw new Error('missing diagnostic configuration');
    globalThis.__task175=require('./recorder')(secret,'server');
    delete process.env.TASK175_SECRET;
    const compile=Module.prototype._compile;
    const installed=[];
    Module.prototype._compile=function(source,file){
        if(file.endsWith('/engine.io/build/socket.js')){const r=hooks.server(source);source=r.text;installed.push(...r.manifest.map(x=>x.hook));}
        if(file===path.resolve(process.cwd(),'index.js')){
            const r=hooks.app(source);source=r.text;installed.push(...r.manifest.map(x=>x.hook));
            for(const line of ['socket.emit(socketCommand, JSON.stringify(emittedGameObject))','socket.emit("waitYouTurn", JSON.stringify(stampCoopRevision(game, waitingGameObject)))']){
                if(source.split(line).length!==2)throw new Error('opening hook anchor');
                source=source.replace(line,'{const __opening=globalThis.__task175.enter("opening-emission",socket.conn,socket.conn.transport);try {'+line+'}finally{globalThis.__task175.leave(__opening);}}');
            }
            try{return compile.call(this,source,file);}finally{Module.prototype._compile=compile;}
        }
        return compile.call(this,source,file);
    };
    process.once('SIGUSR2',()=>{
        const result=globalThis.__task175.flush();result.installed=[...installed,'opening-emission','server-upgrade-accepted'];
        fs.writeFileSync(process.env.TASK175_FLUSH,JSON.stringify(result)+'\n',{flag:'wx'});
    });
}
