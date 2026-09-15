// Divided Valley neutral towns and forward mines. Layouts come from
// ai/coop-valley-plan.js; counts, clearances, forward assignment, path
// distances and reachability are re-measured here with the TASK-134 contract BFS.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const plan = require('./coop-valley-plan.js');
const {bfs} = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const ROOT = path.join(__dirname, '..');
const key = c => `${c.x},${c.y}`;
const SIZES = ['tiny','normal','big'], HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295], MULTIPLIER = {tiny:1, normal:2, big:3};
const SOURCES = ['ai/coop-valley-plan.js','ai/test-coop-valley-expansions.js','ai/test-coop-valley-contract.js','ai/coop-map-scaling.js','ai/generateMap.js',
  'ai/test-coop-valley-starts.js','ai/test-coop-valley-regions.js'];
const NEUTRAL_RGB = {r:208,g:208,b:208}, ASSETS = {gold:100, towns:1, units:0}, EDGE_MARGIN = 2, CLEARANCE = 3, DISPARITY = 4;
const PLAYER_KEYS = 'gold,rgb,slot,towns,units', MINE_KEYS = 'income,owner,x,y';
const FAULTS = {'near-forward-mine':'forward-mine-separation', 'unfair-neutral':'neutral-town-fairness'};
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const spread = v => v.every(Number.isFinite) ? Math.max(...v)-Math.min(...v) : null;
// Production roster palette, evaluated from the generator source itself.
const colorSource = fs.readFileSync(path.join(ROOT,'ai/generateMap.js'),'utf8').match(/function coopPlayerColor\(playerIndex\) \{[\s\S]*?\n\}\n/)[0];
const coopPlayerColor = vm.runInNewContext('('+colorSource+')');

function cellsOf(p) {
  const cells = []; for (let y=0;y<p.side;y++) for (let x=0;x<p.side;x++) cells.push({x,y,ch:p.grid[y][x]});
  return cells;
}

// Human i: ridge and other humans' towns block; neutral towns and mines are
// endpoints (approached, never walked through).
function transitFields(p, layout, extra=[]) {
  const towns = layout.players.slice(1).map(h=>h.towns[0]);
  const ridge = cellsOf(p).filter(c=>c.ch==='M').map(key);
  const endpoints = new Set([...layout.players[0].towns,...layout.goldmines].map(key));
  return towns.map((t,i)=>bfs({mapSize:p.mapSize},[t],{blocked:new Set([...ridge,...towns.filter((_,j)=>j!==i).map(key),...extra]),endpoints}));
}

function applyFault(p, layout, fault) {
  const towns = layout.players.slice(1).map(h=>h.towns[0]), cells = cellsOf(p);
  const occupied = new Set([...towns,...layout.players[0].towns,...layout.goldmines].map(key));
  const nearTown = c => [...towns,...layout.players[0].towns].some(t=>chebyshev(t,c)<=1);
  if (fault==='near-forward-mine') {
    // Move one forward mine to a free allied cell right beside human 1's reserve.
    const forward = layout.expansions.forwardMines;
    if (!forward.length) return false;
    const d = transitFields(p,layout)[0];
    const spot = cells.find(c=>c.ch==='A'&&!occupied.has(key(c))&&!nearTown(c)&&d.get(key(c))===2);
    if (!spot) return false;
    const index = layout.goldmines.findIndex(m=>key(m)===key(forward[0]));
    layout.goldmines[index] = {x:spot.x, y:spot.y, owner:0, income:20};
    layout.expansions.forwardMines[0] = {x:spot.x, y:spot.y};
    return true;
  }
  if (fault==='unfair-neutral' && towns.length>=2) {
    // Re-site every neutral town toward the pair of humans with the most
    // different path lengths, keeping forward centers and clearances valid.
    const fields = transitFields(p,{...layout, players:[{...layout.players[0],towns:[]},...layout.players.slice(1)]});
    const neutralCount = layout.players[0].towns.length, mines = new Set(layout.goldmines.map(key));
    const sites = cells.filter(c=>c.ch==='F'&&c.x>=2&&c.y>=2&&c.x<=p.side-3&&c.y<=p.side-3&&
      [-1,0,1].every(dy=>[-1,0,1].every(dx=>'Fflr'.includes(p.grid[c.y+dy][c.x+dx])&&!mines.has(key({x:c.x+dx,y:c.y+dy})))));
    let best = null;
    for (let a=0;a<towns.length;a++) for (let b=0;b<towns.length;b++) if (a!==b) {
      const ordered = sites.filter(s=>fields[a].has(key(s))&&fields[b].has(key(s)))
        .sort((s,t)=>(fields[b].get(key(t))-fields[a].get(key(t)))-(fields[b].get(key(s))-fields[a].get(key(s))));
      const picked = [];
      for (const s of ordered) if (picked.length<neutralCount&&picked.every(u=>chebyshev(u,s)>=CLEARANCE)&&towns.every(u=>chebyshev(u,s)>=CLEARANCE)) picked.push({x:s.x,y:s.y});
      if (picked.length<neutralCount) continue;
      const nearest = fields.map(f=>Math.min(...picked.map(s=>f.get(key(s)))));
      if (!best || spread(nearest)>best.spread) best = {picked, spread:spread(nearest)};
    }
    if (!best || best.spread<=DISPARITY) return false;
    layout.players[0].towns = best.picked;
    layout.expansions.neutralTowns = best.picked.map(t=>({...t}));
    return true;
  }
  return false;
}

function measure(p, layout, starts) {
  const side = p.side, cells = cellsOf(p), humans = layout.players.slice(1), neutral = layout.players[0];
  const towns = humans.map(h=>h.towns[0]), neutralTowns = neutral.towns, mines = layout.goldmines;
  const allTowns = [...towns,...neutralTowns], scaling = getCoopMapScaling(p.humans,p.size), mult = MULTIPLIER[p.size];
  const nearby = mines.slice(0,p.humans), forward = mines.slice(p.humans);
  const fields = transitFields(p,layout);
  const dist = (i,c) => fields[i].has(key(c)) ? fields[i].get(key(c)) : null;
  const fromStarts = c => { const v = towns.map((_,i)=>dist(i,c)).filter(d=>d!==null); return v.length ? Math.min(...v) : null; };
  const nearestOf = list => towns.map((_,i)=>{ const v = list.map(c=>dist(i,c)).filter(d=>d!==null); return v.length ? Math.min(...v) : Infinity; });
  const nearestMine = nearestOf(mines), nearestNearby = nearestOf(nearby), nearestNeutral = nearestOf(neutralTowns);
  const forwardMineDistance = forward.map(fromStarts), maxNearestMine = Math.max(...nearestMine);
  const minForward = forward.length ? Math.min(...forwardMineDistance.map(d=>d===null?-Infinity:d)) : null;
  const pairs = allTowns.flatMap((t,i)=>allTowns.slice(i+1).map((u,k)=>({a:key(t),b:key(allTowns[i+1+k]),chebyshev:chebyshev(t,u)})));
  const margins = allTowns.map(t=>Math.min(t.x,t.y,side-1-t.x,side-1-t.y));
  const neighbourhood = t => [-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>({x:t.x+dx,y:t.y+dy})));
  const objectKeys = new Set([...allTowns,...mines].map(key));
  const crowded = allTowns.map(t=>({town:key(t), objects:neighbourhood(t).filter(c=>key(c)!==key(t)&&objectKeys.has(key(c))).map(key),
    regions:neighbourhood(t).map(c=>p.grid[c.y]?.[c.x]).join('')}));
  const region = c => p.grid[c.y]?.[c.x];
  const interior = ch => cells.filter(c=>c.ch===ch&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow).map(key);
  const objectives = [...mines.map(m=>({kind:'mine',...m})),...neutralTowns.map(t=>({kind:'neutral-town',...t}))];
  const forwardObjectives = [...forward.map(m=>({kind:'forward-mine',x:m.x,y:m.y})),...neutralTowns.map(t=>({kind:'neutral-town',x:t.x,y:t.y}))];
  const reachCount = f => forwardObjectives.filter(o=>f.has(key(o))).length;
  const leftOnly = transitFields(p,layout,interior('r')), rightOnly = transitFields(p,layout,interior('l'));
  const bothClosed = transitFields(p,layout,[...interior('l'),...interior('r')]);
  const routes = towns.map((_,i)=>({slot:i+1, forwardObjectives:forwardObjectives.length,
    leftOnly:reachCount(leftOnly[i]), rightOnly:reachCount(rightOnly[i]), bothClosed:reachCount(bothClosed[i])}));
  const free = cells.filter(c=>c.ch!=='M'&&!allTowns.some(t=>key(t)===key(c)));
  const approach = towns.map((_,i)=>({slot:i+1,
    unreachedObjectives:objectives.filter(o=>!fields[i].has(key(o))).map(o=>`${o.kind}@${key(o)}`),
    unreachedFreeCells:free.filter(c=>!fields[i].has(key(c))).length}));
  const occupiedRoute = [...allTowns,...mines].filter(c=>'lrbfWE'.includes(region(c))).map(key);
  const comparisons = {
    counts:{expected:{multiplier:mult, humanTowns:p.humans, neutralTowns:p.humans*mult, goldmines:p.humans*mult,
      nearbyMines:p.humans, forwardMines:p.humans*(mult-1), scalingNeutralTowns:scaling.counts.neutralTowns, scalingGoldmines:scaling.counts.goldmines},
      observed:{humanTowns:towns.length, neutralTowns:neutralTowns.length, goldmines:mines.length, nearbyMines:nearby.length, forwardMines:forward.length,
        distinctObjects:objectKeys.size}},
    economy:{expected:{humanAssets:ASSETS, neutral:{rgb:NEUTRAL_RGB,gold:0,units:0}, mine:{owner:0,income:20}, playerKeys:PLAYER_KEYS, mineKeys:MINE_KEYS},
      observed:{humanAssets:humans.map(h=>({gold:h.gold,towns:h.towns.length,units:h.units.length})),
        neutral:{rgb:neutral.rgb,gold:neutral.gold,units:neutral.units.length},
        owners:[...new Set(mines.map(m=>m.owner))], incomes:[...new Set(mines.map(m=>m.income))],
        playerKeys:[...new Set(layout.players.map(q=>Object.keys(q).sort().join(',')))], mineKeys:[...new Set(mines.map(m=>Object.keys(m).sort().join(',')))]}},
    clearances:{expected:{edgeMargin:`>=${EDGE_MARGIN}`, chebyshev:`>=${CLEARANCE}`, neighbourhoodObjects:0},
      observedMinMargin:Math.min(...margins), observedMinChebyshev:pairs.length?Math.min(...pairs.map(q=>q.chebyshev)):null,
      crowded:crowded.filter(c=>c.objects.length||/M/.test(c.regions))},
    nearby:{expected:'first H mines equal the starts stage assignments, in allied territory', observed:nearby.map(key),
      startsMines:starts.goldmines.map(key), regions:[...new Set(nearby.map(region))], assignments:layout.assignments.map(a=>key(a.mine))},
    forwardPlacement:{expected:{forwardMineRegion:'F', neutralTownRegion:'F', neutralTownY:`<${p.rows.alliedTop}`, routeOrPortalCells:[]},
      forwardMineRegions:[...new Set(forward.map(region))], neutralTownRegions:[...new Set(neutralTowns.map(region))],
      neutralTownMaxY:neutralTowns.length?Math.max(...neutralTowns.map(t=>t.y)):null, humanTownMinY:Math.min(...towns.map(t=>t.y)),
      routeOrPortalCells:occupiedRoute,
      emittedForward:layout.expansions.forwardMines.map(key), emittedNeutral:layout.expansions.neutralTowns.map(key)},
    separation:{expected:p.size==='tiny'?'not applicable: tiny has no forward mines':'min forward-mine distance from starting set > max nearest-mine distance',
      forwardMineDistance, minForwardMineDistance:minForward, nearestMine, maxNearestMine, nearestNearbyMine:nearestNearby,
      inequality:forward.length?`${minForward} > ${maxNearestMine}`:null},
    neutralFairness:{expected:`disparity<=${DISPARITY}`, nearestNeutralTown:nearestNeutral, disparity:spread(nearestNeutral)},
    nearestMineFairness:{expected:`disparity<=${DISPARITY}`, nearestMine, disparity:spread(nearestMine)},
    routes, approach};
  const checks = [
    ['object-counts', same(comparisons.counts.observed,{humanTowns:p.humans, neutralTowns:p.humans*mult, goldmines:p.humans*mult,
      nearbyMines:p.humans, forwardMines:p.humans*(mult-1), distinctObjects:p.humans*(1+2*mult)})&&
      scaling.counts.neutralTowns===p.humans*mult&&scaling.counts.goldmines===p.humans*mult&&p.grid.length===scaling.side],
    ['no-new-economy', comparisons.economy.observed.humanAssets.every(o=>same(o,ASSETS))&&same(neutral.rgb,NEUTRAL_RGB)&&neutral.gold===0&&
      !neutral.units.length&&same(comparisons.economy.observed.owners,[0])&&same(comparisons.economy.observed.incomes,[20])&&
      same(comparisons.economy.observed.playerKeys,[PLAYER_KEYS])&&same(comparisons.economy.observed.mineKeys,[MINE_KEYS])&&
      humans.every((h,i)=>h.slot===i+1&&same(h.rgb,coopPlayerColor(i+1)))],
    ['town-clearances', margins.every(m=>m>=EDGE_MARGIN)&&pairs.every(q=>q.chebyshev>=CLEARANCE)&&!comparisons.clearances.crowded.length],
    ['nearby-mines-kept', same(nearby.map(key),starts.goldmines.map(key))&&same(comparisons.nearby.regions,['A'])&&
      same(layout.assignments.map(a=>key(a.mine)),starts.assignments.map(a=>key(a.mine)))],
    ['forward-mine-separation', !forward.length ? p.size==='tiny' : forwardMineDistance.every(d=>d!==null)&&minForward>maxNearestMine],
    ['neutral-town-fairness', comparisons.neutralFairness.disparity!==null&&comparisons.neutralFairness.disparity<=DISPARITY],
    ['forward-placement', (!forward.length||same(comparisons.forwardPlacement.forwardMineRegions,['F']))&&
      same(comparisons.forwardPlacement.neutralTownRegions,['F'])&&comparisons.forwardPlacement.neutralTownMaxY<p.rows.alliedTop&&
      !occupiedRoute.length&&same(comparisons.forwardPlacement.emittedForward,forward.map(key))&&same(comparisons.forwardPlacement.emittedNeutral,neutralTowns.map(key))],
    ['forward-through-fronts', routes.every(r=>r.leftOnly===r.forwardObjectives&&r.rightOnly===r.forwardObjectives&&r.bothClosed===0)],
    ['approach-without-town-transit', approach.every(a=>!a.unreachedObjectives.length&&!a.unreachedFreeCells)],
    ['nearest-mine-disparity', comparisons.nearestMineFairness.disparity!==null&&comparisons.nearestMineFairness.disparity<=DISPARITY]];
  return {comparisons, checks, fields};
}

function runCase(size, humans, seed, fault) {
  let p, starts, layout, again;
  try {
    p = plan.planDividedValley(humans,size,seed);
    starts = plan.placeValleyStarts(p,coopPlayerColor);
    layout = plan.placeValleyExpansions(p,starts);
    const p2 = plan.planDividedValley(humans,size,seed);
    again = plan.placeValleyExpansions(p2,plan.placeValleyStarts(p2,coopPlayerColor));
  } catch (error) {
    return {p, error:String(error&&error.stack||error), faulted:false, checks:{generation:false}, failed:['generation'], rejectedBy:'generation'};
  }
  const layoutSha256 = sha(JSON.stringify(layout)), repeatSha256 = sha(JSON.stringify(again));
  const faulted = fault ? applyFault(p,layout,fault) : false;
  const m = measure(p,layout,starts);
  const checks = [...m.checks, ['deterministic-repeat', layoutSha256===repeatSha256]];
  const failed = checks.filter(([,ok])=>!ok).map(([n])=>n);
  return {p, starts, layout, faulted, layoutSha256, repeatSha256, m, checks:Object.fromEntries(checks), failed, rejectedBy:failed[0]||null};
}

module.exports = {runCase, measure, FAULTS};

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-137'), fault = arg('--fault');
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,files},null,2)+'\n');
  const matrix = [], expansions = [];
  for (const size of SIZES) for (const humans of HUMANS) for (const seed of SEEDS) {
    const r = runCase(size,humans,seed,fault);
    if (r.error) {
      console.log(`FAIL ${size}-H${humans}-seed${seed} failed=generation error=${r.error.split('\n')[0]}`);
      matrix.push({size, humans, seed, faulted:false, error:r.error, checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy});
      continue;
    }
    const c = r.m.comparisons;
    console.log(`${r.failed.length?'FAIL':'PASS'} ${size}-H${humans}-seed${seed} side=${r.p.side} neutral=${c.counts.observed.neutralTowns} mines=${c.counts.observed.goldmines} (nearby=${c.counts.observed.nearbyMines} forward=${c.counts.observed.forwardMines}) minChebyshev=${c.clearances.observedMinChebyshev} minMargin=${c.clearances.observedMinMargin} nearestNeutral=${c.neutralFairness.nearestNeutralTown.join(',')} neutralDisparity=${c.neutralFairness.disparity} separation=${c.separation.inequality??'n/a'} mineDisparity=${c.nearestMineFairness.disparity}${r.faulted?' faulted='+fault:''}${r.failed.length?' failed='+r.failed.join(','):''}`);
    matrix.push({size, humans, seed, side:r.p.side, faulted:r.faulted, layoutSha256:r.layoutSha256, repeatSha256:r.repeatSha256,
      checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy, comparisons:c});
    expansions.push({identity:{size,humans,seed,side:r.p.side,planSha256:sha(JSON.stringify(r.p)),layoutSha256:r.layoutSha256},
      rows:r.p.rows, selection:r.p.selection, startsBand:r.starts.band, stages:r.layout.stages,
      humans:r.layout.players.slice(1).map((h,i)=>({slot:h.slot, town:h.towns[0], assets:{gold:h.gold,towns:h.towns.length,units:h.units.length},
        assignedNearbyMine:r.layout.assignments[i].mine, nearestMineDistance:c.separation.nearestMine[i],
        nearestNeutralTownDistance:c.neutralFairness.nearestNeutralTown[i],
        neutralTownDistances:r.layout.players[0].towns.map(t=>r.m.fields[i].get(key(t))??null),
        forwardMineDistances:r.layout.expansions.forwardMines.map(t=>r.m.fields[i].get(key(t))??null)})),
      neutral:r.layout.players[0], nearbyMines:r.layout.goldmines.slice(0,humans), forwardMines:r.layout.goldmines.slice(humans),
      reservedCells:r.layout.reserved, separation:c.separation, routes:c.routes, approach:c.approach, valley:r.p.valley});
  }
  const failedCases = matrix.filter(m=>m.failed.length).length, ok = matrix.filter(m=>m.comparisons);
  const summary = {matrixCases:matrix.length, failedCases, generationErrors:matrix.filter(m=>m.error).length,
    totals:Object.fromEntries(['humanTowns','neutralTowns','goldmines','nearbyMines','forwardMines'].map(k=>[k,ok.reduce((s,m)=>s+m.comparisons.counts.observed[k],0)])),
    expectedTotals:{neutralTowns:matrix.reduce((s,m)=>s+m.humans*MULTIPLIER[m.size],0), goldmines:matrix.reduce((s,m)=>s+m.humans*MULTIPLIER[m.size],0),
      forwardMines:matrix.reduce((s,m)=>s+m.humans*(MULTIPLIER[m.size]-1),0)},
    tinyForwardMines:ok.filter(m=>m.size==='tiny').reduce((s,m)=>s+m.comparisons.counts.observed.forwardMines,0),
    minTownChebyshev:Math.min(...ok.map(m=>m.comparisons.clearances.observedMinChebyshev).filter(v=>v!==null)),
    minEdgeMargin:Math.min(...ok.map(m=>m.comparisons.clearances.observedMinMargin)),
    maxNeutralDisparity:Math.max(...ok.map(m=>m.comparisons.neutralFairness.disparity??Infinity)),
    maxNearestMineDisparity:Math.max(...ok.map(m=>m.comparisons.nearestMineFairness.disparity??Infinity)),
    minSeparationMargin:Math.min(...ok.filter(m=>m.size!=='tiny').map(m=>m.comparisons.separation.minForwardMineDistance-m.comparisons.separation.maxNearestMine))};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null,
    intendedAssertion:fault?FAULTS[fault]:null, sizes:SIZES, humans:HUMANS, seeds:SEEDS,
    rules:{multiplier:MULTIPLIER, startingAssets:ASSETS, edgeMargin:EDGE_MARGIN, townClearanceChebyshev:CLEARANCE, accessDisparity:DISPARITY,
      neutralRgb:NEUTRAL_RGB, transit:'other human towns and ridge block; neutral towns and mines are endpoints'},
    assertionOrder:[...ok[0]?Object.keys(ok[0].checks):[]], summary, matrix},null,2)+'\n');
  fs.writeFileSync(path.join(out,'expansions.json'), JSON.stringify({note:'coordinates are {x,y}; distances are hex edges with other human towns and the ridge as obstacles and neutral towns/mines as endpoints; nearbyMines are the first H goldmines, forwardMines the rest',
    cases:expansions},null,2)+'\n');
  if (fault) {
    const assertion = FAULTS[fault], applied = matrix.filter(m=>m.faulted);
    const intended = applied.filter(m=>m.rejectedBy===assertion), accepted = applied.filter(m=>!m.failed.length);
    const other = applied.filter(m=>m.failed.length&&m.rejectedBy!==assertion), untouched = matrix.filter(m=>!m.faulted&&m.failed.length);
    console.log(`REJECTED ${fault} intended=${assertion} faultedCases=${applied.length} rejectedByIntended=${intended.length} accepted=${accepted.length} rejectedByOther=${other.length} unfaultedFailures=${untouched.length}`);
    if (accepted.length || !applied.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length||untouched.length ? 4 : 1);
  }
  const pass = !failedCases && matrix.length===144;
  console.log(`${pass?'PASS':'FAIL'} valley-expansions cases=${matrix.length-failedCases}/${matrix.length} neutralTowns=${summary.totals.neutralTowns}/${summary.expectedTotals.neutralTowns} goldmines=${summary.totals.goldmines}/${summary.expectedTotals.goldmines} forwardMines=${summary.totals.forwardMines}/${summary.expectedTotals.forwardMines} tinyForwardMines=${summary.tinyForwardMines} maxNeutralDisparity=${summary.maxNeutralDisparity} maxNearestMineDisparity=${summary.maxNearestMineDisparity} minSeparationMargin=${summary.minSeparationMargin}`);
  process.exit(pass?0:1);
}
