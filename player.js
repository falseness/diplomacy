// Statistics only: demons are never bought, so armyCost uses these prices.
const DEMON_COSTS = Object.freeze({imp: 20, spitter: 20, clawling: 25, brute: 40,
    hound: 40, ravager: 40, hexcaster: 40, emberArcher: 40, bulwark: 60,
    demonLord: 60, demonQueen: 60, bombard: 60, mortar: 80})
class Player {
    constructor(color, gold = 100) {
        this.gold = gold
        this.economyEnabled = true
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
    get role() {
        if (this instanceof NeutralPlayer) return 'NEUTRAL'
        if (gameSettings.coop && players.indexOf(this) === gameSettings.coop.demonSlot)
            return 'DEMONS'
        return 'HUMAN'
    }
    get showsUnitSalary() {
        return this.role !== 'DEMONS'
    }
    get team() {
        if (gameSettings.coop && gameSettings.coop.humanSlots.includes(players.indexOf(this)))
            return gameSettings.coop.humanTeam
        return this.role === 'DEMONS' ? 'DEMONS' : players.indexOf(this)
    }
    isAlliedWith(other) {
        return this === other || Boolean(gameSettings.coop && this.role === 'HUMAN' &&
            other.role === 'HUMAN' && this.team === other.team)
    }
    // Nothing is ignored for pathing: demons path next to, hit and capture neutral towns too.
    ignoresCell(cell) {
        return false
    }
    // Kept apart from ignoresCell, which also decides passability. Demons capture
    // goldmines by stepping onto them, so nothing is excluded as an objective.
    ignoresObjective(cell) {
        return this.ignoresCell(cell)
    }
    canEnterBuilding(building) {
        return true
    }
    shouldRazeBuilding(building) {
        return false
    }
    updateUnits() {
        // Income/vectorization also calls this method. Keep a clean registry's
        // reference stable when there is no removal or adjacent duplicate.
        if (!this.units.some((unit, i) => unit.killed ||
            (i > 0 && unit === this.units[i - 1]))) return
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
            if (production[this.units[i].name]) {
              res += production[this.units[i].name].cost
                }
            else if (DEMON_COSTS[this.units[i].constructor.type]) {
              res += DEMON_COSTS[this.units[i].constructor.type]
                }
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
        if (this.economyEnabled === false) {
            return 0
        }
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
        const shared = gameSettings.coop && this.role === 'HUMAN'
        const viewers = shared ? players.filter(player =>
            player.role === 'HUMAN' && this.isAlliedWith(player)) : [this]
        for (const viewer of viewers) viewer.accumulateVision(shared)
    }
    accumulateVision(currentAssetsOnly = false) {
        for (const unit of this.units) {
            if (currentAssetsOnly && (unit.killed || unit.player !== this)) continue
            unit.changeFogOfWarByVision()
        }
        for (const town of this.towns) {
            if (currentAssetsOnly && (town.killed || town.player !== this)) continue
            for (const suburb of town.suburbs) {
                if (currentAssetsOnly && (!suburb.isSuburb || suburb.player !== this)) continue
                grid.visionWay.changeFogOfWarByVision(suburb.coord, grid.fogOfWar, SUBURBSVISIONRANGE)
            }
        }
    }
    nextTurn() {
        const openingSlots = gameSettings.pendingHotseatOpeningEconomy
        const openingIndex = !gameSettings.isOnline && !gameSettings.coop && openingSlots ?
            openingSlots.indexOf(players.indexOf(this)) : -1
        if (openingIndex >= 0) {
            openingSlots.splice(openingIndex, 1)
        } else {
            this.gold += this.income
            this.correctGoldminesIncome()
        }


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

    //tmp
    calculateDistancesToGridCenter() {
        if (this.units.length == 0) {
            return 0.0
        }
        let result = 0.0
        for (let i = 0; i < this.units.length; ++i) {
             result += Math.abs(this.units[i].coord.x - Math.floor(grid.arr.length / 2)) / Number(grid.arr.length) +
                Math.abs(this.units[i].coord.y - Math.floor(grid.arr[0].length / 2)) / Number(grid.arr[0].length)
        }
        return result / this.units.length
    }
    getWinningChanceHeuristic() {
        let otherPlayerTurn = whooseTurn == 1 ? 2 : 1

        if (players[otherPlayerTurn].isLost && this.isLost) {
            return 0.0
        }
        else if (players[otherPlayerTurn].isLost) {
            return 1.0
        }
        else if (this.isLost) {
            return -1.0
        }

        // todo: fix
        let result = 0.0
        // result += ((this.calculateCellsCount(whooseTurn) -
        //     this.calculateCellsCount(otherPlayerTurn)) / grid.arr.length / grid.arr[0].length / 1000.0)

        players[otherPlayerTurn].updateUnits()
        this.updateUnits()
        let otherHP = 0.0
        for (let i = 0; i < players[otherPlayerTurn].units.length; ++i) {
            otherHP += players[otherPlayerTurn].units[i].hp
        }

        //добавь:
        // метрика - насколько близок к центру доски

        let myHP = 0.0
        for (let i = 0; i < this.units.length; ++i) {
            myHP += this.units[i].hp
        }
        result += (myHP - otherHP) / 6.0
        let ourMetric = this.calculateDistancesToGridCenter()

        let otherMetric = players[otherPlayerTurn].calculateDistancesToGridCenter()
        result -= (ourMetric - otherMetric) / 36.0

        if (result > 1.0) {
            result = 1.0
        }
        if (result < -1.0) {
            result = -1.0
        }

        return result
    }
}
// Demon phases refresh units only; portal/terminal rules decide their lifetime.
class DemonPlayer extends Player {
    // Demons earn and pay like a human player (gold starts at 0); towns, suburbs,
    // goldmines and salaries all use the base Player economy.
    constructor(color, gold = 0) {
        super(color, gold)
        this.economyEnabled = true
    }
    // Demons capture (never raze) a town once its HP is down, like a human, and
    // capture a goldmine by stepping onto it (ownership is the hex colour). Their
    // own live buildings (portal, captured towns, farms, barracks) are enterable
    // like a human's, so produced units can leave a producer hex.
    canEnterBuilding(building) {
        return building.isEmpty() || (building.isNature && building.isPassable) ||
            building instanceof Goldmine ||
            this.canCaptureTown(building) ||
            (!building.killed && building.playerColor === players.indexOf(this))
    }
    canCaptureTown(building) {
        return building.notEmpty() && building.isTown() && !building.killed &&
            !building.hp && building.playerColor !== players.indexOf(this)
    }
    get isLost() { return false }
    // Bankruptcy never disbands demons (portal waves are unpaid): nextTurn still
    // resets a negative balance to 0, so the demons simply cannot buy anything.
    crisisPenalty() {}
    // SimpleAiPlayerWithEconomy's spending logic run against this player: gold,
    // income, towns and units forward here, so every purchase is charged to the
    // demon slot and produced units are ordinary classes owned by it.
    get economyAI() {
        if (this.demonEconomyAI) return this.demonEconomyAI
        const demon = this
        const ai = Object.create(SimpleAiPlayerWithEconomy.prototype)
        for (const key of ['gold', 'income', 'towns', 'aiInitialTownCount'])
            Object.defineProperty(ai, key, {get: () => demon[key], set: value => { demon[key] = value }})
        // The economy sees only the army it pays for: unpaid portal-wave units
        // (salary 0) would otherwise fill the unit cap and block every purchase.
        Object.defineProperty(ai, 'units', {get: () => demon.units.filter(unit => unit.salary > 0),
            set: value => { demon.units = value }})
        ai.getPlayerIndex = () => players.indexOf(demon)
        // Salary guard: a unit is only bought while net income still covers its
        // salary plus the salaries of units already in production.
        ai.addProductionChoices = function(choices, producer, products) {
            const start = choices.length
            SimpleAiPlayerWithEconomy.prototype.addProductionChoices.call(this, choices, producer, products)
            const upkeep = demon.income - demon.pendingUnitSalary
            for (let i = choices.length - 1; i >= start; --i) {
                const unitClass = production[choices[i].product].class
                if (AI_UNIT_PRODUCTS.includes(choices[i].product) && upkeep < unitClass.salary)
                    choices.splice(i, 1)
            }
        }
        return this.demonEconomyAI = ai
    }
    get pendingUnitSalary() {
        let salary = 0
        for (const town of this.towns) {
            if (town.killed) continue
            for (const producer of [town, ...town.buildings]) {
                if (!producer.killed && producer.isPreparingUnit)
                    salary += production[producer.unitProduction.name].class.salary
            }
        }
        return salary
    }
    spendGold() {
        const ai = this.economyAI
        if (this.aiInitialTownCount === undefined)
            this.aiInitialTownCount = ai.getLiveTownCount(this)
        // One growth purchase (farm/suburb, first barrack), then the war mode's
        // army purchases (units up to the cap, a barrack per town, suburbs).
        ai.spendEconomyGold()
        ai.spendWarGoldWithinLimit(ai.inspectEconomy().towns.length > 1 ?
            AI_ECONOMY_PRE_MOVE_PURCHASE_LIMIT : 1)
        // Surplus gold goes to units, barracks, farms and suburbs (salary guard still applies).
        ai.spendDownGold()
    }
    play() {
        this.spendGold()
        // Reuse the combat-only controller without replacing demon ownership or
        // invoking a normal player's economy/turn hooks.
        if (!this.combatAI) this.combatAI = new SimpleAiPlayer(this.color, 0)
        this.combatAI.units = this.units
        this.combatAI.play()
    }
    nextTurn() {
        this.updateUnits()
        super.nextTurn()
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

        let building = arr[i][j].building
        if (building.isTown && building.isTown()) {
            building.destroy()
        }
        else {
            building.kill()
        }

        arr[i][j].unit.kill()

        arr[i][j].hexagon.sudoPaint(0)
        arr[i][j].hexagon.isSuburb = false

        arr[i][j].building = new Sea(i, j)
    }
    suddenDeath() {
        let suddenDeathCycle = gameRound - suddenDeathRound

        // only odd cycle
        if (suddenDeathCycle % 2)
            return

        suddenDeathCycle /= 2

        if (gameSettings.mapShape && gameSettings.mapShape.type == 'hexagonal') {
            this.radialSuddenDeath(suddenDeathCycle, gameSettings.mapShape)
            return
        }

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
    radialSuddenDeath(suddenDeathCycle, mapShape) {
        let arr = grid.arr
        let floodedLayer = mapShape.radius - suddenDeathCycle
        if (floodedLayer < 0)
            return

        for (let x = 0; x < arr.length; ++x) {
            for (let y = 0; y < arr[x].length; ++y) {
                if (!arr[x][y].building.isMapEdge &&
                    getHexagonalLayer(x, y, mapShape.center) == floodedLayer)
                    this.floodCell(x, y)
            }
        }
    }
    get coopResult() {
        if (!gameSettings.coop) return null
        const humansGone = players.filter(p => p.role === 'HUMAN').every(p => p.isLost)
        const portalsRemain = external.some(p => p.isDemonPortal && !p.killed && p.hp > 0)
        // Any live demon-owned unit counts, including produced Noob/Archer/...
        const demonsRemain = players.some(p => p.role === 'DEMONS' &&
            p.units.some(u => !u.killed && u.hp > 0))
        // Victory also needs every demon-held town retaken or destroyed.
        const demonTownsRemain = players.some(p => {
            if (p.role !== 'DEMONS') return false
            p.updateTowns()
            return p.towns.length > 0
        })
        const enemiesGone = !portalsRemain && !demonsRemain && !demonTownsRemain
        if (humansGone && enemiesGone) return 'draw'
        if (humansGone) return 'defeat'
        if (enemiesGone) return 'victory'
        return null
    }
    get isGameEnded() {
        if (gameSettings.coop) {
            gameSettings.coop.result = this.coopResult
            return gameSettings.coop.result !== null
        }
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

// During automatic phases the displayed mask still belongs to the human team.
// Construction/load can call mutation hooks before the fog machinery exists.
function refreshCoopVision() {
    if (!isFogOfWar || !gameSettings.coop || !grid.visionWay) return
    const viewer = players[gameSettings.coop.humanSlots[0]]
    if (viewer) viewer.changeFogOfWarByVision()
}
