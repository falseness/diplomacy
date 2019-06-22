class TownInterface
{
    constructor()
    {
        /*this.pos = 
        {
            x: width * 0.67, 
            y: height * 0.0,
        }*/
        this.visible = false
        this.pos = 
        {
            x: width * 0.75 - canvasOffset.x, 
            y: height * 0.12 - canvasOffset.y,
        }
        this.height = 0.4 * height
        this.width = width - this.pos.x
        
        let stroke = 0.002 * width
        let cornerRadius = 0.03 * width
        let indent = stroke + cornerRadius
        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, [cornerRadius, 0, 0, cornerRadius], stroke)
        
        this.gold = new JustImage('gold', {x: this.pos.x + this.height * 0.1 + this.height * 0.07, y: this.pos.y + this.height * 0.05 + this.height * 0.08}, 
                                  this.height * 0.15, this.height * 0.15)
        
        this.goldText = new Text(this.gold.x() + this.height * 0.9, this.gold.y(), 0.05 * height, 'error', 'white', 'end')
        
        // 
        /*this.gold = createImageByModel(
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
            fontSize: 0.05 * height,
            offset: {x: 0.5, y: 0}
        })
        */
        
        this.trainInterfaces = {}
        
        let trainInterfaces = 
        {
            name: ['noob', 'farm', 'suburb'], 
            margin:
            {
                image: 
                {
                    x: 0,
                    y: 0
                },
                costText:
                {
                    x: this.height * 0.26,
                    y: 0
                },
                button:
                {
                    x: this.height * 0.9 - 0.175 * height,
                    y: -0.04 * height / 2
                }
            },
            model:
            {
                image:
                {
                    width: 0.1 * height,
                    height: 0.1 * height
                }, 
                costText:
                {
                    fontSize: 0.04 * height,
                    text: 'cost'
                },
                button:
                {
                    text:
                    {
                        text: 'train',
                        color: '#747474',
                        fontSize: 0.03 * height
                    },
                    rect:
                    {
                        color: '#f7f7f7',
                        cornerRadius: 0.01 * height,
                        borderColor: 'black',
                        stroke: 0.002 * height,
                        width: 0.175 * height,
                        height: 0.04 * height
                    }
                }
            }
        }
        
        let trainInterfacesMarginInterval = this.height * 0.25;
        for (let i = 0; i < trainInterfaces.name.length; ++i)
        {
            let models = trainInterfaces.model
            let margins = trainInterfaces.margin
            
            let image
            if (trainInterfaces.name[i] == 'suburb')
            {
                image = new SuburbImage({}, this.height * 0.1, 0.002 * width)
            }
            else
                image = new JustImage(trainInterfaces.name[i], {}, models.image.width, models.image.height)
            
            let costText = new Text(NaN, NaN, models.costText.fontSize, models.costText.text)
            let button = new Button
            (
                new Rect(NaN, NaN, models.button.rect.width, models.button.rect.height, 
                         [models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius],
                        models.button.rect.stroke, models.button.rect.color),
                new Text(0, 0, models.button.text.fontSize, models.button.text.text, models.button.text.color),
                townEvent, trainInterfaces.name[i]
            )
            this.trainInterfaces[trainInterfaces.name[i]] = 
                new TrainInterface(
                margins.image, margins.costText, margins.button,
                image, costText, button,
                this.gold.x(), this.gold.y() + this.height * 0.3 + trainInterfacesMarginInterval * i, trainInterfaces.name[i])
        }
        
        let interfaceSize = this.gold.y() + this.height * 0.3 + trainInterfacesMarginInterval * (trainInterfaces.name.length - 1)
        const requiredMargin = height * 0.1
        if (interfaceSize - this.pos.y > this.height - requiredMargin)
        {
            this.height = interfaceSize - this.pos.y + requiredMargin
            this.background.setHeight(this.height) 
        }
        
        //this.hide()
    }
    getObject()
    {
        
        return [this.background, this.gold, this.goldText.getObject(), 
                ...this.trainInterfaces.noob.getObject(),
                ...this.trainInterfaces.farm.getObject(),
                ...this.trainInterfaces.suburb.getObject()]
    }
    change(town, color)
    {
        this.background.setColor(color.hex)
        
        for (let i in this.trainInterfaces)//town.production
        {
            //this.trainInterfaces[i].changeImage(i, color)
            this.trainInterfaces[i].setCostText('cost: ' + town.production[i].cost)
            
            if (!town.info.train)
            {
                this.trainInterfaces[i].setCanTrain(true)
                /*
                Некруто постоянно создавать функции для button и вообще все менять каждый раз,
                нужно сделать все один раз сделать и редко менять
                */
                this.trainInterfaces[i].setButtonText('train (' + town.production[i].turns + ')')
            }
            else if (town.info.train != i)
            {
                this.trainInterfaces[i].setCanTrain(false)
            }
        }
        if (town.info.turns)
        {
            this.trainInterfaces[town.info.train].setButtonText(town.info.turns + ' / ' + town.production[town.info.train].turns)
        }
        this.goldText.setText(town.info.gold)
        this.setVisible(true)
    }
   /* setButtonsList()
    {
        this.buttons = {}
        this.buttons[this.noobButton.name] = this.noobButton
    }*/
    setVisible(boolean)
    {
        this.visible = boolean
    }
    click(point)
    {
        if (this.visible && this.isInside(point))
        {
            for (let i in this.trainInterfaces)
            {
                if (this.trainInterfaces[i].click(point))
                    break
            }
            return true
        }
        return false
    }
    isInside(point)
    {
        return this.background.isInside(point)
    }
    draw()
    {
        if (!this.visible)
            return
        
        this.background.draw()   
        this.gold.draw()
        this.goldText.draw()
        for (let i in this.trainInterfaces)
        {
            this.trainInterfaces[i].draw()
        }
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
    constructor(imageMargin, costTextMargin, buttonMargin, image, costText, button, x, y, name)
    {
        this.x = x
        this.y = y
        
        this.name = name
        
        this.image = image
        this.costText = costText
        this.button = button
        
        this.image.setPos({x: x + imageMargin.x, y: y + imageMargin.y})
        this.costText.setPos({x: x + costTextMargin.x, y: y + costTextMargin.y})
        this.button.setPos({x: x + buttonMargin.x, y: y + buttonMargin.y})
        
        this.canTrain = true
    }
    click(point)
    {
        return this.button.click(point)
    }
    setCostText(text)
    {
        this.costText.setText(text)
    }
    setFunction(func)
    {
        this.button.setFunction(func)
    }
    setButtonText(text)
    {
        this.button.setText(text)
    }
    setCanTrain(boolean)
    {
        this.canTrain = boolean
        this.button.setCanClick(boolean)
    }
    draw()
    {
        this.image.draw()
        this.costText.draw()
        if (this.canTrain)
            this.button.draw()
    }
}
/*class TrainInterface
{
    constructor(imageMargin, costMargin, buttonMargin,
                imageModel, costModel, buttonModel, x, y, name)
    {
        this.name = name
        
        this.imageMargin = imageMargin
        this.costMargin = costMargin
        this.buttonMargin = buttonMargin
        
        this.setPos(imageModel, this.imageMargin, x, y)
        this.setPos(costModel, this.costMargin, x, y)
        this.setPos(buttonModel.rect, this.buttonMargin, x, y)
  
        this.button = new Button(buttonModel.rect, new Text(buttonModel.text), name)
        this.cost = new Text(costModel)
        
        this.image = createImageByModel(imageModel)
    }
    getObject()
    {
        return [...this.button.getObject(), this.cost.getObject(), this.image]
    }
    changeName(name)
    {
        this.name = name
        this.button.name = name
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
        //this.cost.changeOffset()
    }
    changeImage(image, color)
    {
        if (assets[image])
            this.image.image(assets[image])
        else
        {
            this.createAsset(image, color)
            //this.image = this.createAsset(image, color)
            return
        }
        
        ///Нужно что-то менять:
        this.image.draw()
    }   
    createAsset(image, color)
    {
        if (image == 'suburb')
        {
            let obj = new Konva.RegularPolygon(
            {
                x: this.image.x(),
                y: this.image.y(),
                sides: 6,
                radius: basis.r,
                fill: color, //'#D0D0D0',//'#B5B8B1',
                stroke: 'black',
                strokeWidth: 3,
                rotate: 90
            })
            obj.draw()
        }
        const assets = 
        //{
        //    suburb: new Konva.RegularPolygon(
        //    {
        //    x: pos.x,
        //    y: pos.y,
        //    sides: 6,
        //    radius: basis.r,
        //    fill: players[this.player].getHexColor(), //'#D0D0D0',//'#B5B8B1',
        //    stroke: 'black',
        //    strokeWidth: 3,
        //    rotate: 90
        //    })
        //}
    }
    changeButton(text)
    {
        this.button.changeText(text)
        //this.changeOffset()
    }
}*/