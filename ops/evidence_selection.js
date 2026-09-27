'use strict';
// Explicit, read-only selection at the gate's A.inventory boundary. No saved
// inventory verdict is an input to disposition derivation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C=require('./reconcile_evidence_catalog'),H=require('./consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-70');
const COVERAGE='423f00671f57e0b96a38bd6d91c9a03c53985cac3b8d8ce598a3b6f788068c4b';
const ROWS='a1c098dd226b8b2adf17cb42730fb2d17f05fb19252c79b21126b7e9d7bf5670';
const reports=[['review.json','ac1-independent-review.json','prepare_asset_review.py'],['version-review.json','ac2-independent-review.json','review_version_gameplay.py'],['recovery-review.json','ac3-independent-review.json','review_asset_recovery.py'],['bounds-review.json','ac7-independent-review.json','review_asset_bounds.py']];
function selection(tasks,research,prepared=path.join(BASE,'prepared')) {
    const fresh=C.prepare(tasks,research),rows=A.read(path.join(BASE,'reviewed-crosswalk.json'));
    for(const [name] of reports){const row=A.read(path.join(prepared,name));fresh.candidate.reviews[fresh.candidate.reviews.findIndex(r=>r.id===row.id)]=row;}
    return {...fresh.candidate,evidenceSelection:{version:1,baseline:BASE,coverageSha256:COVERAGE,rowsSha256:ROWS,
        annex:fresh.annex,prepared,provider:A.read(path.join(BASE,'provider-binding.json'))}};
}
// Cache only bytes freshly read in this synchronous transaction. Hash every
// cached file again on exit; never persist caches or reuse prior verdicts.
function transaction(fn) {
    const original={read:A.read,proofKey:A.proofKey},reads=new Map(),proofs=new Map();
    const metrics={reads:0,readHits:0,proofs:0,proofHits:0,finalHashes:0};
    A.read=file=>{const key=fs.realpathSync(file);metrics.reads++;if(reads.has(key)){metrics.readHits++;return reads.get(key).value;}
        const bytes=fs.readFileSync(key),value=JSON.parse(bytes);reads.set(key,{value,sha:require('node:crypto').createHash('sha256').update(bytes).digest('hex')});return value;};
    A.proofKey=(dir,file,manifest)=>{const base=fs.realpathSync(dir),absolute=fs.realpathSync(path.resolve(dir,file));
        const relative=path.relative(base,absolute).split(path.sep).join('/'),key=JSON.stringify([base,file,manifest[relative]]);metrics.proofs++;
        if(proofs.has(key)){metrics.proofHits++;return proofs.get(key).relative;}
        const result=original.proofKey(dir,file,manifest);proofs.set(key,{absolute,relative:result,sha:manifest[result]});return result;};
    try{const result=fn();return {result,metrics};}finally{
        A.read=original.read;A.proofKey=original.proofKey;
        for(const [file,record] of reads){assert.equal(A.hash(file),record.sha,'selection-read-changed:'+file);metrics.finalHashes++;}
        for(const record of proofs.values()){assert.equal(A.hash(record.absolute),record.sha,'selection-proof-changed:'+record.absolute);metrics.finalHashes++;}
    }
}
function inventory(tasks,research,input,{deadline=Date.now()+3300000,onPhase=()=>{}}={}) {
    const phases=[];const phase=(name,fn)=>{assert(Date.now()<deadline,'selection deadline');const start=Date.now();onPhase('BEGIN '+name);const result=fn();const row={name,elapsedMs:Date.now()-start};phases.push(row);onPhase('PASS '+name+' elapsedMs='+row.elapsedMs);return result;};
    const tx=transaction(()=>{
        const s=input.evidenceSelection;assert(s?.version===1,'missing-explicit-selection');
        assert.equal(s.baseline,BASE,'wrong-selection-baseline');assert.equal(s.coverageSha256,COVERAGE,'wrong-selection-release');assert.equal(s.rowsSha256,ROWS,'wrong-selection-rows');
        const fresh=C.prepare(tasks,research),candidate=structuredClone(input);delete candidate.evidenceSelection;
        phase('frozen-reference-bindings',()=>{
            assert.equal(A.hash(path.join(BASE,'coverage-results.json')),COVERAGE,'changed-reference-coverage');
            assert.equal(A.hash(path.join(BASE,'reviewed-crosswalk.json')),ROWS,'changed-reference-rows');
            const coverage=A.read(path.join(BASE,'coverage-results.json'));
            for(const [name,sha] of Object.entries(coverage.evidenceHashes))assert.equal(A.hash(path.join(BASE,name)),sha,'reference-proof:'+name);
            for(const run of ['review-64','review-68','review-70'])for(const [name,sha] of Object.entries(A.read(path.join(A.client,'artifacts/TASK-225',run,'coverage-results.json')).toolHashes))assert.equal(A.hash(path.join(A.client,name)),sha,'reference-tool:'+name);
            assert.deepEqual(s.annex,fresh.annex,'wrong-selection-annex');
            assert.deepEqual(s.provider,A.read(path.join(BASE,'provider-binding.json')),'wrong-selection-provider');
            const expected=structuredClone(fresh.candidate),retained=A.read(path.join(BASE,'reviewed-crosswalk.json'));
            for(const [name] of reports){const row=A.read(path.join(s.prepared,name));assert.deepEqual(row,retained.reviews.find(r=>r.id===row.id),'wrong-selection-owner');expected.reviews[expected.reviews.findIndex(r=>r.id===row.id)]=row;}
            assert.deepEqual(candidate,expected,'omitted-or-changed-retained-row');
        });
        phase('provider-projection-and-independent-oracles',()=>{
            const selected=path.join(s.prepared,'selected-211'),provenance=A.read(path.join(s.prepared,'provenance.json'));
            assert.deepEqual(provenance,A.read(path.join(BASE,'prepared/provenance.json')),'changed-selection-provenance');
            assert.equal(fs.realpathSync(s.provider.original),fs.realpathSync(provenance.original),'wrong-selection-provider-path');
            assert.equal(A.hash(path.join(s.provider.original,'coverage-results.json')),s.provider.coverageSha256,'wrong-selection-provider-release');
            const manifest=A.read(path.join(selected,'evidence-hashes.json'));
            assert.deepEqual(manifest,A.read(path.join(BASE,'prepared/selected-211/evidence-hashes.json')),'changed-selected-manifest');
            for(const name of Object.keys(manifest))A.proofKey(selected,name,manifest);
            const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
            assert.deepEqual(files(provenance.original),Object.keys(provenance.originalFiles).sort(),'incomplete-provider-binding');
            for(const [name,sha] of Object.entries(provenance.originalFiles)){
                assert.equal(A.hash(path.join(provenance.original,name)),sha,'changed-original:'+name);
                assert.equal(manifest[name==='coverage-results.json'?'original-coverage.json':name],sha,'changed-projection:'+name);
            }
            const projected=structuredClone(A.read(path.join(provenance.original,'coverage-results.json')));
            for(const c of projected.cases){assert(!c.proof&&!c.proofs&&c.proofPaths.length,'unsupported-projection');c.proofs=c.proofPaths;}
            assert.deepEqual(A.read(path.join(selected,'coverage-results.json')),projected,'invalid-coverage-projection');
            for(const [,name,script] of reports)phase('oracle/'+script,()=>{
                const args=script==='prepare_asset_review.py'?['recompute','--archive',provenance.original,'--manifest-sha256',provenance.coverageSha256]:[provenance.original,provenance.coverageSha256];
                const r=spawnSync('python3',[path.join(__dirname,script),...args],{encoding:'utf8',timeout:Math.min(60000,deadline-Date.now()),maxBuffer:32*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
                assert.equal(r.status,0,'independent-oracle:'+script+':'+r.stderr);assert.deepEqual(A.read(path.join(selected,name)),JSON.parse(r.stdout),'changed-independent-report:'+name);
            });
        });
        const base=phase('historical-inventory',()=>C.inventory(tasks,research,fresh.candidate,s.annex));
        const run=phase('selected-provider-inspection',()=>A.inspectRun(tasks.find(t=>t.id==='TASK-211'),path.join(s.prepared,'selected-211')));
        assert(run.historicalValid,'invalid-selected-provider:'+run.issues.join(','));
        const after=phase('cumulative-clause-consumption',()=>H.consume({...base,runs:base.runs.map(r=>r.task===run.task?run:r)},tasks,research,candidate,[{id:'TASK-211',key:'TASK-211'}]));
        assert.deepEqual(after.inputIssues,[]);assert.deepEqual(after.unexplainedGaps,[]);
        return after;
    });
    return {report:tx.result,phases,metrics:tx.metrics};
}
module.exports={selection,inventory,transaction,BASE};
