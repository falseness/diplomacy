function menuClick(event) {
    let pos = getEventPos(event)
    menu.click(pos)
}

function menuWheel(event) {
    if (event.ctrlKey)
        return
    menu.wheel(getEventPos(event), event.deltaY, event.deltaX)
}
// Hover feedback on the main screen's banners and icon buttons.
function menuMouseMove(event) {
    menu.mouseMove(getEventPos(event))
}
function menuKeyDown(event) {
    menu.keydown(event)
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
    GameManager.start(game_mode.selectedMap, game_mode.isFogOfWar, game_mode.isDynamicTimer)
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
    // Scrollable buttons (the save slot list) scroll on desktop by wheel and arrow keys.
    wheel(pos, deltaY, deltaX) {
        for (const button of this.buttons) button.wheel?.(pos, deltaY, deltaX)
    }
    scrollKey(key) {
        for (const button of this.buttons) button.scrollKey?.(key)
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
    // Rows form a two-column grid: labels left-aligned at one x, boxes in one column to their right.
    // The rows and the back button below them are scaled to fit between the logo and the screen bottom.
    LABELS = ['always display hp bar', 'always display moves bar', 'move camera to undo target',
        'use polished sprites', 'autoscout (online fog)', 'Atmospheric visuals']
    BACK_HEIGHT = HEIGHT * 0.1
    FIRST_Y = Math.max(HEIGHT * 0.27, HEIGHT * 0.17 + WIDTH * 0.055)
    INTERVAL_Y = Math.min(HEIGHT * 0.08,
        (HEIGHT * 0.97 - this.BACK_HEIGHT - this.FIRST_Y) / (this.LABELS.length + 0.25))
    constructor() {
        const count = this.LABELS.length
        const intervalY = this.INTERVAL_Y
        let rectSize = Math.min(menuOptions.rectSize, intervalY * 0.7)
        let fontSize = Math.min(menuOptions.fontSize, intervalY * 0.7)
        const labels = this.LABELS.map(label => new Text(NaN, NaN, fontSize, label, MENU_THEME.text, 'left'))
        // The main canvas context does not exist yet when the menu is built; measure as Text draws.
        const measureCtx = document.createElement('canvas').getContext('2d')
        const measure = () => Math.max(...labels.map(text => {
            measureCtx.font = text.fontSize + 'px Times New Roman'
            return measureCtx.measureText(text.text).width
        }))
        let labelWidth = measure()
        // Shrink the whole grid if it would not fit the screen width.
        const fit = WIDTH * 0.92 / (labelWidth + 1.5 * rectSize)
        if (fit < 1) {
            rectSize *= fit
            fontSize *= fit
            labels.forEach(text => text.fontSize = fontSize)
            labelWidth = measure()
        }
        const gap = rectSize * 0.5
        const labelX = (WIDTH - labelWidth - gap - rectSize) / 2
        const boxX = labelX + labelWidth + gap
        const cornerR = rectSize * 0.1
        const strokeWidth = Math.min(menuOptions.checkBox.strokeWidth, rectSize * 0.06)
        const boxes = labels.map((text, i) => {
            const box = new ImageCheckBox('checkMark', text, gap,
                boxX, this.FIRST_Y + (i + 0.5) * intervalY, rectSize, rectSize,
                [cornerR, cornerR, cornerR, cornerR], strokeWidth, menuOptions.checkBox.color)
            text.textAlign = 'left'
            text.x = labelX
            return box
        })
        this.rowsBottom = this.FIRST_Y + count * intervalY
        ;[this.hpBarCheckBox, this.movesBarCheckBox, this.undoCheckBox, this.polishedSpritesCheckBox,
            this.autoscoutCheckBox, this.atmosphericVisualsCheckBox] = boxes

        this.buttons = []
        this.buttons.push(this.hpBarCheckBox, this.movesBarCheckBox, this.undoCheckBox, this.polishedSpritesCheckBox,
            this.autoscoutCheckBox, this.atmosphericVisualsCheckBox)
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = this.rowsBottom + this.INTERVAL_Y * 0.25
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
        const atmosphericVisuals = otherSettings.atmosphericVisuals
        otherSettings.alwaysDisplayHPBar = this.hpBarCheckBox.mark
        otherSettings.alwaysDisplayMovesBar = this.movesBarCheckBox.mark
        otherSettings.moveCameraToUndoTarget = this.undoCheckBox.mark
        otherSettings.usePolishedSprites = this.polishedSpritesCheckBox.mark
        otherSettings.autoscout = this.autoscoutCheckBox.mark
        otherSettings.atmosphericVisuals = this.atmosphericVisualsCheckBox.mark
        if (atmosphericVisuals !== otherSettings.atmosphericVisuals && grid) {
            // Rebuild the board display on the next frame, without changing game state.
            grid.surfaceCacheState = undefined
        }

        if (usePolishedSprites != otherSettings.usePolishedSprites ||
            atmosphericVisuals !== otherSettings.atmosphericVisuals)
            loadSprites()

        saveOtherSettings()
    }
    __updateButtonsByOtherSettings() {
        this.hpBarCheckBox.mark = otherSettings.alwaysDisplayHPBar
        this.movesBarCheckBox.mark = otherSettings.alwaysDisplayMovesBar
        this.undoCheckBox.mark = otherSettings.moveCameraToUndoTarget
        this.polishedSpritesCheckBox.mark = otherSettings.usePolishedSprites
        this.autoscoutCheckBox.mark = otherSettings.autoscout
        this.atmosphericVisualsCheckBox.mark = otherSettings.atmosphericVisuals
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
    new Text(slidePosX, firstY + intervalY, fontSize, undefined, MENU_THEME.text),
            {width: HEIGHT * 0.1, height: HEIGHT * 0.1})

}

class GameSettingsTree {
    isOnline = false
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
            firstY, fontSize, 'players', MENU_THEME.text, 'left')

        const slidePosX = posX + WIDTH * 0.1

        this.mapSlider = CreateMapSlider(firstY, intervalY, fontSize, slidePosX)

        let minimumValuePlayers = function() { return 0 }
        let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        let getKeyPlayers = function(value) { return value + 2 }
        this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
            getKeyPlayers, this.mapSlider,
            0, WIDTH * 0.04,
        new Text(slidePosX, firstY, fontSize, undefined, MENU_THEME.text),
                {width: HEIGHT * 0.1, height: HEIGHT * 0.1})


        this.mapText = new Text(this.mapSlider.leftButton.x - HEIGHT * 0.2,
            firstY + intervalY, fontSize, 'map', MENU_THEME.text, 'left')


        this.fogOfWarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'fog of war', MENU_THEME.text), marginLeft,
            WIDTH * 0.58, firstY + intervalY * 2, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.timerCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'dynamic timer', MENU_THEME.text), marginLeft,
            WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()
        //this.fogOfWarCheckBox.toCenterX()

        intervalY -= HEIGHT * 0.01

        this.playButton = Menu.getButton(
            {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: firstY + intervalY * 4}, 'start',
                _menu.setTree, _menu.startGame, true, _menu)
        this.playButton.primary = true

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
    new Text(WIDTH * 0.12, HEIGHT * 0.18, WIDTH * 0.04, 'size', MENU_THEME.text, 'left').draw(ctx)
    settings.dimensionsText = new Text(WIDTH * 0.6, HEIGHT * 0.23,
        Math.max(15, WIDTH * 0.022), `${mapSize.x}×${mapSize.y}`, MENU_THEME.mutedText)
    settings.dimensionsText.draw(ctx)
}

// Keep size on its own row above the existing player/seed/options controls.
function createCoopSizeSlider() {
    const side = Math.min(HEIGHT * 0.08, WIDTH * 0.1)
    return new MenuSlider(() => 0, () => 2, value => ['Tiny', 'Normal', 'Big'][value],
        undefined, 1, WIDTH * 0.18,
        new Text(WIDTH * 0.6, HEIGHT * 0.18, WIDTH * 0.04, 'Normal', MENU_THEME.text),
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
            slider.text.color = MENU_THEME.text
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

// The online game controls of the lobby flow's create-lobby screen: mode toggle, competitive map/players or co-op
// humans/seed/size sliders and 'fog of war'. Online always uses the long timer.
class OnlineGameSettings {
    isOnline = true
    constructor(_menu) {
        const rectSize = WIDTH * 0.05
        const cornerR = rectSize * 0.1
        const marginLeft = rectSize * 0.5
        /*const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.15*/
        const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.12
        this.firstY = firstY
        this.intervalY = intervalY
        this.marginLeft = marginLeft

        const posX = WIDTH * 0.5

        const fontSize = 0.04 * WIDTH
        this.playersText = new Text(posX - Menu.getButton().width / 2,
            firstY, fontSize, 'players', MENU_THEME.text, 'left')

        const slidePosX = posX + WIDTH * 0.1

        this.mapSlider = CreateMapSlider(firstY, intervalY, fontSize, slidePosX)

        let minimumValuePlayers = function() { return 0 }
        let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        let getKeyPlayers = function(value) { return value + 2 }
        this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
            getKeyPlayers, this.mapSlider,
            0, WIDTH * 0.04,
        new Text(slidePosX, firstY, fontSize, undefined, MENU_THEME.text),
                {width: HEIGHT * 0.1, height: HEIGHT * 0.1})


        this.mapText = new Text(this.mapSlider.leftButton.x - HEIGHT * 0.2,
            firstY + intervalY, fontSize, 'map', MENU_THEME.text, 'left')

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
            new Text(NaN, NaN, fontSize, 'fog of war', MENU_THEME.text), marginLeft,
            WIDTH * 0.28, firstY, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        // this.timerCheckBox = new ImageCheckBox('checkMark',
        //     new Text(NaN, NaN, fontSize, 'dynamic timer', 'black'), marginLeft,
        //     WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize,
        //     [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()

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
    }
    // Where the screen's action button ('start' or 'create') goes.
    get actionButtonPos() {
        return {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: this.firstY + (this.intervalY - HEIGHT * 0.01) * 4}
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
        this.mapText.text = this.isCoop ? 'seed' : 'map'
        this.mapText.x = this.isCoop ? WIDTH * 0.12 : this.competitiveMapX
        this.modeButton.text.text = this.isCoop ? 'Co-op' : 'Competitive'
        this.modeButton.selectedText.text = this.modeButton.text.text
        this.updateButtonsList()
    }
    updateButtonsList() {
        this.buttons = [this.backButton, this.playButton, this.modeButton,
            this.fogOfWarCheckBox/*, this.timerCheckBox*/, this.playersSlider, this.mapSlider]
        if (this.isCoop) this.buttons.push(this.sizeSlider)
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
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
        /*this.fogOfWarCheckBox.draw(ctx)
        this.backButton.draw(ctx)

        this.mapSlider.draw(ctx)*/
    }
}

// The lobby flow's 'create game' screen: the online controls without a save-slot
// picker. 'create' builds the initial online board with GameManager.buildOnlineBoard
// (without entering the game) and sends it with lobby:create.
class CreateLobbyTree extends OnlineGameSettings {
    constructor(_menu) {
        super(_menu)
        this.menu = _menu
        this.creating = false
        this.asyncMovesCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, WIDTH * 0.03, 'asynchronous moves', MENU_THEME.text), WIDTH * 0.025,
            WIDTH * 0.28, this.firstY + this.intervalY * 2, WIDTH * 0.05, WIDTH * 0.05,
            [4, 4, 4, 4], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)
        this.asyncMovesCheckBox.mark = false
        this.status = new Text(WIDTH / 2, this.firstY + this.intervalY * 2.5, 0.03 * WIDTH, '', MENU_THEME.text)
        this.playButton = Menu.getButton(this.actionButtonPos, 'create', this.create, undefined, true, this)
        this.playButton.primary = true
        this.updateButtonsList()
    }
    enter() {
        this.creating = false
        this.status.text = ''
    }
    updateButtonsList() {
        super.updateButtonsList()
        if (this.asyncMovesCheckBox) this.buttons.push(this.asyncMovesCheckBox)
    }
    // The slider and checkbox values createLobbyStartOptions maps.
    get controls() {
        return this.isCoop
            ? {isCoop: true, fogOfWar: this.isFogOfWar, humans: this.playersSlider.value,
                seed: this.mapSlider.value, size: this.sizeSlider.realValue}
            : {isCoop: false, fogOfWar: this.isFogOfWar, mapKey: this.mapSlider.realValue,
                variantIndex: this.playersSlider.value}
    }
    get startOptions() {
        return createLobbyStartOptions(this.controls)
    }
    static mapOf(selectedMap) {
        const {coop, mapName, variantIndex} = selectedMap
        return coop ? generateCoopGame(coop.humans, {seed: coop.seed, size: coop.size}) : maps[mapName][variantIndex]
    }
    async create() {
        if (this.creating) return
        this.creating = true
        this.status.text = 'creating…'
        let ack
        try {
            const options = this.startOptions
            const board = GameManager.buildOnlineBoard(CreateLobbyTree.mapOf(options.selectedMap), options.fog)
            ack = await onlineSession.createLobby(board, options.mapName, this.asyncMovesCheckBox.mark)
        } catch (error) {
            console.error(error)
            ack = {ok: false, error: 'CLIENT_ERROR'}
        }
        this.creating = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.status.text = createLobbyErrorText(ack.error)
            return
        }
        this.menu.lobbyRoom.open(ack.lobby)
    }
    draw(ctx) {
        super.draw(ctx)
        this.status.draw(ctx)
    }
}

// The lobby room: settings, members in join order (host tagged), 'waiting...' seats,
// 'kick' next to other members and 'start' (enabled when full) for the host, 'leave'.
// Live from lobby:updated; lobby:kicked returns to the hub; lobby:started opens the game.
class LobbyRoomTree {
    static noView = {lobbyId: null, settingsText: '', countText: '', rows: [], isHost: false, kickAccountIds: [],
        start: {visible: false, enabled: false}}
    constructor(_menu) {
        this.menu = _menu
        this.lobby = null
        this.view = LobbyRoomTree.noView
        this.socket = null
        this.busy = false
        this.rowTop = HEIGHT * 0.38
        this.rowHeight = HEIGHT * 0.065
        this.title = new Text(WIDTH / 2, HEIGHT * 0.28, 0.028 * WIDTH, '', MENU_THEME.text)
        this.count = new Text(WIDTH / 2, HEIGHT * 0.33, 0.028 * WIDTH, '', MENU_THEME.mutedText)
        this.status = new Text(WIDTH / 2, HEIGHT * 0.8, 0.025 * WIDTH, '', MENU_THEME.text)
        this.rowTexts = []
        this.kickButtons = []
        this.leaveButton = Menu.getButton({x: WIDTH * 0.2, y: HEIGHT * 0.85}, 'leave', this.leaveLobby, undefined, true, this)
        this.startButton = Menu.getButton({x: WIDTH * 0.55, y: HEIGHT * 0.85}, 'start', this.startLobby, undefined, true, this)
        this.startButton.primary = true
        this.buttons = [this.leaveButton]
    }
    setParent() {}
    // Opens the room for a lobby I am a member of (lobby:create or lobby:join ack).
    open(lobby) {
        this.listen()
        this.busy = false
        this.status.text = ''
        this.setLobby(lobby)
        this.menu.setTree(this)
    }
    // Room pushes go to this account's sockets; one set of handlers per socket.
    listen() {
        const socket = onlineSession.connect()
        if (this.socket === socket) return
        this.socket = socket
        socket.on('lobby:updated', ({lobby} = {}) => { if (this.socket === socket) this.onUpdated(lobby) })
        socket.on('lobby:kicked', ({lobbyId} = {}) => { if (this.socket === socket) this.onKicked(lobbyId) })
        socket.on('lobby:started', ({lobbyId, gameID} = {}) => { if (this.socket === socket) this.onStarted(lobbyId, gameID) })
    }
    get myAccountId() {
        return onlineSession.account?.accountId ?? null
    }
    isMine(lobbyId) {
        return !!this.lobby && this.lobby.lobbyId === lobbyId
    }
    onUpdated(lobby) {
        // A kicked or departed account may still see its old room's last update.
        if (!lobby || !this.isMine(lobby.lobbyId)) return
        if (!lobby.members.some(member => member.accountId === this.myAccountId)) return
        this.setLobby(lobby)
    }
    onKicked(lobbyId) {
        if (!this.isMine(lobbyId)) return
        this.backToHub(LOBBY_REMOVED_TEXT)
    }
    // The room is done: the hub is behind the game, which opens with game:open.
    onStarted(lobbyId, gameID) {
        if (!this.isMine(lobbyId)) return
        this.backToHub(LOBBY_STARTING_TEXT)
        this.menu.onlineHub.openGame(gameID)
    }
    setLobby(lobby) {
        this.lobby = lobby
        const view = this.view = buildRoomView(lobby, this.myAccountId)
        this.title.text = view.settingsText
        this.count.text = view.countText
        const fontSize = 0.03 * WIDTH
        this.rowTexts = view.rows.map((row, i) => new Text(WIDTH * 0.3, this.rowTop + (i + 0.5) * this.rowHeight,
            fontSize, row.text, row.kind === 'waiting' ? MENU_THEME.mutedText : MENU_THEME.text, 'left'))
        this.kickButtons = []
        view.rows.forEach((row, i) => {
            if (!row.kick) return
            const rect = Menu.getButtonRect({x: WIDTH * 0.6, y: this.rowTop + (i + 0.1) * this.rowHeight})
            rect.width = WIDTH * 0.12
            rect.height = this.rowHeight * 0.8
            const text = Menu.getButtonText('kick')
            // Low rows (landscape phones) would clip the label.
            text.fontSize = Math.min(fontSize, rect.height * 0.9)
            const button = new MenuButton(rect, text, this.kick, row.accountId, true, this)
            button.accountId = row.accountId
            this.kickButtons.push(button)
        })
        // A disabled start is drawn greyed and ignores clicks.
        this.startButton.canClick = view.start.enabled
        this.buttons = [this.leaveButton, ...this.kickButtons]
        if (view.start.visible) this.buttons.push(this.startButton)
    }
    backToHub(notice = '') {
        this.lobby = null
        this.view = LobbyRoomTree.noView
        this.title.text = this.count.text = this.status.text = ''
        this.rowTexts = []
        this.kickButtons = []
        this.buttons = [this.leaveButton]
        this.menu.onlineHub.notice = notice
        this.menu.setTree(this.menu.onlineHub)
    }
    async request(send) {
        if (this.busy || !this.lobby) return null
        this.busy = true
        const ack = await send(this.lobby.lobbyId)
        this.busy = false
        return this.menu.selectedTree === this ? ack : null
    }
    async leaveLobby() {
        const ack = await this.request(lobbyId => onlineSession.leaveLobby(lobbyId))
        if (!ack) return
        if (ack.ok || ack.error === 'NOT_FOUND' || ack.error === 'NOT_A_MEMBER') this.backToHub()
        else this.status.text = 'could not leave the lobby'
    }
    async kick(accountId) {
        const ack = await this.request(lobbyId => onlineSession.kickFromLobby(lobbyId, accountId))
        if (!ack) return
        if (ack.ok) this.onUpdated(ack.lobby)
        else this.status.text = 'could not kick'
    }
    async startLobby() {
        if (!this.view.start.enabled) return
        this.status.text = LOBBY_STARTING_TEXT
        const ack = await this.request(lobbyId => onlineSession.startLobby(lobbyId))
        if (ack && !ack.ok) this.status.text = ack.error === 'NOT_FULL' ? 'waiting for players' : 'could not start'
    }
    click(pos) {
        for (const button of [...this.buttons]) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.count.draw(ctx)
        for (const text of this.rowTexts) text.draw(ctx)
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
        if (this.view.start.visible && !this.startButton.canClick) this.startButton.drawDisabled(ctx)
    }
}

// Online entry screens: Google sign-in and the signed-in hub with its games and lobbies list.
class SignInTree {
    constructor(_menu) {
        this.menu = _menu
        this.container = null
        this.title = new Text(WIDTH / 2, HEIGHT * 0.33, 0.04 * WIDTH, 'sign in to play online', MENU_THEME.text)
        this.status = new Text(WIDTH / 2, HEIGHT * 0.58, 0.025 * WIDTH, '', MENU_THEME.mutedText)
        this.buttons = []
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.buttons = [Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', _menu.setTree, parent, true, _menu)]
    }
    // Google's button and the wrapping status live only while this screen is shown.
    enter() {
        this.leave()
        const div = this.container = document.createElement('div')
        div.id = 'google-signin'
        div.style.cssText = `position:absolute;left:${WIDTH / 2 / devicePixelRatio}px;` +
            `top:${HEIGHT * 0.43 / devicePixelRatio}px;transform:translateX(-50%);z-index:1`
        // Clicks on Google's button must not reach the canvas menu below it.
        div.addEventListener('click', event => event.stopPropagation())
        document.body.append(div)
        const status = this.statusElement = document.createElement('div')
        status.style.cssText = `position:absolute;left:5%;width:90%;top:${HEIGHT * 0.55 / devicePixelRatio}px;` +
            `text-align:center;font:16px/1.4 sans-serif;color:${MENU_THEME.mutedText};overflow-wrap:anywhere;pointer-events:none`
        status.setAttribute('role', 'status')
        document.body.append(status)
        this.setStatus('loading Google sign-in…')
        loadGoogleIdentity().then(() => {
            if (this.container !== div) return
            this.setStatus('')
            try {
                renderGoogleButton(div, credential => { if (this.container === div) this.signIn(credential) })
            } catch (error) {
                this.setStatus('Sign-in failed (client): CLIENT_ERROR. Go back and reopen to retry.')
            }
        }, () => {
            if (this.container === div) this.setStatus('Sign-in failed (client-detected Google sign-in): GOOGLE_SCRIPT_LOAD_FAILED. Go back and reopen to retry.')
        })
    }
    setStatus(text) {
        this.status.text = text
        if (this.statusElement) {
            this.statusElement.textContent = text
            // The actionable recovery panel carries the same code and reload guidance.
            this.statusElement.style.visibility = text.includes('RULES_VERSION_MISMATCH') &&
                document.getElementById('online-recovery') ? 'hidden' : 'visible'
        }
    }
    leave() {
        this.attempt = (this.attempt || 0) + 1
        onlineSession.cancelSignIn()
        this.container?.remove()
        this.statusElement?.remove()
        this.container = this.statusElement = null
    }
    async signIn(credential) {
        const attempt = this.attempt = (this.attempt || 0) + 1
        this.setStatus('signing in…')
        let account
        try {
            account = await onlineSession.signInWithGoogle(credential)
        } catch (error) {
            if (attempt === this.attempt) onlineSession.lastSignInError = {source: 'client', code: 'CLIENT_ERROR'}
        }
        if (attempt !== this.attempt || this.menu.selectedTree !== this) return
        if (!account) {
            const error = onlineSession.lastSignInError || {source: 'client', code: 'CLIENT_ERROR'}
            this.setStatus(error.code === 'RULES_VERSION_MISMATCH'
                ? 'Server version mismatch (RULES_VERSION_MISMATCH). Reload the page to sign in.'
                : `Sign-in failed (${error.source}): ${error.code}. Go back and reopen to retry.`)
            return
        }
        document.getElementById('online-recovery')?.remove()
        this.setStatus('')
        this.menu.onlineHub.setAccount(account)
        this.menu.setTree(this.menu.onlineHub)
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// The scrolling list of the hub: rows from buildHubRows, drawn on the canvas.
class HubList {
    constructor(rect) {
        this.rect = rect
        this.rows = []
        this.selectedId = null
        this.scroll = new HubScrollModel(HEIGHT * 0.055, rect.height)
        this.dragY = null
    }
    setRows(rows) {
        this.rows = rows
        this.scroll.setRowCount(rows.length)
    }
    isInside(pos) {
        return pos.x >= this.rect.x && pos.x <= this.rect.x + this.rect.width &&
            pos.y >= this.rect.y && pos.y <= this.rect.y + this.rect.height
    }
    wheel(pos, deltaY) {
        if (!this.isInside(pos)) return false
        this.scroll.scrollBy(Math.sign(deltaY) * this.scroll.rowHeight)
        return true
    }
    // Touch drag of the list.
    select(pos) {
        this.dragY = this.isInside(pos) ? pos.y : null
    }
    touchmove(pos) {
        if (this.dragY === null) return
        this.scroll.scrollBy(this.dragY - pos.y)
        this.dragY = pos.y
    }
    removeSelect() {
        this.dragY = null
    }
    click(pos) {
        if (!this.isInside(pos)) return false
        const row = this.rows[this.scroll.rowAt(pos.y - this.rect.y)]
        if (row && row.id !== null) {
            this.selectedId = row.id
            this.onRow?.(row)
        }
        return true
    }
    draw(ctx) {
        const {x, y, width, height} = this.rect
        const rowHeight = this.scroll.rowHeight
        const pad = 0.01 * WIDTH
        ctx.save()
        ctx.fillStyle = '#e8e8e8'
        ctx.fillRect(x, y, width, height)
        ctx.beginPath()
        ctx.rect(x, y, width, height)
        ctx.clip()
        ctx.textBaseline = 'middle'
        const {first, last} = this.scroll.visibleRange
        for (let i = first; i <= last; ++i) {
            const row = this.rows[i]
            const top = y + i * rowHeight - this.scroll.offset
            const header = row.kind === 'header'
            if (row.kind === 'game' || row.kind === 'lobby' || row.kind === 'myLobby') {
                ctx.fillStyle = row.yourTurn ? '#ffd54f' : row.kind === 'myLobby' ? '#c8e6c9' : 'white'
                ctx.fillRect(x + pad, top + 0.1 * rowHeight, width - 2 * pad, 0.8 * rowHeight)
                ctx.strokeStyle = row.id === this.selectedId ? 'black' : '#747474'
                ctx.lineWidth = (row.id === this.selectedId ? 0.003 : 0.001) * WIDTH
                ctx.strokeRect(x + pad, top + 0.1 * rowHeight, width - 2 * pad, 0.8 * rowHeight)
            }
            // Long rows shrink to fit the list width.
            let fontSize = (header ? 0.55 : 0.45) * rowHeight
            const maxWidth = width - 4 * pad
            ctx.font = `${header ? 'bold ' : ''}${fontSize}px ${Text.defaultFamily}`
            const textWidth = ctx.measureText(row.text).width
            if (textWidth > maxWidth) {
                fontSize *= maxWidth / textWidth
                ctx.font = `${header ? 'bold ' : ''}${fontSize}px ${Text.defaultFamily}`
            }
            ctx.fillStyle = row.kind === 'empty' ? '#747474' : 'black'
            ctx.textAlign = 'left'
            ctx.fillText(row.text, x + 2 * pad, top + rowHeight / 2)
        }
        ctx.restore()
    }
}

// The signed-in hub: 'return to my lobby', your games and open lobbies from lobby:list, re-fetched on lobby:listChanged.
class OnlineHubTree {
    constructor(_menu) {
        this.menu = _menu
        this.account = null
        this.feed = null
        // A one-off message after the status line, e.g. a lobby:join error or
        // 'you were removed from the lobby'; cleared on leave.
        this.notice = ''
        this.status = new Text(WIDTH / 2, HEIGHT * 0.27, 0.025 * WIDTH, '', MENU_THEME.text)
        this.list = new HubList({x: WIDTH * 0.08, y: HEIGHT * 0.31, width: WIDTH * 0.78, height: HEIGHT * 0.47})
        this.list.onRow = row => {
            // lobby:join of my own lobby returns it, so both open the room.
            if (row.kind === 'lobby' || row.kind === 'myLobby') this.joinLobby(row.id)
            else if (row.kind === 'game') this.openGame(row.id)
        }
        this.joining = false
        const arrow = (y, text, direction) => new MenuButton(
            new Rect(WIDTH * 0.875, y, WIDTH * 0.05, HEIGHT * 0.1, [0.01 * WIDTH, 0.01 * WIDTH, 0.01 * WIDTH, 0.01 * WIDTH],
                0.0035 * WIDTH, 'white'),
            Menu.getButtonText(text), () => this.list.scroll.scrollBy(direction * this.list.scroll.pageStep))
        this.scrollUpButton = arrow(HEIGHT * 0.31, '▲', -1)
        this.scrollDownButton = arrow(HEIGHT * 0.68, '▼', 1)
        const rowY = HEIGHT * 0.83
        this.createButton = Menu.getButton({x: WIDTH * 0.1, y: rowY}, 'create game',
            _menu.setTree, _menu.createLobby, true, _menu)
        this.nicknameButton = Menu.getButton({x: WIDTH * 0.375, y: rowY}, 'change nickname',
            _menu.setTree, _menu.nickname, true, _menu)
        // The label is longer than the other menu buttons'.
        for (const text of [this.nicknameButton.text, this.nicknameButton.selectedText]) text.fontSize *= 0.75
        this.backButton = new Empty()
        this.setAccount(null)
    }
    setParent(parent, _menu) {
        this.backButton = Menu.getButton({x: WIDTH * 0.65, y: HEIGHT * 0.83}, 'back', _menu.setTree, parent, true, _menu)
        this.setAccount(this.account)
    }
    // A null account means the stored session is still being checked.
    setAccount(account) {
        this.account = account
        this.status.text = account ? 'Signed in as ' + account.nickname : 'signing in…'
        if (account && this.notice) this.status.text += ' · ' + this.notice
        this.buttons = account ? [this.list, this.scrollUpButton, this.scrollDownButton,
            this.createButton, this.nicknameButton, this.backButton] : [this.backButton]
        if (account && this.menu.selectedTree === this) this.startFeed()
    }
    startFeed() {
        this.feed ||= new HubListFeed(onlineSession, rows => this.list.setRows(rows))
        return this.feed.start()
    }
    enter() {
        this.list.setRows([])
        this.setAccount(this.account)
    }
    leave() {
        this.feed?.stop()
        this.notice = ''
    }
    // lobby:join, then the room; LOBBY_FULL, ALREADY_IN_LOBBY etc. show on the status line.
    async joinLobby(lobbyId) {
        if (this.joining) return
        this.joining = true
        const ack = await onlineSession.joinLobby(lobbyId)
        this.joining = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.notice = lobbyJoinErrorText(ack.error)
            this.setAccount(this.account)
            return
        }
        this.menu.lobbyRoom.open(ack.lobby)
    }
    // game:open; the first board enters the game (options/onlineLogic.js).
    openGame(gameID) {
        if (this.menu.selectedTree !== this || onlineSession.openGameID !== null) return
        openLobbyGame(gameID)
    }
    // Row texts in list order, for tests and diagnostics.
    get rowTexts() {
        return this.list.rows.map(row => row.text)
    }
    wheel(pos, deltaY) {
        if (this.account) this.list.wheel(pos, deltaY)
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// 'change nickname': a canvas text input prefilled with the current nickname.
class NicknameTree {
    constructor(_menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.menu = _menu
        this.saving = false
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, 0.04 * WIDTH, 'change nickname', MENU_THEME.text)
        // Wider than a button so 16 characters fit.
        const inputRect = Menu.getButtonRect({x: WIDTH * 0.3, y: HEIGHT * 0.36})
        inputRect.width = WIDTH * 0.4
        this.input = new MenuTextInput(inputRect, 0.04 * WIDTH,
            {maxLength: 16, onSubmit: () => this.save(), onCancel: () => this.back()})
        this.status = new Text(WIDTH / 2, HEIGHT * 0.51, 0.025 * WIDTH, '', MENU_THEME.mutedText)
        this.buttons = [
            Menu.getButton({x: pos0X, y: HEIGHT * 0.56}, 'save', this.save, undefined, true, this),
            Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', this.back, undefined, true, this),
        ]
    }
    enter() {
        this.saving = false
        this.status.text = ''
        this.input.setValue(onlineSession.account?.nickname || '')
        this.input.focus()
    }
    leave() {
        this.input.blur()
    }
    back() {
        this.menu.setTree(this.menu.onlineHub)
    }
    async save() {
        if (this.saving) return
        this.saving = true
        this.status.text = 'saving…'
        const ack = await onlineSession.setNickname(this.input.value)
        this.saving = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.status.text = nicknameErrorText(ack.error)
            return
        }
        this.menu.onlineHub.setAccount(ack.account)
        this.back()
    }
    click(pos) {
        this.input.click(pos)
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.input.draw(ctx)
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// 'tutorial': every entry of options/tutorials.js, all playable; a check mark next to the
// passed ones (readTutorialPassed, re-read on every enter). The entries fill columns of
// ROWS buttons below the logo (16 tutorials = 3 columns); all titles share the font size
// that fits the longest one.
class TutorialTree {
    FIRST_Y = 0.26 * HEIGHT
    INTERVAL_Y = 0.1 * HEIGHT
    ROWS = 6
    COLUMN_STEP = 0.325 * WIDTH
    BUTTON_WIDTH = 0.22 * WIDTH
    BUTTON_HEIGHT = 0.08 * HEIGHT
    constructor(_menu) {
        this.menu = _menu
        this.backButton = new Empty()
        this.entries = []
        this.passed = []
        this.buttons = [this.backButton]
    }
    get columns() {
        return Math.max(1, Math.ceil(tutorials.length / this.ROWS))
    }
    // Top-left of entry `index`; the columns (button + check mark) are centred as a block.
    entryPos(index) {
        const blockWidth = (this.columns - 1) * this.COLUMN_STEP + this.BUTTON_WIDTH +
            menuOptions.marginLeft + menuOptions.rectSize
        return {x: (WIDTH - blockWidth) / 2 + Math.floor(index / this.ROWS) * this.COLUMN_STEP,
            y: this.FIRST_Y + (index % this.ROWS) * this.INTERVAL_Y}
    }
    // The menu is built before mainCtx exists: measure with an own context in Text's font.
    fontSizeFor(titles) {
        const fontSize = Menu.getButtonText('').fontSize, maxWidth = this.BUTTON_WIDTH * 0.9
        const measure = document.createElement('canvas').getContext('2d')
        measure.font = fontSize + 'px Times New Roman'
        const width = Math.max(...titles.map(title => measure.measureText(title).width))
        return width > maxWidth ? Math.floor(fontSize * maxWidth / width) : fontSize
    }
    getButton(pos, title, fontSize, clickFunc, parameters, callThis) {
        const rect = Menu.getButtonRect(pos)
        rect.width = this.BUTTON_WIDTH
        rect.height = this.BUTTON_HEIGHT
        const text = Menu.getButtonText(title)
        text.fontSize = fontSize
        return new MenuButton(rect, text, clickFunc, parameters, true, callThis)
    }
    setParent(parent, _menu) {
        const pos = {x: WIDTH / 2 - this.BUTTON_WIDTH / 2, y: this.FIRST_Y + Math.min(tutorials.length, this.ROWS) * this.INTERVAL_Y}
        this.backButton = this.getButton(pos, 'back', this.fontSizeFor(['back']), _menu.setTree, parent, _menu)
        this.update()
    }
    enter() {
        this.update()
    }
    update() {
        this.passed = readTutorialPassed()
        const size = menuOptions.rectSize
        const fontSize = this.fontSizeFor(tutorials.map(tutorial => tutorial.title))
        this.entries = tutorials.map((tutorial, index) => {
            const button = this.getButton(this.entryPos(index), tutorial.title, fontSize, TutorialManager.start,
                tutorial.id, TutorialManager)
            const checkMark = this.passed.includes(tutorial.id) ? new JustImage('checkMark',
                {x: button.rect.x + button.rect.width + menuOptions.marginLeft + size / 2, y: button.rect.centerY},
                size, size) : null
            return {id: tutorial.id, button, checkMark}
        })
        this.buttons = [...this.entries.map(entry => entry.button), this.backButton]
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        for (const button of this.buttons) button.draw(ctx)
        for (const entry of this.entries) {
            const mark = entry.checkMark
            if (mark && Text.menuTheme) CheckBox.drawMark(ctx, mark.pos, mark.width, Text.menuTheme.text)
            else mark?.draw(ctx)
        }
    }
}

// Hot seat entry: start a new game or load a saved one. 'load game' is greyed out
// and ignores clicks while every save slot is empty.
class HotseatChoiceTree extends Tree {
    constructor(_menu, pos, slotsCount) {
        const newGame = Menu.getButton(pos, 'new game', _menu.setTree, _menu.play, true, _menu)
        newGame.primary = true
        const loadGame = Menu.getButton(pos, 'load game', _menu.setTree, _menu.load, true, _menu)
        super([newGame, loadGame], _menu)
        this.loadButton = loadGame
        this.slotsCount = slotsCount
    }
    hasSave() {
        for (let i = 0; i < this.slotsCount; ++i)
            if (loadSlotInfo(i).whooseTurn != -1) return true
        return false
    }
    enter() {
        this.loadButton.canClick = this.hasSave()
    }
    draw(ctx) {
        super.draw(ctx)
        if (!this.loadButton.canClick) this.loadButton.drawDisabled(ctx)
    }
}
// The menu look on every menu screen, whatever the visuals settings: a night sky, the logo with a light halo and a
// gold beta tag. Sizes and positions are fractions of WIDTH and HEIGHT.
class MenuSky {
    canvas = null
    width = 0
    height = 0
    // How many times the sky was painted: once per viewport size, not per frame.
    rasterizations = 0
    // Covers every pixel with opaque colour, so the menu needs no clearRect.
    draw(ctx) {
        if (this.width !== WIDTH || this.height !== HEIGHT) this.rasterize()
        if (this.canvas) ctx.drawImage(this.canvas, 0, 0)
        else {
            ctx.fillStyle = '#18264a'
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
        }
    }
    rasterize() {
        this.width = WIDTH
        this.height = HEIGHT
        ++this.rasterizations
        const canvas = document.createElement('canvas')
        canvas.width = WIDTH
        canvas.height = HEIGHT
        try {
            this.paint(canvas.getContext('2d', {alpha: false}))
            this.canvas = canvas
        } catch (error) {
            // Stub canvases of headless runtimes: the flat sky colour.
            this.canvas = null
        }
    }
    paint(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
        sky.addColorStop(0, '#0f1a33')
        sky.addColorStop(0.55, '#18264a')
        sky.addColorStop(1, '#22223e')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        // Warm orange nebula at the top left, faint violet at the top right.
        this.glow(ctx, WIDTH * 0.12, HEIGHT * 0.08, Math.max(WIDTH, HEIGHT) * 0.38, '214, 128, 64', 0.42)
        this.glow(ctx, WIDTH * 0.9, HEIGHT * 0.12, Math.max(WIDTH, HEIGHT) * 0.3, '128, 96, 200', 0.2)
        // Sparse small stars from a fixed seed, so every frame and every run has the same sky.
        let seed = 1190
        const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
        const radius = Math.min(WIDTH, HEIGHT) * 0.0018
        for (let i = 0; i < 70; ++i) {
            const x = random() * WIDTH, y = random() * HEIGHT, size = radius * (0.6 + random() * 0.9)
            ctx.fillStyle = `rgba(235, 232, 255, ${(0.25 + random() * 0.5).toFixed(2)})`
            ctx.beginPath()
            ctx.arc(x, y, size, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    glow(ctx, x, y, radius, rgb, alpha) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
        glow.addColorStop(0, `rgba(${rgb}, ${alpha})`)
        glow.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.4})`)
        glow.addColorStop(1, `rgba(${rgb}, 0)`)
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }
}

// The logo with a thin light halo, so its dark bow-shaped "c" stays readable on the sky. Halo and logo are painted
// once per logo size, after the logo image has loaded; each frame copies that raster.
class HaloLogo {
    halo = null
    haloKey = ''
    constructor(image, pos, w, h) {
        this.image = image
        this.pos = pos
        this.w = w
        this.h = h
    }
    get margin() {
        return this.h * 0.12
    }
    get bounds() {
        const margin = this.margin
        return {x: this.pos.x - this.w / 2 - margin, y: this.pos.y - this.h / 2 - margin,
            width: this.w + margin * 2, height: this.h + margin * 2}
    }
    draw(ctx) {
        const image = assets[this.image]
        const key = `${this.w}x${this.h}`
        if (this.haloKey !== key && image?.complete && image.naturalWidth) {
            this.haloKey = key
            this.halo = this.paintHalo(image)
        }
        // Unscaled at whole pixels: a plain copy each frame.
        if (this.halo) {
            const bounds = this.bounds
            ctx.drawImage(this.halo, Math.round(bounds.x), Math.round(bounds.y))
        } else drawImage(ctx, this.image, this.pos, this.w, this.h)
    }
    paintHalo(image) {
        try {
            const margin = this.margin, width = Math.ceil(this.w + margin * 2), height = Math.ceil(this.h + margin * 2)
            // The logo's shape in the halo colour.
            const shape = document.createElement('canvas')
            shape.width = width
            shape.height = height
            const shapeCtx = shape.getContext('2d')
            shapeCtx.drawImage(image, margin, margin, this.w, this.h)
            shapeCtx.globalCompositeOperation = 'source-in'
            shapeCtx.fillStyle = '#f3ead8'
            shapeCtx.fillRect(0, 0, width, height)
            const halo = document.createElement('canvas')
            halo.width = width
            halo.height = height
            const ctx = halo.getContext('2d')
            // A soft glow, then a thin ring: the shape stamped around a small circle.
            ctx.shadowColor = 'rgba(243, 234, 216, 0.55)'
            ctx.shadowBlur = this.h * 0.1
            ctx.drawImage(shape, 0, 0)
            ctx.shadowColor = 'transparent'
            ctx.shadowBlur = 0
            const ring = this.h * 0.022
            for (let i = 0; i < 16; ++i) {
                const angle = Math.PI * 2 * i / 16
                ctx.drawImage(shape, Math.cos(angle) * ring, Math.sin(angle) * ring)
            }
            ctx.drawImage(image, margin, margin, this.w, this.h)
            return halo
        } catch (error) {
            // Stub canvases of headless runtimes: the logo without a halo.
            return null
        }
    }
}

// A small gold "beta" tag at the top right, clear of the logo.
class BetaTag {
    constructor() {
        this.text = new Text(WIDTH * 0.935, HEIGHT * 0.065, Math.min(WIDTH * 0.012, HEIGHT * 0.026), 'beta', '#3a2410',
            'center', 'middle', 1, MENU_TITLE_FONT_FAMILY, 800)
        this.angle = 0.05
    }
    // The tag's size around its centre, before the rotation (measured in its font once the font has loaded).
    get size() {
        const fontSize = this.text.fontSize
        this.measure ??= document.createElement('canvas').getContext('2d')
        this.measure.font = this.text.font()
        return {width: this.measure.measureText(this.text.text).width + fontSize * 1.3, height: fontSize * 1.6}
    }
    // Axis-aligned box of the rotated tag.
    get bounds() {
        const {width, height} = this.size
        const cos = Math.abs(Math.cos(this.angle)), sin = Math.abs(Math.sin(this.angle))
        const boxWidth = width * cos + height * sin, boxHeight = width * sin + height * cos
        return {x: this.text.x - boxWidth / 2, y: this.text.y - boxHeight / 2, width: boxWidth, height: boxHeight}
    }
    draw(ctx) {
        const {width, height} = this.size
        ctx.save()
        ctx.translate(this.text.x, this.text.y)
        ctx.rotate(this.angle)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = height * 0.3
        ctx.shadowOffsetY = height * 0.08
        ctx.fillStyle = '#f2b45a'
        const left = -width / 2, top = -height / 2, radius = height * 0.2
        ctx.beginPath()
        ctx.moveTo(left + radius, top)
        ctx.arcTo(-left, top, -left, -top, radius)
        ctx.arcTo(-left, -top, left, -top, radius)
        ctx.arcTo(left, -top, left, top, radius)
        ctx.arcTo(left, top, -left, top, radius)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.translate(this.text.x, this.text.y)
        ctx.rotate(this.angle)
        const {x, y} = this.text.pos
        this.text.pos = {x: 0, y: height * 0.04}
        this.text.draw(ctx)
        this.text.pos = {x, y}
        ctx.restore()
    }
}

// The main screen's faction banners (TASK-1191): a gold rod across the upper middle, three cloth banners hanging from
// it and round icon buttons below them. Every size is a fraction of the banner width, which Menu.layoutMain derives
// from WIDTH and HEIGHT; the layout scales by the smaller of the width and height budgets.
function menuTime() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
// Ray casting: whether point lies inside the polygon [{x, y}, ...].
function pointInPolygon(point, polygon) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j]
        if ((a.y > point.y) !== (b.y > point.y) &&
            point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
}
function tracePolygon(ctx, polygon) {
    ctx.beginPath()
    ctx.moveTo(polygon[0].x, polygon[0].y)
    for (let i = 1; i < polygon.length; ++i) ctx.lineTo(polygon[i].x, polygon[i].y)
    ctx.closePath()
}
function shadeColor(hex, amount) {
    const value = parseInt(hex.slice(1), 16)
    const channel = shift => {
        const c = (value >> shift) & 255
        return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
    }
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}
function roundedRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
}
// Draws text in one line if it fits maxWidth, else in two lines; returns the
// box of what it drew.
function drawFittedLines(ctx, text, x, y, fontSize, maxWidth, lineHeight) {
    let lines = [text]
    if (ctx.measureText(text).width > maxWidth && text.includes(' ')) {
        // After a comma if there is one, else at the space nearest the middle.
        const spaces = [...text.matchAll(/ /g)].map(match => match.index)
        const middle = text.includes(', ') ? text.indexOf(', ') + 1 :
            spaces.reduce((best, index) => Math.abs(index - text.length / 2) < Math.abs(best - text.length / 2) ? index : best)
        lines = [text.slice(0, middle), text.slice(middle + 1)]
    }
    let width = 0
    lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * fontSize * lineHeight)
        width = Math.max(width, ctx.measureText(line).width)
    })
    return {x: x - width / 2, y: y - fontSize * 0.5, width, height: fontSize * (1 + (lines.length - 1) * lineHeight), lines}
}

class MenuBannerRod {
    constructor() {
        this.left = this.right = this.y = this.thickness = this.knob = 0
    }
    get bounds() {
        return {x: this.left - this.knob, y: this.y - this.knob, width: this.right - this.left + this.knob * 2, height: this.knob * 2}
    }
    draw(ctx) {
        const bar = ctx.createLinearGradient(0, this.y - this.thickness / 2, 0, this.y + this.thickness / 2)
        bar.addColorStop(0, '#f6dc98')
        bar.addColorStop(0.5, '#c99a4a')
        bar.addColorStop(1, '#8a6227')
        ctx.fillStyle = bar
        roundedRectPath(ctx, this.left, this.y - this.thickness / 2, this.right - this.left, this.thickness, this.thickness / 2)
        ctx.fill()
        for (const x of [this.left, this.right]) {
            const knob = ctx.createRadialGradient(x - this.knob * 0.35, this.y - this.knob * 0.35, this.knob * 0.1, x, this.y, this.knob)
            knob.addColorStop(0, '#fbe7b0')
            knob.addColorStop(0.6, '#d3a656')
            knob.addColorStop(1, '#8a6227')
            ctx.fillStyle = knob
            ctx.beginPath()
            ctx.arc(x, this.y, this.knob, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Banner emblems, painted inside the disc (already clipped to it). Geometry is in fractions of the disc radius r.
// A plain assets key (e.g. 'noob') draws that sprite.
const MENU_EMBLEMS = {
    // Hot seat: two swordsmen face each other, swords crossing, on a red/blue background split at about 120 deg.
    faceoff: {
        assets: ['normchel'],
        paint(ctx, disc) {
            const {x, y, r} = disc
            ctx.fillStyle = '#e8aaa2'
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
            const dx = Math.cos(Math.PI * 2 / 3) * r * 2, dy = Math.sin(Math.PI * 2 / 3) * r * 2
            ctx.fillStyle = '#a9c4e4'
            ctx.beginPath()
            ctx.moveTo(x - dx, y - dy)
            ctx.lineTo(x + dx, y + dy)
            ctx.lineTo(x + r * 2, y + r * 2)
            ctx.lineTo(x + r * 2, y - r * 2)
            ctx.closePath()
            ctx.fill()
            // The sprite holds its sword at 0.24 of its width; the hilts stand just apart so the blades cross above them.
            const size = r * 1.3, centre = r * 0.055 + size * 0.26, centreY = y + r * 0.9 - size * 0.44
            for (const side of [-1, 1]) {
                ctx.save()
                ctx.translate(x + side * centre, centreY)
                ctx.scale(side, 1)
                drawImage(ctx, 'normchel', {x: 0, y: 0}, size, size)
                ctx.restore()
            }
        },
    },
    // Play online: a red and a green town cell, each with a glow in its player colour, linked by a dashed arc that
    // leaves from behind one roof and enters behind the other.
    towns: {
        assets: ['menu/towncell-red', 'menu/towncell-green'],
        layout(disc) {
            const {x, y, r} = disc
            const width = r * 0.86, height = width * 249 / 287, cy = y + r * 0.2
            const cells = [
                {image: 'menu/towncell-red', glow: 'rgba(255, 0, 0, 0.8)', x: x - r * 0.465, y: cy, width, height},
                {image: 'menu/towncell-green', glow: 'rgba(0, 179, 0, 0.8)', x: x + r * 0.465, y: cy, width, height}]
            // The arc's ends lie on the roofs to the inner side of the towers; its top is above the cells.
            const endX = r * 0.465 - width * 0.2, endY = cy - height * 0.28, topY = cy - height / 2 - r * 0.2
            const sag = endY - topY, radius = (endX * endX + sag * sag) / (2 * sag)
            const half = Math.asin(endX / radius)
            return {cells, arc: {x, y: topY + radius, radius, from: -Math.PI / 2 - half, to: -Math.PI / 2 + half,
                width: r * 0.07, dash: [r * 0.12, r * 0.1]}}
        },
        paint(ctx, disc, {arc = true} = {}) {
            const layout = this.layout(disc)
            if (arc) {
                const a = layout.arc
                ctx.save()
                ctx.strokeStyle = '#b07a2c'
                ctx.lineWidth = a.width
                ctx.lineCap = 'round'
                ctx.setLineDash(a.dash)
                ctx.beginPath()
                ctx.arc(a.x, a.y, a.radius, a.from, a.to)
                ctx.stroke()
                ctx.restore()
            }
            for (const cell of layout.cells) {
                ctx.save()
                ctx.shadowColor = cell.glow
                ctx.shadowBlur = disc.r * 0.2
                drawImage(ctx, cell.image, cell, cell.width, cell.height)
                ctx.restore()
            }
        },
    },
}
function menuEmblem(name) {
    return MENU_EMBLEMS[name] ?? {assets: [name], paint(ctx, disc) {
        const size = disc.r * 1.75
        drawImage(ctx, name, {x: disc.x, y: disc.y + disc.r * 0.08}, size, size)
    }}
}

// One cloth banner. text.text is the menu entry's label (the tests find entries by it); name is what it shows.
// The click target is the swallowtail polygon, rect only its bounding box.
class MenuBanner extends Button {
    constructor(label, name, description, color, clickFunc, parameters, callThis, {featured = false, emblem = null} = {}) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, label), clickFunc, parameters, true, callThis)
        this.name = name
        this.description = description
        this.baseColor = color
        this.featured = featured
        this.emblem = emblem
        this.emblemOptions = {}
        this.hovered = false
        this.pressed = false
        this.activeSince = 0
        this.raster = null
        this.rasterKey = ''
        this.glow = null
        this.boxes = {}
    }
    // Places the banner: top-left x, top y, width w, height h (to the swallowtail points).
    place(x, y, w, h) {
        this.rect = new Rect(x, y, w, h)
        this.text.pos = this.rect.center
        this.notch = w * 0.26
        this.rasterKey = ''
    }
    get polygon() {
        const {x, y, width: w, height: h} = this.rect
        return [{x, y}, {x: x + w, y}, {x: x + w, y: y + h}, {x: x + w / 2, y: y + h - this.notch}, {x, y: y + h}]
    }
    isInside(point) {
        return pointInPolygon(point, this.polygon)
    }
    get active() {
        return this.hovered || this.pressed
    }
    setActive(hovered, pressed) {
        const was = this.active
        this.hovered = hovered
        this.pressed = pressed
        if (!was && this.active) this.activeSince = menuTime()
    }
    hover(pos) {
        this.setActive(this.isInside(pos), this.pressed)
    }
    select(pos) {
        this.setActive(this.hovered, this.isInside(pos))
    }
    removeSelect() {
        this.setActive(this.hovered, false)
    }
    clearActive() {
        this.setActive(false, false)
    }
    // A short damped swing about the rod after the pointer arrives.
    get angle() {
        if (!this.active) return 0
        const t = (menuTime() - this.activeSince) / 1000
        return 0.035 * Math.sin(t * Math.PI * 2 / 0.9) * Math.exp(-t / 0.7)
    }
    get margin() {
        return this.rect.width * 0.25
    }
    draw(ctx) {
        const {x, y, width: w} = this.rect
        const key = `${x},${y},${w},${this.emblemKey()}`
        if (this.rasterKey !== key) {
            this.rasterKey = key
            this.raster = this.rasterize()
        }
        ctx.save()
        const pivotX = x + w / 2
        ctx.translate(pivotX, y)
        ctx.rotate(this.angle)
        ctx.translate(-pivotX, -y)
        if (this.featured && this.glow) {
            // A slow soft gold pulse behind the Tutorial banner.
            ctx.globalAlpha = 0.55 + 0.45 * Math.sin(menuTime() / 1000 * Math.PI * 2 / 2.8)
            ctx.drawImage(this.glow, x - this.margin, y - this.margin)
            ctx.globalAlpha = 1
        }
        if (this.raster) ctx.drawImage(this.raster, x - this.margin, y - this.margin)
        else this.paint(ctx)
        if (this.active) {
            ctx.fillStyle = 'rgba(255, 246, 225, 0.12)'
            tracePolygon(ctx, this.polygon)
            ctx.fill()
        }
        ctx.restore()
    }
    emblemReady() {
        return !this.emblem || menuEmblem(this.emblem).assets.every(key => assets[key]?.complete && assets[key].naturalWidth)
    }
    // Changes when an emblem image loads or is reloaded from another sprite folder (usePolishedSprites).
    emblemKey() {
        return this.emblem ? `${this.emblemReady()},${menuEmblem(this.emblem).assets.map(key => assets[key]?.src).join(',')}` : ''
    }
    canvasFor(paint) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(this.rect.width + this.margin * 2)
        canvas.height = Math.ceil(this.rect.height + this.margin * 2)
        const ctx = canvas.getContext('2d')
        ctx.translate(this.margin - this.rect.x, this.margin - this.rect.y)
        paint(ctx)
        return canvas
    }
    rasterize() {
        try {
            if (this.featured) this.glow = this.canvasFor(ctx => {
                ctx.shadowColor = 'rgba(246, 196, 96, 0.9)'
                ctx.shadowBlur = this.rect.width * 0.16
                ctx.fillStyle = 'rgba(246, 196, 96, 0.6)'
                tracePolygon(ctx, this.polygon)
                ctx.fill()
            })
            return this.canvasFor(ctx => this.paint(ctx))
        } catch (error) {
            // Stub canvases of headless runtimes draw the banner directly.
            this.glow = null
            return null
        }
    }
    paint(ctx) {
        const {x, y, width: w, height: h} = this.rect
        const color = this.baseColor, polygon = this.polygon
        // Cloth with vertical folds and a drop shadow.
        ctx.save()
        ctx.shadowColor = 'rgba(4, 8, 24, 0.55)'
        ctx.shadowBlur = w * 0.09
        ctx.shadowOffsetY = w * 0.035
        const cloth = ctx.createLinearGradient(x, 0, x + w, 0)
        cloth.addColorStop(0, shadeColor(color, -0.22))
        cloth.addColorStop(0.16, color)
        cloth.addColorStop(0.32, shadeColor(color, 0.12))
        cloth.addColorStop(0.5, shadeColor(color, -0.08))
        cloth.addColorStop(0.7, shadeColor(color, 0.1))
        cloth.addColorStop(0.86, color)
        cloth.addColorStop(1, shadeColor(color, -0.25))
        ctx.fillStyle = cloth
        tracePolygon(ctx, polygon)
        ctx.fill()
        ctx.restore()
        // The cloth folded over the rod.
        const fold = ctx.createLinearGradient(0, y, 0, y + w * 0.06)
        fold.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
        fold.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = fold
        ctx.fillRect(x, y, w, w * 0.06)
        this.paintTrim(ctx)
        this.paintEmblem(ctx)
        this.paintTexts(ctx)
    }
    // A dashed light stitch inset along the sides and the swallowtail; the featured banner has a solid gold trim.
    paintTrim(ctx) {
        const {x, y, width: w, height: h} = this.rect
        const inset = w * 0.045, slope = this.notch / (w / 2), lift = inset * Math.sqrt(1 + slope * slope)
        const top = y + w * 0.05
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(x + inset, top)
        ctx.lineTo(x + inset, y + h - slope * inset - lift)
        ctx.lineTo(x + w / 2, y + h - this.notch - lift)
        ctx.lineTo(x + w - inset, y + h - slope * inset - lift)
        ctx.lineTo(x + w - inset, top)
        if (this.featured) {
            ctx.strokeStyle = '#e2b860'
            ctx.lineWidth = w * 0.012
        } else {
            ctx.strokeStyle = 'rgba(255, 244, 224, 0.7)'
            ctx.lineWidth = w * 0.006
            ctx.setLineDash([w * 0.025, w * 0.02])
        }
        ctx.stroke()
        ctx.restore()
    }
    get disc() {
        const {x, y, width: w} = this.rect
        return {x: x + w / 2, y: y + w * (this.featured ? 0.6 : 0.52), r: w * 0.33}
    }
    paintEmblem(ctx) {
        const disc = this.disc
        ctx.save()
        ctx.fillStyle = shadeColor(this.baseColor, -0.3)
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r * 1.07, 0, Math.PI * 2)
        ctx.fill()
        const ring = ctx.createLinearGradient(0, disc.y - disc.r, 0, disc.y + disc.r)
        ring.addColorStop(0, '#f2d38c')
        ring.addColorStop(1, '#b8873c')
        ctx.fillStyle = ring
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2)
        ctx.fill()
        const cream = ctx.createRadialGradient(disc.x, disc.y - disc.r * 0.3, disc.r * 0.1, disc.x, disc.y, disc.r * 0.92)
        cream.addColorStop(0, '#f6eedb')
        cream.addColorStop(1, '#dccbaa')
        ctx.fillStyle = cream
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r * 0.92, 0, Math.PI * 2)
        ctx.fill()
        if (this.emblem && this.emblemReady()) {
            ctx.clip()
            menuEmblem(this.emblem).paint(ctx, disc, this.emblemOptions)
        }
        ctx.restore()
        this.boxes.disc = {x: disc.x - disc.r * 1.07, y: disc.y - disc.r * 1.07, width: disc.r * 2.14, height: disc.r * 2.14}
    }
    paintTexts(ctx) {
        const {x, y, width: w} = this.rect
        const inner = w * 0.82, cx = x + w / 2, disc = this.disc
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
        ctx.shadowBlur = w * 0.02
        ctx.shadowOffsetY = w * 0.008
        // The name shrinks to fit the banner.
        let nameSize = w * (this.featured ? 0.13 : 0.12)
        ctx.font = `800 ${nameSize}px ${MENU_TITLE_FONT_FAMILY}`
        const nameWidth = ctx.measureText(this.name).width
        if (nameWidth > inner) {
            nameSize *= inner / nameWidth
            ctx.font = `800 ${nameSize}px ${MENU_TITLE_FONT_FAMILY}`
        }
        const nameY = disc.y + disc.r * 1.07 + w * 0.16
        ctx.fillStyle = '#fff4e0'
        ctx.fillText(this.name, cx, nameY)
        const drawnName = Math.min(nameWidth, inner)
        this.boxes.name = {x: cx - drawnName / 2, y: nameY - nameSize / 2, width: drawnName, height: nameSize}
        const descriptionSize = w * 0.08
        ctx.font = `500 ${descriptionSize}px ${MENU_FONT_FAMILY}`
        if ('wordSpacing' in ctx) ctx.wordSpacing = `${descriptionSize * 0.12}px`
        ctx.fillStyle = 'rgba(255, 244, 224, 0.88)'
        const description = drawFittedLines(ctx, this.description, cx, nameY + nameSize * 0.6 + w * 0.08,
            descriptionSize, inner, 1.3)
        this.boxes.description = {x: description.x, y: description.y, width: description.width, height: description.height}
        this.descriptionLines = description.lines
        ctx.restore()
        if (this.featured) this.paintTag(ctx)
    }
    // The gold "Start here" tag at the top of the featured banner.
    paintTag(ctx) {
        const {x, y, width: w} = this.rect
        const size = w * 0.055
        ctx.save()
        ctx.font = `700 ${size}px ${MENU_TITLE_FONT_FAMILY}`
        const width = ctx.measureText('Start here').width + size * 1.6, height = size * 1.75
        const left = x + w / 2 - width / 2, top = y + w * 0.06
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = size * 0.5
        ctx.shadowOffsetY = size * 0.12
        const gold = ctx.createLinearGradient(0, top, 0, top + height)
        gold.addColorStop(0, '#f8d58a')
        gold.addColorStop(1, '#e0a84e')
        ctx.fillStyle = gold
        roundedRectPath(ctx, left, top, width, height, height * 0.22)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = '#3a2410'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Start here', x + w / 2, top + height * 0.53)
        ctx.restore()
        this.boxes.tag = {x: left, y: top, width, height}
    }
}

// A round dark-blue button with a gold ring, an icon and a caption to its right (Settings, Replays).
class MenuIconButton extends Button {
    constructor(label, caption, icon, clickFunc, parameters, callThis) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, label), clickFunc, parameters, true, callThis)
        this.caption = caption
        this.icon = icon
        this.hovered = false
        this.pressed = false
        this.center = {x: 0, y: 0}
        this.radius = 0
    }
    get captionSize() {
        return this.radius * 0.72
    }
    // The caption's width, measured in the menu font.
    captionWidth() {
        try {
            this.measure ??= document.createElement('canvas').getContext('2d')
            this.measure.font = `500 ${this.captionSize}px ${MENU_FONT_FAMILY}`
            const width = this.measure.measureText(this.caption).width
            if (Number.isFinite(width) && width > 0) return width
        } catch (error) {}
        return this.captionSize * this.caption.length * 0.5
    }
    get groupWidth() {
        return this.radius * 2.35 + this.captionWidth()
    }
    // Places the group (circle and caption) with its left edge at left and the circle centred on centerY.
    place(left, centerY, radius) {
        this.radius = radius
        this.center = {x: left + radius, y: centerY}
        this.rect = new Rect(left, centerY - radius, this.groupWidth, radius * 2)
        this.text.pos = this.rect.center
    }
    get circleBounds() {
        return {x: this.center.x - this.radius, y: this.center.y - this.radius, width: this.radius * 2, height: this.radius * 2}
    }
    hover(pos) {
        this.hovered = this.isInside(pos)
    }
    select(pos) {
        this.pressed = this.isInside(pos)
    }
    removeSelect() {
        this.pressed = false
    }
    clearActive() {
        this.hovered = this.pressed = false
    }
    draw(ctx) {
        const {x, y} = this.center, active = this.hovered || this.pressed
        const r = this.radius * (this.pressed ? 0.94 : 1)
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
        ctx.shadowBlur = r * 0.35
        ctx.shadowOffsetY = r * 0.08
        ctx.fillStyle = active ? '#2b3d72' : '#1d2a55'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.strokeStyle = active ? '#f2cf7e' : '#d6a855'
        ctx.lineWidth = r * 0.09
        ctx.beginPath()
        ctx.arc(x, y, r * 0.93, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = ctx.fillStyle = active ? '#fbe6b4' : '#f0d9a6'
        ctx.lineWidth = r * 0.07
        if (this.icon === 'gear') this.drawGear(ctx, x, y, r * 0.4)
        else this.drawPlay(ctx, x, y, r * 0.38)
        ctx.font = `500 ${this.captionSize}px ${MENU_FONT_FAMILY}`
        ctx.fillStyle = active ? '#ffffff' : '#e8e2d4'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.caption, this.center.x + this.radius * 1.35, y)
        ctx.restore()
    }
    drawGear(ctx, x, y, r) {
        ctx.beginPath()
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
        ctx.stroke()
        for (let i = 0; i < 8; ++i) {
            const angle = Math.PI * 2 * i / 8, cos = Math.cos(angle), sin = Math.sin(angle)
            ctx.beginPath()
            ctx.moveTo(x + cos * r * 0.68, y + sin * r * 0.68)
            ctx.lineTo(x + cos * r, y + sin * r)
            ctx.stroke()
        }
    }
    drawPlay(ctx, x, y, r) {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.55, y - r * 0.8)
        ctx.lineTo(x + r * 0.85, y)
        ctx.lineTo(x - r * 0.55, y + r * 0.8)
        ctx.closePath()
        ctx.fill()
    }
}

// The main screen: the rod, the banners hanging from it and the icon buttons.
class MainTree extends Tree {
    constructor(buttons, _menu) {
        super(buttons, _menu)
        this.rod = new MenuBannerRod()
    }
    hover(pos) {
        for (const button of this.buttons) button.hover?.(pos)
    }
    leave() {
        for (const button of this.buttons) button.clearActive?.()
    }
    draw(ctx) {
        this.rod.draw(ctx)
        super.draw(ctx)
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
    // 'replays' is listed only with otherSettings.showReplays.
    updateMainButtons() {
        this.main.buttons = this.mainButtons.filter(button =>
            button.text.text !== 'replays' || otherSettings.showReplays)
        this.layoutMain()
    }
    // Banner sizes in banner widths: side banners 1 x 1.94, Tutorial 1.16 x 2.18, gaps 0.2, the rod 0.24 past the
    // outer banners. The banner width is the smaller of what the screen width and the height between the logo and
    // the icon buttons allow.
    layoutMain() {
        const [hotseat, online, settings, tutorial, replays] = this.mainButtons
        const iconRadius = Math.min(HEIGHT * 0.045, WIDTH * 0.03)
        const iconY = HEIGHT * 0.965 - iconRadius
        const logo = this.logo.bounds
        const rodY = logo.y + logo.height + HEIGHT * 0.035
        const bottom = iconY - iconRadius - HEIGHT * 0.035
        const SIDE_HEIGHT = 1.94, TUTORIAL_WIDTH = 1.16, TUTORIAL_HEIGHT = 2.18, GAP = 0.2, OVERHANG = 0.24, KNOB = 0.05
        const rowWidth = 2 + TUTORIAL_WIDTH + GAP * 2
        const w = Math.min(WIDTH * 0.92 / (rowWidth + (OVERHANG + KNOB) * 2), (bottom - rodY) / TUTORIAL_HEIGHT)
        const rod = this.main.rod
        rod.thickness = w * 0.035
        rod.knob = w * KNOB
        rod.y = rodY
        const top = rodY - rod.thickness / 2
        let x = WIDTH / 2 - rowWidth * w / 2
        rod.left = x - OVERHANG * w
        hotseat.place(x, top, w, w * SIDE_HEIGHT)
        x += w * (1 + GAP)
        tutorial.place(x, top, w * TUTORIAL_WIDTH, w * TUTORIAL_HEIGHT)
        x += w * (TUTORIAL_WIDTH + GAP)
        online.place(x, top, w, w * SIDE_HEIGHT)
        rod.right = x + w + OVERHANG * w
        // Settings, and Replays next to it when listed, centred under the banners.
        const icons = this.main.buttons.includes(replays) ? [settings, replays] : [settings]
        const spacing = iconRadius * 1.2
        const groups = icons.map(icon => { icon.radius = iconRadius; return icon.groupWidth })
        let left = WIDTH / 2 - (groups.reduce((sum, width) => sum + width, 0) + spacing * (icons.length - 1)) / 2
        icons.forEach((icon, index) => {
            icon.place(left, iconY, iconRadius)
            left += groups[index] + spacing
        })
    }
    setTree(tree) {
        if (tree === this.main) this.updateMainButtons()
        if (this.selectedTree !== tree) this.selectedTree?.leave?.()
        this.previousTree = this.selectedTree
        this.selectedTree = tree
        if (this.previousTree !== tree) tree.enter?.()
    }
    openOnline() {
        // Late results are dropped once the user has moved elsewhere.
        let expected = this.main
        openOnlineSession({
            hub: account => {
                if (this.selectedTree !== expected) return false
                this.onlineHub.setAccount(account)
                this.setTree(this.onlineHub)
                expected = this.onlineHub
            },
            signIn: () => {
                if (this.selectedTree === expected) this.setTree(this.signIn)
            },
        })
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
        this.sky = new MenuSky()
        this.logo = new HaloLogo('logo', { x: WIDTH / 2, y: HEIGHT * 0.15 }, WIDTH * 0.5, WIDTH * 0.55 * 0.2)
        this.betaTag = new BetaTag()

        let startPos = {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: HEIGHT * 0.3}

        this.startGame = new Tree([
            new SlotManager(slotsCount, startPos.y, start)
        ], this)

        this.play = new HotseatSettingsTree(this)

        this.nickname = new NicknameTree(this)

        this.createLobby = new CreateLobbyTree(this)

        this.lobbyRoom = new LobbyRoomTree(this)

        this.onlineHub = new OnlineHubTree(this)

        this.signIn = new SignInTree(this)

        this.settings = new OtherSettingsTree(this)

        this.tutorial = new TutorialTree(this)

        this.replays = new ReplayTree(this)

        this.load = new Tree([
            new SlotManager(slotsCount, startPos.y, load)
        ], this)

        this.hotseatChoice = new HotseatChoiceTree(this, startPos, slotsCount)

        // main.buttons keeps the order [hot seat, play online, settings, tutorial] (+ replays); on screen the banners
        // read hot seat, tutorial (centre), play online, with the icon buttons below.
        this.main = new MainTree([
            new MenuBanner('hot seat', 'Hot seat', 'Competitive or co-op, one device', '#c22d26',
                this.setTree, this.hotseatChoice, this, {emblem: 'faceoff'}),
            new MenuBanner('play online', 'Play online', 'Create or join a lobby', '#3c78b0',
                this.openOnline, undefined, this, {emblem: 'towns'}),
            // 'play AI' button hidden for now; startAI is still available.
            new MenuIconButton('settings', 'Settings', 'gear', this.setTree, this.settings, this),
            new MenuBanner('tutorial', 'Tutorial', 'Learn the rules by playing', '#2f8f52',
                this.setTree, this.tutorial, this, {featured: true, emblem: 'noob'}),
        ], this)

        this.mainButtons = this.main.buttons.concat([
            new MenuIconButton('replays', 'Replays', 'play', this.setTree, this.replays, this)])
        this.updateMainButtons()
        this.hotseatChoice.setParent(this.main, this)
        this.play.setParent(this.hotseatChoice, this)
        this.onlineHub.setParent(this.main, this)
        this.createLobby.setParent(this.onlineHub, this)
        this.signIn.setParent(this.main, this)
        this.settings.setParent(this.main, this)
        this.startGame.setParent(this.play, this)
        this.load.setParent(this.hotseatChoice, this)
        this.tutorial.setParent(this.main, this)
        this.replays.setParent(this.main, this)
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
        this.updateMainButtons()
        this.updateSlotManagers()
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
            document.addEventListener('wheel', menuWheel)
            document.addEventListener('keydown', menuKeyDown)
            document.addEventListener('mousemove', menuMouseMove)
            if (mobilePhone) {
                document.addEventListener('touchstart', menuTouchStart)
                document.addEventListener('touchmove', menuTouchMove)
                document.addEventListener('touchend', menuTouchEnd)
            }
        } else {
            document.removeEventListener('click', menuClick)
            document.removeEventListener('wheel', menuWheel)
            document.removeEventListener('keydown', menuKeyDown)
            document.removeEventListener('mousemove', menuMouseMove)
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
        const lobbyGame = onlineSession.openGameID !== null
        if (onlineSocket) {
            closeOnlineGameSocket()
            onlineLobby = null
        }
        onlineSession.closeGame()
        GameManager.clearWaitingMode()

        nextTurnPauseInterface.backToMenu()
        // A lobby game lives on the server, not in a save slot.
        if (!lobbyGame) saveManager.save() //some bugs or not

        // very important save first then pause timer
        // so that the timer saves the current remaining time
        timer.pauseAndSaveTime()

        removeEvents()
        menu.visible = true
        menu.start()
        // A lobby game returns to the hub, whose enter re-fetches lobby:list;
        // the hub already left when the game was entered.
        if (lobbyGame) {
            this.selectedTree = this.main
            this.setTree(this.onlineHub)
        } else menu.setTree(menu.main)
        this.updateSlotManagers()
    }
    click(pos) {
        this.selectedTree.click(pos)
    }
    wheel(pos, deltaY, deltaX) {
        this.selectedTree.wheel?.(pos, deltaY, deltaX)
    }
    mouseMove(pos) {
        this.selectedTree.hover?.(pos)
    }
    keydown(event) {
        this.selectedTree.scrollKey?.(event.key)
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
        // Menu texts draw in the menu font; the game's texts keep Text's own default.
        const gameFamily = Text.defaultFamily
        Text.defaultFamily = MENU_FONT_FAMILY
        // Menu controls draw in the menu theme (sprites/elements/text.js MENU_THEME).
        Text.menuTheme = MENU_THEME
        try {
            this.sky.draw(ctx)
            // Co-op uses the header space for its size selector.
            if (!this.selectedTree.isCoop) this.logo.draw(ctx)
            this.betaTag.draw(ctx)
            this.selectedTree.draw(ctx)
            errorWindow.draw(ctx)
        } finally {
            Text.defaultFamily = gameFamily
            Text.menuTheme = null
            ctx.restore()
        }
    }
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}
