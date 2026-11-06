// TASK-1558 (SECTORS 2/11): SectorCache core. The board picture cached per SECTOR: a square of board space at a zoom
// LEVEL. No render path uses it yet; later sector tickets build, composite and invalidate through it.
//
// Coordinates. A level is a device scale (device pixels per board unit = camera scale x dpr). A sector is
// SECTOR_SIZE x SECTOR_SIZE device pixels at its level, so it spans SECTOR_SIZE / level board units; its key is
// (level, u, v) with u = floor(x / span), v = floor(y / span) in board space, so the same board point has one sector
// per level and the grids of different levels are independent.
//
// Levels (sectorLevels): a fixed set, the powers of 2 x dpr covering the camera range [scale.min, scale.max] (from the
// largest power of 2 not above min to the smallest not below max), plus the current exact settled scale x dpr.
//
// Entries hold the sector's picture (canvas / ImageBitmap), level, build version and bytes (w x h x 4 by default).
// Total bytes stay under SECTOR_CACHE_BYTES by LRU eviction (least recently used first); a sector drawn in the current
// frame (beginFrame / use, or put this frame) is never evicted, so the cache may stay over budget for that frame (overBudget).
//
// Dirty marking: dirtyCells(cells) maps each board cell to its board box grown by SECTOR_PAD board units (hex overhang:
// unit sprites, bars and texts reaching past the hexagon) and marks exactly the cached sectors overlapping a box, at every
// level. A dirty entry stays usable as a stale stand-in but lookup reports it missing until it is rebuilt (put).
//
// lookup(level, rect) returns the sectors covering a board rect: the clean entries, the stale (dirty) ones and the missing
// keys (absent or dirty) ordered nearest-first: by the distance from the sector's centre to the focus point (default the
// rect's centre), ties by v then u.
const SECTOR_SIZE = 256
const SECTOR_CACHE_BYTES = 256 * 1024 * 1024
// Board units a cell's box is grown by when it is marked dirty (hexagon overhang of units, bars and cell texts).
const SECTOR_PAD = 24

// The fixed level set for a camera range and dpr plus the exact settled level, ascending, without duplicates.
function sectorLevels({min, max, dpr = 1, exact} = {}) {
    if (!(min > 0) || !(max >= min) || !(dpr > 0)) throw new Error(`sectorLevels: bad camera range ${min}..${max} dpr ${dpr}`)
    const levels = new Set()
    for (let k = Math.floor(Math.log2(min) + 1e-9); k <= Math.ceil(Math.log2(max) - 1e-9); ++k) levels.add(2 ** k * dpr)
    if (exact > 0) levels.add(exact * dpr)
    return [...levels].sort((a, b) => a - b)
}

// The board box of a cell: a {x, y, w, h} rect as given, else a hexagon's centre (calcPos()) +- r.
function sectorCellBox(cell, r) {
    if (cell && typeof cell.w === 'number' && typeof cell.h === 'number') return cell
    const c = typeof cell?.calcPos === 'function' ? cell.calcPos() : cell
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) throw new Error('sectorCellBox: cell without a box or position')
    const radius = r ?? (typeof basis !== 'undefined' ? basis.r : NaN)
    if (!(radius > 0)) throw new Error('sectorCellBox: no hexagon radius')
    return {x: c.x - radius, y: c.y - radius, w: 2 * radius, h: 2 * radius}
}

class SectorCache {
    constructor({size = SECTOR_SIZE, budget = SECTOR_CACHE_BYTES, pad = SECTOR_PAD, radius} = {}) {
        this.size = size
        this.budget = budget
        this.pad = pad
        this.radius = radius
        this.entries = new Map() // key -> entry, least recently used first
        this.bytes = 0
        this.frame = 0
        this.evictions = 0
    }
    static key(level, u, v) { return `${level}:${u}:${v}` }
    static parse(key) {
        const [level, u, v] = key.split(':').map(Number)
        return {level, u, v}
    }
    span(level) { return this.size / level }
    // The sector of a board point at a level.
    sectorAt(level, x, y) {
        const s = this.span(level)
        return {level, u: Math.floor(x / s), v: Math.floor(y / s)}
    }
    // The board rect of a sector.
    sectorRect(level, u, v) {
        const s = this.span(level)
        return {x: u * s, y: v * s, w: s, h: s}
    }
    // The (u, v) ranges of the sectors overlapping a board rect (open right/bottom edges: a rect ending on a sector
    // border does not reach the next sector).
    range(level, rect) {
        const s = this.span(level)
        return {u0: Math.floor(rect.x / s), u1: Math.ceil((rect.x + rect.w) / s) - 1,
            v0: Math.floor(rect.y / s), v1: Math.ceil((rect.y + rect.h) / s) - 1}
    }
    get(key) { return this.entries.get(key) }
    has(key) { return this.entries.has(key) }
    beginFrame() { return ++this.frame }
    touch(key, entry) {
        this.entries.delete(key)
        this.entries.set(key, entry)
    }
    // Marks an entry drawn in the current frame (protected from eviction this frame) and most recently used.
    use(key) {
        const entry = this.entries.get(key)
        if (!entry) return null
        entry.frame = this.frame
        this.touch(key, entry)
        return entry
    }
    // Stores a built sector (built for the current frame: protected like a drawn one); bytes default to w x h x 4.
    put(level, u, v, image, {version = 0, bytes} = {}) {
        const key = SectorCache.key(level, u, v)
        const old = this.entries.get(key)
        if (old) {
            this.bytes -= old.bytes
            this.entries.delete(key)
        }
        const size = bytes ?? (image ? image.width * image.height * 4 : 0)
        const entry = {key, level, u, v, image, version, bytes: size, dirty: false, frame: this.frame}
        this.entries.set(key, entry)
        this.bytes += size
        this.evict()
        return entry
    }
    remove(key) {
        const entry = this.entries.get(key)
        if (!entry) return false
        this.entries.delete(key)
        this.bytes -= entry.bytes
        if (entry.image && typeof entry.image.close === 'function') entry.image.close()
        return true
    }
    // Least recently used first, skipping sectors drawn in the current frame.
    evict() {
        for (const [key, entry] of this.entries) {
            if (this.bytes <= this.budget) break
            if (entry.frame === this.frame) continue
            this.remove(key)
            this.evictions++
        }
        return this.bytes <= this.budget
    }
    get overBudget() { return this.bytes > this.budget }
    // Marks the cached sectors overlapping the cells' boxes (grown by pad) dirty at every level; returns their keys.
    // TASK-1559: padAt(level), optional: board units the boxes are grown by besides at that level (a reach given in device
    // pixels, as the lit tiles' edge runs').
    dirtyCells(cells, padAt) {
        const boxes = [...cells].map(cell => {
            const b = sectorCellBox(cell, this.radius)
            return {x: b.x - this.pad, y: b.y - this.pad, w: b.w + 2 * this.pad, h: b.h + 2 * this.pad}
        })
        const marked = []
        for (const entry of this.entries.values()) {
            const r = this.sectorRect(entry.level, entry.u, entry.v), m = padAt ? padAt(entry.level) : 0
            if (boxes.some(b => b.x - m < r.x + r.w && b.x + b.w + m > r.x && b.y - m < r.y + r.h && b.y + b.h + m > r.y)) {
                entry.dirty = true
                marked.push(entry.key)
            }
        }
        return marked
    }
    // The sectors of a level covering a board rect: {sectors, stale, missing}; missing ordered nearest-first to focus.
    lookup(level, rect, focus = {x: rect.x + rect.w / 2, y: rect.y + rect.h / 2}) {
        const {u0, u1, v0, v1} = this.range(level, rect), s = this.span(level)
        const sectors = [], stale = [], missing = []
        for (let v = v0; v <= v1; ++v)
            for (let u = u0; u <= u1; ++u) {
                const key = SectorCache.key(level, u, v), entry = this.entries.get(key)
                if (entry && !entry.dirty) sectors.push(entry)
                else {
                    if (entry) stale.push(entry)
                    missing.push({key, level, u, v, distance: Math.hypot((u + 0.5) * s - focus.x, (v + 0.5) * s - focus.y)})
                }
            }
        missing.sort((a, b) => a.distance - b.distance || a.v - b.v || a.u - b.u)
        return {sectors, stale, missing}
    }
    clear() {
        for (const key of [...this.entries.keys()]) this.remove(key)
    }
}

if (typeof module !== 'undefined' && module.exports)
    module.exports = {SectorCache, sectorLevels, sectorCellBox, SECTOR_SIZE, SECTOR_CACHE_BYTES, SECTOR_PAD}
