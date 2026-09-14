// Seeded Divided Valley region/route planner for new co-op maps. It plans
// territory, passages, cross-connections and placement capacity only; later
// placement stages consume the plan. Not yet called by generateCoopGame.
const valleyScaling = typeof getCoopMapScaling === 'function' ? getCoopMapScaling
    : require('./coop-map-scaling.js').getCoopMapScaling

const VALLEY_PORTAL_DISTANCE = Object.freeze({tiny: 6, normal: 10, big: 14})
// Grid legend, rows are y (humans at the bottom, portals at the top).
const VALLEY_LEGEND = Object.freeze({A: 'allied territory', b: 'rear lateral', l: 'left advance passage',
    r: 'right advance passage', M: 'separating ridge', f: 'forward lateral', F: 'forward expansion territory',
    W: 'west portal region', E: 'east portal region'})
const valleyPoolCache = new Map()

// Scramble the seed before drawing so neighbouring seeds diverge immediately.
function createValleyRandom(seed) {
    let state = seed >>> 0
    state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0
    state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0
    state = (state ^ (state >>> 16)) >>> 0
    return function() {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
    }
}

// Odd columns sit half a row lower, matching sprites/sprite.js.
function valleyNeighbours(c, side) {
    const shift = c.x % 2 ? 0 : -1
    return [{x:c.x, y:c.y-1}, {x:c.x, y:c.y+1}, {x:c.x-1, y:c.y+shift}, {x:c.x-1, y:c.y+shift+1},
        {x:c.x+1, y:c.y+shift}, {x:c.x+1, y:c.y+shift+1}]
        .filter(n => n.x >= 0 && n.y >= 0 && n.x < side && n.y < side)
}

// In-bounds edge distance from every possible allied town center.
function valleyAlliedDistanceField(side, alliedTop) {
    const distance = new Int32Array(side * side).fill(-1), queue = []
    for (let y = alliedTop; y <= side-3; y++) for (let x = 2; x <= side-3; x++) {
        distance[y*side+x] = 0; queue.push({x, y})
    }
    for (let i = 0; i < queue.length; i++) for (const n of valleyNeighbours(queue[i], side)) {
        if (distance[n.y*side+n.x] >= 0) continue
        distance[n.y*side+n.x] = distance[queue[i].y*side+queue[i].x] + 1; queue.push(n)
    }
    return distance
}

const valleyCount3 = (lo, hi) => hi < lo ? 0 : Math.floor((hi - lo) / 3) + 1

function valleyPortalSlots(side, depth, width, field, distance) {
    const slots = x0 => {
        const cells = []
        for (let y = 0; y < depth; y += 2) for (let x = x0; x < x0 + width; x += 2)
            if (field[y*side+x] >= distance) cells.push({x, y})
        return cells
    }
    return {west: slots(0), east: slots(side - width)}
}

// Finite row-structure pool for one size/count: ridge row and thickness,
// portal region depth/width. Each entry is checked against exact entity
// counts, town clearances and portal distance before any seed is applied.
function valleyRowPlans(humans, size) {
    const id = `${size}:${humans}`
    if (valleyPoolCache.has(id)) return valleyPoolCache.get(id)
    const scaling = valleyScaling(humans, size), side = scaling.side, counts = scaling.counts
    const distance = VALLEY_PORTAL_DISTANCE[size], area = side * side
    const need = {west: Math.ceil(counts.portals / 2), east: Math.floor(counts.portals / 2)}
    const terrainBudget = counts.mountains + counts.lakes
    const maxWidth = Math.floor(side / 2) - 2, fields = new Map(), plans = []
    const depthOptions = []
    for (let depth = 1; depth <= Math.floor(side / 3) && depthOptions.length < 2; depth++) {
        const minWidth = 2 * Math.ceil(need.west / Math.ceil(depth / 2)) - 1
        if (minWidth <= maxWidth) depthOptions.push({depth, minWidth})
    }
    for (const {depth, minWidth} of depthOptions)
    for (let width = minWidth; width <= Math.min(maxWidth, minWidth + 4); width += 2)
    for (const thickness of [1, 2])
    for (let ridge = depth + 1; ridge + thickness + 2 <= side - 3; ridge++) {
        const alliedTop = ridge + thickness + 2, exitRow = ridge - 1
        if (!fields.has(alliedTop)) fields.set(alliedTop, valleyAlliedDistanceField(side, alliedTop))
        const alliedSites = valleyCount3(2, side-3) * valleyCount3(alliedTop, side-3)
        let forwardSites = 0
        for (let y = 2; y <= ridge - 2; y += 3) forwardSites += y <= depth
            ? valleyCount3(Math.max(2, width+1), Math.min(side-3, side-width-2)) : valleyCount3(2, side-3)
        const slots = valleyPortalSlots(side, depth, width, fields.get(alliedTop), distance)
        const ridgeCells = {min: thickness * (side - 6), max: thickness * (side - 4)}
        const reservedMax = 2 * 3 * (thickness + 3) + 2 * side
        const capacity = {alliedSites, forwardSites, portalSlots: {west: slots.west.length, east: slots.east.length},
            alliedMineRoom: side * (side - alliedTop) - 9 * humans,
            forwardMineRoom: side * exitRow - 2 * width * depth - 9 * counts.neutralTowns,
            ridgeCells, terrainBudget,
            decorativeRoom: area - ridgeCells.max - reservedMax - 2 * width * depth -
                9 * (humans + counts.neutralTowns) - counts.goldmines,
            decorativeNeed: terrainBudget - ridgeCells.min + counts.bushes}
        // Starting towns need rows to fan out around the passage entrances at
        // similar path distances; a shallow allied strip cannot hold them.
        if (side - 2 - alliedTop < (humans <= 2 ? 2 : Math.ceil(humans / 2) + 2)) continue
        if (alliedSites < humans || forwardSites < counts.neutralTowns ||
            slots.west.length < need.west || slots.east.length < need.east ||
            capacity.alliedMineRoom < humans || capacity.forwardMineRoom < counts.goldmines - humans ||
            ridgeCells.max > terrainBudget || capacity.decorativeRoom < capacity.decorativeNeed) continue
        plans.push({depth, width, thickness, ridge, capacity})
    }
    const pool = {size, humans, side, counts, portalDistance: distance, portalNeed: need, terrainBudget, plans}
    valleyPoolCache.set(id, pool)
    return pool
}

function clearValleyPlanCache() {
    valleyPoolCache.clear()
}

function planDividedValley(humans, size = 'normal', seed = 1) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new RangeError('Divided Valley seed must be an unsigned 32-bit integer')
    }
    const pool = valleyRowPlans(humans, size), side = pool.side
    if (!pool.plans.length) throw new Error(`Divided Valley has no feasible row plan: size=${size} humans=${humans}`)
    const rng = createValleyRandom(seed)
    const pickIndex = length => Math.floor(rng() * length)
    const rowIndex = pickIndex(pool.plans.length), row = pool.plans[rowIndex]
    const {depth, width, thickness, ridge} = row
    const widths = [2, 3].filter(w => thickness * (side - 2 * w) <= pool.terrainBudget)
    const passageWidth = widths[pickIndex(widths.length)]
    // Left passage lies in the west half; the right one uses the mirrored range.
    const half = Math.floor(side / 2), leftRange = [1, half - 1 - passageWidth]
    const rightRange = [side - half + 1, side - passageWidth - 1]
    const leftX = leftRange[0] + pickIndex(leftRange[1] - leftRange[0] + 1)
    const rightX = rightRange[0] + pickIndex(rightRange[1] - rightRange[0] + 1)
    const offsets = {west: pickIndex(2), center: pickIndex(2), east: pickIndex(2)}
    const exitRow = ridge - 1, entranceRow = ridge + thickness + 1, alliedTop = entranceRow + 1
    const left = {x: [leftX, leftX + passageWidth - 1]}, right = {x: [rightX, rightX + passageWidth - 1]}
    const grid = []
    for (let y = 0; y < side; y++) {
        let line = ''
        for (let x = 0; x < side; x++) {
            const lateral = x >= left.x[0] && x <= right.x[1]
            let ch
            if (y >= exitRow && y <= entranceRow && x >= left.x[0] && x <= left.x[1]) ch = 'l'
            else if (y >= exitRow && y <= entranceRow && x >= right.x[0] && x <= right.x[1]) ch = 'r'
            else if (y === exitRow && lateral) ch = 'f'
            else if (y === entranceRow && lateral) ch = 'b'
            else if (y >= ridge && y < ridge + thickness + 1) {
                const o = offsets[x < left.x[0] ? 'west' : x > right.x[1] ? 'east' : 'center']
                ch = y < ridge + o ? 'F' : y < ridge + o + thickness ? 'M' : 'A'
            } else if (y < ridge) ch = y < depth && x < width ? 'W' : y < depth && x >= side - width ? 'E' : 'F'
            else ch = 'A'
            line += ch
        }
        grid.push(line)
    }
    const cellsOf = ch => {
        const cells = []
        grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === ch) cells.push({x, y}) })
        return cells
    }
    const passage = (name, x) => ({name, kind: 'advance', x, y: [exitRow, entranceRow]})
    const valley = {passages: [passage('left-advance', left.x), passage('right-advance', right.x)],
        laterals: [{name: 'rear-lateral', side: 'rear', x: [left.x[0], right.x[1]], y: [entranceRow, entranceRow]},
            {name: 'forward-lateral', side: 'forward', x: [left.x[0], right.x[1]], y: [exitRow, exitRow]}]}
    const rowCells = (x, y) => Array.from({length: x[1] - x[0] + 1}, (_, i) => ({x: x[0] + i, y}))
    // Candidate town centers on a Chebyshev-3 lattice keep the two-cell edge
    // margin and a 3x3 neighbourhood clear of ridge, portal regions and passages.
    const sites = (yLo, yHi, ok) => {
        const list = []
        for (let y = yLo; y <= yHi; y += 3) for (let x = 2; x <= side - 3; x++) {
            if (list.length && list[list.length-1].y === y && x - list[list.length-1].x < 3) continue
            let clear = true
            for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1; dx++)
                if (!ok(grid[y+dy][x+dx])) { clear = false; break }
            if (clear) list.push({x, y})
        }
        return list
    }
    const field = valleyAlliedDistanceField(side, alliedTop)
    const portalSlots = valleyPortalSlots(side, depth, width, field, pool.portalDistance)
    return {
        version: 1, size, humans, seed, side, mapSize: {x: side, y: side}, counts: pool.counts,
        portalDistance: pool.portalDistance, legend: VALLEY_LEGEND,
        selection: {rowPlanIndex: rowIndex, rowPlanPoolSize: pool.plans.length, passageWidthPool: widths,
            passageWidth, leftXRange: leftRange, rightXRange: rightRange, leftX, rightX, offsets,
            ridgeRow: ridge, ridgeThickness: thickness, portalDepth: depth, portalWidth: width},
        rows: {exitRow, ridge: [ridge, ridge + thickness], entranceRow, alliedTop},
        grid, valley,
        masks: {ridge: cellsOf('M'), leftPassage: cellsOf('l'), rightPassage: cellsOf('r'),
            rearLateral: cellsOf('b'), forwardLateral: cellsOf('f'), westPortal: cellsOf('W'), eastPortal: cellsOf('E')},
        endpoints: {
            leftPassage: {entrance: rowCells(left.x, entranceRow), exit: rowCells(left.x, exitRow)},
            rightPassage: {entrance: rowCells(right.x, entranceRow), exit: rowCells(right.x, exitRow)},
            rearLateral: {from: {x: left.x[1] + 1, y: entranceRow}, to: {x: right.x[0] - 1, y: entranceRow}},
            forwardLateral: {from: {x: left.x[1] + 1, y: exitRow}, to: {x: right.x[0] - 1, y: exitRow}}},
        capacity: {...row.capacity, portalNeed: pool.portalNeed,
            alliedSites: sites(alliedTop, side - 3, ch => 'Ablr'.includes(ch)),
            forwardSites: sites(2, ridge - 2, ch => 'Fflr'.includes(ch)),
            portalSlots}
    }
}

const VALLEY_NEUTRAL_RGB = Object.freeze({r: 208, g: 208, b: 208})
const valleyChebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

// Edge distances from one start (or several). Blocked cells are never entered;
// endpoint cells (buildings used by interaction) are entered but never expanded.
function valleyDistances(side, start, blocked, endpoints) {
    const distance = new Int32Array(side * side).fill(-1), queue = [].concat(start)
    for (const s of queue) distance[s.y*side+s.x] = 0
    const origins = queue.length
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i]
        if (i >= origins && endpoints.has(c.y*side+c.x)) continue
        for (const n of valleyNeighbours(c, side)) {
            const id = n.y*side+n.x
            if (distance[id] >= 0 || blocked.has(id)) continue
            distance[id] = distance[c.y*side+c.x] + 1; queue.push(n)
        }
    }
    return distance
}

const VALLEY_OFFSETS3 = Object.freeze([-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => Object.freeze({x: dx, y: dy}))))

function valleyShuffler(seed) {
    const rng = createValleyRandom(seed >>> 0)
    const pickIndex = length => Math.floor(rng() * length)
    return list => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = pickIndex(i + 1)
            ;[list[i], list[j]] = [list[j], list[i]]
        }
        return list
    }
}

// Town centers with the two-cell edge margin whose 3x3 neighbourhood stays in
// the given regions.
function valleyTownCenters(plan, centers, neighbourhood) {
    const {side, grid} = plan, list = []
    for (let y = 2; y <= side - 3; y++) for (let x = 2; x <= side - 3; x++)
        if (centers.includes(grid[y][x]) && VALLEY_OFFSETS3.every(o => neighbourhood.includes(grid[y+o.y][x+o.x])))
            list.push({x, y})
    return list
}

// Starting towns and one nearby unowned mine per human inside a plan's allied
// territory. Every forward objective is reached through a passage entrance, so
// towns are drawn from allied centers whose entrance distance lies in the
// narrowest window (then nearest band) that fits every human; the window is
// re-measured with the other towns blocking. Their 3x3 neighbourhoods are
// reserved before any mine. Other humans' towns and the ridge block paths,
// mines are endpoints, and a mine is rejected if it would cut any free cell off.
function placeValleyStarts(plan, colorOf = typeof coopPlayerColor === 'function' ? coopPlayerColor : null) {
    if (typeof colorOf !== 'function') throw new TypeError('Divided Valley starts require coopPlayerColor')
    const {side, humans, grid} = plan, alliedTop = plan.rows.alliedTop
    const assets = valleyScaling(humans, plan.size).startingAssets
    const shuffle = valleyShuffler(plan.seed ^ 0x9e3779b9)
    const offsets = VALLEY_OFFSETS3, terrain = []
    grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === 'M') terrain.push(y*side+x) })
    const entrances = [...plan.endpoints.leftPassage.entrance, ...plan.endpoints.rightPassage.entrance]
    const entranceIds = entrances.map(c => c.y*side+c.x), none = new Set()
    const toEntrance = valleyDistances(side, entrances, new Set(terrain), none)
    const centers = valleyTownCenters(plan, 'A', 'Ablr').filter(t => t.y >= alliedTop && toEntrance[t.y*side+t.x] > 0)
    const entranceDistance = (t, others) => {
        const d = valleyDistances(side, t, new Set([...terrain, ...others.map(u => u.y*side+u.x)]), none)
        return Math.min(...entranceIds.map(id => d[id] < 0 ? Infinity : d[id]))
    }
    let towns = null, band = null
    const maxD = Math.max(...centers.map(t => toEntrance[t.y*side+t.x]))
    search: for (const window of [1, 2, 3]) {
        for (let lo = 1; lo <= maxD; lo++) {
            const pool = centers.filter(t => toEntrance[t.y*side+t.x] >= lo && toEntrance[t.y*side+t.x] <= lo + window)
            if (pool.length < humans) continue
            for (let attempt = 0; attempt < 8; attempt++) {
                const picked = []
                for (const t of shuffle(pool.slice())) {
                    if (picked.every(u => valleyChebyshev(t, u) >= 3)) picked.push(t)
                    if (picked.length === humans) break
                }
                if (picked.length < humans) continue
                const measured = picked.map((t, i) => entranceDistance(t, picked.filter((_, j) => j !== i)))
                if (Math.max(...measured) - Math.min(...measured) <= window) {
                    towns = picked
                    band = {entranceDistance: [lo, lo + window], window, measured, candidates: pool.length}
                    break search
                }
            }
        }
    }
    if (!towns) throw new Error(`Divided Valley has no allied town sites: size=${plan.size} humans=${humans}`)
    const reserved = new Set()
    for (const t of towns) for (const o of offsets) reserved.add((t.y+o.y)*side + t.x+o.x)
    const townIds = towns.map(t => t.y*side+t.x)
    const blockedFor = townIds.map((_, i) => new Set([...terrain, ...townIds.filter((_, j) => j !== i)]))
    const open = []
    for (let id = 0; id < side*side; id++) if (!blockedFor[0].has(id) && id !== townIds[0]) open.push(id)
    const mineIds = new Set(), assigned = new Array(humans)
    const fields = () => towns.map((t, i) => valleyDistances(side, t, blockedFor[i], mineIds))
    const connected = () => fields().every(d => open.every(id => d[id] >= 0))
    for (const i of shuffle([...Array(humans).keys()])) {
        const d = fields(), tiers = new Map()
        for (let id = 0; id < side*side; id++) {
            const x = id % side, y = (id - x) / side
            if (grid[y][x] !== 'A' || reserved.has(id) || mineIds.has(id) || d[i][id] < 0) continue
            const own = d[i][id], fair = d.every((other, j) => j === i || other[id] < 0 || other[id] >= own)
            const tier = (fair ? 0 : 100000) + own
            if (!tiers.has(tier)) tiers.set(tier, [])
            tiers.get(tier).push(id)
        }
        // Nearest cells where this human is (jointly) closest come first.
        search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
            for (const id of shuffle(tiers.get(tier))) {
                mineIds.add(id)
                if (connected()) { assigned[i] = {id, distance: tier % 100000}; break search }
                mineIds.delete(id)
            }
        }
        if (!assigned[i]) throw new Error(`Divided Valley has no nearby mine: size=${plan.size} humans=${humans} slot=${i+1}`)
    }
    const cell = id => ({x: id % side, y: Math.floor(id / side)})
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize,
        stages: ['towns', 'reserve-neighbourhoods', 'nearby-mines'],
        band: {rows: [Math.min(...towns.map(t => t.y)), Math.max(...towns.map(t => t.y))], ...band},
        players: [{slot: 0, rgb: {...VALLEY_NEUTRAL_RGB}, towns: [], units: [], gold: 0},
            ...towns.map((t, i) => ({slot: i + 1, rgb: colorOf(i + 1), gold: assets.gold, units: [], towns: [t]}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: assigned.map(a => ({...cell(a.id), owner: 0, income: 20})),
        assignments: assigned.map((a, i) => ({slot: i + 1, mine: cell(a.id), distance: a.distance}))
    }
}

// True when the cells outside solid obstacles form one component and every
// listed object (town or mine) touches it, so no object or free cell is cut off.
function valleyPassableConnected(side, solid, objects) {
    const seen = new Uint8Array(side * side), queue = []
    let open = 0
    for (let id = 0; id < side*side; id++) if (!solid.has(id)) {
        open++
        if (!queue.length) { queue.push(id); seen[id] = 1 }
    }
    for (let i = 0; i < queue.length; i++) {
        const x = queue[i] % side
        for (const n of valleyNeighbours({x, y: (queue[i] - x) / side}, side)) {
            const id = n.y*side+n.x
            if (!seen[id] && !solid.has(id)) { seen[id] = 1; queue.push(id) }
        }
    }
    return queue.length === open && objects.every(id => {
        const x = id % side
        return valleyNeighbours({x, y: (id - x) / side}, side).some(n => seen[n.y*side+n.x])
    })
}

const VALLEY_ACCESS_DISPARITY = 4
const VALLEY_NEUTRAL_TARGET = 2

// Neutral towns and the remaining (forward) mines after placeValleyStarts.
// Neutral towns go to forward-territory centers chosen greedily so the spread
// of each human's nearest neutral-town path stays small; forward mines go to
// free forward cells farther from every human than any human's nearest mine.
// Other humans' towns and the ridge block paths; neutral towns and mines are
// endpoints. Counts, owners and incomes are unchanged from the scaling targets.
function placeValleyExpansions(plan, starts) {
    const {side, humans, grid, counts} = plan
    const shuffle = valleyShuffler(plan.seed ^ 0x85ebca6b)
    const cell = id => ({x: id % side, y: Math.floor(id / side)})
    const idOf = c => c.y*side+c.x
    const towns = starts.players.slice(1).map(p => p.towns[0]), townIds = towns.map(idOf)
    const terrain = []
    grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === 'M') terrain.push(y*side+x) })
    const neutral = [], mineIds = new Set(starts.goldmines.map(idOf)), forwardMines = []
    const reserved = new Set(starts.reserved.map(idOf))
    const blockedFor = townIds.map((_, i) => new Set([...terrain, ...townIds.filter((_, j) => j !== i)]))
    const fields = () => {
        const endpoints = new Set([...mineIds, ...neutral.map(idOf)])
        return towns.map((t, i) => valleyDistances(side, t, blockedFor[i], endpoints))
    }
    const connected = () => valleyPassableConnected(side, new Set([...terrain, ...townIds, ...neutral.map(idOf), ...mineIds]),
        [...townIds, ...neutral.map(idOf), ...mineIds])
    const spread = values => Math.max(...values) - Math.min(...values)
    const nearestNeutral = d => d.map(di => Math.min(...neutral.map(t => di[idOf(t)] < 0 ? Infinity : di[idOf(t)])))
    const neutralDisparity = () => spread(nearestNeutral(fields()))
    // One greedy pass over a site list; false when sites run out or the final
    // access spread is too wide.
    const placeNeutral = sites => {
        neutral.length = 0
        const near = new Uint8Array(side * side)
        const claim = t => {
            for (let y = Math.max(0, t.y-2); y <= Math.min(side-1, t.y+2); y++)
                for (let x = Math.max(0, t.x-2); x <= Math.min(side-1, t.x+2); x++) near[y*side+x] = 1
        }
        towns.forEach(claim)
        const usable = sites.filter(s => !VALLEY_OFFSETS3.some(o => mineIds.has((s.y+o.y)*side + s.x+o.x)))
        for (let k = 0; k < counts.neutralTowns; k++) {
            const d = fields(), current = nearestNeutral(d), tiers = new Map()
            for (const s of usable) {
                if (near[idOf(s)]) continue
                const next = d.map((di, i) => di[idOf(s)] < 0 ? Infinity : Math.min(current[i], di[idOf(s)]))
                if (!next.every(Number.isFinite)) continue
                const tier = Math.max(VALLEY_NEUTRAL_TARGET, spread(next))
                if (!tiers.has(tier)) tiers.set(tier, [])
                tiers.get(tier).push(s)
            }
            let placed = false
            search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
                for (const s of shuffle(tiers.get(tier))) {
                    neutral.push(s)
                    if (connected()) { claim(s); placed = true; break search }
                    neutral.pop()
                }
            }
            if (!placed) return false
        }
        return neutralDisparity() <= VALLEY_ACCESS_DISPARITY
    }
    // Free centers first; the planner's Chebyshev-3 lattice always holds the
    // full count, so it is the fallback when free picks pack badly.
    const free = valleyTownCenters(plan, 'F', 'Fflr'), lattice = plan.capacity.forwardSites
    if (![free, free, free, lattice, lattice, lattice].some(placeNeutral))
        throw new Error(`Divided Valley has no fair neutral town layout: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    for (const t of neutral) for (const o of VALLEY_OFFSETS3) reserved.add((t.y+o.y)*side + t.x+o.x)
    const nearbyDistance = Math.max(...starts.assignments.map(a => a.distance))
    // Cells touching a portal region stay free for portal approaches.
    const portalEdge = id => valleyNeighbours(cell(id), side).some(n => 'WE'.includes(grid[n.y][n.x]))
    for (let k = humans; k < counts.goldmines; k++) {
        const d = fields(), candidates = []
        for (let id = 0; id < side*side; id++) {
            const c = cell(id)
            if (grid[c.y][c.x] !== 'F' || reserved.has(id) || mineIds.has(id) || portalEdge(id)) continue
            const nearest = Math.min(...d.map(di => di[id] < 0 ? Infinity : di[id]))
            if (Number.isFinite(nearest) && nearest > nearbyDistance) candidates.push(id)
        }
        let placed = false
        for (const id of shuffle(candidates)) {
            mineIds.add(id)
            if (connected() && neutralDisparity() <= VALLEY_ACCESS_DISPARITY) { forwardMines.push(id); placed = true; break }
            mineIds.delete(id)
        }
        if (!placed) throw new Error(`Divided Valley has no forward mine site: size=${plan.size} humans=${humans} mine=${k+1}`)
    }
    const mine = id => ({...cell(id), owner: 0, income: 20})
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize,
        stages: [...starts.stages, 'neutral-towns', 'reserve-neutral-neighbourhoods', 'forward-mines'],
        band: starts.band,
        players: [{...starts.players[0], towns: neutral.map(t => ({...t}))},
            ...starts.players.slice(1).map(p => ({...p, towns: p.towns.map(t => ({...t}))}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: [...starts.goldmines.map(m => ({...m})), ...forwardMines.map(mine)],
        assignments: starts.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: {nearbyMines: starts.goldmines.map(m => ({x: m.x, y: m.y})), forwardMines: forwardMines.map(cell),
            neutralTowns: neutral.map(t => ({...t})), nearbyMineDistanceMax: nearbyDistance}
    }
}

const VALLEY_PORTAL_FRONTS = Object.freeze({west: 'W', east: 'E'})

// Portals after placeValleyExpansions. The H x multiplier portals form two
// shared front groups, one in each top-corner portal region (sizes differ by at
// most one; a single portal takes the west region), never one lane per human.
// Every portal keeps the size's minimum empty-hex distance from every human
// town and two free adjacent approach cells of its own that every human reaches
// through either advance passage. Nearest-portal path spread stays within the
// access disparity both with mines as endpoints and with mines walkable.
function placeValleyPortals(plan, layout) {
    const {side, humans, grid, counts} = plan
    const shuffle = valleyShuffler(plan.seed ^ 0xc2b2ae35)
    const cell = id => ({x: id % side, y: Math.floor(id / side)})
    const idOf = c => c.y*side+c.x
    const towns = layout.players.slice(1).map(p => p.towns[0]), townIds = towns.map(idOf)
    const neutralIds = layout.players[0].towns.map(idOf), mineIds = layout.goldmines.map(idOf)
    const occupied = new Set([...townIds, ...neutralIds, ...mineIds]), reserved = new Set(layout.reserved.map(idOf))
    const terrain = []
    grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === 'M') terrain.push(y*side+x) })
    const quota = {west: Math.ceil(counts.portals / 2), east: Math.floor(counts.portals / 2)}
    const hex = valleyDistances(side, towns, new Set(), new Set())
    const interior = ch => {
        const list = []
        for (let y = plan.rows.exitRow + 1; y < plan.rows.entranceRow; y++)
            for (let x = 0; x < side; x++) if (grid[y][x] === ch) list.push(y*side+x)
        return list
    }
    const closures = {leftOnly: interior('r'), rightOnly: interior('l')}
    const portals = [], fronts = []
    // Mines are endpoints in the game model and walkable in the TASK-134 contract.
    const fieldSets = (closed = []) => {
        const withMines = new Set([...neutralIds, ...mineIds, ...portals]), walkMines = new Set([...neutralIds, ...portals])
        return [withMines, walkMines].map(endpoints => towns.map((t, i) =>
            valleyDistances(side, t, new Set([...terrain, ...townIds.filter((_, j) => j !== i), ...closed]), endpoints)))
    }
    const spread = values => Math.max(...values) - Math.min(...values)
    const nearest = (model, ids) => model.map(di => Math.min(...ids.map(id => di[id] < 0 ? Infinity : di[id])))
    // Two distinct approach cells per portal (bipartite matching), each free and
    // reached by every human in both path models.
    const approaches = sets => {
        const portalIds = new Set(portals)
        const options = portals.map(id => valleyNeighbours(cell(id), side).map(idOf).filter(n =>
            !occupied.has(n) && !portalIds.has(n) && sets.every(model => model.every(di => di[n] >= 0))))
        const owner = new Map()
        const augment = (slot, seen) => {
            for (const n of options[slot >> 1]) {
                if (seen.has(n)) continue
                seen.add(n)
                if (!owner.has(n) || augment(owner.get(n), seen)) { owner.set(n, slot); return true }
            }
            return false
        }
        for (let slot = 0; slot < 2 * portals.length; slot++) if (!augment(slot, new Set())) return null
        const result = portals.map(() => [])
        for (const [n, slot] of owner) result[slot >> 1].push(n)
        return result.map(list => list.sort((a, b) => a - b))
    }
    const connected = () => valleyPassableConnected(side, new Set([...terrain, ...occupied, ...portals]), [...occupied, ...portals])
    const regionSites = front => {
        const ch = VALLEY_PORTAL_FRONTS[front], list = []
        grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === ch) list.push(y*side+x) })
        return list.filter(id => hex[id] >= plan.portalDistance && !occupied.has(id) && !reserved.has(id))
    }
    const sites = {west: regionSites('west'), east: regionSites('east')}
    const latticeIds = new Set([...plan.capacity.portalSlots.west, ...plan.capacity.portalSlots.east].map(idOf))
    // Portals sit in far corners, so path fields without portal endpoints rank
    // candidates; the finished layout is re-measured exactly.
    const base = fieldSets()
    const nextSpread = (current, id) => {
        const next = base.map((model, m) => model.map((di, i) => di[id] < 0 ? Infinity : Math.min(current[m][i], di[id])))
        return next.every(values => values.every(Number.isFinite)) ? Math.max(...next.map(spread)) : Infinity
    }
    // Anchor pairs (one portal per front, or the single west portal) fix the
    // nearest-portal spread; the remaining portals fill each group without
    // widening it past the disparity limit.
    const anchors = new Map()
    const none = base.map(model => model.map(() => Infinity))
    for (const w of sites.west) {
        const afterWest = base.map((model, m) => model.map((di, i) => di[w] < 0 ? Infinity : di[w]))
        for (const e of quota.east ? sites.east : [null]) {
            const s = e === null ? nextSpread(none, w) : nextSpread(afterWest, e)
            if (s > VALLEY_ACCESS_DISPARITY) continue
            const tier = Math.max(VALLEY_NEUTRAL_TARGET, s)
            if (!anchors.has(tier)) anchors.set(tier, [])
            anchors.get(tier).push(e === null ? [w] : [w, e])
        }
    }
    const failures = {anchors: 0, fill: 0, exact: 0}
    let assigned = null
    const placeFrom = (anchor, preferLattice) => {
        portals.length = 0; fronts.length = 0
        const placed = {west: 0, east: 0}
        for (const id of anchor) {
            const front = grid[Math.floor(id / side)][id % side] === 'W' ? 'west' : 'east'
            portals.push(id); fronts.push(front); placed[front]++
        }
        if (!connected() || !approaches(base)) return false
        while (portals.length < counts.portals) {
            const current = base.map(model => nearest(model, portals)), tiers = new Map()
            for (const front of ['west', 'east']) {
                if (placed[front] >= quota[front]) continue
                for (const id of sites[front]) {
                    if (portals.includes(id)) continue
                    const s = nextSpread(current, id)
                    if (s > VALLEY_ACCESS_DISPARITY) continue
                    const tier = Math.max(VALLEY_NEUTRAL_TARGET, s) * 2 + (preferLattice && !latticeIds.has(id))
                    if (!tiers.has(tier)) tiers.set(tier, [])
                    tiers.get(tier).push({id, front})
                }
            }
            let done = false
            search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
                for (const choice of shuffle(tiers.get(tier))) {
                    portals.push(choice.id)
                    if (connected() && approaches(base)) { fronts.push(choice.front); placed[choice.front]++; done = true; break search }
                    portals.pop()
                }
            }
            if (!done) { failures.fill++; return false }
        }
        const sets = fieldSets()
        assigned = sets.every(model => spread(nearest(model, portals)) <= VALLEY_ACCESS_DISPARITY) ? approaches(sets) : null
        // Each advance passage alone must carry every human to every approach cell.
        const ok = assigned && [closures.leftOnly, closures.rightOnly].every(closed => fieldSets(closed).every(model =>
            model.every(di => assigned.flat().every(n => di[n] >= 0))))
        if (!ok) failures.exact++
        return ok
    }
    let found = false
    search: for (const tier of [...anchors.keys()].sort((a, b) => a - b)) {
        const ranked = shuffle(anchors.get(tier).slice())
        const lattice = ranked.filter(a => a.every(id => latticeIds.has(id)))
        // Two free-fill and two lattice-fill attempts per tier.
        for (let attempt = 0; attempt < 4; attempt++) {
            const preferLattice = attempt % 2 === 1
            const anchor = (preferLattice ? lattice : ranked)[Math.floor(attempt / 2)]
            if (!anchor) continue
            failures.anchors++
            if (placeFrom(anchor, preferLattice)) { found = true; break search }
        }
    }
    if (!found)
        throw new Error(`Divided Valley has no fair portal layout: size=${plan.size} humans=${humans} seed=${plan.seed} ` +
            `anchorTiers=${[...anchors.keys()].sort((a, b) => a - b).join('/')} tried=${failures.anchors} fill=${failures.fill} exact=${failures.exact}`)
    const sets = fieldSets()
    const approachCells = assigned.flat()
    return {
        ...layout,
        stages: [...layout.stages, 'portals', 'reserve-portal-approaches'],
        players: layout.players.map(p => ({...p, towns: p.towns.map(t => ({...t}))})),
        reserved: [...new Set([...reserved, ...approachCells])].sort((a, b) => a - b).map(cell),
        goldmines: layout.goldmines.map(m => ({...m})),
        assignments: layout.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: {...layout.expansions},
        portals: portals.map(cell),
        portalGroups: Object.fromEntries(['west', 'east'].map(front =>
            [front, portals.map((_, i) => i).filter(i => fronts[i] === front)])),
        portalApproaches: portals.map((id, i) => ({portal: cell(id), front: fronts[i], cells: assigned[i].map(cell)})),
        portalAccess: {minimumHexDistance: Math.min(...portals.map(id => hex[id])), required: plan.portalDistance,
            nearestWithMineEndpoints: nearest(sets[0], portals), nearestWithWalkableMines: nearest(sets[1], portals)}
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {planDividedValley, placeValleyStarts, placeValleyExpansions, placeValleyPortals, valleyRowPlans, clearValleyPlanCache, createValleyRandom,
        VALLEY_LEGEND, VALLEY_PORTAL_DISTANCE}
}
