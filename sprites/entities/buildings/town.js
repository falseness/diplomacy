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
            noob: 2
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
            turns: this.production[what]
        }
    }
}
function townEvent(event)
{
    event.target.parameters.town.prepare(event.target.parameters.what)
}