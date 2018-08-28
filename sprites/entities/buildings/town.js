const commutervilleColor = 0.4
class Town extends Building
{
    constructor(x, y, hp, player)
    {
        super(x, y, hp, player)
        
        this.img = 'town'
        
        this.commuterville = this.getNeighbours()
        this.commuterville.push([this.coord.x, this.coord.y])
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
}