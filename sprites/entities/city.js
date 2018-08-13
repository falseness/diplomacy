
class City extends Entity
{
    constructor(x, y, hp, player)
    {
        super(x, y, hp, player)
    }
    createObject()
    {
        let pos = this.getPos()
        this.object = new Konva.Image({
            x: pos.x,
            y: pos.y,
            image: imageObj,
            width: assets.size,
            height: assets.size
        }) 
        this.object.offsetX(assets.size / 2)
        this.object.offsetY(assets.size / 2 + 5)
        return this.object
    }
}