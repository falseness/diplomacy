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
function menuTouchEnd(event) {
    let pos = getEventPos(event)
    menu.touchEnd(pos) 
}
function load() {
    if (!saveManager.load())
        return
    GameManager.load()
}

class Tree {
    #interval = HEIGHT * 0.18
    constructor(buttons, _menu) {
        this.parent = parent
        this.buttons = new Array(buttons.length)
        let posButton0 = buttons[0].pos
        for (let i = 0; i < buttons.length; ++i) {
            buttons[i].pos = {x: posButton0.x, y: posButton0.y + i * this.#interval}
            this.buttons[i] = buttons[i]
        }
        if (parent) {
            
        }
    }
    setParent(parent, _menu) {
        let posButton0 = this.buttons[0].pos
        this.buttons.push(
            Menu.getButton({x: posButton0.x, y: posButton0.y + this.buttons.length * this.#interval},
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
        this.selectedTree = tree
    }
    constructor() {
        this.visible = true
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
            0.02 * WIDTH, 'alpha', '#747474') //#747474

        let startPos = {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: HEIGHT * 0.3}
    
        this.playSmall = new Tree([
            this.constructor.getButton(startPos, 'play 1x1', GameManager.start1, undefined, true, GameManager),
            this.constructor.getButton(undefined, 'play ffa 3', GameManager.start2, undefined, true, GameManager),
            this.constructor.getButton(undefined, 'play ffa 4', GameManager.start3, undefined, true, GameManager)
        ], this)
        this.playBig = new Tree([
            this.constructor.getButton(startPos, 'play 1x1', GameManager.start4, undefined, true, GameManager),
            this.constructor.getButton(startPos, 'play ffa 3', GameManager.start5, undefined, true, GameManager)
        ], this)
        this.play = new Tree([
            this.constructor.getButton(startPos, 'small map', this.setTree, this.playSmall, true, this),
            this.constructor.getButton(undefined, 'big map', this.setTree, this.playBig, true, this)
        ], this)

        this.load = new Tree([
            this.constructor.getButton(startPos, 'load', load)
        ], this)
        this.main = new Tree([
            this.constructor.getButton(startPos, 'start game', 
                this.setTree, this.play, true, this),
            this.constructor.getButton(startPos, 'load game', 
                this.setTree, this.load, true, this),
        ], this)
        //this.main.buttons[0].select()
        this.playSmall.setParent(this.play, this)
        this.playBig.setParent(this.play, this)
        this.play.setParent(this.main, this)
        this.load.setParent(this.main, this)
        this.selectedTree = this.main

        let firstY = HEIGHT * 0.3
        let interval = HEIGHT * 0.18
        
        this.loadButton = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, firstY + interval * 3, WIDTH * 0.25, HEIGHT * 0.1, [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'load save', 'black'), load)
        this.loadButton.trimText()
    }
    start() {
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
            if (mobilePhone) {
                document.addEventListener('touchstart', menuTouchStart)
                document.addEventListener('touchend', menuTouchEnd)
            }
        } else {
            document.removeEventListener('click', menuClick)
            if (mobilePhone) {
                document.removeEventListener('touchstart', menuTouchStart)
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
    back() {
        gameExit = true

        nextTurnPauseInterface.backToMenu()
        saveManager.save() //some bugs or not
        
        // very important save first then pause timer 
        // so that the timer saves the current remaining time
        timer.pause()

        menu.visible = true
        menu.start()
        menu.setTree(menu.main)
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