function menuClick(event) {
    let pos = getEventPos(event)
    menu.click(pos)
}

function menuBack() {
    menu.back()
}
function menuTouchStart(event) {
    let pos = getEventPos(event)
    menu.touchStart(pos)
}
function menuTouchMove(event) {
    let pos = getEventPos(event)
    menu.touchMove(pos)
}
function menuTouchEnd(event) {
    let pos = getEventPos(event)
    menu.touchEnd(pos)
}
function start(_slot) {
    gameSlot = _slot
    let game_mode = menu.previousTree
    GameManager.start(game_mode.selectedMap, game_mode.isFogOfWar, game_mode.isDynamicTimer, game_mode.isOnline, game_mode.currentPassword)
}
function startAI(_slot) {
    gameSlot = _slot

    return GameManager.startAI()
}
function load(_slot) {
    gameSlot = _slot
    if (!saveManager.load())
        return
    GameManager.load()
}

class Tree {
    #interval = HEIGHT * 0.08
    constructor(buttons, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.buttons = new Array(buttons.length)
        this.buttons[0] = buttons[0]
        for (let i = 1; i < buttons.length; ++i) {
            buttons[i].pos = {x: pos0X, y: buttons[i - 1].bottom + this.#interval}
            this.buttons[i] = buttons[i]
        }
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = this.buttons[this.buttons.length - 1].bottom
        this.buttons.push(
            Menu.getButton({x: pos0X, y: y + this.#interval},
                'back', _menu.setTree, parent, true, _menu)
        )
    }
    click(pos) {
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].click(pos)
        }
    }
    draw(ctx) {
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
    }
}
menuOptions = {
    fontSize: 0.04 * WIDTH,
    rectSize: 0.05 * WIDTH,
    checkBox: {
        strokeWidth: 0.003 * WIDTH,
        color: 'white'
    }
}
menuOptions.marginLeft = 0.5 * menuOptions.rectSize
menuOptions.cornerR = 0.1 * menuOptions.rectSize

class OtherSettingsTree {
    FIRST_Y = 0.35 * HEIGHT
    INTERVAL_Y = 0.12 * HEIGHT
    constructor() {
        const firstY = this.FIRST_Y
        const intervalY = this.INTERVAL_Y
        const cornerR = menuOptions.cornerR

        this.hpBarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, menuOptions.fontSize, 'always display hp bar', 'black'), menuOptions.marginLeft,
            WIDTH * 0.65, firstY, menuOptions.rectSize, menuOptions.rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.movesBarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, menuOptions.fontSize, 'always display moves bar', 'black'), menuOptions.marginLeft,
            WIDTH * 0.7, firstY + intervalY, menuOptions.rectSize, menuOptions.rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.undoCheckBox = new ImageCheckBox('checkMark', new Text(NaN, NaN, menuOptions.fontSize,
            'move camera to undo target', 'black'), menuOptions.marginLeft,
            WIDTH * 0.7, firstY + 2 * intervalY, menuOptions.rectSize, menuOptions.rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.polishedSpritesCheckBox = new ImageCheckBox('checkMark', new Text(NaN, NaN, menuOptions.fontSize,
            'use polished sprites', 'black'), menuOptions.marginLeft,
            WIDTH * 0.7, firstY + 3 * intervalY, menuOptions.rectSize, menuOptions.rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.buttons = []
        this.buttons.push(this.hpBarCheckBox, this.movesBarCheckBox, this.undoCheckBox, this.polishedSpritesCheckBox)
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = this.FIRST_Y + this.buttons.length * this.INTERVAL_Y
        this.backButton = Menu.getButton({x: pos0X, y: y},
            'back', _menu.setTree, parent, true, _menu)
        this.buttons.push(this.backButton)
    }
    click(pos) {
        let ok = false
        for (let i = 0; i < this.buttons.length - 1; ++i) {
            ok |= this.buttons[i].click(pos)
        }
        this.__updateOtherSettings()

        ok |= this.buttons[this.buttons.length - 1].click(pos)
        return ok
    }
    __updateOtherSettings() {
        let usePolishedSprites = otherSettings.usePolishedSprites
        otherSettings.alwaysDisplayHPBar = this.hpBarCheckBox.mark
        otherSettings.alwaysDisplayMovesBar = this.movesBarCheckBox.mark
        otherSettings.moveCameraToUndoTarget = this.undoCheckBox.mark
        otherSettings.usePolishedSprites = this.polishedSpritesCheckBox.mark

        if (usePolishedSprites != otherSettings.usePolishedSprites)
            loadSprites()

        saveOtherSettings()
    }
    __updateButtonsByOtherSettings() {
        this.hpBarCheckBox.mark = otherSettings.alwaysDisplayHPBar
        this.movesBarCheckBox.mark = otherSettings.alwaysDisplayMovesBar
        this.undoCheckBox.mark = otherSettings.moveCameraToUndoTarget
        this.polishedSpritesCheckBox.mark = otherSettings.usePolishedSprites
    }
    draw(ctx) {
        this.__updateButtonsByOtherSettings()
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
    }
}

function CreateMapSlider(firstY, intervalY, fontSize, slidePosX) {
    let minimumValueMap = function() { return 0 }
    let maximumValueMap = function() { return dictionaryLength(maps) - 1 }
    let getKeyMap = function(value) { return getKeyByIndexDictionary(maps, value) }
    let sliderMarginX = WIDTH * 0.18
    return new MenuSlider(minimumValueMap, maximumValueMap, getKeyMap, undefined,
        0, sliderMarginX,
    new Text(slidePosX, firstY + intervalY, fontSize),
            {width: HEIGHT * 0.1, height: HEIGHT * 0.1})

}

class GameSettingsTree {
    isOnline = false
    // needed for online game
    currentPassword = 'error'
    constructor(_menu) {
        const rectSize = WIDTH * 0.05
        const cornerR = rectSize * 0.1
        const marginLeft = rectSize * 0.5
        /*const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.15*/
        const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.12

        const posX = WIDTH * 0.5

        const fontSize = 0.04 * WIDTH
        this.playersText = new Text(posX - Menu.getButton().width / 2,
            firstY, fontSize, 'players', 'black', 'left')

        const slidePosX = posX + WIDTH * 0.1

        this.mapSlider = CreateMapSlider(firstY, intervalY, fontSize, slidePosX)

        let minimumValuePlayers = function() { return 0 }
        let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        let getKeyPlayers = function(value) { return value + 2 }
        this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
            getKeyPlayers, this.mapSlider,
            0, WIDTH * 0.04,
        new Text(slidePosX, firstY, fontSize),
                {width: HEIGHT * 0.1, height: HEIGHT * 0.1})


        this.mapText = new Text(this.mapSlider.leftButton.x - HEIGHT * 0.2,
            firstY + intervalY, fontSize, 'map', 'black', 'left')


        this.fogOfWarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'fog of war', 'black'), marginLeft,
            WIDTH * 0.58, firstY + intervalY * 2, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.timerCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'dynamic timer', 'black'), marginLeft,
            WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()
        //this.fogOfWarCheckBox.toCenterX()

        intervalY -= HEIGHT * 0.01

        this.playButton = Menu.getButton(
            {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: firstY + intervalY * 4}, 'start',
                _menu.setTree, _menu.startGame, true, _menu)

        this.updateButtonsList()
    }
    updateButtonsList() {
        this.buttons = [this.backButton, this.playButton,
            this.fogOfWarCheckBox, this.timerCheckBox, this.playersSlider, this.mapSlider]
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = HEIGHT * 0.3 + 4 * HEIGHT * 0.12
        this.backButton = Menu.getButton({x: pos0X, y: y + HEIGHT * 0.08},
            'back', _menu.setTree, parent, true, _menu)

        this.updateButtonsList()
    }
    /*select(pos) {
        this.fogOfWarCheckBox.select(pos)
        this.backButton.select(pos)
    }
    removeSelect() {
        this.fogOfWarCheckBox.removeSelect()
        this.backButton.removeSelect()
    }*/
    get selectedMap() {
        let map = maps[this.mapSlider.realValue][this.playersSlider.value]
        return map
    }
    get isFogOfWar() {
        let res = this.fogOfWarCheckBox.mark
        return res
    }
    get isDynamicTimer() {
        let res = this.timerCheckBox.mark
        return res
    }
    click(pos) {
        let ok = false
        // Mode changes replace the list during a click. Visit the original list once.
        const buttons = this.buttons
        for (let i = 0; i < buttons.length - 1; ++i) {
            ok |= buttons[i].click(pos)
        }
        if (buttons[buttons.length - 1].click(pos)) {
            // map slider click
            this.playersSlider.update()
            ok = true
        }
        return ok
    }
    draw(ctx) {
        this.playersText.draw(ctx)
        this.mapText.draw(ctx)
        if (this.isCoop) drawCoopDimensions(this, ctx)
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
        /*this.fogOfWarCheckBox.draw(ctx)
        this.backButton.draw(ctx)

        this.mapSlider.draw(ctx)*/
    }
}

function drawCoopDimensions(settings, ctx) {
    const {mapSize} = getCoopMapScaling(settings.playersSlider.value, settings.sizeSlider.realValue.toLowerCase())
    new Text(WIDTH * 0.12, HEIGHT * 0.18, WIDTH * 0.04, 'size', 'black', 'left').draw(ctx)
    settings.dimensionsText = new Text(WIDTH * 0.6, HEIGHT * 0.23,
        Math.max(15, WIDTH * 0.022), `${mapSize.x}×${mapSize.y}`, 'black')
    settings.dimensionsText.draw(ctx)
}

// Keep size on its own row above the existing player/seed/options controls.
function createCoopSizeSlider() {
    const side = Math.min(HEIGHT * 0.08, WIDTH * 0.1)
    return new MenuSlider(() => 0, () => 2, value => ['Tiny', 'Normal', 'Big'][value],
        undefined, 1, WIDTH * 0.18,
        new Text(WIDTH * 0.6, HEIGHT * 0.18, WIDTH * 0.04, 'Normal', 'black'),
        {width: side, height: side})
}

// Local co-op uses the same fog/timer controls and save-slot flow as hot seat.
class CoopSettingsTree extends GameSettingsTree {
    constructor(_menu, minimumHumans = 1) {
        super(_menu)
        this.playersText.text = 'humans'
        this.playersText.x = this.mapText.x
        this.mapText.text = 'seed'
        this.playersSlider.minimumValue = () => minimumHumans
        this.playersSlider.maximumValue = () => 12
        this.playersSlider.textByValue = value => value
        this.playersSlider.value = 2
        this.playersSlider.update()
        // generateCoopGame accepts seed 0, so the menu can select it too.
        this.mapSlider.minimumValue = () => 0
        this.mapSlider.maximumValue = () => 999
        this.mapSlider.textByValue = value => value
        this.mapSlider.value = 1
        this.mapSlider.update()
        this.sizeSlider = createCoopSizeSlider()
        // Width-bound arrows keep portrait controls clear of labels and values.
        for (const slider of [this.playersSlider, this.mapSlider]) {
            slider.text.color = 'black'
            for (const button of [slider.leftButton, slider.rightButton]) {
                button.rect.width = button.rect.height = Math.min(HEIGHT * 0.1, WIDTH * 0.09)
                button.img.width = button.img.height = button.rect.width
            }
        }
        this.playersSlider.marginX = WIDTH * 0.1
        this.playersSlider.trim()
        this.mapSlider.trim()
    }
    get selectedMap() {
        return generateCoopGame(this.playersSlider.value, {seed: this.mapSlider.value, size: this.sizeSlider.realValue.toLowerCase()})
    }
}

// Keep each mode's map/player selection while sharing the Hotseat options.
class HotseatSettingsTree extends GameSettingsTree {
    constructor(_menu) {
        super(_menu)
        this.isCoop = false
        this.competitiveSliders = {players: this.playersSlider, map: this.mapSlider}
        const coop = new CoopSettingsTree(_menu)
        this.coopSliders = {players: coop.playersSlider, map: coop.mapSlider, size: coop.sizeSlider}
        this.competitivePlayersX = this.playersText.x
        this.competitiveMapX = this.mapText.x
        const rect = Menu.getButtonRect({x: WIDTH * 0.02, y: HEIGHT * 0.04})
        rect.width = WIDTH * 0.23
        rect.height = HEIGHT * 0.08
        const text = Menu.getButtonText('Competitive')
        text.fontSize = WIDTH * 0.03
        this.modeButton = new MenuButton(rect, text, this.toggleMode, undefined, true, this)
        this.updateButtonsList()
    }
    updateButtonsList() {
        super.updateButtonsList()
        // Keep the map slider last for GameSettingsTree.click's player refresh.
        if (this.modeButton) this.buttons.splice(2, 0, this.modeButton)
        if (this.isCoop) this.buttons.splice(2, 0, this.sizeSlider)
    }
    toggleMode() {
        this.isCoop = !this.isCoop
        const sliders = this.isCoop ? this.coopSliders : this.competitiveSliders
        this.playersSlider = sliders.players
        this.mapSlider = sliders.map
        this.sizeSlider = sliders.size
        this.playersText.text = this.isCoop ? 'humans' : 'players'
        this.playersText.x = this.isCoop ? WIDTH * 0.12 : this.competitivePlayersX
        this.mapText.text = this.isCoop ? 'seed' : 'map'
        this.mapText.x = this.isCoop ? WIDTH * 0.12 : this.competitiveMapX
        this.modeButton.text.text = this.isCoop ? 'Co-op' : 'Competitive'
        this.modeButton.selectedText.text = this.modeButton.text.text
        this.updateButtonsList()
    }
    get selectedMap() {
        return this.isCoop
            ? generateCoopGame(this.playersSlider.value, {seed: this.mapSlider.value, size: this.sizeSlider.realValue.toLowerCase()})
            : super.selectedMap
    }
}

class OnlineSettingsTree {
    isOnline = true
    constructor(_menu) {
        const rectSize = WIDTH * 0.05
        const cornerR = rectSize * 0.1
        const marginLeft = rectSize * 0.5
        /*const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.15*/
        const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.12

        const posX = WIDTH * 0.5

        const fontSize = 0.04 * WIDTH
        this.playersText = new Text(posX - Menu.getButton().width / 2,
            firstY, fontSize, 'players', 'black', 'left')

        const slidePosX = posX + WIDTH * 0.1

        this.mapSlider = CreateMapSlider(firstY, intervalY, fontSize, slidePosX)

        let minimumValuePlayers = function() { return 0 }
        let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        let getKeyPlayers = function(value) { return value + 2 }
        this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
            getKeyPlayers, this.mapSlider,
            0, WIDTH * 0.04,
        new Text(slidePosX, firstY, fontSize),
                {width: HEIGHT * 0.1, height: HEIGHT * 0.1})


        this.mapText = new Text(this.mapSlider.leftButton.x - HEIGHT * 0.2,
            firstY + intervalY, fontSize, 'map', 'black', 'left')

        // let minimumValueMap = function() { return 0 }
        // let maximumValueMap = function() { return dictionaryLength(maps) - 1 }
        // let getKeyMap = function(value) { return getKeyByIndexDictionary(maps, value) }
        // this.mapSlider = new MenuSlider(minimumValueMap, maximumValueMap, getKeyMap, undefined,
        //     0, WIDTH * 0.075,
        // new Text(slidePosX, firstY + intervalY, fontSize),
        //         {width: HEIGHT * 0.1, height: HEIGHT * 0.1})

        // let minimumValuePlayers = function() { return 0 }
        // let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        // let getKeyPlayers = function(value) { return value + 2 }
        // this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
        //     getKeyPlayers, this.mapSlider,
        //     0, WIDTH * 0.04,
        // new Text(slidePosX, firstY, fontSize),
        //         {width: HEIGHT * 0.1, height: HEIGHT * 0.1})


        // this.mapText = new Text(posX - Menu.getButton().width / 2,
        //     firstY + intervalY, fontSize, 'map', 'black', 'left')


        this.fogOfWarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'fog of war', 'black'), marginLeft,
            WIDTH * 0.28, firstY, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)



        this.passwordButtons = []

        this.currentPassword = ''

        this.initializePasswordsButtons(firstY, intervalY)

        this.passwordText = new Text(marginLeft,
            firstY + intervalY * 2, fontSize, 'enter password:', 'black', 'left')



        // this.timerCheckBox = new ImageCheckBox('checkMark',
        //     new Text(NaN, NaN, fontSize, 'dynamic timer', 'black'), marginLeft,
        //     WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize,
        //     [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()

        intervalY -= HEIGHT * 0.01

        this.playButton = Menu.getButton(
            {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: firstY + intervalY * 4}, 'start',
            _menu.setTree, _menu.startGame, true, _menu)

        const modeRect = Menu.getButtonRect({x: WIDTH * 0.02, y: HEIGHT * 0.04})
        modeRect.width = WIDTH * 0.23
        modeRect.height = HEIGHT * 0.08
        const modeText = Menu.getButtonText('Competitive')
        modeText.fontSize = WIDTH * 0.03
        this.modeButton = new MenuButton(modeRect, modeText, this.toggleMode, undefined, true, this)
        this.competitiveMapX = this.mapText.x
        this.competitivePlayersX = this.playersText.x
        this.playersText.fontSize = WIDTH * 0.032
        this.isCoop = false
        this.competitiveSliders = {players: this.playersSlider, map: this.mapSlider}
        this.updateButtonsList()
    }
    toggleMode() {
        this.isCoop = !this.isCoop
        if (this.isCoop && !this.coopSliders) {
            const settings = new CoopSettingsTree(menu, 2)
            settings.playersSlider.text.x = WIDTH * 0.72
            settings.playersSlider.trim()
            this.coopSliders = {players: settings.playersSlider, map: settings.mapSlider, size: settings.sizeSlider}
        }
        const sliders = this.isCoop ? this.coopSliders : this.competitiveSliders
        this.playersSlider = sliders.players
        this.mapSlider = sliders.map
        this.sizeSlider = sliders.size
        this.playersText.text = this.isCoop ? 'humans' : 'players'
        this.playersText.x = this.isCoop ? WIDTH * 0.4 : this.competitivePlayersX
        this.passwordText.fontSize = WIDTH * (this.isCoop ? 0.032 : 0.04)
        this.mapText.text = this.isCoop ? 'seed' : 'map'
        this.mapText.x = this.isCoop ? WIDTH * 0.12 : this.competitiveMapX
        this.modeButton.text.text = this.isCoop ? 'Co-op' : 'Competitive'
        this.modeButton.selectedText.text = this.modeButton.text.text
        this.updateButtonsList()
    }
    initializePasswordsButtons(firstY, intervalY) {
        let updatePassword = function(value) {
            this.currentPassword += value;
            this.passwordText.text = this.currentPassword
            // temporary unsafe thing:
            unsafeVariablePassword = this.currentPassword
        }

        const digits_count = 10
        // just draws to rows of digits
        for (let i = 0; i < digits_count; ++i) {
            let size = WIDTH * 0.05
            let step = WIDTH * 0.07

            let max_digits_in_row = 5
            let digits_row_width = size * max_digits_in_row + step * (max_digits_in_row - 1)
            let xOffset = step * (i >= max_digits_in_row ? i - max_digits_in_row : i);
            let rect = Menu.getButtonRect({x: WIDTH / 2 + xOffset - digits_row_width / 2 + WIDTH * 0.25 / 2,
                y: firstY + intervalY * 2 - size / 2 + (i >= 5 ? intervalY : 0)})
            rect.width = rect.height = size

            let res = new MenuButton(
                rect,
                Menu.getButtonText(`${i}`),
                updatePassword, i, true, this)
            this.passwordButtons.push(res)
        }
    }
    updateButtonsList() {
        this.buttons = [this.backButton, this.playButton, this.modeButton,
            this.fogOfWarCheckBox/*, this.timerCheckBox*/, this.playersSlider, this.mapSlider]
        if (this.isCoop) this.buttons.push(this.sizeSlider)
        this.buttons = this.buttons.concat(this.passwordButtons)
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = HEIGHT * 0.3 + 4 * HEIGHT * 0.12
        this.backButton = Menu.getButton({x: pos0X, y: y + HEIGHT * 0.08},
            'back', _menu.setTree, parent, true, _menu)

        this.updateButtonsList()
    }
    /*select(pos) {
        this.fogOfWarCheckBox.select(pos)
        this.backButton.select(pos)
    }
    removeSelect() {
        this.fogOfWarCheckBox.removeSelect()
        this.backButton.removeSelect()
    }*/
    get selectedMap() {
        if (this.isCoop) {
            if (!Number.isInteger(this.playersSlider.value) || this.playersSlider.value < 2 || this.playersSlider.value > 12)
                throw new RangeError('Online co-op requires 2 to 12 humans')
            return generateCoopGame(this.playersSlider.value, {seed: this.mapSlider.value, size: this.sizeSlider.realValue.toLowerCase()})
        }
        let map = maps[this.mapSlider.realValue][this.playersSlider.value]
        return map
    }
    get isFogOfWar() {
        let res = this.fogOfWarCheckBox.mark
        return res
    }
    get isDynamicTimer() {
        let res = false
        return res
    }
    click(pos) {
        let ok = false
        for (const button of this.buttons) {
            const clicked = button.click(pos)
            if (clicked && button === this.mapSlider) this.playersSlider.update()
            ok ||= clicked
        }
        return ok
    }
    draw(ctx) {
        this.playersText.draw(ctx)
        this.mapText.draw(ctx)
        if (this.isCoop) drawCoopDimensions(this, ctx)
        this.passwordText.draw(ctx)
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
        /*this.fogOfWarCheckBox.draw(ctx)
        this.backButton.draw(ctx)

        this.mapSlider.draw(ctx)*/
    }
}

class Menu {
    #visible
    static getButtonRect(pos) {
        return new Rect(pos.x, pos.y, WIDTH * 0.25, HEIGHT * 0.1,
            [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH],
            0.0035 * WIDTH, 'white')//0.007
    }
    static getButtonText(text) {
        return new Text(undefined, undefined, 0.04 * WIDTH, text, 'black')
    }
    static getButton(pos = {x: NaN, y: NaN}, text, clickFunc, parameters, canClick = true, callThis) {
        let res = new MenuButton(
            this.getButtonRect(pos),
            this.getButtonText(text),
            clickFunc, parameters, canClick, callThis)
        return res
    }
    setTree(tree) {
        this.previousTree = this.selectedTree
        this.selectedTree = tree
    }
    constructor() {
        this.visible = true
        const slotsCount = 10
        /*
        play
            1x1
            1x1x1
            back
        options
            checkbox enable HPbar
            back
        load
            slots
            copy
            back
        */
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, undefined, '#d0d0d0')
        this.logo = new JustImage('logo', { x: WIDTH / 2, y: HEIGHT * 0.15 }, WIDTH * 0.5, WIDTH * 0.55 * 0.2)
        this.alphaText = new Text(WIDTH * 0.73, WIDTH * 0.55 * 0.33 - HEIGHT * 0.05,
            0.02 * WIDTH, 'beta', '#747474')

        let startPos = {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: HEIGHT * 0.3}

        this.startGame = new Tree([
            new SlotManager(slotsCount, startPos.y, start)
        ], this)

        this.play = new HotseatSettingsTree(this)

        this.online = new OnlineSettingsTree(this)

        this.settings = new OtherSettingsTree(this)

        this.load = new Tree([
            new SlotManager(slotsCount, startPos.y, load)
        ], this)

        this.main = new Tree([
            this.constructor.getButton(startPos, 'hot seat',
                this.setTree, this.play, true, this),
            this.constructor.getButton(startPos, 'play online',
                this.setTree, this.online, true, this),
            this.constructor.getButton(startPos, 'play AI',
                startAI, 0),
            this.constructor.getButton(startPos, 'settings',
                this.setTree, this.settings, true, this),
            this.constructor.getButton(startPos, 'load game',
                this.setTree, this.load, true, this),
        ], this)

        // Main entries fit in the visible area on both desktop and mobile.
        this.main.buttons.forEach((button, index) => {
            button.pos = {x: startPos.x, y: HEIGHT * (0.27 + index * 0.12)}
        })
        this.play.setParent(this.main, this)
        this.online.setParent(this.main, this)
        this.settings.setParent(this.main, this)
        this.startGame.setParent(this.play, this)
        this.load.setParent(this.main, this)
        this.selectedTree = this.main

        let firstY = HEIGHT * 0.3
        let interval = HEIGHT * 0.18
    }
    get selectedMap() {
        return this.play.selectedMap
    }
    get isFogOfWar() {
        return this.play.isFogOfWar
    }
    get isDynamicTimer() {
        return this.play.isDynamicTimer
    }
    start() {
        this.updateSlotManagers()
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
            if (mobilePhone) {
                document.addEventListener('touchstart', menuTouchStart)
                document.addEventListener('touchmove', menuTouchMove)
                document.addEventListener('touchend', menuTouchEnd)
            }
        } else {
            document.removeEventListener('click', menuClick)
            if (mobilePhone) {
                document.removeEventListener('touchstart', menuTouchStart)
                document.removeEventListener('touchmove', menuTouchMove)
                document.removeEventListener('touchend', menuTouchEnd)
            }
        }
    }
    set visible(boolean) {
        this.#visible = boolean
        this.setEvents(boolean)
    }
    get visible() {
        return this.#visible
    }
    updateSlotManagers() {
        // slot manager:
        this.load.buttons[0].update()
        this.startGame.buttons[0].update()
    }
    back() {
        gameExit = true
        if (onlineSocket) {
            const previous = onlineSocket
            onlineSocket = null
            previous.disconnect()
            onlineLobby = null
        }

        nextTurnPauseInterface.backToMenu()
        saveManager.save() //some bugs or not

        // very important save first then pause timer
        // so that the timer saves the current remaining time
        timer.pauseAndSaveTime()

        menu.visible = true
        menu.start()
        menu.setTree(menu.main)
        this.updateSlotManagers()
    }
    click(pos) {
        this.selectedTree.click(pos)
    }
    touchEnd(pos) {
        for (let i = 0; i < this.selectedTree.buttons.length; ++i) {
            this.selectedTree.buttons[i].removeSelect()
        }
    }
    touchStart(pos) {
        for (let i = 0; i < this.selectedTree.buttons.length; ++i) {
            this.selectedTree.buttons[i].select(pos)
        }
    }
    touchMove(pos) {
        for (let i = 0; i < this.selectedTree.buttons.length; ++i) {
            this.selectedTree.buttons[i].touchmove(pos)
        }
    }
    draw(ctx) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        this.background.draw(ctx)
        // Co-op uses the header space for its size selector.
        if (!this.selectedTree.isCoop) this.logo.draw(ctx)
        this.alphaText.draw(ctx)
        this.selectedTree.draw(ctx)
        /*this.playButton1.draw(ctx)
        this.playButton2.draw(ctx)
        this.playButton3.draw(ctx)
        this.loadButton.draw(ctx)*/

        errorWindow.draw(ctx)
        ctx.restore()
    }
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}
