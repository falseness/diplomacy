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
        tiny: {mapSize: {x: 7, y: 7}, neutralTowns: 1, extraUnitsPerPlayer: 1, blockers: 2, minTownDistance: 2, barrackDensity: 0.15, farmDensity: 0.2, externalDensity: 0.15, suburbDensity: 1, suburbDistance: 1, goldmines: 3},
        medium: {mapSize: {x: 13, y: 13}, neutralTowns: 2, extraUnitsPerPlayer: 2, blockers: 8, minTownDistance: 3, barrackDensity: 0.2, farmDensity: 0.3, externalDensity: 0.25, suburbDensity: 1, suburbDistance: 1, goldmines: 5},
        big: {mapSize: {x: 21, y: 21}, neutralTowns: 4, extraUnitsPerPlayer: 4, blockers: 18, minTownDistance: 4, barrackDensity: 0.25, farmDensity: 0.4, externalDensity: 0.35, suburbDensity: 1, suburbDistance: 1, goldmines: 8}
    }
    return configs[size] || configs.tiny
}

const GOLDMINE_TRAINING_INCOME_MIN = 20
const GOLDMINE_TRAINING_INCOME_MAX = 100
const GOLDMINE_TRAINING_STARTING_GOLD_MIN = 50
const GOLDMINE_TRAINING_STARTING_GOLD_MAX = 500

function townDistance(a, b) {
    let dx = a.x - b.x
    let dy = a.y - b.y
    return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx + dy))
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

function isCoordInsideMap(coord, mapSize) {
    return coord.x >= 0 && coord.y >= 0 &&
        coord.x < mapSize.x && coord.y < mapSize.y
}

function generateSuburbLayout(rng, mapSize, town, density, maxDistance, claimed) {
    let cells = [{x: town.x, y: town.y}]
    let selected = {}
    selected[coordKey(town)] = true
    claimed[coordKey(town)] = true
    let frontier = [town]

    if (density == 1 && maxDistance == 1) {
        let neighbours = townNeighbourCoords(town)
        for (let i = 0; i < neighbours.length; ++i) {
            let coord = neighbours[i]
            let key = coordKey(coord)
            if (isCoordInsideMap(coord, mapSize) && !claimed[key]) {
                claimed[key] = true
                selected[key] = true
                cells.push(coord)
            }
        }
        frontier = []
    }

    while (frontier.length) {
        let source = frontier.shift()
        let candidates = townNeighbourCoords(source)
        let offset = randomIntWithRng(rng, 0, candidates.length - 1)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[(offset + i) % candidates.length]
            let key = coordKey(coord)
            if (!isCoordInsideMap(coord, mapSize) || selected[key] || claimed[key] ||
                townDistance(coord, town) > maxDistance) {
                continue
            }
            selected[key] = true
            if (rng() >= density) {
                continue
            }
            claimed[key] = true
            cells.push(coord)
            frontier.push(coord)
        }
    }

    if (cells.length == 1) {
        let neighbours = townNeighbourCoords(town).filter(function(coord) {
            return isCoordInsideMap(coord, mapSize) && !claimed[coordKey(coord)]
        })
        if (neighbours.length) {
            let coord = neighbours[randomIntWithRng(rng, 0, neighbours.length - 1)]
            claimed[coordKey(coord)] = true
            cells.push(coord)
        }
    }

    let expansionCells = []
    let expansionSeen = {}
    for (let i = 0; i < cells.length; ++i) {
        let neighbours = townNeighbourCoords(cells[i])
        for (let j = 0; j < neighbours.length; ++j) {
            let coord = neighbours[j]
            let key = coordKey(coord)
            if (!isCoordInsideMap(coord, mapSize) || claimed[key] || expansionSeen[key]) {
                continue
            }
            expansionSeen[key] = true
            expansionCells.push(coord)
        }
    }
    return {
        town: {x: town.x, y: town.y},
        cells: cells,
        expansionCells: expansionCells
    }
}

function generateSuburbLayouts(rng, mapSize, towns, density, maxDistance, claimed) {
    let layouts = []
    for (let i = 0; i < towns.length; ++i) {
        layouts.push(generateSuburbLayout(
            rng, mapSize, towns[i], density, maxDistance, claimed))
    }
    return layouts
}

function configuredSuburbKeys(layouts) {
    let result = {}
    for (let i = 0; i < layouts.length; ++i) {
        for (let j = 0; j < layouts[i].cells.length; ++j) {
            result[coordKey(layouts[i].cells[j])] = true
        }
    }
    return result
}

function reserveSuburbExpansionCells(layouts, claimed, used) {
    for (let i = 0; i < layouts.length; ++i) {
        layouts[i].expansionCells = layouts[i].expansionCells.filter(function(coord) {
            let key = coordKey(coord)
            if (claimed[key]) {
                return false
            }
            claimed[key] = true
            markCoordKey(used, coord)
            return true
        })
    }
}

function generateBarrackScenarios(rng, mapSize, used, towns, density, pendingProbability, suburbs) {
    let barracks = []
    let pendingBarracks = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
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

function generateFarmScenarios(rng, mapSize, used, towns, density, pendingProbability, suburbs) {
    let farms = []
    let pendingFarms = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
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

function generateExternalScenarios(rng, mapSize, used, towns, density, suburbs) {
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
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
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

function generateGoldmineScenarios(rng, mapSize, used, count, incomeMin, incomeMax, maxOwner) {
    let goldmines = []
    for (let i = 0; i < count; ++i) {
        let coord = pickCoord(rng, mapSize, used)
        goldmines.push({
            x: coord.x,
            y: coord.y,
            income: randomIntWithRng(rng, incomeMin, incomeMax),
            owner: i <= maxOwner ? i : randomIntWithRng(rng, 0, maxOwner)
        })
    }
    return goldmines
}

function trainingPlayerColor(playerIndex) {
    let colors = [
        {r: 255, g: 0, b: 0},
        {r: 98, g: 168, b: 222},
        {r: 60, g: 190, b: 100},
        {r: 230, g: 170, b: 40}
    ]
    return colors[(playerIndex - 1) % colors.length]
}

function generateTownTrainingMap(options) {
    options = options || {}
    let config = townTrainingSizeConfig(options.size || 'tiny')
    let rng = createSeededRandom(options.seed || 1)
    let playerCount = boundedInteger(options.playerCount, 2, 2, 4)
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
    let suburbDensity = clampProbability(options.suburbDensity, config.suburbDensity)
    let suburbDistance = boundedInteger(
        options.suburbDistance, config.suburbDistance, 1, 8)
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
    let suburbTownDistance = Math.max(
        config.minTownDistance, suburbDistance * 2 + 1)

    let neutralTowns = []
    let playerTowns = []

    for (let playerIndex = 1; playerIndex <= playerCount; ++playerIndex) {
        playerTowns.push([placeTown(rng, mapSize, used, allTowns, suburbTownDistance)])
    }
    for (let i = 0; i < config.neutralTowns; ++i) {
        neutralTowns.push(placeTown(rng, mapSize, used, allTowns, suburbTownDistance))
    }

    let claimedSuburbs = {}
    for (let i = 0; i < allTowns.length; ++i) {
        claimedSuburbs[coordKey(allTowns[i])] = true
    }
    let playerSuburbs = []
    for (let playerIndex = 0; playerIndex < playerTowns.length; ++playerIndex) {
        delete claimedSuburbs[coordKey(playerTowns[playerIndex][0])]
        playerSuburbs.push(generateSuburbLayouts(
            rng, mapSize, playerTowns[playerIndex], suburbDensity, suburbDistance,
            claimedSuburbs))
    }
    for (let playerIndex = 0; playerIndex < playerSuburbs.length; ++playerIndex) {
        reserveSuburbExpansionCells(playerSuburbs[playerIndex], claimedSuburbs, used)
    }
    let playerSuburbKeys = playerSuburbs.map(function(suburbs) {
        return configuredSuburbKeys(suburbs)
    })

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

    let playerScenarios = []
    for (let playerIndex = 0; playerIndex < playerTowns.length; ++playerIndex) {
        let units = []
        let unitTypes = createUnitComposition(rng, unitsPerPlayer, unitComposition)
        for (let i = 0; i < unitsPerPlayer; ++i) {
            units.push(placeUnitNearTown(
                rng, mapSize, used, playerTowns[playerIndex][0], unitTypes[i]))
        }
        playerScenarios.push({
            units: units,
            barracks: generateBarrackScenarios(
                rng, mapSize, used, playerTowns[playerIndex], barrackDensity,
                pendingBarrackProbability, playerSuburbKeys[playerIndex]),
            farms: generateFarmScenarios(
                rng, mapSize, used, playerTowns[playerIndex], farmDensity,
                pendingFarmProbability, playerSuburbKeys[playerIndex]),
            external: generateExternalScenarios(
                rng, mapSize, used, playerTowns[playerIndex], externalDensity,
                playerSuburbKeys[playerIndex])
        })
    }
    let generatedGoldmines = generateGoldmineScenarios(
        rng, mapSize, used, goldmineCount, goldmineIncomeMin, goldmineIncomeMax,
        playerCount)

    let generatedPlayers = [{
        rgb: {r: 208, g: 208, b: 208},
        towns: neutralTowns
    }]
    for (let playerIndex = 1; playerIndex <= playerCount; ++playerIndex) {
        let scenario = playerScenarios[playerIndex - 1]
        generatedPlayers.push({
            rgb: trainingPlayerColor(playerIndex),
            gold: randomIntWithRng(rng, startingGoldMin, startingGoldMax),
            towns: playerTowns[playerIndex - 1],
            suburbs: playerSuburbs[playerIndex - 1],
            ai: playerIndex == 1 ? !gameSettings.testAI : true,
            units: scenario.units,
            barracks: scenario.barracks.barracks,
            pendingBarracks: scenario.barracks.pendingBarracks,
            farms: scenario.farms.farms,
            pendingFarms: scenario.farms.pendingFarms,
            walls: scenario.external.walls,
            bastions: scenario.external.bastions,
            towers: scenario.external.towers
        })
    }

    return new GameMap(
        mapSize,
        generatedPlayers,
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
