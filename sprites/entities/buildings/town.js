const commutervilleColor = 0.4
class Town extends Building
{
    constructor(x, y, player)
    {
        let hp = 50
        super(x, y, 'town', hp, player)
        
        this.commuterville = this.getNeighbours()
        this.commuterville.push([this.coord.x, this.coord.y])
        
        this.farms = []
        
        this.gold = 25//НЕ ЗАБУДЬ!
        
        this.production = 
        {
            noob: 
            {
                turns: 2,
                cost: 14,
                create(x, y, town, player)
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
            },
            farm:
            {
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
            }
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
            
            let hexagon = grid.arr[this.commuterville[i][0]][this.commuterville[i][1]].hexagon.object
            
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
            this.gold -= this.production[what].cost
            
            if (!this.preparation.turns)
                this.production[this.preparation.what].create(this.coord.x, this.coord.y, this.player)
            
            return true
        }
        return false
    }
    isPreparing()
    {
        return (this.preparation.turns)
    }
    /*getPreparingText()
    {
        return String(this.preparation.turns + ' / ' + this.production[this.preparation.what].turns)
    }*/
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
                if (this.production[this.preparation.what].create(this.coord.x, this.coord.y, this, this.player))
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