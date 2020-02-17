class Slot {
    constructor(rect, slotNumber) {
        this.rect = rect
        this.isEmpty = true
        this.slotNumberText = new Text(
            this.rect.centerX, this.rect.y + this.rect.height * 0.15, 
            this.rect.width * 0.2, '(' + (slotNumber + 1) + ')', 'black',
            undefined, undefined, this.rect.selectedRatio)

        this.text = {
            playersCount: new Text(
                this.rect.centerX, this.rect.y + this.rect.height * 0.35, 
                this.rect.width * 0.2, 
                undefined, undefined, undefined, undefined, this.rect.selectedRatio),
            round: new Text(
                this.rect.centerX, this.rect.y + this.rect.height * 0.55, 
                this.rect.width * 0.2,
                undefined, undefined, undefined, undefined, this.rect.selectedRatio),
            fogOfWar: new Text(
                this.rect.centerX, this.rect.y + this.rect.height * 0.75, 
                this.rect.width * 0.2,
                undefined, undefined, undefined, undefined, this.rect.selectedRatio)
        }
    }
    get bottom() {
        return this.rect.bottom
    }
    get x() {
        return this.rect.x
    }
    set x(val) {
        let dt = val - this.rect.x
        this.rect.x = val
        this.slotNumberText.x += dt
        for (let key in this.text) {
            this.text[key].x += dt
        }
    }
    set playersCount(val) {
        this.text.playersCount.text = 'Players: ' + val
    }
    set gameRound(val) {
        this.text.round.text = 'Round: ' + val
    }
    set fogOfWar(val) {
        let s = ''
        if (val) {
            s = 'Fog of war'
        }
        this.text.fogOfWar.text = s
    }
    set color(val) {
        this.isEmpty = false
        this.rect.color = val
        this.slotNumberText.color = 'white'
    }
    select(pos) {
        this.rect.select(pos)
        if (this.rect.selected) {
            this.slotNumberText.select()
            for (let key in this.text) {
                this.text[key].select()
            }
        }
    }
    removeSelect() {
        this.rect.removeSelect()
        this.slotNumberText.removeSelect()
        for (let key in this.text) {
            this.text[key].removeSelect()
        }
    }
    click(pos) {
        return this.rect.click(pos)
    }
    draw(ctx) {
        this.rect.draw(ctx)
        this.slotNumberText.draw(ctx)
        if (this.isEmpty)
            return
        
        for (let key in this.text) {
            this.text[key].draw(ctx)
        }
    }
}
class SlotManager {
    constructor(slotsCount, y, clickFunc) {
        this.y = y
        this.x = WIDTH * 0.1
        this.init(slotsCount, clickFunc)
    }
    init(slotsCount, clickFunc) {
        const rectSize = WIDTH * 0.2
        const marginX = WIDTH * 0.05
        const firstY = this.y//HEIGHT * 0.4
        let slots = []
        const firstX = this.x
        const cornerR = rectSize * 0.1
        for (let i = 0; i < slotsCount; ++i) {
            slots.push(new Slot(
                new MenuButton(new Rect(
                    firstX + i * rectSize + i * marginX, firstY, 
                    rectSize, rectSize, [cornerR, cornerR, cornerR, cornerR], 
                    0.0035 * WIDTH, 'white', undefined, 0.4
            ), new Text(NaN, NaN, NaN, ''), clickFunc, i), i))
        }
        let maximumOffset = firstX * 2 + (rectSize * slotsCount + marginX * (slotsCount - 1)) - WIDTH
        this.movingForm = new MovingForm(slots, 
            {min: -maximumOffset, max: 0})
    }
    get pos() {
        return {x: this.x, y: this.y}
    }
    get bottom() {
        return this.movingForm.elements[0].bottom
    }
    set pos(pos) {
        // no need setter cuz SlotManager static
    }
    select(pos) {
        this.movingForm.select(pos)
        this.touchstart(pos)
    }
    removeSelect() {
        this.movingForm.removeSelect()
    }
    update() {
        let slots = this.movingForm.elements
        for (let i = 0; i < slots.length; ++i) {
            let slotInfoJSON = loadSlotInfo(i)
            if (slotInfoJSON.whooseTurn == -1)
                continue
            let slotInfo = {
                players: JSON.parse(slotInfoJSON.players),
                whooseTurn: JSON.parse(slotInfoJSON.whooseTurn),
                gameRound: JSON.parse(slotInfoJSON.gameRound),
                fogOfWar: JSON.parse(slotInfoJSON.fogOfWar)
            }
            
            slots[i].playersCount = slotInfo.players.length - 1
            slots[i].gameRound = slotInfo.gameRound
            slots[i].fogOfWar = slotInfo.fogOfWar
            let rgb = slotInfo.players[slotInfo.whooseTurn].color
            slots[i].color = rgbToHex(rgb.r, rgb.g, rgb.b) 
        }
    }
    touchstart(pos) {
        this.movingForm.touchstart(pos)
    }
    touchmove(pos) {
        this.movingForm.touchmove(pos)
    }
    click(pos) {
        this.movingForm.click(pos)
    }
    draw(ctx) {
        this.movingForm.draw(ctx)
    }
}