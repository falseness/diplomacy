class SpritesGroup extends Sprite
{
    arr = []
    constructor(x, y)
    {
        super(x, y)
        //this.#arr = []
    }
    createArr(n)
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