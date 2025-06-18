let production = {
    noob: {
        production: UnitProduction,
        turns: 1,
        cost: 20,
        class: Noob
    },
    suburb: {
        production: SuburbProduction,
        turns: 0,
        cost: 1,
        class: Empty
    },
    farm: {
        production: ManufactureProduction,
        turns: 1,
        cost: 24,
        class: Farm,
    },
    archer: {
        production: UnitProduction,
        turns: 2,
        cost: 40,
        class: Archer
    },
    KOHb: {
        production: UnitProduction,
        turns: 2,
        cost: 40,
        class: KOHb
    },
    normchel: {
        production: UnitProduction,
        turns: 2,
        cost: 40,
        class: Normchel
    },
    catapult: {
        production: UnitProduction,
        turns: 4,
        cost: 60,
        class: Catapult
    },
    barrack: {
        production: ManufactureProduction,
        turns: 3, //4 20
        cost: 25,
        class: Barrack,
    },
    wall: {
        production: ExternalProduction,
        turns: 4,
        cost: 4, 
        class: Wall
    },
    bastion: {
        production: ExternalProduction,
        turns: 4,
        cost: 20, 
        class: Bastion
    },
    tower: {
        production: ExternalProduction,
        turns: 4,
        cost: 30, 
        class: Tower
    },
}
class Town extends PreparingManufacture {
    static maxHP = 10
    static healSpeed = 2
    static income = 4
    constructor(x, y, justCopy = false, firstTown = false) {
        super(x, y, 'town')
        this.rangeIncrease = 1
        this.suburbs = []
        this.updatePlayer()
        this.isRecentlyCaptured = false

        if (!justCopy)
            this.createFirstSuburbs(firstTown)
        if (firstTown === true) {
            new Noob(x, y)
        }

        // unit production can training only one
        // building production can train several
        // active production waiting for instructions
        this.buildings = []
        this.buildingProduction = []
        this.activeProduction = new Empty()
    }
    updateSuburbsAndBuildings() {
        for (let i = 0; i < this.suburbs.length; ++i) {
            let cell = grid.getCell(this.suburbs[i].coord)
            if (cell.unit.notEmpty()) {
                if (cell.building.isManufacture)
                    cell.building.kill()
                cell.hexagon.isSuburb = false
                this.suburbs.splice(i--, 1)
                continue
            }
            else if (cell.building.canBeDestroyed) {
                if (cell.building.isManufacture) {
                    if (coordsEqually(cell.hexagon.coord, this.coord)) { // town cell
                        this.suburbs[i].sudoPaint(this.playerColor)
                        continue
                    }

                }
                else if (cell.building.isExternalProduction()){ 
                    actionManager.lastAction.townExternalProduction.push(cell.building.toUndoJSON())
                }
                else if (cell.building.isExternal) {
                    actionManager.lastAction.townExternal.push(cell.building.toUndoJSON())
                }
                else {
                    console.log('error')
                }
                cell.building.kill()
            }
            this.suburbs[i].sudoPaint(this.playerColor)
        }
    }
    updatePlayer() {
        this.player.towns.push(this)
        grid.getHexagon(this.coord).isSuburb = true

        // first suburb must be town suburb
        
        this.updateSuburbsAndBuildings()
    }
    get isHitable() {
        return this.hp
    }
    hit(dmg) {
        this.hp -= dmg
        this.wasHitted = true
        if (this.hp < 0)
            this.hp = 0
        
        this.updateHPBar()
        
        return this.killed
    }
    get isStandable() {
        return !this.hp
    }
    get isBadlyDamaged() {
        return !this.hp
    }
    isBarrier() {
        return true
    }
    isTown() {
        return true
    }
    createFirstSuburbs(firstTown) {
        // костыль:
        //this.addUndo()
        grid.getHexagon(this.coord).isSuburb = true

        this.suburbs.push(grid.getHexagon(this.coord))

        if (firstTown == -1) //neutral town
            return

        let neighboursCoord = this.neighbours

        for (let i = 0; i < neighboursCoord.length; ++i) {
            let hexagon = grid.getHexagon(neighboursCoord[i])

            if (firstTown)
                hexagon.firstpaint(this.playerColor)

            if (hexagon.playerColor == this.playerColor) {
                hexagon.isSuburb = true
            this.suburbs.push(hexagon)
            }
        }
    }
    get canBeDestroyed() {
        return this.isRecentlyCaptured
    }
    destroy() {
        for (let i = 0; i < this.buildings.length; ++i) {
            this.buildings[i].destroy()
        }
        for (let i = 0; i < this.buildingProduction.length; ++i) {
            this.buildingProduction[i].destroy()
        }
        for (let i = 0; i < this.suburbs.length; ++i) {
            this.suburbs[i].isSuburb = false
        }
        super.destroy()
    }
    toJSON() {
        let res = super.toJSON()

        //this.updateSuburbs()
        this.updateBuildings()
        this.updateBuildingProduction()

        res.buildings = this.buildings
        res.buildingProduction = this.buildingProduction
        let suburbs = []
        for (let i = 0; i < this.suburbs.length; ++i) {
            suburbs.push(this.suburbs[i].coord)
        }
        res.suburbs = suburbs
        res.isRecentlyCaptured = this.isRecentlyCaptured

        return res
    }
    toUndoJSON() {
        return JSON.parse(JSON.stringify(this.toJSON()))
    }
    get info() {
        let town = super.info
        town.info['range increase'] = this.rangeIncrease
        if (this.activeProduction.notEmpty())
            town.activeProduction = this.activeProduction.name

        if (this.isBadlyDamaged) {
            town.isBadlyDamaged = true
            if (town.info.turns)
                town.info.turns = "\u221E" + ' (' + town.info.turns + ')'
        }
        return town
    }
    updateBuildings() {
        for (let i = 0; i < this.buildings.length; ++i) {
            if (this.buildings[i].killed) {
                this.buildings.splice(i--, 1)
            }
        }
    }
    updateBuildingProduction() {
        for (let i = 0; i < this.buildingProduction.length; ++i) {
            if (this.buildingProduction[i].killed) {
                this.buildingProduction.splice(i--, 1)
            }
        }
    }
    updateSuburbs() {
        for (let i = 0; i < this.suburbs.length; ++i) {
            if (this.suburbs[i].playerColor != this.playerColor ||
                !this.suburbs[i].isSuburb) {
                this.suburbs.splice(i--, 1)
            }
        }
    }
    get suburbsCount() {
        let countSuburbs = 0
        for (let i = 0; i < this.suburbs.length; ++i) {
            if (this.suburbs[i].playerColor != this.playerColor ||
                !this.suburbs[i].isSuburb) {
                continue
            }
            ++countSuburbs
        }
        return countSuburbs
    }
    get income() {
        let income = super.income
        for (let i = 0; i < this.buildings.length; ++i) {
            if (this.buildings[i].killed) {
                this.buildings.splice(i--, 1)
                continue
            }
            income += this.buildings[i].income
        }
        let countSuburbs = this.suburbsCount
        const suburbsIncome = 1
        income += countSuburbs * suburbsIncome
        return income
    }
    needInstructions() {
        return this.activeProduction.notEmpty()
    }
    select(isNeedToChangeBorder) {
        super.select(isNeedToChangeBorder)
        if (this.isMyTurn)
            townInterface.change(this.info, this.player.fullColor)
    }
    removeSelect() {
        border.visible = false
        grid.drawLogicText = false
        super.removeSelect()
        townInterface.visible = false

        this.activeProduction = new Empty()
    }
    sendInstructions(cell) {
        if (!this.activeProduction.canCreateOnCell(cell, this)) {
            this.removeSelect()

            return true
        }
        this.addThisUndo()

        let stillNeedInstructions = this.activeProduction.sendInstructions(cell.coord, this)

        actionManager.lastAction.production = {
            coord: {
                x: cell.coord.x,
                y: cell.coord.y
            }
        }
        if (this.activeProduction.isExternalProduction()) {
            actionManager.lastAction.type = 'prepareBuilding'

            externalProduction.push(this.activeProduction)
            grid.setBuilding(this.activeProduction, cell.coord)
        }
        else if (!this.activeProduction.isSuburbProduction()) {
            actionManager.lastAction.type = 'prepareBuilding'

            this.buildingProduction.push(this.activeProduction)
            grid.setBuilding(this.activeProduction, cell.coord)
        }
        else {
            actionManager.lastAction.type = 'prepareSuburb'
        }

        if (stillNeedInstructions) {
            this.select(false)

            if (!this.activeProduction.isSuburbProduction()) {
                let what = this.activeProduction.name

                this.activeProduction = new production[what].production(
                    production[what].turns, production[what].cost,
                    production[what].class, what)
                this.activeProduction.choose(this)
            }
            return false
        }
        this.removeSelect()
        this.select()
        return false
    }
    startBuildingPreparing(what) {
        //this.minusGold(production[what].cost)
        // production will minus gold town
        this.activeProduction = new production[what].production(
            production[what].turns, production[what].cost,
            production[what].class, what)

        this.activeProduction.choose(this)
    }
    prepare(what) {
        if (this.isBadlyDamaged)
            return false
        // bug: unit production with prepare time == 0 cant be prepared
        if (production[what].production.isUnitProduction())
            return super.prepare(what)

        if (this.gold < production[what].cost)
            return false
        
        this.startBuildingPreparing(what)

        return true
    }
    buildingPreparingLogic() {
        for (let i = 0; i < this.buildingProduction.length; ++i) {
            if (this.buildingProduction[i].killed) {
                this.buildingProduction.splice(i--, 1)
                continue
            }

            this.buildingProduction[i].nextTurn()

            let preparingFinished = this.buildingProduction[i].isPreparingFinished()
            if (preparingFinished) {
                let building = this.buildingProduction[i].create()
                this.buildings.push(building)
                this.buildingProduction.splice(i--, 1)
            }
        }
    }
    buildingsNextTurn() {
        for (let i = 0; i < this.buildings.length; ++i) {
            if (this.buildings[i].killed) {
                this.buildings.splice(i--, 1)
                continue
            }
            this.buildings[i].nextTurn()
        }
    }
    get barracksCount() {
        let res = 0
        for (let i = 0; i < this.buildings.length; ++i) {
            res += this.buildings[i].isPreparingManufacture
        }
        return res
    }
    unitPreparingLogic() {
        if (this.isBadlyDamaged)
            return 
        super.unitPreparingLogic()
    }
    nextTurn() {
        super.nextTurn()

        this.updateSuburbs()
        if (!this.isBadlyDamaged)
            this.buildingPreparingLogic()
        this.buildingsNextTurn()

        this.isRecentlyCaptured = false
    }
}

function prepareEvent(product) {
    let building = gameEvent.selected
    if (building.prepare(product)) {
        building.select(false)
        return
    }
    gameEvent.removeSelection()
}