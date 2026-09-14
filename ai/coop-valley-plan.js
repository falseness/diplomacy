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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {planDividedValley, valleyRowPlans, clearValleyPlanCache, createValleyRandom,
        VALLEY_LEGEND, VALLEY_PORTAL_DISTANCE}
}
