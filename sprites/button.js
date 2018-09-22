class Button
{
    constructor(x, y, width, height, text, color, cornerRadius, borderColor, stroke)
    {
        this.pos =
        {
            x: x,
            y: y
        }
        this.width = width
        this.height = height
        this.text = text
        this.cornerRadius = cornerRadius
        this.color = color
        this.borderColor = borderColor
        this.stroke = stroke
    }
    createObject()
    {
        this.object = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: this.width,
            height: this.height,
            fill: this.color,
            stroke: this.borderColor,
            strokeWidth: this.stroke,
            cornerRadius: this.cornerRadius
        })
        this.object.offsetY(this.height / 2)
        return this.object
    }
    setFunction(func, parameters)//func, parameter)
    {
        this.object.parameters = parameters
        this.object.on('click', func)//func, parameter)
    }
}