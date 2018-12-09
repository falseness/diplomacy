
class EntityInterface
{
    constructor()
    {
        /*this.stroke = 4
        this.cornerRadius = 50*/
        this.stroke = 0.002 * width
        this.cornerRadius = 0.03 * width
        this.indent = this.stroke + this.cornerRadius
        this.pos = 
        {
            x: 0, 
            y: 0.7 * height
        }
        this.height = 0.3 * height
        this.color = '#78a85d'
        
        
        this.setElements()
        
        this.width = this.elements.right
    
        this.entity = 
        {
            name: new Text(this.elements.text.pos.name.x, this.elements.text.pos.name.y, this.elements.text.offset),
            info: new Text(this.elements.text.pos.info.x, this.elements.text.pos.info.y, this.elements.text.offset)
        }
        
        this.hide()
    }
    setElements()
    {
        this.elements =
        {
            image:
            {
                pos:
                {
                    x: this.pos.x + this.height * 0.1,
                    y: this.pos.y + this.height * 0.1
                },
                width: this.height * 0.7,
                height: this.height * 0.7,
            }
        }
        this.elements.image.right = this.elements.image.pos.x + this.elements.image.width
        this.elements.text = 
        {
            offset:
            {
                x: 0, 
                y: 0.5
            },
            size:
            {
                name: this.height * 0.2, 
                info: this.height * 0.1
            }
        }
        this.elements.text.pos =
        {
            name:
            {   x: this.elements.image.right,
                y: this.pos.y + this.height * 0.2
            }
        }
        this.elements.text.pos.info = 
        {
            x: this.elements.image.right, 
            y: this.elements.text.pos.name.y + this.elements.text.size.name
        }
        this.elements.right = this.elements.text.pos.name.x + this.elements.text.size.info * 6
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
        this.img = new Konva.Image({
            x: this.elements.image.pos.x,
            y: this.elements.image.pos.y,
            image: undefined,
            width: this.elements.image.width,
            height: this.elements.image.height,
        }) 
        return [this.background, 
                this.entity.name.createObject('', this.elements.text.size.name),
                this.entity.info.createObject('', this.elements.text.size.info),
                this.img]
    }
    change(entity, color)
    {
        this.background.fill(color)
        
        this.img.image(assets[entity.name])
        this.entity.name.change(entity.name)
        this.entity.info.change(join(entity.info, ': ', '\n'))//entity.info.join('\n'))
        layers.entityInterface.draw()
    }
    draw()
    {
        layers.entityInterface.visible(true)
    }
    hide()
    {
        layers.entityInterface.visible(false)
    }
    move(x, y)
    {
        layers.entityInterface.setX(x)
        layers.entityInterface.setY(y)
    }
}