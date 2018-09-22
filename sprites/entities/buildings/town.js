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
                create(x, y, player)
                {
                    let t = new Noob(x, y, player)
                    layers.entity.add(t.createObject())
                    t.object.draw()
                }
            }
        }
        this.preparation = 
        {
            what: "nothing",
            turns: 0
        }
    }
    getInfo()
    {
        let town = super.getInfo()
        town.info.push('gold: ' + this.gold)
        return town
    }
    select()
    {
        townInterface.change(this, players[this.player].getHexColor())
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
        this.preparation = 
        {
            what: what,
            turns: this.production[what].turns
        }
    }
    nextTurn(whooseTurn)
    {
        if (this.player == whooseTurn)
        {
            this.preparation.turns--
            if (!this.preparation.turns)
            {
                if (grid.arr[this.coord.x][this.coord.y].unit.isEmpty())
                {
                    this.production[this.preparation.what].create(this.coord.x, this.coord.y, this.player)
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
    event.target.parameters.town.prepare(event.target.parameters.what)
}