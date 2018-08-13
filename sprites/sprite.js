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
    createObject()
    {
        console.log("try create sprite object, error")
        return null
    }
}