// Shared baseline targets for current co-op generation. Valley capacity may enlarge the side.
const COOP_SCALING_PRESETS = Object.freeze({
    tiny: Object.freeze({baseSide: 15, minSide: 11, objectsPerHuman: 2, minesPerHuman: 2}),
    normal: Object.freeze({baseSide: 25, minSide: 15, objectsPerHuman: 4, minesPerHuman: 4}),
    big: Object.freeze({baseSide: 39, minSide: 21, objectsPerHuman: 5, minesPerHuman: 6})
})
// Hex radius presets for the hex co-op map. They are sized for the final elite load, so the
// size selector stays meaningful; growth may only repair an infeasible preset.
const COOP_HEX_RADIUS = Object.freeze({
    tiny: Object.freeze({scale: 8, min: 10}),
    normal: Object.freeze({scale: 11, min: 13}),
    big: Object.freeze({scale: 14, min: 16})
})
// Three melee, ranged and mage portals, two cavalry portals and one of each remaining category
// (siege, heavy, chaos) per initial human, 14 in all,
// plus COOP_EXTRA_HEAVY_PORTALS heavy portals per map. Matches COOP_PORTAL_CATEGORIES (ai/wave-config.js),
// which the server does not load.
const COOP_PORTAL_CATEGORY_ORDER = Object.freeze(['melee', 'ranged', 'siege', 'heavy', 'cavalry', 'chaos', 'mage'])
const COOP_EXTRA_HEAVY_PORTALS = 2
// Hand-made tutorial co-op maps (GameMap coop {tutorial:true}) list their own portals and use a
// fixed spawn table instead of the generated schedule: from round 4, every 4 rounds, each free
// portal spawns its type; a chaos portal spawns one demonLord at COOP_TUTORIAL_CHAOS_ROUND only.
const COOP_TUTORIAL_PORTAL_TYPES = Object.freeze({melee: 'brute', mage: 'hexcaster', siege: 'bombard',
    ranged: 'emberArcher', heavy: 'bulwark', chaos: 'demonLord'})
const COOP_TUTORIAL_WAVE_INTERVAL = 4
const COOP_TUTORIAL_CHAOS_ROUND = 8

function getCoopTutorialDemonType(category, round) {
    if (typeof category !== 'string' || !Object.prototype.hasOwnProperty.call(COOP_TUTORIAL_PORTAL_TYPES, category))
        throw new RangeError('Invalid tutorial portal category')
    if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Invalid wave round')
    if (category === 'chaos') return round === COOP_TUTORIAL_CHAOS_ROUND ? COOP_TUTORIAL_PORTAL_TYPES.chaos : null
    return round > 0 && round % COOP_TUTORIAL_WAVE_INTERVAL === 0 ? COOP_TUTORIAL_PORTAL_TYPES[category] : null
}
const COOP_PORTALS_PER_HUMAN = Object.freeze({melee: 3, ranged: 3, siege: 1, heavy: 1, cavalry: 2, chaos: 1, mage: 3})

function baselineRadius(initialHumanCount, size) {
    const preset = COOP_HEX_RADIUS[size]
    return Math.max(preset.min, Math.ceil(preset.scale * Math.sqrt(initialHumanCount)))
}

// Terrain targets come from the playable hex cells, not from side squared.
function hexCounts(radius) {
    const playable = 3 * radius * radius + 3 * radius + 1
    return {playable, mountains: Math.round(playable * 0.08),
        lakes: Math.round(playable * 0.06), bushes: Math.round(playable * 0.10)}
}

function getCoopMapScaling(initialHumanCount, size = 'normal') {
    if (!Number.isInteger(initialHumanCount) || initialHumanCount < 1 || initialHumanCount > 12) {
        throw new RangeError('Co-op initial human count must be an integer from 1 to 12')
    }
    if (typeof size !== 'string' || !Object.prototype.hasOwnProperty.call(COOP_SCALING_PRESETS, size)) {
        throw new RangeError('Co-op size must be tiny, normal or big')
    }
    const preset = COOP_SCALING_PRESETS[size]
    const side = Math.max(preset.minSide, Math.ceil(preset.baseSide * Math.sqrt(initialHumanCount / 4)))
    const area = side * side
    const objects = initialHumanCount * preset.objectsPerHuman
    const portalCategories = Object.fromEntries(COOP_PORTAL_CATEGORY_ORDER.map(category => [category, initialHumanCount * COOP_PORTALS_PER_HUMAN[category] +
        (category === 'heavy' ? COOP_EXTRA_HEAVY_PORTALS : 0)]))
    return {size, initialHumanCount, side, mapSize: {x: side, y: side}, area,
        baselineRadius: baselineRadius(initialHumanCount, size),
        counts: {humanTowns: initialHumanCount, neutralTowns: objects,
            goldmines: initialHumanCount * preset.minesPerHuman, portals: Object.values(portalCategories).reduce((a, b) => a + b, 0),
            portalCategories, mountains: Math.round(area * 0.08),
            lakes: Math.round(area * 0.06), bushes: Math.round(area * 0.10)},
        startingAssets: {gold: 100, towns: 1, units: 1}}
}

// Reuse the original roster and replay inputs retained by GameMap/save-load.
// Never infer H from live players, humanSlots, towns or surviving units. These
// are current scaling targets, not a measurement of the stored grid.
function getCoopMapScalingFromMetadata(coop) {
    const generation = coop && coop.generation
    if (!generation || generation.version !== 5 ||
        !Number.isInteger(generation.seed) || generation.seed < 0 || generation.seed > 0xffffffff ||
        generation.playerCount !== coop.initialHumanCount || generation.size === undefined) {
        throw new RangeError('Co-op scaling requires original generation metadata')
    }
    return getCoopMapScaling(coop.initialHumanCount, generation.size)
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {getCoopMapScaling, getCoopMapScalingFromMetadata, COOP_PORTAL_CATEGORY_ORDER, COOP_EXTRA_HEAVY_PORTALS,
        COOP_HEX_RADIUS, baselineRadius, hexCounts, COOP_TUTORIAL_PORTAL_TYPES, getCoopTutorialDemonType}
}
