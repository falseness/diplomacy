'use strict';
// Real archived proof regression for explicit provider selection; no synthetic coverage.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const B=require('./consume_asset_review');
const out=path.resolve(process.argv[2]);assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});
const tasks=A.read(path.join(A.client,'artifacts/tasks.json'));
const original=path.join(A.client,'artifacts/TASK-211/green-07');
const binding={original:fs.realpathSync(original),coverageSha256:A.hash(path.join(original,'coverage-results.json'))};
const prepared=path.join(out,'prepared');fs.cpSync(path.join(A.client,'artifacts/TASK-225/review-53/prepared'),prepared,{recursive:true});
const results=[];
const inspected=B.inspect(tasks,prepared,binding);
assert.equal(inspected.run.historicalValid,true);assert.equal(inspected.run.currentSourceValid,false);
results.push({id:'explicit-canonical-provider',pass:true,checks:inspected.report.checks.length,currentSourceValid:false});
console.log('PASS explicit-canonical-provider checks='+inspected.report.checks.length+' currentSourceValid=false');
function reject(id,mutate,pattern) {
    const copy=path.join(out,id);fs.cpSync(prepared,copy,{recursive:true});
    const bound=structuredClone(binding);mutate(copy,bound);
    let reason;try{B.inspect(tasks,copy,bound);}catch(e){reason=e.message;}
    assert(reason&&pattern.test(reason),id+': '+reason);results.push({id,pass:true,reason});
    console.log('PASS '+id+': '+reason.split('\n')[0]);
}
reject('wrong-manifest',(_,b)=>{b.coverageSha256='0'.repeat(64);},/wrong-asset-coverage/);
reject('escaped-provider',(_,b)=>{b.original='/tmp';},/escaped-asset-provider/);
reject('changed-provenance',p=>{const file=path.join(p,'provenance.json'),v=A.read(file);v.original='/tmp';fs.writeFileSync(file,JSON.stringify(v));},/wrong-asset-provider/);
reject('deleted-proof',p=>fs.unlinkSync(path.join(p,'selected-211/asset-requests.jsonl')),/ENOENT/);
reject('tampered-proof',p=>fs.appendFileSync(path.join(p,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/);
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({pass:true,fullInvocation:false,results},null,2)+'\n');
console.log('PASS provider-binding regression cases=6');
