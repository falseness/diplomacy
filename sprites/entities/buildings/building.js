class Building extends Entity
{
    constructor(x, y, hp, player)
    {
        super(x, y, hp, player)
        grid.arr[x][y].building = this
    }
}