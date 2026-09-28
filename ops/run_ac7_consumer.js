'use strict';
// positive <run> <work> <evidence>: select, consume absent/present, save transition.
// control <id> <work>: consume a deleted/tampered copy; must fail closed (exit 1).
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const S=require('./ac7_consumer_selection'),H=require('./consume_historical_catalog');
const tasks=A.read('/root/diplomacy/artifacts/tasks.json'),research=A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json');
const ACTIVE='/root/diplomacy/artifacts/TASK-225/smoke-exits-162/run-01';
const save=(dir,n,x)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(x,null,2)+'\n');
const rows=r=>[...r.criteria,...r.researchGaps];
function totals(r){
 const statusCounts={};for(const x of rows(r))statusCounts[x.status]=(statusCounts[x.status]||0)+1;
 return {rows:rows(r).length,statusCounts,covered:rows(r).filter(x=>x.covered).length,unresolvedPriorArchives:r.unresolvedPriorArchives.length,
  unresolvedRequiredLocal:r.unresolvedRequiredLocal.length,selfChecks:r.selfChecks.length,followUps:r.followUps.length,pass:r.pass,auditComplete:r.auditComplete};
}
const CONTROLS={
 'deleted-proof':{file:'terminal-to-coop/network-traces.jsonl',mutate:f=>fs.rmSync(f),reason:/^deleted-proof:terminal-to-coop\/network-traces\.jsonl$/},
 'tampered-proof':{file:'terminal-to-competitive/network-traces.jsonl',mutate:f=>fs.appendFileSync(f,'{"tampered":true}\n'),reason:/^tampered-proof:terminal-to-competitive\/network-traces\.jsonl/},
};
const [mode,...args]=process.argv.slice(2);
if(mode==='positive'){
 const [run,work,evidence]=args.map(a=>path.resolve(a));
 const selected=S.prepare(tasks,run,path.join(work,'projection'));save(work,'ac7-selection.json',selected);
 console.log('PASS prepared AC7 selection clauses='+selected.report.results.length+' tools='+JSON.stringify(selected.toolHashes));
 const {baseline,before,after,run:inspected}=S.consume(tasks,research,selected);
 save(work,'baseline-consumer.json',baseline);save(work,'before-consumer.json',before);save(work,'after-consumer.json',after);
 const b=before.criteria.find(r=>r.id===S.TARGET),a=after.criteria.find(r=>r.id===S.TARGET);
 const catalog=R.targets(tasks,research);
 save(evidence,'transition.json',{target:S.TARGET,beforeStatus:b.status,afterStatus:a.status,beforeCovered:b.covered,afterCovered:a.covered,
  afterClauseStatuses:a.clauses.map(c=>c.status),runTask:a.clauses[0].runTask,provider:{directory:inspected.directory,historicalValid:inspected.historicalValid,currentSourceValid:inspected.currentSourceValid,sourceDifferences:inspected.sourceDifferences},
  catalog:{targets:catalog.length,criteria:catalog.filter(t=>t.task).length,researchGaps:catalog.filter(t=>!t.task).length,laterTaskRows:catalog.filter(t=>R.laterTask(t.task)).length,
   derivedFrom:['artifacts/tasks.json','artifacts/TASK-225/review-114/research-input.json']},
  before:totals(before),after:totals(after),delta:{unresolvedPriorArchives:after.unresolvedPriorArchives.length-before.unresolvedPriorArchives.length,covered:totals(after).covered-totals(before).covered},
  removedFromUnresolved:before.unresolvedPriorArchives.filter(id=>!after.unresolvedPriorArchives.includes(id)),
  toolHashes:selected.toolHashes,fullTaskPass:false});
 const old=new Map(rows(before).map(r=>[r.id,r])),differences=[];
 for(const r of rows(after))if(JSON.stringify(r)!==JSON.stringify(old.get(r.id)))differences.push({id:r.id,beforeStatus:old.get(r.id)?.status,afterStatus:r.status});
 const owners=before.selfChecks.map(s=>{const n=after.selfChecks.find(x=>x.id===s.id);
  return {id:s.id,status:s.status,checkpointIds:(s.clauses||[]).flatMap(c=>c.checkpointIds||[]),afterCheckpointIds:(n.clauses||[]).flatMap(c=>c.checkpointIds||[]),unchanged:JSON.stringify(s)===JSON.stringify(n)};});
 save(evidence,'non-target-diff.json',{target:S.TARGET,comparedRows:rows(after).length,differences,
  nonTargetDifferences:differences.filter(d=>d.id!==S.TARGET),researchGapsUnchanged:JSON.stringify(before.researchGaps)===JSON.stringify(after.researchGaps),
  selfOwners:owners,selfOwnerCount:owners.length,allSelfOwnersUnchanged:owners.every(o=>o.unchanged),baselineEqualsReviewAbsent:JSON.stringify(rows(baseline))===JSON.stringify(rows(before))});
 // The active smoke-exits-162 baseline cannot replay on current bytes; record the exact reason and status losses separately.
 let replay;try{require('./evidence_smoke_exits_selection').preflight(tasks,A.read(path.join(ACTIVE,'reviewed-crosswalk.json')).smokeExitsSelection);replay={replayable:true};}
 catch(e){replay={replayable:false,reason:e.message.split('\n')[0],differences:e.actual};}
 const saved=A.read(path.join(ACTIVE,'after-consumer.json'));
 save(evidence,'freshness-changes.json',{activeBaseline:ACTIVE,replay,savedUnresolvedPrior:saved.unresolvedPriorArchives.length,liveUnresolvedPriorBefore:before.unresolvedPriorArchives.length,
  changes:rows(saved).filter(r=>r.status!==rows(before).find(n=>n.id===r.id)?.status).map(r=>({id:r.id,saved:r.status,live:rows(before).find(n=>n.id===r.id)?.status}))});
 assert.deepEqual(after.inputIssues,[]);assert.deepEqual(after.unexplainedGaps,[]);
 console.log('PASS actual cumulative AC7 '+JSON.stringify({id:S.TARGET,beforeStatus:b.status,status:a.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length,selfOwners:after.selfChecks.length})+' FULL_TASK_PASS=false');
}else if(mode==='control'){
 const [id,work]=[args[0],path.resolve(args[1])],control=CONTROLS[id];assert(control,'unknown control');
 const input=A.read(path.join(work,'ac7-selection.json')),copy=path.join(work,'controls',id);
 assert(!fs.existsSync(copy),'fresh control');fs.cpSync(input.selected,copy,{recursive:true});control.mutate(path.join(copy,control.file));
 console.log('CONTROL '+id+' mutated '+path.join(copy,control.file));
 // Layer 1: the selection consumer itself must reject before any inventory is produced.
 let error;try{S.consume(tasks,research,{...input,selected:copy});}catch(e){error=e;}
 if(!error||!control.reason.test(error.message)){console.log('UNEXPECTED '+(error?error.message:'ACCEPT'));process.exit(3);}
 console.log('REJECT consumer-preflight reason='+error.message.split('\n')[0]);
 // Layer 2: bypass preflight; the root consumer must still refuse to cover the target.
 const C=require('./reconcile_evidence_catalog'),fresh=C.prepare(tasks,research),base=C.inventory(tasks,research,fresh.candidate,fresh.annex);
 const run=A.inspectRun({id:S.KEY},copy),candidate=structuredClone(fresh.candidate);candidate.reviews[candidate.reviews.findIndex(r=>r.id===S.TARGET)]=input.row;
 const out=H.consume({...base,runs:[...base.runs,run]},tasks,research,candidate,[{key:S.KEY,id:'TASK-221'}]).criteria.find(r=>r.id===S.TARGET);
 console.log('REJECT root-consumer status='+out.status+' covered='+out.covered+' reason='+out.reason+' runIssues='+JSON.stringify(run.issues));
 if(out.status!=='invalid-review'||out.covered!==false){console.log('UNEXPECTED root-consumer '+out.status);process.exit(3);}
 process.exit(1);
}else throw new Error('usage: positive <run> <work> <evidence> | control <id> <work>');
