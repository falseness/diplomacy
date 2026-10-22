// A slider arrow: the leftButton/rightButton image, or in the menu theme a round plaque with a light triangle.
// The click target is the rect either way.
class MenuArrowButton extends ImageButton {
    constructor(direction, size) {
        let nonePos = {x: NaN, y: NaN}
        super(new JustImage(direction + 'Button', nonePos, size.width, size.height),
            new Rect(nonePos.x, nonePos.y, size.width, size.height))
        this.direction = direction === 'left' ? -1 : 1
        this.pressed = false
    }
    select(pos) {
        super.select(pos)
        if (this.isInside(pos)) this.pressed = true
    }
    removeSelect() {
        super.removeSelect()
        this.pressed = false
    }
    draw(ctx) {
        const theme = Text.menuTheme
        if (!theme) return super.draw(ctx)
        if (!this.canClick) return
        const {x, y} = this.rect.center
        // Smaller than the rect: the players slider's arrows sit close to its value.
        const r = Math.min(this.rect.width, this.rect.height) * (this.pressed ? 0.43 : 0.36)
        const style = theme.plain
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.globalAlpha = style.alpha
        ctx.fillStyle = style.fill
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = style.rim
        ctx.lineWidth = Math.max(1, r * 0.08)
        ctx.stroke()
        // The triangle points along the direction, its centroid on the circle's centre.
        const d = this.direction, tip = r * 0.5
        ctx.beginPath()
        ctx.moveTo(x + d * tip, y)
        ctx.lineTo(x - d * tip / 2, y - tip * 0.87)
        ctx.lineTo(x - d * tip / 2, y + tip * 0.87)
        ctx.closePath()
        ctx.fillStyle = theme.text
        ctx.fill()
        ctx.restore()
    }
}
class MenuSlider extends Slider {
    // Set by setupPlaceStepper (menu/menu.js) when the slider is a setup row's stepper.
    setup = null
    constructor(minimumValue, maximumValue, getKeyMap, parameters, startValue, marginX, text, size) {
        super(minimumValue, maximumValue, getKeyMap, parameters, startValue, marginX, text,
            new MenuArrowButton('left', size), new MenuArrowButton('right', size))
    }
    draw(ctx) {
        if (this.setup) setupDrawStepper(ctx, this)
        else super.draw(ctx)
    }
}
