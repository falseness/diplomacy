function toggleTownTrainInterfaceTab() {
    townInterface.toggleTrainInterfaceTab()
}
class TownInterface extends BarrackInterface {
    constructor() {
        super()
    }
    getTrainInterfaceY(index) {
        let y = super.getTrainInterfaceY(index)
        return y + this.switch.height
    }
    toggleTrainInterfaceTab() {
        this.switch.toggleSelect()
        this.trainInterfacesTab = this.switch.getSelectedText()
        this.invalidateRenderCache()
        
        let selected = gameEvent.selected
        selected.removeSelect()
        selected.select()
    }
    isTypeValid(type) {
        return true
    }
    wasClickOnButton(point) {
        if (this.switch.click(point)) {
            return true
        }
        if (super.wasClickOnButton(point)) {
            return true
        }
        gameEvent.selected.removeSelect()
        gameEvent.selected.select()
        return false
    }
    makeTrainInterfaces() {
        this.switch = new Switch(this.gold.x, this.gold.y + HEIGHT * 0.05,
            WIDTH * 0.115 * 2 / 1.075, WIDTH * 0.05, 0.04 * HEIGHT, 0.0015 * HEIGHT, '#f7f7f7',
                new Text(0, 0, WIDTH * 0.025, 'unit', '#747474'),
                new Text(0, 0, WIDTH * 0.025, 'building', '#747474'),
            toggleTownTrainInterfaceTab)
        
        let trainInterfaces = this.getTrainInterfaceInfo()
        
        this.trainInterfacesTab = 'unit'
        
        this.trainInterfaces = {
            building: {},
            unit: {}
        }
        
        let index = {
            unit: 0,
            building: 0
        }
        
        this.trainInterfacesCreationLoop(trainInterfaces, index)
    }
    clearTab(clearType) {
        for (let i in this.trainInterfaces[clearType]) {
            this.trainInterfaces[clearType][i].setCanTrain(false)
        }
    }
    changeUnitTab(town) {
        super.changeUnitTab(town)
        
        this.clearTab('building')
    }
    changeBuildingTab(town) {
        const type = 'building'
        
        let canTrainNew = !town.activeProduction
    
        for (let i in this.trainInterfaces[type]) {
            this.trainInterfaces[type][i].setCanTrain(canTrainNew)
            this.trainInterfaces[type][i].setButtonText('train')
        }
        if (!canTrainNew) {
            this.trainInterfaces[type][town.activeProduction].setCanTrain(true)
            this.trainInterfaces[type][town.activeProduction].setButtonText('choose')
        }
        
        this.clearTab('unit')
    }
    change(town, color) {
        this.background.color = color.hex
        this.setPanelColors(color.hex)
        
        if (this.trainInterfacesTab == 'unit') {
            if (town.isBadlyDamaged) {
                this.clearTab('unit')
                this.changeTrainingUnitButton(town)
            }
            else {
                this.changeUnitTab(town)
            }
        }
        else {
            if (town.isBadlyDamaged) {
                this.clearTab('building')
            }
            else {
                this.changeBuildingTab(town)
            }
        }
        this.switch.setSelectedColor(color.hex)
        
        this.goldText.text = town.info.gold
        this.badlyDamaged = !!town.isBadlyDamaged
        this.invalidateRenderCache()
        this.visible = true
    }
    // The Switch: the active half washed with a gold edge, the other one with a dashed gold outline; both texts in ink.
    drawContents(ctx) {
        super.drawContents(ctx)
        const halves = [[this.switch.buttonOne, this.switch.selected == 1], [this.switch.buttonTwo, this.switch.selected == 2]]
        const lw = Math.max(1, 0.0025 * HEIGHT)
        for (const [half, active] of halves) {
            const rect = half.rect
            if (active) {
                roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, rect.height * 0.2)
                ctx.fillStyle = this.panelColors.wash
                ctx.fill()
                ctx.strokeStyle = TRAIN_PANEL_GOLD
                ctx.lineWidth = lw
                ctx.stroke()
            }
            else {
                ctx.save()
                roundedRectPath(ctx, rect.x + lw, rect.y + lw, rect.width - 2 * lw, rect.height - 2 * lw, rect.height * 0.2)
                ctx.setLineDash([2.4 * lw, 2 * lw])
                ctx.lineCap = 'round'
                ctx.strokeStyle = TRAIN_PANEL_GOLD
                ctx.lineWidth = 1.3 * lw
                ctx.stroke()
                ctx.restore()
            }
            drawTrainPanelText(ctx, half.textString, rect.x + rect.width / 2, rect.y + rect.height / 2,
                half.text.fontSize * 0.85, rect.width * 0.88, ENTITY_PANEL_INK, 'center')
        }
        if (this.badlyDamaged)
            this.drawBadlyDamagedNotice(ctx)
    }
    // A 0-hp town cannot build: the rows faded under a parchment wash, a broken heart, why, and how it heals.
    drawBadlyDamagedNotice(ctx) {
        const rows = Object.values(this.trainInterfaces[this.trainInterfacesTab])
        if (!rows.length)
            return
        const bg = this.background
        const pad = 0.03 * 0.35 * HEIGHT
        const top = Math.min(...rows.map(row => row.y - row.image.height / 2)) - pad
        const bottom = Math.max(...rows.map(row => row.y + row.image.height / 2)) + pad
        const x0 = bg.x + bg.width * 0.12, x1 = bg.x + bg.width * 0.94, cx = (x0 + x1) / 2
        const fontSize = 0.35 * HEIGHT * 0.085
        ctx.save()
        ctx.fillStyle = 'rgba(236,220,186,0.78)'
        ctx.fillRect(bg.x + bg.width * 0.06, top, bg.width * 0.92, bottom - top)
        drawBrokenHeart(ctx, cx, top + (bottom - top) * 0.22 + fontSize * 0.75, fontSize * 1.5)
        ctx.font = `italic 600 ${fontSize}px ${Text.defaultFamily}`
        ctx.fillStyle = ENTITY_PANEL_INK
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const lines = wrapCanvasText(ctx, "can't build when at 0 hp", x1 - x0)
        const textY = top + (bottom - top) * 0.52
        lines.forEach((line, i) => ctx.fillText(line, cx, textY + i * fontSize * 1.2))
        ctx.globalAlpha = 0.6
        ctx.font = `italic ${fontSize * 0.7}px ${Text.defaultFamily}`
        ctx.fillText(`heals +${Town.healSpeed} hp a turn when not hit`, cx, textY + lines.length * fontSize * 1.2 + fontSize * 0.2,
            x1 - x0)
        ctx.restore()
    }
}
// A red heart with an ink outline and a cream crack, size wide, centred at (x, y).
function drawBrokenHeart(ctx, x, y, size) {
    ctx.save()
    ctx.translate(x - size / 2, y - size / 2)
    ctx.scale(size / 24, size / 24)
    ctx.beginPath()
    ctx.moveTo(12, 21)
    ctx.bezierCurveTo(4, 15, 1, 11, 1, 7)
    ctx.bezierCurveTo(1, 3.5, 4, 1.5, 6.8, 1.5)
    ctx.bezierCurveTo(9, 1.5, 11, 3, 12, 5)
    ctx.bezierCurveTo(13, 3, 15, 1.5, 17.2, 1.5)
    ctx.bezierCurveTo(20, 1.5, 23, 3.5, 23, 7)
    ctx.bezierCurveTo(23, 11, 20, 15, 12, 21)
    ctx.closePath()
    ctx.fillStyle = '#c0392b'
    ctx.fill()
    ctx.lineWidth = 1.4
    ctx.strokeStyle = ENTITY_PANEL_INK
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(12, 5)
    ctx.lineTo(10, 9)
    ctx.lineTo(14, 12)
    ctx.lineTo(11, 16)
    ctx.lineTo(12, 21)
    ctx.strokeStyle = '#f3e3c0'
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.restore()
}
// The text split into lines no wider than maxWidth in ctx's font (a single long word stays on its line).
function wrapCanvasText(ctx, text, maxWidth) {
    const lines = []
    let line = ''
    for (const word of text.split(' ')) {
        const next = line ? line + ' ' + word : word
        if (line && ctx.measureText(next).width > maxWidth) {
            lines.push(line)
            line = word
        }
        else
            line = next
    }
    lines.push(line)
    return lines
}
