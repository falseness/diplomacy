class Building extends Entity
{
    constructor(x, y, name, hp, player)
    {
        super(x, y, name, hp, player)
        grid.arr[x][y].building = this
    }
}