let production = {
    noob: {
        production: UnitProduction,
        turns: 1,
        cost: 10,
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
        turns: 2,
        cost: 12,
        class: Farm,
    },
    archer: {
        production: UnitProduction,
        turns: 2,
        cost: 15,
        class: Archer
    },
    normchel: {
        production: UnitProduction,
        turns: 3,
        cost: 25,
        class: Normchel
    },
    catapult: {
        production: UnitProduction,
        turns: 4,
        cost: 40,
        class: Catapult
    },
    KOHb: {
        production: UnitProduction,
        turns: 4,
        cost: 40,
        class: KOHb
    },
    barrack: {
        production: ManufactureProduction,
        turns: 3, //4 20
        cost: 20,
        class: Barrack,
    },
    wall: {
        production: ExternalProduction,
        turns: 4,
        cost: 3, 
        class: Wall
    }
}
class Town extends PreparingManufacture {
    constructor(x, y, justCopy = false, firstTown = false) {
        const hp = 15
        const healSpeed = 3
        const income = 4
        super(x, y, 'town', hp, healSpeed, income)
        this.player.towns.push(this)

        this.suburbs = []
        if (!justCopy)
            this.createFirstSuburbs(firstTown)
        if (firstTown) {
            new Noob(x, y)
        }

        // unit production can training only one
        // building production can train several
        // active production waiting for instructions
        this.buildings = []
        this.buildingProduction = []
        this.activeProduction = new Empty()
    }
    isTown() {
        return true
    }
    createFirstSuburbs(firstTown) {
        // костыль:
        //this.addUndo()
        grid.getHexagon(this.coord).isSuburb = true

        this.suburbs.push(grid.getHexagon(this.coord))

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
    toJSON() {
        let res = super.toJSON()

        this.updateSuburbs()
        this.updateBuildings()
        this.updateBuildingProduction()

        res.buildings = this.buildings
        res.buildingProduction = this.buildingProduction
        let suburbs = []
        for (let i = 0; i < this.suburbs.length; ++i) {
            suburbs.push(this.suburbs[i].coord)
        }
        res.suburbs = suburbs

        return res
    }
    toUndoJSON() {
        return JSON.parse(JSON.stringify(this.toJSON()))
    }
    get info() {
        let town = super.info

        if (this.activeProduction.notEmpty())
            town.activeProduction = this.activeProduction.name

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
    get income() {
        let income = super.income
        for (let i = 0; i < this.buildings.length; ++i) {
            if (this.buildings[i].killed) {
                this.buildings.splice(i--, 1)
                continue
            }
            income += this.buildings[i].income
        }
        let countSuburbs = 0
        for (let i = 0; i < this.suburbs.length; ++i) {
            if (this.suburbs[i].playerColor != this.playerColor ||
                !this.suburbs[i].isSuburb) {
                continue
            }
            ++countSuburbs
        }
        const suburbsIncome = 1
        income += countSuburbs * suburbsIncome
        return income
    }
    needInstructions() {
        return this.activeProduction.notEmpty()
    }
    select() {
        super.select()
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

        undoManager.lastUndo.production = {
            coord: {
                x: cell.coord.x,
                y: cell.coord.y
            }
        }
        if (this.activeProduction.isExternalProduction()) {
            undoManager.lastUndo.type = 'prepareBuilding'

            externalProduction.push(this.activeProduction)
            grid.setBuilding(this.activeProduction, cell.coord)
        }
        else if (!this.activeProduction.isSuburbProduction()) {
            undoManager.lastUndo.type = 'prepareBuilding'

            this.buildingProduction.push(this.activeProduction)
            grid.setBuilding(this.activeProduction, cell.coord)
        }
        else {
            undoManager.lastUndo.type = 'prepareSuburb'
        }

        if (stillNeedInstructions) {
            this.select()

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
    nextTurn() {
        super.nextTurn()
        this.updateSuburbs()
        this.buildingPreparingLogic()
        this.buildingsNextTurn()
    }
}

function prepareEvent(product) {
    let building = gameEvent.selected
    if (building.prepare(product)) {
        building.select()
        return
    }
    gameEvent.removeSelection()
}