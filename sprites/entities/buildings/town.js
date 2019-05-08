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
            this.suburbs.push(grid.arr[neighboursCoord[i][0]][neighboursCoord[i][1]])
        }
        this.suburbs.push(grid.arr[this.coord.x][this.coord.y])
        
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
    select()
    {
        townInterface.change(this.getInfo(), players[this.player].getHexColor())
        
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
    paintSuburbs()
    {
        const suburbsColor = 0.4
        
        for (let i = 0; i < this.suburbs.length; ++i)
        {
            //'rgba(' + players[this.player].getColor() + ', ' + commutervilleColor + ')'
            
            let hexagon = this.suburbs[i].hexagon.object
            
            hexagon.fill(`rgba(255, 255, 255, ${suburbsColor})`)
            hexagon.draw()
        }
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
            if (!this.production[this.preparation.what].startCreateRightAway())
                this.production[this.preparation.what].tryToCreate(this.coord.x, this.coord.y, this, this.player)
            else
                this.gold -= this.production[what].cost
            
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
}
function townEvent(event)
{
    let town = event.target.parameters.town
    if (town.prepare(event.target.parameters.what))
    {
        let color = players[whooseTurn].getHexColor()
        town.select()

        entityInterface.change(town.getInfo(), color)
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
    startCreateRightAway()
    {
        return this.turns
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
    isWaitingForInstructionsToCreate()
    {
        return true
    }
}
class SuburbProduction extends Production
{
    constructor(turns, cost, _class)
    {
        super(turns, cost, _class)
    }
    tryToCreate(x, y, town, player)
    {
        town.newProduction = this
        
        this.paintTownBorders(town.suburbs, grid.arr)
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
    isEqually(hexagon1, hexagon2)
    {
        if (hexagon1 && hexagon2)
            return (hexagon1.coord.x == hexagon2.coord.x && hexagon1.coord.y == hexagon2.coord.y)
        return false
    }
    paintTownBorders(suburbs, arr)
    {
        let indent = suburbs.length + 1
        
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
            let isVSuburb = this.isSuburb(vRealX, vRealY, suburbs)
            
            if (!isVSuburb)
            {
                canReachThisHexagons.push({hexagon: arr[vRealX][vRealY], cantReach: [false, false, false, false, false, false]})
            }
            for (let i = 0; i < neighbours.length; ++i)
            {
                let x = neighbours[i][0] - marginX
                let y = neighbours[i][1] - marginY
                
                for (let j = 0; j < canReachThisHexagons.length; ++j)
                {
                    for (let k = 0; k < canReachThisHexagons[j].cantReach.length; ++k)
                    {
                        if (isEqually(arr[neighbours[i][0]][neighbours[i][1]].hexagon, canReachThisHexagons[j].cantReach[k]))
                            canReachThisHexagons[j].cantReach[k] = false
                    }
                }
                
                if (!isVSuburb && !this.isSuburb(neighbours[i][0], neighbours[i][1], suburbs))
                {
                    canReachThisHexagons[canReachThisHexagons.length - 1].cantReach[i] = arr[neighbours[i][0]][neighbours[i][1]].hexagon
                    
                    continue
                }
                if (!used[x][y])
                {
                    used[x][y] = 1
                    Q.push(neighbours[i])
                    
                    distance[x][y] = distance[v[0]][v[1]] + 1
                }
            }
        }
        
        
        for (let i = 0; i < canReachThisHexagons.length; ++i)
        {
            for (let j = 0; j < canReachThisHexagons[i].cantReach.length; ++j)
            {
                if (canReachThisHexagons[i].cantReach[j])
                {
                    border.drawLine(canReachThisHexagons.hexagon.getPos(), j)
                }
            }
        }
    }
}