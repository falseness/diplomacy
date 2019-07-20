class Sprite
{
    constructor(x, y)
    {
        this.coord = 
        {
            x: x,
            y: y
        }
        this.pos = this.getPos()
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
        {//массив чисел изменен на массив объектов
            neighbours.push({x: this.coord.x + neighborhood[parity][i][0], y: this.coord.y + neighborhood[parity][i][1]})
        }
        return neighbours
    }
    isEmpty()
    {
        return false
    }
    notEmpty()
    {
        return !this.isEmpty()
    }
    draw()
    {
        console.log("error, try to draw sprite")
    }
}