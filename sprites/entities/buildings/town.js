let townProduction = { 
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
        turns: 4,
        cost: 8,
        class: Farm,
    },
    archer: {
        production: UnitProduction,
        turns: 2,
        cost: 20,
        class: Archer
    },
    KOHb: {
        production: UnitProduction,
        turns: 3,
        cost: 25,
        class: KOHb
    },
    normchel: {
        production: UnitProduction,
        turns: 3,
        cost: 30,
        class: Normchel
    },
    catapult: {
        production: UnitProduction,
        turns: 4,
        cost: 35,
        class: Catapult
    },
    barrack: {
        production: ManufactureProduction,
        turns: 4, //4 20
        cost: 20,
        class: Barrack,
    },
}
class Town extends Building {
    constructor(x, y, gold = 12, firstTown = false) {
        const hp = 12
        const healSpeed = 3
        super(x, y, 'town', hp, healSpeed)
        players[this.getPlayer()].addTown(this)
        
        this.suburbs = []
        this.buildings = []
        this.units = []

        this.createFirstSuburbs(firstTown)

        this.gold = gold

        // unit production can training only one
        // building production can train several
        // active production waiting for instructions
        
        this.buildingProduction = []
        this.unitProduction = new Empty()
        this.activeProduction = new Empty()
        //this.newProduction = new Production()
    }
    createFirstSuburbs(firstTown) {
        this.suburbs.push(grid.arr[this.coord.x][this.coord.y].hexagon)
        grid.arr[this.coord.x][this.coord.y].hexagon.setIsSuburb(true)

        let neighboursCoord = this.getNeighbours()

        for (let i = 0; i < neighboursCoord.length; ++i) {
            let hexagon = grid.arr[neighboursCoord[i].x][neighboursCoord[i].y].hexagon

            if (firstTown)
                hexagon.repaint(this.getPlayer())

            if (hexagon.getPlayer() == this.getPlayer()) {
                this.suburbs.push(hexagon)
                hexagon.setIsSuburb(true)
            }
        }
    }
    addSuburb(hexagon) {
        this.suburbs.push(hexagon)
    }
    getGold() {
        return this.gold
    }
    minusGold(count) {
        this.gold -= count
    }
    getPlayer() {
        return grid.arr[this.coord.x][this.coord.y].hexagon.getPlayer()
    }
    getInfo() {
        let town = super.getInfo()

        //town.link = this

        let income = this.getIncome()
        town.info.gold = this.gold + ' (' + ((income > 0) ? '+' : '') + income + ')'
        
        if (this.activeProduction.notEmpty())
            town.activeProduction = this.activeProduction.getName() 

        if (this.isPreparingUnit()) {
            town.info.train = this.unitProduction.getName()
            town.info.turns = this.unitProduction.turns
        }
        return town
    }
    needInstructions() {
        return this.activeProduction.notEmpty()
    }
    select() {
        this.updateSuburbsArray()

        super.select()
        if (this.isMyTurn())
            townInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())

        return true
    }
    removeSelect() {
        border.setVisible(false)
        grid.setDrawLogicText(false)
        super.removeSelect()
        townInterface.setVisible(false)

        this.activeProduction = new Empty()
    }
    sendInstructions(cell) {
        if (!this.activeProduction.canCreateOnCell(cell, this)) {
            
            this.removeSelect()
            this.activeProduction = new Empty()
            
            return true
        }
            
        let stillNeedInstructions = this.activeProduction.sendInstructions(cell.hexagon.coord, this)
        
        if (!this.activeProduction.isSuburbProduction()) {
            this.buildingProduction.push(this.activeProduction)
            grid.arr[cell.hexagon.coord.x][cell.hexagon.coord.y].building = this.activeProduction
        }
        
        if (stillNeedInstructions) {
            this.select()
            
            if (!this.activeProduction.isSuburbProduction()) {
                let what = this.activeProduction.getName()
                
                this.activeProduction = new townProduction[what].production(
                    townProduction[what].turns, townProduction[what].cost, 
                    townProduction[what].class, what)
                this.activeProduction.choose(this)
            }
            return false
        }
        this.removeSelect()
        this.activeProduction = new Empty()
        return true
    }
    getIncome() {
        const suburbIncome = 1

        let income = 0
        income += this.suburbs.length * suburbIncome

        for (let i = 0; i < this.buildings.length; ++i) {
            income += this.buildings[i].getIncome()
        }
        for (let i = 0; i < this.units.length; ++i) {
            income -= this.units[i].getSalary()
        }
        return income
    }
    prepare(what) {
        // bug: unit production with prepare time == 0 cant be prepared
        if (this.gold < townProduction[what].cost)
            return false
        if (this.unitProduction.notEmpty() && (new townProduction[what].production).isUnitProduction())
            return false

        this.activeProduction = new townProduction[what].production(
            townProduction[what].turns, townProduction[what].cost, 
            townProduction[what].class, what)

        if (this.activeProduction.isUnitProduction()) {
            this.gold -= this.activeProduction.cost
            
            this.unitProduction = this.activeProduction
            this.activeProduction = new Empty()
        }
        else if (this.activeProduction.isBuildingProduction()) {
            this.activeProduction.choose(this)
        }
        else {
            console.log("ERROR not UnitProduction and not BuildingProduction")
        }
        return true
    }
    isPreparingUnit() {
        return this.unitProduction.notEmpty()
    }
    kill() {
        for (let i = 0; i < this.units.length; ++i) {
            this.units[i].kill()
            this.units.splice(i--, 1)
        }
        
        super.kill()
    }
    crisisPenalty() {
        while (this.units.length)
            this.units[0].kill()

        this.units = []

        this.gold = 0
    }
    unitPreparingLogic() {
        if (this.unitProduction.isEmpty())
            return
        
        let preparingFinished = this.unitProduction.nextTurn()
        if (!preparingFinished)
            return
            
        if (grid.arr[this.coord.x][this.coord.y].unit.notEmpty()) {
            this.unitProduction.cantCreateNow()
            return
        }
        let newUnit = this.unitProduction.create(this.coord.x, this.coord.y, this)
        this.units.push(newUnit)
        
        this.unitProduction = new Empty()
    }
    buildingPreparingLogic() {
        for (let i = 0; i < this.buildingProduction.length; ++i) {
            let preparingFinished = this.buildingProduction[i].isPreparingFinished()
            if (preparingFinished) {
                let building = this.buildingProduction[i].create()
                this.buildings.push(building)
                this.buildingProduction.splice(i--, 1)
            }
        }
    }
    updateBuildingsProductionArray() {
        for (let i = 0; i < this.buildingProduction.length; ++i) {
            if (this.buildingProduction[i].isKilled()) {
                this.buildingProduction.splice(i--, 1)
            }
        }
    }
    preparingLogic() {
        this.unitPreparingLogic()
        this.buildingPreparingLogic()
    }
    updateBuildingsArray() {
        for (let i = 0; i < this.buildings.length; ++i) {
            if (this.buildings[i].isKilled())
                this.buildings.splice(i--, 1)
        }
    }
    updateUnitsArray() {
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].isKilled())
                this.units.splice(i--, 1)
        }
    }
    updateSuburbsArray() {
        for (let i = 0; i < this.suburbs.length; ++i) {
            if (this.suburbs[i].getPlayer() != this.getPlayer())
                this.suburbs.splice(i--, 1)
        }
    }
    startTurn() {
        super.nextTurn(whooseTurn)

        this.gold += this.getIncome()
        if (this.gold < 0)
            this.crisisPenalty()
        
        this.preparingLogic()
    }
    nextTurn(whooseTurn) {
        this.updateUnitsArray()
        this.updateSuburbsArray()
    }
    draw(ctx) {
        super.draw(ctx)
        /*for (let i = 0; i < this.buildingProduction.length; ++i) {
            this.buildingProduction[i].draw(ctx)
        }*/
    }
}

function prepareEvent(production) {

    let building = gameEvent.getSelected()
    if (building.prepare(production)) {
        building.select()
        return
    }
    gameEvent.removeSelection()
}


// Я НЕ ХОЧУ РЕФАКТОРИТЬ ЭТО ГОВНО

/*
class Production {
    constructor(turns = 1, cost = 1, _class = new Empty()) {
        this.turns = turns
        this.cost = cost
        this.class = _class
    }
    removeSelect() {
        return true
    }
    canCreateImmediately() {
        return !this.turns
    }
    canCreateSomething() {
        return false
    }
    nextTurn() {

    }
    isWaitingForInstructionsToCreate() {
        return false
    }
    isSuburb(coord, arr, player) {
        let hexagon = arr[coord.x][coord.y].hexagon

        return player == hexagon.player && hexagon.isSuburb()
    }
    draw() {

    }
    isBuildingProduction() {
        return false
    }
    isUnitProduction() {
        return true
    }
    notEmpty() {
        return true
    }
    isEmpty() {
        return false
    }
}
class UnitProduction extends Production {
    constructor(turns, cost, _class) {
        super(turns, cost, _class)
    }
    create(x, y, town) {
        let t = new this.class(x, y, town)

        town.units.push(t)
    }
    tryToCreate(town, player) {
        if (grid.arr[town.coord.x][town.coord.y].unit.isEmpty()) {
            this.create(town.coord.x, town.coord.y, town)

            return true
        }
        return false
    }
    isSuburb(coord, arr, player) {
        let hexagon = arr[coord.x][coord.y].hexagon

        return player == hexagon.player && hexagon.isSuburb()
    }
    isWaitingForInstructionsToCreate() {
        return false
    }
    isUnitProduction() {
        return true
    }
}
class FarmProduction extends Production {
    constructor(turns, cost, _class, income) {
        super(turns, cost, _class)
        this.income = income

        this.preparingStarted = false
        this.coord = { x: -1, y: -1 }
    }
    nextTurn(town) {
        if (!this.isSuburb(this.coord, grid.arr, town.getPlayer()) ||
            grid.arr[this.coord.x][this.coord.y].building.notEmpty()) {
            this.preparingStarted = false
            town.finishPreparing()
        }
    }
    isCellFit(cell, player) {
        return (this.isSuburb(cell.hexagon.coord, grid.arr, player) &&
            cell.building.isEmpty())
    }
    tryToCreate(town, player) {
        if (this.preparingStarted) {
            if (!this.isCellFit(grid.arr[this.coord.x][this.coord.y], this.player))
                return true

            let t = new this.class(this.coord.x, this.coord.y, this.income, town)

            town.buildings.push(t)

            this.preparingStarted = false
            return true
        }

        this.paintTownBorders(town, town.suburbs, grid.arr, town.getPlayer())

        return false
    }
    canCreateSomething(cell, town) {
        if (this.preparingStarted)
            return false

        return this.isCellFit(cell, town.getPlayer())
    }
    create(cell, town) {
        this.coord = Object.assign({}, cell.hexagon.coord)
        this.player = town.getPlayer()
        this.preparingStarted = true

        town.gold -= this.cost

        return true
    }
    isWaitingForInstructionsToCreate() {
        return !this.preparingStarted
    }
    paintTownBorders(town, suburbs, arr, player) {
        border.newBrokenLine()

        this.availableHexagons = []
        let used = new Array(arr.length)

        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j)
                used[i][j] = false
        }

        // search available for purchase cells
        for (let i = 0; i < suburbs.length; ++i) {
            let hexagon = suburbs[i].hexagon
            used[hexagon.coord.x][hexagon.coord.y] = true

            let neighbours = hexagon.getNeighbours()
            for (let j = 0; j < neighbours.length; ++j) {
                let neighbourCoord = neighbours[j]

                if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                    !this.isSuburb(neighbourCoord, arr, player)) {
                    border.createLine(hexagon.getPos(), j)
                    continue
                }

                if (this.isSuburb(neighbourCoord, arr, player) &&
                    !used[neighbourCoord.x][neighbourCoord.y]) {
                    this.availableHexagons.push(arr[neighbourCoord.x][neighbourCoord.y].hexagon)

                    used[neighbourCoord.x][neighbourCoord.y] = true
                }
            }
        }
    }
    isBuildingProduction() {
        return true
    }
    draw(ctx) {
        if (!this.preparingStarted || !this.isCellFit(grid.arr[this.coord.x][this.coord.y], this.player))
            return

        drawImageWithOpacity(ctx, 'farm', grid.arr[this.coord.x][this.coord.y].hexagon.getPos(), 0.5)
    }
}
class SuburbProduction extends Production {
    constructor(turns, cost, _class) {
        super(turns, cost, _class)
        this.availableHexagons = []
    }
    canCreateSomething(cell, town) {
        for (let i = 0; i < this.availableHexagons.length; ++i) {
            if (hexagonsEqually(this.availableHexagons[i], cell.hexagon)) {
                return town.gold >= this.suburbsCostformula(this.distance[cell.hexagon.coord.x][cell.hexagon.coord.y])
            }
        }
        return false
    }
    create(cell, town) {
        cell.hexagon.setIsSuburb(true)
        town.suburbs.push(cell)

        town.gold -= this.suburbsCostformula(this.distance[cell.hexagon.coord.x][cell.hexagon.coord.y])

        entityInterface.change(town.getInfo(), players[town.getPlayer()].getFullColor())
        townInterface.change(town.getInfo(), players[town.getPlayer()].getFullColor())

        this.tryToCreate(town, town.getPlayer())

        false
    }
    isWaitingForInstructionsToCreate() {
        return true
    }
    tryToCreate(town, player) {
        grid.cleanLogicText()

        this.paintTownBorders(town, town.suburbs, grid.arr, player)
    }
    suburbsCostformula(distance) {
        const mainCost = 1
        const diff = 2

        return mainCost + diff * (distance - 1)
    }
    getDistances(town, arr, player) {
        let used = new Array(arr.length)
        let distance = new Array(arr.length)
        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            distance[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j) {
                used[i][j] = false

                distance[i][j] = 0
            }
        }

        let Q = []
        Q.push(arr[town.coord.x][town.coord.y].hexagon)

        used[town.coord.x][town.coord.y] = true
        let suburbsUsedCount = 0

        while (Q.length > 0) {
            let v = Q.shift()


            let neighbours = v.getNeighbours()
            for (let i = 0; i < neighbours.length; ++i) {
                if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length))
                    continue

                if (!used[neighbours[i].x][neighbours[i].y]) {
                    distance[neighbours[i].x][neighbours[i].y] = distance[v.coord.x][v.coord.y] + 1
                    Q.push(arr[neighbours[i].x][neighbours[i].y].hexagon)

                    used[neighbours[i].x][neighbours[i].y] = true
                }
            }
            if (this.isSuburb(v.coord, arr, player))
                ++suburbsUsedCount

            if (suburbsUsedCount == town.suburbs.length)
                break
        }
        return distance
    }
    paintTownBorders(town, suburbs, arr, player) {
            // init
            border.newBrokenLine()
            grid.setDrawLogicText(true)

            this.distance = []
            this.availableHexagons = []
                //let suburbsNeighbours = []
            let used = new Array(arr.length)

            for (let i = 0; i < arr.length; ++i) {
                used[i] = new Array(arr[i].length)
                for (let j = 0; j < used[i].length; ++j)
                    used[i][j] = false
            }

            // search available for purchase cells
            for (let i = 0; i < suburbs.length; ++i) {
                let hexagon = suburbs[i].hexagon
                used[hexagon.coord.x][hexagon.coord.y] = true

                let neighbours = hexagon.getNeighbours()
                for (let j = 0; j < neighbours.length; ++j) {
                    let neighbourCoord = neighbours[j]

                    if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                        arr[neighbourCoord.x][neighbourCoord.y].hexagon.player != player) {
                        border.createLine(hexagon.getPos(), j)
                        continue
                    }

                    if (!this.isSuburb(neighbourCoord, arr, player) &&
                        !used[neighbourCoord.x][neighbourCoord.y]) {
                        this.availableHexagons.push(arr[neighbourCoord.x][neighbourCoord.y].hexagon)

                        used[neighbourCoord.x][neighbourCoord.y] = true
                    }
                }
            }

            // create border lines
            this.distance = this.getDistances(town, arr, player)

            for (let i = 0; i < this.availableHexagons.length; ++i) {
                let coord = { x: this.availableHexagons[i].coord.x, y: this.availableHexagons[i].coord.y }

                let cell = arr[coord.x][coord.y]
                let cost = this.suburbsCostformula(this.distance[coord.x][coord.y])
                cell.logicText.setText(cost)

                let posI = this.availableHexagons[i].getPos()

                let neighbours = this.availableHexagons[i].getNeighbours()

                for (let j = 0; j < neighbours.length; ++j) {
                    if (isCoordNotOnMap(neighbours[j]) ||
                        !used[neighbours[j].x][neighbours[j].y])
                        border.createLine(posI, j)
                }
            }


            // BFS for find out distance

        }
}*/