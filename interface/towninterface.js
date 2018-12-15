class TownInterface
{
    constructor()
    {
        this.pos = 
        {
            x: width * 0.75, 
            y: height * 0.12,
        }
        this.height = 0.4 * height
        this.width = width - this.pos.x
        
        
        
        let stroke = 0.002 * width
        let cornerRadius = 0.03 * width
        let indent = stroke + cornerRadius
        
        this.background = createRectByModel(
        {
            x: this.pos.x,
            y: this.pos.y,
            width: this.width + indent,
            height: this.height + indent,
            color: '#78a85d',
            stroke: 'black',
            strokeWidth: stroke,
            cornerRadius: cornerRadius
        })
         
        
        
        this.gold = createImageByModel(
        {
            x: this.pos.x + this.height * 0.1,
            y: this.pos.y + this.height * 0.05,
            image: assets.gold,
            width: this.height * 0.15,
            height: this.height * 0.15,
            color: 'red'
        }) 
        this.goldText = new Text(
        {
            x: this.gold.x() + this.height * 0.8, 
            y: this.gold.y() + 0.01 * height, 
            fontSize: 0.05 * height
        })
        
        
        
        this.trainInterfaces = {}
        
        let trainInterfaces = 
        {
            name: ['noob'], 
            margin:
            {
                image: 
                {
                    x: 0,
                    y: 0
                },
                cost:
                {
                    x: this.height * 0.25,
                    y: 0
                },
                button:
                {
                    x: this.height * 0.6,
                    y: 0
                }
            },
            model:
            {
                imageModel:
                {
                    width: 0.1 * height,
                    height: 0.1 * height,
                    offset: {x: 0, y: 0.5},
                    image: assets.noob
                }, 
                costModel:
                {
                    fontSize: 0.04 * height,
                    text: 'cost',
                    offset: {x: 0, y: 0.5}
                },
                buttonModel:
                {
                    text:
                    {
                        text: 'train',
                        color: '#747474',
                        offset: {x: 0.5, y: 0.5},
                        fontSize: 0.03 * height
                    },
                    rect:
                    {
                        color: '#f7f7f7',
                        cornerRadius: 0.01 * height,
                        borderColor: 'black',
                        stroke: 0.002 * height,
                        offset: {x: 0, y: 0.5},
                        width: 0.15 * height,
                        height: 0.035 * height
                    }
                }
            }
        }
        for (let i = 0; i < trainInterfaces.name.length; ++i)
        {
            this.trainInterfaces[trainInterfaces.name[i]] = 
                new TrainInterface(trainInterfaces.margin.image, trainInterfaces.margin.cost, trainInterfaces.margin.button,
                                  trainInterfaces.model.imageModel, trainInterfaces.model.costModel, trainInterfaces.model.buttonModel,
                                  this.gold.x() - this.height * 0.05, this.gold.y() + this.height * 0.3)
        }
        
        
        this.hide()
    }
    getObject()
    {
        
        return [this.background, this.gold, this.goldText.getObject(), 
                ...this.trainInterfaces.noob.getObject()]
    }
    change(town, color)
    {
        /*this.background.fill(color)
        if (town.info.turns)
        {
            this.noobButton.changeText(town.info.turns)
        }
        else
        {
            this.noobButton.changeText(this.elements.buttons.text.text)
            this.noobButton.setFunction(townEvent, {town: town.link, what: this.noobButton.name})
        }*/
        this.goldText.change(town.info.gold)
        
        this.draw()
        layers.townInterface.draw()
    }
    setButtonsList()
    {
        this.buttons = {}
        this.buttons[this.noobButton.name] = this.noobButton
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


class TrainInterface
{
    constructor(imageMargin, costMargin, buttonMargin,
                imageModel, costModel, buttonModel, x, y)
    {
        this.imageMargin = imageMargin
        this.costMargin = costMargin
        this.buttonMargin = buttonMargin
        
        this.setPos(imageModel, this.imageMargin, x, y)
        this.setPos(costModel, this.costMargin, x, y)
        this.setPos(buttonModel.rect, this.buttonMargin, x, y)
  
        this.button = new Button(buttonModel.rect, new Text(buttonModel.text), 'trainInterfaceButton')
        this.cost = new Text(costModel)
        
        this.image = createImageByModel(imageModel)
    }
    getObject()
    {
        return [...this.button.getObject(), this.cost.getObject(), this.image]
    }
    setPos(model, margin, x, y)
    {
        model.x = margin.x + x
        model.y = margin.y + y
    }
    changePos(x, y)
    {
        this.cost.changePos(x + this.costMargin.x, y + this.costMargin.y)
        
        if (x)
            this.image.x(x + this.imageMargin.x)
        if (y)
            this.image.y(y + this.imageMargin.y)
        
        this.button.changePos(x + this.buttonMargin.x, y + this.buttonMargin.y)
    }
    changeCost(text)
    {
        this.cost.change(text)
    }
    changeImage(image)
    {
        this.image.image(image)
    }   
    changeButton(text)
    {
        this.button.changeText(text)
    }
}