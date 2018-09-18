class TownInterface
{
    constructor()
    {
        this.stroke = 4
        this.cornerRadius = 50
        this.indent = this.stroke + this.cornerRadius
        this.pos = 
        {
            x: 0, 
            y: 0.7 * height,
        }
        
        this.height = 0.3 * height
        this.width = 0.2 * width
        this.color = '#78a85d'
    }
    createObject()
    {
        this.background = new Konva.Rect({
            x: this.pos.x  - this.indent,
            y: this.pos.y,
            width: this.width + this.indent,
            height: this.height + this.indent,
            fill: this.color,
            stroke: 'black',
            strokeWidth: this.stroke,
            cornerRadius: this.cornerRadius
        })
        return [this.background]
    }
    draw()
    {
        layers.entityInterface.visible(true)
    }
    hide()
    {
        layers.entityInterface.visible(false)
    }
}