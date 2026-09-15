// Divided Valley portal groups. Layouts come from ai/coop-valley-plan.js;
// counts, front groups, empty-hex and path distances, approach cells and
// single-passage routes are re-measured here with the TASK-134 contract BFS.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const plan = require('./coop-valley-plan.js');
const {bfs, neighbours, RULES} = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const ROOT = path.join(__dirname, '..');
const key = c => `${c.x},${c.y}`;
const SIZES = ['tiny','normal','big'], HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295], MULTIPLIER = {tiny:1, normal:2, big:3}, PORTALS_PER_HUMAN = 4;
const SOURCES = ['ai/coop-valley-plan.js','ai/test-coop-valley-portals.js','ai/test-coop-valley-contract.js','ai/coop-map-scaling.js','ai/generateMap.js',
  'ai/test-coop-valley-expansions.js','ai/test-coop-valley-starts.js','ai/test-coop-valley-regions.js'];
const DISPARITY = 4, MIN_APPROACH = 2;
const FAULTS = {'near-portal':'portal-town-distance', 'one-front':'front-groups', 'blocked-approach':'portal-approach'};
const MODELS = {mineEndpoints:'neutral towns, mines and portals are endpoints', walkableMines:'neutral towns and portals are endpoints; mines walkable (TASK-134 contract)'};
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const spread = v => v.every(Number.isFinite) ? Math.max(...v)-Math.min(...v) : null;
const colorSource = fs.readFileSync(path.join(ROOT,'ai/generateMap.js'),'utf8').match(/function coopPlayerColor\(playerIndex\) \{[\s\S]*?\n\}\n/)[0];
const coopPlayerColor = vm.runInNewContext('('+colorSource+')');

function cellsOf(p) {
  const cells = []; for (let y=0;y<p.side;y++) for (let x=0;x<p.side;x++) cells.push({x,y,ch:p.grid[y][x]});
  return cells;
}
const interior = (p, ch) => cellsOf(p).filter(c=>c.ch===ch&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow).map(key);

// Per human: ridge and other humans' towns block (plus closed cells).
function transitFields(p, layout, model, closed=[]) {
  const towns = layout.players.slice(1).map(h=>h.towns[0]);
  const ridge = cellsOf(p).filter(c=>c.ch==='M').map(key);
  const endpoints = new Set([...layout.players[0].towns,...layout.portals,...(model==='mineEndpoints'?layout.goldmines:[])].map(key));
  return towns.map((t,i)=>bfs({mapSize:p.mapSize},[t],{blocked:new Set([...ridge,...towns.filter((_,j)=>j!==i).map(key),...closed]),endpoints}));
}

// Walk a BFS distance map back from a target to its origin.
function witness(p, layout, model, dist, origin, target) {
  const endpoints = new Set([...layout.players[0].towns,...layout.portals,...(model==='mineEndpoints'?layout.goldmines:[])].map(key));
  const route = [target];
  let cur = target;
  while (dist.get(key(cur))>0) {
    cur = neighbours(cur).find(n=>dist.get(key(n))===dist.get(key(cur))-1&&(key(n)===key(origin)||!endpoints.has(key(n))));
    if (!cur) return null;
    route.push(cur);
  }
  return route.reverse().map(c=>({x:c.x,y:c.y}));
}

function applyFault(p, layout, fault) {
  const towns = layout.players.flatMap(q=>q.towns), portals = layout.portals, rule = RULES[p.size].portalDistance;
  const humanTowns = layout.players.slice(1).map(h=>h.towns[0]);
  const objects = new Set([...towns,...layout.goldmines,...portals].map(key));
  const free = cellsOf(p).filter(c=>c.ch!=='M'&&!objects.has(key(c)));
  if (fault==='near-portal') {
    // Move portal 0 to the free cell one step inside human 1's distance limit.
    const d = bfs({mapSize:p.mapSize},[humanTowns[0]]);
    const spot = free.filter(c=>d.get(key(c))===rule-1&&towns.every(t=>chebyshev(t,c)>1))[0];
    if (!spot) return false;
    portals[0] = {x:spot.x, y:spot.y};
    return true;
  }
  if (fault==='one-front' && portals.length>=2) {
    // Move the whole east group into the west half, keeping hex distances.
    const hex = bfs({mapSize:p.mapSize},humanTowns);
    const east = portals.map((c,i)=>i).filter(i=>p.grid[portals[i].y][portals[i].x]==='E');
    const spots = free.filter(c=>c.x<p.side/2&&hex.get(key(c))>=rule&&towns.every(t=>chebyshev(t,c)>1))
      .sort((a,b)=>a.y-b.y||a.x-b.x).slice(0,east.length);
    if (spots.length<east.length) return false;
    east.forEach((i,k)=>{ portals[i] = {x:spots[k].x, y:spots[k].y}; });
    return true;
  }
  if (fault==='blocked-approach') {
    // Occupy all but one free neighbour of the tightest portal with moved mines.
    const openOf = c => neighbours(c).filter(n=>n.x>=0&&n.y>=0&&n.x<p.side&&n.y<p.side&&free.some(f=>key(f)===key(n)));
    const target = portals.map(c=>({c,open:openOf(c)})).sort((a,b)=>a.open.length-b.open.length)[0];
    const moves = target.open.length-1;
    if (moves<1 || moves>layout.goldmines.length) return false;
    for (let k=0;k<moves;k++) {
      const m = layout.goldmines[layout.goldmines.length-1-k];
      m.x = target.open[k].x; m.y = target.open[k].y;
    }
    return true;
  }
  return false;
}

function measure(p, layout, before) {
  const side = p.side, mapInfo = {mapSize:p.mapSize}, rule = RULES[p.size].portalDistance, mult = MULTIPLIER[p.size];
  const humans = layout.players.slice(1), towns = humans.map(h=>h.towns[0]), neutral = layout.players[0].towns;
  // TASK-151 supersedes the H x multiplier total: four typed portals per human on every size.
  const mines = layout.goldmines, portals = layout.portals, total = p.humans*PORTALS_PER_HUMAN, scaling = getCoopMapScaling(p.humans,p.size);
  const inBounds = c => Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side;
  const region = c => p.grid[c.y]?.[c.x];
  const allTowns = [...towns,...neutral];
  const objectKeys = new Set([...allTowns,...mines].map(key)), portalKeys = new Set(portals.map(key));
  const counts = {expected:{portals:total, portalsPerHuman:PORTALS_PER_HUMAN, resourceMultiplier:mult, scalingPortals:scaling.counts.portals},
    observed:{portals:portals.length, distinct:portalKeys.size, outOfBounds:portals.filter(c=>!inBounds(c)).map(key)}};

  const hexFields = towns.map(t=>bfs(mapInfo,[t]));
  const hexMatrix = hexFields.map(d=>portals.map(c=>d.get(key(c))??null));
  const minHex = portals.length ? Math.min(...hexMatrix.flat().map(v=>v===null?-Infinity:v)) : null;
  const portalPairwiseHex = portals.map(a=>{ const d = bfs(mapInfo,[a]); return portals.map(b=>d.get(key(b))??null); });

  const groupOf = c => region(c)==='W' ? 'west' : region(c)==='E' ? 'east' : null;
  const derived = {west:portals.map((c,i)=>i).filter(i=>groupOf(portals[i])==='west'), east:portals.map((c,i)=>i).filter(i=>groupOf(portals[i])==='east')};
  const outside = portals.filter(c=>!groupOf(c)).map(key);
  const groups = {expected:total>=2?`west and east groups, sizes differ by <=1 (${Math.ceil(total/2)}/${Math.floor(total/2)})`:'one portal in a distant (top) portal region',
    derived, emitted:layout.portalGroups, outsideRegions:outside, sizes:{west:derived.west.length, east:derived.east.length},
    groupCount:[derived.west,derived.east].filter(g=>g.length).length, humans:p.humans,
    regionRows:{portalDepth:p.selection.portalDepth, portalWidth:p.selection.portalWidth, exitRow:p.rows.exitRow}};
  const groupsOk = !outside.length&&same(derived,layout.portalGroups)&&(total>=2
    ? derived.west.length>0&&derived.east.length>0&&Math.abs(derived.west.length-derived.east.length)<=1&&groups.groupCount===2
    : portals.length===1&&groups.groupCount===1&&portals[0].y<p.rows.exitRow);

  const placement = {onObjects:portals.filter(c=>objectKeys.has(key(c))).map(key),
    inTownNeighbourhoods:portals.filter(c=>allTowns.some(t=>chebyshev(t,c)<=1)).map(key),
    onRidge:portals.filter(c=>region(c)==='M').map(key)};

  const fields = Object.fromEntries(Object.keys(MODELS).map(m=>[m,transitFields(p,layout,m)]));
  const freeCell = c => inBounds(c)&&region(c)!=='M'&&!objectKeys.has(key(c))&&!portalKeys.has(key(c));
  const reachAll = c => Object.values(fields).every(f=>f.every(d=>d.has(key(c))));
  const reservedKeys = new Set(layout.reserved.map(key));
  const emittedApproach = layout.portalApproaches||[];
  const approachUse = new Map();
  emittedApproach.forEach((a,i)=>a.cells.forEach(c=>approachUse.set(key(c),[...(approachUse.get(key(c))||[]),i])));
  const approach = portals.map((c,i)=>{
    const independent = neighbours(c).filter(freeCell).filter(reachAll).map(key);
    const e = emittedApproach[i]||{portal:null,cells:[]};
    return {portal:key(c), independentApproachCells:independent, emittedApproachCells:e.cells.map(key),
      emittedPortalMatches:!!e.portal&&key(e.portal)===key(c),
      emittedValid:e.cells.length>=MIN_APPROACH&&e.cells.every(n=>neighbours(c).some(m=>key(m)===key(n))&&freeCell(n)&&reachAll(n)&&
        reservedKeys.has(key(n))&&approachUse.get(key(n)).length===1)};
  });
  const approachOk = emittedApproach.length===portals.length&&approach.every(a=>a.independentApproachCells.length>=MIN_APPROACH&&a.emittedPortalMatches&&a.emittedValid);

  const pathMatrix = Object.fromEntries(Object.entries(fields).map(([m,f])=>[m,f.map(d=>portals.map(c=>d.get(key(c))??null))]));
  const nearest = Object.fromEntries(Object.entries(pathMatrix).map(([m,rows])=>[m,rows.map(r=>r.every(v=>v!==null)?Math.min(...r):Infinity)]));
  const fairness = Object.fromEntries(Object.entries(nearest).map(([m,v])=>[m,{nearest:v.map(x=>Number.isFinite(x)?x:null), disparity:spread(v)}]));
  const fairOk = Object.values(fairness).every(f=>f.disparity!==null&&f.disparity<=DISPARITY);

  const closures = {leftOnly:interior(p,'r'), rightOnly:interior(p,'l'), bothClosed:[...interior(p,'l'),...interior(p,'r')]};
  const closedFields = Object.fromEntries(Object.entries(closures).map(([name,cells])=>
    [name,Object.fromEntries(Object.keys(MODELS).map(m=>[m,transitFields(p,layout,m,cells)]))]));
  const approachCells = emittedApproach.flatMap(a=>a.cells);
  const fronts = Object.fromEntries(Object.entries(closedFields).map(([name,byModel])=>[name,Object.fromEntries(Object.entries(byModel).map(([m,f])=>
    [m,f.map((d,i)=>({slot:i+1, portalsReached:portals.filter(c=>d.has(key(c))).length, approachCellsReached:approachCells.filter(c=>d.has(key(c))).length}))]))]));
  const frontsOk = ['leftOnly','rightOnly'].every(n=>Object.values(fronts[n]).every(rows=>rows.every(r=>r.portalsReached===portals.length&&r.approachCellsReached===approachCells.length)))&&
    Object.values(fronts.bothClosed).every(rows=>rows.every(r=>r.portalsReached===0));

  // Solo Tiny: one route witness per advance passage to an approach cell, then the portal.
  let witnesses = null, witnessOk = true;
  if (p.size==='tiny'&&p.humans===1) {
    witnesses = ['leftOnly','rightOnly'].map(name=>{
      const d = closedFields[name].mineEndpoints[0], a = emittedApproach[0];
      const cell = a && a.cells.filter(c=>d.has(key(c))).sort((u,v)=>d.get(key(u))-d.get(key(v)))[0];
      const route = cell ? witness(p,layout,'mineEndpoints',d,towns[0],cell) : null;
      const closed = new Set(closures[name]);
      const walk = route ? [...route, portals[0]] : null;
      const valid = !!walk&&key(walk[0])===key(towns[0])&&walk.slice(1).every((c,k)=>neighbours(walk[k]).some(n=>key(n)===key(c)))&&
        walk.slice(1,-1).every(c=>freeCell(c)&&!closed.has(key(c)));
      const own = name==='leftOnly'?'l':'r', other = name==='leftOnly'?'r':'l';
      const viaOwn = !!walk&&walk.some(c=>region(c)===own&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow);
      const viaOther = !!walk&&walk.some(c=>region(c)===other&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow);
      return {front:name==='leftOnly'?'left-advance':'right-advance', closedPassageInterior:closures[name].length, approachCell:cell?key(cell):null,
        steps:walk?walk.length-1:null, valid, viaOwnPassage:viaOwn, viaOtherPassage:viaOther, route:walk};
    });
    witnessOk = portals.length===PORTALS_PER_HUMAN&&witnesses.every(w=>w.valid&&w.viaOwnPassage&&!w.viaOtherPassage);
  }

  // Earlier stages: objects unchanged, reservations kept, every free cell and
  // objective still reached, neutral-town and mine access still fair.
  const f0 = fields.mineEndpoints;
  const freeCells = cellsOf(p).filter(freeCell);
  const nearestOf = list => f0.map(d=>{ const v = list.map(c=>d.get(key(c))).filter(x=>x!==undefined); return v.length?Math.min(...v):Infinity; });
  const prior = {objectsUnchanged:same(layout.players,before.players)&&same(layout.goldmines,before.goldmines),
    reservedKept:before.reserved.every(c=>reservedKeys.has(key(c))),
    stages:layout.stages, unreachedFreeCells:f0.map(d=>freeCells.filter(c=>!d.has(key(c))).length),
    unreachedObjectives:f0.map(d=>[...neutral,...mines].filter(c=>!d.has(key(c))).length),
    neutralTownDisparity:spread(nearestOf(neutral)), nearestMineDisparity:spread(nearestOf(mines))};
  const priorOk = prior.objectsUnchanged&&prior.reservedKept&&same(layout.stages.slice(-2),['portals','reserve-portal-approaches'])&&
    prior.unreachedFreeCells.every(n=>n===0)&&prior.unreachedObjectives.every(n=>n===0)&&
    prior.neutralTownDisparity!==null&&prior.neutralTownDisparity<=DISPARITY&&prior.nearestMineDisparity!==null&&prior.nearestMineDisparity<=DISPARITY;

  const comparisons = {counts, hexDistance:{expected:{minimum:rule}, minimum:minHex, matrix:hexMatrix}, portalPairwiseHex, groups, placement,
    approach, pathMatrix, fairness, fronts, witnesses, prior};
  const checks = [
    ['portal-counts', counts.observed.portals===total&&counts.observed.distinct===total&&scaling.counts.portals===total&&!counts.observed.outOfBounds.length],
    ['portal-town-distance', portals.length>0&&hexMatrix.flat().every(v=>v!==null)&&minHex>=rule&&rule===plan.VALLEY_PORTAL_DISTANCE[p.size]],
    ['front-groups', groupsOk],
    ['portal-placement', !placement.onObjects.length&&!placement.inTownNeighbourhoods.length&&!placement.onRidge.length],
    ['portal-approach', approachOk],
    ['portal-path-fairness', fairOk&&Object.values(pathMatrix).every(rows=>rows.every(r=>r.every(v=>v!==null)))],
    ['single-front-reach', frontsOk],
    ['solo-tiny-witness', witnessOk],
    ['prior-layout-kept', priorOk]];
  return {comparisons, checks};
}

// Production (ai/generateMap.js) retries a failed candidate with up to eight
// derived seeds, a bound TASK-151 keeps; denser typed-portal layouts can need
// a later attempt. The first attempt whose starts, expansions and portal
// stages succeed is measured; every attempt is recorded.
const ATTEMPT_LIMIT = 8;
const attemptSeed = (seed, attempt) => attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed;
function runCase(size, humans, seed, fault) {
  let p, before, layout, again;
  const attempts = [];
  for (let attempt = 0; attempt < ATTEMPT_LIMIT && !layout; attempt++) {
    try {
      p = plan.planDividedValley(humans,size,attemptSeed(seed,attempt));
      before = plan.placeValleyExpansions(p,plan.placeValleyStarts(p,coopPlayerColor));
      layout = plan.placeValleyPortals(p,before);
      again = plan.placeValleyPortals(p,before);
      attempts.push({attempt, seed:p.seed, ok:true});
    } catch (error) {
      attempts.push({attempt, seed:attemptSeed(seed,attempt), ok:false, error:String(error&&error.message||error)});
    }
  }
  if (!layout)
    return {p, attempts, error:attempts.map(a=>`${a.attempt}:${a.error}`).join(' | '), faulted:false, checks:{generation:false}, failed:['generation'], rejectedBy:'generation'};
  const layoutSha256 = sha(JSON.stringify(layout)), repeatSha256 = sha(JSON.stringify(again));
  const faulted = fault ? applyFault(p,layout,fault) : false;
  const m = measure(p,layout,before);
  const checks = [...m.checks, ['deterministic-repeat', layoutSha256===repeatSha256]];
  const failed = checks.filter(([,ok])=>!ok).map(([n])=>n);
  return {p, attempts, before, layout, faulted, layoutSha256, repeatSha256, m, checks:Object.fromEntries(checks), failed, rejectedBy:failed[0]||null};
}

module.exports = {runCase, measure, FAULTS};

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-138'), fault = arg('--fault');
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,files},null,2)+'\n');
  const matrix = [], cases = [];
  for (const size of SIZES) for (const humans of HUMANS) for (const seed of SEEDS) {
    const r = runCase(size,humans,seed,fault);
    if (r.error) {
      console.log(`FAIL ${size}-H${humans}-seed${seed} failed=generation error=${r.error.split('\n')[0]}`);
      matrix.push({size, humans, seed, faulted:false, error:r.error, checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy});
      continue;
    }
    const c = r.m.comparisons;
    console.log(`${r.failed.length?'FAIL':'PASS'} ${size}-H${humans}-seed${seed} side=${r.p.side} portals=${c.counts.observed.portals} west=${c.groups.sizes.west} east=${c.groups.sizes.east} minHex=${c.hexDistance.minimum}>=${RULES[size].portalDistance} nearest=${c.fairness.mineEndpoints.nearest.join(',')} disparity=${c.fairness.mineEndpoints.disparity}/${c.fairness.walkableMines.disparity} minApproach=${Math.min(...c.approach.map(a=>a.independentApproachCells.length))}${c.witnesses?' witnesses='+c.witnesses.map(w=>w.front+':'+w.steps).join(','):''}${r.faulted?' faulted='+fault:''}${r.failed.length?' failed='+r.failed.join(','):''}`);
    matrix.push({size, humans, seed, side:r.p.side, faulted:r.faulted, layoutSha256:r.layoutSha256, repeatSha256:r.repeatSha256,
      checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy,
      constraints:{counts:c.counts, hexMinimum:c.hexDistance.minimum, hexRequired:RULES[size].portalDistance, groups:{sizes:c.groups.sizes, groupCount:c.groups.groupCount,
        outsideRegions:c.groups.outsideRegions}, placement:c.placement, fairness:c.fairness,
        approachCounts:c.approach.map(a=>({portal:a.portal, independent:a.independentApproachCells.length, emitted:a.emittedApproachCells.length, emittedValid:a.emittedValid})),
        fronts:c.fronts, witnesses:c.witnesses&&c.witnesses.map(w=>({front:w.front, steps:w.steps, valid:w.valid, viaOwnPassage:w.viaOwnPassage, viaOtherPassage:w.viaOtherPassage})),
        prior:c.prior}});
    cases.push({identity:{size,humans,seed,side:r.p.side,planSha256:sha(JSON.stringify(r.p)),layoutSha256:r.layoutSha256},
      rows:r.p.rows, selection:r.p.selection, valley:r.p.valley,
      humanTowns:r.layout.players.slice(1).map(h=>({slot:h.slot, town:h.towns[0]})),
      portals:r.layout.portals.map((q,i)=>({index:i, x:q.x, y:q.y, region:r.p.grid[q.y]?.[q.x]??null})),
      groups:{west:c.groups.derived.west.map(i=>({index:i,...r.layout.portals[i]})), east:c.groups.derived.east.map(i=>({index:i,...r.layout.portals[i]})),
        emitted:r.layout.portalGroups},
      distanceMatrices:{humanPortalHex:c.hexDistance.matrix, humanPortalPath:c.pathMatrix, portalPortalHex:c.portalPairwiseHex},
      nearestPortal:c.fairness,
      approaches:c.approach.map((a,i)=>({portal:r.layout.portals[i], emittedCells:(r.layout.portalApproaches[i]||{cells:[]}).cells,
        independentFreeReachableCells:a.independentApproachCells.map(s=>{ const [x,y] = s.split(',').map(Number); return {x,y}; })})),
      singlePassageReach:c.fronts, soloTinyWitnesses:c.witnesses});
  }
  const failedCases = matrix.filter(m=>m.failed.length).length, ok = matrix.filter(m=>m.constraints);
  const expectedPortals = matrix.reduce((s,m)=>s+m.humans*PORTALS_PER_HUMAN,0);
  const solo = ok.filter(m=>m.size==='tiny'&&m.humans===1);
  const summary = {matrixCases:matrix.length, failedCases, generationErrors:matrix.filter(m=>m.error).length,
    portals:ok.reduce((s,m)=>s+m.constraints.counts.observed.portals,0), expectedPortals,
    maxGroupSizeDifference:Math.max(...ok.filter(m=>m.constraints.counts.observed.portals>=2).map(m=>Math.abs(m.constraints.groups.sizes.west-m.constraints.groups.sizes.east))),
    minHexMargin:Math.min(...ok.map(m=>m.constraints.hexMinimum-m.constraints.hexRequired)),
    maxNearestPortalDisparity:{mineEndpoints:Math.max(...ok.map(m=>m.constraints.fairness.mineEndpoints.disparity??Infinity)),
      walkableMines:Math.max(...ok.map(m=>m.constraints.fairness.walkableMines.disparity??Infinity))},
    minApproachCells:{independent:Math.min(...ok.flatMap(m=>m.constraints.approachCounts.map(a=>a.independent))),
      emitted:Math.min(...ok.flatMap(m=>m.constraints.approachCounts.map(a=>a.emitted)))},
    soloTiny:solo.map(m=>({seed:m.seed, portals:m.constraints.counts.observed.portals, groups:m.constraints.groups.sizes, witnesses:m.constraints.witnesses}))};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null,
    intendedAssertion:fault?FAULTS[fault]:null, sizes:SIZES, humans:HUMANS, seeds:SEEDS,
    rules:{portalsPerHuman:PORTALS_PER_HUMAN, portalTotal:'4 x humans (TASK-151 supersedes humans x multiplier and solo-Tiny one portal)', groupSplit:'west/east portal regions, sizes differ by <=1',
      minimumHexDistance:Object.fromEntries(SIZES.map(s=>[s,RULES[s].portalDistance])), hexDistance:'empty-map hex edges from every human town',
      nearestPortalDisparity:DISPARITY, pathModels:MODELS, pathObstacles:'ridge and other human towns block',
      approachCellsPerPortal:`>=${MIN_APPROACH} free adjacent cells reached by every human; emitted cells exclusive per portal and reserved`,
      singleFront:'with either advance passage interior closed every human reaches every portal and approach cell; with both closed none',
      placement:'no portal on towns, mines, ridge or any town 3x3', prior:'towns/mines unchanged, reservations kept, all free cells and objectives reached, neutral/mine disparity <=4'},
    assertionOrder:[...ok[0]?Object.keys(ok[0].checks):[]], summary, matrix},null,2)+'\n');
  fs.writeFileSync(path.join(out,'portals.json'), JSON.stringify({note:'coordinates are {x,y}; humanPortalHex is empty-map hex edges; humanPortalPath uses ridge and other human towns as obstacles with the named endpoint model; rows are human slots 1..H, columns portal indexes',
    cases},null,2)+'\n');
  if (fault) {
    const assertion = FAULTS[fault], applied = matrix.filter(m=>m.faulted);
    const intended = applied.filter(m=>m.rejectedBy===assertion), accepted = applied.filter(m=>!m.failed.length);
    const other = applied.filter(m=>m.failed.length&&m.rejectedBy!==assertion), untouched = matrix.filter(m=>!m.faulted&&m.failed.length);
    console.log(`REJECTED ${fault} intended=${assertion} faultedCases=${applied.length} rejectedByIntended=${intended.length} accepted=${accepted.length} rejectedByOther=${other.length} unfaultedFailures=${untouched.length}`);
    if (accepted.length || !applied.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length||untouched.length ? 4 : 1);
  }
  const pass = !failedCases && matrix.length===144;
  console.log(`${pass?'PASS':'FAIL'} valley-portals cases=${matrix.length-failedCases}/${matrix.length} portals=${summary.portals}/${summary.expectedPortals} maxGroupSizeDifference=${summary.maxGroupSizeDifference} minHexMargin=${summary.minHexMargin} maxNearestPortalDisparity=${summary.maxNearestPortalDisparity.mineEndpoints}/${summary.maxNearestPortalDisparity.walkableMines} minApproachCells=${summary.minApproachCells.independent}/${summary.minApproachCells.emitted} soloTinyWitnesses=${solo.filter(m=>m.checks['solo-tiny-witness']).length}/${solo.length}`);
  process.exit(pass?0:1);
}
