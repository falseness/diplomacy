'use strict';
// Only these immutable archives may supply a past freshness observation. This
// API never answers whether a run is current; the ordinary consumer still does.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const pins=require('./historical_source_pins.json');
const observations=new Map(),oracleExecutions=[];
function pinned(file,sha,label) {
 assert.equal(A.hash(file),sha,'historical binding '+label);
 return A.read(file);
}
function observation(id,dir,identities) {
 const record=pins.records[id];assert(record,'unknown historical source binding');
 const ancestry=pinned(pins.ancestry.file,pins.ancestry.sha256,'ancestry');
 assert(ancestry[record.selectionKey],'missing historical selection');
 assert.equal(fs.realpathSync(dir),fs.realpathSync(record.directory),'unreviewed historical directory');
 const source=path.join(record.directory,'source-identities.json');
 const saved=pinned(source,record.sourceSha256,'source manifest');
 assert.deepEqual(identities,saved,'rewritten historical source identities');
 assert.deepEqual(saved.before,saved.after,'historical sources changed during acquisition');
 assert.deepEqual(saved.stale,[],'historical acquisition stale');
 const report=pinned(record.report,record.reportSha256,'review report');
 const checks=record.assertionIds.map(id=>{
  const matches=report.checks.filter(c=>c.id===id);assert.equal(matches.length,1,'historical freshness assertion count');
  const c=matches[0];assert.equal(c.pass,true);assert.deepEqual(c.expected,[]);assert.deepEqual(c.observed,c.expected);return c;
 });
 assert(checks.length,'missing historical freshness observation');
 const sourceDifferences=A.compareSources(saved);
 observations.set(id,{id,directory:record.directory,sourceSha256:record.sourceSha256,report:record.report,reportSha256:record.reportSha256,assertionIds:record.assertionIds,
  classification:sourceDifferences.length?'historical-stale':'historical-current-at-review',sourceDifferences,
  claim:'Revalidated recorded freshness only; semantic assertions are independently re-executed and live source differences remain consumer inputs.'});
 return structuredClone(checks[0].observed);
}
function compareAssetReport(file, archived, recomputed) {
 const name=path.basename(file),record=pins.assetOracles[name];
 assert(record,'unknown historical asset report');
 assert.equal(fs.realpathSync(file),fs.realpathSync(record.file),'unreviewed historical asset report path');
 pinned(pins.ancestry.file,pins.ancestry.sha256,'ancestry');
 const saved=pinned(file,record.sha256,'asset report');
 assert.deepEqual(archived,saved,'rewritten historical asset report');
 const identities=pinned(path.join(path.dirname(file),'source-identities.json'),record.sourceSha256,'asset source manifest');
 assert.deepEqual(identities.before,identities.after,'historical asset acquisition changed sources');
 assert.deepEqual(identities.stale,[],'historical asset acquisition stale');
 assert.equal(saved.currentSourceValid,true,'historical asset freshness');
 assert.deepEqual(saved.sourceMismatches,[],'historical asset differences');
 const differences=A.compareSources(identities).map(({role,file,expected,observed})=>({repo:role,path:file,expected,observed}));
 assert.equal(recomputed.currentSourceValid,differences.length===0,'asset reader live freshness');
 assert.deepEqual(recomputed.sourceMismatches,differences,'asset reader live differences');
 const semantic=report=>{const value=structuredClone(report);delete value.currentSourceValid;delete value.sourceMismatches;return value;};
 assert.deepEqual(semantic(recomputed),semantic(saved),'changed independent asset semantics');
 observations.set('asset-oracle/'+name,{id:'asset-oracle/'+name,report:file,reportSha256:record.sha256,
  historical:{currentSourceValid:saved.currentSourceValid,sourceMismatches:saved.sourceMismatches},
  current:{currentSourceValid:recomputed.currentSourceValid,sourceMismatches:recomputed.sourceMismatches},
  semanticAssertions:recomputed.checks.length,semanticEquality:true,classification:differences.length?'historical-stale':'historical-current-at-review'});
}
function toolIdentities() {
 const modules=require('./historical_ancestry_modules.json'),result={};
 for(const [name,binding] of Object.entries(modules)) {
  assert.equal(A.hash(path.join(__dirname,name)),binding.originalSha256,'changed frozen ancestry tool:'+name);
  const file=path.join(__dirname,'terminal_ancestry_v1',name);
  assert.equal(A.hash(file),binding.versionedSha256,'changed versioned ancestry tool:'+name);
  result['terminal_ancestry_v1/'+name]=binding.versionedSha256;
 }
 for(const name of ['historical_source_binding.js','historical_source_pins.json','historical_ancestry_modules.json'])result[name]=A.hash(path.join(__dirname,name));
 return result;
}
module.exports={observation,compareAssetReport,toolIdentities,observations,oracleExecutions};
