class Interface
{
    constructor()
    {
        this.stroke = 4
        this.cornerRadius = 50
        this.indent = this.stroke + this.cornerRadius
        this.pos = 
        {
            x: -this.indent, 
            y: 0.7 * height 
        }
        this.width = 0.3 * width + this.indent
        this.height = 0.3 * height + this.indent
        this.color = '#349C0F'
        
        this.center = 
        {
            x: this.pos.x + this.width / 2,
            y: this.pos.y + this.height / 2
        }
        
        this.entityName = new Text(this.center.x, this.pos.y + this.height * 0.1)
    }
    createObject()
    {
        this.background = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: this.width,
            height: this.height,
            fill: this.color,
            stroke: 'black',
            strokeWidth: this.stroke,
            cornerRadius: 50
        })
        return [this.background, this.entityName.createObject('')]
    }
    draw()
    {
        layers.interface.visible(true)
    }
}