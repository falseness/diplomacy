// [l, r]
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;

}

function areCoordsEqual(coord1, coord2) {
    return coord1.x == coord2.x && coord1.y == coord2.y
}

function hasSuchCoord(coords, coord) {
    for (let i = 0; i < coords.length; ++i) {
        if (areCoordsEqual(coords[i], coord)) {
            return true
        }
    }
    return false
}

function createSeededRandom(seed) {
    let state = seed >>> 0
    if (!state) {
        state = 0x9e3779b9
    }
    return function() {
        state = (1664525 * state + 1013904223) >>> 0
        return state / 0x100000000
    }
}

function randomIntWithRng(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min
}

function coordKey(coord) {
    return coord.x + ':' + coord.y
}

function hasCoordKey(used, coord) {
    return used[coordKey(coord)] === true
}

function markCoordKey(used, coord) {
    used[coordKey(coord)] = true
}

function townTrainingSizeConfig(size) {
    let configs = {
        tiny: {mapSize: {x: 7, y: 7}, neutralTowns: 1, extraUnitsPerPlayer: 1, blockers: 2, minTownDistance: 2, barrackDensity: 0.15, farmDensity: 0.2, externalDensity: 0.15, goldmines: 3},
        medium: {mapSize: {x: 13, y: 13}, neutralTowns: 2, extraUnitsPerPlayer: 2, blockers: 8, minTownDistance: 3, barrackDensity: 0.2, farmDensity: 0.3, externalDensity: 0.25, goldmines: 5},
        big: {mapSize: {x: 21, y: 21}, neutralTowns: 4, extraUnitsPerPlayer: 4, blockers: 18, minTownDistance: 4, barrackDensity: 0.25, farmDensity: 0.4, externalDensity: 0.35, goldmines: 8}
    }
    return configs[size] || configs.tiny
}

const GOLDMINE_TRAINING_INCOME_MIN = 20
const GOLDMINE_TRAINING_INCOME_MAX = 100
const GOLDMINE_TRAINING_STARTING_GOLD_MIN = 50
const GOLDMINE_TRAINING_STARTING_GOLD_MAX = 500

function townDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

function isTownCoordValid(coord, mapSize, used, towns, minTownDistance) {
    if (coord.x <= 0 || coord.y <= 0 || coord.x >= mapSize.x - 1 || coord.y >= mapSize.y - 1) {
        return false
    }
    if (hasCoordKey(used, coord)) {
        return false
    }
    for (let i = 0; i < towns.length; ++i) {
        if (townDistance(coord, towns[i]) < minTownDistance) {
            return false
        }
    }
    return true
}

function pickCoord(rng, mapSize, used, predicate) {
    for (let attempts = 0; attempts < 1000; ++attempts) {
        let coord = {
            x: randomIntWithRng(rng, 0, mapSize.x - 1),
            y: randomIntWithRng(rng, 0, mapSize.y - 1)
        }
        if (!hasCoordKey(used, coord) && (!predicate || predicate(coord))) {
            markCoordKey(used, coord)
            return coord
        }
    }
    let start = randomIntWithRng(rng, 0, mapSize.x * mapSize.y - 1)
    for (let offset = 0; offset < mapSize.x * mapSize.y; ++offset) {
        let index = (start + offset) % (mapSize.x * mapSize.y)
        let coord = {
            x: index % mapSize.x,
            y: Math.floor(index / mapSize.x)
        }
        if (!hasCoordKey(used, coord) && (!predicate || predicate(coord))) {
            markCoordKey(used, coord)
            return coord
        }
    }
    throw new Error('Unable to place generated training map object')
}

function placeTown(rng, mapSize, used, allTowns, minTownDistance) {
    let coord = pickCoord(rng, mapSize, used, function(candidate) {
        return isTownCoordValid(candidate, mapSize, used, allTowns, minTownDistance)
    })
    allTowns.push(coord)
    return coord
}

function placeUnitNearTown(rng, mapSize, used, town, unitType) {
    let candidates = [
        {x: town.x - 1, y: town.y},
        {x: town.x + 1, y: town.y},
        {x: town.x, y: town.y - 1},
        {x: town.x, y: town.y + 1},
        {x: town.x - 1, y: town.y + 1},
        {x: town.x + 1, y: town.y - 1}
    ]
    let start = randomIntWithRng(rng, 0, candidates.length - 1)
    for (let i = 0; i < candidates.length; ++i) {
        let coord = candidates[(start + i) % candidates.length]
        if (coord.x < 0 || coord.y < 0 || coord.x >= mapSize.x || coord.y >= mapSize.y) {
            continue
        }
        if (!hasCoordKey(used, coord)) {
            markCoordKey(used, coord)
            return {type: unitType, x: coord.x, y: coord.y}
        }
    }
    let coord = pickCoord(rng, mapSize, used)
    return {type: unitType, x: coord.x, y: coord.y}
}

function clampProbability(value, fallback) {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.max(0, Math.min(1, value))
}

function townNeighbourCoords(town) {
    return [
        {x: town.x - 1, y: town.y},
        {x: town.x + 1, y: town.y},
        {x: town.x, y: town.y - 1},
        {x: town.x, y: town.y + 1},
        {x: town.x - 1, y: town.y + 1},
        {x: town.x + 1, y: town.y - 1}
    ]
}

function generateBarrackScenarios(rng, mapSize, used, towns, density, pendingProbability) {
    let barracks = []
    let pendingBarracks = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let scenario = {
                x: coord.x,
                y: coord.y,
                town: {x: town.x, y: town.y}
            }
            if (rng() < pendingProbability) {
                scenario.turns = randomIntWithRng(rng, 1, 3)
                pendingBarracks.push(scenario)
            }
            else {
                barracks.push(scenario)
            }
        }
    }
    return {barracks: barracks, pendingBarracks: pendingBarracks}
}

function generateFarmScenarios(rng, mapSize, used, towns, density, pendingProbability) {
    let farms = []
    let pendingFarms = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let scenario = {
                x: coord.x,
                y: coord.y,
                town: {x: town.x, y: town.y}
            }
            if (rng() < pendingProbability) {
                scenario.turns = randomIntWithRng(rng, 1, 2)
                pendingFarms.push(scenario)
            }
            else {
                farms.push(scenario)
            }
        }
    }
    return {farms: farms, pendingFarms: pendingFarms}
}

function buildingDensityProfile(profile, config) {
    let profiles = {
        sparse: {
            barrackDensity: 0.05,
            farmDensity: 0.1,
            externalDensity: 0.1
        },
        normal: {
            barrackDensity: config.barrackDensity,
            farmDensity: config.farmDensity,
            externalDensity: config.externalDensity
        },
        dense: {
            barrackDensity: 0.35,
            farmDensity: 0.35,
            externalDensity: 1
        }
    }
    return profiles[profile] || profiles.normal
}

function generateExternalScenarios(rng, mapSize, used, towns, density) {
    let result = {walls: [], bastions: [], towers: []}
    let types = [
        {name: 'walls'},
        {name: 'bastions'},
        {name: 'towers'}
    ]
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let candidates = townNeighbourCoords(towns[townIndex])
        let offset = randomIntWithRng(rng, 0, types.length - 1)
        let placed = 0
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let type = types[(offset + placed) % types.length]
            result[type.name].push({x: coord.x, y: coord.y})
            ++placed
        }
    }
    return result
}

function boundedInteger(value, fallback, min, max) {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.max(min, Math.min(max, Math.floor(value)))
}

function unitCompositionWeights(composition) {
    let profiles = {
        noob: {Noob: 1},
        balanced: {Noob: 1, Archer: 1, KOHb: 1, Normchel: 1, Catapult: 1},
        all: {Noob: 1, Archer: 1, KOHb: 1, Normchel: 1, Catapult: 1},
        combat: {Noob: 3, Archer: 3, KOHb: 2, Normchel: 1, Catapult: 2},
        economy: {Noob: 5, Archer: 1, KOHb: 1, Normchel: 2, Catapult: 0}
    }
    if (typeof composition == 'string') {
        return profiles[composition] || profiles.noob
    }
    if (!composition || typeof composition != 'object') {
        return profiles.noob
    }
    let weights = {}
    let names = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']
    for (let i = 0; i < names.length; ++i) {
        let weight = Number(composition[names[i]])
        weights[names[i]] = Number.isFinite(weight) ? Math.max(0, weight) : 0
    }
    return weights
}

function unitTypeByName(name) {
    return {
        Noob: Noob,
        Archer: Archer,
        KOHb: KOHb,
        Normchel: Normchel,
        Catapult: Catapult
    }[name]
}

function createUnitComposition(rng, count, composition) {
    let weights = unitCompositionWeights(composition)
    let names = Object.keys(weights).filter(function(name) {
        return weights[name] > 0
    })
    if (!names.length) {
        names = ['Noob']
        weights.Noob = 1
    }

    let result = []
    if (composition == 'all' && count >= names.length) {
        let offset = randomIntWithRng(rng, 0, names.length - 1)
        for (let i = 0; i < names.length; ++i) {
            result.push(unitTypeByName(names[(offset + i) % names.length]))
        }
    }

    let totalWeight = names.reduce(function(total, name) {
        return total + weights[name]
    }, 0)
    while (result.length < count) {
        let choice = rng() * totalWeight
        for (let i = 0; i < names.length; ++i) {
            choice -= weights[names[i]]
            if (choice <= 0 || i == names.length - 1) {
                result.push(unitTypeByName(names[i]))
                break
            }
        }
    }
    return result
}

function generateGoldmineScenarios(rng, mapSize, used, count, incomeMin, incomeMax) {
    let goldmines = []
    for (let i = 0; i < count; ++i) {
        let coord = pickCoord(rng, mapSize, used)
        goldmines.push({
            x: coord.x,
            y: coord.y,
            income: randomIntWithRng(rng, incomeMin, incomeMax),
            owner: i < 3 ? i : randomIntWithRng(rng, 0, 2)
        })
    }
    return goldmines
}

function generateTownTrainingMap(options) {
    options = options || {}
    let config = townTrainingSizeConfig(options.size || 'tiny')
    let rng = createSeededRandom(options.seed || 1)
    let densityProfile = buildingDensityProfile(options.buildingDensity || 'normal', config)
    let barrackDensity =
        clampProbability(options.barrackDensity, densityProfile.barrackDensity)
    let pendingBarrackProbability =
        clampProbability(options.pendingBarrackProbability, 0.5)
    let farmDensity = clampProbability(options.farmDensity, densityProfile.farmDensity)
    let pendingFarmProbability =
        clampProbability(options.pendingFarmProbability, 0.5)
    let externalDensity =
        clampProbability(options.externalDensity, densityProfile.externalDensity)
    let goldmineCount = boundedInteger(options.goldmineCount, config.goldmines, 0, 32)
    let goldmineIncomeMin = boundedInteger(
        options.goldmineIncomeMin,
        GOLDMINE_TRAINING_INCOME_MIN,
        1,
        GOLDMINE_TRAINING_INCOME_MAX)
    let goldmineIncomeMax = boundedInteger(
        options.goldmineIncomeMax,
        GOLDMINE_TRAINING_INCOME_MAX,
        goldmineIncomeMin,
        1000)
    let startingGoldMin = boundedInteger(
        options.startingGoldMin,
        GOLDMINE_TRAINING_STARTING_GOLD_MIN,
        0,
        GOLDMINE_TRAINING_STARTING_GOLD_MAX)
    let startingGoldMax = boundedInteger(
        options.startingGoldMax,
        GOLDMINE_TRAINING_STARTING_GOLD_MAX,
        startingGoldMin,
        100000)
    let unitsPerPlayer = boundedInteger(
        options.unitsPerPlayer,
        config.extraUnitsPerPlayer,
        0,
        32)
    let unitComposition = options.unitComposition || 'noob'
    let mapSize = {x: config.mapSize.x, y: config.mapSize.y}
    let used = {}
    let allTowns = []

    let neutralTowns = []
    let redTowns = []
    let blueTowns = []

    redTowns.push(placeTown(rng, mapSize, used, allTowns, config.minTownDistance))
    blueTowns.push(placeTown(rng, mapSize, used, allTowns, config.minTownDistance))
    for (let i = 0; i < config.neutralTowns; ++i) {
        neutralTowns.push(placeTown(rng, mapSize, used, allTowns, config.minTownDistance))
    }

    let mountains = []
    let lakes = []
    for (let i = 0; i < config.blockers; ++i) {
        let coord = pickCoord(rng, mapSize, used)
        if (i % 2) {
            lakes.push(coord)
        }
        else {
            mountains.push(coord)
        }
    }

    let redUnits = []
    let blueUnits = []
    let redUnitTypes = createUnitComposition(rng, unitsPerPlayer, unitComposition)
    let blueUnitTypes = createUnitComposition(rng, unitsPerPlayer, unitComposition)
    for (let i = 0; i < unitsPerPlayer; ++i) {
        redUnits.push(placeUnitNearTown(rng, mapSize, used, redTowns[0], redUnitTypes[i]))
        blueUnits.push(placeUnitNearTown(rng, mapSize, used, blueTowns[0], blueUnitTypes[i]))
    }
    let redBarrackScenarios = generateBarrackScenarios(
        rng, mapSize, used, redTowns, barrackDensity, pendingBarrackProbability)
    let blueBarrackScenarios = generateBarrackScenarios(
        rng, mapSize, used, blueTowns, barrackDensity, pendingBarrackProbability)
    let redFarmScenarios = generateFarmScenarios(
        rng, mapSize, used, redTowns, farmDensity, pendingFarmProbability)
    let blueFarmScenarios = generateFarmScenarios(
        rng, mapSize, used, blueTowns, farmDensity, pendingFarmProbability)
    let redExternalScenarios = generateExternalScenarios(
        rng, mapSize, used, redTowns, externalDensity)
    let blueExternalScenarios = generateExternalScenarios(
        rng, mapSize, used, blueTowns, externalDensity)
    let generatedGoldmines = generateGoldmineScenarios(
        rng, mapSize, used, goldmineCount, goldmineIncomeMin, goldmineIncomeMax)

    return new GameMap(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: neutralTowns
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: randomIntWithRng(rng, startingGoldMin, startingGoldMax),
                towns: redTowns,
                ai: !gameSettings.testAI,
                units: redUnits,
                barracks: redBarrackScenarios.barracks,
                pendingBarracks: redBarrackScenarios.pendingBarracks,
                farms: redFarmScenarios.farms,
                pendingFarms: redFarmScenarios.pendingFarms,
                walls: redExternalScenarios.walls,
                bastions: redExternalScenarios.bastions,
                towers: redExternalScenarios.towers
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                gold: randomIntWithRng(rng, startingGoldMin, startingGoldMax),
                towns: blueTowns,
                units: blueUnits,
                ai: true,
                barracks: blueBarrackScenarios.barracks,
                pendingBarracks: blueBarrackScenarios.pendingBarracks,
                farms: blueFarmScenarios.farms,
                pendingFarms: blueFarmScenarios.pendingFarms,
                walls: blueExternalScenarios.walls,
                bastions: blueExternalScenarios.bastions,
                towers: blueExternalScenarios.towers
            }
        ],
        generatedGoldmines,
        lakes,
        mountains)
}

function generateTinyTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'tiny', seed: seed})
}

function generateMediumTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'medium', seed: seed})
}

function generateBigTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'big', seed: seed})
}

function generateTinyMapAllUnits() {

    let mapSize = {x: 9, y: 9}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let types = [Noob, Archer, KOHb, Normchel, Catapult]
    for (let k = 0; k < units_arrays.length; ++k) {
        for (let i = 0; i < types.length; ++i) {
            units_arrays[k].push({
                type: types[i],
                x: 1 + i,
                y: k == 0 ? 1 : mapSize.y - 2
            })
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyMap() {

    let mapSize = {x: randomInt(3, 5), y: randomInt(3, 5)}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let unitsCount = randomInt(2, 3)
    for (let i = 0; i < unitsCount; ++i) {
        for (let k = 0; k < units_arrays.length; ++k) {
            let unit = {type: Noob, x: randomInt(0, mapSize.x - 1), y: randomInt(0, mapSize.y - 1)}
            if (hasSuchCoord(units1, unit) || hasSuchCoord(units2, unit)) {
                continue
            }
            units_arrays[k].push(unit)
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: !gameSettings.testAI,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}


function generateTinyMapLegacy() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        return generateTinyMapLegacy()
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}



function generateTinyMapLessHP() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        noob2 = []
    }
    else {
        noob2[0]['hp'] = 1
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyMapOnlyRed() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [],
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyOnlyBlue() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: []
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}],
                ai: true
            }
        ],
        [],
        [],
        [])
}
