// Divided Valley starting towns and nearby mines. Layouts come from
// ai/coop-valley-plan.js; every count, clearance, reservation, path distance and
// reachability claim is re-measured here with the TASK-134 contract BFS.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const plan = require('./coop-valley-plan.js');
const {neighbours, bfs} = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const ROOT = path.join(__dirname, '..');
const key = c => `${c.x},${c.y}`;
const SIZES = ['tiny','normal','big'], HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295];
const SOURCES = ['ai/coop-valley-plan.js','ai/test-coop-valley-starts.js','ai/test-coop-valley-contract.js','ai/coop-map-scaling.js','ai/generateMap.js'];
const NEUTRAL_RGB = {r:208,g:208,b:208}, ASSETS = {gold:100, towns:1, units:0}, EDGE_MARGIN = 2, CLEARANCE = 3, DISPARITY = 4;
const FAULTS = {'town-clearance':'town-pairwise-clearance', 'mine-in-reserved':'reserved-neighbourhoods'};
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
// Production roster palette, evaluated from the generator source itself.
const colorSource = fs.readFileSync(path.join(ROOT,'ai/generateMap.js'),'utf8').match(/function coopPlayerColor\(playerIndex\) \{[\s\S]*?\n\}\n/)[0];
const coopPlayerColor = vm.runInNewContext('('+colorSource+')');

function applyFault(p, layout, fault) {
  const humans = layout.players.slice(1);
  if (fault==='town-clearance' && humans.length>=2) {
    const t = humans[0].towns[0], x = t.x+2<=p.side-3 ? t.x+2 : t.x-2;
    humans[1].towns[0] = {x, y:t.y};
    return true;
  }
  if (fault==='mine-in-reserved') {
    const t = humans[0].towns[0];
    layout.goldmines[0] = {x:t.x, y:t.y+1, owner:0, income:20};
    layout.assignments[0].mine = {x:t.x, y:t.y+1};
    return true;
  }
  return false;
}

function measure(p, layout) {
  const side = p.side, map = {mapSize:p.mapSize}, humans = layout.players.slice(1);
  const towns = humans.map(h=>h.towns[0]).filter(Boolean), mines = layout.goldmines;
  const cells = []; for (let y=0;y<side;y++) for (let x=0;x<side;x++) cells.push({x,y,ch:p.grid[y][x]});
  const ridge = cells.filter(c=>c.ch==='M').map(key);
  // Human i: ridge and other humans' towns are obstacles, mines are endpoints.
  const transit = (i, extra=[]) => bfs(map,[towns[i]],{blocked:new Set([...ridge,...towns.filter((_,j)=>j!==i).map(key),...extra]),
    endpoints:new Set(mines.map(key))});
  const fields = towns.map((_,i)=>transit(i));
  const expectedReserved = new Set(towns.flatMap(t=>[-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>key({x:t.x+dx,y:t.y+dy})))));
  const emittedReserved = new Set(layout.reserved.map(key));
  const pairs = towns.flatMap((t,i)=>towns.slice(i+1).map((u,k)=>({a:i+1,b:i+2+k,chebyshev:chebyshev(t,u)})));
  const margins = towns.map(t=>Math.min(t.x,t.y,side-1-t.x,side-1-t.y));
  const mineDistances = humans.map((h,i)=>mines.map(m=>fields[i].has(key(m))?fields[i].get(key(m)):null));
  const nearest = mineDistances.map(ds=>ds.every(d=>d===null)?null:Math.min(...ds.filter(d=>d!==null)));
  const assignedDistance = layout.assignments.map((a,i)=>fields[i].has(key(a.mine))?fields[i].get(key(a.mine)):null);
  const disparity = v => v.every(d=>d!==null) ? Math.max(...v)-Math.min(...v) : null;
  const interior = ch => cells.filter(c=>c.ch===ch&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow).map(key);
  const exitCells = ch => cells.filter(c=>c.ch===ch&&c.y===p.rows.exitRow);
  const forward = cells.filter(c=>'FWE'.includes(c.ch));
  const occupied = new Set([...towns,...mines].map(key));
  const passageLand = cells.filter(c=>'lrbf'.includes(c.ch)&&occupied.has(key(c))).map(key);
  // Each passage alone (the other's interior cut) must carry every human forward.
  const passages = towns.map((_,i)=>{
    const alone = (open, closed) => { const d = transit(i,interior(closed));
      return {exitCellsReached:exitCells(open).filter(c=>d.has(key(c))).length, forwardCellsReached:forward.filter(c=>d.has(key(c))).length}; };
    const closed = transit(i,[...interior('l'),...interior('r')]);
    return {slot:i+1, leftOnly:alone('l','r'), rightOnly:alone('r','l'), forwardCells:forward.length,
      bothClosedForwardReached:forward.filter(c=>closed.has(key(c))).length,
      entranceDistance:{left:Math.min(...cells.filter(c=>c.ch==='l'&&c.y===p.rows.entranceRow).map(c=>fields[i].get(key(c))??Infinity)),
        right:Math.min(...cells.filter(c=>c.ch==='r'&&c.y===p.rows.entranceRow).map(c=>fields[i].get(key(c))??Infinity))}};
  });
  // Every non-ridge, non-town cell stays reachable for each human, so no town
  // center (or mine endpoint) is a required transit cell for anyone.
  const free = cells.filter(c=>c.ch!=='M'&&!towns.some(t=>key(t)===key(c)));
  const transitCheck = towns.map((_,i)=>({slot:i+1, freeCells:free.length, unreached:free.filter(c=>!fields[i].has(key(c))).map(key)}));
  const scaling = getCoopMapScaling(p.humans,p.size);
  const comparisons = {
    mapSize:{expected:{x:scaling.side,y:scaling.side}, observed:layout.mapSize},
    humanTowns:{expected:p.humans, observed:towns.length},
    perHumanAssets:{expected:ASSETS, observed:humans.map(h=>({gold:h.gold,towns:h.towns.length,units:h.units.length}))},
    neutralSlot:{expected:{rgb:NEUTRAL_RGB,towns:0,units:0,gold:0}, observed:{rgb:layout.players[0].rgb,towns:layout.players[0].towns.length,units:layout.players[0].units.length,gold:layout.players[0].gold}},
    colors:{expected:humans.map((_,i)=>coopPlayerColor(i+1)), observed:humans.map(h=>h.rgb)},
    slots:{expected:HUMANS.slice(0,p.humans), observed:humans.map(h=>h.slot)},
    edgeMargin:{expected:`>=${EDGE_MARGIN}`, observedMin:Math.min(...margins), perTown:margins},
    townClearance:{expected:`>=${CLEARANCE}`, observedMin:pairs.length?Math.min(...pairs.map(q=>q.chebyshev)):null, pairs},
    alliedTerritory:{expected:{centerRegion:'A',minY:p.rows.alliedTop,neighbourhood:'Ablr'},
      observed:towns.map(t=>({town:key(t),center:p.grid[t.y]?.[t.x],neighbourhood:[-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>p.grid[t.y+dy]?.[t.x+dx])).join('')}))},
    reservedCells:{expected:expectedReserved.size, expectedDisjointCount:9*p.humans, observed:emittedReserved.size,
      missing:[...expectedReserved].filter(c=>!emittedReserved.has(c)), extra:[...emittedReserved].filter(c=>!expectedReserved.has(c)),
      entitiesInsideOtherThanCenters:mines.filter(m=>expectedReserved.has(key(m))).map(key)},
    stageOrder:{expected:['towns','reserve-neighbourhoods','nearby-mines'], observed:layout.stages},
    goldmines:{expected:{count:p.humans,owner:0,income:20,region:'A'}, observed:{count:mines.length,
      owners:[...new Set(mines.map(m=>m.owner))], incomes:[...new Set(mines.map(m=>m.income))],
      regions:[...new Set(mines.map(m=>p.grid[m.y]?.[m.x]))], distinct:new Set(mines.map(key)).size,
      onTowns:mines.filter(m=>towns.some(t=>key(t)===key(m))).length}},
    assignments:{expected:'bijection slot->mine', observed:layout.assignments.map(a=>({slot:a.slot,mine:key(a.mine),claimed:a.distance})),
      assignedDistance, assignedDisparity:disparity(assignedDistance)},
    nearestMine:{expected:`disparity<=${DISPARITY}`, observed:nearest, disparity:disparity(nearest)},
    passageEntities:{expected:[], observed:passageLand}};
  const checks = [
    ['dimensions', same(comparisons.mapSize.expected,comparisons.mapSize.observed)&&p.grid.length===scaling.side],
    ['roster-colors', same(comparisons.colors.expected,comparisons.colors.observed)&&same(comparisons.slots.expected,comparisons.slots.observed)&&
      same(comparisons.neutralSlot.expected,comparisons.neutralSlot.observed)&&layout.players.length===p.humans+1],
    ['starting-assets', comparisons.humanTowns.observed===p.humans&&comparisons.perHumanAssets.observed.every(o=>same(o,ASSETS))],
    ['town-boundary-margin', margins.every(m=>m>=EDGE_MARGIN)],
    ['town-pairwise-clearance', pairs.every(q=>q.chebyshev>=CLEARANCE)],
    ['town-allied-territory', comparisons.alliedTerritory.observed.every(o=>o.center==='A'&&/^[Ablr]{9}$/.test(o.neighbourhood))&&towns.every(t=>t.y>=p.rows.alliedTop)],
    ['reserved-neighbourhoods', !comparisons.reservedCells.missing.length&&!comparisons.reservedCells.extra.length&&
      expectedReserved.size===9*p.humans&&!comparisons.reservedCells.entitiesInsideOtherThanCenters.length&&
      same(comparisons.stageOrder.expected,comparisons.stageOrder.observed)],
    ['mine-allocation', mines.length===p.humans&&comparisons.goldmines.observed.distinct===p.humans&&
      same(comparisons.goldmines.observed.owners,[0])&&same(comparisons.goldmines.observed.incomes,[20])&&
      same(comparisons.goldmines.observed.regions,['A'])&&!comparisons.goldmines.observed.onTowns&&
      layout.assignments.length===p.humans&&new Set(layout.assignments.map(a=>key(a.mine))).size===p.humans&&
      layout.assignments.every((a,i)=>a.slot===i+1&&key(a.mine)===key(mines[i])&&a.distance===assignedDistance[i])],
    ['nearest-mine-disparity', comparisons.nearestMine.disparity!==null&&comparisons.nearestMine.disparity<=DISPARITY&&
      comparisons.assignments.assignedDisparity!==null&&comparisons.assignments.assignedDisparity<=DISPARITY],
    ['advance-passages-available', !passageLand.length&&passages.every(q=>q.leftOnly.exitCellsReached>=2&&q.rightOnly.exitCellsReached>=2&&
      q.leftOnly.forwardCellsReached===q.forwardCells&&q.rightOnly.forwardCellsReached===q.forwardCells&&q.bothClosedForwardReached===0)],
    ['no-required-transit-town', transitCheck.every(t=>!t.unreached.length)]];
  return {comparisons, checks, passages, transit:transitCheck, mineDistances,
    legacyRowStartsAvoided:towns.every(t=>t.y>=p.rows.alliedTop)};
}

function runCase(size, humans, seed, fault) {
  const p = plan.planDividedValley(humans,size,seed);
  const layout = plan.placeValleyStarts(p,coopPlayerColor);
  const again = plan.placeValleyStarts(plan.planDividedValley(humans,size,seed),coopPlayerColor);
  const layoutSha256 = sha(JSON.stringify(layout)), repeatSha256 = sha(JSON.stringify(again));
  const faulted = fault ? applyFault(p,layout,fault) : false;
  const m = measure(p,layout);
  const checks = [...m.checks, ['deterministic-repeat', layoutSha256===repeatSha256]];
  const failed = checks.filter(([,ok])=>!ok).map(([n])=>n);
  return {p, layout, faulted, layoutSha256, repeatSha256, m, checks:Object.fromEntries(checks), failed, rejectedBy:failed[0]||null};
}

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-136'), fault = arg('--fault');
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,files},null,2)+'\n');
  const matrix = [], starts = [], variation = [];
  for (const size of SIZES) for (const humans of HUMANS) {
    const layouts = [];
    for (const seed of SEEDS) {
      const r = runCase(size,humans,seed,fault), c = r.m.comparisons;
      layouts.push(JSON.stringify(r.layout.players.slice(1).map(h=>h.towns[0])));
      console.log(`${r.failed.length?'FAIL':'PASS'} ${size}-H${humans}-seed${seed} side=${r.p.side} band=${r.layout.band.rows.join('-')} minClearance=${c.townClearance.observedMin} minMargin=${c.edgeMargin.observedMin} reserved=${c.reservedCells.observed}/${c.reservedCells.expectedDisjointCount} mines=${c.goldmines.observed.count} nearestMine=${c.nearestMine.observed.join(',')} disparity=${c.nearestMine.disparity}${r.faulted?' faulted='+fault:''}${r.failed.length?' failed='+r.failed.join(','):''}`);
      matrix.push({size, humans, seed, side:r.p.side, faulted:r.faulted, layoutSha256:r.layoutSha256, repeatSha256:r.repeatSha256,
        checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy, comparisons:c});
      starts.push({identity:{size,humans,seed,side:r.p.side,planSha256:sha(JSON.stringify(r.p)),layoutSha256:r.layoutSha256},
        rows:r.p.rows, selection:r.p.selection, band:r.layout.band, stages:r.layout.stages,
        humans:r.layout.players.slice(1).map((h,i)=>({slot:h.slot, rgb:h.rgb, town:h.towns[0], assets:{gold:h.gold,towns:h.towns.length,units:h.units.length},
          assignedMine:r.layout.assignments[i].mine, assignedMineDistance:c.assignments.assignedDistance[i],
          nearestMineDistance:c.nearestMine.observed[i], mineDistances:r.m.mineDistances[i],
          passageEntranceDistance:r.m.passages[i].entranceDistance})),
        neutral:r.layout.players[0], goldmines:r.layout.goldmines, reservedCells:r.layout.reserved,
        passages:r.m.passages, transit:r.m.transit, valley:r.p.valley});
    }
    const distinct = new Set(layouts).size;
    variation.push({size, humans, seeds:SEEDS, distinctTownLayouts:distinct, pass:distinct>=2});
    if (!fault) console.log(`${distinct>=2?'PASS':'FAIL'} variation ${size}-H${humans} seeds=${SEEDS.join('/')} distinctTownLayouts=${distinct}`);
  }
  const failedCases = matrix.filter(m=>m.failed.length).length, failedVariation = fault ? 0 : variation.filter(v=>!v.pass).length;
  const summary = {matrixCases:matrix.length, failedCases, variationCombos:variation.length, failedVariation,
    minTownClearance:Math.min(...matrix.map(m=>m.comparisons.townClearance.observedMin).filter(v=>v!==null)),
    minEdgeMargin:Math.min(...matrix.map(m=>m.comparisons.edgeMargin.observedMin)),
    maxNearestMineDisparity:Math.max(...matrix.map(m=>m.comparisons.nearestMine.disparity??Infinity)),
    totalHumanTowns:matrix.reduce((s,m)=>s+m.comparisons.humanTowns.observed,0),
    totalGoldmines:matrix.reduce((s,m)=>s+m.comparisons.goldmines.observed.count,0),
    expectedTotal:matrix.reduce((s,m)=>s+m.humans,0)};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null,
    intendedAssertion:fault?FAULTS[fault]:null, sizes:SIZES, humans:HUMANS, seeds:SEEDS,
    rules:{startingAssets:ASSETS, edgeMargin:EDGE_MARGIN, townClearanceChebyshev:CLEARANCE, nearestMineDisparity:DISPARITY, neutralRgb:NEUTRAL_RGB},
    assertionOrder:Object.keys(matrix[0].checks), summary, variation, matrix},null,2)+'\n');
  fs.writeFileSync(path.join(out,'starts.json'), JSON.stringify({note:'coordinates are {x,y}; distances are hex edges with other human towns and the ridge as obstacles and mines as endpoints; reservedCells are town 3x3 neighbourhoods',
    cases:starts},null,2)+'\n');
  if (fault) {
    const assertion = FAULTS[fault], applied = matrix.filter(m=>m.faulted);
    const intended = applied.filter(m=>m.rejectedBy===assertion), accepted = applied.filter(m=>!m.failed.length);
    const other = applied.filter(m=>m.failed.length&&m.rejectedBy!==assertion), untouched = matrix.filter(m=>!m.faulted&&m.failed.length);
    console.log(`REJECTED ${fault} intended=${assertion} faultedCases=${applied.length} rejectedByIntended=${intended.length} accepted=${accepted.length} rejectedByOther=${other.length} unfaultedFailures=${untouched.length}`);
    if (accepted.length || !applied.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length||untouched.length ? 4 : 1);
  }
  const ok = !failedCases && !failedVariation && matrix.length===144 && variation.length===36;
  console.log(`${ok?'PASS':'FAIL'} valley-starts cases=${matrix.length-failedCases}/${matrix.length} variation=${variation.length-failedVariation}/${variation.length}`);
  process.exit(ok?0:1);
}
