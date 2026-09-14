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

// Edge distances from one start. Blocked cells are never entered; endpoint
// cells (buildings used by interaction) are entered but never expanded.
function valleyDistances(side, start, blocked, endpoints) {
    const distance = new Int32Array(side * side).fill(-1), queue = [start]
    distance[start.y*side+start.x] = 0
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i]
        if (i && endpoints.has(c.y*side+c.x)) continue
        for (const n of valleyNeighbours(c, side)) {
            const id = n.y*side+n.x
            if (distance[id] >= 0 || blocked.has(id)) continue
            distance[id] = distance[c.y*side+c.x] + 1; queue.push(n)
        }
    }
    return distance
}

// Starting towns and one nearby unowned mine per human inside a plan's allied
// territory. Towns come from the front-most lattice rows that hold every human,
// then take a seeded one-cell jitter; their 3x3 neighbourhoods are reserved
// before any mine. Other humans' towns and the ridge block paths, mines are
// endpoints, and a mine is rejected if it would cut any free cell off.
function placeValleyStarts(plan, colorOf = typeof coopPlayerColor === 'function' ? coopPlayerColor : null) {
    if (typeof colorOf !== 'function') throw new TypeError('Divided Valley starts require coopPlayerColor')
    const {side, humans, grid} = plan, alliedTop = plan.rows.alliedTop
    const assets = valleyScaling(humans, plan.size).startingAssets
    const rng = createValleyRandom((plan.seed ^ 0x9e3779b9) >>> 0)
    const pickIndex = length => Math.floor(rng() * length)
    const shuffle = list => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = pickIndex(i + 1)
            ;[list[i], list[j]] = [list[j], list[i]]
        }
        return list
    }
    const lattice = plan.capacity.alliedSites
    let bandBottom = alliedTop
    for (const y of [...new Set(lattice.map(s => s.y))].sort((a, b) => a - b)) {
        bandBottom = y
        if (lattice.filter(s => s.y <= y).length >= humans) break
    }
    const band = lattice.filter(s => s.y <= bandBottom)
    if (band.length < humans) throw new Error(`Divided Valley has no allied town sites: size=${plan.size} humans=${humans}`)
    const towns = shuffle(band.slice()).slice(0, humans)
    const offsets = []
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) offsets.push({x: dx, y: dy})
    const siteOk = (t, self) => t.x >= 2 && t.x <= side - 3 && t.y >= alliedTop && t.y <= side - 3 &&
        grid[t.y][t.x] === 'A' && offsets.every(o => 'Ablr'.includes(grid[t.y+o.y][t.x+o.x])) &&
        towns.every((u, j) => j === self || valleyChebyshev(t, u) >= 3)
    // The unmoved center always stays valid, so each jitter step terminates.
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < humans; i++) {
        for (const o of shuffle(offsets.slice())) {
            const t = {x: towns[i].x + o.x, y: towns[i].y + o.y}
            if (siteOk(t, i)) { towns[i] = t; break }
        }
    }
    const reserved = new Set()
    for (const t of towns) for (const o of offsets) reserved.add((t.y+o.y)*side + t.x+o.x)
    const townIds = towns.map(t => t.y*side+t.x), terrain = []
    grid.forEach((line, y) => { for (let x = 0; x < side; x++) if (line[x] === 'M') terrain.push(y*side+x) })
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
        band: {rows: [alliedTop, bandBottom], latticeSites: band.length},
        players: [{slot: 0, rgb: {...VALLEY_NEUTRAL_RGB}, towns: [], units: [], gold: 0},
            ...towns.map((t, i) => ({slot: i + 1, rgb: colorOf(i + 1), gold: assets.gold, units: [], towns: [t]}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: assigned.map(a => ({...cell(a.id), owner: 0, income: 20})),
        assignments: assigned.map((a, i) => ({slot: i + 1, mine: cell(a.id), distance: a.distance}))
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {planDividedValley, placeValleyStarts, valleyRowPlans, clearValleyPlanCache, createValleyRandom,
        VALLEY_LEGEND, VALLEY_PORTAL_DISTANCE}
}
