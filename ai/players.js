const AI_UNIT_PRODUCTS = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']

function compareBenchmarkTargets(townBonus) {
    return function(left, right) {
        let leftScore = left.distance - (left.kind == 'town' ? townBonus : 0)
        let rightScore = right.distance - (right.kind == 'town' ? townBonus : 0)
        return leftScore - rightScore ||
            left.kind.localeCompare(right.kind) ||
            left.key.localeCompare(right.key)
    }
}

function chooseBenchmarkTargetByPriority(targets, townBonus) {
    return targets.slice().sort(compareBenchmarkTargets(townBonus))[0]
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
            let cell = grid.arr[command.destinationCoord.x][command.destinationCoord.y]
            if (unit.canHitSomethingOnCell(cell)) {
                return command
            }
        }
        return null
    }
    unitDoMoves(unit) {
        while (unit.moves > 0) {
            const movesBefore = unit.moves
            let attackCommand = this.findUnitAttackCommand(unit)
            if (attackCommand) {
                let cell = grid.arr[attackCommand.destinationCoord.x][attackCommand.destinationCoord.y]
                unit.sendInstructions(cell)
                assert(movesBefore - unit.moves > 0)
                break
            }
            let command = this.bestEnemyTargetForAI.GetCommandNearestToBestTarget(
                unit.getAvailableMoveCommands(), unit.coord, grid.arr, unit.playerColor)
            if (!command) {
                break
            }
            assert(command.whoDoCommandCoord.x == unit.coord.x &&
                command.whoDoCommandCoord.y == unit.coord.y)
            unit.sendInstructions(grid.arr[command.destinationCoord.x][command.destinationCoord.y])
            assert(movesBefore - unit.moves > 0)
        }
    }
    play() {
        for (let cycle = 0; cycle < this.units.length; ++cycle) {
            if (this.units[cycle].killed) {
                this.units.splice(cycle--, 1)
                assert(false)
                continue
            }
            this.unitDoMoves(this.units[cycle])
        }
    }
    chooseBenchmarkTarget(targets) {
        return chooseBenchmarkTargetByPriority(targets, 0)
    }
    shouldBenchmarkReinforce() {
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
            for (let j = 0; j < town.suburbs.length; ++j) {
                if (town.suburbs[j].isSuburb &&
                    town.suburbs[j].playerColor == town.playerColor) {
                    state.suburbs.push(town.suburbs[j])
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
    chooseBenchmarkTarget(targets) {
        return chooseBenchmarkTargetByPriority(targets, 3)
    }
    shouldBenchmarkReinforce(round, unitCount) {
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
        const hardLimit = 150
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
    chooseBenchmarkTarget(targets) {
        return chooseBenchmarkTargetByPriority(targets, 1)
    }
    shouldBenchmarkReinforce() {
        return false
    }
}

class AIPlayerWithEconomy extends AIPlayer {
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
        let commands = this.getActionCommands()
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
    doActions() {
        const hardLimit = 150
        this.chosenGrids.push(vectoriseGrid())
        this.winningChances.push(this.getWinningChance())
        for (let i = 0; i < hardLimit; ++i) {
            let [bestCommand, chance] = this.selectBestCommand()
            if (!bestCommand) {
                return
            }
            if (!this.applyActionCommand(bestCommand)) {
                return
            }
            this.chosenGrids.push(vectoriseGrid())
            this.winningChances.push(chance)
            this.updateUnits()
        }
        console.log('player reached hard limit')
    }
    chooseBenchmarkTarget(targets) {
        return chooseBenchmarkTargetByPriority(targets, 4)
    }
    shouldBenchmarkReinforce(round, unitCount) {
        return round % 6 == 0 && unitCount < 5
    }
}
