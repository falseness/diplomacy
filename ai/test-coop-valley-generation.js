// Divided Valley as the co-op generation default. Drives the browser-loaded
// generateCoopGame through the co-op fixture (index.html script order) and
// audits every map with the independent TASK-134 contract verifier. Seed 0
// adds replay, forced repair, unsuccessful repair and an injected impossible
// placement that must fail explicitly after exactly eight attempts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const valley = require('./coop-valley-plan.js');
const {verifyValley} = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const {createFixture} = require('./test-coop-harness');
const ROOT = path.join(__dirname, '..');
const ALL_SIZES = ['tiny','normal','big'], ALL_HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295], ATTEMPT_LIMIT = 8;
const SOURCES = ['ai/generateMap.js','ai/coop-valley-plan.js','ai/coop-map-scaling.js','index.html','menu/menu.js',
  'ai/test-coop-valley-generation.js','ai/test-coop-valley-contract.js','ai/test-coop-harness.js','ai/browserScriptCache.js'];
const FAULTS = {'impossible-placement':'valley-generation'};
// Unsuccessful non-fault repair replays all eight candidates; keep it to cheap maps.
const REPAIR_FAILURE_CASES = new Set(['tiny-1','tiny-2','normal-1','big-1']);
const MAP_KEYS = ['mapSize','players','goldmines','lakes','mountains','bushes','hills','mapShape','coop','portals'];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const key = c => `${c.x},${c.y}`;
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));

// Records every plan and candidate call; the fault removes all allied territory
// from each plan so starting-town placement is impossible for every attempt.
const RECORDER = `(() => {
  const plan = planDividedValley, build = buildCoopValleyCandidate
  globalThis.valleyLog = []; globalThis.valleyFault = null
  planDividedValley = function(humans, size, seed) {
    const result = plan(humans, size, seed)
    valleyLog.push({call:'plan', seed})
    if (valleyFault === 'impossible-placement') result.grid = result.grid.map(row => row.replace(/A/g, 'M'))
    return result
  }
  buildCoopValleyCandidate = function(humans, size, seed, attempt) {
    try {
      const map = build(humans, size, seed, attempt)
      valleyLog.push({call:'candidate', attempt, ok:true})
      return map
    } catch (error) {
      valleyLog.push({call:'candidate', attempt, ok:false, constraint:error.constraint, message:error.message})
      throw error
    }
  }
})()`;

function diagnosticOk(message, size, humans, seed, constraint) {
  return typeof message==='string' && message.startsWith('Co-op Divided Valley generation failed: ') &&
    message.includes(`size=${size} playerCount=${humans} seed=${seed} attempts=${ATTEMPT_LIMIT}/${ATTEMPT_LIMIT} constraint=${constraint}`);
}

function generateCase(f, size, humans, seed) {
  const t0 = Date.now();
  const r = f.evaluate(`(() => {
    valleyLog = []
    const options = {seed:${seed}, size:'${size}'}, before = JSON.stringify(getGameObject())
    let map = null, error = null
    try { map = generateCoopGame(${humans}, options) } catch (e) { error = e.message }
    globalThis.generated = map
    return {error, returned:map!==null, isGameMap:map instanceof GameMap, mapJson:map && JSON.stringify(map), log:valleyLog.slice(),
      options, runtimeUnchanged:JSON.stringify(getGameObject())===before,
      balanced:map ? coopStartsBalanced(map) : null, connected:map ? coopRoutesConnected(map) : null,
      metrics:map ? coopStartBalanceMetrics(map) : null}
  })()`);
  r.elapsedMs = Date.now()-t0;
  return r;
}

function audit(size, humans, seed, r, fault) {
  const scaling = getCoopMapScaling(humans,size), side = scaling.side;
  const candidates = r.log.filter(e=>e.call==='candidate'), planSeeds = r.log.filter(e=>e.call==='plan').map(e=>e.seed);
  const obs = {elapsedMs:r.elapsedMs, attempts:candidates.length, attemptLog:candidates, planSeeds, error:r.error};
  const checks = [];
  checks.push(['valley-generation', !r.error && r.returned && r.isGameMap]);
  const failureWellFormed = !r.error || (diagnosticOk(r.error,size,humans,seed,candidates.length&&candidates[candidates.length-1].constraint) &&
    !r.returned && candidates.length===ATTEMPT_LIMIT && candidates.every((c,i)=>c.attempt===i&&!c.ok) && new Set(planSeeds).size===ATTEMPT_LIMIT);
  checks.push(['bounded-failure-diagnostic', failureWellFormed]);
  checks.push(['options-unchanged', same(r.options,{seed,size})]);
  checks.push(['runtime-unchanged', r.runtimeUnchanged]);
  if (r.error) return {checks, obs};
  const map = JSON.parse(r.mapJson), successSeed = planSeeds[planSeeds.length-1];
  obs.sha256 = sha(r.mapJson); obs.successSeed = successSeed;
  checks.push(['bounded-attempts', candidates.length>=1&&candidates.length<=ATTEMPT_LIMIT&&candidates.every((c,i)=>c.attempt===i&&c.ok===(i===candidates.length-1))&&
    planSeeds.length===candidates.length&&planSeeds[0]===seed&&new Set(planSeeds).size===planSeeds.length]);
  const expectedCoop = {initialHumanCount:humans, humanSlots:ALL_HUMANS.slice(0,humans), humanTeam:'HUMANS', demonSlot:humans+1,
    generation:{version:4,playerCount:humans,seed,size,options:{seed,size}}};
  obs.coop = map.coop; obs.mapKeys = Object.keys(map);
  checks.push(['api-metadata', same(map.coop,expectedCoop)&&same(Object.keys(map),MAP_KEYS)&&same(map.mapShape,{type:'rectangular'})]);
  const humansList = map.players.slice(1,1+humans), neutral = map.players[0].towns, controller = map.players[humans+1];
  obs.counts = {side:map.mapSize, neutralTowns:neutral.length, goldmines:map.goldmines.length, portals:map.portals.length,
    mountains:map.mountains.length, lakes:map.lakes.length, bushes:map.bushes.length, hills:map.hills.length,
    expected:{side, neutralTowns:scaling.counts.neutralTowns, goldmines:scaling.counts.goldmines, portals:scaling.counts.portals}};
  checks.push(['dimensions-counts-assets', map.mapSize.x===side&&map.mapSize.y===side&&map.players.length===humans+2&&
    neutral.length===scaling.counts.neutralTowns&&map.goldmines.length===scaling.counts.goldmines&&map.portals.length===scaling.counts.portals&&
    same(map.players[0].rgb,{r:208,g:208,b:208})&&map.players[0].gold===0&&map.players[0].units.length===0&&
    humansList.every(p=>p.gold===100&&p.towns.length===1&&p.units.length===0)&&
    same(controller,{rgb:{r:160,g:40,b:180},units:[],towns:[],gold:0,economyEnabled:false})&&
    map.goldmines.every(m=>m.owner===0&&m.income===20)&&map.hills.length===0&&map.mountains.length>0&&map.lakes.length>0&&map.bushes.length>0]);
  const towns = map.players.flatMap(p=>p.towns), objects = [...towns,...map.goldmines,...map.portals,...map.mountains,...map.lakes,...map.bushes];
  checks.push(['placements-valid', new Set(objects.map(key)).size===objects.length&&
    objects.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side)&&
    towns.every(t=>t.x>=2&&t.y>=2&&t.x<=side-3&&t.y<=side-3)&&towns.every((t,i)=>towns.slice(i+1).every(u=>chebyshev(t,u)>=3))]);
  // Independent geometry: the plan supplies only passage/lateral descriptors and
  // the planned ridge; the contract verifier measures actual walkable cells.
  const plan = valley.planDividedValley(humans,size,successSeed), mountains = new Set(map.mountains.map(key));
  const contract = verifyValley({size, mapSize:map.mapSize, coop:{initialHumanCount:humans}, players:map.players.slice(0,1+humans),
    goldmines:map.goldmines, portals:map.portals, mountains:map.mountains, lakes:map.lakes, bushes:map.bushes, hills:map.hills, valley:plan.valley});
  const humanRows = [...new Set(humansList.map(p=>p.towns[0].y))];
  obs.valley = {contractValid:contract.valid, contractFailed:contract.failed, contractResults:contract.results.map(x=>({name:x.name,pass:x.pass})),
    passages:plan.valley.passages, laterals:plan.valley.laterals, rows:plan.rows,
    ridgeCells:plan.masks.ridge.length, ridgeCellsAsMountains:plan.masks.ridge.filter(c=>mountains.has(key(c))).length,
    humanTownRows:humanRows, humansBelowRidge:humansList.every(p=>p.towns[0].y>plan.rows.ridge[1]),
    portalsAboveRidge:map.portals.every(c=>c.y<plan.rows.ridge[0])};
  checks.push(['valley-topology', contract.valid&&obs.valley.ridgeCells>0&&obs.valley.ridgeCells===obs.valley.ridgeCellsAsMountains&&
    obs.valley.humansBelowRidge&&obs.valley.portalsAboveRidge]);
  obs.balance = {balanced:r.balanced, connected:r.connected, metrics:r.metrics};
  checks.push(['starting-balance', r.balanced===true&&r.connected===true]);
  return {checks, obs, map};
}

// Replay from saved metadata, forced repairs and unsuccessful repairs (seed 0).
function seedZero(f, size, humans, mapJson) {
  const id = `${size}-${humans}`, checks = [], obs = {};
  let t0 = Date.now();
  obs.replay = f.evaluate(`(() => {
    const before = JSON.stringify(getGameObject()), saved = JSON.parse(${JSON.stringify(mapJson)})
    const replay = generateCoopGame(saved.coop.generation.playerCount, saved.coop.generation.options)
    return {identical:JSON.stringify(replay)===${JSON.stringify(mapJson)}, runtimeUnchanged:JSON.stringify(getGameObject())===before}
  })()`);
  obs.replay.elapsedMs = Date.now()-t0;
  checks.push(['deterministic-replay', obs.replay.identical&&obs.replay.runtimeUnchanged]);
  // Terrain and portals stripped: forced repair restores them exactly without
  // moving any fixed object.
  t0 = Date.now();
  obs.repairStripped = f.evaluate(`(() => {
    valleyLog = []
    const map = Object.assign(Object.create(GameMap.prototype), JSON.parse(${JSON.stringify(mapJson)}))
    const fixed = () => JSON.stringify([map.mapSize, map.players, map.goldmines, map.coop])
    map.portals = []; map.mountains = []; map.lakes = []; map.bushes = []
    const fixedBefore = fixed()
    let result = null, error = null
    try { result = enforceCoopStartBalance(map, true) } catch (e) { error = e.message }
    return {result, error, restored:JSON.stringify(map)===${JSON.stringify(mapJson)}, fixedUnchanged:fixed()===fixedBefore,
      candidates:valleyLog.filter(e=>e.call==='candidate').length}
  })()`);
  obs.repairStripped.elapsedMs = Date.now()-t0;
  checks.push(['forced-repair-restores-valley', !obs.repairStripped.error&&obs.repairStripped.restored&&obs.repairStripped.fixedUnchanged&&
    obs.repairStripped.result.strategy==='valley-replay'&&obs.repairStripped.result.iterations>=1&&
    obs.repairStripped.result.iterations<=ATTEMPT_LIMIT&&obs.repairStripped.candidates===obs.repairStripped.result.iterations]);
  // Injected impossible placement: generation and repair fail after exactly
  // eight attempts; nothing is returned and no input changes.
  t0 = Date.now();
  obs.impossiblePlacement = f.evaluate(`(() => {
    const before = JSON.stringify(getGameObject()), options = {seed:0, size:'${size}'}
    const map = Object.assign(Object.create(GameMap.prototype), JSON.parse(${JSON.stringify(mapJson)}))
    map.lakes = []
    const repairInput = JSON.stringify(map)
    valleyFault = 'impossible-placement'
    try {
      valleyLog = []
      let returned = null, message = null
      try { returned = generateCoopGame(${humans}, options) } catch (e) { message = e.message }
      const generation = {returned:returned!==null, message, log:valleyLog.slice()}
      valleyLog = []
      let repairResult = null, repairMessage = null
      try { repairResult = enforceCoopStartBalance(map, true) } catch (e) { repairMessage = e.message }
      const repair = {result:repairResult, message:repairMessage, inputUnchanged:JSON.stringify(map)===repairInput,
        candidates:valleyLog.filter(e=>e.call==='candidate').length}
      return {generation, repair, options, runtimeUnchanged:JSON.stringify(getGameObject())===before}
    } finally { valleyFault = null }
  })()`);
  obs.impossiblePlacement.elapsedMs = Date.now()-t0;
  const g = obs.impossiblePlacement.generation, gc = g.log.filter(e=>e.call==='candidate'), gs = g.log.filter(e=>e.call==='plan').map(e=>e.seed);
  const rp = obs.impossiblePlacement.repair;
  checks.push(['impossible-placement-bounded-failure', !g.returned&&diagnosticOk(g.message,size,humans,0,'starting-towns')&&
    gc.length===ATTEMPT_LIMIT&&gc.every((c,i)=>c.attempt===i&&!c.ok&&c.constraint==='starting-towns')&&new Set(gs).size===ATTEMPT_LIMIT&&gs[0]===0&&
    same(obs.impossiblePlacement.options,{seed:0,size})&&obs.impossiblePlacement.runtimeUnchanged]);
  checks.push(['impossible-placement-repair-unchanged', rp.result===null&&rp.inputUnchanged&&rp.candidates===ATTEMPT_LIMIT&&
    typeof rp.message==='string'&&rp.message.startsWith('Co-op starting balance bound cannot be satisfied: version=4 attempts=8 failures=')&&
    Array.from({length:ATTEMPT_LIMIT},(_,i)=>i+':starting-towns').every(s=>rp.message.includes(s))]);
  if (REPAIR_FAILURE_CASES.has(id)) {
    // A moved mine matches no candidate, so repair fails and leaves the map untouched.
    t0 = Date.now();
    obs.repairMovedMine = f.evaluate(`(() => {
      valleyLog = []
      const map = Object.assign(Object.create(GameMap.prototype), JSON.parse(${JSON.stringify(mapJson)}))
      const towns = map.players.flatMap(p => p.towns), taken = new Set([...towns, ...map.goldmines, ...map.portals,
        ...map.mountains, ...map.lakes, ...map.bushes].map(c => c.x + ',' + c.y))
      let spot = null
      for (let y = 0; y < map.mapSize.y && !spot; y++) for (let x = 0; x < map.mapSize.x && !spot; x++)
        if (!taken.has(x + ',' + y) && !towns.some(t => Math.abs(t.x-x) <= 1 && Math.abs(t.y-y) <= 1)) spot = {x, y}
      const from = {x:map.goldmines[0].x, y:map.goldmines[0].y}
      map.goldmines[0].x = spot.x; map.goldmines[0].y = spot.y
      const input = JSON.stringify(map)
      let result = null, message = null
      try { result = enforceCoopStartBalance(map, true) } catch (e) { message = e.message }
      return {from, to:spot, result, message, inputUnchanged:JSON.stringify(map)===input,
        candidates:valleyLog.filter(e=>e.call==='candidate').length,
        outcomes:valleyLog.filter(e=>e.call==='candidate').map(e=>e.ok ? 'built' : e.constraint)}
    })()`);
    obs.repairMovedMine.elapsedMs = Date.now()-t0;
    const m = obs.repairMovedMine;
    checks.push(['moved-mine-repair-unchanged', m.result===null&&m.inputUnchanged&&m.candidates===ATTEMPT_LIMIT&&
      typeof m.message==='string'&&m.message.startsWith('Co-op starting balance bound cannot be satisfied: version=4 attempts=8 failures=0:fixed-objects')]);
  }
  return {checks, obs};
}

// Starting a version-4 map keeps the installed balance version and the
// version-1 wave generation boundary.
function startCase(f, size) {
  return f.evaluate(`(() => {
    const map = generateCoopGame(2, {seed:0, size:'${size}'})
    map.start({clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
      updateCameraBorders() {}}, false)
    const coop = JSON.parse(JSON.stringify(gameSettings.coop))
    const grid0 = {columns:grid.arr.length, rows:grid.arr[0].length}
    return {generation:coop.generation, balanceVersion:coop.balanceVersion, waveGeneration:coop.waveGeneration===undefined ? null : coop.waveGeneration,
      grid:grid0, players:players.map(p => p.role)}
  })()`);
}

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-140'), fault = arg('--fault');
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  // --sizes/--humans narrow the matrix for development; positive mode requires all 144 cases.
  const SIZES = arg('--sizes') ? arg('--sizes').split(',') : ALL_SIZES, HUMANS = arg('--humans') ? arg('--humans').split(',').map(Number) : ALL_HUMANS;
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(file=>[file,sha(fs.readFileSync(path.join(ROOT,file)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version, browser:'n/a (Node vm co-op fixture loading index.html scripts)', files},null,2)+'\n');
  const f = createFixture(undefined, () => {});
  f.evaluate(RECORDER);
  const scriptOrder = (fs.readFileSync(path.join(ROOT,'index.html'),'utf8').match(/<script[^>]+src=['"]([^'"]+)['"]/g)||[])
    .map(s=>s.match(/src=['"]([^'"]+)/)[1]).filter(s=>/coop-map-scaling|coop-valley-plan|generateMap/.test(s));
  const menu = fs.readFileSync(path.join(ROOT,'menu/menu.js'),'utf8');
  const callers = {calls:(menu.match(/generateCoopGame\([^\n]*\)/g)||[]), scriptOrder};
  callers.ok = callers.calls.length===3&&callers.calls.every(c=>/generateCoopGame\(this\.playersSlider\.value, \{seed: this\.mapSlider\.value, size: this\.sizeSlider\.realValue\.toLowerCase\(\)\}\)/.test(c))&&
    same(scriptOrder,['ai/coop-map-scaling.js','ai/coop-valley-plan.js','ai/generateMap.js']);
  console.log(`${callers.ok?'PASS':'FAIL'} callers local/online menu calls=${callers.calls.length} options=seed,size scriptOrder=${scriptOrder.join('>')}`);
  if (fault) f.evaluate(`valleyFault = ${JSON.stringify(fault)}`);
  const matrix = [], mapsOut = [], diagnostics = [], started = Date.now();
  for (const size of SIZES) for (const humans of HUMANS) for (const seed of SEEDS) {
    const label = `${size}-H${humans}-seed${seed}`;
    const r = generateCase(f,size,humans,seed), a = audit(size,humans,seed,r,fault);
    let extra = null;
    if (!fault && seed===0 && !r.error) extra = seedZero(f,size,humans,r.mapJson);
    const checks = [...a.checks, ...(extra?extra.checks:[])], failed = checks.filter(([,ok])=>!ok).map(([n])=>n);
    const row = {size, humans, seed, faulted:!!fault, checks:Object.fromEntries(checks), failed, rejectedBy:failed[0]||null, observations:a.obs, seedZero:extra&&extra.obs};
    matrix.push(row);
    if (r.error) diagnostics.push({size, humans, seed, message:r.error, attempts:a.obs.attempts, attemptLog:a.obs.attemptLog, planSeeds:a.obs.planSeeds});
    if (a.map) mapsOut.push({size, humans, seed, successSeed:a.obs.successSeed, attempts:a.obs.attempts, sha256:a.obs.sha256, map:a.map});
    console.log(`${failed.length?'FAIL':'PASS'} ${label} attempts=${a.obs.attempts} ms=${a.obs.elapsedMs}${a.map?` sha256=${a.obs.sha256.slice(0,16)} contract=${a.obs.valley.contractValid} portals=${a.obs.counts.portals} terrain=${a.obs.counts.mountains}/${a.obs.counts.lakes}/${a.obs.counts.bushes}`:''}` +
      `${extra?` replay=${extra.obs.replay.identical} repair=${extra.obs.repairStripped.restored}/${extra.obs.repairStripped.result&&extra.obs.repairStripped.result.iterations} impossible=${extra.obs.impossiblePlacement.generation.log.filter(e=>e.call==='candidate').length}/${extra.obs.impossiblePlacement.repair.candidates}${extra.obs.repairMovedMine?' movedMine='+extra.obs.repairMovedMine.candidates:''}`:''}` +
      `${r.error?' error='+r.error:''}${failed.length?' failed='+failed.join(','):''} elapsed=${Math.round((Date.now()-started)/1000)}s`);
  }
  let starts = null;
  if (!fault) {
    starts = Object.fromEntries(SIZES.map(size=>[size,startCase(f,size)]));
    starts.ok = SIZES.every(size=>starts[size].generation.version===4&&starts[size].balanceVersion===2&&starts[size].waveGeneration===null&&
      starts[size].grid.columns===getCoopMapScaling(2,size).side);
    console.log(`${starts.ok?'PASS':'FAIL'} started-versions ${SIZES.map(s=>`${s}:generation=${starts[s].generation.version},balance=${starts[s].balanceVersion},wave=${JSON.stringify(starts[s].waveGeneration)}`).join(' ')}`);
  }
  const failedCases = matrix.filter(m=>m.failed.length);
  const zero = matrix.filter(m=>m.seedZero);
  const summary = {matrixCases:matrix.length, passedCases:matrix.length-failedCases.length, failedCases:failedCases.length, elapsedMs:Date.now()-started,
    attempts:{max:Math.max(...matrix.map(m=>m.observations.attempts)), histogram:matrix.reduce((h,m)=>(h[m.observations.attempts]=(h[m.observations.attempts]||0)+1,h),{})},
    contractValid:matrix.filter(m=>m.observations.valley&&m.observations.valley.contractValid).length,
    distinctMaps:new Set(mapsOut.map(m=>m.sha256)).size,
    seedZero:{cases:zero.length, replayIdentical:zero.filter(m=>m.seedZero.replay.identical).length,
      forcedRepairRestored:zero.filter(m=>m.seedZero.repairStripped.restored).length,
      impossiblePlacementBounded:zero.filter(m=>m.checks['impossible-placement-bounded-failure']).length,
      impossiblePlacementRepairUnchanged:zero.filter(m=>m.checks['impossible-placement-repair-unchanged']).length,
      movedMineRepairUnchanged:zero.filter(m=>m.checks['moved-mine-repair-unchanged']).length,
      movedMineRepairCases:zero.filter(m=>m.seedZero.repairMovedMine).map(m=>`${m.size}-H${m.humans}`)},
    callersOk:callers.ok, startsOk:starts?starts.ok:null};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null, intendedAssertion:fault?FAULTS[fault]:null,
    sizes:SIZES, humans:HUMANS, seeds:SEEDS, attemptLimit:ATTEMPT_LIMIT,
    rules:{api:'generateCoopGame(playerCount,{seed,size}) validation unchanged; returns a GameMap with coop.generation {version:4,playerCount,seed,size,options:{seed,size}}; no layout selector (map keys '+MAP_KEYS.join(',')+')',
      attempts:'at most eight candidates; attempt 0 plans with the seed itself, later attempts with distinct derived seeds; failure throws "Co-op Divided Valley generation failed: size= playerCount= seed= attempts=8/8 constraint= failures= detail="',
      topology:'independent TASK-134 verifyValley on actual cells with the plan passage/lateral descriptors; every planned ridge cell is a mountain; humans below the ridge, portals above',
      runtime:'JSON.stringify(getGameObject()) identical before/after each generation, replay and fault call; options objects unchanged',
      repair:'version-4 forced repair replays the deterministic candidates and restores portals/terrain only from a candidate whose map size, roster and goldmines match exactly; failure leaves input byte-identical',
      impossiblePlacement:'fault replaces every allied territory cell of each plan with ridge, so starting-town placement is impossible in every attempt',
      balanceAndWaves:'starting a generated map keeps gameSettings.coop.balanceVersion=2 and no waveGeneration until the first wave (version 1)'},
    assertionOrder:matrix[0]?Object.keys(matrix[0].checks):[], summary, callers, starts, matrix},null,1)+'\n');
  if (mapsOut.length) fs.writeFileSync(path.join(out,'maps.json'), '{"note":"serialized generateCoopGame output per case; sha256 is of JSON.stringify(map)",\n"cases":[\n'+
    mapsOut.map(m=>JSON.stringify(m)).join(',\n')+'\n]}\n');
  if (fault) {
    fs.writeFileSync(path.join(out,'diagnostics.json'), JSON.stringify({fault, intendedAssertion:FAULTS[fault], cases:diagnostics},null,1)+'\n');
    const assertion = FAULTS[fault];
    const intended = matrix.filter(m=>m.rejectedBy===assertion&&m.failed.length===1), accepted = matrix.filter(m=>!m.failed.length);
    const other = matrix.filter(m=>m.failed.length&&!(m.rejectedBy===assertion&&m.failed.length===1));
    console.log(`REJECTED ${fault} intended=${assertion} faultedCases=${matrix.length} rejectedByIntended=${intended.length} accepted=${accepted.length} rejectedByOther=${other.length} wellFormedDiagnostics=${matrix.filter(m=>m.checks['bounded-failure-diagnostic']).length}`);
    if (accepted.length || !matrix.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length ? 4 : 1);
  }
  const pass = !failedCases.length && matrix.length===144 && callers.ok && starts.ok && zero.length===36;
  const s = summary.seedZero;
  console.log(`${pass?'PASS':'FAIL'} valley-generation cases=${summary.passedCases}/${matrix.length} contractValid=${summary.contractValid}/${matrix.length} maxAttempts=${summary.attempts.max} distinctMaps=${summary.distinctMaps} ` +
    `seed0: replay=${s.replayIdentical}/${s.cases} forcedRepair=${s.forcedRepairRestored}/${s.cases} impossiblePlacement=${s.impossiblePlacementBounded}/${s.cases} impossibleRepairUnchanged=${s.impossiblePlacementRepairUnchanged}/${s.cases} movedMineRepairUnchanged=${s.movedMineRepairUnchanged}/${s.movedMineRepairCases.length} callers=${callers.ok} starts=${starts.ok}`);
  process.exit(pass?0:1);
}
