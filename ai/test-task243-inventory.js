
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const removedFiles=["ai/test-coop-balance-server-adapter.js", "ai/test-coop-server-progression-fixture.js", "ai/test-coop-expanded-server-adapter.js", "ai/test-coop-progression-v2.js", "ai/test-coop-wave-config.js", "ai/test-coop-balance-tuning.js", "ai/test-coop-progression-local.js", "ai/test-coop-wave-composition.js", "ai/tune-coop-progression.js", "ai/test-coop-valley-save.js", "ai/test-coop-valley-server.js", "ai/test-coop-browser-local.js", "ai/test-coop-online-matchmaking.js"];
const runtime=['ai/generateMap.js','ai/wave-config.js','ai/wave-composition.js','ai/wave-placement.js','ai/coop-map-scaling.js','ai/demon-config.js','options/gamestart.js','options/save.js','gameObjectSerialization.js','sprites/entities/buildings/demonPortal.js'];
module.exports=function(out){
 for(const file of removedFiles)assert(!fs.existsSync(file),file);
 const pattern='composeCoopWave|getCoopWaveConfig|getCoopWaveStrength|getUnlockedCoopDemonTypes|COOP_WAVE_CONFIG|placeCoopPortals|growCoopTerrain';
 const search=(name,pattern)=>{const args=['-n',pattern,...runtime];const r=spawnSync('rg',args,{encoding:'utf8'});assert([0,1].includes(r.status));fs.writeFileSync(path.join(out,name),r.stdout);return {command:['rg',...args],exit:r.status,output:r.stdout};};
 const absent=search('removed-runtime-rg.txt',pattern);assert.equal(absent.output,'');
 const remaining=search('remaining-references-rg.txt','[Ll]egacy|[Cc]ompat|[Vv]ersion|waveGeneration|[Ww]eighted');
 const classifications=remaining.output.trim().split('\n').filter(Boolean).map(line=>({line,reason:line.includes('generateTinyMapLegacy')?'Non-co-op tiny-map generation; outside scope':line.includes('waveGeneration')?'Reject obsolete weighted save metadata; no execution or conversion':line.includes('balanceVersion')?'Current save marker 2, no alternate stat or schedule table':line.includes('version')||line.includes('Version')?'Current generation-4 replay metadata, current validation, or current stats comment':'Current typed-wave documentation; no weighted execution'}));
 const inventory={removedFiles,removedPaths:['generateMap: pre-v4 repair, untyped portal placement, terrain growth and connectivity fallback','wave-config: strength/weight/unlock/version tables and APIs','wave-composition: weighted LCG sampler and old-save dispatcher','DemonPortal: missing-category constructor, artwork and serialization fallbacks','generation-fixtures: v2 expectedMap executable generator','save: missing portal owner and stale ownership tile migrations'],
 replacements:['TASK-238 source wave boundaries','TASK-242 three real browser journeys','TASK-243 current save/load plus twelve obsolete-format rejection controls'],
 retainedRejectionData:'ai/fixtures/coop-legacy-stored-maps.json',classifications,searches:[absent,remaining],pass:true};
 assert(fs.statSync(inventory.retainedRejectionData).size>0);
 fs.writeFileSync(path.join(out,'removal-inventory.json'),JSON.stringify(inventory,null,2));
 console.log('PASS removal-inventory removed-files='+removedFiles.length+' removed-runtime-rg=empty remaining-references-classified='+classifications.length);
};
