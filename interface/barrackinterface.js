function displayDescription(_class) {
    entityInterface.change(_class.description, gameEvent.selected.player.fullColor)
}
// The gold edge of the panels' washed buttons and the Switch's active half.
const TRAIN_PANEL_GOLD = '#e0b55e'
// A stat icon (assets entry, TASK-1342) centred at (x, y); one still loading goes to pending.
function drawTrainPanelIcon(ctx, name, x, y, size, pending) {
    const icon = assets[name]
    if (icon && icon.complete && icon.naturalWidth > 0)
        ctx.drawImage(icon, x - size / 2, y - size / 2, size, size)
    else if (icon && !icon.complete)
        pending.push(icon)
}
// A washed button with a gold edge and its text in ink (italic bold, shrunk to fit the rect).
function drawTrainPanelButton(ctx, rect, text, wash) {
    roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, Math.min(rect.height / 2, rect.cornerRadius[0]))
    ctx.fillStyle = wash
    ctx.fill()
    ctx.strokeStyle = TRAIN_PANEL_GOLD
    ctx.lineWidth = Math.max(1, 0.0025 * HEIGHT)
    ctx.stroke()
    drawTrainPanelText(ctx, text.text, rect.x + rect.width / 2, rect.y + rect.height / 2, text.fontSize * 0.8,
        rect.width * 0.88, ENTITY_PANEL_INK, 'center')
}
function drawTrainPanelText(ctx, string, x, y, fontSize, maxWidth, color, align) {
    const font = size => `italic 700 ${size}px ${Text.defaultFamily}`
    ctx.font = font(fontSize)
    const width = ctx.measureText(string).width
    if (width > maxWidth)
        ctx.font = font(fontSize * maxWidth / width)
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillText(string, x, y)
}
class BarrackInterface {
    #visible = false
    constructor() {

        this.pos = {
            x: WIDTH * 0.74,
            y: HEIGHT * 0.01, // 0.12
        }
        this.height = 0.35 * HEIGHT
        this.width = WIDTH - this.pos.x 

        const bestThisWidthWIDTHRatio = 4

        let stroke = 0.001 * WIDTH * 1.15
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
        this.goldText = new Text(this.gold.x + 0.22 * WIDTH * 1.05 * 0.92, this.gold.y, 
                                 0.03 * WIDTH * 1.15, 'error', 'white', 'right')
        
        this.makeTrainInterfaces()
        this.updateSizes()

        this.renderCache = undefined
        this.renderCacheBounds = undefined
        this.renderCacheDirty = true
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
                    width: 0.08 * HEIGHT,
                    height: 0.08 * HEIGHT
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
                        fontSize: 0.04 * WIDTH * 
                            heightWidthBestRatio
                    },
                    rect: {
                        color: '#f7f7f7',
                        cornerRadius: 0.03 * HEIGHT,
                        borderColor: 'black',
                        stroke: 0.0015 * HEIGHT,
                        width: 0.18 * WIDTH * heightWidthBestRatio,
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
    changeTrainingUnitButton(barrack) {
        // The production id: info.train is the shown (display) name.
        const train = barrack.trainId
        if (!train)
            return 
        
        let type = 'unit'

        this.trainInterfaces[type][train].setButtonText(
            barrack.info.turns + ' / ' + production[train].turns)
        this.trainInterfaces[type][train].setCanTrain(true)    
    }
    changeUnitTab(barrack) {
        const type = 'unit'
        
        let canTrainNew = !barrack.trainId
        for (let i in this.trainInterfaces[type]) {
            this.trainInterfaces[type][i].setCanTrain(canTrainNew)
            this.trainInterfaces[type][i].setButtonText('train (' + production[i].turns + ')')
        }
        if (!canTrainNew) {
            this.changeTrainingUnitButton(barrack)
        }
    }
    change(barrack, color) {
        this.background.color = color.hex
        this.setPanelColors(color.hex)

        this.changeUnitTab(barrack)
        this.goldText.text = barrack.info.gold
        this.invalidateRenderCache()
        this.visible = true
    }
    set visible(boolean) {
        if (boolean && !this.#visible)
            this.invalidateRenderCache()
        this.#visible = boolean
        if (typeof entityInterface !== 'undefined') entityInterface.refit()
        /*if (mobilePhone)
            nextTurnButton.canClick = !boolean*/
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
    invalidateRenderCache() {
        this.renderCacheDirty = true
    }
    // The owner's colour under the next-turn button's 40% white wash (nextTurn.js highlightButton colorAlpha 0.4 over
    // TriangleImage's fill: each channel c * 0.6 + 255 * 0.4) and a dark shade of it for the roller. Made in change().
    setPanelColors(hex) {
        const n = parseInt(String(hex).slice(1), 16)
        const channels = [n >> 16 & 255, n >> 8 & 255, n & 255]
        const toHex = f => '#' + channels.map(c => Math.round(f(c)).toString(16).padStart(2, '0')).join('')
        this.panelColors = {source: hex, wash: toHex(c => c * 0.6 + 255 * 0.4), dark: toHex(c => c * 0.6)}
    }
    // Concept F2 inside the background rect: cloth on the inner (left) side and a bottom roller in the washed colour,
    // parchment with straight top, right and bottom (screen edges / roller) and a torn left side.
    drawPanelBody(ctx) {
        const {wash, dark} = this.panelColors
        const bg = this.background
        const r = 0.016 * HEIGHT, m = 0.02 * HEIGHT
        const right = bg.x + bg.width, bottom = bg.y + bg.height - r, x0 = bg.x + m, w = right - x0, h = bottom - bg.y
        ctx.save()
        // Cloth
        ctx.fillStyle = wash
        ctx.fillRect(bg.x, bg.y, bg.width, h)
        ctx.save()
        ctx.beginPath()
        ctx.rect(bg.x, bg.y, bg.width, h)
        ctx.clip()
        ctx.globalAlpha = 0.1
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = -h; i < bg.width; i += 6) {
            ctx.moveTo(bg.x + i, bg.y)
            ctx.lineTo(bg.x + i + h, bg.y + h)
        }
        ctx.stroke()
        ctx.restore()
        // Parchment: the left side torn.
        const tear = () => {
            let k = 65
            const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280
            const j = 0.018 * Math.min(w, h), rows = Math.max(6, Math.round(h / (0.035 * HEIGHT)))
            ctx.beginPath()
            ctx.moveTo(x0, bg.y)
            ctx.lineTo(right, bg.y)
            ctx.lineTo(right, bottom)
            ctx.lineTo(x0, bottom)
            for (let i = rows - 1; i > 0; i--) ctx.lineTo(x0 + (rnd() - 0.5) * 2 * j, bg.y + h * i / rows)
            ctx.closePath()
        }
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 0.02 * HEIGHT
        tear()
        const paper = ctx.createRadialGradient(x0 + w * 0.45, bg.y + h * 0.4, Math.min(w, h) * 0.1, x0 + w / 2,
            bg.y + h / 2, Math.max(w, h) * 0.75)
        paper.addColorStop(0, '#f6e9c9')
        paper.addColorStop(1, '#cfae78')
        ctx.fillStyle = paper
        ctx.fill()
        ctx.restore()
        tear()
        ctx.strokeStyle = 'rgba(110,70,30,0.6)'
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.008)
        ctx.stroke()
        // Roller: the washed colour shaded round, gold caps (the left one inside the background, the right one at the
        // screen edge).
        const roll = ctx.createLinearGradient(0, bottom - r, 0, bottom + r)
        roll.addColorStop(0, dark)
        roll.addColorStop(0.45, wash)
        roll.addColorStop(1, dark)
        ctx.fillStyle = roll
        roundedRectPath(ctx, bg.x, bottom - r, bg.width, 2 * r, r)
        ctx.fill()
        for (const ex of [bg.x + r, right]) {
            ctx.beginPath()
            ctx.arc(ex, bottom, r, 0, 2 * Math.PI)
            const cap = ctx.createRadialGradient(ex - r * 0.3, bottom - r * 0.3, 0, ex, bottom, r)
            cap.addColorStop(0, '#f6dc9a')
            cap.addColorStop(1, '#8a6a2a')
            ctx.fillStyle = cap
            ctx.fill()
        }
        ctx.restore()
    }
    drawContents(ctx) {
        if (this.panelColors?.source !== this.background.color) this.setPanelColors(this.background.color)
        this.iconsPending = []
        this.drawPanelBody(ctx)
        // Gold: TASK-1342's gold icon and the goldText string after it.
        const goldSize = this.gold.width * 0.7
        drawTrainPanelIcon(ctx, 'statGold', this.gold.x, this.gold.y, goldSize, this.iconsPending)
        const goldX = this.gold.x + goldSize * 0.75
        drawTrainPanelText(ctx, String(this.goldText.text), goldX, this.gold.y, this.goldText.fontSize * 0.8,
            this.background.right - 0.03 * HEIGHT - goldX, ENTITY_PANEL_INK, 'left')
        for (let i in this.trainInterfaces[this.trainInterfacesTab]) {
            this.trainInterfaces[this.trainInterfacesTab][i].draw(ctx, this.panelColors.wash, this.iconsPending)
        }
    }
    getRenderCacheBounds() {
        const padding = this.background.strokeWidth
        const left = Math.max(0, Math.floor(this.background.x - padding))
        const top = Math.max(0, Math.floor(this.background.y - padding))
        const right = Math.min(WIDTH, Math.ceil(this.background.right + padding))
        const bottom = Math.min(HEIGHT, Math.ceil(this.background.bottom + padding))
        return {left, top, width: right - left, height: bottom - top}
    }
    createRenderCache() {
        const bounds = this.getRenderCacheBounds()
        if (bounds.width <= 0 || bounds.height <= 0)
            return false

        let cache = this.renderCache
        if (!cache || cache.width != bounds.width || cache.height != bounds.height) {
            cache = document.createElement('canvas')
            cache.width = bounds.width
            cache.height = bounds.height
        }
        const cacheCtx = cache.getContext('2d')
        if (!cacheCtx)
            return false

        cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
        cacheCtx.clearRect(0, 0, cache.width, cache.height)
        cacheCtx.translate(-bounds.left, -bounds.top)
        this.drawContents(cacheCtx)

        this.renderCache = cache
        this.renderCacheBounds = bounds
        this.renderCacheDirty = false
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        // Stat icons still loading when the cache was drawn (the menu does not wait for them): draw it again once.
        if (this.iconsPending?.length && this.iconsPending.every(icon => icon.complete)) this.renderCacheDirty = true
        if ((this.renderCacheDirty || !this.renderCache) && !this.createRenderCache()) {
            this.drawContents(ctx)
            return
        }
        const bounds = this.renderCacheBounds
        ctx.drawImage(this.renderCache, bounds.left, bounds.top)
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
    // The turns of the row: n of the button's 'train (n)' (the total of 'k / n'), else the production's.
    get turnsString() {
        const text = String(this.button.textString)
        const match = /\((\d+)\)/.exec(text) || /\/\s*(\d+)/.exec(text)
        return match ? match[1] : String(production[this.name]?.turns ?? '')
    }
    // Picture; cost coin + number (the 'cost: ' prefix replaced by the icon) and hourglass + turns between it and the
    // button, shrunk to fit; the button washed with a gold edge, its original text in ink.
    draw(ctx, wash, pending) {
        this.image.draw(ctx)
        const cost = String(this.costText.text).replace(/^cost: /, '')
        const turns = this.turnsString
        const left = this.image.rect.right + 0.01 * HEIGHT, right = this.button.x - 0.01 * HEIGHT, y = this.y
        let size = this.costText.fontSize * 0.75
        ctx.font = `700 ${size}px ${Text.defaultFamily}`
        const widths = [ctx.measureText(cost).width, ctx.measureText(turns).width]
        const total = s => s * (1.1 + 0.15 + 0.5 + 1 + 0.15) + (widths[0] + widths[1]) * s / size
        if (total(size) > right - left)
            size *= (right - left) / total(size)
        let x = left
        drawTrainPanelIcon(ctx, 'statCost', x + size * 0.55, y, size * 1.1, pending)
        x += size * 1.25
        ctx.font = `700 ${size}px ${Text.defaultFamily}`
        ctx.fillStyle = ENTITY_PANEL_INK
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(cost, x, y)
        x += widths[0] * size / (this.costText.fontSize * 0.75) + size * 0.5
        drawTrainPanelIcon(ctx, 'statTurns', x + size * 0.5, y, size, pending)
        x += size * 1.15
        ctx.fillStyle = 'rgba(74,46,20,0.8)'
        ctx.fillText(turns, x, y)
        if (this.canTrain)
            drawTrainPanelButton(ctx, this.button.rect, this.button.text, wash)
    }
}
