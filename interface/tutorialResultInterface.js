// The end screen of a tutorial: 'Victory' or 'Defeat' over the board with Retry
// (the same tutorial again) and Back to tutorials. While it is shown it takes
// every game click.
class TutorialResultInterface {
    constructor() {
        this.visible = false
        this.outcome = null
        // The board stays visible behind the dimming.
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, 0, 'rgba(0, 0, 0, 0.4)')
        this.panel = new Rect(WIDTH * 0.25, HEIGHT * 0.2, WIDTH * 0.5, HEIGHT * 0.6,
            [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.0035 * WIDTH, 'white')
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, 0.06 * WIDTH, 'Victory', 'black')
        this.retryButton = TutorialResultInterface.getButton(HEIGHT * 0.42, 'Retry', TutorialManager.retry)
        this.backButton = TutorialResultInterface.getButton(HEIGHT * 0.6, 'Back to tutorials',
            TutorialManager.backToTutorials)
    }
    // A menu button wide enough for 'Back to tutorials'.
    static getButton(y, text, clickFunc) {
        const width = WIDTH * 0.36
        const rect = Menu.getButtonRect({x: WIDTH / 2 - width / 2, y: y})
        rect.width = width
        return new MenuButton(rect, Menu.getButtonText(text), clickFunc, undefined, true, TutorialManager)
    }
    show(outcome) {
        this.outcome = outcome
        this.title.text = outcome == 'victory' ? 'Victory' : 'Defeat'
        this.title.color = outcome == 'victory' ? 'green' : 'red'
        this.visible = true
    }
    hide() {
        this.visible = false
        this.outcome = null
    }
    click(pos) {
        if (!this.visible)
            return false
        this.retryButton.click(pos) || this.backButton.click(pos)
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        this.background.draw(ctx)
        this.panel.draw(ctx)
        this.title.draw(ctx)
        this.retryButton.draw(ctx)
        this.backButton.draw(ctx)
    }
}
