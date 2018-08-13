class SpritesGroup extends Sprite
{
    constructor(x, y)
    {
        super(x, y)
    }
    createObject()
    {
        let pos = this.getPos()
        this.object = new Konva.Group(
        {
            x: pos.x,
            y: pos.y            
        })
        return this.object
    }
}