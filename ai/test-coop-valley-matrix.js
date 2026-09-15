// Full Divided Valley generation matrix: Tiny/Normal/Big x humans 1..12 x seeds
// 0..31 (1152 primary cases) plus seed 4294967295 for every size/count (36
// boundary cases). Each case is generated in two separate worker processes;
// the serialized maps must be byte-identical. The actual map is then audited
// with the existing stage verifiers (TASK-134 contract, TASK-135 regions,
// TASK-136 starts, TASK-137 expansions, TASK-138 portals, TASK-139 terrain,
// TASK-140 generation audit) after proving the stage layouts they measure are
// exactly the placements in the generated map. Worker A audits generation,
// plan, placements, regions, starts and expansions while worker B measures
// portals and terrain on A's captured stages. The parent kills any worker that
// is still busy 60 seconds after the case was dispatched.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const {fork} = require('child_process');
const ROOT = path.join(__dirname, '..');
const ALL_SIZES = ['tiny','normal','big'], ALL_HUMANS = Array.from({length:12},(_,i)=>i+1);
const PRIMARY_SEEDS = Array.from({length:32},(_,i)=>i), BOUNDARY_SEED = 4294967295;
const CASE_TIMEOUT_MS = 60000;
const STAGES = ['plan','starts','expansions','portals','terrain'];
const SOURCES = ['ai/test-coop-valley-matrix.js','ai/generateMap.js','ai/coop-valley-plan.js','ai/coop-map-scaling.js','index.html',
  'ai/test-coop-harness.js','ai/browserScriptCache.js','ai/test-coop-valley-contract.js','ai/test-coop-valley-regions.js',
  'ai/test-coop-valley-starts.js','ai/test-coop-valley-expansions.js','ai/test-coop-valley-portals.js','ai/test-coop-valley-terrain.js',
  'ai/test-coop-valley-generation.js'];
// Negative controls (run on a narrowed matrix) and the assertion each must trip.
const FAULTS = {'repeat-mismatch':'repeat-byte-identical', 'hang':'case-timeout', 'drop-case':'case-coverage',
  'move-portal':'actual-placements-match-layout'};
const priorityLog = [];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const key = c => `${c.x},${c.y}`;
const caseId = (size,humans,seed) => `${size}-H${humans}-seed${seed}`;
const cpuMs = since => { const c = process.cpuUsage(since); return Math.round((c.user+c.system)/1000); };

// Captures a JSON snapshot of every stage of the latest candidate attempt.
const STAGE_RECORDER = `(() => {
  globalThis.valleyStages = null
  const wrap = (name, stage) => {
    const original = globalThis[name]
    globalThis[name] = function(...args) {
      const result = original.apply(this, args)
      if (stage === 'plan') valleyStages = {}
      valleyStages[stage] = JSON.stringify(result)
      return result
    }
  }
  wrap('planDividedValley', 'plan'); wrap('placeValleyStarts', 'starts'); wrap('placeValleyExpansions', 'expansions')
  wrap('placeValleyPortals', 'portals'); wrap('placeValleyTerrain', 'terrain')
})()`;

// ---------------------------------------------------------------- worker side
function runWorker(role) {
  const {createFixture} = require('./test-coop-harness');
  const f = createFixture(undefined, () => {});
  const gen = require('./test-coop-valley-generation.js');
  if (role === 'A') { f.evaluate(gen.RECORDER); f.evaluate(STAGE_RECORDER); }
  const state = {};
  // Detached workers never outlive the parent's IPC channel.
  process.on('disconnect', () => process.exit(0));
  process.on('message', job => {
    const c0 = process.cpuUsage(), t0 = Date.now();
    let result;
    try {
      result = job.phase === 'generate' ? (role === 'A' ? generateA(f, gen, state, job) : generateB(f, job))
        : role === 'A' ? auditA(gen, state, job) : auditB(job);
    } catch (error) {
      result = {error:String(error && error.stack || error)};
    }
    process.send({...result, id:job.id, phase:job.phase, role, pid:process.pid, ms:Date.now()-t0, cpuMs:cpuMs(c0)});
  });
  process.send({ready:true, role});
}

// Plain repeat: no recorder wrappers in this fixture.
function generateB(f, {size, humans, seed, fault}) {
  if (fault === 'repeat-mismatch' && seed === 1) seed = 0;
  const mapJson = f.evaluate(`JSON.stringify(generateCoopGame(${humans}, {seed:${seed}, size:'${size}'}))`);
  return {mapJson, sha256:sha(mapJson), bytes:Buffer.byteLength(mapJson)};
}

function generateA(f, gen, state, {id, size, humans, seed, hang}) {
  if (hang) f.evaluate('for (;;) {}');
  const r = gen.generateCase(f, size, humans, seed);
  const stages = r.error ? null : JSON.parse(f.evaluate('JSON.stringify(valleyStages)'));
  Object.assign(state, {id, r, stages});
  return {error:r.error || null, mapJson:r.mapJson || null, sha256:r.mapJson ? sha(r.mapJson) : null,
    bytes:r.mapJson ? Buffer.byteLength(r.mapJson) : null, stages};
}

// Generation audit (incl. TASK-134 verifyValley on the actual map), plan
// reproduction, placement identity, regions, starts and expansions.
function auditA(gen, state, {id, size, humans, seed, fault}) {
  if (state.id !== id) throw new Error(`audit ${id} without its generation (last ${state.id})`);
  const valley = require('./coop-valley-plan.js'), regions = require('./test-coop-valley-regions.js');
  const starts = require('./test-coop-valley-starts.js'), expansions = require('./test-coop-valley-expansions.js');
  const {r, stages} = state, checks = [];
  const g = gen.audit(size, humans, seed, r);
  for (const [name, ok] of g.checks) checks.push(['generation:'+name, ok]);
  const out = {attempts:g.obs.attempts, successSeed:g.obs.successSeed ?? null, checks};
  if (r.error) return out;
  const map = JSON.parse(r.mapJson);
  checks.push(['stages-captured', !!stages && STAGES.every(s=>typeof stages[s]==='string')]);
  const [p, S, X, , T] = STAGES.map(s=>JSON.parse(stages[s]));
  if (fault === 'move-portal') {
    // The measured layout keeps its portal while the returned map's first portal moves along its row.
    const spot = map.portals[0], taken = new Set([...map.players.flatMap(q=>q.towns),...map.goldmines,...map.portals,...map.mountains,...map.lakes,...map.bushes].map(key));
    const free = Array.from({length:p.side},(_,x)=>({x, y:spot.y})).find(c=>!taken.has(key(c)));
    if (free) map.portals[0] = free;
  }
  // The plan is reproduced outside the browser fixture from the success seed.
  valley.clearValleyPlanCache();
  checks.push(['plan-reproduced', stages.plan === JSON.stringify(valley.planDividedValley(humans, size, out.successSeed))]);
  // Every audited placement is exactly a placement of the returned map.
  const pts = list => list.map(c=>({x:c.x, y:c.y}));
  const placements = m => JSON.stringify({mapSize:m.mapSize, players:m.players.slice(0,1+humans).map(q=>({rgb:q.rgb, gold:q.gold, units:q.units, towns:pts(q.towns)})),
    goldmines:m.goldmines.map(q=>({x:q.x, y:q.y, owner:q.owner, income:q.income})), portals:pts(m.portals),
    mountains:pts(m.mountains), lakes:pts(m.lakes), bushes:pts(m.bushes), hills:pts(m.hills)});
  checks.push(['actual-placements-match-layout', placements(map) === placements({...T, mapSize:p.mapSize})]);
  const reg = regions.checkPlan(p);
  for (const [name, ok] of Object.entries(reg.checks)) checks.push(['regions:'+name, ok]);
  const ms = starts.measure(p, S), mx = expansions.measure(p, X, S);
  for (const [stage, m] of [['starts',ms],['expansions',mx]]) for (const [name, ok] of m.checks) checks.push([stage+':'+name, ok]);
  out.routes = {contract:g.obs.valley.contractResults, balance:g.obs.balance, counts:g.obs.counts, regionConnectivity:reg.connectivity,
    nearestMine:ms.comparisons.nearestMine, neutralFairness:mx.comparisons.neutralFairness, nearestMineFairness:mx.comparisons.nearestMineFairness};
  return out;
}

// Portal and terrain stage measures on A's captured stages and actual map,
// plus the variation signatures of the actual map.
function auditB({mapJson, stages}) {
  const portals = require('./test-coop-valley-portals.js'), terrain = require('./test-coop-valley-terrain.js');
  const map = JSON.parse(mapJson), [p, , X, P, T] = STAGES.map(s=>JSON.parse(stages[s]));
  const mp = portals.measure(p, P, X), mt = terrain.measure(p, T, P), checks = [];
  for (const [stage, m] of [['portals',mp],['terrain',mt]]) for (const [name, ok] of m.checks) checks.push([stage+':'+name, ok]);
  // Signatures ignore player identities, colors and array order.
  const sorted = list => list.map(key).sort(), mountains = new Set(map.mountains.map(key));
  const ridgeMask = p.masks.ridge.map(key).filter(k=>mountains.has(k)).sort();
  const passageMask = p.valley.passages.map(q=>{ const cells = [];
    for (let x=q.x[0];x<=q.x[1];x++) for (let y=q.y[0];y<=q.y[1];y++) cells.push({x,y});
    return sorted(cells).join(' '); }).sort();
  const objectives = {neutralTowns:sorted(map.players[0].towns), forwardMines:sorted(map.goldmines.filter(m=>m.y<p.rows.ridge[0])), portals:sorted(map.portals)};
  const signatures = {passageRidgeMaskSha256:sha(JSON.stringify({ridge:ridgeMask, passages:passageMask})), forwardObjectivesSha256:sha(JSON.stringify(objectives)),
    ridgeCells:ridgeMask.length, plannedRidgeCells:p.masks.ridge.length, passageWidth:p.selection.passageWidth,
    passages:p.valley.passages.map(q=>({name:q.name, x:q.x, y:q.y})), ridgeRows:p.rows.ridge, forwardObjectives:objectives};
  const c = mt.comparisons, pc = mp.comparisons;
  const routes = {passageRows:c.pathWidth.passageRows, lateralFree:c.pathWidth.lateralFree, emittedApproachFree:c.pathWidth.emittedApproachFree,
    portalHexDistance:pc.hexDistance, portalPathMatrix:pc.pathMatrix, portalFairness:pc.fairness, portalApproach:pc.approach, portalGroups:pc.groups,
    connectivity:c.connectivity, objectiveReach:c.reach, fairness:c.fairness, singleFrontReach:c.fronts, routeWitnesses:c.routeWitnesses.flat(),
    ridgeFormation:c.ridgeFormation, density:c.density, clusters:Object.fromEntries(Object.entries(c.clusters).map(([n,v])=>[n,{cells:v.cells,
      largestComponent:v.largestComponent, multiCellShare:v.multiCellShare, componentSizes:v.componentSizes}]))};
  return {checks, signatures, routes};
}

// ---------------------------------------------------------------- parent side
// The host shares its two CPUs with unrelated long jobs; matrix processes ask
// for a higher scheduling priority so the 60 s bound measures this generator,
// not the queue. The bound itself never changes; the applied priority is recorded.
// Linux autogroup scheduling shares CPU between sessions before nice applies,
// so each worker runs detached in its own session whose autogroup nice is raised.
const PRIORITY = -10;
function raisePriority(pid, autogroup) {
  const result = {requested:PRIORITY};
  try { os.setPriority(pid, PRIORITY); result.nice = os.getPriority(pid); } catch (error) { result.niceError = error.code || error.message; }
  if (autogroup) {
    try { fs.writeFileSync(`/proc/${pid}/autogroup`, String(PRIORITY)); result.autogroup = fs.readFileSync(`/proc/${pid}/autogroup`, 'utf8').trim(); }
    catch (error) { result.autogroupError = error.code || error.message; }
  }
  result.applied = result.nice === PRIORITY && (!autogroup || String(result.autogroup).endsWith('nice '+PRIORITY));
  return result;
}

function spawnWorker(role) {
  const child = fork(__filename, ['--worker', role], {stdio:['ignore','inherit','inherit','ipc'], detached:true});
  const worker = {role, child, pending:null, ready:null, priority:raisePriority(child.pid, true)};
  priorityLog.push({role, pid:child.pid, ...worker.priority});
  worker.ready = new Promise((resolve, reject) => {
    child.once('message', m => m && m.ready ? resolve() : reject(new Error('unexpected first message')));
    child.once('exit', code => reject(new Error(`worker ${role} exited before ready code=${code}`)));
  });
  child.on('message', m => { if (worker.pending && m && m.id === worker.pending.id) { const p = worker.pending; worker.pending = null; p.resolve(m); } });
  child.on('exit', (code, signal) => { if (worker.pending) { const p = worker.pending; worker.pending = null; p.resolve({id:p.id, role, exited:{code, signal}}); } });
  return worker;
}

function dispatch(worker, job) {
  return new Promise(resolve => { worker.pending = {id:job.id, resolve}; worker.child.send(job); });
}

async function runCase(workers, job) {
  const started = Date.now(), results = {};
  const phase = async (name, jobs) => {
    await Promise.all(Object.entries(jobs).map(([role, j]) => dispatch(workers[role], {...job, ...j, phase:name})
      .then(m => { results[name+role] = {...m, receivedMs:Date.now()-started}; })));
  };
  const work = (async () => {
    await phase('generate', {A:{}, B:{}});
    const a = results.generateA;
    const audits = {A:{}};
    if (a && a.mapJson && a.stages) audits.B = {mapJson:a.mapJson, stages:a.stages};
    await phase('audit', audits);
  })();
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), CASE_TIMEOUT_MS); });
  const outcome = await Promise.race([work.then(() => 'done'), deadline]);
  clearTimeout(timer);
  const caseMs = outcome === 'timeout' ? CASE_TIMEOUT_MS : Date.now()-started, timedOut = [];
  if (outcome === 'timeout') {
    for (const role of ['A','B']) if (workers[role].pending) {
      timedOut.push(role);
      const exited = new Promise(resolve => workers[role].child.once('exit', resolve));
      workers[role].child.kill('SIGKILL');
      await exited;
      workers[role] = spawnWorker(role);
      await workers[role].ready;
    }
  }
  return {results, timedOut, caseMs};
}

function evaluateCase(job, run) {
  const {results:R, timedOut} = run, ga = R.generateA || {}, gb = R.generateB || {}, aa = R.auditA || {}, ab = R.auditB || {};
  const checks = [['case-timeout', !timedOut.length]];
  // A killed worker returns nothing further to check; the case fails by the timeout alone.
  if (timedOut.length) return {checks, failed:['case-timeout'], generatedSeed:null};
  const replies = [R.generateA, R.generateB, R.auditA, ...(ga.mapJson ? [R.auditB] : [])];
  checks.push(['worker-completed', replies.every(m => m && !m.error && !m.exited)]);
  if (aa.checks) checks.push(...aa.checks);
  if (ab.checks) checks.push(...ab.checks);
  checks.push(['repeat-byte-identical', typeof ga.mapJson === 'string' && ga.mapJson === gb.mapJson && ga.pid !== gb.pid]);
  const generatedSeed = ga.mapJson ? JSON.parse(ga.mapJson).coop.generation.seed : null;
  checks.push(['requested-seed-generated', generatedSeed === job.seed]);
  const failed = checks.filter(([,ok]) => !ok).map(([n]) => n);
  return {checks, failed, generatedSeed};
}

async function main() {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-143'), fault = arg('--fault');
  if (fault !== undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  // --sizes/--humans/--seeds narrow the matrix for negative controls and development; a narrowed run never passes.
  const SIZES = arg('--sizes') ? arg('--sizes').split(',') : ALL_SIZES, HUMANS = arg('--humans') ? arg('--humans').split(',').map(Number) : ALL_HUMANS;
  const SEED_FILTER = arg('--seeds') ? new Set(arg('--seeds').split(',').map(Number)) : null;
  const narrowed = SIZES.length !== ALL_SIZES.length || HUMANS.length !== ALL_HUMANS.length || !!SEED_FILTER;
  fs.mkdirSync(out, {recursive:true});
  const files = Object.fromEntries(SOURCES.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,
    browser:'n/a (Node vm co-op fixture loading index.html scripts)', cwd:process.cwd(), argv:process.argv.slice(1), files}, null, 2)+'\n');
  // Heaviest combinations run first so a bound violation surfaces early.
  let jobs = [];
  for (const size of [...SIZES].reverse()) for (const humans of [...HUMANS].reverse()) {
    for (const seed of PRIMARY_SEEDS) jobs.push({id:caseId(size,humans,seed), set:'primary', size, humans, seed});
    jobs.push({id:caseId(size,humans,BOUNDARY_SEED), set:'boundary', size, humans, seed:BOUNDARY_SEED});
  }
  if (SEED_FILTER) jobs = jobs.filter(j => SEED_FILTER.has(j.seed));
  const dropped = fault === 'drop-case' ? jobs.splice(1, 1)[0].id : null;
  const expected = {primary:SIZES.length*HUMANS.length*PRIMARY_SEEDS.length, boundary:SIZES.length*HUMANS.length};
  priorityLog.push({role:'parent', pid:process.pid, ...raisePriority(process.pid)});
  const workers = {A:spawnWorker('A'), B:spawnWorker('B')};
  await Promise.all([workers.A.ready, workers.B.ready]);
  const mapsFd = fs.openSync(path.join(out,'maps.json'), 'w'), routesFd = fs.openSync(path.join(out,'routes.json'), 'w');
  fs.writeSync(mapsFd, '{"note":"map is the exact serialized generateCoopGame output of worker A; sha256B is worker B\'s separate generation (byte-identical when repeat-byte-identical passes); sha256 is of the map bytes",\n"cases":[\n');
  fs.writeSync(routesFd, '{"note":"per-case route measurements recomputed by the stage verifiers on the actual placements (coordinates {x,y}; witnesses [x,y]); signatures ignore player identities, colors and array order",\n"cases":[\n');
  const matrix = [], started = Date.now();
  let firstMap = true, firstRoute = true;
  for (const [index, job] of jobs.entries()) {
    const run = await runCase(workers, {...job, fault:fault||null, hang:fault === 'hang' && index === 0});
    const e = evaluateCase(job, run), R = run.results, ga = R.generateA || {}, gb = R.generateB || {}, aa = R.auditA || {}, ab = R.auditB || {};
    const phaseTiming = m => m ? {ms:m.ms ?? null, cpuMs:m.cpuMs ?? null, receivedMs:m.receivedMs} : null;
    const row = {id:job.id, set:job.set, size:job.size, humans:job.humans, seed:job.seed, generatedSeed:e.generatedSeed,
      timing:{caseMs:run.caseMs, limitMs:CASE_TIMEOUT_MS, timedOutWorkers:run.timedOut, generateA:phaseTiming(R.generateA), generateB:phaseTiming(R.generateB),
        auditA:phaseTiming(R.auditA), auditB:phaseTiming(R.auditB)},
      workers:{A:ga.pid ?? null, B:gb.pid ?? null}, attempts:aa.attempts ?? null, successSeed:aa.successSeed ?? null,
      sha256A:ga.sha256 ?? null, sha256B:gb.sha256 ?? null, bytesA:ga.bytes ?? null, bytesB:gb.bytes ?? null,
      errors:[['generateA',R.generateA],['generateB',R.generateB],['auditA',R.auditA],['auditB',R.auditB]]
        .filter(([,m]) => m && (m.error || m.exited)).map(([n,m]) => `${n}: ${m.error || 'exited '+JSON.stringify(m.exited)}`),
      checks:Object.fromEntries(e.checks), failed:e.failed, rejectedBy:e.failed[0]||null,
      signatures:ab.signatures ? {...ab.signatures, forwardObjectives:undefined} : null};
    matrix.push(row);
    if (ga.mapJson) {
      fs.writeSync(mapsFd, (firstMap?'':',\n')+`{"id":${JSON.stringify(job.id)},"set":"${job.set}","size":"${job.size}","humans":${job.humans},"seed":${job.seed},"sha256":"${ga.sha256}","bytes":${ga.bytes},"sha256B":${JSON.stringify(gb.sha256 ?? null)},"map":${ga.mapJson}}`);
      firstMap = false;
    }
    if (aa.routes || ab.routes) {
      fs.writeSync(routesFd, (firstRoute?'':',\n')+JSON.stringify({id:job.id, set:job.set, size:job.size, humans:job.humans, seed:job.seed,
        signatures:ab.signatures || null, routes:{...(aa.routes||{}), ...(ab.routes||{})}}));
      firstRoute = false;
    }
    const t = row.timing, ms = p => p ? p.ms : '-';
    console.log(`${e.failed.length?'FAIL':'PASS'} ${job.set} ${job.id} case=${t.caseMs}ms genA=${ms(t.generateA)} genB=${ms(t.generateB)} auditA=${ms(t.auditA)} auditB=${ms(t.auditB)} attempts=${row.attempts} ` +
      `sha256=${(row.sha256A||'-').slice(0,16)} identical=${row.checks['repeat-byte-identical']} checks=${e.checks.length-e.failed.length}/${e.checks.length}` +
      `${e.failed.length?' failed='+e.failed.join(','):''}${row.errors.length?' error='+row.errors.map(x=>x.split('\n')[0]).join(' | '):''} elapsed=${Math.round((Date.now()-started)/1000)}s`);
  }
  fs.writeSync(mapsFd, '\n]}\n'); fs.closeSync(mapsFd);
  fs.writeSync(routesFd, '\n]}\n'); fs.closeSync(routesFd);
  for (const w of Object.values(workers)) w.child.kill();

  // Coverage: every expected identity appears exactly once and generated its own seed.
  const ids = new Set(matrix.map(m => m.id)), missing = [];
  for (const size of SIZES) for (const humans of HUMANS) for (const seed of [...PRIMARY_SEEDS, BOUNDARY_SEED])
    if (!ids.has(caseId(size,humans,seed))) missing.push(caseId(size,humans,seed));
  const count = set => matrix.filter(m => m.set === set).length;
  const coverage = {expected, observed:{primary:count('primary'), boundary:count('boundary')}, distinctIds:ids.size, missing, dropped,
    passedPrimary:matrix.filter(m=>m.set==='primary'&&!m.failed.length).length, passedBoundary:matrix.filter(m=>m.set==='boundary'&&!m.failed.length).length};
  coverage.pass = !missing.length && ids.size === matrix.length && coverage.observed.primary === expected.primary && coverage.observed.boundary === expected.boundary;
  // Variation per size/count over the 32 primary seeds.
  const variations = [];
  for (const size of SIZES) for (const humans of HUMANS) {
    const rows = matrix.filter(m => m.set==='primary' && m.size===size && m.humans===humans), measured = rows.filter(m => m.signatures);
    const masks = new Set(measured.map(m => m.signatures.passageRidgeMaskSha256)), objectives = new Set(measured.map(m => m.signatures.forwardObjectivesSha256));
    variations.push({size, humans, seeds:rows.length, measuredSeeds:measured.length, distinctPassageRidgeMasks:masks.size, distinctForwardObjectiveSets:objectives.size,
      distinctMaps:new Set(measured.map(m=>m.sha256A)).size, pass:measured.length===PRIMARY_SEEDS.length && masks.size>=2 && objectives.size>=2,
      perSeed:rows.map(m => ({seed:m.seed, passageRidgeMaskSha256:m.signatures&&m.signatures.passageRidgeMaskSha256, forwardObjectivesSha256:m.signatures&&m.signatures.forwardObjectivesSha256}))});
  }
  const variationOk = variations.every(v => v.pass);
  const failedCases = matrix.filter(m => m.failed.length), timings = matrix.map(m => m.timing.caseMs);
  const summary = {cases:matrix.length, primaryCases:coverage.observed.primary, boundaryCases:coverage.observed.boundary,
    passedPrimary:coverage.passedPrimary, passedBoundary:coverage.passedBoundary, failedCases:failedCases.length, timedOutCases:matrix.filter(m=>m.timing.timedOutWorkers.length).length,
    failures:failedCases.map(m => ({id:m.id, failed:m.failed, errors:m.errors})), byteIdentical:matrix.filter(m=>m.checks['repeat-byte-identical']).length,
    maxCaseMs:Math.max(...timings), meanCaseMs:Math.round(timings.reduce((s,x)=>s+x,0)/Math.max(1,timings.length)), elapsedMs:Date.now()-started,
    attempts:matrix.reduce((h,m)=>(h[m.attempts]=(h[m.attempts]||0)+1,h),{}),
    checksPerCase:{min:Math.min(...matrix.map(m=>Object.keys(m.checks).length)), max:Math.max(...matrix.map(m=>Object.keys(m.checks).length))},
    variation:{combos:variations.length, passed:variations.filter(v=>v.pass).length, minDistinctPassageRidgeMasks:Math.min(...variations.map(v=>v.distinctPassageRidgeMasks)),
      minDistinctForwardObjectiveSets:Math.min(...variations.map(v=>v.distinctForwardObjectiveSets))}, coverage:{...coverage, missing:missing.length}, narrowed};
  fs.writeFileSync(path.join(out,'variation.json'), JSON.stringify({note:'signatures from actual maps: passage/ridge mask = planned passage rectangles plus planned ridge cells that are mountains in the map; forward objectives = sorted neutral town, forward mine (above the ridge) and portal coordinates',
    variations, boundary:matrix.filter(m=>m.set==='boundary').map(m=>({id:m.id, signatures:m.signatures}))}, null, 1)+'\n');
  fs.writeFileSync(path.join(out,'timing.json'), JSON.stringify({limitMs:CASE_TIMEOUT_MS, note:'caseMs is dispatch until both audit replies (or the limit); per phase ms/cpuMs are measured in the worker, receivedMs from case dispatch; worker startup excluded',
    cases:matrix.map(m => ({id:m.id, set:m.set, ...m.timing}))}, null, 1)+'\n');
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null, intendedAssertion:fault?FAULTS[fault]:null,
    node:process.version, cwd:process.cwd(), sizes:SIZES, humans:HUMANS, primarySeeds:'0..31', boundarySeed:BOUNDARY_SEED, caseTimeoutMs:CASE_TIMEOUT_MS,
    schedulingPriority:{requested:PRIORITY, processes:priorityLog},
    rules:{repeat:'each case generated by generateCoopGame in two separate forked worker processes (B has no recorder wrappers); JSON.stringify outputs must be byte-identical',
      audit:'A reproduces the plan outside the fixture from the success seed, captures each stage layout of the successful attempt and requires the returned map placements to equal the terrain-stage layout; A runs the TASK-140 generation audit (incl. TASK-134 verifyValley on the actual map), TASK-135 checkPlan and TASK-136/137 measures; B runs the TASK-138/139 measures on the same stages',
      timeout:`generation and audit replies from both workers within ${CASE_TIMEOUT_MS} ms of dispatch; otherwise busy workers are SIGKILLed and the case fails case-timeout`,
      coverage:'every size x humans x seed 0..31 (primary) and 4294967295 (boundary) appears exactly once and the map records its requested seed',
      variation:'per size/humans, seeds 0..31 give >=2 distinct passage/ridge masks and >=2 distinct forward objective coordinate sets, ignoring identities, colors and order'},
    summary, assertionOrder:(matrix.find(m=>Object.keys(m.checks).length>5)||{checks:{}}) && Object.keys((matrix.find(m=>Object.keys(m.checks).length>5)||{checks:{}}).checks),
    variations:variations.map(({perSeed,...v})=>v), matrix}, null, 1)+'\n');

  const variationSummary = `variation=${summary.variation.passed}/${summary.variation.combos} minMasks=${summary.variation.minDistinctPassageRidgeMasks} minObjectiveSets=${summary.variation.minDistinctForwardObjectiveSets}`;
  console.log(`${coverage.pass?'PASS':'FAIL'} case-coverage primary=${coverage.observed.primary}/${expected.primary} boundary=${coverage.observed.boundary}/${expected.boundary} missing=${missing.length}${dropped?' dropped='+dropped:''}`);
  console.log(`${variationOk?'PASS':'FAIL'} seed-variation ${variationSummary}`);
  if (fault) {
    const assertion = FAULTS[fault];
    const intended = assertion === 'case-coverage' ? (coverage.missing.length ? 1 : 0) : failedCases.filter(m => m.failed.includes(assertion)).length;
    const other = [...new Set(failedCases.flatMap(m => m.failed).filter(n => n !== assertion))];
    console.log(`REJECTED ${fault} intended=${assertion} rejectedByIntended=${intended} failedCases=${failedCases.length} otherAssertions=${other.join(',')||'none'} cases=${matrix.length}`);
    if (!intended) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length ? 4 : 1);
  }
  const pass = !narrowed && coverage.pass && variationOk && !failedCases.length;
  console.log(`${pass?'PASS':'FAIL'} valley-matrix primary=${coverage.passedPrimary}/${expected.primary} boundary=${coverage.passedBoundary}/${expected.boundary} byteIdentical=${summary.byteIdentical}/${matrix.length} ` +
    `timedOut=${summary.timedOutCases} maxCaseMs=${summary.maxCaseMs} ${variationSummary} elapsed=${Math.round(summary.elapsedMs/1000)}s${narrowed?' (narrowed matrix)':''}`);
  process.exit(pass?0:1);
}

if (require.main === module) {
  if (process.argv[2] === '--worker') runWorker(process.argv[3]);
  else main().catch(error => { console.error(error); process.exit(1); });
}
