class Town extends Building
{
    constructor(x, y, player)
    {
        let hp = 50
        super(x, y, 'town', hp, player)
        
        this.suburbs = []
        let neighboursCoord = this.getNeighbours()
        for (let i = 0; i < neighboursCoord.length; ++i)
        {
            let cell = grid.arr[neighboursCoord[i].x][neighboursCoord[i].y]
            if (cell.hexagon.getPlayer() == this.player)
            {
                this.suburbs.push(cell)
                cell.hexagon.setIsSuburb(true)
            }
        }
        this.suburbs.push(grid.arr[this.coord.x][this.coord.y])
        grid.arr[this.coord.x][this.coord.y].hexagon.setIsSuburb(true)
        
        this.farms = []
        this.units = []
        
        
        this.gold = 25//НЕ ЗАБУДЬ!
        
        this.newProduction = new Production()
        this.production = 
        {
            noob: new UnitProduction(2, 14, Noob),
            farm: new FarmProduction(0, 25, Farm, 5),
            suburb: new SuburbProduction(0, 1)
        }
        this.finishPreparing()
    }
    getInfo()
    {
        let town = super.getInfo()
        
        town.link = this
        
        let income = this.getIncome()
        town.info.gold = this.gold + ' (' + ((income > 0)?'+':'') + income + ')'
        
        town.production = {}
        for (let i in this.production)
        {
            town.production[i] = this.production[i];
        }
        
        if (this.isPreparing())
        {
            town.info.train = this.preparation.what
            town.info.turns = this.preparation.turns
        }
        return town
    }
    isWaitingForInstructions()
    {
        return this.newProduction.isWaitingForInstructionsToCreate()
    }
    sendInstructions(cell)
    {
        if (this.newProduction.canBecomeSuburb(cell, this))
        {
            this.newProduction.create(cell, this)
            this.newProduction.tryToCreate(this.coord.x, this.coord.y, this, this.player)
            
            return false
        }
        else
        {
            border.setVisible(false)
            grid.setDrawLogicText(false)
            townInterface.setVisible(false)
            
            this.newProduction = new Production()
            
            return true
        }
    }
    select()
    {
        townInterface.change(this.getInfo(), players[this.player].getFullColor())
        
        return true
    }
    removeSelect(x, y)
    {
        return this.newProduction.removeSelect(x, y, this, this.player)
    }
    getIncome()
    {
        const suburbIncome = 1
        
        let income = 0
        income += this.suburbs.length * suburbIncome
        
        for (let i = 0; i < this.farms.length; ++i)
        {
            income += this.farms[i].income
        }
        for (let i = 0; i < this.units.length; ++i)
        {
            income -= this.units[i].salary
        }
        return income
    }
    prepare(what)
    {
        if (!this.isPreparing() && this.gold >= this.production[what].cost)
        {
            this.preparation = 
            {
                what: what,
                turns: this.production[what].turns
            }
            
            let preparingProduction = this.production[this.preparation.what]
            
            if (preparingProduction.canCreateImmediately())
                preparingProduction.tryToCreate(this.coord.x, this.coord.y, this, this.player)
            else
                this.gold -= preparingProduction.cost
            
            return true
        }
        return false
    }
    isPreparing()
    {
        return (this.preparation.turns || this.newProduction.isWaitingForInstructionsToCreate())
    }
    finishPreparing()
    {
        this.preparation = 
        {
            what: "nothing",
            turns: 0
        }
    }
    crisisPenalty()
    {
        for (let i = 0; i < this.units.length; ++i)
        {
            this.units[i].kill()   
        }
        this.units = []
        
        this.gold = 0
    }
    nextTurn(whooseTurn)
    {
        if (this.player == whooseTurn)
        {
            this.gold += this.getIncome()
            if (this.gold < 0)
                this.crisisPenalty()
            
            if (this.isPreparing())
            {
                this.preparation.turns--
                if (!this.isPreparing())
                {
                    if (this.production[this.preparation.what].tryToCreate(this.coord.x, this.coord.y, this, this.player))
                    {

                        this.finishPreparing()
                    }
                    else
                    {
                        this.preparation.turns++
                    }

                }
            }
        }
    }
    drawSuburbs()
    {
        
    }
    draw()
    {
        super.draw()
        this.drawSuburbs()
    }
}
function townEvent(production)
{
    
    let town = gameEvent.getSelected()
    if (town.prepare(production))
    {
        
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

class Production
{
    constructor(turns, cost, _class)
    {
        this.turns = turns
        this.cost = cost
        this.class = _class
    }
    removeSelect()
    {
        return true
    }
    canCreateImmediately()
    {
        return !this.turns
    }
    canBecomeSuburb()
    {
        return false
    }
    isWaitingForInstructionsToCreate()
    {
        return false
    }
}
class UnitProduction extends Production
{
    constructor(turns, cost, _class)
    {
        super(turns, cost, _class)
    }
    create(x, y, town, player)
    {
        let t = new this.class(x, y, player)
        layers.entity.add(t.getObject())
        t.object.draw()
        
        town.units.push(t)
    }
    tryToCreate(x, y, town, player)
    {
        if (grid.arr[x][y].unit.isEmpty())
        {
            this.create(x, y, town, player)

            return true
        }
        return false
    }
    isWaitingForInstructionsToCreate()
    {
        return false
    }
}
class FarmProduction extends Production
{
    constructor(turns, cost, _class, income)
    {
        super(turns, cost, _class)
        this.income = income
    }
    tryToCreate(x, y, town, player)
    {
        town.newProduction = this
        
        this.paintTownBorders(town.suburbs)
    }
    create(x, y, town, player)
    {
        town.gold -= this.cost
        town.newProduction = new Production()

        let t = new this.class(x, y, this.income, town, player)
        layers.entity.add(t.getObject())
        t.object.draw()
        
        town.farms.push(t)
    }
    isSuburb(coordX, coordY, arr)
    {
        for (let i = 0; i < arr.length; ++i)
        {
            if (arr[i].hexagon.coord.x == coordX && arr[i].hexagon.coord.y == coordY)
                return true
        }
        return false
    }
    paintTownBorders(arr)
    {
        
        let Q = arr.slice()
        while (Q.length > 0)
        {
            
        }
        for (let i = 0; i < arr.length; ++i)
        {
            let neighbours = arr[i].hexagon.getNeighbours()
            for (let j = 0; j < neighbours.length; ++j)
            {
                if (!this.isSuburb(neighbours[j][0], neighbours[j][1], arr))
                {
                    border.drawLine(arr[i].hexagon.getPos(), j, 'white')
                    
                }
            }
        }
        border.draw()
    }
    hexagonBelongToTown(x, y, arr)
    {
        return this.isSuburb(x, y, arr)
    }
    removeSelect(x, y, town, player)
    {
        if (grid.arr[x][y].building.isEmpty() && this.hexagonBelongToTown(x, y, town.suburbs))
        {
            this.create(x, y, town, player)
            
            border.remove()
            return true
        }
        
        return false
    }
}
class SuburbProduction extends Production
{
    constructor(turns, cost, _class)
    {
        super(turns, cost, _class)
        this.availableHexagons = []
    }
    canBecomeSuburb(cell, town)
    {
        for (let i = 0; i < this.availableHexagons.length; ++i)
        {
            if (this.isEqually(this.availableHexagons[i], cell.hexagon))
            {
                return town.gold >= this.suburbsCostformula(this.distance[cell.hexagon.coord.x][cell.hexagon.coord.y])
            }
        }
        return false
    }
    create(cell, town)
    {   
        cell.hexagon.setIsSuburb(true)
        town.suburbs.push(cell)
        
        town.gold -= this.suburbsCostformula(this.distance[cell.hexagon.coord.x][cell.hexagon.coord.y])
        
        townInterface.change(town.getInfo(), players[town.player].getFullColor())
    }
    isWaitingForInstructionsToCreate()
    {
        return true
    }
    tryToCreate(x, y, town, player)
    {
        grid.cleanLogicText()
        
        town.newProduction = this
        
        this.paintTownBorders(town, town.suburbs, grid.arr, player)
    }
    isSuburb(coord, arr, player)
    {
        let hexagon = arr[coord.x][coord.y].hexagon
        
        return player == hexagon.player && hexagon.isSuburb()
    }
    isEqually(hexagon1, hexagon2)
    {
        if (hexagon1 && hexagon2)
            return (hexagon1.coord.x == hexagon2.coord.x && hexagon1.coord.y == hexagon2.coord.y)
        return false
    }
    isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray)
    {
        return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
    }
    suburbsCostformula(distance)
    {
        const mainCost = 1
        const diff = 2
        
        return mainCost + diff * distance
    }
    getDistances(town, arr, player)
    {
        let used = new Array(arr.length)
        let distance = new Array(arr.length)
        for (let i = 0; i < arr.length; ++i)
        {
            used[i] = new Array(arr[i].length)
            distance[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j)
            {
                used[i][j] = false
                
                distance[i][j] = 0
            }
        }
        
        let Q = []
        Q.push(arr[town.coord.x][town.coord.y].hexagon)
        
        used[town.coord.x][town.coord.y] = true
        
        while (Q.length > 0)
        {
            let v = Q.shift()
            
            if (arr[v.coord.x][v.coord.y].hexagon.player != player)
                continue
                
            let neighbours = v.getNeighbours()
            for (let i = 0; i < neighbours.length; ++i)
            {
                if (this.isCoordNotOnMap(neighbours[i], arr.length, arr[0].length))
                    continue
                    
                if (!used[neighbours[i].x][neighbours[i].y])
                {
                    distance[neighbours[i].x][neighbours[i].y] = distance[v.coord.x][v.coord.y] + 1
                    Q.push(arr[neighbours[i].x][neighbours[i].y].hexagon)
                    
                    used[neighbours[i].x][neighbours[i].y] = true
                }
            }
        }
        return distance
    }
    paintTownBorders(town, suburbs, arr, player)
    {
        // init
        border.clean()
        border.setVisible(true)
        
        grid.setDrawLogicText(true)
        
        this.distance = []
        this.availableHexagons = []
        //let suburbsNeighbours = []
        let used = new Array(arr.length)
        
        for (let i = 0; i < arr.length; ++i)
        {
            used[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j)
                used[i][j] = false
        }
        
        // search available for purchase cells
        for (let i = 0; i < suburbs.length; ++i)
        {
            let hexagon = suburbs[i].hexagon
            used[hexagon.coord.x][hexagon.coord.y] = true
            
            let neighbours = hexagon.getNeighbours()
            for (let j = 0; j < neighbours.length; ++j)
            {
                let neighbourCoord = neighbours[j]
                
                if (this.isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                    arr[neighbourCoord.x][neighbourCoord.y].hexagon.player != player)
                {
                    border.createLine(hexagon.getPos(), j)
                    continue
                }
            
                if (!this.isSuburb(neighbourCoord, arr, player) &&
                    !used[neighbourCoord.x][neighbourCoord.y])
                {
                    this.availableHexagons.push(arr[neighbourCoord.x][neighbourCoord.y].hexagon)
                    
                    used[neighbourCoord.x][neighbourCoord.y] = true
                }
            }
        }
    
        // create border lines
        this.distance = this.getDistances(town, arr, player)
        
        for (let i = 0; i < this.availableHexagons.length; ++i)
        {
            let coord = {x: this.availableHexagons[i].coord.x, y: this.availableHexagons[i].coord.y}
            
            let cell = arr[coord.x][coord.y]
            let cost = this.suburbsCostformula(this.distance[coord.x][coord.y])
            cell.logicText.setText(cost)
            
            let posI = this.availableHexagons[i].getPos()
            
            let neighbours = this.availableHexagons[i].getNeighbours()
            
            for (let j = 0; j < neighbours.length; ++j)
            {
                if (this.isCoordNotOnMap(neighbours[j]) ||
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