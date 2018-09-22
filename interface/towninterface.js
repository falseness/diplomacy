class TownInterface
{
    constructor()
    {
        this.stroke = 0.002 * width
        this.cornerRadius = 0.03 * width
        this.indent = this.stroke + this.cornerRadius
        this.pos = 
        {
            x: width * 0.8, 
            y: height * 0.12,
        }
        
        this.height = 0.4 * height
        this.width = width - this.pos.x
        this.color = '#78a85d'
        this.setElements()
        
        this.hide()
    }
    setElements()
    {
        this.elements = 
        {
            text:
            {
                size: this.height * 0.1
            },
            margin:
            {
                y: this.height * 0.05
            },
            image:
            {
                width: 0.1 * height, 
                height: 0.1 * height
            },
            gold:
            {
                image: assets.gold,
                pos: 
                {
                    x: this.pos.x + this.height * 0.05,
                    y: this.pos.y + this.height * 0.05
                },
                width: this.height * 0.15,
                height: this.height * 0.15
            },
            goldText:
            {
                pos: 
                {
                    x: this.pos.x + this.height * 0.05 + this.height * 0.15,
                    y: this.pos.y + this.height * 0.05
                }
            }
        }
        this.elements.noob = 
        {
            image: assets.unit,
            pos:
            {
                x: this.elements.gold.pos.x,
                y: this.elements.gold.pos.y + this.elements.gold.height + this.elements.margin.y
            },
            width: this.elements.image.width,
            height: this.elements.image.height
        }
        this.elements.buttons = 
        {
            width: this.height * 0.4,
            height: this.height * 0.1,
            text: 
            {
                text: 'train',
                size: this.height * 0.07,
                color: '#666666'
            }
        }
        this.elements.buttons.pos = 
        {
            x: this.pos.x + this.width - this.elements.buttons.width * 1 - this.indent
        }
        this.elements.text.pos = 
        {
            x: this.elements.buttons.pos.x + this.elements.buttons.width
        }
    }
    createObject()
    {
        this.background = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: this.width + this.indent,
            height: this.height + this.indent,
            fill: this.color,
            stroke: 'black',
            strokeWidth: this.stroke,
            cornerRadius: this.cornerRadius
        })
        this.gold = new Konva.Image({
            x: this.elements.gold.pos.x,
            y: this.elements.gold.pos.y,
            image: this.elements.gold.image,
            width: this.elements.gold.width,
            height: this.elements.gold.height,
        }) 
        this.noob = new Konva.Image({
            x: this.elements.noob.pos.x,
            y: this.elements.noob.pos.y,
            image: this.elements.noob.image,
            width: this.elements.noob.width,
            height: this.elements.noob.height,
        })
        this.noobButtons = new Button(this.elements.buttons.pos.x, this.elements.noob.pos.y + this.elements.noob.height / 2, 
                                      this.elements.buttons.width, this.elements.buttons.height,
                                    new Text(this.elements.buttons.pos.x + this.elements.buttons.width / 2,
                                              this.elements.noob.pos.y + this.elements.buttons.height / 2, {x: 0.5, y: -0.5}),
                                    '#f7f7f7', 0.01 * height, 'black', 0.002 * height)
        this.gold.offsetX(-this.elements.gold.width / 3)
        this.goldText = new Text(this.elements.text.pos.x, this.elements.goldText.pos.y, {x: 1, y: -0.4})
        return [this.background, this.gold, this.goldText.createObject(0, this.elements.text.size),
                this.noob, this.noobButtons.createObject(),
                this.noobButtons.text.createObject(this.elements.buttons.text.text, this.elements.buttons.text.size, this.elements.buttons.text.color)]
    }
    change(town, color)
    {
        this.background.fill(color)
        this.noobButtons.setFunction(townEvent, {town: town, what: 'noob'})
        this.goldText.change(town.gold)
        
        this.draw()
        layers.townInterface.draw()
    }
    draw()
    {
        layers.townInterface.visible(true)
    }
    hide()
    {
        layers.townInterface.visible(false)
    }
    move(x, y)
    {
        layers.townInterface.setX(x)
        layers.townInterface.setY(y)
    }
}