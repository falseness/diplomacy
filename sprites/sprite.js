class Sprite
{
    constructor(x, y)
    {
        this.coord = 
        {
            x: x,
            y: y
        }
        
    }
    getPos()
    {
        let pos = biasToTransition(this.coord.x, this.coord.y)
        pos.x *= basis.offset.x
        pos.y *= basis.offset.y
        return pos
    }
    getNeighbours()
    {
        let neighbours = []
        let parity = this.coord.x & 1
        for (let i = 0; i < neighborhood[parity].length; ++i)
        {
            neighbours.push([this.coord.x + neighborhood[parity][i][0], this.coord.y + neighborhood[parity][i][1]])
        }
        return neighbours
    }
    getObject()
    {
        console.log("try create sprite object, error")
        return null
    }
    isEmpty()
    {
        return false
    }
}