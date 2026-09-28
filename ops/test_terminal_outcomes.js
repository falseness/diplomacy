'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const F=require('./review_terminal_outcomes');
const original=path.resolve('artifacts/TASK-221/green-12');
test('derive complete historical outcome criterion with serialized independent values',()=>{const r=F.review(original);assert.equal(r.checks.length,122);for(const c of JSON.parse(JSON.stringify(r)).checks)assert.deepEqual(c.observed,c.expected,c.id);assert.deepEqual(r.criteria,[1]);assert.throws(()=>F.review(original,[2]),/only-complete-terminal/);});
const mutations=[
 ['source outcome','terminal-inventory.json',v=>{v.rules[0].observed.result='draw';},/derived-outcome/],
 ['unsupported rule','terminal-inventory.json',v=>{v.unsupported.pop();},/unsupported-rules/],
 ['omitted case','coverage-results.json',v=>{v.cases.pop();},/completed-cases/],
 ['fixture label','terminal-draw/declared-fixture.json',v=>{v.spec.generation.testFixture.generated=true;},/false/],
 ['participant count','checkpoints.json',v=>{v.checkpoints.find(c=>c.id==='terminal-victory/participants').observed=1;},/contexts/],
 ['missing commit','terminal-victory/network-traces.jsonl',v=>{v.splice(v.findIndex(r=>r.stage==='mongo-commit'),1);},/commit-owners/],
 ['wrong unit HP','terminal-victory/network-traces.jsonl',v=>{v.find(r=>r.stage==='mongo-terminal').stored.rounds.at(-1)[0].parallelTurnResult.players[1].units[0].hp=1;},/terminal-state/],
 ['wrong gold','terminal-victory/network-traces.jsonl',v=>{v.find(r=>r.stage==='mongo-terminal').stored.rounds.at(-1)[0].parallelTurnResult.players[1].gold=20;},/terminal-state/],
 ['wrong result','terminal-draw/network-traces.jsonl',v=>{v.find(r=>r.stage==='mongo-terminal').stored.rounds.at(-1)[0].parallelTurnResult.gameSettings.coop.result='victory';},/terminal-result/],
 ['wrong capture','terminal-to-coop/network-traces.jsonl',v=>{v.find(r=>r.stage==='mongo-terminal').stored.rounds.at(-1)[0].parallelTurnResult.grid[1][1]=1;},/terminal-state/],
 ['no click','terminal-draw/input-trace.jsonl',v=>{v.splice(v.findIndex(r=>r.label==='legal pass before flooding'),1);},/legal-inputs/],
 ['no rendered result','terminal-draw/network-traces.jsonl',v=>{v.find(r=>r.stage==='terminal-ui').state.text='';},/rendered-outcome/],
 ['duplicate identity','terminal-draw/network-traces.jsonl',v=>{v.filter(r=>r.stage==='api-join')[1].identity=0;},/admitted-identities/]
];
for(const [label,n,mutate,pattern] of mutations)test('reject hash-rebound '+label,()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-outcome-'));try{fs.cpSync(original,dir,{recursive:true});const file=path.join(dir,n),lines=n.endsWith('.jsonl'),v=lines?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):JSON.parse(fs.readFileSync(file));mutate(v);fs.writeFileSync(file,lines?v.map(x=>JSON.stringify(x)).join('\n')+'\n':JSON.stringify(v));assert.throws(()=>F.review(dir,[1],null,F.manifest(dir)),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('missing and tampered proof fail closed against original manifest',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-outcome-'));try{fs.cpSync(original,dir,{recursive:true});const m=F.manifest(dir),p=path.join(dir,'terminal-inventory.json');fs.appendFileSync(p,' ');assert.throws(()=>F.review(dir,[1],null,m));fs.unlinkSync(p);assert.throws(()=>F.review(dir,[1],null,m));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
