'use strict';
// Complete semantic reviews extend one explicit frozen cumulative selection.
// Every extension is independently recomputed before the ordinary disposition
// consumer sees it. There is no per-criterion replay of old transitions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),H=require('./consume_historical_catalog');
const READERS={'asset-records':{module:'./review_asset_records',id:'TASK-211/AC4',report:'ac4-independent-review.json'},...Object.fromEntries([5,6,8].map(number=>['asset-AC'+number,{number,id:'TASK-211/AC'+number,report:'ac'+number+'-independent-review.json'}]))};
const readerFor=spec=>spec.number?require('./review_asset_requirements').reader(spec.number):require(spec.module);
function prepare(tasks,research,out,kinds=['asset-records']){
 assert(!fs.existsSync(out),'fresh extension projection required');
 fs.cpSync(path.join(S.BASE,'prepared'),out,{recursive:true});
 const input=S.selection(tasks,research),manifest=A.read(path.join(out,'selected-211/evidence-hashes.json'));
 const extensions=[];
 for(const kind of kinds){
  const spec=READERS[kind];assert(spec,'unknown-selection-extension');const reader=readerFor(spec);
  const {result:report}=S.transaction(()=>reader.review(out,reader.RECEIPT));
  const file=path.join(out,'selected-211',spec.report);fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');manifest[spec.report]=A.hash(file);
  const row=reader.rowFor(tasks,report,manifest);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;
  extensions.push({kind,id:spec.id,report:spec.report,receipt:reader.RECEIPT});
 }
 fs.writeFileSync(path.join(out,'selected-211/evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 input.evidenceSelection.extensions={prepared:out,reviews:extensions};
 const annex=path.join(S.BASE,'historical-annex.json');input.evidenceSelection.annex={file:annex,sha256:A.hash(annex)};input.evidenceSelection.annexReference=true;return input;
}
function inventory(tasks,research,input,options={}){
 const started=Date.now(),s=input.evidenceSelection,e=s.extensions;
 assert(e&&path.isAbsolute(e.prepared)&&Array.isArray(e.reviews)&&e.reviews.length,'missing-selection-extensions');
 assert.equal(new Set(e.reviews.map(r=>r.kind)).size,e.reviews.length,'duplicate-selection-extension');
 const baseline=structuredClone(input);delete baseline.evidenceSelection.extensions;
 const retained=A.read(path.join(S.BASE,'reviewed-crosswalk.json'));
 const {result:validated,metrics:preflightMetrics}=S.transaction(()=>{
  const selected=path.join(e.prepared,'selected-211'),manifest=A.read(path.join(selected,'evidence-hashes.json'));
  const expected=structuredClone(A.read(path.join(s.prepared,'selected-211/evidence-hashes.json'))),reports=[];
  assert.deepEqual(A.read(path.join(e.prepared,'provenance.json')),A.read(path.join(s.prepared,'provenance.json')),'changed-extension-provenance');
  for(const item of e.reviews){
   const spec=READERS[item.kind];assert(spec,'unknown-selection-extension');const reader=readerFor(spec);
   assert.deepEqual(item,{kind:item.kind,id:spec.id,report:spec.report,receipt:reader.RECEIPT},'wrong-extension-owner-or-receipt');
   expected[spec.report]=A.hash(path.join(selected,spec.report));
  }
  assert.deepEqual(manifest,expected,'changed-extension-manifest');for(const n of Object.keys(manifest))A.proofKey(selected,n,manifest);
  for(const item of e.reviews){
   const spec=READERS[item.kind],reader=readerFor(spec),report=reader.review(e.prepared,item.receipt);
   assert.deepEqual(A.read(path.join(selected,spec.report)),report,'changed-extension-report');
   const row=reader.rowFor(tasks,report,manifest);
   assert.deepEqual(input.reviews.find(r=>r.id===item.id),row,'wrong-extension-row');
   baseline.reviews[baseline.reviews.findIndex(r=>r.id===item.id)]=retained.reviews.find(r=>r.id===item.id);reports.push(report);
  }
  return {reports};
 });
 const preflightMs=Date.now()-started;
 if(baseline.evidenceSelection.annexReference){
  const ref=baseline.evidenceSelection.annex;assert.equal(ref.file,path.join(S.BASE,'historical-annex.json'),'wrong-extension-annex');assert.equal(A.hash(ref.file),ref.sha256,'changed-extension-annex');
  baseline.evidenceSelection.annex=A.read(ref.file);delete baseline.evidenceSelection.annexReference;
 }
 const base=S.inventory(tasks,research,baseline,options);
 const {result:report,metrics}=S.transaction(()=>{
  const run=A.inspectRun(tasks.find(t=>t.id==='TASK-211'),path.join(e.prepared,'selected-211'));
  assert(run.historicalValid,'invalid-extension-run:'+run.issues.join(','));
  const candidate=structuredClone(baseline);delete candidate.evidenceSelection;
  let after=base.report;const transitions=[];
  for(const item of e.reviews){
   candidate.reviews[candidate.reviews.findIndex(r=>r.id===item.id)]=input.reviews.find(r=>r.id===item.id);
   const next=H.consume({...after,runs:after.runs.map(r=>r.task===run.task?run:r)},tasks,research,candidate,[{id:'TASK-211',key:'TASK-211'}]);
   for(const old of [...after.criteria,...after.researchGaps].filter(r=>r.id!==item.id))
    assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-other-disposition:'+old.id);
   assert.deepEqual(next.selfChecks,after.selfChecks);assert.deepEqual(next.historicalAnnex,after.historicalAnnex);
   assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
   transitions.push({id:item.id,before:after.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:next.criteria.find(r=>r.id===item.id).status});
   options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));after=next;
  }
  return {after,transitions};
 });
 return {report:report.after,transitions:report.transitions,before:base.report,reports:validated.reports,phases:[{name:'extension-preflight',elapsedMs:preflightMs},...base.phases,{name:'complete-extended-inventory',elapsedMs:Date.now()-started}],metrics:{base:base.metrics,preflight:preflightMetrics,extensions:metrics}};
}
module.exports={prepare,inventory};
