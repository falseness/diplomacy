
class Interface
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
        //this.width = 0.3 * width + assets.size
        this.height = 0.3 * height
        this.color = '#78a85d'
        
        /*this.center = 
        {
            x: this.pos.x + this.width / 2,
            y: this.pos.y + this.height / 2
        }*/
        
        this.setElements()
        
        this.width = this.elements.right
    
        this.entity = 
        {
            name: new Text(this.elements.text.pos.name.x, this.elements.text.pos.name.y, this.elements.text.offset),
            info: new Text(this.elements.text.pos.info.x, this.elements.text.pos.info.y, this.elements.text.offset)
        }
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
        return [this.background, this.entity.name.createObject('', this.elements.text.size.name), this.entity.info.createObject('', this.elements.text.size.info), this.img]
    }
    change(entity)
    {
        //Требуется рефакторинг. Слишком тесная связь с классом player
        this.background.fill(players[entity.player].getHexColor())
        
        this.img.image(assets[entity.name])
        this.entity.name.change(entity.name)
        this.entity.info.change(entity.info.join('\n'))
        layers.interface.draw()
    }
    draw()
    {
        layers.interface.visible(true)
    }
    hide()
    {
        layers.interface.visible(false)
    }
}