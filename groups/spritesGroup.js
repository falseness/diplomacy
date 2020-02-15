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
    fillArr(n, m, arrName, value) {
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j)
                arrName[i][j] = value
        }
    }
    fullInitArr(n, m, arrName, value) {
        this.createArr(n, arrName)
        this.fillArr(n, m, arrName, value)
    }
    draw()
    {   
        for (let i = 0; i < this.arr.length; ++i)
        {
            this.arr[i].draw()
        }
    }
}