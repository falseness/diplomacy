// Shared targets for formula-based co-op generation. Placement consumes these
// in the generator integration task; legacy version-2 grids are never resized.
const COOP_SCALING_PRESETS = Object.freeze({
    tiny: Object.freeze({baseSide: 15, minSide: 11, objectsPerHuman: 1}),
    normal: Object.freeze({baseSide: 25, minSide: 15, objectsPerHuman: 2}),
    big: Object.freeze({baseSide: 39, minSide: 21, objectsPerHuman: 3})
})
// One typed portal of each category per initial human on every size. Matches
// COOP_PORTAL_CATEGORIES (ai/wave-config.js), which the server does not load.
const COOP_PORTAL_CATEGORY_ORDER = Object.freeze(['normal', 'ranged', 'heavy', 'highTier'])

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
    const portalCategories = Object.fromEntries(COOP_PORTAL_CATEGORY_ORDER.map(category => [category, initialHumanCount]))
    return {size, initialHumanCount, side, mapSize: {x: side, y: side}, area,
        counts: {humanTowns: initialHumanCount, neutralTowns: objects,
            goldmines: objects, portals: COOP_PORTAL_CATEGORY_ORDER.length * initialHumanCount,
            portalCategories, mountains: Math.round(area * 0.08),
            lakes: Math.round(area * 0.06), bushes: Math.round(area * 0.10)},
        startingAssets: {gold: 100, towns: 1, units: 1}}
}

// Reuse the original roster and replay inputs retained by GameMap/save-load.
// Never infer H from live players, humanSlots, towns or surviving units. These
// are current scaling targets, not a description of a legacy stored grid.
function getCoopMapScalingFromMetadata(coop) {
    const generation = coop && coop.generation
    if (!generation || !Number.isInteger(generation.version) || generation.version < 1 ||
        !Number.isInteger(generation.seed) || generation.seed < 0 || generation.seed > 0xffffffff ||
        generation.playerCount !== coop.initialHumanCount || generation.size === undefined) {
        throw new RangeError('Co-op scaling requires original generation metadata')
    }
    return getCoopMapScaling(coop.initialHumanCount, generation.size)
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {getCoopMapScaling, getCoopMapScalingFromMetadata, COOP_PORTAL_CATEGORY_ORDER}
}
