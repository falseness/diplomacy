class TemporaryWindow extends Button {
    constructor(rect, text) {
        super(rect, text)
        this.rect.centerX = this.rect.pos.x
        this.trimText()

        this.visible = false
    }
    trimText() {
        super.trimText()
        this.text.pos.y -= this.text.height / 2
    }
    click() {}
    enableTemporary() {
        this.visible = true
        const interval = 3000
        setTimeout(function(tempWindow) {
            tempWindow.visible = false
        }, interval, this)
    }
    get visible() {
        return this.canClick
    }
    set visible(boolean) {
        this.canClick = boolean
    }
    draw(ctx) {
        if (!menu.visible)
            ctx.globalAlpha = 0.8
        super.draw(ctx)
        ctx.globalAlpha = 1
    }
}