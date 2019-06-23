class Entity extends Sprite
{
    constructor(x, y, name, hp)
    {
        super(x, y)
        this.hp = hp
        
        this.name = name
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
    getPlayer()
    {
        return this.player
    }
    select()
    {
        return true
    }
    removeSelect()
    {
        return true
    }
    draw()
    {
        drawImage(this.name, this.getPos())
    }
}