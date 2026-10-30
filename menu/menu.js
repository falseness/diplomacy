function menuClick(event) {
    let pos = getEventPos(event)
    menu.click(pos)
}

function menuWheel(event) {
    if (event.ctrlKey)
        return
    menu.wheel(getEventPos(event), event.deltaY, event.deltaX)
}
// Hover feedback on the main screen's banners and icon buttons.
function menuMouseMove(event) {
    menu.mouseMove(getEventPos(event))
}
function menuKeyDown(event) {
    menu.keydown(event)
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
// Every entry into a game waits for the game sprites (render/loadassets.js whenGameSpritesReady).
function start(_slot) {
    let game_mode = menu.previousTree
    return whenGameSpritesReady(() => {
        gameSlot = _slot
        GameManager.start(game_mode.selectedMap, game_mode.isFogOfWar, game_mode.isDynamicTimer)
    })
}
function startAI(_slot) {
    return whenGameSpritesReady(() => {
        gameSlot = _slot
        return GameManager.startAI()
    })
}
function load(_slot) {
    // The save is unpacked into the game's entities, so it waits too.
    return whenGameSpritesReady(() => {
        gameSlot = _slot
        if (!saveManager.load())
            return
        GameManager.load()
    })
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
    // Scrollable buttons (the save slot list) scroll on desktop by wheel and arrow keys.
    wheel(pos, deltaY, deltaX) {
        for (const button of this.buttons) button.wheel?.(pos, deltaY, deltaX)
    }
    scrollKey(key) {
        for (const button of this.buttons) button.scrollKey?.(key)
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
    // Rows form a two-column grid: labels left-aligned at one x, boxes in one column to their right.
    // The rows and the back button below them are scaled to fit between the logo and the screen bottom.
    LABELS = ['always display hp bar', 'always display moves bar', 'move camera to undo target',
        'use polished sprites', 'autoscout (online fog)', 'Atmospheric visuals', 'Animations', "Replay others' moves"]
    BACK_HEIGHT = HEIGHT * 0.1
    FIRST_Y = Math.max(HEIGHT * 0.27, HEIGHT * 0.17 + WIDTH * 0.055)
    INTERVAL_Y = Math.min(HEIGHT * 0.08,
        (HEIGHT * 0.97 - this.BACK_HEIGHT - this.FIRST_Y) / (this.LABELS.length + 0.25))
    constructor() {
        const count = this.LABELS.length
        const intervalY = this.INTERVAL_Y
        let rectSize = Math.min(menuOptions.rectSize, intervalY * 0.7)
        let fontSize = Math.min(menuOptions.fontSize, intervalY * 0.7)
        const labels = this.LABELS.map(label => new Text(NaN, NaN, fontSize, label, MENU_THEME.text, 'left'))
        // The main canvas context does not exist yet when the menu is built; measure as Text draws.
        const measureCtx = document.createElement('canvas').getContext('2d')
        const measure = () => Math.max(...labels.map(text => {
            measureCtx.font = text.fontSize + 'px Times New Roman'
            return measureCtx.measureText(text.text).width
        }))
        let labelWidth = measure()
        // Shrink the whole grid if it would not fit the screen width.
        const fit = WIDTH * 0.92 / (labelWidth + 1.5 * rectSize)
        if (fit < 1) {
            rectSize *= fit
            fontSize *= fit
            labels.forEach(text => text.fontSize = fontSize)
            labelWidth = measure()
        }
        const gap = rectSize * 0.5
        const labelX = (WIDTH - labelWidth - gap - rectSize) / 2
        const boxX = labelX + labelWidth + gap
        const cornerR = rectSize * 0.1
        const strokeWidth = Math.min(menuOptions.checkBox.strokeWidth, rectSize * 0.06)
        const boxes = labels.map((text, i) => {
            const box = new ImageCheckBox('checkMark', text, gap,
                boxX, this.FIRST_Y + (i + 0.5) * intervalY, rectSize, rectSize,
                [cornerR, cornerR, cornerR, cornerR], strokeWidth, menuOptions.checkBox.color)
            text.textAlign = 'left'
            text.x = labelX
            return box
        })
        this.rowsBottom = this.FIRST_Y + count * intervalY
        ;[this.hpBarCheckBox, this.movesBarCheckBox, this.undoCheckBox, this.polishedSpritesCheckBox,
            this.autoscoutCheckBox, this.atmosphericVisualsCheckBox, this.animationsCheckBox, this.replayCheckBox] = boxes

        this.buttons = []
        this.buttons.push(...boxes)
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        let y = this.rowsBottom + this.INTERVAL_Y * 0.25
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
        let usePolishedSprites = otherSettings.usePolishedSprites
        const atmosphericVisuals = otherSettings.atmosphericVisuals
        otherSettings.alwaysDisplayHPBar = this.hpBarCheckBox.mark
        otherSettings.alwaysDisplayMovesBar = this.movesBarCheckBox.mark
        otherSettings.moveCameraToUndoTarget = this.undoCheckBox.mark
        otherSettings.usePolishedSprites = this.polishedSpritesCheckBox.mark
        otherSettings.autoscout = this.autoscoutCheckBox.mark
        otherSettings.atmosphericVisuals = this.atmosphericVisualsCheckBox.mark
        // 'Animations' is the move slide, the attack effects and the heal effects (an old save with one of them off shows
        // unchecked); off ends running ones at once. 'Replay others' moves' is ignored (greyed, not clickable) while it is off.
        if (this.animationsCheckBox.mark !== (otherSettings.animateMoves && otherSettings.animateAttacks && otherSettings.animateHeals)) {
            otherSettings.animateMoves = otherSettings.animateAttacks = otherSettings.animateHeals = this.animationsCheckBox.mark
            if (!this.animationsCheckBox.mark) {
                if (typeof moveTween !== 'undefined')
                    moveTween.clear()
                if (typeof attackFx !== 'undefined')
                    attackFx.clear()
                if (typeof healFx !== 'undefined')
                    healFx.clear()
            }
        }
        otherSettings.replayOthers = this.replayCheckBox.mark
        this.replayCheckBox.disabled = !this.animationsCheckBox.mark
        if (atmosphericVisuals !== otherSettings.atmosphericVisuals && grid) {
            // Rebuild the board display on the next frame, without changing game state.
            grid.surfaceCacheState = undefined
        }

        if (usePolishedSprites != otherSettings.usePolishedSprites ||
            atmosphericVisuals !== otherSettings.atmosphericVisuals)
            loadSprites()

        saveOtherSettings()
    }
    __updateButtonsByOtherSettings() {
        this.hpBarCheckBox.mark = otherSettings.alwaysDisplayHPBar
        this.movesBarCheckBox.mark = otherSettings.alwaysDisplayMovesBar
        this.undoCheckBox.mark = otherSettings.moveCameraToUndoTarget
        this.polishedSpritesCheckBox.mark = otherSettings.usePolishedSprites
        this.autoscoutCheckBox.mark = otherSettings.autoscout
        this.atmosphericVisualsCheckBox.mark = otherSettings.atmosphericVisuals
        this.animationsCheckBox.mark = otherSettings.animateMoves && otherSettings.animateAttacks && otherSettings.animateHeals
        this.replayCheckBox.mark = otherSettings.replayOthers
        this.replayCheckBox.disabled = !this.animationsCheckBox.mark
    }
    draw(ctx) {
        this.__updateButtonsByOtherSettings()
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
    }
}

// The settings sliders' arrow click targets: 10% of HEIGHT, at most 5.5% of WIDTH (4:3 screens), so the players
// arrows stay clear of the value between them.
function menuArrowSize() {
    const side = Math.min(HEIGHT * 0.1, WIDTH * 0.055)
    return {width: side, height: side}
}

// The game setup screens' unit (create-game concept, assets/concepts/create-game): min(1% of the width, 1.6% of the
// height), 14.4 px at 1440x900 where the screens are the concept exactly; the concept's 100 x 62.5 unit block fits
// every landscape screen and shrinks as a whole on short ones.
function setupUnit() {
    return Math.min(0.01 * WIDTH, 0.016 * HEIGHT)
}

// The concept's measurements in setup units (create-game-concept.html, desktop rules); text heights are the line boxes
// of its Alegreya Sans fonts at 1440x900.
const SETUP = {
    padding: 1.4, gap: 1.2, logoHeight: 5.6, logoAspect: 756 / 163, titleGap: 0.2, titleHeight: 2.92,
    panelWidth: 76, panelPadX: 1.8, panelPadY: 1.4, panelGap: 1, labelHeight: 1.74,
    cardGap: 1.2, cardPadX: 1.2, cardPadY: 0.9, badge: 4.4, cardGapX: 1.1, check: 2.2,
    cardNameTop: 2.153, cardNameHeight: 2.57, cardSubtitleTop: 2.708, cardSubtitleHeight: 1.458,
    rowGap: 0.7, rowPadX: 1.1, rowPadY: 0.4, iconColumn: 3, icon: 2.2, rowGapX: 1, nameHeight: 2.145, hintHeight: 1.667,
    arrow: 3, valueWidth: 17, stepperGap: 0.6, switchWidth: 6, switchHeight: 3.2, switchMargin: 3.8,
    buttonHeight: 4.6, buttonGap: 2, primaryWidth: 17.6, backWidth: 10.5,
    // Font sizes in units; never below the menu's smallest readable size (1.6% of HEIGHT).
    fonts: {title: 2.4, label: 1.5, cardName: 2.2, cardSubtitle: 1.5, name: 1.95, hint: 1.4, value: 2.1, valueSub: 1.35,
        switchLabel: 1.15, button: 2},
}

// The boxes of the setup screen with rowCount setting rows, in pixels for the current WIDTH x HEIGHT: the concept at
// 1440x900 scaled by setupUnit() / 14.4 about the screen's centre. Logo and title on top, the panel centred between them
// and the buttons (the 'MODE' and 'SETTINGS' labels, two mode cards, the rows), the primary and back buttons at the
// bottom. Every row has the boxes of both controls (a stepper: arrows and value box; a switch); the name and hint end
// before the stepper, so the controls form one right-aligned column.
function setupLayout(rowCount) {
    const s = SETUP, u = setupUnit(), left = WIDTH / 2 - 50 * u, top = HEIGHT / 2 - 31.25 * u
    const box = (x, y, width, height) => ({x: left + x * u, y: top + y * u, width: width * u, height: height * u})
    const fonts = {}
    for (const [name, size] of Object.entries(s.fonts)) fonts[name] = Math.max(size * u, 0.016 * HEIGHT)
    const logoWidth = s.logoHeight * s.logoAspect, logoX = 50 - logoWidth / 2, titleY = s.padding + s.logoHeight + s.titleGap
    const buttonsY = 62.5 - s.padding - s.buttonHeight
    const rowHeight = 2 * s.rowPadY + s.nameHeight + s.hintHeight, cardHeight = s.badge + 2 * s.cardPadY
    const panelHeight = 2 * s.panelPadY + 2 * s.labelHeight + 3 * s.panelGap + cardHeight +
        rowCount * rowHeight + Math.max(rowCount - 1, 0) * s.rowGap
    const freeTop = titleY + s.titleHeight + s.gap, freeBottom = buttonsY - s.gap
    const panelX = 50 - s.panelWidth / 2, panelY = (freeTop + freeBottom - panelHeight) / 2
    const innerX = panelX + s.panelPadX, innerWidth = s.panelWidth - 2 * s.panelPadX
    let y = panelY + s.panelPadY
    const modeLabel = box(innerX, y, innerWidth, s.labelHeight)
    y += s.labelHeight + s.panelGap
    const cardWidth = (innerWidth - s.cardGap) / 2, cardCentre = y + cardHeight / 2
    const modes = [0, 1].map(i => {
        const x = innerX + i * (cardWidth + s.cardGap), checkX = x + cardWidth - s.cardPadX - s.check
        const textX = x + s.cardPadX + s.badge + s.cardGapX, textWidth = checkX - s.cardGapX - textX
        const nameY = cardCentre - s.cardNameTop
        return {card: box(x, y, cardWidth, cardHeight), badge: box(x + s.cardPadX, y + s.cardPadY, s.badge, s.badge),
            name: box(textX, nameY, textWidth, s.cardNameHeight),
            subtitle: box(textX, nameY + s.cardSubtitleTop, textWidth, s.cardSubtitleHeight),
            check: box(checkX, cardCentre - s.check / 2, s.check, s.check)}
    })
    y += cardHeight + s.panelGap
    const settingsLabel = box(innerX, y, innerWidth, s.labelHeight)
    y += s.labelHeight + s.panelGap
    const right = innerX + innerWidth - s.rowPadX, stepperX = right - 2 * s.arrow - 2 * s.stepperGap - s.valueWidth
    const textX = innerX + s.rowPadX + s.iconColumn + s.rowGapX, textWidth = stepperX - s.rowGapX - textX
    const rows = []
    for (let i = 0; i < rowCount; ++i, y += rowHeight + s.rowGap) {
        const centre = y + rowHeight / 2
        rows.push({row: box(innerX, y, innerWidth, rowHeight),
            icon: box(innerX + s.rowPadX, centre - s.icon / 2, s.icon, s.icon),
            name: box(textX, y + s.rowPadY, textWidth, s.nameHeight),
            hint: box(textX, y + s.rowPadY + s.nameHeight, textWidth, s.hintHeight),
            leftArrow: box(stepperX, centre - s.arrow / 2, s.arrow, s.arrow),
            value: box(stepperX + s.arrow + s.stepperGap, y + s.rowPadY, s.valueWidth, rowHeight - 2 * s.rowPadY),
            rightArrow: box(right - s.arrow, centre - s.arrow / 2, s.arrow, s.arrow),
            switch: box(right - s.switchMargin - s.switchWidth, centre - s.switchHeight / 2, s.switchWidth, s.switchHeight)})
    }
    const buttonsX = 50 - (s.primaryWidth + s.buttonGap + s.backWidth) / 2
    return {unit: u, fonts, block: box(0, 0, 100, 62.5),
        logo: box(logoX, s.padding, logoWidth, s.logoHeight), title: box(logoX, titleY, logoWidth, s.titleHeight),
        panel: box(panelX, panelY, s.panelWidth, panelHeight), modeLabel, settingsLabel, modes, rows,
        primary: box(buttonsX, buttonsY, s.primaryWidth, s.buttonHeight),
        back: box(buttonsX + s.primaryWidth + s.buttonGap, buttonsY, s.backWidth, s.buttonHeight)}
}

// The setup controls' colours beyond HUB_CARD and MENU_THEME (create-game concept CSS), and the opacity of a mode card
// that is not selected and of a stepper arrow at its limit.
const SETUP_STYLE = {
    cardRim: 'rgba(201, 154, 78, 0.35)', glow: 'rgba(242, 180, 90, 0.35)',
    warm: ['rgba(242, 180, 90, 0.22)', 'rgba(242, 180, 90, 0.05)'], checkRing: 'rgba(255, 255, 255, 0.35)',
    arrow: ['#2f3c63', '#161f3d'], switchOff: '#141c36', switchRim: 'rgba(201, 154, 78, 0.6)', knobOff: '#6f6a7e',
    knobOn: '#1a2342', unselectedAlpha: 0.6, limitAlpha: 0.35,
    panel: 'rgba(12, 18, 40, 0.62)', panelRim: 'rgba(201, 154, 78, 0.55)', row: 'rgba(255, 255, 255, 0.045)',
    error: '#ff9d8f',
}

// A setup font of size pixels (setupLayout's fonts), in the menu family or the small-caps title family.
function setupFont(size, weight, title = false) {
    return `${weight} ${size}px ${title ? Text.titleFamily : Text.defaultFamily}`
}

// A rim of width lineWidth inside the rounded box (the concept's inset box-shadow).
function setupInsetRim(ctx, box, radius, lineWidth, color) {
    const inset = lineWidth / 2
    ctx.save()
    ctx.beginPath()
    new Rect(box.x + inset, box.y + inset, box.width - lineWidth, box.height - lineWidth,
        Array(4).fill(Math.max(0, radius - inset))).drawShape(ctx)
    ctx.closePath()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
    ctx.restore()
}

// A mode card of the setup screens (create-game concept): the hub badge, the name in small caps, a one-line subtitle and
// a check circle. The selected card has a gold rim, a warm gradient, a soft gold glow and a filled gold check with a dark
// tick; the other is drawn at 60% opacity with a light tick in a ring. Clicking the card calls clickFunc (with callThis).
class SetupModeCard {
    selected = false
    constructor(mode, name, subtitle, clickFunc, callThis) {
        this.mode = mode
        this.name = name
        this.subtitle = subtitle
        this.clickFunc = clickFunc
        this.callThis = callThis
    }
    // box: one of setupLayout(n).modes; layout: that setupLayout result.
    place(box, layout) {
        this.boxes = box
        this.unit = layout.unit
        this.fonts = layout.fonts
    }
    get rect() {
        return this.boxes.card
    }
    get alpha() {
        return this.selected ? 1 : SETUP_STYLE.unselectedAlpha
    }
    isInside(pos) {
        return Rect.prototype.isInside.call(this.rect, pos)
    }
    select(pos) {}
    removeSelect() {}
    // On two lines: server/loadGameCode.js rewrites a one-line touchmove(pos) {} into a global.touchmove call.
    touchmove(pos) {
    }
    click(pos) {
        if (!this.isInside(pos)) return false
        this.clickFunc.call(this.callThis, this.mode)
        return true
    }
    draw(ctx) {
        const {card, badge, name, subtitle, check} = this.boxes, u = this.unit, radius = 0.9 * u
        ctx.save()
        ctx.globalAlpha = this.alpha
        if (this.selected) {
            ctx.shadowColor = SETUP_STYLE.glow
            ctx.shadowBlur = 1.4 * u
        }
        hubFillRounded(ctx, card, radius, HUB_CARD.glass)
        ctx.shadowColor = 'transparent'
        if (this.selected) {
            const warm = ctx.createLinearGradient(card.x, 0, card.x + card.width, 0)
            warm.addColorStop(0, SETUP_STYLE.warm[0])
            warm.addColorStop(0.7, SETUP_STYLE.warm[1])
            warm.addColorStop(1, SETUP_STYLE.warm[1])
            hubFillRounded(ctx, card, radius, warm)
        }
        setupInsetRim(ctx, card, radius, (this.selected ? 0.25 : 0.12) * u, this.selected ? HUB_CARD.gold : SETUP_STYLE.cardRim)
        hubDrawBadge(ctx, this.mode, badge.x + badge.width / 2, badge.y + badge.height / 2, badge.width, u)
        const nameFont = setupFont(this.fonts.cardName, 800, true), subtitleFont = setupFont(this.fonts.cardSubtitle, 400)
        ctx.font = nameFont
        hubText(ctx, hubEllipsis(ctx, this.name, name.width), name.x, name.y + name.height / 2, nameFont, MENU_THEME.text)
        ctx.font = subtitleFont
        // Lighter than the concept's dim grey: readable (contrast >= 4.5) on the dimmed card too.
        hubText(ctx, hubEllipsis(ctx, this.subtitle, subtitle.width), subtitle.x, subtitle.y + subtitle.height / 2,
            subtitleFont, HUB_CARD.chipText)
        const cx = check.x + check.width / 2, cy = check.y + check.height / 2, r = check.width / 2
        if (this.selected) {
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fillStyle = HUB_CARD.gold
            ctx.fill()
            hubDrawIcon(ctx, 'check', cx, cy, 0.62 * check.width, HUB_CARD.darkText, 3)
        } else {
            ctx.beginPath()
            ctx.arc(cx, cy, r - 0.075 * u, 0, Math.PI * 2)
            ctx.strokeStyle = SETUP_STYLE.checkRing
            ctx.lineWidth = 0.15 * u
            ctx.stroke()
            hubDrawIcon(ctx, 'check', cx, cy, 0.62 * check.width, MENU_THEME.text, 3)
        }
        ctx.restore()
    }
}

// An ON/OFF pill switch in a setup row: an ImageCheckBox (mark, click(pos)) drawn as the concept's switch, gold with
// 'on' and a dark knob at the right when marked, dark with a grey knob at the left and 'off' when not. The click rect
// is the pill's box.
class SetupSwitch extends ImageCheckBox {
    constructor(mark = false) {
        super('checkMark', new Text(0, 0, 1, ''), 0, 0, 0, 0, 0)
        this.mark = mark
    }
    // box: a row's switch box of setupLayout(n); layout: that setupLayout result.
    place(box, layout) {
        Object.assign(this, {x: box.x, y: box.y, width: box.width, height: box.height})
        this.cornerRadius = Array(4).fill(box.height / 2)
        this.selectedRect = this
        this.unit = layout.unit
        this.fonts = layout.fonts
        this.trimText()
    }
    draw(ctx) {
        const u = this.unit, w = this.width, h = this.height, r = h / 2
        ctx.save()
        if (this.mark) {
            const fill = ctx.createLinearGradient(0, this.y, 0, this.y + h)
            fill.addColorStop(0, HUB_CARD.button[0])
            fill.addColorStop(1, HUB_CARD.button[1])
            hubFillRounded(ctx, this, r, fill)
        } else {
            hubFillRounded(ctx, this, r, SETUP_STYLE.switchOff)
            setupInsetRim(ctx, this, r, 0.16 * u, SETUP_STYLE.switchRim)
        }
        const knobWidth = 2.45 * u, knobHeight = 0.76 * h
        const knobX = this.mark ? this.x + w - 0.07 * w - knobWidth / 2 : this.x + 0.07 * w + knobWidth / 2
        ctx.beginPath()
        ctx.ellipse(knobX, this.y + 0.12 * h + knobHeight / 2, knobWidth / 2, knobHeight / 2, 0, 0, Math.PI * 2)
        ctx.fillStyle = this.mark ? SETUP_STYLE.knobOn : SETUP_STYLE.knobOff
        ctx.fill()
        const font = setupFont(this.fonts.switchLabel, 800, true)
        if (this.mark) hubText(ctx, 'on', this.x + 0.15 * w, this.centerY, font, HUB_CARD.darkText)
        else hubText(ctx, 'off', this.x + w - 0.13 * w, this.centerY, font, HUB_CARD.dim, 'right')
        ctx.restore()
    }
}

// Places a MenuSlider in a setup row (setupLayout(n).rows[i]) as the concept's stepper: its arrows on the row's arrow
// boxes (round navy buttons with a gold rim and a chevron), its value centred in the value box, under it the muted sub
// line or the seat dots (player colours); sub and dots are values or functions of slider.value. label maps the slider's
// text to the drawn value (map names start in lower case).
function setupPlaceStepper(slider, row, layout, {sub = null, dots = null, label = null} = {}) {
    for (const [button, box] of [[slider.leftButton, row.leftArrow], [slider.rightButton, row.rightArrow]]) {
        Object.assign(button.rect, {x: box.x, y: box.y, width: box.width, height: box.height})
        button.img.pos = button.rect.center
    }
    slider.text.pos = {x: row.value.x + row.value.width / 2, y: row.value.y + row.value.height / 2}
    slider.text.fontSize = layout.fonts.value
    slider.setup = {value: row.value, unit: layout.unit, fonts: layout.fonts, sub, dots, label}
}

// The opacity of a stepper arrow: dim at the slider's limit (it still has its click rect; a click changes nothing).
function setupArrowAlpha(arrow) {
    return arrow.canClick ? 1 : SETUP_STYLE.limitAlpha
}

function setupDrawArrow(ctx, arrow, u) {
    const {x, y} = arrow.rect.center, r = Math.min(arrow.rect.width, arrow.rect.height) / 2
    ctx.save()
    ctx.globalAlpha = setupArrowAlpha(arrow)
    const fill = ctx.createRadialGradient(x - 0.3 * r, y - 0.4 * r, 0, x, y, r)
    fill.addColorStop(0, SETUP_STYLE.arrow[0])
    fill.addColorStop(1, SETUP_STYLE.arrow[1])
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r - 0.08 * u, 0, Math.PI * 2)
    ctx.strokeStyle = MENU_THEME.plain.rim
    ctx.lineWidth = 0.16 * u
    ctx.stroke()
    hubDrawIcon(ctx, arrow.direction < 0 ? 'left' : 'right', x, y, r, MENU_THEME.text, 3)
    ctx.restore()
}

// A MenuSlider placed by setupPlaceStepper: both arrows, the value (cut to the value box) and its sub line or seat dots,
// the block centred in the value box.
function setupDrawStepper(ctx, slider) {
    const {value: box, unit: u, fonts} = slider.setup
    setupDrawArrow(ctx, slider.leftButton, u)
    setupDrawArrow(ctx, slider.rightButton, u)
    const of = v => typeof v === 'function' ? v(slider.value) : v
    const sub = of(slider.setup.sub), dots = of(slider.setup.dots) ?? []
    const line = 1.05 * fonts.value, extra = sub ? 1.05 * fonts.valueSub : dots.length ? 1.35 * u : 0
    const top = box.y + (box.height - line - extra) / 2, cx = box.x + box.width / 2
    const valueFont = setupFont(fonts.value, 500)
    ctx.font = valueFont
    // The slider's text box stays on the drawn value (layout checks read it): its line is above a sub line or dots.
    slider.text.y = top + line / 2
    const text = slider.setup.label ? slider.setup.label(slider.text.text) : slider.text.text
    hubText(ctx, hubEllipsis(ctx, text, box.width), cx, top + line / 2, valueFont, MENU_THEME.text, 'center')
    if (sub) {
        const subFont = setupFont(fonts.valueSub, 400)
        ctx.font = subFont
        hubText(ctx, hubEllipsis(ctx, sub, box.width), cx, top + line + extra / 2, subFont, HUB_CARD.dim, 'center')
    } else if (dots.length) {
        // 0.35 u apart, closer when that would leave the value box (12 co-op seats).
        const step = Math.min(1.45 * u, (box.width - 1.1 * u) / Math.max(dots.length - 1, 1))
        const width = (dots.length - 1) * step + 1.1 * u
        dots.forEach((colour, i) => hubDrawDot(ctx, cx - width / 2 + 0.55 * u + i * step, top + line + 0.8 * u, colour, u, 1.1))
    }
}

// The two mode cards of a setup screen as one control (the competitive card, then co-op): clicking the card of the
// other mode calls clickFunc (with callThis) with its mode; clicking the selected card does nothing.
class SetupModeCards {
    constructor(clickFunc, callThis) {
        this.cards = [new SetupModeCard('competitive', 'Competitive', 'Every player for themselves', clickFunc, callThis),
            new SetupModeCard('co-op', 'Co-op', 'Together against the AI', clickFunc, callThis)]
    }
    // The card of the selected mode.
    get selected() {
        return this.cards.find(card => card.selected)
    }
    setMode(isCoop) {
        this.cards.forEach((card, i) => card.selected = (i === 1) === isCoop)
    }
    // layout: a setupLayout result; each card's click rect is a Rect of its card box.
    place(layout) {
        this.cards.forEach((card, i) => {
            const {x, y, width, height} = layout.modes[i].card
            card.place({...layout.modes[i], card: new Rect(x, y, width, height)}, layout)
        })
    }
    click(pos) {
        const card = this.cards.find(card => card.isInside(pos))
        if (!card) return false
        if (!card.selected) card.click(pos)
        return true
    }
    select(pos) {}
    removeSelect() {}
    // On two lines: server/loadGameCode.js rewrites a one-line touchmove(pos) {} into a global.touchmove call.
    touchmove(pos) {
    }
    draw(ctx) {
        for (const card of this.cards) card.draw(ctx)
    }
}

// A setup row's background, icon, name and one-line hint (create-game concept): row is one of setupLayout(n).rows.
function setupDrawRow(ctx, row, layout, icon, name, hint) {
    const u = layout.unit, fonts = layout.fonts
    hubFillRounded(ctx, row.row, 0.8 * u, SETUP_STYLE.row)
    hubDrawIcon(ctx, icon, row.icon.x + row.icon.width / 2, row.icon.y + row.icon.height / 2, row.icon.width, HUB_CARD.icon)
    const nameFont = setupFont(fonts.name, 500), hintFont = setupFont(fonts.hint, 400)
    ctx.font = nameFont
    hubText(ctx, hubEllipsis(ctx, name, row.name.width), row.name.x, row.name.y + row.name.height / 2, nameFont, MENU_THEME.text)
    ctx.font = hintFont
    hubText(ctx, hubEllipsis(ctx, hint, row.hint.width), row.hint.x, row.hint.y + row.hint.height / 2, hintFont, HUB_CARD.dim)
}

// Small-caps text with the concept's letter spacing (em) where the canvas supports it.
function setupSpacedText(ctx, text, x, y, font, color, spacing, align = 'left') {
    ctx.save()
    ctx.font = font
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * parseFloat(font.split(' ')[1])}px`
    hubText(ctx, text, x, y, font, color, align)
    ctx.restore()
}

// A setup screen's frame (create-game concept): the title under the logo, the panel (translucent navy, thin gold rim)
// and its 'MODE' and 'SETTINGS' labels.
function setupDrawFrame(ctx, layout, title) {
    const {title: titleBox, panel, modeLabel, settingsLabel, unit: u, fonts} = layout
    setupSpacedText(ctx, title, titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2,
        setupFont(fonts.title, 800, true), HUB_CARD.round, 0.08, 'center')
    hubFillRounded(ctx, panel, 1.1 * u, SETUP_STYLE.panel)
    setupInsetRim(ctx, panel, 1.1 * u, 0.14 * u, SETUP_STYLE.panelRim)
    const labelFont = setupFont(fonts.label, 800, true)
    for (const [label, box] of [['Mode', modeLabel], ['Settings', settingsLabel]])
        setupSpacedText(ctx, label, box.x, box.y + box.height / 2, labelFont, HUB_CARD.dim, 0.08)
}

function CreateMapSlider(firstY, intervalY, fontSize, slidePosX) {
    let minimumValueMap = function() { return 0 }
    let maximumValueMap = function() { return dictionaryLength(maps) - 1 }
    let getKeyMap = function(value) { return getKeyByIndexDictionary(maps, value) }
    let sliderMarginX = WIDTH * 0.18
    return new MenuSlider(minimumValueMap, maximumValueMap, getKeyMap, undefined,
        0, sliderMarginX,
    new Text(slidePosX, firstY + intervalY, fontSize, undefined, MENU_THEME.text),
            menuArrowSize())

}

class GameSettingsTree {
    isOnline = false
    constructor(_menu) {
        // As on a 16:9 screen when wider, so the first row's check box stays clear of the logo.
        const rectSize = Math.min(WIDTH, HEIGHT * 16 / 9) * 0.05
        const cornerR = rectSize * 0.1
        const marginLeft = rectSize * 0.5
        /*const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.15*/
        const firstY = HEIGHT * 0.3
        let intervalY = HEIGHT * 0.12

        const posX = WIDTH * 0.5

        // Capped by the height: on wide screens the first row would reach up into the logo.
        const fontSize = Math.min(0.04 * WIDTH, 0.075 * HEIGHT)
        this.playersText = new Text(posX - Menu.getButton().width / 2,
            firstY, fontSize, 'players', MENU_THEME.text, 'left')

        const slidePosX = posX + WIDTH * 0.1

        this.mapSlider = CreateMapSlider(firstY, intervalY, fontSize, slidePosX)

        let minimumValuePlayers = function() { return 0 }
        let maximumValuePlayers = function(mapSlider) { return maps[mapSlider.realValue].length - 1}
        let getKeyPlayers = function(value) { return value + 2 }
        this.playersSlider = new MenuSlider(minimumValuePlayers, maximumValuePlayers,
            getKeyPlayers, this.mapSlider,
            0, WIDTH * 0.04,
        new Text(slidePosX, firstY, fontSize, undefined, MENU_THEME.text),
                menuArrowSize())


        this.mapText = new Text(this.mapSlider.leftButton.x - HEIGHT * 0.2,
            firstY + intervalY, fontSize, 'map', MENU_THEME.text, 'left')


        this.fogOfWarCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'fog of war', MENU_THEME.text), marginLeft,
            WIDTH * 0.58, firstY + intervalY * 2, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR], menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.timerCheckBox = new ImageCheckBox('checkMark',
            new Text(NaN, NaN, fontSize, 'dynamic timer', MENU_THEME.text), marginLeft,
            WIDTH * 0.61, firstY + intervalY * 3, rectSize, rectSize,
            [cornerR, cornerR, cornerR, cornerR],menuOptions.checkBox.strokeWidth, menuOptions.checkBox.color)

        this.backButton = new Empty()
        //this.fogOfWarCheckBox.toCenterX()

        intervalY -= HEIGHT * 0.01

        this.playButton = Menu.getButton(
            {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: firstY + intervalY * 4}, 'start',
                _menu.setTree, _menu.startGame, true, _menu)
        this.playButton.primary = true

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
        // Mode changes replace the list during a click. Visit the original list once.
        const buttons = this.buttons
        for (let i = 0; i < buttons.length - 1; ++i) {
            ok |= buttons[i].click(pos)
        }
        if (buttons[buttons.length - 1].click(pos)) {
            // map slider click
            this.playersSlider.update()
            ok = true
        }
        return ok
    }
    draw(ctx) {
        this.playersText.draw(ctx)
        this.mapText.draw(ctx)
        if (this.isCoop) drawCoopDimensions(this, ctx)
        for (let i = 0; i < this.buttons.length; ++i) {
            this.buttons[i].draw(ctx)
        }
        /*this.fogOfWarCheckBox.draw(ctx)
        this.backButton.draw(ctx)

        this.mapSlider.draw(ctx)*/
    }
}

function drawCoopDimensions(settings, ctx) {
    const {mapSize} = getCoopMapScaling(settings.playersSlider.value, settings.sizeSlider.realValue.toLowerCase())
    new Text(WIDTH * 0.12, HEIGHT * 0.18, WIDTH * 0.04, 'size', MENU_THEME.text, 'left').draw(ctx)
    settings.dimensionsText = new Text(WIDTH * 0.6, HEIGHT * 0.23,
        Math.max(HEIGHT * 0.04, WIDTH * 0.022), `${mapSize.x}×${mapSize.y}`, MENU_THEME.mutedText)
    settings.dimensionsText.draw(ctx)
}

// Keep size on its own row above the existing player/seed/options controls.
function createCoopSizeSlider() {
    const side = Math.min(HEIGHT * 0.08, WIDTH * 0.1)
    return new MenuSlider(() => 0, () => 2, value => ['Tiny', 'Normal', 'Big'][value],
        undefined, 1, WIDTH * 0.18,
        new Text(WIDTH * 0.6, HEIGHT * 0.18, WIDTH * 0.04, 'Normal', MENU_THEME.text),
        {width: side, height: side})
}

// Local co-op uses the same fog/timer controls and save-slot flow as hot seat.
class CoopSettingsTree extends GameSettingsTree {
    constructor(_menu, minimumHumans = 1) {
        super(_menu)
        this.playersText.text = 'humans'
        this.playersText.x = this.mapText.x
        this.mapText.text = 'seed'
        this.playersSlider.minimumValue = () => minimumHumans
        this.playersSlider.maximumValue = () => 12
        this.playersSlider.textByValue = value => value
        this.playersSlider.value = 2
        this.playersSlider.update()
        // generateCoopGame accepts seed 0, so the menu can select it too.
        this.mapSlider.minimumValue = () => 0
        this.mapSlider.maximumValue = () => 999
        this.mapSlider.textByValue = value => value
        this.mapSlider.value = 1
        this.mapSlider.update()
        this.sizeSlider = createCoopSizeSlider()
        // Width-bound arrows keep portrait controls clear of labels and values.
        for (const slider of [this.playersSlider, this.mapSlider]) {
            slider.text.color = MENU_THEME.text
            for (const button of [slider.leftButton, slider.rightButton]) {
                button.rect.width = button.rect.height = Math.min(HEIGHT * 0.1, WIDTH * 0.09)
                button.img.width = button.img.height = button.rect.width
            }
        }
        this.playersSlider.marginX = WIDTH * 0.1
        this.playersSlider.trim()
        this.mapSlider.trim()
    }
    get selectedMap() {
        return generateCoopGame(this.playersSlider.value, {seed: this.mapSlider.value, size: this.sizeSlider.realValue.toLowerCase()})
    }
}

// The game setup screens (create-game concept, setupLayout): logo, title, the two mode cards, one row per setting
// (competitive: map, players, fog of war and the screen's own switch; co-op: map size, humans, seed, fog of war and that
// switch) and the primary / 'back' buttons. Each mode keeps its own map/player selection; fog of war and the last switch
// are shared. No BETA tag on these screens.
// setup: title, minimumHumans (co-op), primary (the primary button's label, click function, its parameters and this)
// and option (the last row's switch: property name, control text, row name and hint).
class SetupSettingsTree extends GameSettingsTree {
    betaTag = {draw() {}}
    constructor(_menu, setup) {
        super(_menu)
        this.title = setup.title
        this.isCoop = false
        this.competitiveSliders = {players: this.playersSlider, map: this.mapSlider}
        const coop = new CoopSettingsTree(_menu, setup.minimumHumans)
        this.coopSliders = {players: coop.playersSlider, map: coop.mapSlider, size: coop.sizeSlider}
        this.fogOfWarCheckBox = new SetupSwitch()
        this.fogOfWarCheckBox.text.text = 'fog of war'
        const {key, text, name, hint} = setup.option, option = this[key] = new SetupSwitch()
        option.text.text = text
        this.optionRow = {icon: 'clock', name, hint, control: option}
        const {label, clickFunc, parameters, callThis} = setup.primary
        this.playButton = new SetupButton(label, clickFunc, parameters, callThis, true)
        this.modeCards = new SetupModeCards(this.selectMode, this)
        this.dimensionsText = new Text(NaN, NaN, 1, '', HUB_CARD.dim)
        const logo = setupLayout(0).logo
        this.logo = new HaloLogo('logo', {x: logo.x + logo.width / 2, y: logo.y + logo.height / 2}, logo.width, logo.height)
        this.layout()
    }
    // The setting rows of the current mode: icon, name, hint and control (a slider's stepper options too).
    get rowSpecs() {
        const sizeText = size => `${size.x}×${size.y}`
        const fog = {icon: 'fog', name: 'Fog of war', hint: 'See only what your units see', control: this.fogOfWarCheckBox}
        if (this.isCoop) return [
            {icon: 'size', name: 'Map size', hint: 'Generated map', control: this.sizeSlider,
                sub: () => this.dimensionsText.text = sizeText(getCoopMapScaling(this.playersSlider.value,
                    this.sizeSlider.realValue.toLowerCase()).mapSize)},
            {icon: 'people', name: 'Humans', hint: 'Seats for people', control: this.playersSlider,
                dots: humans => Array.from({length: humans}, (_, i) => {
                    const {r, g, b} = coopPlayerColor(i + 1)
                    return rgbToHex(r, g, b)
                })},
            {icon: 'seed', name: 'Seed', hint: 'Same seed, same map', control: this.mapSlider},
            fog, this.optionRow]
        const variant = () => maps[this.mapSlider.realValue][this.playersSlider.value]
        return [
            {icon: 'map', name: 'Map', hint: `${dictionaryLength(maps)} maps`, control: this.mapSlider, label: hubTitle,
                sub: () => sizeText(variant().mapSize)},
            {icon: 'people', name: 'Players', hint: 'Seats in this game', control: this.playersSlider,
                dots: () => variant().players.slice(1).map(({rgb}) => rgbToHex(rgb.r, rgb.g, rgb.b))},
            fog, this.optionRow]
    }
    // Places every control of the current mode on setupLayout; playersText and mapText name the players/humans and
    // map/seed rows, dimensionsText is the size row's sub line.
    layout() {
        this.rows = this.rowSpecs
        const layout = this.setup = setupLayout(this.rows.length)
        this.modeCards.setMode(this.isCoop)
        this.modeCards.place(layout)
        this.rows.forEach((spec, i) => {
            const row = spec.box = layout.rows[i]
            if (spec.control instanceof SetupSwitch) spec.control.place(row.switch, layout)
            else setupPlaceStepper(spec.control, row, layout, spec)
            const name = spec.control === this.playersSlider ? this.playersText : spec.control === this.mapSlider ? this.mapText : null
            if (name) Object.assign(name, {text: spec.name, x: row.name.x, y: row.name.y + row.name.height / 2,
                fontSize: layout.fonts.name})
            if (spec.control === this.sizeSlider) Object.assign(this.dimensionsText, {x: row.value.x + row.value.width / 2,
                y: row.value.y + row.value.height / 2 + 0.525 * layout.fonts.value, fontSize: layout.fonts.valueSub})
        })
        this.playButton.place(layout.primary, layout)
        if (this.backButton instanceof SetupButton) this.backButton.place(layout.back, layout)
        this.updateButtonsList()
    }
    updateButtonsList() {
        // GameSettingsTree's list with the screen's own switch; the map slider stays last for GameSettingsTree.click's
        // player refresh.
        this.buttons = [this.backButton, this.playButton, this.fogOfWarCheckBox, this.optionRow?.control ?? this.timerCheckBox,
            this.playersSlider, this.mapSlider]
        if (this.modeCards) this.buttons.splice(2, 0, this.modeCards)
        if (this.isCoop) this.buttons.splice(2, 0, this.sizeSlider)
    }
    setParent(parent, _menu) {
        this.backButton = new SetupButton('Back', _menu.setTree, parent, _menu)
        this.layout()
    }
    // A mode card's click: switches to that mode (the other card's; the selected card does not call this).
    selectMode(mode) {
        if ((mode === 'co-op') !== this.isCoop) this.toggleMode()
    }
    toggleMode() {
        this.isCoop = !this.isCoop
        const sliders = this.isCoop ? this.coopSliders : this.competitiveSliders
        this.playersSlider = sliders.players
        this.mapSlider = sliders.map
        this.sizeSlider = sliders.size
        this.layout()
    }
    get selectedMap() {
        return this.isCoop
            ? generateCoopGame(this.playersSlider.value, {seed: this.mapSlider.value, size: this.sizeSlider.realValue.toLowerCase()})
            : super.selectedMap
    }
    draw(ctx) {
        const layout = this.setup
        setupDrawFrame(ctx, layout, this.title)
        for (const spec of this.rows) setupDrawRow(ctx, spec.box, layout, spec.icon, spec.name, spec.hint)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// The hot seat 'new game' screen: 'dynamic timer' is the last row (options/gamestart.js's classic Timer: each turn's
// time from the mover's units, towns and gold, instead of a long clock per player) and 'start' plays the game.
class HotseatSettingsTree extends SetupSettingsTree {
    constructor(_menu) {
        super(_menu, {title: 'New game', minimumHumans: 1,
            primary: {label: 'Start', clickFunc: _menu.setTree, parameters: _menu.startGame, callThis: _menu},
            option: {key: 'timerCheckBox', text: 'dynamic timer', name: 'Dynamic timer',
                hint: 'Turn time from your units, towns and gold'}})
    }
}

// The online game controls of the lobby flow's create-lobby screen: the setup screen with at least 2 co-op humans and
// 'asynchronous moves' as the last row. Online always uses the long timer.
class OnlineGameSettings extends SetupSettingsTree {
    isOnline = true
    constructor(_menu, primary) {
        super(_menu, {title: 'Create game', minimumHumans: 2, primary,
            option: {key: 'asyncMovesCheckBox', text: 'asynchronous moves', name: 'Asynchronous moves',
                hint: 'Each player has their own clock'}})
    }
    get selectedMap() {
        if (this.isCoop && (!Number.isInteger(this.playersSlider.value) || this.playersSlider.value < 2 ||
            this.playersSlider.value > 12))
            throw new RangeError('Online co-op requires 2 to 12 humans')
        return super.selectedMap
    }
    get isDynamicTimer() {
        return false
    }
}

// The lobby flow's 'create game' screen: the online controls without a save-slot picker. 'create game' builds the
// initial online board with GameManager.buildOnlineBoard (without entering the game) and sends it with lobby:create;
// while that is pending the button reads 'creating…' and ignores clicks. A lobby:create error is one line centred just
// above the buttons.
class CreateLobbyTree extends OnlineGameSettings {
    constructor(_menu) {
        super(_menu, {label: 'Create game', clickFunc: CreateLobbyTree.prototype.create})
        this.playButton.callThis = this
        this.menu = _menu
        this.creating = false
        this.errorText = new Text(NaN, NaN, 1, '', SETUP_STYLE.error)
    }
    enter() {
        this.creating = false
        this.errorText.text = ''
    }
    // The slider and checkbox values createLobbyStartOptions maps.
    get controls() {
        return this.isCoop
            ? {isCoop: true, fogOfWar: this.isFogOfWar, humans: this.playersSlider.value,
                seed: this.mapSlider.value, size: this.sizeSlider.realValue}
            : {isCoop: false, fogOfWar: this.isFogOfWar, mapKey: this.mapSlider.realValue,
                variantIndex: this.playersSlider.value}
    }
    get startOptions() {
        return createLobbyStartOptions(this.controls)
    }
    static mapOf(selectedMap) {
        const {coop, mapName, variantIndex} = selectedMap
        return coop ? generateCoopGame(coop.humans, {seed: coop.seed, size: coop.size}) : maps[mapName][variantIndex]
    }
    async create() {
        if (this.creating) return
        this.creating = true
        this.errorText.text = ''
        let ack
        try {
            const options = this.startOptions
            const board = GameManager.buildOnlineBoard(CreateLobbyTree.mapOf(options.selectedMap), options.fog)
            ack = await onlineSession.createLobby(board, options.mapName, this.asyncMovesCheckBox.mark)
        } catch (error) {
            console.error(error)
            ack = {ok: false, error: 'CLIENT_ERROR'}
        }
        this.creating = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.errorText.text = createLobbyErrorText(ack.error)
            return
        }
        this.menu.lobbyRoom.open(ack.lobby)
    }
    // The error line: centred between the panel and the buttons, cut to the panel's width.
    drawError(ctx) {
        if (!this.errorText.text) return
        const {panel, primary, fonts} = this.setup, font = setupFont(fonts.hint, 500)
        ctx.font = font
        const text = hubEllipsis(ctx, this.errorText.text, panel.width)
        Object.assign(this.errorText, {x: WIDTH / 2, y: (panel.y + panel.height + primary.y) / 2, fontSize: fonts.hint})
        hubText(ctx, text, this.errorText.x, this.errorText.y, font, SETUP_STYLE.error, 'center')
    }
    draw(ctx) {
        this.playButton.text.text = this.creating ? 'Creating…' : 'Create game'
        super.draw(ctx)
        this.drawError(ctx)
    }
}

// The lobby room: settings, members in join order (host tagged), 'waiting...' seats,
// 'kick' next to other members and 'start' (enabled when full) for the host, 'leave'.
// Live from lobby:updated; lobby:kicked returns to the hub; lobby:started opens the game.
class LobbyRoomTree {
    static noView = {lobbyId: null, settingsText: '', countText: '', rows: [], isHost: false, kickAccountIds: [],
        start: {visible: false, enabled: false}}
    constructor(_menu) {
        this.menu = _menu
        this.lobby = null
        this.view = LobbyRoomTree.noView
        this.socket = null
        this.busy = false
        this.rowTop = HEIGHT * 0.38
        this.rowHeight = HEIGHT * 0.065
        // Title and count between the logo and the rows; sizes capped by the height for wide screens.
        this.title = new Text(WIDTH / 2, HEIGHT * 0.295, Math.min(0.028 * WIDTH, 0.035 * HEIGHT), '', MENU_THEME.text)
        this.count = new Text(WIDTH / 2, HEIGHT * 0.335, Math.min(0.028 * WIDTH, 0.035 * HEIGHT), '', MENU_THEME.mutedText)
        this.status = new Text(WIDTH / 2, HEIGHT * 0.8, 0.025 * WIDTH, '', MENU_THEME.text)
        this.rowTexts = []
        this.kickButtons = []
        this.leaveButton = Menu.getButton({x: WIDTH * 0.2, y: HEIGHT * 0.85}, 'leave', this.leaveLobby, undefined, true, this)
        this.startButton = Menu.getButton({x: WIDTH * 0.55, y: HEIGHT * 0.85}, 'start', this.startLobby, undefined, true, this)
        this.startButton.primary = true
        this.buttons = [this.leaveButton]
    }
    setParent() {}
    // Opens the room for a lobby I am a member of (lobby:create or lobby:join ack).
    open(lobby) {
        this.listen()
        this.busy = false
        this.status.text = ''
        this.setLobby(lobby)
        this.menu.setTree(this)
    }
    // Room pushes go to this account's sockets; one set of handlers per socket.
    listen() {
        const socket = onlineSession.connect()
        if (this.socket === socket) return
        this.socket = socket
        socket.on('lobby:updated', ({lobby} = {}) => { if (this.socket === socket) this.onUpdated(lobby) })
        socket.on('lobby:kicked', ({lobbyId} = {}) => { if (this.socket === socket) this.onKicked(lobbyId) })
        socket.on('lobby:started', ({lobbyId, gameID} = {}) => { if (this.socket === socket) this.onStarted(lobbyId, gameID) })
    }
    get myAccountId() {
        return onlineSession.account?.accountId ?? null
    }
    isMine(lobbyId) {
        return !!this.lobby && this.lobby.lobbyId === lobbyId
    }
    onUpdated(lobby) {
        // A kicked or departed account may still see its old room's last update.
        if (!lobby || !this.isMine(lobby.lobbyId)) return
        if (!lobby.members.some(member => member.accountId === this.myAccountId)) return
        this.setLobby(lobby)
    }
    onKicked(lobbyId) {
        if (!this.isMine(lobbyId)) return
        this.backToHub(LOBBY_REMOVED_TEXT)
    }
    // The room is done: the hub is behind the game, which opens with game:open.
    onStarted(lobbyId, gameID) {
        if (!this.isMine(lobbyId)) return
        this.backToHub(LOBBY_STARTING_TEXT)
        this.menu.onlineHub.openGame(gameID)
    }
    setLobby(lobby) {
        this.lobby = lobby
        const view = this.view = buildRoomView(lobby, this.myAccountId)
        this.title.text = view.settingsText
        this.count.text = view.countText
        // A row's text fits its row height on wide screens.
        const fontSize = Math.min(0.03 * WIDTH, 0.7 * this.rowHeight)
        this.rowTexts = view.rows.map((row, i) => new Text(WIDTH * 0.3, this.rowTop + (i + 0.5) * this.rowHeight,
            fontSize, row.text, row.kind === 'waiting' ? MENU_THEME.mutedText : MENU_THEME.text, 'left'))
        this.kickButtons = []
        view.rows.forEach((row, i) => {
            if (!row.kick) return
            const rect = Menu.getButtonRect({x: WIDTH * 0.6, y: this.rowTop + (i + 0.1) * this.rowHeight})
            rect.width = WIDTH * 0.12
            rect.height = this.rowHeight * 0.8
            const text = Menu.getButtonText('kick')
            // Low rows (landscape phones) would clip the label.
            text.fontSize = Math.min(fontSize, rect.height * 0.9)
            const button = new MenuButton(rect, text, this.kick, row.accountId, true, this)
            button.accountId = row.accountId
            this.kickButtons.push(button)
        })
        // A disabled start is drawn greyed and ignores clicks.
        this.startButton.canClick = view.start.enabled
        this.buttons = [this.leaveButton, ...this.kickButtons]
        if (view.start.visible) this.buttons.push(this.startButton)
    }
    backToHub(notice = '') {
        this.lobby = null
        this.view = LobbyRoomTree.noView
        this.title.text = this.count.text = this.status.text = ''
        this.rowTexts = []
        this.kickButtons = []
        this.buttons = [this.leaveButton]
        this.menu.onlineHub.notice = notice
        this.menu.setTree(this.menu.onlineHub)
    }
    async request(send) {
        if (this.busy || !this.lobby) return null
        this.busy = true
        const ack = await send(this.lobby.lobbyId)
        this.busy = false
        return this.menu.selectedTree === this ? ack : null
    }
    async leaveLobby() {
        const ack = await this.request(lobbyId => onlineSession.leaveLobby(lobbyId))
        if (!ack) return
        if (ack.ok || ack.error === 'NOT_FOUND' || ack.error === 'NOT_A_MEMBER') this.backToHub()
        else this.status.text = 'could not leave the lobby'
    }
    async kick(accountId) {
        const ack = await this.request(lobbyId => onlineSession.kickFromLobby(lobbyId, accountId))
        if (!ack) return
        if (ack.ok) this.onUpdated(ack.lobby)
        else this.status.text = 'could not kick'
    }
    async startLobby() {
        if (!this.view.start.enabled) return
        this.status.text = LOBBY_STARTING_TEXT
        const ack = await this.request(lobbyId => onlineSession.startLobby(lobbyId))
        if (ack && !ack.ok) this.status.text = ack.error === 'NOT_FULL' ? 'waiting for players' : 'could not start'
    }
    click(pos) {
        for (const button of [...this.buttons]) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.count.draw(ctx)
        for (const text of this.rowTexts) text.draw(ctx)
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
        if (this.view.start.visible && !this.startButton.canClick) this.startButton.drawDisabled(ctx)
    }
}

// Online entry screens: Google sign-in and the signed-in hub with its games and lobbies list.
class SignInTree {
    constructor(_menu) {
        this.menu = _menu
        this.container = null
        this.title = new Text(WIDTH / 2, HEIGHT * 0.33, 0.04 * WIDTH, 'sign in to play online', MENU_THEME.text)
        this.status = new Text(WIDTH / 2, HEIGHT * 0.58, 0.025 * WIDTH, '', MENU_THEME.mutedText)
        this.buttons = []
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.buttons = [Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', _menu.setTree, parent, true, _menu)]
    }
    // Google's button and the wrapping status live only while this screen is shown.
    enter() {
        this.leave()
        const div = this.container = document.createElement('div')
        div.id = 'google-signin'
        div.style.cssText = `position:absolute;left:${WIDTH / 2 / devicePixelRatio}px;` +
            `top:${HEIGHT * 0.43 / devicePixelRatio}px;transform:translateX(-50%);z-index:1`
        // Clicks on Google's button must not reach the canvas menu below it.
        div.addEventListener('click', event => event.stopPropagation())
        document.body.append(div)
        const status = this.statusElement = document.createElement('div')
        status.style.cssText = `position:absolute;left:5%;width:90%;top:${HEIGHT * 0.55 / devicePixelRatio}px;` +
            `text-align:center;font:${menuDomFontSize()}px/1.4 sans-serif;color:${MENU_THEME.mutedText};overflow-wrap:anywhere;pointer-events:none`
        status.setAttribute('role', 'status')
        document.body.append(status)
        this.setStatus('loading Google sign-in…')
        loadGoogleIdentity().then(() => {
            if (this.container !== div) return
            this.setStatus('')
            try {
                renderGoogleButton(div, credential => { if (this.container === div) this.signIn(credential) })
            } catch (error) {
                this.setStatus('Sign-in failed (client): CLIENT_ERROR. Go back and reopen to retry.')
            }
        }, () => {
            if (this.container === div) this.setStatus('Sign-in failed (client-detected Google sign-in): GOOGLE_SCRIPT_LOAD_FAILED. Go back and reopen to retry.')
        })
    }
    setStatus(text) {
        this.status.text = text
        if (this.statusElement) {
            this.statusElement.textContent = text
            // The actionable recovery panel carries the same code and reload guidance.
            this.statusElement.style.visibility = text.includes('RULES_VERSION_MISMATCH') &&
                document.getElementById('online-recovery') ? 'hidden' : 'visible'
        }
    }
    leave() {
        this.attempt = (this.attempt || 0) + 1
        onlineSession.cancelSignIn()
        this.container?.remove()
        this.statusElement?.remove()
        this.container = this.statusElement = null
    }
    async signIn(credential) {
        const attempt = this.attempt = (this.attempt || 0) + 1
        this.setStatus('signing in…')
        let account
        try {
            account = await onlineSession.signInWithGoogle(credential)
        } catch (error) {
            if (attempt === this.attempt) onlineSession.lastSignInError = {source: 'client', code: 'CLIENT_ERROR'}
        }
        if (attempt !== this.attempt || this.menu.selectedTree !== this) return
        if (!account) {
            const error = onlineSession.lastSignInError || {source: 'client', code: 'CLIENT_ERROR'}
            this.setStatus(error.code === 'RULES_VERSION_MISMATCH'
                ? 'Server version mismatch (RULES_VERSION_MISMATCH). Reload the page to sign in.'
                : `Sign-in failed (${error.source}): ${error.code}. Go back and reopen to retry.`)
            return
        }
        document.getElementById('online-recovery')?.remove()
        this.setStatus('')
        this.menu.onlineHub.setAccount(account)
        this.menu.setTree(this.menu.onlineHub)
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// The hub's unit (hub concept: min(1% of the width, 2.3% of the height)); every size of the hub is a multiple of it.
function hubUnit() {
    return Math.min(0.01 * WIDTH, 0.023 * HEIGHT)
}

// The hub's fonts are drawn larger than their sizes in units by this factor: a font unit of min(1.2% of the width,
// 2.3% of the height), so that the smallest font (1.5 units) is 12 px on a 667x375 screen; boxes keep the unit.
function hubFontScale() {
    return Math.min(0.012 * WIDTH, 0.023 * HEIGHT) / hubUnit()
}

// A canvas font of the hub in the menu family, or in the small-caps title family; size in hub units times hubUnit().
function hubFont(size, weight = MENU_THEME.fontWeight, title = false) {
    return `${weight} ${size * hubFontScale()}px ${title ? Text.titleFamily : Text.defaultFamily}`
}

// Draws text at (x, y) on a middle baseline and returns its width.
function hubText(ctx, text, x, y, font, color, align = 'left') {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
    return ctx.measureText(text).width
}

// text cut to maxWidth in ctx's font, ending with an ellipsis: hub texts are never shrunk to fit.
function hubEllipsis(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text
    let fits = 0, over = text.length
    while (over - fits > 1) {
        const middle = (fits + over) >> 1
        if (ctx.measureText(text.slice(0, middle).trimEnd() + '…').width <= maxWidth) fits = middle
        else over = middle
    }
    return fits ? text.slice(0, fits).trimEnd() + '…' : ''
}

// Player names within maxWidth in ctx's font: as many names as fit, then "+N" for the others.
function hubPlayersText(ctx, names, maxWidth) {
    for (let shown = names.length; shown >= 1; --shown) {
        const text = names.slice(0, shown).join(', ') + (shown < names.length ? ' +' + (names.length - shown) : '')
        if (ctx.measureText(text).width <= maxWidth) return text
    }
    const more = names.length > 1 ? ' +' + (names.length - 1) : ''
    return names.length ? hubEllipsis(ctx, names[0], maxWidth - ctx.measureText(more).width) + more : ''
}

function hubFillRounded(ctx, box, radius, color) {
    ctx.beginPath()
    new Rect(box.x, box.y, box.width, box.height, [radius, radius, radius, radius]).drawShape(ctx)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
}

// A row title as shown: map names start in lower case.
function hubTitle(title) {
    return title ? title[0].toUpperCase() + title.slice(1) : ''
}

// The hub card colours (hub concept): glass cards with a faint gold rim, your turn warm with a gold rim, finished
// cards dimmed; mode badges, tag chips, seat dots, result tags and the gold Join button.
const HUB_CARD = {
    glass: 'rgba(20, 28, 56, 0.82)',
    rim: 'rgba(201, 154, 78, 0.4)',
    gold: '#f2b45a',
    warm: ['rgba(242, 180, 90, 0.25)', 'rgba(242, 180, 90, 0.06)'],
    finishedGlass: 'rgba(14, 20, 42, 0.7)',
    finishedRim: 'rgba(201, 154, 78, 0.22)',
    // The opacity of a finished card's texts and marks (its result tag stays bright).
    finishedAlpha: 0.6,
    dim: '#a9a3b8',
    // The mode beside the title on a your-turn card: its warm fill lowers dim's contrast below 4.5 at 844x390.
    warmDim: '#bab4c8',
    round: '#f6e2b8',
    chip: 'rgba(255, 255, 255, 0.08)',
    chipText: '#e4dccb',
    icon: '#f0d39b',
    darkText: '#2a1a06',
    badge: {competitive: ['#d0443a', '#7a1813', 'swords'], 'co-op': ['#3a9a5c', '#155c30', 'shield']},
    button: ['#ffe3a3', '#e9a948'],
    dotRing: 'rgba(255, 255, 255, 0.55)',
    seatRing: 'rgba(255, 255, 255, 0.45)',
    noColour: '#8a8a96',
}

// The hub's line icons on a 24 x 24 grid, stroked (hub concept symbols): M/L/C path commands, O a circle, R a
// rounded rect.
const HUB_ICONS = {
    swords: [['M', 4, 4], ['L', 14, 14], ['M', 4, 8], ['L', 4, 4], ['L', 8, 4], ['M', 20, 4], ['L', 10, 14], ['M', 20, 8],
        ['L', 20, 4], ['L', 16, 4], ['M', 7, 17], ['L', 4, 20], ['M', 17, 17], ['L', 20, 20], ['M', 8, 13], ['L', 11, 16],
        ['M', 16, 13], ['L', 13, 16]],
    shield: [['M', 12, 3], ['L', 19, 6], ['L', 19, 11], ['C', 19, 16, 15.5, 19.5, 12, 21], ['C', 8.5, 19.5, 5, 16, 5, 11],
        ['L', 5, 6], ['L', 12, 3], ['M', 9, 12], ['L', 11, 14], ['L', 15, 10]],
    people: [['O', 9, 8, 3], ['M', 3, 20], ['C', 3, 16.5, 5.7, 14, 9, 14], ['C', 12.3, 14, 15, 16.5, 15, 20], ['O', 17, 9, 2.4],
        ['M', 16, 14], ['C', 19, 14, 21, 16.2, 21, 19]],
    fog: [['M', 7, 15], ['C', 3.5, 15, 3.5, 9, 7.5, 9.2], ['C', 8.2, 4.5, 15.5, 4, 16.6, 8.5], ['C', 20.6, 8.5, 20.6, 15, 17, 15],
        ['L', 7, 15], ['M', 5, 19], ['L', 19, 19]],
    async: [['M', 4, 9], ['L', 17, 9], ['L', 14, 6], ['M', 20, 15], ['L', 7, 15], ['L', 10, 18]],
    seed: [['R', 4, 4, 16, 16, 3], ['O', 9, 9, 1], ['O', 15, 15, 1], ['O', 15, 9, 1], ['O', 9, 15, 1]],
    door: [['M', 6, 21], ['L', 6, 4], ['L', 16, 4], ['L', 16, 21], ['M', 3, 21], ['L', 21, 21], ['O', 13, 12, 0.4]],
    // The setup screens' check mark and stepper chevrons (create-game concept symbols).
    check: [['M', 5, 12], ['L', 10, 17], ['L', 19, 7]],
    left: [['M', 15, 5], ['L', 8, 12], ['L', 15, 19]],
    right: [['M', 9, 5], ['L', 16, 12], ['L', 9, 19]],
    // The setup rows' map, clock and map size icons.
    map: [['M', 3, 6], ['L', 9, 4], ['L', 15, 6], ['L', 21, 4], ['L', 21, 18], ['L', 15, 20], ['L', 9, 18], ['L', 3, 20],
        ['L', 3, 6], ['M', 9, 4], ['L', 9, 18], ['M', 15, 6], ['L', 15, 20]],
    clock: [['O', 12, 12, 9], ['M', 12, 7], ['L', 12, 12], ['L', 15, 14]],
    size: [['M', 4, 9], ['L', 4, 4], ['L', 9, 4], ['M', 20, 9], ['L', 20, 4], ['L', 15, 4], ['M', 4, 15], ['L', 4, 20],
        ['L', 9, 20], ['M', 20, 15], ['L', 20, 20], ['L', 15, 20]],
}

// Strokes icon name, size pixels square, centred on (x, y), lineWidth on the 24 x 24 grid.
function hubDrawIcon(ctx, name, x, y, size, color, lineWidth = 2) {
    const k = size / 24, px = v => x + (v - 12) * k, py = v => y + (v - 12) * k
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth * k
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.beginPath()
    for (const [op, ...a] of HUB_ICONS[name]) {
        if (op === 'M') ctx.moveTo(px(a[0]), py(a[1]))
        else if (op === 'L') ctx.lineTo(px(a[0]), py(a[1]))
        else if (op === 'C') ctx.bezierCurveTo(px(a[0]), py(a[1]), px(a[2]), py(a[3]), px(a[4]), py(a[5]))
        else if (op === 'O') {
            ctx.moveTo(px(a[0] + a[2]), py(a[1]))
            ctx.arc(px(a[0]), py(a[1]), a[2] * k, 0, Math.PI * 2)
        } else if (op === 'R')
            new Rect(px(a[0]), py(a[1]), a[2] * k, a[3] * k, Array(4).fill(a[4] * k)).drawShape(ctx)
    }
    ctx.stroke()
    ctx.restore()
}

// A tag's icon: people for the seat count, a cloud for fog, arrows for async moves, a die for the co-op seed.
function hubTagIcon(tag) {
    if (/player|human/.test(tag)) return 'people'
    if (tag === 'fog') return 'fog'
    if (tag === 'async') return 'async'
    if (tag.startsWith('seed')) return 'seed'
    return null
}

// The round mode badge of diameter size centred on (x, y): a red disc with crossed swords (competitive) or a green
// one with a shield (co-op), in a gold ring 0.18 u wide.
function hubDrawBadge(ctx, mode, x, y, size, u = hubUnit()) {
    const r = size / 2, [light, dark, icon] = HUB_CARD.badge[mode] ?? HUB_CARD.badge.competitive
    ctx.save()
    const fill = ctx.createRadialGradient(x - 0.3 * r, y - 0.4 * r, 0, x, y, r)
    fill.addColorStop(0, light)
    fill.addColorStop(1, dark)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = MENU_THEME.plain.rim
    ctx.lineWidth = 0.18 * u
    ctx.stroke()
    ctx.restore()
    hubDrawIcon(ctx, icon, x, y, 0.58 * size, '#fff4dc')
}

// A filled pill of height h whose left end is at x, centred on y.
function hubPill(ctx, x, y, width, h, color) {
    hubFillRounded(ctx, {x, y: y - h / 2, width, height: h}, h / 2, color)
}

// Draws a label on a filled tag (your turn, a result) right-aligned at right, centred on y; returns its width.
function hubDrawLabelTag(ctx, text, right, y, fill, color) {
    const u = hubUnit(), font = hubFont(1.5 * u, 800, true)
    ctx.font = font
    const width = ctx.measureText(text).width + 1.2 * u
    hubFillRounded(ctx, {x: right - width, y: y - 1.05 * u, width, height: 2.1 * u}, 0.3 * u, fill)
    hubText(ctx, text, right - width / 2, y, font, color, 'center')
    return width
}

// The tag chips (icon + text on a translucent pill) from x on line y within maxWidth: whole chips while they fit; only
// the first one may end with an ellipsis. Returns the width drawn.
function hubDrawChips(ctx, tags, x, y, maxWidth) {
    const u = hubUnit(), font = hubFont(1.5 * u), h = 2.1 * u, pad = 0.55 * u, iconSize = 1.35 * u, gap = 0.5 * u
    let left = x
    for (const tag of tags) {
        const icon = hubTagIcon(tag), iconRoom = icon ? iconSize + 0.3 * u : 0
        ctx.font = font
        const room = x + maxWidth - left - 2 * pad - iconRoom
        const text = left === x ? hubEllipsis(ctx, tag, room) : tag
        if (!text || text === '…' || ctx.measureText(text).width > room) break
        const width = 2 * pad + iconRoom + ctx.measureText(text).width
        hubPill(ctx, left, y, width, h, HUB_CARD.chip)
        if (icon) hubDrawIcon(ctx, icon, left + pad + iconSize / 2, y, iconSize, HUB_CARD.icon)
        hubText(ctx, text, left + pad + iconRoom, y, font, HUB_CARD.chipText)
        left += width + gap
        if (text !== tag) break
    }
    return Math.max(0, left - gap - x)
}

// A player's colour dot of diameter 1.15 u centred on (x, y), in a 0.12 u ring.
function hubDrawDot(ctx, x, y, colour, u = hubUnit(), diameter = 1.15) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, diameter / 2 * u, 0, Math.PI * 2)
    ctx.fillStyle = colour ?? HUB_CARD.noColour
    ctx.fill()
    ctx.strokeStyle = HUB_CARD.dotRing
    ctx.lineWidth = 0.12 * u
    ctx.stroke()
    ctx.restore()
}

// The width hubDrawChips takes for every tag whole.
function hubChipsWidth(ctx, tags) {
    const u = hubUnit(), pad = 0.55 * u, iconSize = 1.35 * u, gap = 0.5 * u
    ctx.font = hubFont(1.5 * u)
    return tags.reduce((sum, tag) => sum + 2 * pad + (hubTagIcon(tag) ? iconSize + 0.3 * u : 0) + ctx.measureText(tag).width + gap,
        0) - (tags.length ? gap : 0)
}

// The width of player names as hubDrawPlayers draws them (a dot before each), all shown.
function hubPlayersWidth(ctx, names) {
    const u = hubUnit(), dot = 1.15 * u, afterDot = 0.3 * u, gap = 0.6 * u
    ctx.font = hubFont(1.5 * u)
    return names.reduce((sum, name) => sum + dot + afterDot + ctx.measureText(name).width, 0) + gap * Math.max(0, names.length - 1)
}

// The players as colour dots each followed by its name, right-aligned at right on line y within maxWidth: as many as
// fit, then "+N" for the others (a single long name ends with an ellipsis). Returns the width.
function hubDrawPlayers(ctx, players, right, y, maxWidth, color) {
    const u = hubUnit(), font = hubFont(1.5 * u), dot = 1.15 * u, afterDot = 0.3 * u, gap = 0.6 * u
    ctx.font = font
    const widthOf = names => hubPlayersWidth(ctx, names)
    const more = n => n ? '+' + n : ''
    const all = players.map(player => player.name)
    let shown = all.length
    while (shown > 1 && widthOf(all.slice(0, shown)) + (shown < all.length ? gap + ctx.measureText(more(all.length - shown)).width : 0) > maxWidth)
        --shown
    const names = all.slice(0, shown), rest = more(all.length - shown)
    const restWidth = rest ? gap + ctx.measureText(rest).width : 0
    if (shown === 1) names[0] = hubEllipsis(ctx, names[0], maxWidth - restWidth - dot - afterDot)
    let x = right - widthOf(names) - restWidth
    for (let i = 0; i < names.length; ++i) {
        hubDrawDot(ctx, x + dot / 2, y, players[i].colour)
        x += dot + afterDot
        x += hubText(ctx, names[i], x, y, font, color) + gap
    }
    if (rest) hubText(ctx, rest, x, y, font, color)
    return widthOf(names) + restWidth
}

// Filled seat dots (in the members' colours) then empty ones and "n/m", right-aligned at right on line y; returns
// the width.
function hubDrawSeats(ctx, row, right, y, color) {
    const u = hubUnit(), font = hubFont(1.5 * u), dot = 1.15 * u, step = 1.45 * u
    const count = `${row.seats.filled}/${row.seats.capacity}`
    const countWidth = hubText(ctx, count, right, y, font, color, 'right')
    let x = right - countWidth - 0.5 * u - row.seats.capacity * step + (step - dot)
    for (let i = 0; i < row.seats.capacity; ++i, x += step) {
        if (i < row.seats.filled) hubDrawDot(ctx, x + dot / 2, y, row.players[i]?.colour)
        else {
            ctx.save()
            ctx.beginPath()
            ctx.arc(x + dot / 2, y, dot / 2 - 0.075 * u, 0, Math.PI * 2)
            ctx.strokeStyle = HUB_CARD.seatRing
            ctx.lineWidth = 0.15 * u
            ctx.stroke()
            ctx.restore()
        }
    }
    return countWidth + 0.5 * u + row.seats.capacity * step - (step - dot)
}

// A finished game's result tag: Victory gold, Defeat red, Draw grey; co-op games were Defended (green) or Fell (grey).
// null for old games without a result.
function hubResultTag(row) {
    const coop = row.mode === 'co-op'
    return {
        victory: coop ? {text: 'Defended', fill: '#3a9a5c', color: '#f3ead8'} : {text: 'Victory', fill: HUB_CARD.gold, color: HUB_CARD.darkText},
        defeat: coop ? {text: 'Fell', fill: '#6b6878', color: '#f3ead8'} : {text: 'Defeat', fill: '#c0392b', color: '#f3ead8'},
        draw: {text: 'Draw', fill: '#6b6878', color: '#f3ead8'},
    }[row.result] ?? null
}

// The gold Join / Open button face over box (its label in small caps).
function hubDrawGoldButton(ctx, box, label) {
    const u = hubUnit()
    ctx.save()
    const fill = ctx.createLinearGradient(0, box.y, 0, box.y + box.height)
    fill.addColorStop(0, HUB_CARD.button[0])
    fill.addColorStop(1, HUB_CARD.button[1])
    hubFillRounded(ctx, box, 0.4 * u, fill)
    ctx.restore()
    hubText(ctx, label, box.x + box.width / 2, box.y + box.height / 2, hubFont(1.55 * u, 800, true), HUB_CARD.darkText, 'center')
}

// The title in the display font, then the mode in small caps when the title keeps 6 units; returns their width.
function hubDrawTitle(ctx, row, x, y, maxWidth, color, weight = 700, size = 2.05, modeColor = HUB_CARD.dim) {
    const u = hubUnit(), titleFont = hubFont(size * hubUnit(), weight), modeFont = hubFont(1.5 * u, 800, true)
    const mode = hubTitle(row.mode ?? '')
    ctx.font = modeFont
    const modeWidth = ctx.measureText(mode).width
    const withMode = mode && maxWidth - modeWidth - 0.8 * u >= 6 * u
    ctx.font = titleFont
    const title = hubEllipsis(ctx, hubTitle(row.title), withMode ? maxWidth - modeWidth - 0.8 * u : maxWidth)
    const width = hubText(ctx, title, x, y, titleFont, color)
    if (withMode) return width + 0.8 * u + hubText(ctx, mode, x + width + 0.8 * u, y, modeFont, modeColor)
    return width
}

// A card's glass box in rect r (hub concept): a finished card dimmed, your turn warm with a gold rim, the selected
// card a light rim.
function hubDrawCardBox(ctx, r, u, {selected = false, yourTurn = false, finished = false} = {}) {
    const box = new Rect(r.x, r.y, r.width, r.height, Array(4).fill(0.8 * u))
    ctx.save()
    ctx.beginPath()
    box.drawShape(ctx)
    ctx.closePath()
    ctx.fillStyle = finished ? HUB_CARD.finishedGlass : HUB_CARD.glass
    if (yourTurn) {
        ctx.shadowColor = 'rgba(242, 180, 90, 0.35)'
        ctx.shadowBlur = 1.4 * u
    }
    ctx.fill()
    ctx.shadowColor = 'transparent'
    if (yourTurn) {
        const warm = ctx.createLinearGradient(r.x, 0, r.x + 0.7 * r.width, 0)
        warm.addColorStop(0, HUB_CARD.warm[0])
        warm.addColorStop(1, HUB_CARD.warm[1])
        ctx.fillStyle = warm
        ctx.fill()
    }
    ctx.strokeStyle = selected ? MENU_THEME.selectedRim : yourTurn ? HUB_CARD.gold : finished ? HUB_CARD.finishedRim : HUB_CARD.rim
    ctx.lineWidth = (selected || yourTurn ? 0.25 : 0.12) * u
    ctx.stroke()
    ctx.restore()
}

// A hub button placed by the hub's layout: a plaque (gold when primary) with a small-caps label.
class HubButton extends MenuButton {
    constructor(label, clickFunc, parameters, callThis, primary = false) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, label), clickFunc, parameters, true, callThis)
        this.primary = primary
    }
    place(x, y, width, height, fontSize) {
        Object.assign(this.rect, {x, y, width, height})
        const corner = Math.min(0.8 * hubUnit(), height / 2)
        this.rect.cornerRadius = [corner, corner, corner, corner]
        this.text.fontSize = fontSize * hubFontScale()
        this.trimText()
    }
    draw(ctx) {
        const style = this.primary ? MENU_THEME.primary : MENU_THEME.plain
        this.rect.drawPlaque(ctx, style, 0.16 * hubUnit())
        this.text.fontFamily = Text.titleFamily
        this.text.drawAs(ctx, style.text, 800)
    }
}

// A hub button on a setupLayout button box (primary or back): corners, rim and label in setup units, the rim inside the
// box (the concept's inset rim), so the drawn plaque is the box.
class SetupButton extends HubButton {
    place(box, layout) {
        Object.assign(this.rect, {x: box.x, y: box.y, width: box.width, height: box.height})
        this.rect.cornerRadius = Array(4).fill(0.8 * layout.unit)
        this.text.fontSize = layout.fonts.button
        this.unit = layout.unit
        this.trimText()
    }
    draw(ctx) {
        const style = this.primary ? MENU_THEME.primary : MENU_THEME.plain, rim = 0.16 * this.unit, r = this.rect
        new Rect(r.x + rim / 2, r.y + rim / 2, r.width - rim, r.height - rim, r.cornerRadius.map(c => Math.max(0, c - rim / 2)))
            .drawPlaque(ctx, style, rim)
        this.text.fontFamily = Text.titleFamily
        this.text.drawAs(ctx, style.text, 800)
    }
}

// The account chip's round pencil button: opens the nickname screen.
class HubPencilButton extends Button {
    constructor(clickFunc, parameters, callThis) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, 'change nickname'), clickFunc, parameters, true, callThis)
    }
    place(centerX, centerY, radius) {
        Object.assign(this.rect, {x: centerX - radius, y: centerY - radius, width: 2 * radius, height: 2 * radius})
        this.trimText()
    }
    select() {
    }
    removeSelect() {
    }
    draw(ctx) {
        const r = this.rect.width / 2, x = this.rect.centerX, y = this.rect.centerY, u = hubUnit()
        ctx.save()
        const fill = ctx.createRadialGradient(x - 0.3 * r, y - 0.4 * r, 0, x, y, r)
        fill.addColorStop(0, '#3b4a72')
        fill.addColorStop(1, '#1a2342')
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = MENU_THEME.plain.rim
        ctx.lineWidth = 0.18 * u
        ctx.beginPath()
        ctx.arc(x, y, r - 0.09 * u, 0, Math.PI * 2)
        ctx.stroke()
        // The pencil along the diagonal, its tip at the lower left.
        const s = 0.55 * r
        ctx.translate(x, y)
        ctx.rotate(-Math.PI / 4)
        ctx.strokeStyle = '#f0d39b'
        ctx.lineWidth = 0.1 * r
        ctx.lineJoin = ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-0.95 * s, 0)
        ctx.lineTo(-0.55 * s, -0.22 * s)
        ctx.lineTo(0.85 * s, -0.22 * s)
        ctx.lineTo(0.85 * s, 0.22 * s)
        ctx.lineTo(-0.55 * s, 0.22 * s)
        ctx.closePath()
        ctx.moveTo(0.55 * s, -0.22 * s)
        ctx.lineTo(0.55 * s, 0.22 * s)
        ctx.stroke()
        ctx.restore()
    }
}

// The pinned 'Return to my lobby' bar over the panels: the lobby's summary and an Open button; a click anywhere on
// the bar opens the room.
class HubReturnBar {
    constructor(onOpen) {
        this.row = null
        this.rect = new Rect(0, 0, 0, 0)
        this.onOpen = onOpen
        this.openButton = new HubButton('Open', () => {}, undefined, undefined, true)
    }
    place(x, y, width, height) {
        const u = hubUnit(), buttonWidth = 7 * u, buttonHeight = 2.5 * u
        Object.assign(this.rect, {x, y, width, height})
        this.rect.cornerRadius = [0.8 * u, 0.8 * u, 0.8 * u, 0.8 * u]
        this.openButton.place(x + width - 1.4 * u - buttonWidth, y + (height - buttonHeight) / 2, buttonWidth, buttonHeight,
            1.55 * u)
    }
    click(pos) {
        if (!this.row || !this.rect.isInside(pos)) return false
        this.onOpen(this.row)
        return true
    }
    select(pos) {
    }
    touchmove(pos) {
    }
    removeSelect() {
    }
    // The door icon and the label, then the lobby's summary as on its card: title and mode, tag chips, seat dots with
    // n/m and the host, the gold Open button.
    draw(ctx) {
        if (!this.row) return
        const u = hubUnit(), {x, y, height} = this.rect, centerY = y + height / 2, row = this.row
        this.rect.drawPlaque(ctx, MENU_THEME.myLobby, 0.16 * u)
        hubDrawIcon(ctx, 'door', x + 2.5 * u, centerY, 2.2 * u, '#c9f5cd')
        const labelWidth = hubText(ctx, 'Return to my lobby', x + 4.1 * u, centerY, hubFont(1.75 * u, 800, true), '#c9f5cd')
        const left = x + 5.5 * u + labelWidth, end = this.openButton.rect.x - 1.4 * u
        if (row.title !== undefined) {
            const font = hubFont(1.5 * u)
            ctx.font = font
            const host = hubEllipsis(ctx, 'host ' + row.host, 12 * u)
            const hostWidth = hubText(ctx, host, end, centerY, font, MENU_THEME.text, 'right')
            const seatsWidth = hubDrawSeats(ctx, row, end - hostWidth - u, centerY, MENU_THEME.text)
            const room = end - hostWidth - seatsWidth - 2 * u - left
            const titleWidth = hubDrawTitle(ctx, row, left, centerY, Math.min(room, 24 * u), MENU_THEME.text, 700, 1.6)
            hubDrawChips(ctx, row.tags, left + titleWidth + u, centerY, room - titleWidth - u)
        }
        this.openButton.draw(ctx)
    }
}

// One panel of the hub: a heading with its count over the rows, drawn as text cards, and a slim gold scroll track at
// its right. It scrolls on its own: the wheel over it, a touch drag in it, the arrow keys (OnlineHubTree.scrollKey).
class HubPanel {
    // Row heights in hub units: a card (a tall one has three lines at its right: your turn, finished) with the gap
    // under it, a section heading, an empty-section line.
    static CARD = 6.2
    static TALL_CARD = 7.4
    static CARD_GAP = 0.8
    static LINE = 3.4
    constructor(lists, title, countText, countKind) {
        this.lists = lists
        this.title = title
        this.countText = countText
        this.countKind = countKind
        this.rows = []
        this.scroll = new HubPanelScroll()
        this.rect = new Rect(0, 0, 0, 0)
        this.view = new Rect(0, 0, 0, 0)
        this.track = new Rect(0, 0, 0, 0)
        this.dragY = null
    }
    static isCard(row) {
        return row.kind !== 'header' && row.kind !== 'empty'
    }
    // A lobby card's gold Join button in its card rect r (the whole card joins; tests aim at the button).
    static joinRect(r) {
        const u = hubUnit(), right = r.x + r.width - 1.1 * u
        return {x: right - 6.4 * u, y: r.y + r.height / 2 - 1.3 * u, width: 6.4 * u, height: 2.6 * u}
    }
    static cardHeight(row) {
        return row.yourTurn || row.kind === 'finished' ? HubPanel.TALL_CARD : HubPanel.CARD
    }
    setRows(rows) {
        const u = hubUnit()
        this.rows = rows
        this.scroll.setHeights(rows.map(row => (HubPanel.isCard(row) ? HubPanel.cardHeight(row) + HubPanel.CARD_GAP : HubPanel.LINE) * u))
    }
    // The panel box; the rows scroll in the view under the heading, the track runs down the view's right edge.
    place(x, y, width, height) {
        const u = hubUnit()
        Object.assign(this.rect, {x, y, width, height})
        this.rect.cornerRadius = [u, u, u, u]
        Object.assign(this.view, {x: x + u, y: y + 4 * u, width: width - 2 * u, height: height - 4.9 * u})
        Object.assign(this.track, {x: this.view.right - 0.45 * u, y: this.view.y, width: 0.45 * u, height: this.view.height})
        this.scroll.setViewHeight(this.view.height)
    }
    get count() {
        return this.rows.filter(row => row.kind === this.countKind).length
    }
    // One wheel notch or arrow key: a card.
    get step() {
        return (HubPanel.CARD + HubPanel.CARD_GAP) * hubUnit()
    }
    // The card (or line) of row index on screen.
    rowRect(index) {
        const u = hubUnit(), card = HubPanel.isCard(this.rows[index])
        return {x: this.view.x, y: this.view.y + this.scroll.tops[index] - this.scroll.offset,
            width: this.view.width - 1.4 * u, height: this.scroll.heights[index] - (card ? HubPanel.CARD_GAP * u : 0)}
    }
    // The track's gold thumb on screen, or null when the rows fit.
    get thumbRect() {
        const thumb = this.scroll.thumb(this.track.height, 2 * hubUnit())
        return thumb && {x: this.track.x, y: this.track.y + thumb.top, width: this.track.width, height: thumb.height}
    }
    isInside(pos) {
        return this.rect.isInside(pos)
    }
    wheel(pos, deltaY) {
        if (!deltaY || !this.isInside(pos)) return false
        this.scroll.scrollBy(Math.sign(deltaY) * this.step)
        return true
    }
    scrollKey(key) {
        const page = Math.max(this.step, this.scroll.viewHeight - this.step)
        const delta = {ArrowDown: this.step, ArrowUp: -this.step, PageDown: page, PageUp: -page}[key]
        if (key === 'Home') this.scroll.scrollTo(0)
        else if (key === 'End') this.scroll.scrollTo(this.scroll.maxOffset)
        else if (delta) this.scroll.scrollBy(delta)
        else return false
        return true
    }
    // Touch drag in the view.
    select(pos) {
        this.dragY = this.view.isInside(pos) ? pos.y : null
        if (this.dragY !== null) this.lists.lastPanel = this
    }
    touchmove(pos) {
        if (this.dragY === null) return
        this.scroll.scrollBy(this.dragY - pos.y)
        this.dragY = pos.y
    }
    removeSelect() {
        this.dragY = null
    }
    click(pos) {
        if (!this.view.isInside(pos)) return false
        this.lists.lastPanel = this
        const index = this.scroll.rowAt(pos.y - this.view.y), row = this.rows[index]
        if (!row || row.id === null || !HubPanel.isCard(row)) return true
        // Not in the gap under a card or beside it on the track.
        const r = this.rowRect(index)
        if (pos.x <= r.x + r.width && pos.y <= r.y + r.height) this.lists.choose(row)
        return true
    }
    draw(ctx) {
        const u = hubUnit(), theme = MENU_THEME, {x, y} = this.rect
        this.rect.drawPlaque(ctx, theme.panel, 0.14 * u)
        const headingY = y + 2.2 * u
        const titleWidth = hubText(ctx, this.title, x + 1.4 * u, headingY, hubFont(2.1 * u, 800, true), theme.heading)
        hubText(ctx, this.countText(this.count), x + 2.2 * u + titleWidth, headingY, hubFont(1.55 * u), theme.mutedText)
        ctx.save()
        ctx.beginPath()
        ctx.rect(this.view.x, this.view.y, this.view.width, this.view.height)
        ctx.clip()
        const {first, last} = this.scroll.visibleRange
        for (let i = first; i <= last; ++i) {
            const row = this.rows[i], r = this.rowRect(i)
            if (HubPanel.isCard(row)) this.drawCard(ctx, row, r, u)
            else if (row.kind === 'header') {
                const count = this.rows.filter(other => other.kind === 'finished').length
                const width = hubText(ctx, 'Finished', r.x + 0.4 * u, r.y + 0.55 * r.height, hubFont(1.75 * u, 800, true),
                    theme.heading)
                hubText(ctx, count === 1 ? '1 game' : `${count} games`, r.x + 1.2 * u + width, r.y + 0.55 * r.height,
                    hubFont(1.5 * u), theme.mutedText)
            } else hubText(ctx, row.text, r.x + 0.4 * u, r.y + r.height / 2, hubFont(1.6 * u, 'italic 500'),
                theme.disabled.text)
        }
        ctx.restore()
        hubFillRounded(ctx, this.track, this.track.width / 2, 'rgba(255, 255, 255, 0.08)')
        const thumb = this.thumbRect
        if (thumb) hubFillRounded(ctx, thumb, thumb.width / 2, theme.plain.rim)
    }
    // A card (hub concept): the mode badge; the title with the mode, the tag chips under it; the right block: a game's
    // round (under a YOUR TURN tag) and players, a finished game's rounds and result tag, its date, its players, a
    // lobby's seats and host beside its gold Join button. Your turn: warm with a gold rim; finished: dimmed; the
    // selected card has a light rim.
    drawCard(ctx, row, r, u) {
        const theme = MENU_THEME, selected = row.id === this.lists.selectedId, finished = row.kind === 'finished'
        hubDrawCardBox(ctx, r, u, {selected, yourTurn: row.yourTurn, finished})
        const centerY = r.y + r.height / 2, pad = 1.1 * u, badge = 4.2 * u
        const right = r.x + r.width - pad, tall = HubPanel.cardHeight(row) === HubPanel.TALL_CARD
        const lines = tall ? [0.24, 0.5, 0.76].map(k => r.y + k * r.height) : [0.33, 0.7].map(k => r.y + k * r.height)
        ctx.save()
        if (finished) ctx.globalAlpha = HUB_CARD.finishedAlpha
        hubDrawBadge(ctx, row.mode, r.x + pad + badge / 2, centerY, badge)
        const left = r.x + pad + badge + pad, inner = right - left
        // The right block, then the title and the chips each in the room the block leaves on its own row: the title
        // beside the upper lines (your turn, round, rounds and result, date, seats), the chips beside the bottom one
        // (players, host).
        let topWidth = 0, bottomWidth = 0
        const font = hubFont(1.5 * u), roundFont = hubFont(1.5 * u, 800, true)
        if (row.kind === 'lobby') {
            const join = HubPanel.joinRect(r)
            hubDrawGoldButton(ctx, join, 'Join')
            const end = join.x - pad
            ctx.font = font
            const host = hubEllipsis(ctx, 'host ' + row.host, 0.35 * inner)
            bottomWidth = right - end + hubText(ctx, host, end, lines[1], font, HUB_CARD.dim, 'right')
            topWidth = right - end + hubDrawSeats(ctx, row, end, lines[0], theme.text)
        } else {
            // The players share their row with the chips: every name when they all fit beside the first chip, else
            // half of the row, or more when the chips leave it.
            const allPlayers = hubPlayersWidth(ctx, row.players.map(player => player.name))
            const maxWidth = allPlayers <= inner - pad - hubChipsWidth(ctx, row.tags.slice(0, 1)) ? allPlayers :
                inner - pad - Math.min(hubChipsWidth(ctx, row.tags), 0.5 * inner)
            let line = 0
            if (row.yourTurn) topWidth = hubDrawLabelTag(ctx, 'Your turn', right, lines[line++], HUB_CARD.gold, HUB_CARD.darkText)
            if (finished) {
                ctx.globalAlpha = 1
                const result = hubResultTag(row)
                const tagWidth = result ? hubDrawLabelTag(ctx, result.text, right, lines[0], result.fill, result.color) : 0
                ctx.globalAlpha = HUB_CARD.finishedAlpha
                ctx.font = font
                const date = row.finishedAt ? 'finished ' + row.finishedAt.slice(0, 10) : ''
                const datedWidth = date ? hubText(ctx, date, right, lines[1], font, HUB_CARD.dim, 'right') : 0
                const rounds = row.rounds != null ? `${row.rounds} rounds` : ''
                const roundsRight = right - tagWidth - (tagWidth ? 0.8 * u : 0)
                const roundsWidth = rounds ? hubText(ctx, rounds, roundsRight, lines[0], roundFont, HUB_CARD.round, 'right') : 0
                topWidth = Math.max(right - roundsRight + roundsWidth, datedWidth)
                line = 2
            } else topWidth = Math.max(topWidth, hubText(ctx, 'Round ' + row.round, right, lines[line++], roundFont, HUB_CARD.round, 'right'))
            bottomWidth = hubDrawPlayers(ctx, row.players, right, lines[line], maxWidth, HUB_CARD.dim)
        }
        const textTop = tall ? r.y + 0.33 * r.height : lines[0], textBottom = tall ? r.y + 0.7 * r.height : lines[1]
        hubDrawTitle(ctx, row, left, textTop, inner - topWidth - pad, theme.text, 700, 2.05, row.yourTurn ? HUB_CARD.warmDim : HUB_CARD.dim)
        hubDrawChips(ctx, row.tags, left, textBottom, inner - bottomWidth - pad)
        ctx.restore()
    }
}

// The hub's rows (menu.onlineHub.list): rows is the whole buildHubRows list, split over the return bar and the two
// panels (hubPanelRows); a chosen row is selected and passed to onRow.
class HubLists {
    constructor() {
        this.rows = []
        this.selectedId = null
        this.onRow = null
        this.onRowsChanged = null
        this.myLobby = null
        this.games = new HubPanel(this, 'Your games', n => n === 1 ? '1 game' : `${n} games`, 'game')
        this.lobbies = new HubPanel(this, 'Open lobbies', n => n === 1 ? '1 lobby' : `${n} lobbies`, 'lobby')
        this.bar = new HubReturnBar(row => this.choose(row))
        // The panel the arrow keys scroll when the mouse is over neither: the last one wheeled, touched or clicked.
        this.lastPanel = this.games
    }
    get panels() {
        return [this.games, this.lobbies]
    }
    setRows(rows) {
        this.rows = rows
        const {myLobby, games, lobbies} = hubPanelRows(rows)
        this.myLobby = this.bar.row = myLobby
        this.games.setRows(games)
        this.lobbies.setRows(lobbies)
        this.onRowsChanged?.()
    }
    choose(row) {
        this.selectedId = row.id
        this.onRow?.(row)
    }
    // Where a click opens row id (my lobby: the bar's Open button), its panel scrolled to show it whole; null when
    // the row is not shown.
    rowPoint(id) {
        if (this.myLobby?.id === id) return {x: this.bar.openButton.centerX, y: this.bar.openButton.centerY}
        for (const panel of this.panels) {
            const index = panel.rows.findIndex(row => row.id === id)
            if (index < 0) continue
            panel.scroll.reveal(index)
            const r = panel.rowRect(index)
            return {x: r.x + r.width / 2, y: r.y + r.height / 2}
        }
        return null
    }
}

// The load game screen's save slots (TASK-1205) as hub cards in one panel that scrolls like the hub's: a saved game's
// card (loadSlotRow) is a tall one with the slot number, the mode badge, the title and the mode, the tag chips, and at
// its right the player to move, the round and the players' colour dots; an empty slot is a dimmed card that does
// nothing. A click on a saved game's card calls clickFunc(slot index). The new game's slot screen (TASK-1332) is the
// same panel with emptyClickable: there a click on any card, empty or saved, calls clickFunc (start overwrites it).
class LoadSlotsPanel extends HubPanel {
    constructor(slotsCount, clickFunc, emptyClickable = false) {
        // The chosen card is the pressed control a game start marks while it waits for the sprites.
        super({selectedId: null, lastPanel: null, choose: row => {
            Button.pressed = {rect: this.rowRect(row.slot)}
            try {
                clickFunc(row.slot)
            } finally {
                Button.pressed = null
            }
        }}, 'Saved games',
            n => n === 1 ? '1 saved game' : `${n} saved games`, 'save')
        this.slotsCount = slotsCount
        this.emptyClickable = emptyClickable
        // Empty until update() reads the saves.
        this.setRows([...Array(slotsCount).keys()].map(i => this.slotRow(i, {whooseTurn: -1})))
    }
    static cardHeight(row) {
        return row.kind === 'save' ? HubPanel.TALL_CARD : HubPanel.CARD
    }
    // An empty slot's row takes clicks (has an id) only with emptyClickable.
    slotRow(index, info) {
        const row = loadSlotRow(index, info)
        return this.emptyClickable ? {...row, id: index} : row
    }
    update() {
        this.setRows([...Array(this.slotsCount).keys()].map(i => this.slotRow(i, loadSlotInfo(i))))
    }
    // Slot index's card on screen, the panel scrolled to show it whole (tests aim at it).
    slotRect(index) {
        this.scroll.reveal(index)
        const r = this.rowRect(index)
        return new Rect(r.x, r.y, r.width, r.height)
    }
    setRows(rows) {
        const u = hubUnit()
        this.rows = rows
        this.scroll.setHeights(rows.map(row => (LoadSlotsPanel.cardHeight(row) + HubPanel.CARD_GAP) * u))
    }
    drawCard(ctx, row, r, u) {
        const empty = row.kind !== 'save', centerY = r.y + r.height / 2, pad = 1.1 * u, number = 2.4 * u, badge = 4.2 * u
        const right = r.x + r.width - pad
        hubDrawCardBox(ctx, r, u, {finished: empty})
        ctx.save()
        if (empty) ctx.globalAlpha = HUB_CARD.finishedAlpha
        hubText(ctx, String(row.slot + 1), r.x + pad + number / 2, centerY, hubFont(2.05 * u, 800, true), HUB_CARD.round,
            'center')
        let left = r.x + pad + number + 0.6 * u
        if (empty) {
            // The label in the dim text colour but opaque, readable on the dimmed card.
            ctx.globalAlpha = 1
            hubText(ctx, 'empty slot', left, centerY, hubFont(1.6 * u, 'italic 500'), MENU_THEME.disabled.text)
            ctx.restore()
            return
        }
        hubDrawBadge(ctx, row.mode, left + badge / 2, centerY, badge)
        left += badge + pad
        // The right block as on a your-turn hub card: the player to move, the round, the players; the title beside
        // the upper two, the chips beside the lower two.
        const inner = right - left, lines = [0.24, 0.5, 0.76].map(k => r.y + k * r.height)
        const moverWidth = hubDrawMoverTag(ctx, row.mover, right, lines[0])
        const roundWidth = hubText(ctx, 'Round ' + row.round, right, lines[1], hubFont(1.5 * u, 800, true), HUB_CARD.round, 'right')
        const dotsWidth = hubDrawTurnDots(ctx, row.players, right, lines[2])
        hubDrawTitle(ctx, row, left, r.y + 0.33 * r.height, inner - Math.max(moverWidth, roundWidth) - pad, MENU_THEME.text)
        hubDrawChips(ctx, row.tags, left, r.y + 0.7 * r.height, inner - Math.max(roundWidth, dotsWidth) - pad)
        ctx.restore()
    }
}

// The gold tag of the player to move, right-aligned at right on line y: a dot in its colour and 'to move' (or
// 'demons to move'); returns its width.
function hubDrawMoverTag(ctx, mover, right, y) {
    const u = hubUnit(), font = hubFont(1.5 * u, 800, true), dot = 1.15 * u, pad = 0.6 * u, gap = 0.4 * u
    ctx.font = font
    const width = 2 * pad + dot + gap + ctx.measureText(mover.text).width
    hubFillRounded(ctx, {x: right - width, y: y - 1.05 * u, width, height: 2.1 * u}, 0.3 * u, HUB_CARD.gold)
    hubDrawDot(ctx, right - width + pad + dot / 2, y, mover.colour)
    hubText(ctx, mover.text, right - width + pad + dot + gap, y, font, HUB_CARD.darkText)
    return width
}

// The players' colour dots right-aligned at right on line y, the player to move's in a gold ring; returns the width.
function hubDrawTurnDots(ctx, players, right, y) {
    const u = hubUnit(), dot = 1.15 * u, step = 1.45 * u, ring = 0.3 * u
    let x = right - ring - players.length * step + (step - dot)
    for (const player of players) {
        hubDrawDot(ctx, x + dot / 2, y, player.colour)
        if (player.toMove) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(x + dot / 2, y, dot / 2 + 0.2 * u, 0, Math.PI * 2)
            ctx.strokeStyle = HUB_CARD.gold
            ctx.lineWidth = 0.2 * u
            ctx.stroke()
            ctx.restore()
        }
        x += step
    }
    return players.length ? players.length * step - (step - dot) + 2 * ring : 0
}

// 'load game': the save slots panel under the logo, 'Back' under it (hub layout units). The hot-seat settings' 'Start'
// opens the same screen with clickFunc start and empty slots clickable (TASK-1332).
class LoadTree {
    constructor(_menu, slotsCount, clickFunc = load, emptyClickable = false) {
        this.menu = _menu
        this.panel = new LoadSlotsPanel(slotsCount, clickFunc, emptyClickable)
        this.backButton = new Empty()
        this.buttons = [this.panel]
        this.unit = null
    }
    setParent(parent, _menu) {
        this.backButton = new HubButton('Back', _menu.setTree, parent, _menu)
        this.buttons = [this.panel, this.backButton]
    }
    // The panel at most 80 units wide between the logo and the bottom row with Back, as the hub's.
    layout() {
        const u = hubUnit(), logo = this.menu.logo.bounds, width = Math.min(WIDTH - 4.8 * u, 80 * u)
        const top = logo.y + logo.height + u, bottom = HEIGHT - 5.8 * u
        if (this.unit !== u) {
            this.unit = u
            this.panel.setRows(this.panel.rows)
        }
        this.panel.place(WIDTH / 2 - width / 2, top, width, bottom - u - top)
        this.backButton.place?.(WIDTH / 2 - 5.5 * u, bottom, 11 * u, 4.6 * u, 2 * u)
    }
    enter() {
        this.panel.update()
        this.panel.scroll.scrollTo(0)
        this.layout()
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    wheel(pos, deltaY) {
        this.panel.wheel(pos, deltaY)
    }
    scrollKey(key) {
        this.panel.scrollKey(key)
    }
    draw(ctx) {
        this.layout()
        this.panel.draw(ctx)
        this.backButton.draw(ctx)
    }
}

// The signed-in hub (hub concept): the logo with the account chip at its right, 'return to my lobby' when I have a
// lobby, my games (active, then finished) and the open lobbies side by side, create game and back. Rows come from
// lobby:list and game:myFinished, both re-fetched on lobby:listChanged.
class OnlineHubTree {
    constructor(_menu) {
        this.menu = _menu
        this.account = null
        this.feed = null
        // A one-off message, e.g. a lobby:join error or 'you were removed from the lobby', on its own line over the
        // panels; cleared on leave.
        this.notice = ''
        // 'Signed in as <nickname>' and the notice, for tests; drawn only while signing in (the chip and the notice line
        // draw them once signed in).
        this.status = new Text(WIDTH / 2, HEIGHT / 2, 2 * hubUnit() * hubFontScale(), '', MENU_THEME.text)
        this.list = new HubLists()
        this.list.onRow = row => {
            // lobby:join of my own lobby returns it, so both open the room.
            if (row.kind === 'lobby' || row.kind === 'myLobby') this.joinLobby(row.id)
            else if (row.kind === 'game') this.openGame(row.id)
            else if (row.kind === 'finished') this.openReplay(row.id)
        }
        this.list.onRowsChanged = () => this.layout()
        this.joining = false
        this.replaying = false
        const u = hubUnit()
        // The menu logo's shape, 6.5 units high.
        this.logo = new HaloLogo('logo', {x: WIDTH / 2, y: 4.45 * u}, 6.5 * u * 0.5 / 0.11, 6.5 * u)
        this.betaTag = undefined
        this.nicknameButton = new HubPencilButton(_menu.setTree, _menu.nickname, _menu)
        this.createButton = new HubButton('Create game', _menu.setTree, _menu.createLobby, _menu, true)
        this.backButton = new Empty()
        this.hoveredPanel = null
        this.setAccount(null)
    }
    setParent(parent, _menu) {
        this.backButton = new HubButton('Back', _menu.setTree, parent, _menu)
        this.setAccount(this.account)
    }
    // A null account means the stored session is still being checked.
    setAccount(account) {
        this.account = account
        this.status.text = account ? 'Signed in as ' + account.nickname : 'signing in…'
        this.status.fontSize = 2 * hubUnit() * hubFontScale()
        if (account && this.notice) {
            this.status.text += ' · ' + this.notice
            // A long notice (the forfeit message, options/onlineLogic.js) shrinks the line to the screen width.
            if (this.status.width > WIDTH * 0.96) this.status.fontSize *= WIDTH * 0.96 / this.status.width
        }
        this.buttons = account ? [...this.list.panels, this.list.bar, this.nicknameButton, this.createButton,
            this.backButton] : [this.backButton]
        this.layout()
        if (account && this.menu.selectedTree === this) this.startFeed()
    }
    // In hub units from the top: the logo row (the logo centred, the account chip and the beta tag at the right), the
    // return bar when I have a lobby, the notice line when there is one, the two panels of equal width filling the
    // rest, the bottom row with create game and back.
    layout() {
        const u = hubUnit(), side = 2.4 * u, logoY = this.logo.pos.y
        let right = WIDTH - side
        if (this.menu.betaTag) {
            this.betaTag ??= new BetaTag()
            this.betaTag.text.fontSize = 1.5 * u * hubFontScale()
            this.betaTag.text.x = WIDTH
            const width = this.betaTag.bounds.width
            this.betaTag.text.x = right - width / 2
            this.betaTag.text.y = logoY
            right -= width + u
        }
        this.nicknameButton.place(right - 1.4 * u, logoY, 1.4 * u)
        // The chip's texts end here.
        this.chipRight = right - 3.5 * u
        let y = 8.7 * u
        if (this.list.myLobby) {
            this.list.bar.place(side, y, WIDTH - 2 * side, 3.8 * u)
            y += 4.8 * u
        }
        this.noticeY = y + 1.2 * u
        if (this.account && this.notice) y += 3.4 * u
        const bottom = HEIGHT - 5.8 * u
        const panelWidth = (WIDTH - 2 * side - 1.6 * u) / 2
        this.list.games.place(side, y, panelWidth, bottom - u - y)
        this.list.lobbies.place(WIDTH - side - panelWidth, y, panelWidth, bottom - u - y)
        const createWidth = 18 * u, backWidth = 11 * u, left = WIDTH / 2 - (createWidth + 2 * u + backWidth) / 2
        this.createButton.place(left, bottom, createWidth, 4.6 * u, 2 * u)
        this.backButton.place?.(left + createWidth + 2 * u, bottom, backWidth, 4.6 * u, 2 * u)
    }
    startFeed() {
        this.feed ||= new HubListFeed(onlineSession, rows => this.list.setRows(rows))
        return this.feed.start()
    }
    enter() {
        this.list.setRows([])
        this.setAccount(this.account)
    }
    leave() {
        this.feed?.stop()
        this.notice = ''
    }
    // lobby:join, then the room; LOBBY_FULL, ALREADY_IN_LOBBY etc. show on the notice line.
    async joinLobby(lobbyId) {
        if (this.joining) return
        this.joining = true
        const ack = await onlineSession.joinLobby(lobbyId)
        this.joining = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.notice = lobbyJoinErrorText(ack.error)
            this.setAccount(this.account)
            return
        }
        this.menu.lobbyRoom.open(ack.lobby)
    }
    // game:open; the first board enters the game (options/onlineLogic.js).
    openGame(gameID) {
        if (this.menu.selectedTree !== this || onlineSession.openGameID !== null) return
        whenGameSpritesReady(() => {
            if (this.menu.selectedTree === this && onlineSession.openGameID === null) openLobbyGame(gameID)
        })
    }
    // game:replay of a finished game, then the replay viewer; exit comes back to the hub. Errors show on the notice line.
    async openReplay(gameID) {
        if (this.replaying) return
        this.replaying = true
        const ack = await onlineSession.replayGame(gameID)
        this.replaying = false
        if (this.menu.selectedTree !== this) return
        if (ack.ok) this.showReplay(ack)
        else this.showReplayError(ack.error)
    }
    // A game:replay recording in the replay viewer, exit back to the hub (also the game-over screen's 'Watch replay').
    showReplay(recording) {
        whenGameSpritesReady(() => {
            try {
                new ReplayViewer(recording, this).open()
                this.feed?.stop()
            } catch (e) {
                this.showReplayError(e.message)
            }
        })
    }
    showReplayError(error) {
        this.notice = 'could not open the replay: ' + error
        this.setAccount(this.account)
    }
    // Row texts in list order, for tests and diagnostics: the plain-text summaries of the structured rows.
    get rowTexts() {
        return this.list.rows.map(hubRowText)
    }
    // The wheel scrolls the panel under the mouse, the arrow keys the hovered panel, else the last one used.
    wheel(pos, deltaY) {
        if (!this.account) return
        for (const panel of this.list.panels)
            if (panel.wheel(pos, deltaY)) this.list.lastPanel = panel
    }
    hover(pos) {
        this.hoveredPanel = this.list.panels.find(panel => panel.isInside(pos)) ?? null
    }
    scrollKey(key) {
        if (this.account) (this.hoveredPanel ?? this.list.lastPanel).scrollKey(key)
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    // 'Signed in as <nickname>' right-aligned before the pencil and clear of the logo; a long nickname ends with an
    // ellipsis.
    drawChip(ctx) {
        const u = hubUnit(), y = this.logo.pos.y, size = 1.6 * u, pencil = this.nicknameButton.rect
        const logo = this.logo.bounds, prefix = 'Signed in as '
        ctx.font = hubFont(size)
        const prefixWidth = ctx.measureText(prefix).width
        ctx.font = hubFont(size, 700)
        const name = hubEllipsis(ctx, this.account.nickname, this.chipRight - (logo.x + logo.width + u) - prefixWidth)
        const x = this.chipRight - ctx.measureText(name).width - prefixWidth
        hubText(ctx, prefix, x, y, hubFont(size), MENU_THEME.mutedText)
        hubText(ctx, name, x + prefixWidth, y, hubFont(size, 700), MENU_THEME.text)
        this.chipRect = {x, y: pencil.y, width: pencil.right - x, height: pencil.height}
        this.nicknameButton.draw(ctx)
    }
    draw(ctx) {
        this.layout()
        if (!this.account) {
            this.status.draw(ctx)
            this.backButton.draw(ctx)
            return
        }
        const u = hubUnit()
        this.drawChip(ctx)
        if (this.notice) {
            const font = hubFont(1.6 * u)
            ctx.font = font
            hubText(ctx, hubEllipsis(ctx, this.notice, WIDTH - 4.8 * u), WIDTH / 2, this.noticeY, font, MENU_THEME.mutedText,
                'center')
        }
        this.list.bar.draw(ctx)
        for (const panel of this.list.panels) panel.draw(ctx)
        this.createButton.draw(ctx)
        this.backButton.draw(ctx)
    }
}

// 'change nickname': a canvas text input prefilled with the current nickname.
class NicknameTree {
    constructor(_menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.menu = _menu
        this.saving = false
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, Math.min(0.04 * WIDTH, 0.07 * HEIGHT), 'change nickname', MENU_THEME.text)
        // Wider than a button so 16 characters fit.
        const inputRect = Menu.getButtonRect({x: WIDTH * 0.3, y: HEIGHT * 0.36})
        inputRect.width = WIDTH * 0.4
        this.input = new MenuTextInput(inputRect, 0.04 * WIDTH,
            {maxLength: 16, onSubmit: () => this.save(), onCancel: () => this.back()})
        this.status = new Text(WIDTH / 2, HEIGHT * 0.51, 0.025 * WIDTH, '', MENU_THEME.mutedText)
        this.buttons = [
            Menu.getButton({x: pos0X, y: HEIGHT * 0.56}, 'save', this.save, undefined, true, this),
            Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', this.back, undefined, true, this),
        ]
    }
    enter() {
        this.saving = false
        this.status.text = ''
        this.input.setValue(onlineSession.account?.nickname || '')
        this.input.focus()
    }
    leave() {
        this.input.blur()
    }
    back() {
        this.menu.setTree(this.menu.onlineHub)
    }
    async save() {
        if (this.saving) return
        this.saving = true
        this.status.text = 'saving…'
        const ack = await onlineSession.setNickname(this.input.value)
        this.saving = false
        if (this.menu.selectedTree !== this) return
        if (!ack.ok) {
            this.status.text = nicknameErrorText(ack.error)
            return
        }
        this.menu.onlineHub.setAccount(ack.account)
        this.back()
    }
    click(pos) {
        this.input.click(pos)
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.input.draw(ctx)
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}

// 'tutorial': every entry of options/tutorials.js, all playable; a check mark next to the
// passed ones (readTutorialPassed, re-read on every enter). The entries fill columns of
// ROWS buttons below the logo (16 tutorials = 3 columns); all titles share the font size
// that fits the longest one.
class TutorialTree {
    FIRST_Y = 0.26 * HEIGHT
    INTERVAL_Y = 0.1 * HEIGHT
    ROWS = 6
    COLUMN_STEP = 0.325 * WIDTH
    BUTTON_WIDTH = 0.22 * WIDTH
    BUTTON_HEIGHT = 0.08 * HEIGHT
    constructor(_menu) {
        this.menu = _menu
        this.backButton = new Empty()
        this.entries = []
        this.passed = []
        this.buttons = [this.backButton]
    }
    get columns() {
        return Math.max(1, Math.ceil(tutorials.length / this.ROWS))
    }
    // Top-left of entry `index`; the columns (button + check mark) are centred as a block.
    entryPos(index) {
        const blockWidth = (this.columns - 1) * this.COLUMN_STEP + this.BUTTON_WIDTH +
            menuOptions.marginLeft + menuOptions.rectSize
        return {x: (WIDTH - blockWidth) / 2 + Math.floor(index / this.ROWS) * this.COLUMN_STEP,
            y: this.FIRST_Y + (index % this.ROWS) * this.INTERVAL_Y}
    }
    // The menu is built before mainCtx exists: measure with an own context in Text's font.
    fontSizeFor(titles) {
        const fontSize = Menu.getButtonText('').fontSize, maxWidth = this.BUTTON_WIDTH * 0.9
        const measure = document.createElement('canvas').getContext('2d')
        measure.font = fontSize + 'px Times New Roman'
        const width = Math.max(...titles.map(title => measure.measureText(title).width))
        return width > maxWidth ? Math.floor(fontSize * maxWidth / width) : fontSize
    }
    getButton(pos, title, fontSize, clickFunc, parameters, callThis) {
        const rect = Menu.getButtonRect(pos)
        rect.width = this.BUTTON_WIDTH
        rect.height = this.BUTTON_HEIGHT
        const text = Menu.getButtonText(title)
        text.fontSize = fontSize
        return new MenuButton(rect, text, clickFunc, parameters, true, callThis)
    }
    setParent(parent, _menu) {
        const pos = {x: WIDTH / 2 - this.BUTTON_WIDTH / 2, y: this.FIRST_Y + Math.min(tutorials.length, this.ROWS) * this.INTERVAL_Y}
        this.backButton = this.getButton(pos, 'back', this.fontSizeFor(['back']), _menu.setTree, parent, _menu)
        this.update()
    }
    enter() {
        this.update()
    }
    update() {
        this.passed = readTutorialPassed()
        const size = menuOptions.rectSize
        const fontSize = this.fontSizeFor(tutorials.map(tutorial => tutorial.title))
        this.entries = tutorials.map((tutorial, index) => {
            const button = this.getButton(this.entryPos(index), tutorial.title, fontSize, TutorialManager.start,
                tutorial.id, TutorialManager)
            const checkMark = this.passed.includes(tutorial.id) ? new JustImage('checkMark',
                {x: button.rect.x + button.rect.width + menuOptions.marginLeft + size / 2, y: button.rect.centerY},
                size, size) : null
            return {id: tutorial.id, button, checkMark}
        })
        this.buttons = [...this.entries.map(entry => entry.button), this.backButton]
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        for (const button of this.buttons) button.draw(ctx)
        for (const entry of this.entries) {
            const mark = entry.checkMark
            if (mark && Text.menuTheme) CheckBox.drawMark(ctx, mark.pos, mark.width, Text.menuTheme.text)
            else mark?.draw(ctx)
        }
    }
}

// Hot seat entry: start a new game or load a saved one. 'load game' is greyed out
// and ignores clicks while every save slot is empty.
class HotseatChoiceTree extends Tree {
    constructor(_menu, pos, slotsCount) {
        const newGame = Menu.getButton(pos, 'new game', _menu.setTree, _menu.play, true, _menu)
        newGame.primary = true
        const loadGame = Menu.getButton(pos, 'load game', _menu.setTree, _menu.load, true, _menu)
        super([newGame, loadGame], _menu)
        this.loadButton = loadGame
        this.slotsCount = slotsCount
    }
    hasSave() {
        for (let i = 0; i < this.slotsCount; ++i)
            if (loadSlotInfo(i).whooseTurn != -1) return true
        return false
    }
    enter() {
        this.loadButton.canClick = this.hasSave()
    }
    draw(ctx) {
        super.draw(ctx)
        if (!this.loadButton.canClick) this.loadButton.drawDisabled(ctx)
    }
}
// The menu look on every menu screen, whatever the visuals settings: a night sky, the logo with a light halo and a
// gold beta tag. Sizes and positions are fractions of WIDTH and HEIGHT.
class MenuSky {
    canvas = null
    width = 0
    height = 0
    // How many times the sky was painted: once per viewport size, not per frame.
    rasterizations = 0
    // Covers every pixel with opaque colour, so the menu needs no clearRect.
    draw(ctx) {
        if (this.width !== WIDTH || this.height !== HEIGHT) this.rasterize()
        if (this.canvas) ctx.drawImage(this.canvas, 0, 0)
        else {
            ctx.fillStyle = '#18264a'
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
        }
    }
    rasterize() {
        this.width = WIDTH
        this.height = HEIGHT
        ++this.rasterizations
        const canvas = document.createElement('canvas')
        canvas.width = WIDTH
        canvas.height = HEIGHT
        try {
            this.paint(canvas.getContext('2d', {alpha: false}))
            this.canvas = canvas
        } catch (error) {
            // Stub canvases of headless runtimes: the flat sky colour.
            this.canvas = null
        }
    }
    paint(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
        sky.addColorStop(0, '#0f1a33')
        sky.addColorStop(0.55, '#18264a')
        sky.addColorStop(1, '#22223e')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        // Warm orange nebula at the top left, faint violet at the top right.
        this.glow(ctx, WIDTH * 0.12, HEIGHT * 0.08, Math.max(WIDTH, HEIGHT) * 0.38, '214, 128, 64', 0.42)
        this.glow(ctx, WIDTH * 0.9, HEIGHT * 0.12, Math.max(WIDTH, HEIGHT) * 0.3, '128, 96, 200', 0.2)
        // Sparse small stars from a fixed seed, so every frame and every run has the same sky.
        let seed = 1190
        const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
        const radius = Math.min(WIDTH, HEIGHT) * 0.0018
        for (let i = 0; i < 70; ++i) {
            const x = random() * WIDTH, y = random() * HEIGHT, size = radius * (0.6 + random() * 0.9)
            ctx.fillStyle = `rgba(235, 232, 255, ${(0.25 + random() * 0.5).toFixed(2)})`
            ctx.beginPath()
            ctx.arc(x, y, size, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    glow(ctx, x, y, radius, rgb, alpha) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
        glow.addColorStop(0, `rgba(${rgb}, ${alpha})`)
        glow.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.4})`)
        glow.addColorStop(1, `rgba(${rgb}, 0)`)
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }
}

// The logo with a thin light halo, so its dark bow-shaped "c" stays readable on the sky. Halo and logo are painted
// once per logo size, after the logo image has loaded; each frame copies that raster.
class HaloLogo {
    halo = null
    haloKey = ''
    constructor(image, pos, w, h) {
        this.image = image
        this.pos = pos
        this.w = w
        this.h = h
    }
    get margin() {
        return this.h * 0.12
    }
    get bounds() {
        const margin = this.margin
        return {x: this.pos.x - this.w / 2 - margin, y: this.pos.y - this.h / 2 - margin,
            width: this.w + margin * 2, height: this.h + margin * 2}
    }
    draw(ctx) {
        const image = assets[this.image]
        const key = `${this.w}x${this.h}`
        if (this.haloKey !== key && image?.complete && image.naturalWidth) {
            this.haloKey = key
            this.halo = this.paintHalo(image)
        }
        // Unscaled at whole pixels: a plain copy each frame.
        if (this.halo) {
            const bounds = this.bounds
            ctx.drawImage(this.halo, Math.round(bounds.x), Math.round(bounds.y))
        } else drawImage(ctx, this.image, this.pos, this.w, this.h)
    }
    paintHalo(image) {
        try {
            const margin = this.margin, width = Math.ceil(this.w + margin * 2), height = Math.ceil(this.h + margin * 2)
            // The logo's shape in the halo colour.
            const shape = document.createElement('canvas')
            shape.width = width
            shape.height = height
            const shapeCtx = shape.getContext('2d')
            shapeCtx.drawImage(image, margin, margin, this.w, this.h)
            shapeCtx.globalCompositeOperation = 'source-in'
            shapeCtx.fillStyle = '#f3ead8'
            shapeCtx.fillRect(0, 0, width, height)
            const halo = document.createElement('canvas')
            halo.width = width
            halo.height = height
            const ctx = halo.getContext('2d')
            // A soft glow, then a thin ring: the shape stamped around a small circle.
            ctx.shadowColor = 'rgba(243, 234, 216, 0.55)'
            ctx.shadowBlur = this.h * 0.1
            ctx.drawImage(shape, 0, 0)
            ctx.shadowColor = 'transparent'
            ctx.shadowBlur = 0
            const ring = this.h * 0.022
            for (let i = 0; i < 16; ++i) {
                const angle = Math.PI * 2 * i / 16
                ctx.drawImage(shape, Math.cos(angle) * ring, Math.sin(angle) * ring)
            }
            ctx.drawImage(image, margin, margin, this.w, this.h)
            return halo
        } catch (error) {
            // Stub canvases of headless runtimes: the logo without a halo.
            return null
        }
    }
}

// A small gold "beta" tag at the top right, clear of the logo.
class BetaTag {
    constructor() {
        this.text = new Text(WIDTH * 0.935, HEIGHT * 0.065, Math.min(WIDTH * 0.012, HEIGHT * 0.026), 'beta', '#3a2410',
            'center', 'middle', 1, MENU_TITLE_FONT_FAMILY, 800)
        this.angle = 0.05
    }
    // The tag's size around its centre, before the rotation (measured in its font once the font has loaded).
    get size() {
        const fontSize = this.text.fontSize
        this.measure ??= document.createElement('canvas').getContext('2d')
        this.measure.font = this.text.font()
        return {width: this.measure.measureText(this.text.text).width + fontSize * 1.3, height: fontSize * 1.6}
    }
    // Axis-aligned box of the rotated tag.
    get bounds() {
        const {width, height} = this.size
        const cos = Math.abs(Math.cos(this.angle)), sin = Math.abs(Math.sin(this.angle))
        const boxWidth = width * cos + height * sin, boxHeight = width * sin + height * cos
        return {x: this.text.x - boxWidth / 2, y: this.text.y - boxHeight / 2, width: boxWidth, height: boxHeight}
    }
    draw(ctx) {
        const {width, height} = this.size
        ctx.save()
        ctx.translate(this.text.x, this.text.y)
        ctx.rotate(this.angle)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = height * 0.3
        ctx.shadowOffsetY = height * 0.08
        ctx.fillStyle = '#f2b45a'
        const left = -width / 2, top = -height / 2, radius = height * 0.2
        ctx.beginPath()
        ctx.moveTo(left + radius, top)
        ctx.arcTo(-left, top, -left, -top, radius)
        ctx.arcTo(-left, -top, left, -top, radius)
        ctx.arcTo(left, -top, left, top, radius)
        ctx.arcTo(left, top, -left, top, radius)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.translate(this.text.x, this.text.y)
        ctx.rotate(this.angle)
        const {x, y} = this.text.pos
        this.text.pos = {x: 0, y: height * 0.04}
        this.text.draw(ctx)
        this.text.pos = {x, y}
        ctx.restore()
    }
}

// The main screen's faction banners (TASK-1191): a gold rod across the upper middle, three cloth banners hanging from
// it and round icon buttons below them. Every size is a fraction of the banner width, which Menu.layoutMain derives
// from WIDTH and HEIGHT; the layout scales by the smaller of the width and height budgets.
function menuTime() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
// Ray casting: whether point lies inside the polygon [{x, y}, ...].
function pointInPolygon(point, polygon) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j]
        if ((a.y > point.y) !== (b.y > point.y) &&
            point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
}
function tracePolygon(ctx, polygon) {
    ctx.beginPath()
    ctx.moveTo(polygon[0].x, polygon[0].y)
    for (let i = 1; i < polygon.length; ++i) ctx.lineTo(polygon[i].x, polygon[i].y)
    ctx.closePath()
}
function shadeColor(hex, amount) {
    const value = parseInt(hex.slice(1), 16)
    const channel = shift => {
        const c = (value >> shift) & 255
        return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
    }
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}
function roundedRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
}
// Draws text in one line if it fits maxWidth, else in two lines; returns the
// box of what it drew.
function drawFittedLines(ctx, text, x, y, fontSize, maxWidth, lineHeight) {
    let lines = [text]
    if (ctx.measureText(text).width > maxWidth && text.includes(' ')) {
        // After a comma if there is one, else at the space nearest the middle.
        const spaces = [...text.matchAll(/ /g)].map(match => match.index)
        const middle = text.includes(', ') ? text.indexOf(', ') + 1 :
            spaces.reduce((best, index) => Math.abs(index - text.length / 2) < Math.abs(best - text.length / 2) ? index : best)
        lines = [text.slice(0, middle), text.slice(middle + 1)]
    }
    let width = 0
    lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * fontSize * lineHeight)
        width = Math.max(width, ctx.measureText(line).width)
    })
    return {x: x - width / 2, y: y - fontSize * 0.5, width, height: fontSize * (1 + (lines.length - 1) * lineHeight), lines}
}

class MenuBannerRod {
    constructor() {
        this.left = this.right = this.y = this.thickness = this.knob = 0
    }
    get bounds() {
        return {x: this.left - this.knob, y: this.y - this.knob, width: this.right - this.left + this.knob * 2, height: this.knob * 2}
    }
    draw(ctx) {
        const bar = ctx.createLinearGradient(0, this.y - this.thickness / 2, 0, this.y + this.thickness / 2)
        bar.addColorStop(0, '#f6dc98')
        bar.addColorStop(0.5, '#c99a4a')
        bar.addColorStop(1, '#8a6227')
        ctx.fillStyle = bar
        roundedRectPath(ctx, this.left, this.y - this.thickness / 2, this.right - this.left, this.thickness, this.thickness / 2)
        ctx.fill()
        for (const x of [this.left, this.right]) {
            const knob = ctx.createRadialGradient(x - this.knob * 0.35, this.y - this.knob * 0.35, this.knob * 0.1, x, this.y, this.knob)
            knob.addColorStop(0, '#fbe7b0')
            knob.addColorStop(0.6, '#d3a656')
            knob.addColorStop(1, '#8a6227')
            ctx.fillStyle = knob
            ctx.beginPath()
            ctx.arc(x, this.y, this.knob, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

// Banner emblems, painted inside the disc (already clipped to it). Geometry is in fractions of the disc radius r.
// A plain assets key (e.g. 'noob') draws that sprite.
const MENU_EMBLEMS = {
    // Hot seat: two swordsmen face each other, swords crossing, on a red/blue background split at about 120 deg.
    faceoff: {
        assets: ['normchel'],
        paint(ctx, disc) {
            const {x, y, r} = disc
            ctx.fillStyle = '#e8aaa2'
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
            const dx = Math.cos(Math.PI * 2 / 3) * r * 2, dy = Math.sin(Math.PI * 2 / 3) * r * 2
            ctx.fillStyle = '#a9c4e4'
            ctx.beginPath()
            ctx.moveTo(x - dx, y - dy)
            ctx.lineTo(x + dx, y + dy)
            ctx.lineTo(x + r * 2, y + r * 2)
            ctx.lineTo(x + r * 2, y - r * 2)
            ctx.closePath()
            ctx.fill()
            // The sprite holds its sword at 0.24 of its width; the hilts stand just apart so the blades cross above them.
            const size = r * 1.3, centre = r * 0.055 + size * 0.26, centreY = y + r * 0.9 - size * 0.44
            for (const side of [-1, 1]) {
                ctx.save()
                ctx.translate(x + side * centre, centreY)
                ctx.scale(side, 1)
                drawImage(ctx, 'normchel', {x: 0, y: 0}, size, size)
                ctx.restore()
            }
        },
    },
    // Play online: a red and a green town cell, each with a glow in its player colour, linked by a dashed arc that
    // leaves from behind one roof and enters behind the other.
    towns: {
        assets: ['menu/towncell-red', 'menu/towncell-green'],
        layout(disc) {
            const {x, y, r} = disc
            const width = r * 0.86, height = width * 249 / 287, cy = y + r * 0.2
            const cells = [
                {image: 'menu/towncell-red', glow: 'rgba(255, 0, 0, 0.8)', x: x - r * 0.465, y: cy, width, height},
                {image: 'menu/towncell-green', glow: 'rgba(0, 179, 0, 0.8)', x: x + r * 0.465, y: cy, width, height}]
            // The arc's ends lie on the roofs to the inner side of the towers; its top is above the cells.
            const endX = r * 0.465 - width * 0.2, endY = cy - height * 0.28, topY = cy - height / 2 - r * 0.2
            const sag = endY - topY, radius = (endX * endX + sag * sag) / (2 * sag)
            const half = Math.asin(endX / radius)
            return {cells, arc: {x, y: topY + radius, radius, from: -Math.PI / 2 - half, to: -Math.PI / 2 + half,
                width: r * 0.07, dash: [r * 0.12, r * 0.1]}}
        },
        paint(ctx, disc, {arc = true} = {}) {
            const layout = this.layout(disc)
            if (arc) {
                const a = layout.arc
                ctx.save()
                ctx.strokeStyle = '#b07a2c'
                ctx.lineWidth = a.width
                ctx.lineCap = 'round'
                ctx.setLineDash(a.dash)
                ctx.beginPath()
                ctx.arc(a.x, a.y, a.radius, a.from, a.to)
                ctx.stroke()
                ctx.restore()
            }
            for (const cell of layout.cells) {
                ctx.save()
                ctx.shadowColor = cell.glow
                ctx.shadowBlur = disc.r * 0.2
                drawImage(ctx, cell.image, cell, cell.width, cell.height)
                ctx.restore()
            }
        },
    },
}
function menuEmblem(name) {
    return MENU_EMBLEMS[name] ?? {assets: [name], paint(ctx, disc) {
        const size = disc.r * 1.75
        drawImage(ctx, name, {x: disc.x, y: disc.y + disc.r * 0.08}, size, size)
    }}
}

// One cloth banner. text.text is the menu entry's label (the tests find entries by it); name is what it shows.
// The click target is the swallowtail polygon, rect only its bounding box.
class MenuBanner extends Button {
    constructor(label, name, description, color, clickFunc, parameters, callThis, {featured = false, emblem = null} = {}) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, label), clickFunc, parameters, true, callThis)
        this.name = name
        this.description = description
        this.baseColor = color
        this.featured = featured
        this.emblem = emblem
        this.emblemOptions = {}
        this.hovered = false
        this.pressed = false
        this.activeSince = 0
        this.raster = null
        this.rasterKey = ''
        this.glow = null
        this.boxes = {}
    }
    // Places the banner: top-left x, top y, width w, height h (to the swallowtail points).
    place(x, y, w, h) {
        this.rect = new Rect(x, y, w, h)
        this.text.pos = this.rect.center
        this.notch = w * 0.26
        this.rasterKey = ''
    }
    get polygon() {
        const {x, y, width: w, height: h} = this.rect
        return [{x, y}, {x: x + w, y}, {x: x + w, y: y + h}, {x: x + w / 2, y: y + h - this.notch}, {x, y: y + h}]
    }
    isInside(point) {
        return pointInPolygon(point, this.polygon)
    }
    get active() {
        return this.hovered || this.pressed
    }
    setActive(hovered, pressed) {
        const was = this.active
        this.hovered = hovered
        this.pressed = pressed
        if (!was && this.active) this.activeSince = menuTime()
    }
    hover(pos) {
        this.setActive(this.isInside(pos), this.pressed)
    }
    select(pos) {
        this.setActive(this.hovered, this.isInside(pos))
    }
    removeSelect() {
        this.setActive(this.hovered, false)
    }
    clearActive() {
        this.setActive(false, false)
    }
    // A short damped swing about the rod after the pointer arrives.
    get angle() {
        if (!this.active) return 0
        const t = (menuTime() - this.activeSince) / 1000
        return 0.035 * Math.sin(t * Math.PI * 2 / 0.9) * Math.exp(-t / 0.7)
    }
    get margin() {
        return this.rect.width * 0.25
    }
    draw(ctx) {
        const {x, y, width: w} = this.rect
        const key = `${x},${y},${w},${this.emblemKey()}`
        if (this.rasterKey !== key) {
            this.rasterKey = key
            this.raster = this.rasterize()
        }
        ctx.save()
        const pivotX = x + w / 2
        ctx.translate(pivotX, y)
        ctx.rotate(this.angle)
        ctx.translate(-pivotX, -y)
        if (this.featured && this.glow) {
            // A slow soft gold pulse behind the Tutorial banner.
            ctx.globalAlpha = 0.55 + 0.45 * Math.sin(menuTime() / 1000 * Math.PI * 2 / 2.8)
            ctx.drawImage(this.glow, x - this.margin, y - this.margin)
            ctx.globalAlpha = 1
        }
        if (this.raster) ctx.drawImage(this.raster, x - this.margin, y - this.margin)
        else this.paint(ctx)
        if (this.active) {
            ctx.fillStyle = 'rgba(255, 246, 225, 0.12)'
            tracePolygon(ctx, this.polygon)
            ctx.fill()
        }
        ctx.restore()
    }
    emblemReady() {
        return !this.emblem || menuEmblem(this.emblem).assets.every(key => assets[key]?.complete && assets[key].naturalWidth)
    }
    // Changes when an emblem image loads or is reloaded from another sprite folder (usePolishedSprites).
    emblemKey() {
        return this.emblem ? `${this.emblemReady()},${menuEmblem(this.emblem).assets.map(key => assets[key]?.src).join(',')}` : ''
    }
    canvasFor(paint) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(this.rect.width + this.margin * 2)
        canvas.height = Math.ceil(this.rect.height + this.margin * 2)
        const ctx = canvas.getContext('2d')
        ctx.translate(this.margin - this.rect.x, this.margin - this.rect.y)
        paint(ctx)
        return canvas
    }
    rasterize() {
        try {
            if (this.featured) this.glow = this.canvasFor(ctx => {
                ctx.shadowColor = 'rgba(246, 196, 96, 0.9)'
                ctx.shadowBlur = this.rect.width * 0.16
                ctx.fillStyle = 'rgba(246, 196, 96, 0.6)'
                tracePolygon(ctx, this.polygon)
                ctx.fill()
            })
            return this.canvasFor(ctx => this.paint(ctx))
        } catch (error) {
            // Stub canvases of headless runtimes draw the banner directly.
            this.glow = null
            return null
        }
    }
    paint(ctx) {
        const {x, y, width: w, height: h} = this.rect
        const color = this.baseColor, polygon = this.polygon
        // Cloth with vertical folds and a drop shadow.
        ctx.save()
        ctx.shadowColor = 'rgba(4, 8, 24, 0.55)'
        ctx.shadowBlur = w * 0.09
        ctx.shadowOffsetY = w * 0.035
        const cloth = ctx.createLinearGradient(x, 0, x + w, 0)
        cloth.addColorStop(0, shadeColor(color, -0.22))
        cloth.addColorStop(0.16, color)
        cloth.addColorStop(0.32, shadeColor(color, 0.12))
        cloth.addColorStop(0.5, shadeColor(color, -0.08))
        cloth.addColorStop(0.7, shadeColor(color, 0.1))
        cloth.addColorStop(0.86, color)
        cloth.addColorStop(1, shadeColor(color, -0.25))
        ctx.fillStyle = cloth
        tracePolygon(ctx, polygon)
        ctx.fill()
        ctx.restore()
        // The cloth folded over the rod.
        const fold = ctx.createLinearGradient(0, y, 0, y + w * 0.06)
        fold.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
        fold.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = fold
        ctx.fillRect(x, y, w, w * 0.06)
        this.paintTrim(ctx)
        this.paintEmblem(ctx)
        this.paintTexts(ctx)
    }
    // A dashed light stitch inset along the sides and the swallowtail; the featured banner has a solid gold trim.
    paintTrim(ctx) {
        const {x, y, width: w, height: h} = this.rect
        const inset = w * 0.045, slope = this.notch / (w / 2), lift = inset * Math.sqrt(1 + slope * slope)
        const top = y + w * 0.05
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(x + inset, top)
        ctx.lineTo(x + inset, y + h - slope * inset - lift)
        ctx.lineTo(x + w / 2, y + h - this.notch - lift)
        ctx.lineTo(x + w - inset, y + h - slope * inset - lift)
        ctx.lineTo(x + w - inset, top)
        if (this.featured) {
            ctx.strokeStyle = '#e2b860'
            ctx.lineWidth = w * 0.012
        } else {
            ctx.strokeStyle = 'rgba(255, 244, 224, 0.7)'
            ctx.lineWidth = w * 0.006
            ctx.setLineDash([w * 0.025, w * 0.02])
        }
        ctx.stroke()
        ctx.restore()
    }
    get disc() {
        const {x, y, width: w} = this.rect
        return {x: x + w / 2, y: y + w * (this.featured ? 0.6 : 0.52), r: w * 0.33}
    }
    paintEmblem(ctx) {
        const disc = this.disc
        ctx.save()
        ctx.fillStyle = shadeColor(this.baseColor, -0.3)
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r * 1.07, 0, Math.PI * 2)
        ctx.fill()
        const ring = ctx.createLinearGradient(0, disc.y - disc.r, 0, disc.y + disc.r)
        ring.addColorStop(0, '#f2d38c')
        ring.addColorStop(1, '#b8873c')
        ctx.fillStyle = ring
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2)
        ctx.fill()
        const cream = ctx.createRadialGradient(disc.x, disc.y - disc.r * 0.3, disc.r * 0.1, disc.x, disc.y, disc.r * 0.92)
        cream.addColorStop(0, '#f6eedb')
        cream.addColorStop(1, '#dccbaa')
        ctx.fillStyle = cream
        ctx.beginPath()
        ctx.arc(disc.x, disc.y, disc.r * 0.92, 0, Math.PI * 2)
        ctx.fill()
        if (this.emblem && this.emblemReady()) {
            ctx.clip()
            menuEmblem(this.emblem).paint(ctx, disc, this.emblemOptions)
        }
        ctx.restore()
        this.boxes.disc = {x: disc.x - disc.r * 1.07, y: disc.y - disc.r * 1.07, width: disc.r * 2.14, height: disc.r * 2.14}
    }
    paintTexts(ctx) {
        const {x, y, width: w} = this.rect
        const inner = w * 0.82, cx = x + w / 2, disc = this.disc
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
        ctx.shadowBlur = w * 0.02
        ctx.shadowOffsetY = w * 0.008
        // The name shrinks to fit the banner.
        let nameSize = w * (this.featured ? 0.13 : 0.12)
        ctx.font = `800 ${nameSize}px ${MENU_TITLE_FONT_FAMILY}`
        const nameWidth = ctx.measureText(this.name).width
        if (nameWidth > inner) {
            nameSize *= inner / nameWidth
            ctx.font = `800 ${nameSize}px ${MENU_TITLE_FONT_FAMILY}`
        }
        const nameY = disc.y + disc.r * 1.07 + w * 0.16
        ctx.fillStyle = '#fff4e0'
        ctx.fillText(this.name, cx, nameY)
        const drawnName = Math.min(nameWidth, inner)
        this.boxes.name = {x: cx - drawnName / 2, y: nameY - nameSize / 2, width: drawnName, height: nameSize}
        const descriptionSize = w * 0.08
        ctx.font = `500 ${descriptionSize}px ${MENU_FONT_FAMILY}`
        if ('wordSpacing' in ctx) ctx.wordSpacing = `${descriptionSize * 0.12}px`
        ctx.fillStyle = 'rgba(255, 244, 224, 0.88)'
        const description = drawFittedLines(ctx, this.description, cx, nameY + nameSize * 0.6 + w * 0.08,
            descriptionSize, inner, 1.3)
        this.boxes.description = {x: description.x, y: description.y, width: description.width, height: description.height}
        this.descriptionLines = description.lines
        ctx.restore()
        if (this.featured) this.paintTag(ctx)
    }
    // The gold "Start here" tag at the top of the featured banner.
    paintTag(ctx) {
        const {x, y, width: w} = this.rect
        // Never below the menu's smallest readable size (1.6% of HEIGHT).
        const size = Math.max(w * 0.055, HEIGHT * 0.018)
        ctx.save()
        ctx.font = `700 ${size}px ${MENU_TITLE_FONT_FAMILY}`
        const width = ctx.measureText('Start here').width + size * 1.6, height = size * 1.75
        const left = x + w / 2 - width / 2, top = y + w * 0.06
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = size * 0.5
        ctx.shadowOffsetY = size * 0.12
        const gold = ctx.createLinearGradient(0, top, 0, top + height)
        gold.addColorStop(0, '#f8d58a')
        gold.addColorStop(1, '#e0a84e')
        ctx.fillStyle = gold
        roundedRectPath(ctx, left, top, width, height, height * 0.22)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = '#3a2410'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Start here', x + w / 2, top + height * 0.53)
        ctx.restore()
        this.boxes.tag = {x: left, y: top, width, height}
    }
}

// A round dark-blue button with a gold ring, an icon and a caption to its right (Settings, Replays).
class MenuIconButton extends Button {
    constructor(label, caption, icon, clickFunc, parameters, callThis) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, label), clickFunc, parameters, true, callThis)
        this.caption = caption
        this.icon = icon
        this.hovered = false
        this.pressed = false
        this.center = {x: 0, y: 0}
        this.radius = 0
    }
    get captionSize() {
        return this.radius * 0.72
    }
    // The caption's width, measured in the menu font.
    captionWidth() {
        try {
            this.measure ??= document.createElement('canvas').getContext('2d')
            this.measure.font = `500 ${this.captionSize}px ${MENU_FONT_FAMILY}`
            const width = this.measure.measureText(this.caption).width
            if (Number.isFinite(width) && width > 0) return width
        } catch (error) {}
        return this.captionSize * this.caption.length * 0.5
    }
    get groupWidth() {
        return this.radius * 2.35 + this.captionWidth()
    }
    // Places the group (circle and caption) with its left edge at left and the circle centred on centerY.
    place(left, centerY, radius) {
        this.radius = radius
        this.center = {x: left + radius, y: centerY}
        this.rect = new Rect(left, centerY - radius, this.groupWidth, radius * 2)
        this.text.pos = this.rect.center
    }
    get circleBounds() {
        return {x: this.center.x - this.radius, y: this.center.y - this.radius, width: this.radius * 2, height: this.radius * 2}
    }
    hover(pos) {
        this.hovered = this.isInside(pos)
    }
    select(pos) {
        this.pressed = this.isInside(pos)
    }
    removeSelect() {
        this.pressed = false
    }
    clearActive() {
        this.hovered = this.pressed = false
    }
    draw(ctx) {
        const {x, y} = this.center, active = this.hovered || this.pressed
        const r = this.radius * (this.pressed ? 0.94 : 1)
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
        ctx.shadowBlur = r * 0.35
        ctx.shadowOffsetY = r * 0.08
        ctx.fillStyle = active ? '#2b3d72' : '#1d2a55'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.strokeStyle = active ? '#f2cf7e' : '#d6a855'
        ctx.lineWidth = r * 0.09
        ctx.beginPath()
        ctx.arc(x, y, r * 0.93, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = ctx.fillStyle = active ? '#fbe6b4' : '#f0d9a6'
        ctx.lineWidth = r * 0.07
        if (this.icon === 'gear') this.drawGear(ctx, x, y, r * 0.4)
        else this.drawPlay(ctx, x, y, r * 0.38)
        ctx.font = `500 ${this.captionSize}px ${MENU_FONT_FAMILY}`
        ctx.fillStyle = active ? '#ffffff' : '#e8e2d4'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.caption, this.center.x + this.radius * 1.35, y)
        ctx.restore()
    }
    drawGear(ctx, x, y, r) {
        ctx.beginPath()
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
        ctx.stroke()
        for (let i = 0; i < 8; ++i) {
            const angle = Math.PI * 2 * i / 8, cos = Math.cos(angle), sin = Math.sin(angle)
            ctx.beginPath()
            ctx.moveTo(x + cos * r * 0.68, y + sin * r * 0.68)
            ctx.lineTo(x + cos * r, y + sin * r)
            ctx.stroke()
        }
    }
    drawPlay(ctx, x, y, r) {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.55, y - r * 0.8)
        ctx.lineTo(x + r * 0.85, y)
        ctx.lineTo(x - r * 0.55, y + r * 0.8)
        ctx.closePath()
        ctx.fill()
    }
}

// The main screen: the rod, the banners hanging from it and the icon buttons.
class MainTree extends Tree {
    constructor(buttons, _menu) {
        super(buttons, _menu)
        this.rod = new MenuBannerRod()
    }
    hover(pos) {
        for (const button of this.buttons) button.hover?.(pos)
    }
    leave() {
        for (const button of this.buttons) button.clearActive?.()
    }
    draw(ctx) {
        this.rod.draw(ctx)
        super.draw(ctx)
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
    // 'replays' is listed only with otherSettings.showReplays.
    updateMainButtons() {
        this.main.buttons = this.mainButtons.filter(button =>
            button.text.text !== 'replays' || otherSettings.showReplays)
        this.layoutMain()
    }
    // Banner sizes in banner widths: side banners 1 x 1.94, Tutorial 1.16 x 2.18, gaps 0.2, the rod 0.24 past the
    // outer banners. The banner width is the smaller of what the screen width and the height between the logo and
    // the icon buttons allow.
    layoutMain() {
        const [hotseat, online, settings, tutorial, replays] = this.mainButtons
        const iconRadius = Math.min(HEIGHT * 0.045, WIDTH * 0.03)
        const iconY = HEIGHT * 0.965 - iconRadius
        const logo = this.logo.bounds
        const rodY = logo.y + logo.height + HEIGHT * 0.035
        const bottom = iconY - iconRadius - HEIGHT * 0.035
        const SIDE_HEIGHT = 1.94, TUTORIAL_WIDTH = 1.16, TUTORIAL_HEIGHT = 2.18, GAP = 0.2, OVERHANG = 0.24, KNOB = 0.05
        const rowWidth = 2 + TUTORIAL_WIDTH + GAP * 2
        const w = Math.min(WIDTH * 0.92 / (rowWidth + (OVERHANG + KNOB) * 2), (bottom - rodY) / TUTORIAL_HEIGHT)
        const rod = this.main.rod
        rod.thickness = w * 0.035
        rod.knob = w * KNOB
        rod.y = rodY
        const top = rodY - rod.thickness / 2
        let x = WIDTH / 2 - rowWidth * w / 2
        rod.left = x - OVERHANG * w
        hotseat.place(x, top, w, w * SIDE_HEIGHT)
        x += w * (1 + GAP)
        tutorial.place(x, top, w * TUTORIAL_WIDTH, w * TUTORIAL_HEIGHT)
        x += w * (TUTORIAL_WIDTH + GAP)
        online.place(x, top, w, w * SIDE_HEIGHT)
        rod.right = x + w + OVERHANG * w
        // Settings, and Replays next to it when listed, centred under the banners.
        const icons = this.main.buttons.includes(replays) ? [settings, replays] : [settings]
        const spacing = iconRadius * 1.2
        const groups = icons.map(icon => { icon.radius = iconRadius; return icon.groupWidth })
        let left = WIDTH / 2 - (groups.reduce((sum, width) => sum + width, 0) + spacing * (icons.length - 1)) / 2
        icons.forEach((icon, index) => {
            icon.place(left, iconY, iconRadius)
            left += groups[index] + spacing
        })
    }
    setTree(tree) {
        if (tree === this.main) this.updateMainButtons()
        if (this.selectedTree !== tree) this.selectedTree?.leave?.()
        this.previousTree = this.selectedTree
        this.selectedTree = tree
        if (this.previousTree !== tree) tree.enter?.()
    }
    openOnline() {
        // Late results are dropped once the user has moved elsewhere.
        let expected = this.main
        openOnlineSession({
            hub: account => {
                if (this.selectedTree !== expected) return false
                this.onlineHub.setAccount(account)
                this.setTree(this.onlineHub)
                expected = this.onlineHub
            },
            signIn: () => {
                if (this.selectedTree === expected) this.setTree(this.signIn)
            },
        })
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
        this.sky = new MenuSky()
        // Sized by the width, on screens wider than 16:9 (2560x1080, phones) as on a 16:9 one, so the halo stays on
        // screen and the first row below it stays clear.
        const logoScale = Math.min(WIDTH, HEIGHT * 16 / 9)
        this.logo = new HaloLogo('logo', { x: WIDTH / 2, y: HEIGHT * 0.15 }, logoScale * 0.5, logoScale * 0.55 * 0.2)
        this.betaTag = new BetaTag()

        let startPos = {x: WIDTH / 2 - WIDTH * 0.25 / 2, y: HEIGHT * 0.3}

        // The new game's slot screen is the load screen whose every slot card starts the game in (overwrites) it.
        this.startGame = new LoadTree(this, slotsCount, start, true)

        this.play = new HotseatSettingsTree(this)

        this.nickname = new NicknameTree(this)

        this.createLobby = new CreateLobbyTree(this)

        this.lobbyRoom = new LobbyRoomTree(this)

        this.onlineHub = new OnlineHubTree(this)

        this.signIn = new SignInTree(this)

        this.settings = new OtherSettingsTree(this)

        this.tutorial = new TutorialTree(this)

        this.replays = new ReplayTree(this)

        this.load = new LoadTree(this, slotsCount)

        this.hotseatChoice = new HotseatChoiceTree(this, startPos, slotsCount)

        // main.buttons keeps the order [hot seat, play online, settings, tutorial] (+ replays); on screen the banners
        // read hot seat, tutorial (centre), play online, with the icon buttons below.
        this.main = new MainTree([
            new MenuBanner('hot seat', 'Hot seat', 'Competitive or co-op, one device', '#c22d26',
                this.setTree, this.hotseatChoice, this, {emblem: 'faceoff'}),
            new MenuBanner('play online', 'Play online', 'Create or join a lobby', '#3c78b0',
                this.openOnline, undefined, this, {emblem: 'towns'}),
            // 'play AI' button hidden for now; startAI is still available.
            new MenuIconButton('settings', 'Settings', 'gear', this.setTree, this.settings, this),
            new MenuBanner('tutorial', 'Tutorial', 'Learn the rules by playing', '#2f8f52',
                this.setTree, this.tutorial, this, {featured: true, emblem: 'noob'}),
        ], this)

        this.mainButtons = this.main.buttons.concat([
            new MenuIconButton('replays', 'Replays', 'play', this.setTree, this.replays, this)])
        this.updateMainButtons()
        this.hotseatChoice.setParent(this.main, this)
        this.play.setParent(this.hotseatChoice, this)
        this.onlineHub.setParent(this.main, this)
        this.createLobby.setParent(this.onlineHub, this)
        this.signIn.setParent(this.main, this)
        this.settings.setParent(this.main, this)
        this.startGame.setParent(this.play, this)
        this.load.setParent(this.hotseatChoice, this)
        this.tutorial.setParent(this.main, this)
        this.replays.setParent(this.main, this)
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
        this.updateMainButtons()
        this.updateSlotManagers()
        requestAnimationFrame(menuLoop)
    }
    setEvents(boolean) {
        if (boolean) {
            document.addEventListener('click', menuClick)
            document.addEventListener('wheel', menuWheel)
            document.addEventListener('keydown', menuKeyDown)
            document.addEventListener('mousemove', menuMouseMove)
            if (mobilePhone) {
                document.addEventListener('touchstart', menuTouchStart)
                document.addEventListener('touchmove', menuTouchMove)
                document.addEventListener('touchend', menuTouchEnd)
            }
        } else {
            document.removeEventListener('click', menuClick)
            document.removeEventListener('wheel', menuWheel)
            document.removeEventListener('keydown', menuKeyDown)
            document.removeEventListener('mousemove', menuMouseMove)
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
        // The load and start screens' slot panels:
        this.load.panel.update()
        this.startGame.panel.update()
    }
    // Ends the running game without showing the menu: back() and TutorialManager.switchTo.
    // Returns whether it was a lobby game. The game loop stops on its next frame (gameExit).
    stopGame() {
        gameExit = true
        const lobbyGame = onlineSession.openGameID !== null
        if (onlineSocket) {
            closeOnlineGameSocket()
            onlineLobby = null
        }
        onlineSession.closeGame()
        GameManager.clearWaitingMode()

        nextTurnPauseInterface.backToMenu()
        // A lobby game lives on the server, not in a save slot.
        if (!lobbyGame) saveManager.save() //some bugs or not

        // very important save first then pause timer
        // so that the timer saves the current remaining time
        timer.pauseAndSaveTime()

        removeEvents()
        return lobbyGame
    }
    back() {
        const lobbyGame = this.stopGame()
        menu.visible = true
        menu.start()
        // A lobby game returns to the hub, whose enter re-fetches lobby:list;
        // the hub already left when the game was entered.
        if (lobbyGame) {
            this.selectedTree = this.main
            this.setTree(this.onlineHub)
        } else menu.setTree(menu.main)
        this.updateSlotManagers()
    }
    click(pos) {
        this.selectedTree.click(pos)
    }
    wheel(pos, deltaY, deltaX) {
        this.selectedTree.wheel?.(pos, deltaY, deltaX)
    }
    mouseMove(pos) {
        this.selectedTree.hover?.(pos)
    }
    keydown(event) {
        this.selectedTree.scrollKey?.(event.key)
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
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        // Menu texts draw in the menu font; the game's texts keep Text's own default.
        const gameFamily = Text.defaultFamily, gameTitleFamily = Text.titleFamily
        Text.defaultFamily = MENU_FONT_FAMILY
        Text.titleFamily = MENU_TITLE_FONT_FAMILY
        // Menu controls draw in the menu theme (sprites/elements/text.js MENU_THEME).
        Text.menuTheme = MENU_THEME
        try {
            this.sky.draw(ctx)
            // Co-op uses the header space for its size selector.
            // A tree with its own logo and beta tag (the online hub, the hot seat setup screen) places them itself.
            const logo = this.selectedTree.logo ?? this.logo, betaTag = this.selectedTree.betaTag ?? this.betaTag
            if (this.selectedTree.logo || !this.selectedTree.isCoop) logo.draw(ctx)
            betaTag.draw(ctx)
            this.selectedTree.draw(ctx)
            this.drawGameSpritesWaiting(ctx)
            errorWindow.draw(ctx)
        } finally {
            Text.defaultFamily = gameFamily
            Text.titleFamily = gameTitleFamily
            Text.menuTheme = null
            ctx.restore()
        }
    }
}

// While a game entry waits for the game sprites: 'Loading…' over the pressed control (a centred pill without one).
Menu.prototype.drawGameSpritesWaiting = function(ctx) {
    if (!gameSpritesWaiting)
        return
    const rect = gameSpritesWaiting.control?.rect
    const box = rect && rect.width > 0 ? rect : {x: WIDTH * 0.35, y: HEIGHT * 0.86, width: WIDTH * 0.3, height: HEIGHT * 0.07}
    ctx.save()
    ctx.fillStyle = 'rgba(20, 16, 10, 0.72)'
    roundedRectPath(ctx, box.x, box.y, box.width, box.height, Math.min(box.width, box.height) * 0.12)
    ctx.fill()
    const dots = '.'.repeat(1 + Math.floor((performance.now() - gameSpritesWaiting.since) / 400) % 3)
    ctx.fillStyle = '#fbe7b0'
    ctx.font = `${Math.round(Math.min(box.height * 0.32, box.width * 0.12))}px ${MENU_FONT_FAMILY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Loading' + dots, box.x + box.width / 2, box.y + box.height / 2)
    ctx.restore()
}

let menu = new Menu()

function menuLoop() {
    if (!menu.visible)
        return
    menu.draw(interfaceCtx)
    requestAnimationFrame(menuLoop)
}
