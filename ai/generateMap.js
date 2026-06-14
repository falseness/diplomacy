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
const ECONOMY_GENERATOR_STAGE_1_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_1_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_2_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_2_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_3_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_3_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_4_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_4_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_5_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_5_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_6_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_6_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_7_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_7_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_8_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_8_HP_MAX = 5

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

function generateEconomyStage1TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 7, y: 5}
    let leftTown = {x: 1, y: 2}
    let rightTown = {x: 5, y: 2}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_1_HP_MIN,
        ECONOMY_GENERATOR_STAGE_1_HP_MAX)
    let leftBuilding = {x: 2, y: 2, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 4, y: 2, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 1},
        {x: 1, y: 3},
        {x: 2, y: 2}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 5, y: 1},
        {x: 5, y: 3},
        {x: 4, y: 2}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [leftTown],
            units: [
                {type: Noob, x: 2, y: 1},
                {type: Noob, x: 2, y: 3}
            ],
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 2}, {x: 2, y: 0}, {x: 2, y: 4}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [rightTown],
            units: [
                {type: Noob, x: 4, y: 1},
                {type: Noob, x: 4, y: 3}
            ],
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 6, y: 2}, {x: 4, y: 0}, {x: 4, y: 4}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-1-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 40
    map.economyStage = 1
    map.economyGenerator = {
        stage: 1,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_1_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_1_HP_MAX
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage2TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 7}
    let leftTown = {x: 1, y: 3}
    let rightTown = {x: 7, y: 3}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_2_HP_MIN,
        ECONOMY_GENERATOR_STAGE_2_HP_MAX)
    let leftBuilding = {x: 3, y: 3, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 5, y: 3, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 2},
        {x: 1, y: 4},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 3, y: 3}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 6, y: 2},
        {x: 6, y: 3},
        {x: 6, y: 4},
        {x: 5, y: 3}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 110,
            towns: [leftTown],
            units: [
                {type: Noob, x: 2, y: 2},
                {type: Noob, x: 2, y: 4}
            ],
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 3}, {x: 3, y: 2}, {x: 3, y: 4}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 110,
            towns: [rightTown],
            units: [
                {type: Noob, x: 6, y: 2},
                {type: Noob, x: 6, y: 4}
            ],
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 3}, {x: 5, y: 2}, {x: 5, y: 4}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-2-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 50
    map.economyStage = 2
    map.economyGenerator = {
        stage: 2,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_2_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_2_HP_MAX
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 220,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage3TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_3_HP_MIN,
        ECONOMY_GENERATOR_STAGE_3_HP_MAX)
    let leftBuilding = {x: 4, y: 4, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 6, y: 4, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 4}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 4}
    ]
    let leftUnits = [
        {type: Noob, x: 3, y: 2},
        {type: Noob, x: 3, y: 4},
        {type: Noob, x: 3, y: 6},
        {type: Noob, x: 4, y: 3}
    ]
    let rightUnits = [
        {type: Noob, x: 7, y: 2},
        {type: Noob, x: 7, y: 4},
        {type: Noob, x: 7, y: 6},
        {type: Noob, x: 6, y: 3}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 130,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 130,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 2}, {x: 6, y: 6}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-3-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 60
    map.economyStage = 3
    map.economyGenerator = {
        stage: 3,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_3_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_3_HP_MAX,
        noobsPerPlayer: leftUnits.length
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 260,
        noobs: leftUnits.length + rightUnits.length,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage4TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        ECONOMY_GENERATOR_STAGE_4_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        ECONOMY_GENERATOR_STAGE_4_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftUnits = [
        {type: Noob, x: 3, y: 2},
        {type: Noob, x: 3, y: 4},
        {type: Noob, x: 3, y: 6},
        {type: Noob, x: 4, y: 2}
    ]
    let rightUnits = [
        {type: Noob, x: 7, y: 2},
        {type: Noob, x: 7, y: 4},
        {type: Noob, x: 7, y: 6},
        {type: Noob, x: 6, y: 2}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-4-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 4
    map.economyGenerator = {
        stage: 4,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_4_HP_MAX,
        noobsPerPlayer: leftUnits.length,
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: leftUnits.length + rightUnits.length,
        towers: 2,
        bastions: 2
    }
    return map
}

function stage5UnitsFromCoords(coords, archerIndexes) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({
            type: archerIndexes[i] === true ? Archer : Noob,
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function stage6UnitsFromCoords(coords, archerIndexes, catapultIndexes) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let type = Noob
        if (catapultIndexes[i] === true) {
            type = Catapult
        }
        else if (archerIndexes[i] === true) {
            type = Archer
        }
        units.push({
            type: type,
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function stage7UnitsFromCoords(coords, offset) {
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({
            type: unitTypes[(offset + i) % unitTypes.length],
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function generateEconomyStage5TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        ECONOMY_GENERATOR_STAGE_5_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        ECONOMY_GENERATOR_STAGE_5_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftCoords = [
        {x: 3, y: 2},
        {x: 3, y: 4},
        {x: 3, y: 6},
        {x: 4, y: 2}
    ]
    let rightCoords = [
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 7, y: 6},
        {x: 6, y: 2}
    ]
    let archerCount = randomIntWithRng(rng, 0, 9999) % 2 + 1
    let archerIndexes = {}
    while (Object.keys(archerIndexes).length < archerCount) {
        archerIndexes[randomIntWithRng(rng, 0, leftCoords.length - 1)] = true
    }
    let leftUnits = stage5UnitsFromCoords(leftCoords, archerIndexes)
    let rightUnits = stage5UnitsFromCoords(rightCoords, archerIndexes)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-5-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 5
    map.economyGenerator = {
        stage: 5,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_5_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: leftUnits.length - archerCount,
        archersPerPlayer: archerCount,
        archerRatio: archerCount + '/' + leftUnits.length,
        archerIndexes: Object.keys(archerIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: (leftUnits.length - archerCount) + (rightUnits.length - archerCount),
        archers: archerCount * 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage6TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        ECONOMY_GENERATOR_STAGE_6_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        ECONOMY_GENERATOR_STAGE_6_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftCoords = [
        {x: 3, y: 2},
        {x: 3, y: 4},
        {x: 3, y: 6},
        {x: 4, y: 2}
    ]
    let rightCoords = [
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 7, y: 6},
        {x: 6, y: 2}
    ]
    let archerCount = randomIntWithRng(rng, 0, 9999) % 2 + 1
    let catapultCount = 1
    let archerIndexes = {}
    while (Object.keys(archerIndexes).length < archerCount) {
        archerIndexes[randomIntWithRng(rng, 0, leftCoords.length - 1)] = true
    }
    let catapultIndexes = {}
    while (Object.keys(catapultIndexes).length < catapultCount) {
        let index = randomIntWithRng(rng, 0, leftCoords.length - 1)
        if (archerIndexes[index] !== true) {
            catapultIndexes[index] = true
        }
    }
    let leftUnits = stage6UnitsFromCoords(leftCoords, archerIndexes, catapultIndexes)
    let rightUnits = stage6UnitsFromCoords(rightCoords, archerIndexes, catapultIndexes)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-6-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 6
    map.economyGenerator = {
        stage: 6,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_6_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: leftUnits.length - archerCount - catapultCount,
        archersPerPlayer: archerCount,
        catapultsPerPlayer: catapultCount,
        archerRatio: archerCount + '/' + leftUnits.length,
        catapultRatio: catapultCount + '/' + leftUnits.length,
        archerIndexes: Object.keys(archerIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        catapultIndexes: Object.keys(catapultIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: (leftUnits.length - archerCount - catapultCount) +
            (rightUnits.length - archerCount - catapultCount),
        archers: archerCount * 2,
        catapults: catapultCount * 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage7TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 7, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        ECONOMY_GENERATOR_STAGE_7_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        ECONOMY_GENERATOR_STAGE_7_HP_MAX)
    let leftTower = {x: 3, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 5, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 3, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 5, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 2},
        {x: 6, y: 3},
        {x: 6, y: 4},
        {x: 6, y: 5},
        {x: 6, y: 6},
        {x: 5, y: 3},
        {x: 5, y: 5}
    ]
    let leftCoords = [
        {x: 2, y: 1},
        {x: 2, y: 4},
        {x: 2, y: 7},
        {x: 3, y: 1},
        {x: 3, y: 7}
    ]
    let rightCoords = [
        {x: 6, y: 1},
        {x: 6, y: 4},
        {x: 6, y: 7},
        {x: 5, y: 1},
        {x: 5, y: 7}
    ]
    let unitTypeOffset = randomIntWithRng(rng, 0, 4)
    let leftUnits = stage7UnitsFromCoords(leftCoords, unitTypeOffset)
    let rightUnits = stage7UnitsFromCoords(rightCoords, unitTypeOffset)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 160,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 160,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-7-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 80
    map.economyStage = 7
    map.economyGenerator = {
        stage: 7,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_7_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: 1,
        archersPerPlayer: 1,
        KOHbsPerPlayer: 1,
        normchelsPerPlayer: 1,
        catapultsPerPlayer: 1,
        unitTypes: ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'],
        unitTypeOffset: unitTypeOffset,
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 320,
        noobs: 2,
        archers: 2,
        KOHbs: 2,
        normchels: 2,
        catapults: 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage8TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let map = generateEconomyStage7TrainingMap(options)
    let rng = createSeededRandom(seed)
    rng()
    rng()
    rng()
    let upperLane = rng() < 0.5
    let lowerLane = rng() < 0.5
    let mapSize = map.mapSize
    let mountainY = upperLane ? 1 : 7
    let lakeY = lowerLane ? 1 : 7
    let bushY = upperLane ? 2 : 6

    map.lakes = [
        {x: 4, y: lakeY}
    ]
    map.mountains = [
        {x: 0, y: mountainY},
        {x: mapSize.x - 1, y: mountainY}
    ]
    map.bushes = [
        {x: 0, y: bushY},
        {x: mapSize.x - 1, y: bushY}
    ]
    map.testName = 'economy-stage-8-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 90
    map.economyStage = 8
    map.economyGenerator = Object.assign({}, map.economyGenerator, {
        stage: 8,
        seed: seed,
        terrainTypes: ['mountain', 'bush', 'lake'],
        terrainCounts: {
            mountains: map.mountains.length,
            bushes: map.bushes.length,
            lakes: map.lakes.length
        },
        terrainSymmetry: {
            axis: 'vertical',
            mirror: 'x',
            fairForBothSides: true
        },
        stage7RequirementsPreserved: true,
        hpMin: ECONOMY_GENERATOR_STAGE_8_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_8_HP_MAX
    })
    return map
}

function generateAdvancedEconomyStage1TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let mapSize = {x: 3, y: 3}
    let redTown = {x: 1, y: 0}
    let blueTown = {x: 1, y: 2}
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-1-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 40
    map.economyStage = 'advanced-1'
    map.advancedEconomyStage = 1
    map.economyGenerator = {
        stage: 'advanced-1',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'vertical-mirror',
        townCount: 2,
        emptyMap: true
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0
    }
    return map
}

function generateSymmetricalEconomy9v9AllUnitMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 7, y: 4}
    let towerHp = randomIntWithRng(rng, 2, 5)
    let bastionHp = randomIntWithRng(rng, 2, 5)
    let noobHp = randomIntWithRng(rng, 1, 2)
    let kohbHp = randomIntWithRng(rng, 1, 3)
    let normchelHp = randomIntWithRng(rng, 1, 5)
    let unitTypeOffset = randomIntWithRng(rng, 0, 4)
    let leftCoords = [
        {x: 2, y: 1},
        {x: 2, y: 4},
        {x: 2, y: 7},
        {x: 3, y: 1},
        {x: 3, y: 7}
    ]
    let rightCoords = leftCoords.map(function(coord) {
        return mirrorXCoord(coord, mapSize)
    })
    let leftUnits = stage7UnitsFromCoords(leftCoords, unitTypeOffset)
    let rightUnits = stage7UnitsFromCoords(rightCoords, unitTypeOffset)
    let hpByUnitType = {
        Noob: noobHp,
        Archer: 1,
        KOHb: kohbHp,
        Normchel: normchelHp,
        Catapult: 1
    }
    for (let i = 0; i < leftUnits.length; ++i) {
        let unitName = leftUnits[i].type.name
        leftUnits[i].hp = hpByUnitType[unitName]
        rightUnits[i].hp = hpByUnitType[unitName]
    }
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5}
    ]
    let rightSuburbCells = leftSuburbCells.map(function(coord) {
        return mirrorXCoord(coord, mapSize)
    })
    let leftTower = {x: 3, y: 3, town: leftTown, hp: towerHp}
    let leftBastion = {x: 3, y: 5, town: leftTown, hp: bastionHp}
    let rightTower = Object.assign(
        {town: rightTown, hp: towerHp},
        mirrorXCoord(leftTower, mapSize))
    let rightBastion = Object.assign(
        {town: rightTown, hp: bastionHp},
        mirrorXCoord(leftBastion, mapSize))
    let leftFarm = {x: 1, y: 3, town: leftTown}
    let leftBarrack = {x: 1, y: 5, town: leftTown}
    let rightFarm = Object.assign(
        {town: rightTown},
        mirrorXCoord(leftFarm, mapSize))
    let rightBarrack = Object.assign(
        {town: rightTown},
        mirrorXCoord(leftBarrack, mapSize))
    let goldmineIncome = randomIntWithRng(rng, 20, 40)
    let neutralGoldmineIncome = randomIntWithRng(rng, 20, 40)
    let goldmines = [
        {x: 0, y: 4, income: goldmineIncome, owner: 1},
        {x: 8, y: 4, income: goldmineIncome, owner: 2},
        {x: 4, y: 8, income: neutralGoldmineIncome, owner: 0}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 180,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 3}, {x: 0, y: 5}, {x: 4, y: 4}]
            }],
            farms: [leftFarm],
            barracks: [leftBarrack],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 180,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 3}, {x: 8, y: 5}, {x: 4, y: 4}]
            }],
            farms: [rightFarm],
            barracks: [rightBarrack],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let lakes = [{x: 4, y: 0}]
    let mountains = [{x: 0, y: 1}, {x: 8, y: 1}]
    let bushes = [{x: 0, y: 7}, {x: 8, y: 7}]
    let hills = [{x: 4, y: 2}, {x: 4, y: 6}]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        goldmines,
        lakes,
        mountains,
        bushes,
        hills)
    map.testName = 'symmetrical-economy-9v9-all-unit-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 120
    map.economyStage = 'symmetrical-9v9-all-unit'
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        benchmarkSpecificAdvantage: false
    }
    map.economyGenerator = {
        name: 'symmetrical-economy-9v9-all-unit',
        seed: seed,
        mapSize: mapSize,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        unitTypes: ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'],
        unitTypeOffset: unitTypeOffset,
        unitsPerPlayer: leftUnits.length,
        buildingTypes: ['farm', 'barrack', 'tower', 'bastion'],
        hpByType: Object.assign({}, hpByUnitType, {
            tower: towerHp,
            bastion: bastionHp
        }),
        goldmineIncome: goldmineIncome,
        neutralGoldmineIncome: neutralGoldmineIncome,
        startingGold: 180,
        terrainTypes: ['lake', 'mountain', 'bush', 'hill'],
        benchmarkSpecificAdvantage: false
    }
    map.economyObjects = {
        farms: 2,
        barracks: 2,
        goldmines: goldmines.length,
        towns: 2,
        productionActions: 0,
        resources: 360,
        noobs: 2,
        archers: 2,
        KOHbs: 2,
        normchels: 2,
        catapults: 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateCombatStageATrainingMap(options) {
    options = options || {}
    let rng = createSeededRandom(options.seed || 1)
    let mirrored = rng() >= 0.5
    let firstUnit = mirrored ? {x: 0, y: 1} : {x: 0, y: 0}
    let secondUnit = mirrored ? {x: 1, y: 0} : {x: 1, y: 1}
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        {x: 2, y: 2},
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 0
    map.combatStage = 'A'
    map.combatOnly = true
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function clampCombatProgress(progress) {
    if (!Number.isFinite(progress)) {
        return 0
    }
    return Math.max(0, Math.min(1, progress))
}

function coordInList(coords, coord) {
    for (let i = 0; i < coords.length; ++i) {
        if (coords[i].x == coord.x && coords[i].y == coord.y) {
            return true
        }
    }
    return false
}

function stageBPlayableCells(mapSize, progress) {
    let cells = []
    let centerY = Math.floor(mapSize.y / 2)
    let maxWidth = Math.max(1, Math.floor(1 + progress * 3))
    for (let x = 0; x < mapSize.x; ++x) {
        let wave = x % 3 == 0 ? -1 : (x % 3 == 1 ? 0 : 1)
        let center = Math.max(0, Math.min(mapSize.y - 1, centerY + wave))
        for (let y = 0; y < mapSize.y; ++y) {
            if (Math.abs(y - center) <= maxWidth - 1) {
                cells.push({x: x, y: y})
            }
        }
    }
    return cells
}

function generateCombatStageBTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let maxBound = options.maxBound || 9
    let bound = Math.min(9, Math.max(3,
        Math.floor(3 + progress * (maxBound - 3))))
    let mapSize = {x: bound, y: bound}
    let playable = stageBPlayableCells(mapSize, progress)
    let firstUnit = playable[0]
    let secondUnit = playable[playable.length - 1]
    if (rng() >= 0.5) {
        firstUnit = playable[playable.length - 1]
        secondUnit = playable[0]
    }
    let lakes = []
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            let coord = {x: x, y: y}
            if (!coordInList(playable, coord)) {
                lakes.push(coord)
            }
        }
    }
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        [])
    map.suddenDeathRound = 0
    map.combatStage = 'B'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.floodedCellCount = lakes.length
    map.playableCellCount = playable.length
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function stageCPlayableCells(mapSize, progress) {
    let cells = []
    let center = {
        x: Math.floor(mapSize.x / 2),
        y: Math.floor(mapSize.y / 2)
    }
    let maxDistance = Math.max(mapSize.x, mapSize.y)
    let playableRadius = Math.max(1,
        Math.floor(2 + progress * (maxDistance - 1)))
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            if (Math.abs(x - center.x) + Math.abs(y - center.y) <=
                    playableRadius) {
                cells.push({x: x, y: y})
            }
        }
    }
    return cells
}

function generateCombatStageCTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(3, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let playable = stageCPlayableCells(mapSize, progress)
    let firstUnit = playable[0]
    let secondUnit = playable[playable.length - 1]
    if (rng() >= 0.5) {
        firstUnit = playable[playable.length - 1]
        secondUnit = playable[0]
    }
    let lakes = []
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            let coord = {x: x, y: y}
            if (!coordInList(playable, coord)) {
                lakes.push(coord)
            }
        }
    }
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        [])
    map.suddenDeathRound = Math.max(0, Math.round(progress * 10))
    map.combatStage = 'C'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.floodedCellCount = lakes.length
    map.playableCellCount = playable.length
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function stageDNoobCounts(progress, rng) {
    let strongerCount = Math.min(4, Math.max(2,
        2 + Math.floor(clampCombatProgress(progress) * 3)))
    let weakerCount = Math.max(1, strongerCount - 1)
    if (rng() >= 0.5) {
        return {playerOne: strongerCount, playerTwo: weakerCount}
    }
    return {playerOne: weakerCount, playerTwo: strongerCount}
}

function stageDUnitCoords(mapSize, fromRight, count, rng) {
    let centerY = Math.floor(mapSize.y / 2)
    let x = fromRight ? mapSize.x - 2 : 1
    let offsets = [0, -1, 1, -2]
    if (rng() >= 0.5) {
        offsets = [0, 1, -1, 2]
    }
    let coords = []
    for (let i = 0; i < count; ++i) {
        coords.push({
            x: x,
            y: Math.max(0, Math.min(mapSize.y - 1, centerY + offsets[i]))
        })
    }
    return coords
}

function noobUnitsFromCoords(coords) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({type: Noob, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageDGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 4) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 4 ||
                history[i].advancedToStage == 'combat-stage-4' ||
                history[i].advancedToStage == 'combat-stage-E') {
            return true
        }
    }
    return false
}

function requireStageDGateForStageE(options) {
    if (!stageDGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage E is unavailable until the Stage D gate has passed')
    }
}

function stageEGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 5) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 5 ||
                history[i].advancedToStage == 'combat-stage-5' ||
                history[i].advancedToStage == 'combat-stage-F') {
            return true
        }
    }
    return false
}

function requireStageEGateForStageF(options) {
    if (!stageEGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage F is unavailable until the Stage E gate has passed')
    }
}

function stageFGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 6) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 6 ||
                history[i].advancedToStage == 'combat-stage-6' ||
                history[i].advancedToStage == 'combat-stage-G') {
            return true
        }
    }
    return false
}

function requireStageFGateForStageG(options) {
    if (!stageFGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage G is unavailable until the Stage F gate has passed')
    }
}

function stageEUnitsFromCoords(coords, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = useNormchel && i == 0 ? Normchel : Noob
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageFUnitsFromCoords(coords, useKOHb, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = Noob
        if (useKOHb && i == 0) {
            unitType = KOHb
        } else if (useNormchel && i == 1) {
            unitType = Normchel
        }
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageGUnitsFromCoords(coords, useArcher, useKOHb, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = Noob
        if (useArcher && i == 0) {
            unitType = Archer
        } else if (useKOHb && i == 1) {
            unitType = KOHb
        } else if (useNormchel && i == 2) {
            unitType = Normchel
        }
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function mirrorXCoord(coord, mapSize) {
    let mirrored = {x: mapSize.x - 1 - coord.x, y: coord.y}
    if ('hp' in coord) {
        mirrored.hp = coord.hp
    }
    if ('turns' in coord) {
        mirrored.turns = coord.turns
    }
    if ('income' in coord) {
        mirrored.income = coord.income
    }
    if ('owner' in coord) {
        mirrored.owner = coord.owner
    }
    return mirrored
}

function mirrorConfiguredUnit(unit, mapSize) {
    let mirrored = mirrorXCoord(unit, mapSize)
    mirrored.type = unit.type
    return mirrored
}

function mirrorConfiguredBuilding(building, mapSize) {
    let mirrored = mirrorXCoord(building, mapSize)
    mirrored.town = mirrorXCoord(building.town, mapSize)
    return mirrored
}

function countUnitsByType(units, unitType) {
    return units.filter(function(unit) {
        return unit.type == unitType
    }).length
}

function generateSymmetricalCombatStageGMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {
        x: options.width || 11,
        y: options.height || 9
    }
    if (mapSize.x < 9 || mapSize.y < 7 || mapSize.x % 2 == 0) {
        throw new Error('Symmetrical combat Stage G maps require odd width >= 9 and height >= 7')
    }

    let centerX = Math.floor(mapSize.x / 2)
    let centerY = Math.floor(mapSize.y / 2)
    let leftTown = {x: 1, y: centerY, hp: 10}
    let rightTown = mirrorXCoord(leftTown, mapSize)
    let hpOffset = randomIntWithRng(rng, 0, 1)
    let leftUnits = [
        {type: Noob, x: 2, y: centerY - 2, hp: 2},
        {type: Normchel, x: 2, y: centerY, hp: 4 + hpOffset},
        {type: KOHb, x: 2, y: centerY + 2, hp: 2 + hpOffset},
        {type: Archer, x: 3, y: centerY - 1, hp: 1},
        {type: Catapult, x: 3, y: centerY + 1, hp: 1}
    ]
    let leftWalls = [
        {x: 1, y: centerY - 1, hp: 3 + hpOffset, town: leftTown},
        {x: 1, y: centerY + 1, hp: 4, town: leftTown}
    ]
    let leftBastions = [
        {x: 2, y: centerY - 1, hp: 4 + hpOffset, town: leftTown}
    ]
    let leftTowers = [
        {x: 2, y: centerY + 1, hp: 5 - hpOffset, town: leftTown}
    ]
    let leftSuburbCells = [leftTown]
        .concat(leftWalls)
        .concat(leftBastions)
        .concat(leftTowers)
        .map(function(coord) {
            return {x: coord.x, y: coord.y}
        })
    let rightUnits = leftUnits.map(function(unit) {
        return mirrorConfiguredUnit(unit, mapSize)
    })
    let rightWalls = leftWalls.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let rightBastions = leftBastions.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let rightTowers = leftTowers.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let mirroredTerrainPairs = [
        {x: centerX - 1, y: centerY - 3},
        {x: centerX - 1, y: centerY + 3}
    ]
    let mountains = mirroredTerrainPairs
        .concat(mirroredTerrainPairs.map(function(coord) {
            return mirrorXCoord(coord, mapSize)
        }))
    let lakes = [
        {x: centerX, y: centerY - 1},
        {x: centerX, y: centerY + 1}
    ]
    let bushes = [
        {x: centerX - 2, y: centerY},
        {x: centerX + 2, y: centerY}
    ]
    let hills = [
        {x: centerX - 1, y: centerY},
        {x: centerX + 1, y: centerY}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayer',
            ai: true,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: []
            }],
            walls: leftWalls,
            bastions: leftBastions,
            towers: leftTowers
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayer',
            ai: true,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: leftSuburbCells.map(function(coord) {
                    return mirrorXCoord(coord, mapSize)
                }),
                expansionCells: []
            }],
            walls: rightWalls,
            bastions: rightBastions,
            towers: rightTowers
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        mountains,
        bushes,
        hills)
    map.testName = 'symmetrical-combat-stage-g-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 24
    map.combatStage = 'G-symmetrical-final'
    map.combatOnly = true
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayer',
        playerTwo: 'SimpleAiPlayer'
    }
    map.playerNoobCounts = {
        playerOne: countUnitsByType(leftUnits, Noob),
        playerTwo: countUnitsByType(rightUnits, Noob)
    }
    map.playerNormchelCounts = {
        playerOne: countUnitsByType(leftUnits, Normchel),
        playerTwo: countUnitsByType(rightUnits, Normchel)
    }
    map.playerKOHbCounts = {
        playerOne: countUnitsByType(leftUnits, KOHb),
        playerTwo: countUnitsByType(rightUnits, KOHb)
    }
    map.playerArcherCounts = {
        playerOne: countUnitsByType(leftUnits, Archer),
        playerTwo: countUnitsByType(rightUnits, Archer)
    }
    map.playerCatapultCounts = {
        playerOne: countUnitsByType(leftUnits, Catapult),
        playerTwo: countUnitsByType(rightUnits, Catapult)
    }
    map.combatMetrics = {
        finalSymmetricalCombatStage: true,
        unitTypes: ['Noob', 'Normchel', 'KOHb', 'Archer', 'Catapult'],
        mirroredBuildings: ['wall', 'bastion', 'tower'],
        mirroredTerrain: ['lake', 'mountain', 'bush', 'hill'],
        benchmarkPassFailLogic: false
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageDTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: noobUnitsFromCoords(playerOneCoords)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: noobUnitsFromCoords(playerTwoCoords)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'D'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: counts.playerOne,
        playerTwo: counts.playerTwo
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageETrainingMap(options) {
    options = options || {}
    requireStageDGateForStageE(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let normchelPlayer = rng() >= 0.5 ? 1 : 2
    let includeNormchel = progress >= 0.25 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageEUnitsFromCoords(
                playerOneCoords, includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageEUnitsFromCoords(
                playerTwoCoords, includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'E'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'Normchel',
        unlockedUnitType: 'Normchel',
        blockedUnitTypes: ['Archer', 'KOHb']
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageFTrainingMap(options) {
    options = options || {}
    requireStageEGateForStageF(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let KOHbPlayer = rng() >= 0.5 ? 1 : 2
    let normchelPlayer = KOHbPlayer == 1 ? 2 : 1
    let includeKOHb = progress >= 0.25 || rng() >= 0.5
    let includeNormchel = progress >= 0.5 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageFUnitsFromCoords(
                playerOneCoords,
                includeKOHb && KOHbPlayer == 1,
                includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageFUnitsFromCoords(
                playerTwoCoords,
                includeKOHb && KOHbPlayer == 2,
                includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'F'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.playerKOHbCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == KOHb
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == KOHb
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'KOHb',
        unlockedUnitType: 'KOHb',
        previouslyUnlockedUnitTypes: ['Noob', 'Normchel'],
        blockedUnitTypes: ['Archer']
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageGTrainingMap(options) {
    options = options || {}
    requireStageFGateForStageG(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let archerPlayer = rng() >= 0.5 ? 1 : 2
    let KOHbPlayer = archerPlayer == 1 ? 2 : 1
    let normchelPlayer = rng() >= 0.5 ? 1 : 2
    let includeArcher = progress >= 0.25 || rng() >= 0.5
    let includeKOHb = progress >= 0.4 || rng() >= 0.5
    let includeNormchel = progress >= 0.6 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageGUnitsFromCoords(
                playerOneCoords,
                includeArcher && archerPlayer == 1,
                includeKOHb && KOHbPlayer == 1,
                includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageGUnitsFromCoords(
                playerTwoCoords,
                includeArcher && archerPlayer == 2,
                includeKOHb && KOHbPlayer == 2,
                includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'G'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.playerKOHbCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == KOHb
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == KOHb
        }).length
    }
    map.playerArcherCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Archer
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Archer
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'Archer',
        unlockedUnitType: 'Archer',
        previouslyUnlockedUnitTypes: ['Noob', 'Normchel', 'KOHb'],
        actionEnumerationMechanics: [
            'Archer range attacks',
            'Archer line-of-sight checks'
        ],
        archerRange: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
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

function generateBrowserPlayAiCombatMap() {
    let mapSize = {x: 9, y: 9}
    let unitTypes = [Noob, Normchel, KOHb, Archer, Catapult]
    let humanUnits = []
    let aiUnits = []

    for (let i = 0; i < unitTypes.length; ++i) {
        humanUnits.push({
            type: unitTypes[i],
            x: 2 + i,
            y: 1
        })
        aiUnits.push({
            type: unitTypes[i],
            x: 2 + i,
            y: mapSize.y - 2
        })
    }

    let map = new GameMap(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                units: humanUnits
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'AIPlayer',
                towns: [],
                units: aiUnits
            }
        ],
        [],
        [],
        [])
    map.playAiMode = 'browser-combat-playtest'
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    map.requiredCombatUnitTypes = [
        'Noob',
        'Normchel',
        'KOHb',
        'Archer',
        'Catapult'
    ]
    return map
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
