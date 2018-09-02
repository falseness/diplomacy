class Entity extends Sprite
{
    constructor(x, y, hp, player)
    {
        super(x, y)
        this.hp = hp
        this.player = player
        
        this.name = 'error'
    }
    offsetObject()
    {
        this.object.offsetX(assets.size / basis.offset.assets.x)
        this.object.offsetY(assets.size / basis.offset.assets.y)
    }
    createObject()
    {
        let pos = this.getPos()
        this.object = new Konva.Image({
            x: pos.x,
            y: pos.y,
            image: assets[this.name],
            width: assets.size,
            height: assets.size
        }) 
        this.offsetObject()
        
        return this.object
    }
    getInfo()
    {
        return {
            name: this.name, 
            info: ['hp: ' + this.hp]
        }
    }
}