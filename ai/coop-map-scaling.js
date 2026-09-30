// Shared baseline targets for current co-op generation. Valley capacity may enlarge the side.
const COOP_SCALING_PRESETS = Object.freeze({
    tiny: Object.freeze({baseSide: 15, minSide: 11, objectsPerHuman: 1}),
    normal: Object.freeze({baseSide: 25, minSide: 15, objectsPerHuman: 2}),
    big: Object.freeze({baseSide: 39, minSide: 21, objectsPerHuman: 3})
})
// Hex radius presets for the hex co-op map. They are sized for the final elite load, so the
// size selector stays meaningful; growth may only repair an infeasible preset.
const COOP_HEX_RADIUS = Object.freeze({
    tiny: Object.freeze({scale: 8, min: 10}),
    normal: Object.freeze({scale: 11, min: 13}),
    big: Object.freeze({scale: 14, min: 16})
})
// Three melee and ranged portals, one of each remaining category (mage included) per initial human. Matches
// COOP_PORTAL_CATEGORIES (ai/wave-config.js), which the server does not load.
const COOP_PORTAL_CATEGORY_ORDER = Object.freeze(['melee', 'ranged', 'siege', 'heavy', 'support', 'chaos', 'mage'])

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
    const portalCategories = Object.fromEntries(COOP_PORTAL_CATEGORY_ORDER.map(category => [category, initialHumanCount * (category === 'melee' || category === 'ranged' ? 3 : 1)]))
    return {size, initialHumanCount, side, mapSize: {x: side, y: side}, area,
        baselineRadius: baselineRadius(initialHumanCount, size),
        counts: {humanTowns: initialHumanCount, neutralTowns: objects,
            goldmines: objects, portals: 11 * initialHumanCount,
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
    module.exports = {getCoopMapScaling, getCoopMapScalingFromMetadata, COOP_PORTAL_CATEGORY_ORDER,
        COOP_HEX_RADIUS, baselineRadius, hexCounts}
}
