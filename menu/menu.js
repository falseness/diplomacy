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
    INTERVAL_Y = 0.15 * HEIGHT
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
        
        this.buttons = []
        this.buttons.push(this.hpBarCheckBox, this.movesBarCheckBox, this.undoCheckBox)
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
        otherSettings.alwaysDisplayHPBar = this.hpBarCheckBox.mark
        otherSettings.alwaysDisplayMovesBar = this.movesBarCheckBox.mark
        otherSettings.moveCameraToUndoTarget = this.undoCheckBox.mark

        saveOtherSettings()
    }
    __updateButtonsByOtherSettings() {
        this.hpBarCheckBox.mark = otherSettings.alwaysDisplayHPBar
        this.movesBarCheckBox.mark = otherSettings.alwaysDisplayMovesBar
        this.undoCheckBox.mark = otherSettings.moveCameraToUndoTarget
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
        for (let i = 0; i < this.buttons.length - 1; ++i) {
            ok |= this.buttons[i].click(pos)
        }
        if (this.buttons[this.buttons.length - 1].click(pos)) {
            // map slider click
            this.playersSlider.update()
            ok = true
        }
        return ok
    }
    draw(ctx) {
        this.playersText.draw(ctx)
        this.mapText.draw(ctx)
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
        /*this.fogOfWarCheckBox.draw(ctx)
        this.backButton.draw(ctx)

        this.mapSlider.draw(ctx)*/
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
            WIDTH * 0.58, firstY, rectSize, rectSize, 
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)


        this.passwordText = new Text(posX - Menu.getButton().width / 2, 
            firstY + intervalY, fontSize, 'enter password:', 'black', 'left')

        this.passwordButtons = []

        this.currentPassword = ''

        this.initializePasswordsButtons(firstY, intervalY)
      



        // this.timerCheckBox = new ImageCheckBox('checkMark',
        //     new Text(NaN, NaN, fontSize, 'dynamic timer', 'black'), marginLeft,
        //     WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize, 
        //     [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()

        intervalY -= HEIGHT * 0.01

        this.playButton = Menu.getButton(
            {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: firstY + intervalY * 4}, 'start', 
            _menu.setTree, _menu.startGame, true, _menu)
            
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
        this.buttons = [this.backButton, this.playButton, 
            this.fogOfWarCheckBox/*, this.timerCheckBox, this.playersSlider, this.mapSlider*/]
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
        // todo: update
        let map = maps['tiny deathmatch'][0]
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
        for (let i = 0; i < this.buttons.length; ++i) {
            ok |= this.buttons[i].click(pos)
        }
        // if (this.buttons[this.buttons.length - 1].click(pos)) {
        //     // map slider click
        //     this.playersSlider.update()
        //     ok = true
        // }
        return ok
    }
    draw(ctx) {
        //this.playersText.draw(ctx)
        this.passwordText.draw(ctx)
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

        this.play = new GameSettingsTree(this)
        
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
            this.constructor.getButton(startPos, 'settings', 
                this.setTree, this.settings, true, this),
            this.constructor.getButton(startPos, 'load game', 
                this.setTree, this.load, true, this),
        ], this)

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
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        this.background.draw(ctx)
        this.logo.draw(ctx)
        this.alphaText.draw(ctx)
        this.selectedTree.draw(ctx)
        /*this.playButton1.draw(ctx)
        this.playButton2.draw(ctx)
        this.playButton3.draw(ctx)
        this.loadButton.draw(ctx)*/

        errorWindow.draw(ctx)
    }
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}