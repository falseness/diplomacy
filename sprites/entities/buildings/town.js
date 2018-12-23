class Town extends Building
{
    constructor(x, y, player)
    {
        let hp = 50
        super(x, y, 'town', hp, player)
        
        this.commuterville = []
        let neighboursCoord = this.getNeighbours()
        for (let i = 0; i < neighboursCoord.length; ++i)
        {
            this.commuterville.push(grid.arr[neighboursCoord[i][0]][neighboursCoord[i][1]])
        }
        this.commuterville.push(grid.arr[this.coord.x][this.coord.y])
        
        this.farms = []
        this.units = []
        
        
        this.gold = 25//НЕ ЗАБУДЬ!
        
        this.newProduction = new Production()
        this.production = 
        {
            noob: new UnitProduction(2, 14, Noob),
            farm: new FarmProduction(0, 25, Farm, 5)
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
        const commutervilleIncome = 1
        
        let income = 0
        income += this.commuterville.length * commutervilleIncome
        
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
    paintCommuterville()
    {
        const commutervilleColor = 0.4
        
        for (let i = 0; i < this.commuterville.length; ++i)
        {
            //'rgba(' + players[this.player].getColor() + ', ' + commutervilleColor + ')'
            
            let hexagon = this. commuterville[i].hexagon.object
            
            hexagon.fill(`rgba(255, 255, 255, ${commutervilleColor})`)
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
        
        this.paintTownBorders(town.commuterville)
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
    isCommuterville(coordX, coordY, arr)
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
           
        for (let i = 0; i < arr.length; ++i)
        {
            let neighbours = arr[i].hexagon.getNeighbours()
            for (let j = 0; j < neighbours.length; ++j)
            {
                if (!this.isCommuterville(neighbours[j][0], neighbours[j][1], arr))
                {
                    border.drawLine(arr[i].hexagon.getPos(), j, 'white')
                    
                }
            }
        }
        border.draw()
    }
    hexagonBelongToTown(x, y, arr)
    {
        return this.isCommuterville(x, y, arr)
    }
    removeSelect(x, y, town, player)
    {
        if (grid.arr[x][y].building.isEmpty() && this.hexagonBelongToTown(x, y, town.commuterville))
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