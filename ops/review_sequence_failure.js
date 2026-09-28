'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const hashes=require('./sequence_failure_hashes.json');
// This failed archive predates evidenceHashes. Pin the preserved bytes explicitly;
// never turn its false cleanup/budget result into a passing invocation.
function reviewFailure(check,proofs,dir=path.join(A.client,'artifacts/TASK-220/green-20260925-01'),manifest=hashes){
 const read=n=>{A.proofKey(dir,n,manifest);const p=path.join(dir,n);proofs[p]=manifest[n];return n.endsWith('.json')?A.read(p):fs.readFileSync(p,'utf8');};
 const summary=read('minimized-replays/coop-actions-0.json'),budget=read('verification-budget.json');read('source-identities.json');
 check('failure/summary',['coop-actions-0',"error: 'Cannot convert undefined or null to object'",2,true],[summary.original,summary.marker,summary.smallestFailingPrefix,summary.unresolved]);
 check('failure/original-red',[[1],false,false],[budget.exits,budget.pass,budget.cleanup]);
 check('failure/shrink-search',[[6,true,1],[3,true,1],[1,false,1],[2,true,1]],summary.attempts.map(r=>[r.prefix,r.reproduced,r.exit]));
 const runs=[{proof:'original-failures/coop-actions-0',prefix:12,reproduced:true},...summary.attempts];
 for(const r of runs){
  const log=read(r.proof+'/stdout.log'),record=read(r.proof+'/per-action-checkpoints.json')[0],command=read(r.proof+'/command.json');
  check('failure/exit/'+r.prefix,{exit:1,signal:null,error:null},read(r.proof+'/exit.json'));
  check('failure/command/'+r.prefix,['/root/diplomacy_server',['--test','tests/reliability/helpers/natural-coop-browser.js']],[command.cwd,command.args]);
  const kinds=r.prefix===1?['buy']:['buy','undo'];
  check('failure/actions/'+r.prefix,kinds,record.actions.map(a=>a.stage));
  check('failure/action-log/'+r.prefix,kinds,[...log.matchAll(/SEQUENCE_ACTION (\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]).kind));
  check('failure/same-marker/'+r.prefix,r.reproduced,log.includes(summary.marker));
  if(r.reproduced){
   check('failure/stack/'+r.prefix,true,/Object\.destination .*sequence-actions\.js:16:63/.test(record.failure));
   const [buy,undo]=record.actions,expected=structuredClone(buy.before);
   check('failure/legal-buy/'+r.prefix,[null,true],[expected.players[1].towns[0].production,expected.players[1].gold>=20]);
   expected.players[1].gold-=20;expected.players[1].towns[0].production={name:'noob',turns:1};
   check('failure/buy/'+r.prefix,expected,buy.after);check('failure/undo/'+r.prefix,buy.before,undo.after);
  }else check('failure/prefix-stop',true,log.includes("error: 'LEGAL_PREFIX_COMPLETE:1'"));
 }
 return {commit:'c9cfc7073b085a20ea9e9d3d14940933ec6124e6',smallestObservedFailingLegalPrefix:2,shorterPrefixExit:1,shorterPrefixReason:'intentional LEGAL_PREFIX_COMPLETE:1, not a passing game',originalRunPass:false,originalCleanup:false};
}
module.exports={reviewFailure};
