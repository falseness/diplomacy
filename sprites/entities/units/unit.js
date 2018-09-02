class Unit extends Entity
{
    constructor(x, y, hp, dmg, speed, player)
    {
        super(x, y, hp, player)
        this.dmg = dmg
        this.speed = speed
        
        grid.arr[x][y].unit = this
    }
    getInfo()
    {
        let unit = super.getInfo()
        unit.info.push('dmg: ' + this.dmg, 'speed: ' + this.speed)
        return unit
    }
    select()
    {
        
    }
}