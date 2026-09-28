'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const H=require('./historical_source_binding'),pins=require('./historical_source_pins.json');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
test('only the pinned historical sources produce past freshness; live staleness remains visible',()=>{
 for(const [id,r] of Object.entries(pins.records)) {
  const ids=A.read(path.join(r.directory,'source-identities.json'));
  assert.deepEqual(H.observation(id,r.directory,ids),[]);
  const observation=H.observations.get(id);
  assert.deepEqual(observation.sourceDifferences,A.compareSources(ids));
  assert(observation.sourceDifferences.some(d=>d.file==='player.js'),id+' must retain Player staleness');
  assert.equal(observation.classification,'historical-stale');
 }
});
test('reject unknown archive, wrong path and rebound historical implementation',()=>{
 const r=pins.records.competitive,ids=A.read(path.join(r.directory,'source-identities.json'));
 assert.throws(()=>H.observation('unknown',r.directory,ids),/unknown historical/);
 assert.throws(()=>H.observation('competitive',path.dirname(r.directory),ids),/unreviewed historical directory/);
 const bad=structuredClone(ids);bad.after.client.files['player.js']='09095f1b53aad727d3270a1fe2187fc91a6d6599db8b2be370cbb8d9beaa71a1';
 assert.throws(()=>H.observation('competitive',r.directory,bad),/rewritten historical source identities/);
});
test('all frozen and versioned reader modules match the explicit binding',()=>{
 assert.equal(Object.keys(H.toolIdentities()).length,38);
});

test('asset report comparison preserves live differences and rejects semantic or freshness corruption',()=>{
 const r=pins.assetOracles['ac1-independent-review.json'],saved=A.read(r.file),current=structuredClone(saved);
 const ids=A.read(path.join(path.dirname(r.file),'source-identities.json'));
 current.sourceMismatches=A.compareSources(ids).map(({role,file,expected,observed})=>({repo:role,path:file,expected,observed}));
 current.currentSourceValid=current.sourceMismatches.length===0;
 H.compareAssetReport(r.file,saved,current);
 const bad=structuredClone(current);bad.checks[0].observed='corrupt';bad.checks[0].expected='corrupt';
 assert.throws(()=>H.compareAssetReport(r.file,saved,bad),/changed independent asset semantics/);
 assert.throws(()=>H.compareAssetReport(r.file,saved,saved),/asset reader live freshness/);
 const rewritten=structuredClone(saved);rewritten.currentSourceValid=false;
 assert.throws(()=>H.compareAssetReport(r.file,rewritten,current),/rewritten historical asset report/);
});
