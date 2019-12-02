class Player {
    constructor(color, gold = 0) {
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
    updateUnits() {
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
            }
        }
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
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
                continue
            }
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
}
class NeutralPlayer extends Player {
    constructor(color, gold = 0) {
        super(color, gold)
        this.hexagon = this.calcSuburbHexagon()

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

        arr[i][j].building = new Lake(i, j)
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