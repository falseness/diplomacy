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
        return targets.slice().sort(function(left, right) {
            return left.distance - right.distance ||
                left.kind.localeCompare(right.kind) ||
                left.key.localeCompare(right.key)
        })[0]
    }
    shouldBenchmarkReinforce() {
        return false
    }
}

class SimpleAiPlayerWithEconomy extends SimpleAiPlayer {
    chooseBenchmarkTarget(targets) {
        return targets.slice().sort(function(left, right) {
            let leftScore = left.distance - (left.kind == 'town' ? 3 : 0)
            let rightScore = right.distance - (right.kind == 'town' ? 3 : 0)
            return leftScore - rightScore ||
                left.kind.localeCompare(right.kind) ||
                left.key.localeCompare(right.key)
        })[0]
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
        return targets.slice().sort(function(left, right) {
            let leftScore = left.distance - (left.kind == 'town' ? 1 : 0)
            let rightScore = right.distance - (right.kind == 'town' ? 1 : 0)
            return leftScore - rightScore ||
                left.kind.localeCompare(right.kind) ||
                left.key.localeCompare(right.key)
        })[0]
    }
    shouldBenchmarkReinforce() {
        return false
    }
}

class AIPlayerWithEconomy extends AIPlayer {
    chooseBenchmarkTarget(targets) {
        return targets.slice().sort(function(left, right) {
            let leftScore = left.distance - (left.kind == 'town' ? 4 : 0)
            let rightScore = right.distance - (right.kind == 'town' ? 4 : 0)
            return leftScore - rightScore ||
                left.kind.localeCompare(right.kind) ||
                left.key.localeCompare(right.key)
        })[0]
    }
    shouldBenchmarkReinforce(round, unitCount) {
        return round % 6 == 0 && unitCount < 5
    }
}
