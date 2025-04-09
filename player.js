class Player {
    constructor(color, gold = 90) {
        this.gold = gold
        this.towns = []
        this.units = []
        this.goldmines = []

        this.color = {
            r: color.r,
            g: color.g,
            b: color.b
        }
            
        this.hexagon = this.calcHexagon()
        this.suburbHexagon = this.calcSuburbHexagon()
    }
    findIdleUnit() {
        for (let i = 0; i < this.units.length; ++i) {
            if (!this.units[i].killed && this.units[i].moves != 0) {
                return this.units[i]
            }
        }
        return undefined
    }
    updateUnits() {
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
            }
        }
        let new_units = []
        for (let i = 0; i < this.units.length; ++i) {
            let unit = this.units[i]
            for (; i < this.units.length && this.units[i] == unit; ++i) {

            }
            --i
            new_units.push(unit)
        }
        this.units = new_units
    }
    updateTowns() {
        for (let i = 0; i < this.towns.length; ++i) {
            if (this.isTownKilled(this.towns[i])) {
                this.towns.splice(i--, 1)
            }
        }
    }
    toJSON() {
        this.updateUnits()
        this.updateTowns()

        let res = {}
        res.gold = this.gold
        res.towns = this.towns
        res.units = this.units
        res.color = this.color

        return res
    }
    isTownKilled(town) {
        return town.killed ||
            town.player.hexColor != this.hexColor
    }
    isOurGoldmine(goldmine) {
        return goldmine.player.hexColor == this.hexColor
    }
    get armySalary() {
        let res = 0
        this.updateUnits()
        for (let i = 0; i < this.units.length; ++i) {
            res += this.units[i].salary
        }
        return res
    }
    get armyCost() {
        let res = 0
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
                continue
            }
            res += production[this.units[i].name].cost
        }
        return res
    }
    get goldminesIncome() {
        let income = 0
        for (let i = 0; i < goldmines.length; ++i) {
            if (this.isOurGoldmine(goldmines[i])) {
                income += goldmines[i].income
            }
        }
        return income
    }
    get income() {
        let income = 0
        for (let i = 0; i < this.towns.length; ++i) {
        if (this.isTownKilled(this.towns[i])) {
                this.towns.splice(i--, 1)
                continue
            }
            income += this.towns[i].income
        }
        income -= this.armySalary

        income += this.goldminesIncome
        
        return income
    }
    correctGoldminesIncome() {
        for (let i = 0; i < goldmines.length; ++i) {
            let g = goldmines[i]
            // just opened so that should not give income
            if (this.isOurGoldmine(g) && g.isOpened && !g.isLongOpened) {
                this.gold -= g.income
            }
        }
    }
    crisisPenalty() {
        for (let i = 0; i < this.units.length; ++i) {
            this.units[i].kill()
        }
        this.units = []
    }
    // no need update arrays, cause those functions is calling after nextTurn function
    get unitsCount() {
        return this.units.length
    }
    get townsCount() {
        return this.towns.length
    }
    get suburbsCount() {
        let res = 0
        for (let i = 0; i < this.towns.length; ++i) {
            res += this.towns[i].suburbsCount
        }
        return res
    }
    get barracksCount() {
        let res = 0
        for (let i = 0; i < this.towns.length; ++i) {
            res += this.towns[i].barracksCount
        }
        return res
    }
    get isLost() {
        this.updateTowns()
        this.updateUnits()
        return !this.towns.length && !this.units.length
    }
    changeFogOfWarByVision() {
        grid.clearFogOfWarArr()
        for (let i = 0; i < this.units.length; ++i) {
            let unit = this.units[i]
            unit.changeFogOfWarByVision()
        }
        for (let cycle = 0; cycle < this.towns.length; ++cycle) {
            for (let i = 0; i < this.towns[cycle].suburbs.length; ++i) {
                let coord = this.towns[cycle].suburbs[i].coord
                grid.visionWay.changeFogOfWarByVision(coord, grid.fogOfWar, SUBURBSVISIONRANGE)
            }
        }
    }
    nextTurn() {
        this.gold += this.income
        this.correctGoldminesIncome()
        

        if (this.isLost) {
            console.log("LOOSE")
        }

        if (this.gold < 0) {
            this.crisisPenalty()
            this.gold = 0
        }
        for (let i = 0; i < this.units.length; ++i) {
            this.units[i].nextTurn()
        }
        for (let i = 0; i < this.towns.length; ++i) {
            this.towns[i].nextTurn()
        }
    }
    calcSuburbHexagon() {
        let tmpCanvas = document.createElement('canvas')

        const strokeWidth = basis.strokeWidth
        let pos = {
            x: basis.hexHalfRectWithStrokeOffset.width,
            y: basis.hexHalfRectWithStrokeOffset.height
        }
        tmpCanvas.width = pos.x * 2
        tmpCanvas.height = pos.y * 2

        let tmpCtx = tmpCanvas.getContext('2d');

        tmpCtx.beginPath()

        tmpCtx.fillStyle = this.hexColor
        tmpCtx.strokeStyle = 'black'
        tmpCtx.lineWidth = strokeWidth

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.stroke()
        tmpCtx.closePath()

        return tmpCanvas
    }
    calcHexagon() {
        let tmpCanvas = document.createElement('canvas')

        const strokeWidth = basis.strokeWidth
        let pos = {
            x: basis.hexHalfRectWithStrokeOffset.width,
            y: basis.hexHalfRectWithStrokeOffset.height
        }
        tmpCanvas.width = pos.x * 2
        tmpCanvas.height = pos.y * 2

        let tmpCtx = tmpCanvas.getContext('2d');

        tmpCtx.beginPath()

        tmpCtx.fillStyle = this.hexColor
        tmpCtx.strokeStyle = 'black'
        tmpCtx.lineWidth = strokeWidth

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.stroke()
        tmpCtx.closePath()

        const suburbAlpha = 0.4
        const maxRGBInt = 255
        let color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`

        tmpCtx.beginPath()

        tmpCtx.fillStyle = color

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.closePath()
        return tmpCanvas
    }
    get textColor() {
        return (this.color.r + ', ' + this.color.g + ', ' + this.color.b)
    }
    get RGB() {
        return this.color
    }
    get hexColor() {
        return rgbToHex(this.color.r, this.color.g, this.color.b)
    }
    get fullColor() {
        let color = {
            hex: this.hexColor,
            text: this.textColor,
            rgb: this.color
        }
        return color
    }
    get isNeutral() {
        return false
    }
    get info() {
        return 'gold: ' + this.gold + '\n' + 
                'income: ' + this.income + '\n' +
                'suburbs: ' + this.suburbsCount + '\n' +
                'army cost: ' + this.armyCost + '\n' + 
                'army salary: ' + this.armySalary
    }
    get historyInfo() {
        return {'gold': this.gold, 
                    'income': this.income,
                    'suburbs': this.suburbsCount, 
                    'army cost': this.armyCost, 
                    'army salary': this.armySalary}
    }
}
class NeutralPlayer extends Player {
    constructor(color, gold = 0) {
        super(color, gold)
        this.hexagon = this.calcSuburbHexagon()

        if (isFogOfWar) {
            let oldColor = this.color
            this.color = {r: 51, g: 51, b: 51}
            this.fogOfWarHexagon = this.calcSuburbHexagon()
            this.color = oldColor
        }
    }
    get isLost() {
        return false
    }
    nextTurn() {
        super.nextTurn()

        ++gameRound

        if (gameRound >= suddenDeathRound) {
            this.suddenDeath()
        }
        if (this.isGameEnded) {
            menuBack()
        }
    }
    floodCell(i, j) {
        let arr = grid.arr

        if (arr[i][j].building.isTown) {
            arr[i][j].building.destroy()
        }
        else {
            arr[i][j].building.kill()
        }
        
        arr[i][j].unit.kill()

        arr[i][j].hexagon.sudoPaint(0)
        arr[i][j].hexagon.isSuburub = false

        arr[i][j].building = new Sea(i, j)
    }
    suddenDeath() {
        let suddenDeathCycle = gameRound - suddenDeathRound

        // only odd cycle
        if (suddenDeathCycle % 2)
            return 

        suddenDeathCycle /= 2

        let arr = grid.arr

        if (suddenDeathCycle >= arr.length || 
            suddenDeathCycle >= arr[0].length) {
            return
        }

        for (let i = 0; i < arr[suddenDeathCycle].length; ++i) {
            this.floodCell(suddenDeathCycle, i)
        }
        let right = arr.length - suddenDeathCycle - 1
        for (let i = 0; i < arr[right].length; ++i) {
            this.floodCell(right, i)
        }

        for (let i = 0; i < arr.length; ++i) {
            this.floodCell(i, suddenDeathCycle)
        }
        let bottom = arr[0].length - suddenDeathCycle - 1
        for (let i = 0; i < arr.length; ++i) {
            this.floodCell(i, bottom)
        }
    }
    get isGameEnded() {
        /*let loosedCount = 0
        for (let i = 1; i < players.length; ++i) {
            loosedCount += players[i].isLost
        }
        return loosedCount <= 1 */
        for (let i = 1; i < players.length; ++i) {
            if (!players[i].isLost)
                return false
        }
        return true
    }
    get isNeutral() {
        return true
    }
}

function weightedRandomIndex(weights) {
    assert(weights.length > 0)
    let total = 0.0
    for (let i = 0; i < weights.length; ++i) {
        total += weights[i]
    }
    const threshold = Math.random() * total;
  
    let cumulative = 0.0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (threshold < cumulative) {
        return i;
      }
    }
    console.log('cum', cumulative, weights)
    return weights.length - 1
  }

  function softmaxRandomIndex(arr) {
    // for numerical stability
    const max = Math.max(...arr)
    const exps = arr.map(x => Math.exp(x - max))
    return weightedRandomIndex(exps)
  }
  

class AIPlayer extends Player {
    constructor(color, gold = 90) {
        super(color, gold)
        //this.chosenGrids = []
        this.winningChances = []
        this.winningChancesHeuristic = []

        this.chosenGridsDebug = []
        this.commandsDebug = []
    }
    getWinningChanceHeuristic() {
        let otherPlayerTurn = whooseTurn == 1 ? 2 : 1
        let cells_count = 0
        for (let i = 0; i < grid.arr.length; ++i) {
            for (let j = 0; j < grid.arr[i].length; ++j) {
                cells_count += grid.arr[i][j].playerColor == whooseTurn 
            }
        }
        let result = players[otherPlayerTurn].isLost ? 1.0 : (this.isLost ? 0 : 0.5) 
        result += cells_count / grid.arr.length / grid.arr[0].length / 100.0
        
        players[otherPlayerTurn].updateUnits()
        this.updateUnits()
        let otherHP = 0
        for (let i = 0; i < players[otherPlayerTurn].units.length; ++i) {
            otherHP += players[otherPlayerTurn].units[i].hp
        }

        let myHP = 0
        for (let i = 0; i < this.units.length; ++i) {
            myHP += this.units[i].hp
        } 
        result += (myHP - otherHP) / 5
        
        if (result > 1.0) {
            result = 1.0
        }
        if (result < 0.0) {
            result = 0.0
        }

        return result 
    }
    getWinningChance() {
        //
        return this.getWinningChanceHeuristic()
        return this.getWinningChances([vectoriseGrid()])[0]
    }
    getWinningChances(vectorisedGrids) {
        assert(false)

        // let arr = predict(ai_model, vectorisedGrids) 
        // let result = []
        // for (let i = 0; i < arr.length; ++i) {
        //     result.push(arr[i][0])
        // }
        // return result
    }
    selectBestCommand() {
        let foundCommands = []
        let xCommands = []
        let len = this.units.length

        let foundChances = []

        for (let i = 0; i < len; ++i) {
            if (this.units[i].killed) {
                continue;
            }
            let commands = this.units[i].getAvailableCommands()
            for (let j = 0; j < commands.length; ++j) {
                let unit_again = grid.getCell(commands[j].whoDoCommandCoord).unit;
                unit_again.select()
                unit_again.sendInstructions(grid.getCell(commands[j].destinationCoord))
                // let chance = await this.getWinningChance()

                foundCommands.push(commands[j])
                xCommands.push(vectoriseGrid())
                foundChances.push(this.getWinningChanceHeuristic())
                if (!areCoordsEqual(commands[j].whoDoCommandCoord, commands[j].destinationCoord)) {
                    actionManager.undo()
                }
            }
        }

        if (foundCommands.length <= 1) {
            return [null, -1.0]
        }

        // let foundChances = this.getWinningChances(xCommands)
        assert(foundChances.length == foundCommands.length)
        let index = softmaxRandomIndex([...foundChances])
        // console.log(index)
        return [foundCommands[index], foundChances[index]]

        // tmp
        //console.log(`action: ${whooseTurn} ${JSON.stringify(bestCommand)}`)
        
    }
    doActions() {
        let i = 0;
        const hardLimit = 150
        //this.chosenGrids.push(vectoriseGrid())
        this.chosenGridsDebug.push(vectoriseGridDebug())
        this.commandsDebug.push(undefined)
        this.winningChances.push(this.getWinningChance())
        this.winningChancesHeuristic.push(this.getWinningChanceHeuristic())
        // console.log('start actions')
        let units_len = this.units.length
        for (; i < hardLimit; ++i) {
            let [bestCommand, chance] = this.selectBestCommand()
            if (!bestCommand || areCoordsEqual(bestCommand.whoDoCommandCoord, bestCommand.destinationCoord)) {
                return
            }
            // console.log('did commands', JSON.stringify(bestCommand))
            let unit_again = grid.getCell(bestCommand.whoDoCommandCoord).unit;
            assert(unit_again.isMyTurn)
            unit_again.select()
            unit_again.sendInstructions(grid.getCell(bestCommand.destinationCoord))
            //this.chosenGrids.push(vectoriseGrid())
            this.chosenGridsDebug.push(vectoriseGridDebug())
            this.commandsDebug.push(bestCommand)
            this.winningChances.push(chance)
            this.winningChancesHeuristic.push(this.getWinningChanceHeuristic())

            this.updateUnits()
            assert(units_len == this.units.length)
        }
        console.log('reached hard limit')
    }
    nextTurn() {
        super.nextTurn()

        // console.log('ai doing things')
        // this.doActions()
        // console.log('did action', whooseTurn) 
        // })
        // .catch(err => console.error('Error loading model:', err));
        
    }
}