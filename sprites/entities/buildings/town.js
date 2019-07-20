class Town extends Building {
    constructor(x, y, gold = 12, firstTown = false) {
        const hp = 20
        const healSpeed = 4
        super(x, y, 'town', hp, healSpeed)

        this.suburbs = []
        this.buildings = []
        this.units = []

        this.createFirstSuburbs(firstTown)

        this.gold = gold

        this.newProduction = new Production()
        this.production = {
            noob: new UnitProduction(1, 10, Noob), //1 10
            farm: new FarmProduction(4, 12, Farm, 3),
            suburb: new SuburbProduction(0, 1),
            archer: new UnitProduction(2, 20, Archer), //2 20
            KOHb: new UnitProduction(3, 25, KOHb),
            normchel: new UnitProduction(3, 30, Normchel)
        }
        this.finishPreparing()
    }
    createFirstSuburbs(firstTown) {
        this.suburbs.push(grid.arr[this.coord.x][this.coord.y])
        grid.arr[this.coord.x][this.coord.y].hexagon.setIsSuburb(true)

        let neighboursCoord = this.getNeighbours()

        for (let i = 0; i < neighboursCoord.length; ++i) {
            let cell = grid.arr[neighboursCoord[i].x][neighboursCoord[i].y]

            if (firstTown)
                cell.hexagon.repaint(this.getPlayer())

            if (cell.hexagon.getPlayer() == this.getPlayer()) {
                this.suburbs.push(cell)
                cell.hexagon.setIsSuburb(true)
            }
        }
    }
    getPlayer() {
        return grid.arr[this.coord.x][this.coord.y].hexagon.getPlayer()
    }
    getInfo() {
        let town = super.getInfo()

        town.link = this

        let income = this.getIncome()
        town.info.gold = this.gold + ' (' + ((income > 0) ? '+' : '') + income + ')'

        town.production = {}
        for (let i in this.production) {
            town.production[i] = this.production[i];
        }

        if (this.isPreparing()) {
            town.info.train = this.preparation.what
            town.info.turns = this.preparation.turns
        }
        return town
    }
    needInstructions() {
        return this.newProduction.isWaitingForInstructionsToCreate()
    }
    select() {
        this.updateSuburbsArray()

        entityInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())
        if (this.isMyTurn())
            townInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())

        return true
    }
    removeSelect() {
        border.setVisible(false)
        grid.setDrawLogicText(false)
        entityInterface.setVisible(false)
        townInterface.setVisible(false)

        if (this.newProduction.isWaitingForInstructionsToCreate())
            this.finishPreparing()
    }
    sendInstructions(cell) {
        if (this.newProduction.canCreateSomething(cell, this)) {
            if (!this.newProduction.create(cell, this))
                return false
        }

        this.removeSelect()

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
        if (this.isPreparing() || this.gold < this.production[what].cost)
            return false

        this.preparation = {
            what: what,
            turns: this.production[what].turns
        }

        this.newProduction = this.production[this.preparation.what]

        if (this.newProduction.isWaitingForInstructionsToCreate())
            this.newProduction.tryToCreate(this, this.getPlayer())
        else
            this.gold -= this.newProduction.cost

        return true
    }
    isPreparing() {
        return (this.preparation.turns || this.newProduction.isWaitingForInstructionsToCreate())
    }
    finishPreparing() {
        this.preparation = {
            what: "nothing",
            turns: 0
        }
        this.newProduction = new Production()
    }
    crisisPenalty() {
        while (this.units.length)
            this.units[0].kill()

        this.units = []

        this.gold = 0
    }
    tryToEndPreparing() {
        if (this.production[this.preparation.what].tryToCreate(this, this.getPlayer())) {

            this.finishPreparing()
        } else {
            this.preparation.turns++
        }
    }
    preparingLogic() {
        if (!this.isPreparing())
            return

        --this.preparation.turns

        if (!this.isPreparing())
            this.tryToEndPreparing()
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
            if (this.suburbs[i].hexagon.getPlayer() != this.getPlayer())
                this.suburbs.splice(i--, 1)
        }
    }
    nextTurn(whooseTurn) {
        this.updateUnitsArray()
        this.updateSuburbsArray()
        if (!this.isMyTurn())
            return
        super.nextTurn(whooseTurn)

        this.newProduction.nextTurn(this)

        this.preparingLogic()

        this.gold += this.getIncome()
        if (this.gold < 0)
            this.crisisPenalty()

    }
    draw(ctx) {
        super.draw(ctx)

        this.newProduction.draw(ctx)

    }
}

function townEvent(production) {

    let town = gameEvent.getSelected()
    if (town.prepare(production)) {

        town.select()
        let color = players[town.getPlayer()].getHexColor()
            //entityInterface.change(town.getInfo(), color)
    }

}
/*
Town слишком огромный класс
есть смысл вынести prepare из него
и так же уменьшить классы Production



Добавь новую продукцию - пригородная клетка
Чуть-чуть добалансь цены

займись grapnel ninja (сделай нормальный крюк + визуальные эффекты)
*/

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

            /*if (arr[v.coord.x][v.coord.y].hexagon.player != player)
                continue*/

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
        /*paintTownBorders(town, suburbs, arr, player)
        {
            let indent = arr.length + 1
            
            let used = []
            let distance = []
            let canReachThisHexagons = []

            for (let i = 0; i <= indent * 2; ++i)
            {
                used.push([])
                distance.push([])
            }
            
            distance[indent][indent] = 0
            used[indent][indent] = 1

            let marginX = town.coord.x
            let marginY = town.coord.y
            
            let Q = []
            Q.push([0, 0])

            while (Q.length > 0)
            {
                let v = Q.shift()
                
                
                let vRealX = v[0] + marginX
                let vRealY = v[1] + marginY
                let neighbours = arr[vRealX][vRealY].hexagon.getNeighbours()
                let isVSuburb = this.isSuburb(vRealX, vRealY, arr, player)
                
                if (!isVSuburb)
                {
                    canReachThisHexagons.push({cell: arr[vRealX][vRealY], cantReach: [false, false, false, false, false, false]})
                }
                for (let i = 0; i < neighbours.length; ++i)
                {
                    let x = neighbours[i][0] - marginX
                    let y = neighbours[i][1] - marginY
                    for (let j = 0; j < canReachThisHexagons.length; ++j)
                    {
                        for (let k = 0; k < canReachThisHexagons[j].cantReach.length; ++k)
                        {
                            if (this.isEqually(arr[neighbours[i][0]][neighbours[i][1]].hexagon, canReachThisHexagons[j].cantReach[k]))
                                canReachThisHexagons[j].cantReach[k] = false
                        }
                    }
                    
                    if (!isVSuburb && !this.isSuburb(neighbours[i][0], neighbours[i][1], arr, player))
                    {
                        canReachThisHexagons[canReachThisHexagons.length - 1].cantReach[i] = arr[neighbours[i][0]][neighbours[i][1]].hexagon
                        
                        continue
                    }
                    if (!used[x + indent][y + indent])
                    {
                        used[x + indent][y + indent] = 1
                        Q.push(neighbours[i])
                        
                        distance[x + indent][y + indent] = distance[v[0]][v[1]] + 1
                    }
                }
            }
            
            
            for (let i = 0; i < canReachThisHexagons.length; ++i)
            {
                for (let j = 0; j < canReachThisHexagons[i].cantReach.length; ++j)
                {
                    if (canReachThisHexagons[i].cantReach[j])
                    {
                        border.drawLine(canReachThisHexagons[i].cell.hexagon.getPos(), j)
                    }
                }
            }
        }*/
}