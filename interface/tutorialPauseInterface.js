// The pause menu of a tutorial, opened by the top-left menu button: 'Paused' on a navy ribbon over the dimmed board,
// the lesson's medallion above it, 'Tutorial N: Name' below it and three stacked buttons: Resume, Retry (the same
// tutorial again) and Back to tutorials (the tutorial menu, as the result screen's button). The turn timer is frozen
// while it is shown (its text stays drawn); it closes only by Resume or by the menu button again, and takes every
// other game click. Laid out in hub units from the current WIDTH/HEIGHT on every draw and click.
class TutorialPauseInterface {
    static GLYPHS = ['resume', 'retry', 'menu']
    constructor() {
        this.visible = false
        // Whether the turn timer was ticking when the menu opened; Resume restarts it only then.
        this.timerWasTicking = false
        this.panel = new Rect(0, 0, 0, 0)
        this.resumeButton = new HubButton('Resume', this.resume, undefined, this, true)
        this.retryButton = new HubButton('Retry', this.retry, undefined, this)
        this.backButton = new HubButton('Back to tutorials', this.back, undefined, this)
        this.place()
    }
    get buttons() {
        return [this.resumeButton, this.retryButton, this.backButton]
    }
    // Every box from the current screen size: ribbon, tails, medallion, subtitle, the buttons and the panel (the
    // drawn composition's bounding box).
    place() {
        const u = hubUnit(), f = u * hubFontScale()
        const cy = HEIGHT * 0.36, height = 6.5 * u, width = Math.min(46 * u, WIDTH - 14 * u)
        this.ribbon = {x: WIDTH / 2 - width / 2, y: cy - height / 2, width, height, cy, bow: 1.4 * u}
        this.tails = [-1, 1].map(side => {
            const inner = side < 0 ? this.ribbon.x + 2 * u : this.ribbon.x + width - 2 * u
            return {side, inner, outer: inner + side * 8 * u, y: this.ribbon.y + 1.4 * u, height, notch: 2.2 * u}
        })
        const r = 4 * u
        this.medallion = {x: WIDTH / 2, y: this.ribbon.y - 1.2 * u - r, radius: r}
        this.titleFont = 4 * f
        this.subtitle = {x: WIDTH / 2, y: this.ribbon.y + height + 2.4 * u, fontSize: 1.9 * f}
        const bw = 24 * u, bh = 4.6 * u, gap = 1.2 * u, by = this.ribbon.y + height + 5 * u
        // The centred label keeps clear of the glyph (its right edge 0.85 bh in) by 0.5 u on both sides.
        const room = bw - 2 * (0.85 * bh + 0.5 * u)
        this.buttons.forEach((button, i) => button.place(WIDTH / 2 - bw / 2, by + i * (bh + gap), bw, bh,
            2.1 * u * this.labelFit(button.text.text, room, 2.1 * f)))
        // The medallion's shade ring is 0.7 u outside its disc; the tails' outer ends are the left and right.
        const left = this.tails[0].outer, top = this.medallion.y - r - 0.7 * u
        this.panel = new Rect(left, top, this.tails[1].outer - left, by + 3 * bh + 2 * gap - top)
    }
    // The share of a label's font (px) that fits it in width (at most 1).
    labelFit(label, width, px) {
        const ctx = interfaceCtx
        ctx.save()
        ctx.font = `800 ${px}px ${MENU_TITLE_FONT_FAMILY}`
        const measured = ctx.measureText(label).width
        ctx.restore()
        return measured > 0 ? Math.min(1, width / measured) : 1
    }
    // The menu button in a tutorial: opens the menu, or closes it as Resume when it is shown.
    toggle() {
        if (this.visible)
            this.resume()
        else
            this.show()
    }
    // Freezes the turn timer (its remaining time is kept) and stops the camera's held keys and edge scrolling.
    show() {
        this.timerWasTicking = timer.isTick
        timer.pause()
        gameEvent.resetKeyboardZoom()
        gameEvent.resetCameraInput()
        if (gameEvent.resetPinch)
            gameEvent.resetPinch()
        this.place()
        this.visible = true
    }
    // Hides the menu without touching the timer (the result screen, Retry, Next tutorial and Back).
    hide() {
        this.visible = false
    }
    resume() {
        this.hide()
        if (this.timerWasTicking)
            timer.updateLastPause()
        this.timerWasTicking = false
    }
    retry() {
        this.hide()
        TutorialManager.retry()
    }
    back() {
        this.hide()
        TutorialManager.backToTutorials()
    }
    // True while shown: the menu button still toggles, the three buttons act, every other click is swallowed.
    click(pos) {
        if (!this.visible)
            return false
        if (backToMenuButton.rect.isInside(pos))
            return backToMenuButton.click(pos)
        this.place()
        this.resumeButton.click(pos) || this.retryButton.click(pos) || this.backButton.click(pos)
        return true
    }
    // The lesson's {id, number, name} (parseTitle of its title), or null outside a tutorial.
    lesson() {
        const id = gameSettings.tutorial && gameSettings.tutorial.id
        const tutorial = id && tutorials.find(tutorial => tutorial.id === id)
        return tutorial ? {id, ...TutorialCardsTree.parseTitle(tutorial.title)} : null
    }
    draw(ctx) {
        if (!this.visible)
            return
        this.place()
        const u = hubUnit()
        // The frozen turn time stays where the timer draws it (Timer.draw hides it while it does not tick).
        if (this.timerWasTicking) {
            timer.text.text = timer.timerText
            timer.text.draw(ctx)
        }
        ctx.save()
        ctx.fillStyle = 'rgba(6, 10, 26, 0.5)'
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        this.drawRibbon(ctx)
        ctx.font = `800 ${this.titleFont}px ${MENU_TITLE_FONT_FAMILY}`
        ctx.fillStyle = MENU_THEME.heading
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Paused', WIDTH / 2, this.ribbon.cy - 0.5 * u)
        const lesson = this.lesson(), {x, y, radius} = this.medallion
        menu.tutorial.drawMedallion(ctx, x, y, radius, u)
        if (lesson) {
            menu.tutorial.drawMedallionImage(ctx, lesson.id, x, y, radius)
            ctx.font = `700 ${this.subtitle.fontSize}px ${MENU_TITLE_FONT_FAMILY}`
            ctx.fillStyle = MENU_THEME.text
            ctx.fillText(lesson.number ? `Tutorial ${lesson.number}: ${lesson.name}` : lesson.name,
                this.subtitle.x, this.subtitle.y)
        }
        ctx.restore()
        const family = Text.titleFamily
        Text.titleFamily = MENU_TITLE_FONT_FAMILY
        try {
            for (const button of this.buttons)
                button.draw(ctx)
        } finally {
            Text.titleFamily = family
        }
        this.buttons.forEach((button, i) => this.drawGlyph(ctx, button, TutorialPauseInterface.GLYPHS[i]))
    }
    // The tails (V-notched, lower, behind), then the navy face with both edges bowed up at the centre, its shadow
    // and rim.
    drawRibbon(ctx) {
        const {x, y, width, height, bow} = this.ribbon, u = hubUnit()
        ctx.fillStyle = '#0c1230'
        for (const tail of this.tails) {
            ctx.beginPath()
            ctx.moveTo(tail.inner, tail.y)
            ctx.lineTo(tail.outer, tail.y)
            ctx.lineTo(tail.outer - tail.side * tail.notch, tail.y + tail.height / 2)
            ctx.lineTo(tail.outer, tail.y + tail.height)
            ctx.lineTo(tail.inner, tail.y + tail.height)
            ctx.closePath()
            ctx.fill()
        }
        const face = ctx.createLinearGradient(0, y, 0, y + height)
        face.addColorStop(0, '#2a3768')
        face.addColorStop(1, '#151d40')
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
        ctx.shadowBlur = 2 * u
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(WIDTH / 2, y - bow, x + width, y)
        ctx.lineTo(x + width, y + height)
        ctx.quadraticCurveTo(WIDTH / 2, y + height - bow, x, y + height)
        ctx.closePath()
        ctx.fillStyle = face
        ctx.fill()
        ctx.restore()
        ctx.strokeStyle = MENU_THEME.plain.rim
        ctx.lineWidth = 0.18 * u
        ctx.stroke()
    }
    // A glyph left of the label in the button's text colour: a play triangle, the undo arrow or the menu icon.
    drawGlyph(ctx, button, kind) {
        const {x, y, height} = button.rect, s = 0.42 * height, cx = x + 0.55 * height, cy = y + height / 2
        const colour = button.primary ? MENU_THEME.primary.text : MENU_THEME.plain.text
        ctx.save()
        ctx.strokeStyle = ctx.fillStyle = colour
        ctx.lineWidth = 0.14 * s
        ctx.lineCap = ctx.lineJoin = 'round'
        if (kind === 'resume') {
            ctx.beginPath()
            ctx.moveTo(cx - 0.3 * s, cy - 0.4 * s)
            ctx.lineTo(cx + 0.4 * s, cy)
            ctx.lineTo(cx - 0.3 * s, cy + 0.4 * s)
            ctx.closePath()
            ctx.fill()
        } else if (kind === 'retry')
            ParchmentIconImage.undo(ctx, cx, cy, 1.6 * s, colour, 0.14 * s)
        else
            ParchmentIconImage.menu(ctx, cx, cy, 1.4 * s, colour, 0.14 * s)
        ctx.restore()
    }
}

// The top-left menu button: in a running tutorial (no result screen, no switch in progress) it opens or closes the
// pause menu; anywhere else (hot seat, online, replays) it goes back to the menu as before.
function backToMenuPress() {
    if (gameSettings.tutorial && !tutorialResultInterface.visible && !TutorialManager.switching)
        tutorialPauseInterface.toggle()
    else
        menuBack()
}
