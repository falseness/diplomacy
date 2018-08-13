class Entity extends Sprite
{
    constructor(x, y, hp, player)
    {
        super(x, y)
        this.hp = hp
        this.player = player
    }
}