#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SERVER=path.resolve(ROOT,'../diplomacy_server');
const start=Date.now(),stop=start+3300000;
const {values}=require('node:util').parseArgs({options:{'output-dir':{type:'string'}}});
assert(values['output-dir'],'--output-dir required');const out=path.resolve(values['output-dir']);assert(!fs.existsSync(out),'fresh output directory required');fs.mkdirSync(out,{recursive:true});
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n'),read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const log=s=>{fs.appendFileSync(path.join(out,'verification.log'),s+'\n');console.log(s);};
const commands=[],checks=[];let passed=false,identities;
process.env.TASK238_STOP_AT=String(stop);
function command(p,args,cwd=ROOT){assert(Date.now()<stop,'cumulative stop-work deadline');log(`COMMAND ${p} ${args.join(' ')}\nCWD=${cwd}`);const r=spawnSync(p,args,{cwd,encoding:'utf8',maxBuffer:64*1024*1024,timeout:stop-Date.now(),killSignal:'SIGTERM'});log(r.stdout||'');log(r.stderr||'');commands.push({program:p,args,cwd,exit:r.status,signal:r.signal,error:r.error?.message||null});log('ACTUAL_EXIT_STATUS='+r.status);assert.equal(r.status,0);return r.stdout;}
const cases=[];
for(const tier of ['local','server']){
 for(const h of [1,2,12])for(let r=1;r<=32;r++)for(const suffix of ['','/reload-no-duplicate','/marker'])cases.push(`${tier}/H${h}/r${r}${suffix}`);
 for(const name of ['blocked-upgrade/12','blocked-upgrade/16','unblock-intermediate-no-backlog','unblock-next-scheduled','placement/occupied','placement/destroyed','placement/terrain'])cases.push(tier+'/'+name);
}
for(const r of [4,28]){
 const id='network/H2/r'+r;
 cases.push(id+'/participants',id+'/reload-before/1',id+'/reload-before/2');
 if(r===4)cases.push('browser/contexts');
 cases.push(id+'/persisted-wave',id+'/commit-count');
 if(r===4)cases.push('browser/p0/wave','browser/p1/wave');
 cases.push(id+'/reload-after/1',id+'/reload-after/2',id+'/reload-no-duplicate');
}
cases.push('browser/errors','network/server-errors','network/cleanup');
write('verification-plan.json',{estimateMs:600000,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,cases,
 tiers:['local shipped-source wave phase dispatcher','server shipped-source wave dispatcher','real HTTPS/Socket.IO/MongoDB save before/after wave 4 and 28','two independent Chromium players commit round 4 through mouse input'],
 exclusions:['natural long-game progression','full network H/round products','browser Cartesian products','high-count rendering stress'],
 fixtures:'local.json and server.json fixtures; fixture-r4.json and fixture-r28.json, seed 1, authored Tiny maps with 10*H portals',
 commands:['node20 ai/test-task238-source.js local <out>','node20 ai/test-task238-source.js server <out>','node20 ai/test-task238-network.js <out>','git diff --check in both repositories','source/evidence audit and owned-process cleanup']});
const snapshot=()=>Object.fromEntries([ROOT,SERVER].map(repo=>{
 const files=command('git',['ls-files','--cached','--others','--exclude-standard'],repo).trim().split('\n').filter(f=>f&&!f.startsWith('artifacts/')&&/\.(js|json|html|svg)$/.test(f)&&fs.existsSync(path.join(repo,f)));
 return [repo,{commit:command('git',['rev-parse','HEAD'],repo).trim(),files:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(repo,f)))]))}];
}));
log(`COMMAND NODE_PATH=${process.env.NODE_PATH||''} ${process.execPath} ${process.argv.slice(1).join(' ')}\nCWD=${process.cwd()}\nNODE=${process.version} V8=${process.versions.v8}`);
try{
 identities=snapshot();write('source-identities.json',{before:identities,pass:false});
 for(const tier of ['local','server']){command(process.execPath,[path.join(__dirname,'test-task238-source.js'),tier,out]);checks.push(...read(tier+'.json').checks);}
 assert(stop-Date.now()>360000,'reserve network and cleanup budget');
 command(process.execPath,[path.join(__dirname,'test-task238-network.js'),out]);checks.push(...read('network-checkpoints.json').checks);
 write('waves.json',{rows:['local','server'].flatMap(t=>read(t+'.json').waves),pass:true});
 write('roundtrips.json',{source:['local','server'].flatMap(t=>read(t+'.json').roundtrips),network:read('network-roundtrips.json').rows,pass:true});
 for(const repo of [ROOT,SERVER]){const diff=command('git',['diff','--check'],repo);fs.writeFileSync(path.join(out,path.basename(repo)+'-diff-check.txt'),diff);const staged=command('git',['diff','--cached','--name-only'],repo);assert(!staged.split('\n').some(n=>n.startsWith('artifacts/')));}
 const after=snapshot();assert.deepEqual(after,identities);write('source-identities.json',{before:identities,after,pass:true});
 assert.deepEqual(checks.map(c=>c.id).sort(),[...cases].sort(),'exact selected case manifest');
 for(const c of checks){assert(c.pass,c.id);assert.deepEqual(c.observed,c.expected,c.id);}
 write('checkpoints.json',{checks,pass:true});
 // Audit on-disk evidence itself, including exact required attempt counts.
 for(const c of read('checkpoints.json').checks)assert.deepEqual(c.observed,c.expected,c.id);
 const waves=read('waves.json').rows;assert.equal(waves.length,196);
 for(const row of waves){assert.deepEqual(row.observed,row.expected,row.id);assert(row.commit.lastRound>0);}
 for(const tier of ['local','server'])for(const h of [1,2,12]){
 const counts=[4,8,12,16,20,24,28,32].map(r=>waves.find(w=>w.id===`${tier}/H${h}/r${r}`).observed.attempts);
 assert.deepEqual(counts,[6,6,6,8,9,9,10,10].map(n=>n*h));log(`PASS ${tier} H${h} attempted-counts=${counts.join(',')}`);
 }
 const roundtrips=read('roundtrips.json');assert.equal(roundtrips.source.length,192);assert.equal(roundtrips.network.length,2);
 for(const row of roundtrips.source)assert.deepEqual(row.observed,row.expected);
 for(const row of roundtrips.network){assert.deepEqual(row.observed,row.expected);for(const f of [row.before,row.after])assert(fs.statSync(path.join(out,f)).size>0);}
 const shots=fs.readdirSync(path.join(out,'screenshots')).filter(n=>n.endsWith('.png'));assert.equal(shots.length,2);
 for(const n of shots)assert.equal(fs.readFileSync(path.join(out,'screenshots',n)).subarray(1,4).toString(),'PNG');
 assert.deepEqual(read('browser-errors.json'),[]);
 for(const [repo,{files}]of Object.entries(read('source-identities.json').after))for(const [f,h]of Object.entries(files))assert.equal(sha(fs.readFileSync(path.join(repo,f))),h);
 for(const repo of [ROOT,SERVER])assert.equal(fs.statSync(path.join(out,path.basename(repo)+'-diff-check.txt')).size,0);
 log(`PASS evidence-audit cases=${cases.length} source-boundaries=192 network-roundtrips=2 browser-players=2 captures=2`);
 log('PASS source-hashes-current exact-assertions artifacts-unstaged diff-check-empty');passed=true;
}catch(e){log(e.stack);write('checkpoints.json',{checks,pass:false});}
finally{
 const lifecycle=fs.existsSync(path.join(out,'network-cleanup.json'))?read('network-cleanup.json'):{};
 const cleanup=lifecycle.browserClosed===true&&lifecycle.clientClosed===true&&lifecycle.cleanup?.processes.every(p=>!p.aliveAfter)&&lifecycle.cleanup?.directories.every(d=>!d.existsAfter)&&commands.every(c=>!c.signal&&!c.error);
 passed=passed&&!!cleanup&&Date.now()<stop;
 log(`${cleanup?'PASS':'FAIL'} owned-process-cleanup browser-closed services-closed children-reaped`);
 const evidenceHashes=Object.fromEntries(fs.readdirSync(out,{recursive:true}).filter(f=>f!=='verification.log'&&fs.statSync(path.join(out,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(out,f)))]));
 write('coverage-results.json',{cases:cases.map(id=>({id,pass:checks.some(c=>c.id===id&&c.pass),proof:'checkpoints.json'})),commandExits:commands,evidenceHashes,sourceIdentities:'source-identities.json',pass:passed});
 write('verification-budget.json',{startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,targetMs:2700000,stopWorkMs:3300000,budgetMs:3600000,exits:commands.map(c=>c.exit),cleanup:!!cleanup,pass:passed});
 log('RUNNER_ACTUAL_EXIT_STATUS='+(passed?0:1));process.exitCode=passed?0:1;
}
