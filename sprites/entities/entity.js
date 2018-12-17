class Entity extends Sprite
{
    constructor(x, y, name, hp, player)
    {
        super(x, y)
        this.hp = hp
        this.player = player
        
        this.name = name
        
        let pos = this.getPos()
        this.object = new Konva.Image({
            x: pos.x,
            y: pos.y,
            image: assets[this.name],
            width: assets.size,
            height: assets.size
        }) 
        this.offsetObject()
    }
    offsetObject()
    {
        this.object.offsetX(assets.size / basis.offset.assets.x)
        this.object.offsetY(assets.size / basis.offset.assets.y)
    }
    getObject()
    {
        
        return this.object
    }
    getInfo()
    {
        return {
            name: this.name, 
            player: this.player,
            info: 
            {
                hp: this.hp
            }
        }
    }
    select()
    {
        return true
    }
    removeSelect()
    {
        return true
    }
}