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
    getRGB()
    {
        return this.color
    }
    getHexColor()
    {
        return rgbToHex(this.color.r, this.color.g, this.color.b)
    }
    getFullColor()
    {
        let color = 
        {
            hex: this.getHexColor(),
            text: this.getColor(),
            rgb: this.color
        }
        return color
    }
}
