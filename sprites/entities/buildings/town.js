const commutervilleColor = 0.4
class Town extends Building
{
    constructor(x, y, hp, player)
    {
        super(x, y, hp, player)
        
        this.name = 'town'
        
        this.commuterville = this.getNeighbours()
        this.commuterville.push([this.coord.x, this.coord.y])
        
        this.gold = 11//НЕ ЗАБУДЬ!
        
        this.production = 
        {
            noob: 
            {
                turns: 2,
                cost: 5,
                create(x, y, player)
                {
                    let t = new Noob(x, y, player)
                    layers.entity.add(t.createObject())
                    t.object.draw()
                }
            }
        }
        this.finishPreparing()
    }
    getInfo()
    {
        let town = super.getInfo()
        
        town.link = this
        town.info.gold = this.gold
        
        town.production = {}
        for (let i in this.production)
        {
            town.production[i] = this.production[i];
        }
        
        if (this.isPreparing())
        {
            town.info.train = this.preparation.what
            town.info.turns = + this.preparation.turns + ' / ' + this.production[this.preparation.what].turns
        }
        return town
    }
    select()
    {
        townInterface.change(this.getInfo(), players[this.player].getHexColor())
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
        }
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
                if (grid.arr[this.coord.x][this.coord.y].unit.isEmpty())
                {
                    this.production[this.preparation.what].create(this.coord.x, this.coord.y, this.player)
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
    let color = players[whooseTurn].getHexColor()
    
    town.prepare(event.target.parameters.what)
    town.select()
    
    entityInterface.change(town.getInfo(), color)
}