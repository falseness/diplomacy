// The end screen of a tutorial: 'Victory' or 'Defeat' on a ribbon over the dimmed board, the lesson's medallion above
// it, 'Tutorial N: Name · passed / not passed' below it and one row of buttons: Retry (the same tutorial again) and
// Back to tutorials, and on a victory with a later tutorial in the list Next tutorial first. Everything is laid out in
// hub units from the current WIDTH/HEIGHT on show() and on every draw and click, so a resize keeps it right. While it
// is shown it takes every game click.
class TutorialResultInterface {
    static RIBBON = {
        victory: {face: ['#ffe3a3', '#d9962f'], rim: '#fff1c8', tail: '#9a6420', title: '#2a1a06'},
        defeat: {face: ['#8a3a32', '#4e1616'], rim: '#b5524a', tail: '#2e0c0c', title: '#f6e2b8'},
    }
    constructor() {
        this.visible = false
        this.outcome = null
        this.panel = new Rect(0, 0, 0, 0)
        this.nextButton = null
        this.retryButton = null
        this.backButton = null
        this.layOut(false)
    }
    // The buttons in their row order: Next tutorial (primary) when shown, else Retry is the primary one.
    makeButtons(hasNext) {
        this.nextButton = hasNext ? new HubButton('Next tutorial', TutorialManager.next, undefined, TutorialManager, true) : null
        this.retryButton = new HubButton('Retry', TutorialManager.retry, undefined, TutorialManager, !hasNext)
        this.backButton = new HubButton('Back to tutorials', TutorialManager.backToTutorials, undefined, TutorialManager)
    }
    get buttons() {
        return [this.nextButton, this.retryButton, this.backButton].filter(Boolean)
    }
    // The lesson's {id, number, name} (parseTitle of its title), or null outside a tutorial.
    lesson() {
        const id = gameSettings.tutorial && gameSettings.tutorial.id
        const tutorial = id && tutorials.find(tutorial => tutorial.id === id)
        return tutorial ? {id, ...TutorialCardsTree.parseTitle(tutorial.title)} : null
    }
    layOut(hasNext) {
        this.makeButtons(hasNext)
        this.place()
    }
    // Every box from the current screen size: ribbon, medallion, stars, subtitle, the button row and the panel (the
    // drawn composition's bounding box).
    place() {
        const u = hubUnit(), f = u * hubFontScale()
        const cy = HEIGHT * 0.44, height = 7.5 * u, width = Math.min(56 * u, WIDTH - 14 * u)
        this.ribbon = {x: WIDTH / 2 - width / 2, y: cy - height / 2, width, height, cy, bow: 1.6 * u}
        this.tails = [-1, 1].map(side => {
            const inner = side < 0 ? this.ribbon.x + 2 * u : this.ribbon.x + width - 2 * u
            return {side, inner, outer: inner + side * 9 * u, y: this.ribbon.y + 1.6 * u, height, notch: 2.4 * u}
        })
        const r = 4.6 * u
        this.medallion = {x: WIDTH / 2, y: this.ribbon.y - 1.2 * u - r, radius: r}
        this.badge = {x: WIDTH / 2 + 0.75 * r, y: this.medallion.y + 0.7 * r, radius: 1.4 * u}
        this.stars = []
        for (const side of [-1, 1])
            for (const k of [1, 2])
                this.stars.push({x: WIDTH / 2 + side * (r + 1.6 * u + k * 2.4 * u), y: this.medallion.y + 0.8 * u * k,
                    radius: (1.3 - 0.25 * k) * u})
        this.titleFont = 4.6 * f
        this.subtitle = {x: WIDTH / 2, y: this.ribbon.y + height + 2.6 * u, fontSize: 1.9 * f}
        const buttons = this.buttons, bw = 17 * u, bh = 4.6 * u, gap = 1.4 * u
        const total = buttons.length * bw + (buttons.length - 1) * gap, by = this.ribbon.y + height + 5.6 * u
        buttons.forEach((button, i) => button.place(WIDTH / 2 - total / 2 + i * (bw + gap), by, bw, bh,
            2.1 * u * this.labelFit(button.text.text, bw - 2.4 * u, 2.1 * f)))
        // The medallion's shade ring is 0.7 u outside its disc; the tails' outer ends are the left and right.
        const left = this.tails[0].outer, top = this.medallion.y - r - 0.7 * u
        this.panel = new Rect(left, top, this.tails[1].outer - left, by + bh - top)
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
    show(outcome) {
        tutorialPauseInterface.hide()
        this.outcome = outcome
        this.layOut(outcome == 'victory' && TutorialManager.nextId() !== null)
        this.visible = true
    }
    // Retry, Next tutorial, Back to tutorials and a tutorial's start hide the pause menu too.
    hide() {
        tutorialPauseInterface.hide()
        this.visible = false
        this.outcome = null
    }
    click(pos) {
        if (!this.visible)
            return false
        this.place()
        if (!(this.nextButton && this.nextButton.click(pos)))
            this.retryButton.click(pos) || this.backButton.click(pos)
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        this.place()
        const victory = this.outcome == 'victory', colours = TutorialResultInterface.RIBBON[victory ? 'victory' : 'defeat']
        ctx.save()
        this.drawDim(ctx)
        this.drawRibbon(ctx, colours)
        ctx.font = `800 ${this.titleFont}px ${MENU_TITLE_FONT_FAMILY}`
        ctx.fillStyle = colours.title
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(victory ? 'Victory' : 'Defeat', WIDTH / 2, this.ribbon.cy - 0.5 * hubUnit())
        const lesson = this.lesson()
        this.drawMedallion(ctx, lesson, !victory)
        if (victory) {
            menu.tutorial.drawCheckBadge(ctx, this.badge.x, this.badge.y, this.badge.radius)
            for (const star of this.stars)
                this.drawStar(ctx, star)
        } else
            this.drawCrossBadge(ctx)
        if (lesson) {
            const name = lesson.number ? `Tutorial ${lesson.number}: ${lesson.name}` : lesson.name
            ctx.font = `700 ${this.subtitle.fontSize}px ${MENU_TITLE_FONT_FAMILY}`
            ctx.fillStyle = MENU_THEME.text
            ctx.fillText(`${name}  ·  ${victory ? 'passed' : 'not passed'}`, this.subtitle.x, this.subtitle.y)
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
    }
    // The board stays visible behind a navy dim and a vignette darker towards the corners.
    drawDim(ctx) {
        ctx.fillStyle = 'rgba(6, 10, 26, 0.45)'
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0.2 * HEIGHT, WIDTH / 2, HEIGHT / 2, 0.8 * WIDTH)
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
        ctx.fillStyle = vignette
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }
    // The tails (V-notched, lower, behind), then the face with both edges bowed up at the centre, its shadow and rim.
    drawRibbon(ctx, colours) {
        const {x, y, width, height, bow} = this.ribbon, u = hubUnit()
        ctx.fillStyle = colours.tail
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
        face.addColorStop(0, colours.face[0])
        face.addColorStop(1, colours.face[1])
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
        ctx.strokeStyle = colours.rim
        ctx.lineWidth = 0.18 * u
        ctx.stroke()
    }
    // The lesson's medallion as on its tutorial card; on a defeat its picture is grey and darker.
    drawMedallion(ctx, lesson, grey) {
        const {x, y, radius} = this.medallion
        menu.tutorial.drawMedallion(ctx, x, y, radius, hubUnit())
        if (!lesson)
            return
        ctx.save()
        if (grey)
            ctx.filter = 'grayscale(1) brightness(0.8)'
        menu.tutorial.drawMedallionImage(ctx, lesson.id, x, y, radius)
        ctx.restore()
    }
    // The defeat badge: a red disc with a dark cross.
    drawCrossBadge(ctx) {
        const {x, y, radius: r} = this.badge
        const fill = ctx.createRadialGradient(x - 0.3 * r, y - 0.4 * r, 0, x, y, r)
        fill.addColorStop(0, '#e07a6a')
        fill.addColorStop(1, '#8a2a22')
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.save()
        ctx.strokeStyle = '#2a0e08'
        ctx.lineWidth = 0.22 * r
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x - 0.35 * r, y - 0.35 * r)
        ctx.lineTo(x + 0.35 * r, y + 0.35 * r)
        ctx.moveTo(x + 0.35 * r, y - 0.35 * r)
        ctx.lineTo(x - 0.35 * r, y + 0.35 * r)
        ctx.stroke()
        ctx.restore()
    }
    // A gold five-point star, inner radius 0.45 of the outer.
    drawStar(ctx, {x, y, radius}) {
        ctx.beginPath()
        for (let i = 0; i < 10; i++) {
            const angle = -Math.PI / 2 + i * Math.PI / 5, length = i % 2 ? 0.45 * radius : radius
            ctx.lineTo(x + length * Math.cos(angle), y + length * Math.sin(angle))
        }
        ctx.closePath()
        ctx.fillStyle = TutorialCardsTree.CARD.gold
        ctx.fill()
    }
}
