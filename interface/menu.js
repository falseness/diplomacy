function menuClick(event) {
    let pos = getEventPos(event)
    menu.playButton1.click(pos)
    menu.playButton2.click(pos)
    menu.loadButton.click(pos)
}
function menuBack() {
    saveManager.save()
    cancelAnimationFrame(gameLoop)
    menu.setVisible(true)
    menu.start()
}
function load() {
    menu.setVisible(false)
    saveManager.load()
    createEvents()
    mapBorder = {
        left: 0,
        right: grid.getRight(),
        top: 0,
        bottom: grid.getBottom(),
        scale: {
            min: 0.4,
            max: 1
        }
    }
    requestAnimationFrame(gameLoop)
}
function startGame1() {
    menu.setVisible(false)
    start1()
    createEvents()
    mapBorder = {
        left: 0,
        right: grid.getRight(),
        top: 0,
        bottom: grid.getBottom(),
        scale: {
            min: 0.4,
            max: 1
        }
    }
    requestAnimationFrame(gameLoop)
}
function startGame2() {
    menu.setVisible(false)
    start2()
    createEvents()
    mapBorder = {
        left: 0,
        right: grid.getRight(),
        top: 0,
        bottom: grid.getBottom(),
        scale: {
            min: 0.4,
            max: 1
        }
    }
    requestAnimationFrame(gameLoop)
}
class Menu {
    constructor() {
        this.setVisible(true)
        
        this.logo = new JustImage('logo', {x: WIDTH / 2, y: HEIGHT * 0.2}, WIDTH * 0.5, WIDTH * 0.55 * 0.2)
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, undefined, '#d0d0d0')
        this.alphaText = new Text(WIDTH * 0.73, WIDTH * 0.55 * 0.33, 0.02 * WIDTH, 'alpha', '#747474')//#747474
        this.playButton1 = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35, WIDTH * 0.25, HEIGHT * 0.1, 
                     [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'play', 'black'), startGame1)
        this.playButton1.trimText()
        
        this.playButton2 = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35 + HEIGHT * 0.2, WIDTH * 0.25, HEIGHT * 0.1, 
                     [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'play3', 'black'), startGame2)
        this.playButton2.trimText()
        this.loadButton = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.35 + HEIGHT * 0.4, WIDTH * 0.25, HEIGHT * 0.1, 
                     [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'load save', 'black'), load)
        this.loadButton.trimText()
    }
    start() {
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
        }
        else {
            document.removeEventListener('click', menuClick)
        }
    }
    setVisible(boolean) {
        this.visible = boolean
        this.setEvents(boolean)
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