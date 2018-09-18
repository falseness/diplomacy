players = []

class Player
{
    constructor(color)
    {
        this.color =
        {
            r: color.r,
            g: color.g,
            b: color.b
        }
    }
    getColor()
    {
        return (this.color.r + ', ' + this.color.g + ', ' + this.color.b)
    }
    getHexColor()
    {
        return rgbToHex(this.color.r, this.color.g, this.color.b)
    }
}
