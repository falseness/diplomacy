class SpritesGroup extends Sprite
{
    constructor(x, y)
    {
        super(x, y)
        this.arr = []
    }
    createArr(n, arr)
    {
        for (let i = 0; i < n; ++i)
        {
            this.arr.push([])
        }
    }
    draw()
    {   
        for (let i = 0; i < this.arr.length; ++i)
        {
            this.arr[i].draw()
        }
    }
}