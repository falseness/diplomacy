'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const G=require('./evidence_terminal_ac3_gate'),C=require('./evidence_terminal_ac3_selection'),C2=require('./evidence_terminal_ac2_selection');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),original=path.join(out,'provider');
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const tasks=A.read('/root/diplomacy/artifacts/tasks.json'),research=A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json');
const receipt={file:path.join(out,'provider-exit.json'),sha256:A.hash(path.join(out,'provider-exit.json'))};
// Rebind AC2 explicitly to this same changed provider. No stale archive waiver.
const ac2Selection=C2.prepare(tasks,original,path.join(out,'selected-221-ac2'),receipt);
save('ac2-selection.json',ac2Selection);console.log('PASS same-run whole AC2 revalidation assertions='+ac2Selection.report.checks.length);
const ac3Selection=C.prepare(tasks,original,path.join(out,'selected-221-ac3'),receipt);
save('ac3-selection.json',ac3Selection);save('checkpoints.json',{checkpoints:ac3Selection.report.checks});
console.log('PASS whole AC3 reader assertions='+ac3Selection.report.checks.length);
const controls=[];
for(const [id,mutate,re] of [
 ['wrong-row-owner',x=>{x.row.id='TASK-221/AC2';},/complete row/],
 ['omitted-check',x=>{x.row.clauses[0].assertions.pop();},/complete row/],
 ['wrong-ancestry',x=>{x.baseline.sha256='0'.repeat(64);},/ancestry/]
]){const x=structuredClone(ac3Selection);mutate(x);assert.throws(()=>C.preflight(tasks,x),re);controls.push({id,pass:true});console.log('PASS consumer reject '+id);}
save('consumer-controls.json',controls);
const selected={ac2Selection,ac3Selection};save('reviewed-crosswalk.json',selected);
A.inventory(tasks,research,selected);const result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',result.after);save('ac3-transition.json',result.transition);
assert.deepEqual(result.transition,{id:'TASK-221/AC3',status:'covered-current',before:62,after:61});
console.log('PASS whole criterion transition '+JSON.stringify(result.transition));
