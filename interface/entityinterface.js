
class EntityInterface
{
    constructor()
    {
        this.stroke = 0.002 * width
        this.cornerRadius = 0.03 * width
        this.indent = this.stroke + this.cornerRadius
        
        this.pos = 
        {
            x: 0, 
            y: 0.7 * height
        }
        this.height = height - this.pos.y
        
    
        
        this.img = createImageByModel(
        {
            x: this.pos.x + this.height * 0.1,
            y: this.pos.y + this.height * 0.1,
            image: undefined,
            width: this.height * 0.7,
            height: this.height * 0.7,
        }) 

        
        this.entity = {}
        
        this.entity.name = new Text({
            x: this.img.x() + this.img.getWidth(),
            y: this.pos.y + this.height * 0.2,
            fontSize: this.height * 0.2,
            offset: {x: 0, y: 0.5}
        })
        
        this.entity.info = new Text(
        {
            x: this.entity.name.x(),
            y: this.entity.name.y() + this.entity.name.getHeight(),
            fontSize: this.height * 0.1,
            offset: {x: 0, y: 0.5}
        })
        
        
        let maxCharsNumber = 6
        this.width = this.entity.info.x() + this.entity.info.fontSize() * maxCharsNumber
            
        this.background = createRectByModel(
        {
            x: this.pos.x - this.indent,
            y: this.pos.y,
            width: this.width + this.indent,
            height: this.height + this.indent,
            fill: '#78a85d',
            stroke: 'black',
            strokeWidth: this.stroke,
            cornerRadius: this.cornerRadius
        })
        
        
        this.hide()
    }
    getObject()
    {
        return [this.background, 
                this.entity.name.getObject(),
                this.entity.info.getObject(),
                this.img]
    }
    change(entity, color)
    {
        this.background.fill(color)
        
        this.img.image(assets[entity.name])
        this.entity.name.change(entity.name)
        this.entity.info.change(join(entity.info, ': ', '\n'))
        
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