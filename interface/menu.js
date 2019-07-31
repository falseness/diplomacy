function menuClick(event) {
    let pos = getEventPos(event)
    menu.playButton1.click(pos)
    menu.playButton2.click(pos)
    menu.loadButton.click(pos)
}

function menuBack() {
    menu.back()
}

function load() {
    if (!saveManager.load())
        return
    GameManager.load()
}

function startGame1() {
    GameManager.start1()
}

function startGame2() {
    GameManager.start2()
}
class Tree {
    constructor(parent, buttons) {
        this.parent = parent

        const interval = HEIGHT * 0.2
        let posButton0 = this.buttons[0].pos
        for (let i = 1; i < buttons.length; ++i) {
            buttons[i].pos = {x: posButton0.x, y: posButton0.y + i * interval}
        }
    }
    draw(ctx) {
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
    }
}
class Menu {
    constructor() {
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

        this.setVisible(true)

        this.logo = new JustImage('logo', { x: WIDTH / 2, y: HEIGHT * 0.2 }, WIDTH * 0.5, WIDTH * 0.55 * 0.2)

        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, undefined, '#d0d0d0')
        this.alphaText = new Text(WIDTH * 0.73, WIDTH * 0.55 * 0.33, 0.02 * WIDTH, 'alpha', '#747474') //#747474
        this.playButton1 = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35, WIDTH * 0.25, HEIGHT * 0.1, [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'play', 'black'), startGame1)
        this.playButton1.trimText()

        this.playButton2 = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35 + HEIGHT * 0.2, WIDTH * 0.25, HEIGHT * 0.1, [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'play3', 'black'), startGame2)
        this.playButton2.trimText()
        this.loadButton = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35 + HEIGHT * 0.4, WIDTH * 0.25, HEIGHT * 0.1, [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'load save', 'black'), load)
        this.loadButton.trimText()
    }
    start() {
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
        } else {
            document.removeEventListener('click', menuClick)
        }
    }
    setVisible(boolean) {
        this.visible = boolean
        this.setEvents(boolean)
    }
    back() {
        gameExit = true
        saveManager.save() //some bugs or not

        menu.setVisible(true)
        menu.start()
    }
    draw(ctx) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        this.background.draw(ctx)
        this.logo.draw(ctx)
        this.alphaText.draw(ctx)
        this.playButton1.draw(ctx)
        this.playButton2.draw(ctx)
        this.loadButton.draw(ctx)
    }
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}