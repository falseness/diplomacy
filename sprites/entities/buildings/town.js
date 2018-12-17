const commutervilleColor = 0.4
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
            noob: new UnitProduction(2, 14, Noob)
            /*{
                turns: 2,
                cost: 14,
                tryToCreate(x, y, town, player)
                {
                    if (grid.arr[x][y].unit.isEmpty())
                    {
                        let t = new Noob(x, y, player)
                        layers.entity.add(t.getObject())
                        t.object.draw()
                        
                        return true
                    }
                    return false
                }
            }*/,
            farm: new FarmProduction(0, 25, 5)
            /*{
                turns: 0,
                cost: 25,
                create(x, y, town, player)
                {
                    if (grid.arr[x][y].building.isEmpty())
                    {
                        let t = new Farm(x, y, town, player)
                        layers.entity.add(t.getObject())
                        t.object.draw()
                    }
                }
            }*/
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
        return this.commuterville.length
    }
    paintCommuterville()
    {
        for (let i = 0; i < this.commuterville.length; ++i)
        {
            //'rgba(' + players[this.player].getColor() + ', ' + commutervilleColor + ')'
            
            let hexagon = this.commuterville[i].hexagon.object
            
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
    nextTurn(whooseTurn)
    {
        if (this.player == whooseTurn && this.isPreparing())
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


class Production
{
    constructor(turns, cost)
    {
        this.turns = turns
        this.cost = cost
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
        super(turns, cost)
        this.class = _class
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
    constructor(turns, cost, income)
    {
        super(turns, cost)
        this.income = income
    }
    tryToCreate(x, y, town, player)
    {
        town.newProduction = this
    }
    create(x, y, town, player)
    {
        town.gold -= this.cost
        town.newProduction = new Production()

        let t = new Farm(x, y, this.income, town, player)
        layers.entity.add(t.getObject())
        t.object.draw()
        
        town.farms.push(t)
    }
    paintTownBorders(arr)
    {
        //for (let i = 0;)Доделай!
    }
    removeSelect(x, y, town, player)
    {
        if (grid.arr[x][y].building.isEmpty())
        {
            this.create(x, y, town, player)
            return true
        }
        
        return false
    }
    isWaitingForInstructionsToCreate()
    {
        return true
    }
}
function chooseHexagonToBuildHouse()
{
    /*
    Требуется рефакторинг 
    Нужно вынести в отдельные класс production и townEvent наверно
    
    

    и сделать что-то с этой функцией
    эта функция должна отрисовывать границы пригорода
    с помощью f drawLine() из drawLineBetweenHexagons.js
    и давать выбор игроку куда поставить домик
    
    
    
    Не забудь переписать в unit многие функции, в том числе
    и BFS 
    
    
    и нужно переписать events
    */
}