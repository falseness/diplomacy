'use strict';
// Read-only next-work inventory. These findings never promote coverage.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
function inspect(report){
 const providers=report.runs.map(run=>{
  const file=run.directory&&path.join(run.directory,'source-identities.json');
  const current=file&&fs.existsSync(file)?A.compareSources(A.read(file)):null;
  if(current)assert.deepEqual(current,run.sourceDifferences,'source drift since inventory:'+run.task);
  return {task:run.task,directory:run.directory,historicalValid:run.historicalValid||false,currentSourceValid:run.currentSourceValid||false,
   sourceDifferences:current,archiveIssues:run.issues,
   nextAction:current?.length?'Freeze the affected independent reader/projection first, then refresh only its exact current provider; never suppress source differences.':run.issues.length?'Resolve exact archive binding/schema failures before semantic consumption.':'Review each whole remaining criterion against independent original observations.'};
 });
 const unresolved=[...report.criteria,...report.researchGaps].filter(r=>report.unresolvedPriorArchives.includes(r.id));
 assert.equal(unresolved.length,report.unresolvedPriorArchives.length);
 return {fullAuditReady:false,coverageAdded:0,requiredPrior:unresolved.length,selfChecks:report.selfChecks.length,
  providers,criteria:unresolved.map(r=>({id:r.id,text:r.text,status:r.status,clauses:(r.clauses||[]).map(c=>({text:c.text,status:c.status,reason:c.reason,followUp:c.followUp,runTask:c.runTask}))})),
  explicitRetainedObligations:{G09:'Missing predeclared workload/duration/progress contract plus independent observed progress; calibration alone cannot close it.',
   longPhase:'The separately retained long-phase clause remains required.',naturalClock:report.historicalAnnex.retainedObligations},
  nextCurrentTask:'TASK-212',laterTasks:'informational; covered=false; no completion dependency',
  conclusion:'Unfinished local proof review and affected refresh work; no demonstrated external blocker and no full-audit pass.'};
}
if(require.main===module){const result=inspect(A.read(process.argv[2]));fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log('PASS remaining inspection requiredPrior='+result.requiredPrior+' selfChecks='+result.selfChecks+' coverageAdded=0');for(const p of result.providers)console.log(p.task+' sourceDifferences='+(p.sourceDifferences?.length??'unknown')+' archiveIssues='+p.archiveIssues.length);}
module.exports={inspect};
