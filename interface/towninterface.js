class TownInterface {
    constructor() {
        /*this.pos = 
        {
            x: width * 0.67, 
            y: height * 0.0,
        }*/
        this.visible = false
        this.pos = {
            x: width * 0.75 - canvasOffset.x,
            y: height * 0.12 - canvasOffset.y,
        }
        this.height = 0.4 * height
        this.width = width - this.pos.x

        let stroke = 0.002 * width
        let cornerRadius = 0.03 * width
            //let indent = stroke + cornerRadius
        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, [cornerRadius, 0, 0, cornerRadius], stroke)

        this.gold = new JustImage('gold', {
                x: this.pos.x + 0.22 * width * 0.1 + 0.22 * width * 0.07,
                y: this.pos.y + this.height * 0.05 + this.height * 0.08
            },
            this.height * 0.15, this.height * 0.15)

        this.goldText = new Text(this.gold.getX() + 0.22 * width * 0.9, this.gold.getY(), 0.05 * height, 'error', 'white', 'right')
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
        this.makeTrainInterfaces()



        this.updateSizes()
            //this.hide()
    }
    updateSizes() {
        let interfaceSize = this.gold.getY() + this.height * 0.3 +
            this.trainInterfacesMarginInterval * (getLength(this.trainInterfaces) - 1)
        const requiredMargin = height * 0.1
        if (interfaceSize - this.pos.y > this.height - requiredMargin) {
            this.height = interfaceSize - this.pos.y + requiredMargin
            this.background.setHeight(this.height)
        }
    }
    makeTrainInterfaces() {
        this.trainInterfaces = {}

        console.log(height / width)
        const heightWidthBestRatio = 0.55
        let trainInterfaces = {
            name: ['noob', 'farm', 'suburb'],
            margin: {
                image: {
                    x: 0,
                    y: 0
                },
                costText: {
                    x: 0.22 * width * 0.26,
                    y: 0
                },
                button: {
                    x: 0.23 * width * 0.9 - 0.175 * height,
                    y: -0.04 * height / 2
                }
            },
            model: {
                image: {
                    width: 0.1 * height,
                    height: 0.1 * height
                },
                costText: {
                    fontSize: 0.04 * width * heightWidthBestRatio,
                    text: 'cost'
                },
                button: {
                    text: {
                        text: 'train',
                        color: '#747474',
                        fontSize: 0.03 * width * heightWidthBestRatio
                    },
                    rect: {
                        color: '#f7f7f7',
                        cornerRadius: 0.01 * height,
                        borderColor: 'black',
                        stroke: 0.002 * height,
                        width: 0.175 * width * heightWidthBestRatio,
                        height: 0.04 * height
                    }
                }
            }
        }

        this.trainInterfacesMarginInterval = this.height * 0.25;
        for (let i = 0; i < trainInterfaces.name.length; ++i) {
            let models = trainInterfaces.model
            let margins = trainInterfaces.margin

            let image
            if (trainInterfaces.name[i] == 'suburb') {
                image = new SuburbImage({}, 0.22 * width * 0.1, 0.002 * width)
            } else
                image = new JustImage(trainInterfaces.name[i], {}, models.image.width, models.image.height)

            let costText = new Text(NaN, NaN, models.costText.fontSize, models.costText.text)
            let button = new Button(
                new Rect(NaN, NaN, models.button.rect.width, models.button.rect.height, [models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius],
                    models.button.rect.stroke, models.button.rect.color),
                new Text(0, 0, models.button.text.fontSize, models.button.text.text, models.button.text.color),
                townEvent, trainInterfaces.name[i]
            )
            this.trainInterfaces[trainInterfaces.name[i]] =
                new TrainInterface(
                    margins.image, margins.costText, margins.button,
                    image, costText, button,
                    this.gold.getX(), this.gold.getY() + this.height * 0.3 + this.trainInterfacesMarginInterval * i, trainInterfaces.name[i])
        }
    }
    updatePos() {
        this.pos = {
            x: width * 0.75 - canvasOffset.x,
            y: height * 0.12 - canvasOffset.y,
        }

        this.background.setPos(this.pos)
        this.gold.setPos({
            x: this.pos.x + 0.22 * width * 0.1 + 0.22 * width * 0.07,
            y: this.pos.y + this.height * 0.05 + this.height * 0.08
        })

        this.goldText.setPos({ x: this.gold.getX() + 0.22 * width * 0.9, y: this.gold.getY() })

        let index = 0
        for (i in this.trainInterfaces) {
            this.trainInterfaces[i].setPos({
                x: this.gold.getX(),
                y: this.gold.getY() + this.height * 0.3 + this.trainInterfacesMarginInterval * index++
            })
        }
    }
    change(town, color) {
            this.background.setColor(color.hex)

            for (let i in this.trainInterfaces) //town.production
            {
                //this.trainInterfaces[i].changeImage(i, color)
                this.trainInterfaces[i].setCostText('cost: ' + town.production[i].cost)

                if (!town.info.train) {
                    this.trainInterfaces[i].setCanTrain(true)
                        /*
                        Некруто постоянно создавать функции для button и вообще все менять каждый раз,
                        нужно сделать все один раз сделать и редко менять
                        */
                    this.trainInterfaces[i].setButtonText('train (' + town.production[i].turns + ')')
                } else if (town.info.train != i) {
                    this.trainInterfaces[i].setCanTrain(false)
                }
            }
            if (town.info.turns) {
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
    setVisible(boolean) {
        this.visible = boolean
    }
    click(point) {
        if (this.visible && this.isInside(point)) {
            for (let i in this.trainInterfaces) {
                if (this.trainInterfaces[i].click(point))
                    break
            }
            return true
        }
        return false
    }
    isInside(point) {
        return this.background.isInside(point)
    }
    draw() {
        if (!this.visible)
            return

        this.background.draw()
        this.gold.draw()
        this.goldText.draw()
        for (let i in this.trainInterfaces) {
            this.trainInterfaces[i].draw()
        }
    }
}

class TrainInterface {
    constructor(imageMargin, costTextMargin, buttonMargin, image, costText, button, x, y, name) {
        this.x = x
        this.y = y

        this.name = name

        this.image = image
        this.costText = costText
        this.button = button

        this.imageMargin = imageMargin
        this.costTextMargin = costTextMargin
        this.buttonMargin = buttonMargin

        this.updateSizes()

        this.canTrain = true
    }
    updateSizes() {
        let x = this.x
        let y = this.y

        this.image.setPos({ x: x + this.imageMargin.x, y: y + this.imageMargin.y })
        this.costText.setPos({ x: x + this.costTextMargin.x, y: y + this.costTextMargin.y })
        this.button.setPos({ x: x + this.buttonMargin.x, y: y + this.buttonMargin.y })
    }
    setPos(pos) {
        this.x = pos.x
        this.y = pos.y
        this.updateSizes()
    }
    click(point) {
        return this.button.click(point)
    }
    setCostText(text) {
        this.costText.setText(text)
    }
    setFunction(func) {
        this.button.setFunction(func)
    }
    setButtonText(text) {
        this.button.setText(text)
    }
    setCanTrain(boolean) {
        this.canTrain = boolean
        this.button.setCanClick(boolean)
    }
    draw() {
        this.image.draw()
        this.costText.draw()
        if (this.canTrain)
            this.button.draw()
    }
}