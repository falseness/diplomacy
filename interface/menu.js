function menuClick(event) {
    let pos = getEventPos(event)
    menu.playButton.click(pos)
}
function startGame() {
    menu.setVisible(false)
    createEvents()
    requestAnimationFrame(gameLoop)
}
class Menu {
    constructor() {
        this.setVisible(true)
        
        this.logo = new JustImage('logo', {x: WIDTH / 2, y: HEIGHT * 0.2}, WIDTH * 0.5, WIDTH * 0.55 * 0.2)
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, undefined, '#d0d0d0')
        this.alphaText = new Text(WIDTH * 0.73, WIDTH * 0.55 * 0.33, 0.02 * WIDTH, 'alpha', '#747474')//#747474
        this.playButton = new Button(
            new Rect(WIDTH / 2 - WIDTH * 0.25 / 2, HEIGHT * 0.45, WIDTH * 0.25, HEIGHT * 0.1, 
                     [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.007 * WIDTH, 'white'),
            new Text(undefined, undefined, 0.04 * WIDTH, 'play', 'black'), startGame)
        this.playButton.trimText()
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
        this.playButton.draw(ctx)
    }
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}