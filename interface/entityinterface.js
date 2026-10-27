function destroySelected() {
    if (gameEvent.selected.isUnit) {
        console.error(`trying to destroy selected which is unit = ${gameEvent.selected.toJSON()}`)
        return
    }
    // The undo entry + destroy() body is shared with the headless rules API (options/actionApi.js).
    let entity = gameEvent.selected
    ActionRecorder.track(ActionRecorder.destroyAction(entity), () => destroyEntityWithUndo(entity))
    gameEvent.removeSelection()
}

function skipMovesOfSelected() {
    if (!gameEvent.selected.isUnit) {
        console.error(`trying to skip moves of selected which is not unit = ${gameEvent.selected.toJSON()}`)
        return
    }
    let unit = gameEvent.selected
    ActionRecorder.track(ActionRecorder.skipAction(unit), () => unit.skipMoves())
    gameEvent.removeSelection()
}
// The dark-brown ink of the panel's rows and button texts (the timer's, TASK-1340).
const ENTITY_PANEL_INK = '#4a2e14'
class EntityInterface {
    #visible = false
    
    createButtonInTheBottom(text, functionToHandle) {
        let button = {
            text: {
                text: text,
                color: '#747474',
                fontSize: this.height * 0.1
            },
            rect: {
                color: '#f7f7f7',
                cornerRadius: 0.02 * HEIGHT,
                borderColor: 'black',
                stroke: 0.0015 * HEIGHT,
                width: 0.11 * WIDTH,
                height: 0.05 * HEIGHT
            }
        }
        let result = new Button(
            new Rect(this.entity.name.x, HEIGHT - this.height * 0.075 - button.rect.height, 
                button.rect.width, button.rect.height, 
                [button.rect.cornerRadius, button.rect.cornerRadius, 
                button.rect.cornerRadius, button.rect.cornerRadius],
                button.rect.stroke, button.rect.color),
            new Text(0, 0, button.text.fontSize, button.text.text, button.text.color),
            functionToHandle
        )
        result.trimText()
        return result
    }

    constructor() {

        let stroke = 0.001 * WIDTH
        let cornerRadius = 0.03 * WIDTH
        let indent = this.stroke + this.cornerRadius

        this.pos = {
            x: 0,
            y: 0.6 * HEIGHT//0.55 * HEIGHT
        }
        this.height = HEIGHT - this.pos.y
        this.width = this.height * 1.7

        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, 
            [0, cornerRadius, 0, 0], stroke)

        this.img = new JustImage('', { x: this.pos.x + this.height * 0.38, y: this.pos.y + this.height * 0.5 },
            this.height * 0.775, this.height * 0.775)
        this.suburbImage = new SuburbImage(
            { x: this.pos.x + this.height * 0.38, y: this.pos.y + this.height * 0.5 },
            this.height * 0.275, this.height * 0.02)


        this.entity = {}

        this.entity.name = new Text(
            this.img.x + this.img.width / 2,
            this.pos.y + this.height * 0.02,
            this.height * 0.2
        )

        this.entity.name.textBaseline = 'top'
        this.entity.name.textAlign = 'left'

        this.entity.info = new Text(
            this.entity.name.x,
            this.entity.name.y + this.entity.name.height,
            this.height * 0.1
        )

        this.entity.info.textBaseline = 'top'
        this.entity.info.textAlign = 'left'
        
        this.destroyButton = this.createButtonInTheBottom('destroy', destroySelected)
        this.skipMovesButton = this.createButtonInTheBottom('skip moves', skipMovesOfSelected)
        this.portalStatsButton = this.createButtonInTheBottom('stats', () => this.refreshPortal(this.portal, true))
        this.portalBackButton = this.createButtonInTheBottom('back', () => this.refreshPortal(this.portal, false))
        this.portalStatsButton.canClick = this.portalBackButton.canClick = false
        // A town's tower rows (Town.info's 'range increase' and what a tower adds) shown only on its button.
        this.townTowerButton = this.createButtonInTheBottom('& tower properties', () => this.showTownTower(true))
        this.townBackButton = this.createButtonInTheBottom('back', () => this.showTownTower(false))
        this.townTowerButton.canClick = this.townBackButton.canClick = false
        this.townTowerText = null
        this.townTowerShown = false
        this.updateSizes(false)

        this.renderCache = undefined
        this.renderCacheBounds = undefined
        this.renderCacheDirty = true
    }
    get top() {
        return this.pos.y
    }
    // A narrow (portrait) screen: the picture and the text column shrink together so the name and lines end before
    // the screen's right edge, or before an open town/barrack panel reaching down beside this one. Returns whether
    // the scale changed. Every panel that fits keeps scale 1, the constructor's layout.
    fitColumn() {
        const scale = this.columnScale ?? 1
        this.layoutColumn(1)
        const room = this.columnRoom()
        const margin = 0.04 * this.height
        let right = Math.max(this.entity.info.right, this.entity.name.right)
        if (right + margin > room)
            this.layoutColumn(Math.max(0.25, (room - margin - this.pos.x) / (right - this.pos.x)))
        // Rows made smaller for the skip moves button at scale 1 (layoutColumn) are not at this scale: fit once more.
        right = Math.max(this.entity.info.right, this.entity.name.right)
        if (right + margin > room && this.columnScale > 0.25)
            this.layoutColumn(Math.max(0.25, this.columnScale * (room - margin - this.pos.x) / (right - this.pos.x)))
        return this.columnScale !== scale
    }
    // Where the column has to end: the screen's right edge or an open town/barrack panel reaching down beside it.
    columnRoom() {
        let room = WIDTH
        for (const panel of [typeof townInterface !== 'undefined' && townInterface,
                typeof barrackInterface !== 'undefined' && barrackInterface])
            if (panel && panel.visible && panel.pos && panel.pos.y + panel.height > this.pos.y)
                room = Math.min(room, panel.pos.x)
        return room
    }
    // The x of the rows' stat icons (drawContents); the bottom buttons start there too, under the stats.
    get statIconX() {
        return this.entity.info.x - 0.14 * this.height * (this.columnScale ?? 1)
    }
    layoutColumn(scale) {
        const h = this.height
        this.columnScale = scale
        this.img.x = this.suburbImage.pos.x = this.pos.x + h * 0.38 * scale
        this.img.width = this.img.height = h * 0.775 * scale
        this.suburbImage.r = h * 0.275 * scale
        this.entity.name.pos.x = this.entity.info.pos.x = this.img.x + this.img.width / 2
        this.entity.name.fontSize = h * 0.2 * scale
        this.entity.info.fontSize = h * 0.1 * scale
        this.entity.info.pos.y = this.entity.name.y + this.entity.name.height
        // A unit panel whose rows would reach its skip moves button (a siege demon's seven), or a town's with its tower
        // rows, gets a smaller row font.
        const rows = this.entity.info.text.split('\n').length
        const button = [this.skipMovesButton, this.townTowerButton, this.townBackButton].find(button => button.canClick)
        const room = button && button.y - this.entity.info.pos.y
        if (button && rows * this.entity.info.fontSize > room)
            this.entity.info.fontSize = room / rows
        for (const button of [this.destroyButton, this.skipMovesButton, this.portalStatsButton, this.portalBackButton,
                this.townTowerButton, this.townBackButton])
            button.x = this.statIconX
        // Beside the destroy button of an own town, not under it.
        if (this.destroyButton.canClick)
            this.townTowerButton.x = this.townBackButton.x = this.destroyButton.rect.right + 0.04 * h
        // The town buttons hold their whole text, a smaller font where it would pass the column's room.
        const end = this.columnRoom() - 0.04 * h
        for (const button of [this.townTowerButton, this.townBackButton]) {
            button.text.fontSize = Math.min(h * 0.1, button.rect.height * 0.7)
            const width = () => Math.max(0.11 * WIDTH, button.text.width + button.text.fontSize)
            if (button.x + width() > end)
                button.text.fontSize *= Math.max(0.25, (end - button.x) / width())
            button.rect.width = width()
            button.trimText()
        }
    }
    // The town/barrack panel opened or closed beside this one.
    refit() {
        if (!this.visible || !this.fitColumn()) return
        this.updateSizes(this.sizedForUnit)
        this.renderCacheDirty = true
    }
    updateSizes(isCurrentEnityUnit) {
        this.sizedForUnit = isCurrentEnityUnit
        this.fitColumn()
        let currentButton = isCurrentEnityUnit ? this.destroyButton : this.skipMovesButton
        // The buttons' ends as if they started at the text column, not under the icons: the drawn rows (wider than
        // info.width) keep the room they are laid out in.
        const start = this.entity.name.x
        const towerStart = this.destroyButton.canClick ? start + this.destroyButton.rect.width + 0.04 * this.height : start
        this.width = Math.max(
            this.entity.info.x + this.entity.info.width,
            this.entity.name.x + this.entity.name.width,
            start + currentButton.rect.width,
            this.townTowerText ? towerStart + this.townTowerButton.rect.width : 0) + 0.04 * this.height

        this.background.width = this.width
        
    }
    refreshPortal(portal, description = this.portalDescription) {
        if (!portal || portal.killed) { this.visible = false; return }
        const next = portal.nextProduction
        description = Boolean(description && next)
        let info = portal.info
        if (description) {
            const type = new JsonUnpackManager().unitClass[next.type]
            info = type.description
            // Only combat fields: keep the description and navigation within the panel.
            info = {name: next.type, displayName: DEMON_TYPES[next.type].name,
                image: next.type, info: {hp: info.info.hp, dmg: type.dmg,
                    speed: info.info.speed,
                    // Same range text as the non-mine unit panel, only for ranged demons.
                    ...(DEMON_TYPES[next.type].ranged ? {range: info.info.range} : {}),
                    ...(DEMON_TYPES[next.type].buildingDamage !== undefined ? {'building dmg': type.buildingDMG,
                        target: 'enemy buildings only'} : {})}}
        }
        const text = join(info.info, ': ', '\n')
        if (this.portal === portal && this.portalDescription === description &&
                this.visible && this.entity.name.text === (info.displayName || info.name) &&
                this.entity.info.text === text) return
        this.change(info, portal.player.fullColor, portal, description)
    }
    // The town panel's '& tower properties' / 'back': the tower rows after the town's own, the gold row kept as shown.
    showTownTower(shown) {
        if (!this.visible || !this.townTowerText) return
        const rows = this.entity.info.text
        const base = this.townTowerShown ? rows.slice(0, rows.length - this.townTowerText.length - 1) : rows
        this.townTowerShown = shown
        this.entity.info.text = shown ? base + '\n' + this.townTowerText : base
        this.townTowerButton.canClick = !shown
        this.townBackButton.canClick = shown
        this.updateSizes(this.sizedForUnit)
        this.renderCacheDirty = true
    }
    showFogTown(town) {
        this.change(town.fogInfo, town.panelColor)
        this.fogTown = {...town.coord}
    }
    change(entity, color, portal = null, description = false) {
        this.townInspection = null
        this.fogTown = null
        this.portal = portal
        this.portalDescription = description
        this.portalStatsButton.canClick = Boolean(portal && portal.nextProduction && !description)
        this.portalBackButton.canClick = Boolean(portal && description)
        this.background.color = color.hex
        this.setPanelColors(color.hex)
        this.img.image = entity.image || entity.bodyImageName || entity.name
        this.entity.name.text = entity.displayName || entity.name
        this.townTowerText = null
        this.townTowerShown = false
        if (entity.isDescriptionInfo) 
            this.entity.info.text = entity.info
        else if (entity.name === 'town' && entity.info && 'range increase' in entity.info) {
            const {'range increase': rangeIncrease, ...rows} = entity.info
            this.entity.info.text = join(rows, ': ', '\n')
            this.townTowerText = `range increase: ${rangeIncrease}\nhighground\narchers can't shoot through it`
        }
        else
            this.entity.info.text = join(entity.info, ': ', '\n')
        this.townTowerButton.canClick = Boolean(this.townTowerText)
        this.townBackButton.canClick = false
        
        this.destroyButton.canClick = entity.isDestroyable && !gameEvent.waitingMode
        this.skipMovesButton.canClick = entity.canSkipMoves && !gameEvent.waitingMode
        this.updateSizes(entity.canSkipMoves)

        this.renderCacheDirty = true
        this.visible = true
    }
    // Resolve by coordinate on every frame: captures and snapshots can replace the
    // building object. Only the gold token is projected; income stays untouched.
    refreshTown(coord = this.townInspection || gameEvent.selected?.coord) {
        if (!coord || !grid) return
        if (isFogOfWar && !grid.fogOfWar[coord.x]?.[coord.y]) {
            // A fogged neutral town keeps its public panel (showFogTown)
            if (this.fogTown && coordsEqually(this.fogTown, coord) &&
                    isFogLandmark(grid.getCell(coord)?.building)) return
            this.visible = false
            townInterface.visible = false
            return
        }
        const town = grid.getCell(coord)?.building
        if (!town?.isTown?.()) {
            if (this.townInspection) this.visible = false
            return
        }
        const cell = grid.getCell(coord)
        const observed = typeof onlineObservation !== 'undefined' && grid.observedBuilding(cell) ?
            onlineObservation.buildings.get(coord.x + ',' + coord.y) : null
        if (observed && !observed.sprite?.isTown?.()) { this.visible = false; townInterface.visible = false; return }
        const owner = observed ? observed.sprite.playerColor : town.playerColor
        const ownerPlayer = players[owner]
        const gold = !gameSettings.isOnline || owner === whooseTurn ? ownerPlayer.gold :
            players[whooseTurn]?.isAlliedWith(ownerPlayer) ? onlineAlliedGold.get(owner) : null
        const token = typeof gold === 'number' && Number.isFinite(gold) ? String(gold) : 'Hidden'
        // Preserve the existing income row and suffix, including on reconnect.
        this.visible = true
        const text = this.entity.info.text.replace(/(gold: )\S+(?= \()/, (_, label) => label + token)
        if (this.entity.info.text !== text || this.background.color !== ownerPlayer.fullColor.hex) {
            this.entity.info.text = text
            this.background.color = ownerPlayer.fullColor.hex
            this.updateSizes(false)
            this.renderCacheDirty = true
        }
        const goldText = text.match(/(?:^|\n)gold: ([^\n]*)/)?.[1]
        this.townInspection = {...coord}
        if (townInterface.visible) {
            if (owner !== whooseTurn || gameEvent.waitingMode) townInterface.visible = false
            else if (townInterface.goldText.text !== goldText) {
                townInterface.goldText.text = goldText
                townInterface.invalidateRenderCache()
            }
        }
    }
    townInspectionCoord() {
        return this.visible && this.entity.name.text === 'town' ?
            this.townInspection || gameEvent.selected?.coord : null
    }
    set visible(boolean) {
        if (boolean && !this.#visible)
            this.renderCacheDirty = true
        if (!boolean) {
            this.townInspection = null; this.fogTown = null; this.portal = null; this.portalDescription = false
            this.townTowerText = null; this.townTowerShown = false
            this.townTowerButton.canClick = this.townBackButton.canClick = false
        }
        this.#visible = boolean
        undoButton.selected = boolean
    }
    get visible() {
        return this.#visible
    }
    isInside(pos) {
        return this.background.isInside(pos)
    }
    click(pos) {
        if (!this.visible)
            return false
        
        
        this.destroyButton.click(pos)
        if (this.portalStatsButton.click(pos)) return true
        if (this.portalBackButton.click(pos)) return true
        if (this.townTowerButton.click(pos)) return true
        if (this.townBackButton.click(pos)) return true
        this.skipMovesButton.click(pos)
        return this.isInside(pos)
    }
    // The owner's colour under the next-turn button's 40% white wash (nextTurn.js highlightButton colorAlpha 0.4 over
    // TriangleImage's fill: each channel c * 0.6 + 255 * 0.4) and a dark shade of it for the name. Made in change(),
    // again only when refreshTown recolours the panel.
    setPanelColors(hex) {
        const n = parseInt(String(hex).slice(1), 16)
        const channels = [n >> 16 & 255, n >> 8 & 255, n & 255]
        const toHex = f => '#' + channels.map(c => Math.round(f(c)).toString(16).padStart(2, '0')).join('')
        this.panelColors = {source: hex, wash: toHex(c => c * 0.6 + 255 * 0.4), dark: toHex(c => c * 0.6)}
        // The buttons: the washed colour, a gold edge, ink text (rects and texts unchanged).
        for (const button of [this.destroyButton, this.skipMovesButton, this.portalStatsButton, this.portalBackButton,
                this.townTowerButton, this.townBackButton]) {
            button.rect.color = this.panelColors.wash
            button.rect.strokeColor = '#e0b55e'
            button.text.color = ENTITY_PANEL_INK
        }
    }
    // The panel's rows: 'key: value' (split at the first ': ') or a keyless line, with the stat icon of its key.
    panelRows() {
        return this.entity.info.text.split('\n').map(line => {
            const i = line.indexOf(': ')
            const row = i < 0 ? {key: null, value: line} : {key: line.slice(0, i), value: line.slice(i + 2)}
            const icon = typeof STAT_ICONS !== 'undefined' && STAT_ICONS[row.key ?? line]
            row.icon = icon ? assets[icon] : null
            return row
        })
    }
    // Concept F2 inside the background rect: cloth edges and a top roller in the washed colour, parchment between
    // them, the name between two rules, the portrait on the left, a row per info line (icon, key, value) and the
    // buttons in the washed colour with a gold edge.
    drawContents(ctx) {
        if (this.panelColors?.source !== this.background.color) this.setPanelColors(this.background.color)
        const {wash, dark} = this.panelColors
        const bg = this.background, h = this.height, s = this.columnScale ?? 1
        const family = Text.defaultFamily
        const r = 0.045 * h, right = bg.x + bg.width - r
        const x0 = bg.x + 0.05 * h * s, x1 = right - 0.05 * h * s
        ctx.save()
        // Cloth
        ctx.fillStyle = wash
        ctx.fillRect(bg.x, bg.y + r, right - bg.x, bg.height - r)
        ctx.save()
        ctx.beginPath()
        ctx.rect(bg.x, bg.y + r, right - bg.x, bg.height - r)
        ctx.clip()
        ctx.globalAlpha = 0.1
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = -bg.height; i < right - bg.x; i += 6) {
            ctx.moveTo(bg.x + i, bg.y + r)
            ctx.lineTo(bg.x + i + bg.height, bg.y + r + bg.height)
        }
        ctx.stroke()
        ctx.restore()
        // Parchment: straight top and bottom, torn sides.
        const top = bg.y + r, w = x1 - x0
        const tear = () => {
            let k = 55
            const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280
            const j = 0.018 * Math.min(w, h), rows = Math.max(6, Math.round((bg.bottom - top) / (h * 0.12)))
            ctx.beginPath()
            ctx.moveTo(x0, top)
            ctx.lineTo(x1, top)
            for (let i = 1; i < rows; i++) ctx.lineTo(x1 + (rnd() - 0.5) * 2 * j, top + (bg.bottom - top) * i / rows)
            ctx.lineTo(x1, bg.bottom)
            ctx.lineTo(x0, bg.bottom)
            for (let i = rows - 1; i > 0; i--) ctx.lineTo(x0 + (rnd() - 0.5) * 2 * j, top + (bg.bottom - top) * i / rows)
            ctx.closePath()
        }
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 0.02 * h
        tear()
        const paper = ctx.createRadialGradient(x0 + w * 0.45, top + h * 0.4, Math.min(w, h) * 0.1, x0 + w / 2, top + h / 2,
            Math.max(w, h) * 0.75)
        paper.addColorStop(0, '#f6e9c9')
        paper.addColorStop(1, '#cfae78')
        ctx.fillStyle = paper
        ctx.fill()
        ctx.restore()
        tear()
        ctx.strokeStyle = 'rgba(110,70,30,0.6)'
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.008)
        ctx.stroke()
        // Roller: the washed colour shaded round, gold caps (the right one ends at the background's right edge).
        const roll = ctx.createLinearGradient(0, bg.y + 0.2 * r, 0, bg.y + 1.8 * r)
        roll.addColorStop(0, dark)
        roll.addColorStop(0.45, wash)
        roll.addColorStop(1, dark)
        ctx.fillStyle = roll
        roundedRectPath(ctx, bg.x, bg.y + 0.2 * r, right - bg.x, 1.6 * r, 0.8 * r)
        ctx.fill()
        for (const ex of [bg.x, right]) {
            ctx.beginPath()
            ctx.arc(ex, bg.y + r, r, 0, 2 * Math.PI)
            const cap = ctx.createRadialGradient(ex - r * 0.3, bg.y + r * 0.7, 0, ex, bg.y + r, r)
            cap.addColorStop(0, '#f6dc9a')
            cap.addColorStop(1, '#8a6a2a')
            ctx.fillStyle = cap
            ctx.fill()
        }
        // Name between two rules.
        const cx = (x0 + x1) / 2, nameY = bg.y + 0.19 * h * s + r, ruleY = nameY + 0.08 * h * s
        let nameSize = this.entity.name.fontSize * 0.6
        ctx.font = `italic 700 ${nameSize}px ${family}`
        const nameWidth = ctx.measureText(this.entity.name.text).width
        if (nameWidth > w * 0.9) {
            nameSize *= w * 0.9 / nameWidth
            ctx.font = `italic 700 ${nameSize}px ${family}`
        }
        ctx.fillStyle = dark
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.entity.name.text, cx, nameY)
        ctx.strokeStyle = wash
        ctx.lineWidth = 0.01 * h
        const half = Math.min(w * 0.45, Math.max(0.25 * h * s, Math.min(nameWidth, w * 0.9) / 2))
        ctx.beginPath()
        for (const d of [-1, 1]) {
            ctx.moveTo(cx + d * half * 0.6, ruleY)
            ctx.lineTo(cx + d * Math.min(w * 0.45, half + 0.35 * h * s), ruleY)
        }
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx, ruleY, 0.022 * h * s, 0, 2 * Math.PI)
        ctx.fillStyle = wash
        ctx.fill()
        // Rows: icon, key, value (the value column after the widest key); keyless rows as text.
        const rows = this.panelRows()
        const iconX = this.statIconX
        const button = [this.destroyButton, this.skipMovesButton, this.portalStatsButton, this.portalBackButton,
            this.townTowerButton, this.townBackButton].filter(b => b.canClick)
        const rowsTop = ruleY + 0.05 * h * s
        const rowsBottom = button.length ? Math.min(...button.map(b => b.y)) - 0.02 * h : bg.bottom - 0.04 * h
        let size = Math.min(this.entity.info.fontSize, (rowsBottom - rowsTop) / Math.max(1, rows.length) / 1.15)
        const keyFont = f => `italic 500 ${f}px ${family}`, valueFont = f => `700 ${f * 1.08}px ${family}`
        const measure = f => {
            const keyX = iconX + f * 1.4
            ctx.font = keyFont(f)
            const keyWidth = Math.max(0, ...rows.map(row => row.key === null ? 0 : ctx.measureText(row.key).width))
            const keyless = Math.max(0, ...rows.map(row => row.key === null ? ctx.measureText(row.value).width : 0))
            ctx.font = valueFont(f)
            const valueX = keyX + keyWidth + f * 0.6
            const values = Math.max(0, ...rows.map(row => row.key === null ? 0 : ctx.measureText(row.value).width))
            return {keyX, valueX, end: Math.max(keyX + keyless, valueX + values)}
        }
        let layout = measure(size)
        if (layout.end > x1 - 0.02 * h) {
            size *= Math.max(0.5, (x1 - 0.02 * h - iconX) / (layout.end - iconX))
            layout = measure(size)
        }
        // Portrait on the left, beside the rows.
        const p = Math.max(0, Math.min(this.img.width * 0.68, iconX - x0 - 0.03 * h * s))
        const portrait = {x: (x0 + iconX) / 2, y: bg.y + 0.6 * h}
        if (this.img.image == 'suburb') {
            const {pos, r: radius} = this.suburbImage
            this.suburbImage.pos = portrait
            this.suburbImage.r = radius * p / this.img.width
            this.suburbImage.draw(ctx)
            this.suburbImage.pos = pos
            this.suburbImage.r = radius
        }
        else if (this.img.image)
            drawImage(ctx, this.img.image, portrait, p, p)
        this.iconsPending = null
        let y = rowsTop + size * 1.15 / 2
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        for (const row of rows) {
            if (row.icon) {
                if (row.icon.complete && row.icon.naturalWidth > 0)
                    ctx.drawImage(row.icon, iconX, y - size * 0.55, size * 1.1, size * 1.1)
                else if (!row.icon.complete) (this.iconsPending ??= []).push(row.icon)
            }
            if (row.key === null) {
                ctx.font = keyFont(size)
                ctx.fillStyle = ENTITY_PANEL_INK
                ctx.fillText(row.value, layout.keyX, y)
            }
            else {
                ctx.font = keyFont(size)
                ctx.fillStyle = 'rgba(74,46,20,0.8)'
                ctx.fillText(row.key, layout.keyX, y)
                ctx.font = valueFont(size)
                ctx.fillStyle = ENTITY_PANEL_INK
                ctx.fillText(row.value, layout.valueX, y)
            }
            y += size * 1.15
        }
        ctx.restore()

        this.destroyButton.draw(ctx)
        this.skipMovesButton.draw(ctx)
        this.portalStatsButton.draw(ctx)
        this.portalBackButton.draw(ctx)
        this.townTowerButton.draw(ctx)
        this.townBackButton.draw(ctx)
    }
    getRenderCacheBounds() {
        const padding = this.background.strokeWidth
        const left = Math.max(0, Math.floor(this.background.x - padding))
        const top = Math.max(0, Math.floor(this.background.y - padding))
        const right = Math.min(WIDTH, Math.ceil(this.background.right + padding))
        const bottom = Math.min(HEIGHT, Math.ceil(this.background.bottom + padding))
        return {left, top, width: right - left, height: bottom - top}
    }
    createRenderCache() {
        const bounds = this.getRenderCacheBounds()
        if (bounds.width <= 0 || bounds.height <= 0)
            return false

        let cache = this.renderCache
        if (!cache || cache.width != bounds.width || cache.height != bounds.height) {
            cache = document.createElement('canvas')
            cache.width = bounds.width
            cache.height = bounds.height
        }
        const cacheCtx = cache.getContext('2d')
        if (!cacheCtx)
            return false

        cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
        cacheCtx.clearRect(0, 0, cache.width, cache.height)
        cacheCtx.translate(-bounds.left, -bounds.top)
        this.drawContents(cacheCtx)

        this.renderCache = cache
        this.renderCacheBounds = bounds
        this.renderCacheDirty = false
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        if (this.entity.name.text === 'town') this.refreshTown()
        if (!this.visible) return
        // Stat icons still loading when the cache was drawn (the menu does not wait for them): draw it again once.
        if (this.iconsPending && this.iconsPending.every(icon => icon.complete)) this.renderCacheDirty = true
        if ((this.renderCacheDirty || !this.renderCache) && !this.createRenderCache()) {
            this.drawContents(ctx)
            return
        }
        const bounds = this.renderCacheBounds
        ctx.drawImage(this.renderCache, bounds.left, bounds.top)
    }
}
