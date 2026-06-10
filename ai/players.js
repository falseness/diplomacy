const AI_UNIT_PRODUCTS = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
const AI_ECONOMY_ADVANCED_UNIT_THRESHOLD = 6
const AI_ECONOMY_TOWN_THREAT_DISTANCE = 6
const AI_ECONOMY_DEFAULT_ACTION_LIMIT = 30
const AI_ECONOMY_DEFAULT_COMMAND_LIMIT = 60
const AI_ECONOMY_STALEMATE_ACTION_LIMIT = 45
const AI_ECONOMY_MULTI_TOWN_ACTION_LIMIT = 45
const AI_ECONOMY_MULTI_TOWN_THRESHOLD = 2
const AI_ECONOMY_PRE_MOVE_PURCHASE_LIMIT = 6
const AI_ECONOMY_POST_MOVE_PURCHASE_LIMIT = 3
const AI_ECONOMY_NEUTRAL_RACE_DISTANCE = 20
const AI_ECONOMY_TOWN_TARGET_SCORE = 12
const AI_ECONOMY_UNIT_TARGET_SCORE = 4
const AI_ECONOMY_NEUTRAL_TOWN_TARGET_SCORE = 12
const AI_ECONOMY_NEUTRAL_RACE_SCORE = 0.5
const AI_ECONOMY_THREAT_TARGET_SCORE = 90
const AI_ECONOMY_STALEMATE_ROUND = 160
const AI_ECONOMY_STALEMATE_TOWN_TARGET_SCORE = 120
const AI_ECONOMY_STALEMATE_UNIT_TARGET_SCORE = -4
const AI_ECONOMY_TOWN_DEFICIT_TARGET_SCORE = 18
const AI_ECONOMY_TOWN_DEFICIT_NEUTRAL_PENALTY = 6
const AI_ECONOMY_UNIT_ADVANTAGE_TARGET_SCORE = 10
const AI_ECONOMY_UNIT_ADVANTAGE_NEUTRAL_PENALTY = 3
const AI_ECONOMY_UNIT_ADVANTAGE_UNIT_PENALTY = 2

function compareAiTargets(townBonus) {
    return function(left, right) {
        let leftScore = left.distance - (left.kind == 'town' ? townBonus : 0)
        let rightScore = right.distance - (right.kind == 'town' ? townBonus : 0)
        return leftScore - rightScore ||
            left.kind.localeCompare(right.kind) ||
            left.key.localeCompare(right.key)
    }
}

function chooseAiTargetByPriority(targets, townBonus) {
    return targets.slice().sort(compareAiTargets(townBonus))[0]
}

function getAiActionLimit(fallback) {
    if (typeof gameSettings != 'undefined' && gameSettings.aiActionLimit > 0) {
        return gameSettings.aiActionLimit
    }
    return fallback
}

function getAiCommandLimit(fallback) {
    if (typeof gameSettings != 'undefined' && gameSettings.aiCommandLimit > 0) {
        return gameSettings.aiCommandLimit
    }
    return fallback
}

function getAiMoveCommands(unit) {
    if (!unit.getAvailableMoveCommands && unit.getAvailableCommands) {
        return unit.getAvailableCommands()
    }
    return unit.getAvailableMoveCommands()
}

class SimpleAiPlayer extends Player {
    constructor(color, gold = 90) {
        super(color, gold)
        this.bestEnemyTargetForAI = new BestEnemyTargetForAI()
    }
    nextTurn() {
        super.nextTurn()
        this.play()
    }
    findUnitAttackCommand(unit) {
        let commands = unit.getAvailableCommands()
        for (let i = 0; i < commands.length; ++i) {
            let command = commands[i]
            let cell = grid.arr[command.destinationCoord.x] &&
                grid.arr[command.destinationCoord.x][command.destinationCoord.y]
            if (!cell && grid.getCell) {
                cell = grid.getCell(command.destinationCoord)
            }
            if (!cell) {
                continue
            }
            if (unit.canHitSomethingOnCell) {
                if (unit.canHitSomethingOnCell(cell)) {
                    return command
                }
                continue
            }
            let playerIndex = typeof players == 'undefined' ? unit.playerColor :
                players.indexOf(this)
            if (cell.unit && cell.unit.notEmpty && cell.unit.notEmpty() &&
                    cell.unit.playerColor != playerIndex) {
                return command
            }
            if (cell.building && cell.building.notEmpty && cell.building.notEmpty() &&
                    cell.building.playerColor != playerIndex) {
                return command
            }
        }
        return null
    }
    unitDoMoves(unit, remainingActions = Infinity) {
        let usedActions = 0
        while (unit.moves > 0 && usedActions < remainingActions) {
            const movesBefore = unit.moves
            let attackCommand = this.findUnitAttackCommand(unit)
            if (attackCommand) {
                let cell = grid.arr[attackCommand.destinationCoord.x][attackCommand.destinationCoord.y]
                unit.sendInstructions(cell)
                assert(movesBefore - unit.moves > 0)
                ++usedActions
                break
            }
            let command = this.bestEnemyTargetForAI.GetCommandNearestToBestTarget(
                getAiMoveCommands(unit).slice(0, getAiCommandLimit(Infinity)),
                unit.coord, grid.arr, unit.playerColor)
            if (!command) {
                break
            }
            assert(command.whoDoCommandCoord.x == unit.coord.x &&
                command.whoDoCommandCoord.y == unit.coord.y)
            unit.sendInstructions(grid.arr[command.destinationCoord.x][command.destinationCoord.y])
            assert(movesBefore - unit.moves > 0)
            ++usedActions
        }
        return usedActions
    }
    play() {
        let remainingActions = getAiActionLimit(Infinity)
        for (let cycle = 0; cycle < this.units.length; ++cycle) {
            if (remainingActions <= 0) {
                break
            }
            if (this.units[cycle].killed) {
                this.units.splice(cycle--, 1)
                assert(false)
                continue
            }
            remainingActions -= this.unitDoMoves(this.units[cycle], remainingActions)
        }
    }
    chooseAiTarget(targets) {
        return chooseAiTargetByPriority(targets, 0)
    }
    shouldReinforce() {
        return false
    }
}

class SimpleAiPlayerWithEconomy extends SimpleAiPlayer {
    constructor(color, gold = 90, economyMode = 'war') {
        super(color, gold)
        this.economyMode = economyMode
    }
    inspectEconomy() {
        let state = {
            gold: this.gold,
            income: this.income,
            towns: [],
            barracks: [],
            pendingBarracks: [],
            farms: [],
            pendingFarms: [],
            suburbs: [],
            units: this.units.filter(function(unit) {
                return !unit.killed
            }),
            productionChoices: []
        }
        let townProducts = ['noob', 'suburb', 'farm', 'barrack']
        let barrackProducts = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
        for (let i = 0; i < this.towns.length; ++i) {
            let town = this.towns[i]
            if (town.killed) {
                continue
            }
            state.towns.push(town)
            let suburbs = town.suburbs || []
            for (let j = 0; j < suburbs.length; ++j) {
                if (suburbs[j].isSuburb &&
                    suburbs[j].playerColor == town.playerColor) {
                    state.suburbs.push(suburbs[j])
                }
            }
            for (let j = 0; j < town.buildings.length; ++j) {
                let building = town.buildings[j]
                if (building.killed) {
                    continue
                }
                if (building.name == 'barrack') {
                    state.barracks.push(building)
                }
                else if (building.name == 'farm') {
                    state.farms.push(building)
                }
            }
            let pendingBuildings = town.buildingProduction || []
            for (let j = 0; j < pendingBuildings.length; ++j) {
                let building = pendingBuildings[j]
                if (!building.killed && building.name == 'barrack') {
                    state.pendingBarracks.push(building)
                }
                else if (!building.killed && building.name == 'farm') {
                    state.pendingFarms.push(building)
                }
            }
            this.addProductionChoices(state.productionChoices, town, townProducts)
        }
        for (let i = 0; i < state.barracks.length; ++i) {
            this.addProductionChoices(
                state.productionChoices, state.barracks[i], barrackProducts)
        }
        return state
    }
    addProductionChoices(choices, producer, products) {
        for (let i = 0; i < products.length; ++i) {
            let product = products[i]
            if (!production[product] || this.gold < production[product].cost) {
                continue
            }
            if (producer.isBadlyDamaged ||
                (producer.isPreparingUnit && AI_UNIT_PRODUCTS.includes(product))) {
                continue
            }
            choices.push({
                producer: producer,
                product: product,
                cost: production[product].cost
            })
        }
    }
    chooseWarProductions(state) {
        let unitChoices = state.productionChoices.filter(function(choice) {
            return AI_UNIT_PRODUCTS.includes(choice.product)
        }).sort(function(left, right) {
            return AI_UNIT_PRODUCTS.indexOf(left.product) -
                    AI_UNIT_PRODUCTS.indexOf(right.product) ||
                left.cost - right.cost
        })
        let choices = unitChoices.slice()
        let barrackCapacity = state.barracks.length + state.pendingBarracks.length
        if (barrackCapacity < state.towns.length) {
            choices = choices.concat(state.productionChoices.filter(function(choice) {
                return choice.product == 'barrack'
            }))
            choices = choices.concat(state.productionChoices.filter(function(choice) {
                return choice.product == 'suburb'
            }))
        }
        return choices
    }
    chooseEconomyProductions(state) {
        let byProducts = function(products) {
            return state.productionChoices.filter(function(choice) {
                return products.includes(choice.product)
            }).sort(function(left, right) {
                return products.indexOf(left.product) -
                        products.indexOf(right.product) ||
                    left.cost - right.cost
            })
        }
        if (state.units.length == 0) {
            return byProducts(AI_UNIT_PRODUCTS)
        }

        let farmCount = state.farms.length + state.pendingFarms.length
        let growthPriority = farmCount < state.towns.length ?
            ['farm', 'suburb'] : ['suburb', 'farm']
        let choices = byProducts(growthPriority)
        if (state.barracks.length + state.pendingBarracks.length == 0) {
            choices = choices.concat(byProducts(['barrack']))
        }
        return choices.concat(byProducts(AI_UNIT_PRODUCTS))
    }
    startEconomyProduction(choice) {
        if (!choice || !choice.producer.prepare(choice.product)) {
            return false
        }
        let activeProduction = choice.producer.activeProduction
        if (!activeProduction || activeProduction.isEmpty()) {
            return true
        }
        let available = activeProduction.availableHexagons || []
        for (let i = 0; i < available.length; ++i) {
            let cell = grid.getCell(available[i].coord)
            if (activeProduction.canCreateOnCell(cell, choice.producer)) {
                choice.producer.sendInstructions(cell)
                return true
            }
        }
        choice.producer.removeSelect()
        return false
    }
    spendEconomyGold() {
        let choices = this.chooseEconomyProductions(this.inspectEconomy())
        for (let i = 0; i < choices.length; ++i) {
            if (this.startEconomyProduction(choices[i])) {
                return true
            }
        }
        return false
    }
    spendWarGold() {
        let choices = this.chooseWarProductions(this.inspectEconomy())
        for (let i = 0; i < choices.length; ++i) {
            if (this.startEconomyProduction(choices[i])) {
                return true
            }
        }
        return false
    }
    play() {
        if (this.economyMode == 'war') {
            this.spendWarGold()
        }
        else {
            this.spendEconomyGold()
        }
        super.play()
    }
    chooseAiTarget(targets) {
        return chooseAiTargetByPriority(targets, 3)
    }
    shouldReinforce(round, unitCount) {
        return round % 6 == 0 && unitCount < 5
    }
}

function weightedRandomIndex(weights) {
    assert(weights.length > 0)
    let total = 0.0
    for (let i = 0; i < weights.length; ++i) {
        total += weights[i]
    }
    const threshold = Math.random() * total
    let cumulative = 0.0
    for (let i = 0; i < weights.length; i++) {
        cumulative += weights[i]
        if (threshold < cumulative) {
            return i
        }
    }
    return weights.length - 1
}

function softmaxRandomIndex(arr) {
    const max = Math.max(...arr)
    return weightedRandomIndex(arr.map(x => Math.exp(x - max)))
}

function sampleByTemperature(values, temperature) {
    assert(temperature > 0.0)
    return softmaxRandomIndex(values.map(value => value / temperature))
}

// Zero is greedy play; positive values enable exploration during self-play.
let selfPlayTemperature = 0.0

class AIPlayer extends Player {
    constructor(color, gold = 90) {
        super(color, gold)
        this.chosenGrids = []
        this.winningChances = []
    }
    calculateCellsCount(playerColor) {
        let cellsCount = 0
        for (let i = 0; i < grid.arr.length; ++i) {
            for (let j = 0; j < grid.arr[i].length; ++j) {
                cellsCount += grid.arr[i][j].playerColor == playerColor
            }
        }
        return cellsCount
    }
    getWinningChance() {
        return this.getWinningChances([vectoriseGrid()])[0]
    }
    getWinningChances(vectorisedGrids) {
        let predictions = predict(ai_model, vectorisedGrids)
        let result = []
        for (let i = 0; i < predictions.length; ++i) {
            result.push(predictions[i][0])
        }
        return result
    }
    selectBestCommand() {
        let foundCommands = []
        let xCommands = []
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed || this.units[i].moves == 0) {
                continue
            }
            let commands = this.units[i].getAvailableCommands()
            for (let j = 0; j < commands.length; ++j) {
                let unit = grid.getCell(commands[j].whoDoCommandCoord).unit
                unit.select()
                if (areCoordsEqual(commands[j].whoDoCommandCoord, commands[j].destinationCoord)) {
                    unit.skipMoves()
                }
                else {
                    unit.sendInstructions(grid.getCell(commands[j].destinationCoord))
                }
                foundCommands.push(commands[j])
                xCommands.push(vectoriseGrid())
                actionManager.undo()
            }
        }
        if (foundCommands.length == 0) {
            return [null, -1.0]
        }
        let foundChances = this.getWinningChances(xCommands)
        assert(foundChances.length == foundCommands.length)
        if (selfPlayTemperature > 0.0) {
            let index = sampleByTemperature(foundChances, selfPlayTemperature)
            return [foundCommands[index], foundChances[index]]
        }
        let maxIndex = 0
        for (let i = 0; i < foundChances.length; ++i) {
            if (foundChances[i] > foundChances[maxIndex]) {
                maxIndex = i
            }
        }
        return [foundCommands[maxIndex], foundChances[maxIndex]]
    }
    doActions() {
        const hardLimit = getAiActionLimit(150)
        this.chosenGrids.push(vectoriseGrid())
        this.winningChances.push(this.getWinningChance())
        let unitsLength = this.units.length
        for (let i = 0; i < hardLimit; ++i) {
            let [bestCommand, chance] = this.selectBestCommand()
            if (!bestCommand) {
                return
            }
            let unit = grid.getCell(bestCommand.whoDoCommandCoord).unit
            assert(unit.isMyTurn)
            unit.select()
            if (areCoordsEqual(bestCommand.whoDoCommandCoord, bestCommand.destinationCoord)) {
                unit.skipMoves()
            }
            else {
                unit.sendInstructions(grid.getCell(bestCommand.destinationCoord))
            }
            this.chosenGrids.push(vectoriseGrid())
            this.winningChances.push(chance)
            this.updateUnits()
            assert(unitsLength == this.units.length)
        }
        console.log('player reached hard limit')
    }
    nextTurn() {
        super.nextTurn()
        if (gameSettings.testAI) {
            this.doActions()
        }
    }
    chooseAiTarget(targets) {
        return chooseAiTargetByPriority(targets, 1)
    }
    shouldReinforce() {
        return false
    }
}

class AIPlayerWithEconomy extends AIPlayer {
    calculateCellsCount(playerColor) {
        let cellsCount = 0
        if (typeof players == 'undefined') {
            return cellsCount
        }
        for (let playerIndex = 0; playerIndex < players.length; ++playerIndex) {
            let player = players[playerIndex]
            if (!player || player.isNeutral) {
                continue
            }
            for (let townIndex = 0; townIndex < player.towns.length; ++townIndex) {
                if (!player.towns[townIndex].killed &&
                        player.towns[townIndex].playerColor == playerColor) {
                    ++cellsCount
                }
            }
            for (let unitIndex = 0; unitIndex < player.units.length; ++unitIndex) {
                if (!player.units[unitIndex].killed &&
                        player.units[unitIndex].playerColor == playerColor) {
                    ++cellsCount
                }
            }
        }
        return cellsCount
    }
    getPlayerIndex() {
        if (typeof players == 'undefined') {
            return typeof whooseTurn == 'undefined' ? -1 : whooseTurn
        }
        return players.indexOf(this)
    }
    inspectEconomy() {
        return SimpleAiPlayerWithEconomy.prototype.inspectEconomy.call(this)
    }
    addProductionChoices(choices, producer, products) {
        return SimpleAiPlayerWithEconomy.prototype.addProductionChoices.call(
            this, choices, producer, products)
    }
    chooseWarProductions(state) {
        let byProducts = function(products) {
            return state.productionChoices.filter(function(choice) {
                return products.includes(choice.product)
            }).sort(function(left, right) {
                return products.indexOf(left.product) -
                        products.indexOf(right.product) ||
                        left.cost - right.cost
            })
        }
        const expandedProducts =
            state.units.length >= AI_ECONOMY_ADVANCED_UNIT_THRESHOLD ?
            ['catapult', 'normchel', 'KOHb', 'archer', 'noob'] :
            ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
        let choices = byProducts(expandedProducts)
        let barrackCapacity = state.barracks.length + state.pendingBarracks.length
        if (state.units.length >= AI_ECONOMY_ADVANCED_UNIT_THRESHOLD &&
                barrackCapacity < state.towns.length) {
            choices = choices.concat(byProducts(['barrack', 'suburb']))
        }
        return choices
    }
    startEconomyProduction(choice) {
        return SimpleAiPlayerWithEconomy.prototype.startEconomyProduction.call(this, choice)
    }
    spendWarGold() {
        return SimpleAiPlayerWithEconomy.prototype.spendWarGold.call(this)
    }
    getEnemyTargetsForActionRanking() {
        let targets = []
        if (typeof players == 'undefined') {
            return targets
        }
        let playerIndexForThis = this.getPlayerIndex()
        for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
            if (playerIndex == playerIndexForThis) {
                continue
            }
            let enemy = players[playerIndex]
            for (let i = 0; i < enemy.units.length; ++i) {
                if (!enemy.units[i].killed) {
                    targets.push({coord: enemy.units[i].coord, kind: 'unit'})
                }
            }
            for (let i = 0; i < enemy.towns.length; ++i) {
                if (!enemy.towns[i].killed) {
                    targets.push({coord: enemy.towns[i].coord, kind: 'town'})
                }
            }
        }
        return targets
    }
    getActionRankingDistance(left, right) {
        return Math.max(
            Math.abs(left.x - right.x),
            Math.abs(left.y - right.y),
            Math.abs(left.x + left.y - right.x - right.y)
        )
    }
    getLiveTownCount(player) {
        if (!player || !player.towns) {
            return 0
        }
        let count = 0
        for (let i = 0; i < player.towns.length; ++i) {
            if (!player.towns[i].killed) {
                ++count
            }
        }
        return count
    }
    getLiveUnitCount(player) {
        if (!player || !player.units) {
            return 0
        }
        let count = 0
        for (let i = 0; i < player.units.length; ++i) {
            if (!player.units[i].killed) {
                ++count
            }
        }
        return count
    }
    getTownDeficitPressure() {
        if (typeof players == 'undefined') {
            return 0
        }
        let playerIndexForThis = this.getPlayerIndex()
        let ownTowns = this.getLiveTownCount(this)
        let strongestOpponentTowns = 0
        for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
            if (playerIndex == playerIndexForThis || players[playerIndex].isNeutral) {
                continue
            }
            strongestOpponentTowns = Math.max(
                strongestOpponentTowns,
                this.getLiveTownCount(players[playerIndex]))
        }
        return Math.max(0, strongestOpponentTowns - ownTowns)
    }
    getUnitAdvantagePressure() {
        if (typeof players == 'undefined') {
            return 0
        }
        let playerIndexForThis = this.getPlayerIndex()
        let ownUnits = this.getLiveUnitCount(this)
        let strongestOpponentUnits = 0
        for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
            if (playerIndex == playerIndexForThis || players[playerIndex].isNeutral) {
                continue
            }
            strongestOpponentUnits = Math.max(
                strongestOpponentUnits,
                this.getLiveUnitCount(players[playerIndex]))
        }
        return Math.max(0, ownUnits - strongestOpponentUnits)
    }
    getActionLimit(fallback) {
        let limit = getAiActionLimit(fallback)
        if (typeof gameRound != 'undefined' &&
                gameRound >= AI_ECONOMY_STALEMATE_ROUND) {
            limit = Math.max(limit, AI_ECONOMY_STALEMATE_ACTION_LIMIT)
        }
        if (this.getLiveTownCount(this) >= AI_ECONOMY_MULTI_TOWN_THRESHOLD) {
            limit = Math.max(limit, AI_ECONOMY_MULTI_TOWN_ACTION_LIMIT)
        }
        return limit
    }
    getCommandLimit(fallback) {
        return getAiCommandLimit(fallback)
    }
    getEnemyTargetsForMovement() {
        if (this.prioritizedTargetsForTurn) {
            return this.prioritizedTargetsForTurn
        }
        let targets = []
        if (typeof players == 'undefined') {
            return targets
        }
        let playerIndexForThis = this.getPlayerIndex()
        for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
            if (playerIndex == playerIndexForThis || players[playerIndex].isNeutral) {
                continue
            }
            let opponent = players[playerIndex]
            for (let i = 0; i < opponent.towns.length; ++i) {
                if (!opponent.towns[i].killed) {
                    targets.push({
                        coord: opponent.towns[i].coord,
                        kind: 'town',
                        threatensTown: false
                    })
                }
            }
            for (let i = 0; i < opponent.units.length; ++i) {
                if (!opponent.units[i].killed) {
                    let threatensTown = false
                    for (let j = 0; j < this.towns.length; ++j) {
                        if (!this.towns[j].killed &&
                            this.getActionRankingDistance(
                                opponent.units[i].coord, this.towns[j].coord) <=
                                    AI_ECONOMY_TOWN_THREAT_DISTANCE) {
                            threatensTown = true
                            break
                        }
                    }
                    targets.push({
                        coord: opponent.units[i].coord,
                        kind: 'unit',
                        threatensTown: threatensTown
                    })
                }
            }
        }
        if (players[0]) {
            for (let i = 0; i < players[0].towns.length; ++i) {
                if (!players[0].towns[i].killed) {
                    let enemyDistance = Infinity
                    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
                        if (playerIndex == playerIndexForThis || players[playerIndex].isNeutral) {
                            continue
                        }
                        let opponent = players[playerIndex]
                        for (let townIndex = 0; townIndex < opponent.towns.length; ++townIndex) {
                            if (!opponent.towns[townIndex].killed) {
                                enemyDistance = Math.min(enemyDistance,
                                    this.getActionRankingDistance(
                                        players[0].towns[i].coord,
                                        opponent.towns[townIndex].coord))
                            }
                        }
                        for (let unitIndex = 0; unitIndex < opponent.units.length; ++unitIndex) {
                            if (!opponent.units[unitIndex].killed) {
                                enemyDistance = Math.min(enemyDistance,
                                    this.getActionRankingDistance(
                                        players[0].towns[i].coord,
                                        opponent.units[unitIndex].coord))
                            }
                        }
                    }
                    targets.push({
                        coord: players[0].towns[i].coord,
                        kind: 'neutralTown',
                        threatensTown: false,
                        enemyDistance: enemyDistance
                    })
                }
            }
        }
        this.prioritizedTargetsForTurn = targets
        return targets
    }
    getCommandTowardEnemy(unit, commands) {
        commands = commands || getAiMoveCommands(unit).slice(
            0, this.getCommandLimit(60))
        if (typeof gameRound != 'undefined' &&
                gameRound >= AI_ECONOMY_STALEMATE_ROUND &&
                this.getUnitAdvantagePressure() > 0 &&
                this.bestEnemyTargetForAI &&
                this.bestEnemyTargetForAI.GetCommandNearestToBestTarget) {
            let pathCommand = this.bestEnemyTargetForAI.GetCommandNearestToBestTarget(
                commands, unit.coord, grid.arr, unit.playerColor)
            if (pathCommand) {
                return pathCommand
            }
        }
        let targets = this.getEnemyTargetsForMovement()
        if (!targets.length) {
            return null
        }
        let bestCommand = null
        let bestScore = -Infinity
        let townDeficitPressure = this.getTownDeficitPressure()
        let unitAdvantagePressure = this.getUnitAdvantagePressure()
        for (let i = 0; i < commands.length; ++i) {
            let command = commands[i]
            let destination = grid.getCell(command.destinationCoord)
            if (destination.unit.notEmpty && destination.unit.notEmpty() &&
                    destination.unit.playerColor == this.getPlayerIndex()) {
                continue
            }
            for (let j = 0; j < targets.length; ++j) {
                let distance = this.getActionRankingDistance(
                    command.destinationCoord, targets[j].coord)
                let townTargetScore = typeof gameRound != 'undefined' &&
                    gameRound >= AI_ECONOMY_STALEMATE_ROUND ?
                    AI_ECONOMY_STALEMATE_TOWN_TARGET_SCORE :
                    AI_ECONOMY_TOWN_TARGET_SCORE
                let unitTargetScore = typeof gameRound != 'undefined' &&
                    gameRound >= AI_ECONOMY_STALEMATE_ROUND &&
                    !targets[j].threatensTown ?
                    AI_ECONOMY_STALEMATE_UNIT_TARGET_SCORE :
                    AI_ECONOMY_UNIT_TARGET_SCORE
                let score = -distance +
                    (targets[j].kind == 'town' ? townTargetScore +
                        townDeficitPressure * AI_ECONOMY_TOWN_DEFICIT_TARGET_SCORE +
                        unitAdvantagePressure *
                            AI_ECONOMY_UNIT_ADVANTAGE_TARGET_SCORE : 0) +
                    (targets[j].kind == 'unit' ? unitTargetScore -
                        (!targets[j].threatensTown ?
                            unitAdvantagePressure *
                                AI_ECONOMY_UNIT_ADVANTAGE_UNIT_PENALTY : 0) : 0) +
                    (targets[j].kind == 'neutralTown' ?
                        AI_ECONOMY_NEUTRAL_TOWN_TARGET_SCORE -
                            townDeficitPressure *
                                AI_ECONOMY_TOWN_DEFICIT_NEUTRAL_PENALTY -
                            unitAdvantagePressure *
                                AI_ECONOMY_UNIT_ADVANTAGE_NEUTRAL_PENALTY : 0) +
                    (targets[j].kind == 'neutralTown' &&
                        Number.isFinite(targets[j].enemyDistance) ?
                        Math.max(
                            0,
                            AI_ECONOMY_NEUTRAL_RACE_DISTANCE -
                                targets[j].enemyDistance) *
                            AI_ECONOMY_NEUTRAL_RACE_SCORE : 0) +
                    (targets[j].threatensTown ? AI_ECONOMY_THREAT_TARGET_SCORE : 0)
                if (score > bestScore) {
                    bestScore = score
                    bestCommand = command
                }
            }
        }
        return bestCommand
    }
    scoreUnitCommandForActionRanking(command, targets) {
        let destination = grid.getCell(command.destinationCoord)
        let score = 100
        let playerIndex = this.getPlayerIndex()
        if ((destination.unit && destination.unit.notEmpty && destination.unit.notEmpty() &&
                destination.unit.playerColor != playerIndex) ||
            (destination.building && destination.building.notEmpty &&
                destination.building.notEmpty() &&
                destination.building.playerColor != playerIndex)) {
            score += 10000
        }
        if (targets.length) {
            let before = Infinity
            let after = Infinity
            for (let i = 0; i < targets.length; ++i) {
                before = Math.min(
                    before,
                    this.getActionRankingDistance(command.whoDoCommandCoord, targets[i].coord))
                after = Math.min(
                    after,
                    this.getActionRankingDistance(command.destinationCoord, targets[i].coord) -
                        (targets[i].kind == 'town' ? 1 : 0))
            }
            score += (before - after) * 50 - after
        }
        if (areCoordsEqual(command.whoDoCommandCoord, command.destinationCoord)) {
            score -= 1000
        }
        return score
    }
    scoreEconomyCommandForActionRanking(command) {
        const productScore = {
            noob: 95,
            archer: 90,
            KOHb: 85,
            normchel: 80,
            catapult: 75,
            barrack: 65,
            farm: 55,
            suburb: 50,
            tower: 35,
            bastion: 30,
            wall: 25
        }
        return productScore[command.product] || 0
    }
    getPrioritizedActionCommands(limit = 48) {
        limit = Math.min(limit, this.getCommandLimit(limit))
        let targets = this.getEnemyTargetsForActionRanking()
        return this.getActionCommands().map(command => {
            let score = command.type == 'economy' ?
                this.scoreEconomyCommandForActionRanking(command) :
                this.scoreUnitCommandForActionRanking(command, targets)
            return {command, score}
        }).sort((left, right) => right.score - left.score)
            .slice(0, limit).map(entry => entry.command)
    }
    getUnitCommands() {
        let commands = []
        for (let i = 0; i < this.units.length; ++i) {
            let unit = this.units[i]
            if (unit.killed || unit.moves == 0) {
                continue
            }
            let available = unit.getAvailableCommands()
            for (let j = 0; j < available.length; ++j) {
                commands.push(available[j])
            }
        }
        return commands
    }
    getProducerProducts(producer) {
        if (producer.name == 'town') {
            return Object.keys(production)
        }
        return AI_UNIT_PRODUCTS
    }
    getEconomyDestinations(producer, product) {
        if (producer.getAvailableProductionCells) {
            return producer.getAvailableProductionCells(product)
        }
        let configured = production[product]
        if (!configured || configured.production.isUnitProduction()) {
            return []
        }
        let candidate = new configured.production(
            configured.turns, configured.cost, configured.class, product)
        candidate.choose(producer)
        let destinations = []
        let available = candidate.availableHexagons || []
        for (let i = 0; i < available.length; ++i) {
            let coord = available[i].coord
            let cell = grid.getCell(coord)
            if (candidate.canCreateOnCell(cell, producer)) {
                destinations.push({ x: coord.x, y: coord.y })
            }
        }
        return destinations
    }
    getEconomyCommandCategory(product) {
        if (production[product].production.isUnitProduction()) {
            return 'unit-training'
        }
        if (product == 'suburb') {
            return 'suburb-expansion'
        }
        return 'building-placement'
    }
    getEconomyCommands() {
        let commands = []
        let producers = this.towns.slice()
        for (let i = 0; i < this.towns.length; ++i) {
            let buildings = this.towns[i].buildings || []
            for (let j = 0; j < buildings.length; ++j) {
                if (buildings[j].name == 'barrack') {
                    producers.push(buildings[j])
                }
            }
        }
        for (let i = 0; i < producers.length; ++i) {
            let producer = producers[i]
            if (producer.killed || producer.isBadlyDamaged) {
                continue
            }
            let products = this.getProducerProducts(producer)
            for (let j = 0; j < products.length; ++j) {
                let product = products[j]
                let configured = production[product]
                if (!configured || this.gold < configured.cost) {
                    continue
                }
                let isUnit = configured.production.isUnitProduction()
                if (isUnit && producer.isPreparingUnit) {
                    continue
                }
                if (!isUnit && producer.needInstructions &&
                    producer.needInstructions()) {
                    continue
                }
                let baseCommand = {
                    type: 'economy',
                    category: this.getEconomyCommandCategory(product),
                    product: product,
                    producerCoord: {
                        x: producer.coord.x,
                        y: producer.coord.y
                    }
                }
                if (isUnit) {
                    commands.push(baseCommand)
                    continue
                }
                let destinations = this.getEconomyDestinations(producer, product)
                for (let k = 0; k < destinations.length; ++k) {
                    commands.push(Object.assign({}, baseCommand, {
                        destinationCoord: destinations[k]
                    }))
                }
            }
        }
        return commands
    }
    getActionCommands() {
        return this.getUnitCommands().concat(this.getEconomyCommands())
    }
    applyEconomyCommand(command) {
        let producer = grid.getBuilding(command.producerCoord)
        if (!producer.notEmpty() || !producer.prepare(command.product)) {
            return false
        }
        if (!command.destinationCoord) {
            return true
        }
        let cell = grid.getCell(command.destinationCoord)
        if (!producer.activeProduction ||
            !producer.activeProduction.canCreateOnCell(cell, producer)) {
            producer.removeSelect()
            return false
        }
        producer.sendInstructions(cell)
        return true
    }
    applyActionCommand(command) {
        if (command.type == 'economy') {
            return this.applyEconomyCommand(command)
        }
        let unit = grid.getCell(command.whoDoCommandCoord).unit
        if (!unit || !unit.sendInstructions || unit.killed ||
                (unit.playerColor !== undefined &&
                    unit.playerColor != this.getPlayerIndex())) {
            return false
        }
        unit.select()
        if (areCoordsEqual(command.whoDoCommandCoord, command.destinationCoord)) {
            unit.skipMoves()
        }
        else {
            unit.sendInstructions(grid.getCell(command.destinationCoord))
        }
        return true
    }
    getBestActionCommand() {
        let commands = this.getPrioritizedActionCommands()
        let validCommands = []
        let vectorisedGrids = []
        for (let i = 0; i < commands.length; ++i) {
            if (!this.applyActionCommand(commands[i])) {
                continue
            }
            validCommands.push(commands[i])
            vectorisedGrids.push(vectoriseGrid())
            actionManager.undo()
        }
        if (validCommands.length == 0) {
            return [null, -1.0]
        }
        let chances = this.getWinningChances(vectorisedGrids)
        let maxIndex = 0
        for (let i = 1; i < chances.length; ++i) {
            if (chances[i] > chances[maxIndex]) {
                maxIndex = i
            }
        }
        return [validCommands[maxIndex], chances[maxIndex]]
    }
    selectBestCommand() {
        return this.getBestActionCommand()
    }
    moveUnitWithEconomy(unit, remainingActions) {
        while (unit.moves > 0 && remainingActions > 0) {
            let movesBefore = unit.moves
            let attackCommand =
                SimpleAiPlayer.prototype.findUnitAttackCommand.call(this, unit)
            if (attackCommand) {
                unit.sendInstructions(grid.getCell(attackCommand.destinationCoord))
                if (movesBefore == unit.moves) {
                    break
                }
                --remainingActions
                continue
            }
            let moveCommands = getAiMoveCommands(unit).slice(
            0, this.getCommandLimit(AI_ECONOMY_DEFAULT_COMMAND_LIMIT))
            let command = this.getCommandTowardEnemy(unit, moveCommands)
            if (!command && this.bestEnemyTargetForAI.GetCommandNearestToBestTarget) {
                command = this.bestEnemyTargetForAI.GetCommandNearestToBestTarget(
                    moveCommands, unit.coord, grid.arr, unit.playerColor)
            }
            if (!command) {
                break
            }
            unit.sendInstructions(grid.getCell(command.destinationCoord))
            if (movesBefore == unit.moves) {
                break
            }
            --remainingActions
        }
        return remainingActions
    }
    spendWarGoldWithinLimit(remainingActions, maxPurchases) {
        let purchases = 0
        while (remainingActions > 0 && purchases < maxPurchases) {
            if (!this.spendWarGold()) {
                break
            }
            --remainingActions
            ++purchases
        }
        return remainingActions
    }
    shouldUseLearnedCombatOnlyTurn() {
        let state = this.inspectEconomy()
        return state.barracks.length == 0 &&
            state.pendingBarracks.length == 0 &&
            state.farms.length == 0 &&
            state.pendingFarms.length == 0
    }
    doLearnedCombatOnlyActions() {
        const hardLimit = this.getActionLimit(150)
        this.chosenGrids.push(vectoriseGrid())
        this.winningChances.push(this.getWinningChance())
        let unitsLength = this.units.length
        for (let i = 0; i < hardLimit; ++i) {
            let [bestCommand, chance] = this.getBestActionCommand()
            if (!bestCommand) {
                return
            }
            if (!this.applyActionCommand(bestCommand)) {
                return
            }
            this.chosenGrids.push(vectoriseGrid())
            this.winningChances.push(chance)
            this.updateUnits()
            assert(unitsLength == this.units.length)
        }
        console.log('player reached hard limit')
    }
    doActions() {
        if (this.shouldUseLearnedCombatOnlyTurn()) {
            this.doLearnedCombatOnlyActions()
            return
        }
        this.chosenGrids.push(vectoriseGrid())
        this.winningChances.push(this.getWinningChance())
        if (!this.bestEnemyTargetForAI) {
            this.bestEnemyTargetForAI = new BestEnemyTargetForAI()
        }
        this.prioritizedTargetsForTurn = null
        let remainingActions =
            this.getActionLimit(AI_ECONOMY_DEFAULT_ACTION_LIMIT)
        remainingActions = this.spendWarGoldWithinLimit(
            remainingActions, AI_ECONOMY_PRE_MOVE_PURCHASE_LIMIT)
        for (let i = 0; i < this.units.length && remainingActions > 0; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
                continue
            }
            remainingActions = this.moveUnitWithEconomy(this.units[i], remainingActions)
        }
        this.prioritizedTargetsForTurn = null
        this.spendWarGoldWithinLimit(
            remainingActions, AI_ECONOMY_POST_MOVE_PURCHASE_LIMIT)
        this.chosenGrids.push(vectoriseGrid())
        this.winningChances.push(this.getWinningChance())
    }
    chooseAiTarget(targets) {
        return chooseAiTargetByPriority(targets, 4)
    }
    shouldReinforce(round, unitCount) {
        return round % 6 == 0 && unitCount < 5
    }
}
