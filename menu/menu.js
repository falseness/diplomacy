function menuClick(event) {
    let pos = getEventPos(event)
    menu.click(pos)
}

function menuWheel(event) {
    menu.wheel(getEventPos(event), event.deltaY)
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
        this.status = new Text(WIDTH / 2, this.firstY + this.intervalY * 2.5, 0.03 * WIDTH, '', 'black')
        this.playButton = Menu.getButton(this.actionButtonPos, 'create', this.create, undefined, true, this)
        this.updateButtonsList()
    }
    enter() {
        this.creating = false
        this.status.text = ''
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
            ack = await onlineSession.createLobby(board, options.mapName)
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
        this.title = new Text(WIDTH / 2, HEIGHT * 0.28, 0.028 * WIDTH, '', 'black')
        this.count = new Text(WIDTH / 2, HEIGHT * 0.33, 0.028 * WIDTH, '', '#747474')
        this.status = new Text(WIDTH / 2, HEIGHT * 0.8, 0.025 * WIDTH, '', 'black')
        this.rowTexts = []
        this.kickButtons = []
        this.leaveButton = Menu.getButton({x: WIDTH * 0.2, y: HEIGHT * 0.85}, 'leave', this.leaveLobby, undefined, true, this)
        this.startButton = Menu.getButton({x: WIDTH * 0.55, y: HEIGHT * 0.85}, 'start', this.startLobby, undefined, true, this)
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
            fontSize, row.text, row.kind === 'waiting' ? '#747474' : 'black', 'left'))
        this.kickButtons = []
        view.rows.forEach((row, i) => {
            if (!row.kick) return
            const rect = Menu.getButtonRect({x: WIDTH * 0.6, y: this.rowTop + (i + 0.1) * this.rowHeight})
            rect.width = WIDTH * 0.12
            rect.height = this.rowHeight * 0.8
            const text = Menu.getButtonText('kick')
            text.fontSize = fontSize
            const button = new MenuButton(rect, text, this.kick, row.accountId, true, this)
            button.accountId = row.accountId
            this.kickButtons.push(button)
        })
        // A disabled start is drawn greyed and ignores clicks.
        const enabled = view.start.enabled
        this.startButton.canClick = enabled
        this.startButton.color = enabled ? 'white' : '#bdbdbd'
        this.startButton.textColor = enabled ? 'black' : '#747474'
        this.startButton.selectedText.color = this.startButton.textColor
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
        if (this.view.start.visible && !this.startButton.canClick) {
            this.startButton.rect.draw(ctx)
            this.startButton.text.draw(ctx)
        }
    }
}

// Online entry screens: Google sign-in and the signed-in hub with its games and lobbies list.
class SignInTree {
    constructor(_menu) {
        this.menu = _menu
        this.container = null
        this.title = new Text(WIDTH / 2, HEIGHT * 0.33, 0.04 * WIDTH, 'sign in to play online', 'black')
        this.status = new Text(WIDTH / 2, HEIGHT * 0.58, 0.025 * WIDTH, '', '#747474')
        this.buttons = []
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.buttons = [Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', _menu.setTree, parent, true, _menu)]
    }
    // Google's button is the only DOM element of the menu; it lives while this screen is shown.
    enter() {
        this.leave()
        const div = this.container = document.createElement('div')
        div.id = 'google-signin'
        div.style.cssText = `position:absolute;left:${WIDTH / 2 / devicePixelRatio}px;` +
            `top:${HEIGHT * 0.43 / devicePixelRatio}px;transform:translateX(-50%);z-index:1`
        // Clicks on Google's button must not reach the canvas menu below it.
        div.addEventListener('click', event => event.stopPropagation())
        document.body.append(div)
        this.status.text = 'loading Google sign-in…'
        loadGoogleIdentity().then(() => {
            if (this.container !== div) return
            this.status.text = ''
            renderGoogleButton(div, credential => this.signIn(credential))
        }, () => {
            if (this.container === div) this.status.text = 'could not load Google sign-in'
        })
    }
    leave() {
        this.container?.remove()
        this.container = null
    }
    async signIn(credential) {
        this.status.text = 'signing in…'
        const account = await onlineSession.signInWithGoogle(credential)
        if (this.menu.selectedTree !== this) return
        if (!account) {
            this.status.text = 'sign-in failed, try again'
            return
        }
        this.menu.onlineHub.setAccount(account)
        this.menu.setTree(this.menu.onlineHub)
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.status.draw(ctx)
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
            if (row.kind === 'game' || row.kind === 'lobby') {
                ctx.fillStyle = row.yourTurn ? '#ffd54f' : 'white'
                ctx.fillRect(x + pad, top + 0.1 * rowHeight, width - 2 * pad, 0.8 * rowHeight)
                ctx.strokeStyle = row.id === this.selectedId ? 'black' : '#747474'
                ctx.lineWidth = (row.id === this.selectedId ? 0.003 : 0.001) * WIDTH
                ctx.strokeRect(x + pad, top + 0.1 * rowHeight, width - 2 * pad, 0.8 * rowHeight)
            }
            // Long rows shrink to fit the list width.
            let fontSize = (header ? 0.55 : 0.45) * rowHeight
            const maxWidth = width - 4 * pad
            ctx.font = `${header ? 'bold ' : ''}${fontSize}px Times New Roman`
            const textWidth = ctx.measureText(row.text).width
            if (textWidth > maxWidth) {
                fontSize *= maxWidth / textWidth
                ctx.font = `${header ? 'bold ' : ''}${fontSize}px Times New Roman`
            }
            ctx.fillStyle = row.kind === 'empty' ? '#747474' : 'black'
            ctx.textAlign = 'left'
            ctx.fillText(row.text, x + 2 * pad, top + rowHeight / 2)
        }
        ctx.restore()
    }
}

// The signed-in hub: your games and open lobbies from lobby:list, re-fetched on lobby:listChanged.
class OnlineHubTree {
    constructor(_menu) {
        this.menu = _menu
        this.account = null
        this.feed = null
        // A one-off message after the status line, e.g. a lobby:join error or
        // 'you were removed from the lobby'; cleared on leave.
        this.notice = ''
        this.status = new Text(WIDTH / 2, HEIGHT * 0.27, 0.025 * WIDTH, '', 'black')
        this.list = new HubList({x: WIDTH * 0.08, y: HEIGHT * 0.31, width: WIDTH * 0.78, height: HEIGHT * 0.47})
        this.list.onRow = row => {
            if (row.kind === 'lobby') this.joinLobby(row.id)
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
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, 0.04 * WIDTH, 'change nickname', 'black')
        // Wider than a button so 16 characters fit.
        const inputRect = Menu.getButtonRect({x: WIDTH * 0.3, y: HEIGHT * 0.36})
        inputRect.width = WIDTH * 0.4
        this.input = new MenuTextInput(inputRect, 0.04 * WIDTH,
            {maxLength: 16, onSubmit: () => this.save(), onCancel: () => this.back()})
        this.status = new Text(WIDTH / 2, HEIGHT * 0.51, 0.025 * WIDTH, '', '#747474')
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
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, undefined, '#d0d0d0')
        this.logo = new JustImage('logo', { x: WIDTH / 2, y: HEIGHT * 0.15 }, WIDTH * 0.5, WIDTH * 0.55 * 0.2)
        this.alphaText = new Text(WIDTH * 0.73, WIDTH * 0.55 * 0.33 - HEIGHT * 0.05,
            0.02 * WIDTH, 'beta', '#747474')

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

        this.load = new Tree([
            new SlotManager(slotsCount, startPos.y, load)
        ], this)

        this.main = new Tree([
            this.constructor.getButton(startPos, 'hot seat',
                this.setTree, this.play, true, this),
            this.constructor.getButton(startPos, 'play online',
                this.openOnline, undefined, true, this),
            // 'play AI' button hidden for now; startAI is still available.
            // this.constructor.getButton(startPos, 'play AI',
            //     startAI, 0),
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
        this.onlineHub.setParent(this.main, this)
        this.createLobby.setParent(this.onlineHub, this)
        this.signIn.setParent(this.main, this)
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
            document.addEventListener('wheel', menuWheel)
            if (mobilePhone) {
                document.addEventListener('touchstart', menuTouchStart)
                document.addEventListener('touchmove', menuTouchMove)
                document.addEventListener('touchend', menuTouchEnd)
            }
        } else {
            document.removeEventListener('click', menuClick)
            document.removeEventListener('wheel', menuWheel)
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
    wheel(pos, deltaY) {
        this.selectedTree.wheel?.(pos, deltaY)
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
