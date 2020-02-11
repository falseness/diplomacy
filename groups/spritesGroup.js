class SpritesGroup extends Sprite
{
    constructor(x, y)
    {
        super(x, y)
        this.arr = []
    }
    createArr(n, arrName)
    {
        for (let i = 0; i < n; ++i)
        {
            arrName.push([])
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