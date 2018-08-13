class Hexagon extends Sprite
{
    constructor(x, y, z)
    {
        super(x, y, z)
    }
    createObject()
    {
        let pos = this.getPos()
        this.object = new Konva.RegularPolygon(
        {
            x: pos.x,
            y: pos.y,
            sides: 6,
            radius: basis.r,
            fill: 'red',
            stroke: 'black',
            strokeWidth: 4
        })
        this.object.rotate(90)
        return this.object
    }
}