function displayDescription(_class) {
    entityInterface.change(_class.description, gameEvent.selected.player.fullColor)
}
class BarrackInterface {
    #visible = false
    constructor() {
        this.pos = {
            x: WIDTH * 0.72,
            y: HEIGHT * 0.01, // 0.12
        }
        this.height = 0.4 * HEIGHT
        this.width = WIDTH - this.pos.x 

        const bestThisWidthWIDTHRatio = 4

        let stroke = 0.002 * WIDTH * 1.15
        let cornerRadius = 0.03 * WIDTH * 1.15
            //let indent = stroke + cornerRadius
        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, 
            [cornerRadius, 0, 0, cornerRadius], stroke)
        let goldImageSize = this.height * 0.25
        this.gold = new JustImage('gold', {
                x: this.pos.x + 0.22 * 0.17 * WIDTH * 1.15,
                y: this.pos.y + this.height * 0.05 + this.height * 0.08
            },
            goldImageSize, goldImageSize)
        this.goldText = new Text(this.gold.x + 0.22 * WIDTH * 1.15 * 0.92, this.gold.y, 
                                 0.03 * WIDTH * 1.15, 'error', 'white', 'right')
        
        this.makeTrainInterfaces()
        this.updateSizes()
    }
    updateSizes() {
        let maximumTrainInterfacesCount = 0
        for (let i in this.trainInterfaces) {
            let thisLength = getLength(this.trainInterfaces[i])
            if (thisLength > maximumTrainInterfacesCount)
                maximumTrainInterfacesCount = thisLength
        }
        let interfaceSize = this.getTrainInterfaceY(maximumTrainInterfacesCount - 1)

        const requiredMargin = height * 0.1
        if (interfaceSize - this.pos.y > this.height - requiredMargin) {
            this.height = interfaceSize - this.pos.y + requiredMargin
            this.background.height = this.height
        }
    }
    getTrainInterfaceInfo() {
        const heightWidthBestRatio = 0.55
        this.trainInterfacesMarginInterval = this.height * 0.25
        let trainInterfaces = {
            margin: {
                image: {
                    x: 0,
                    y: 0
                },
                costText: {
                    x: 0.22 * WIDTH * 1.15 * 0.26,
                    y: 0
                },
                button: {
                    x: 0.11 * WIDTH * 1.15 * 0.9,
                    y: -0.07 * HEIGHT / 2
                }
            },
            model: {
                image: {
                    width: 0.1 * HEIGHT,
                    height: 0.1 * HEIGHT
                },
                costText: {
                    fontSize: 0.04 * WIDTH * 1.15 * 
                        heightWidthBestRatio,
                    text: 'cost'
                },
                button: {
                    text: {
                        text: 'train',
                        color: '#747474',
                        fontSize: 0.04 * WIDTH * 1.15 * 
                            heightWidthBestRatio
                    },
                    rect: {
                        color: '#f7f7f7',
                        cornerRadius: 0.03 * HEIGHT,
                        borderColor: 'black',
                        stroke: 0.003 * HEIGHT,
                        width: 0.18 * WIDTH * 1.15 * heightWidthBestRatio,
                        height: 0.07 * HEIGHT
                    }
                }
            }
        }
        return trainInterfaces
    }
    isTypeValid(type) {
        return type == 'unit'
    }
    getTrainInterfaceY(index) {
        return this.gold.y + this.height * 0.3 + this.trainInterfacesMarginInterval * index
    }
    trainInterfacesCreationLoop(trainInterfaces, index) {
    //constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true, callThis) 
//constructor(x, y, width, height, 
        for (let i in production) {
            let name = i
            let type = production[name].production.isUnitProduction()?'unit':'building'
            if (!this.isTypeValid(type))
                continue
            
            let models = trainInterfaces.model
            let margins = trainInterfaces.margin

            let image
            if (name == 'suburb') 
                image = new SuburbImage({}, 0.22 * WIDTH * 0.1, 0.002 * WIDTH)
            else
                image = new JustImage(name, {}, models.image.width, models.image.height)

            let imageButton = new ImageButton(
                image, 
                new Rect(NaN, NaN, models.image.width, models.image.height),
                displayDescription, getClass(name)
            )
            let costText = new Text(NaN, NaN, models.costText.fontSize, models.costText.text)
            let button = new Button(
                new Rect(NaN, NaN, models.button.rect.width, models.button.rect.height, [models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius, models.button.rect.cornerRadius],
                    models.button.rect.stroke, models.button.rect.color),
                new Text(0, 0, models.button.text.fontSize, models.button.text.text, models.button.text.color),
                prepareEvent, name
            )
            
           
            this.trainInterfaces[type][name] =
                new TrainInterface(
                    margins.image, margins.costText, margins.button,
                    imageButton, costText, button,
                    this.gold.x, this.getTrainInterfaceY(index[type]), name)
            this.trainInterfaces[type][name].setCostText('cost: ' + production[i].cost)
            ++index[type]
        }
    }
    makeTrainInterfaces() {
        let trainInterfaces = this.getTrainInterfaceInfo()
        
        this.trainInterfacesTab = 'unit'
        
        this.trainInterfaces = {
            unit: {}
        }
        
        let index = {
            unit: 0
        }
        
        this.trainInterfacesCreationLoop(trainInterfaces, index)
    }
    changeUnitTab(barrack) {
        const type = 'unit'
        
        let canTrainNew = !barrack.info.train
        for (let i in this.trainInterfaces[type]) {
            this.trainInterfaces[type][i].setCanTrain(canTrainNew)
            this.trainInterfaces[type][i].setButtonText('train (' + production[i].turns + ')')
        }
        if (!canTrainNew) {
            this.trainInterfaces[type][barrack.info.train].setButtonText(
                         barrack.info.turns + ' / ' + production[barrack.info.train].turns)
            this.trainInterfaces[type][barrack.info.train].setCanTrain(true)
        }
    }
    change(barrack, color) {
        this.background.color = color.hex

        this.changeUnitTab(barrack)
        this.goldText.text = barrack.info.gold
        this.visible = true
    }
    set visible(boolean) {
        this.#visible = boolean
        if (mobilePhone)
            nextTurnButton.canClick = !boolean
    }
    get visible() {
        return this.#visible
    }
    wasClickOnButton(point) {
        for (let i in this.trainInterfaces[this.trainInterfacesTab]) {
            let trainInterface = this.trainInterfaces[this.trainInterfacesTab][i]
            if (trainInterface.click(point) ||
                trainInterface.imageClick(point)) {
                return true
            }
        }
        return false
    }
    click(point) {
        if (this.visible && this.isInside(point)) {
            this.wasClickOnButton(point)
            return true
        }
        return false
    }
    isInside(point) {
        return this.background.isInside(point)
    }
    draw(ctx) {
        if (!this.visible)
            return

        this.background.draw(ctx)
        this.gold.draw(ctx)
        this.goldText.draw(ctx)
        for (let i in this.trainInterfaces[this.trainInterfacesTab]) {
            this.trainInterfaces[this.trainInterfacesTab][i].draw(ctx)
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

        this.image.center = { x: x + this.imageMargin.x, y: y + this.imageMargin.y }
        this.costText.pos = { x: x + this.costTextMargin.x, y: y + this.costTextMargin.y }
        this.button.pos = { x: x + this.buttonMargin.x, y: y + this.buttonMargin.y }
    }
    setPos(pos) {
        this.x = pos.x
        this.y = pos.y
        this.updateSizes()
    }
    click(point) {
        return this.button.click(point)
    }
    imageClick(point) {
        return this.image.click(point)
    }
    setCostText(text) {
        this.costText.text = text
    }
    setFunction(func) {
        this.button.setFunction(func)
    }
    setButtonText(text) {
        this.button.textString = text
    }
    setCanTrain(boolean) {
        this.canTrain = boolean
        this.button.canClick = boolean
    }
    draw(ctx) {
        this.image.draw(ctx)
        this.costText.draw(ctx)
        if (this.canTrain)
            this.button.draw(ctx)
    }
}