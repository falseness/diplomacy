// Browser-only (not in the server's rules script list, server/gameScriptList.js, so the rules version stays as it is):
// the 'tutorial' screen as lesson cards, in place of menu/menu.js TutorialTree (installed at the end of this file).
// A "Tutorial" heading under the logo, every entry of options/tutorials.js as a card in 3 equal columns between the
// heading and Back (always 3 x 3 shown, see TutorialCardsTree.grids; the cards keep the size the menu opens with
// while scrolling, see TutorialCardsTree.layout): a round cream
// medallion at the left, the lesson number in gold and its name (at most 2 lines, never shrunk, ellipsis past them) at
// the right, both from the title "Tutorial N: Name". Passed lessons (readTutorialPassed, re-read on every enter) carry a
// gold check badge; the first lesson in menu order that is not passed is Next: a thick gold rim, a gold glow and a
// "Next" tag. More rows than the grid shows scroll by whole rows (wheel, touch drag, arrow keys) with a gold track at
// the right; while rows follow the shown ones, the next row peeks in, fading, under a "▼ N more" pill (no pill while a
// dotted "Advanced tutorial" divider, above ADVANCED_FROM's row, is shown). Sizes are in hub units (hubUnit). The medallion shows the lesson's
// picture (TutorialCardsTree.IMAGES, by tutorial id) from the game's own assets.

// A lesson card: its whole rect starts the lesson. Menu.touchStart/Move/End hand every touch to every button of the
// tree, so each card forwards it to the tree, where repeated calls with one position change nothing.
class TutorialCard extends MenuButton {
    constructor(tree, tutorial) {
        super(new Rect(0, 0, 0, 0), new Text(0, 0, 0, tutorial.title),
            id => whenGameSpritesReady(() => TutorialManager.start(id)), tutorial.id, true)
        this.tree = tree
        Object.assign(this, TutorialCardsTree.parseTitle(tutorial.title))
        this.label = null
    }
    select(pos) {
        this.tree.touchStart(pos)
    }
    touchmove(pos) {
        this.tree.touchMove(pos)
    }
    removeSelect() {
        this.tree.touchEnd()
    }
}

class TutorialCardsTree {
    // The grids the cards are laid out in: 3 columns x 3 rows shown for any number of lessons, so a card keeps the
    // 9-lesson size at every screen; rows past the 3rd scroll in (wheel, arrow keys, touch drag, the gold track).
    static grids(count) {
        return [{columns: 3, rows: 3}]
    }
    // A card's size in a grid of width x height with gap between cards, in hub units u, rated against the card a
    // medallion and a 2-line name at the card font need (24 x 7 units): the grid whose card is the least short of that
    // in either direction wins; ties keep the first (3 columns).
    static chooseGrid(count, width, height, gap, u) {
        let best = null
        for (const grid of TutorialCardsTree.grids(count)) {
            const card = {width: (width - gap * (grid.columns - 1)) / grid.columns, height: (height - gap * (grid.rows - 1)) / grid.rows}
            const score = Math.min(card.width / (24 * u), card.height / (7 * u))
            if (!best || score > best.score + 1e-9) best = {...grid, card, score}
        }
        return best
    }
    static CARD = {
        glass: 'rgba(20, 28, 56, 0.82)', rim: 'rgba(201, 154, 78, 0.75)', gold: '#f2b45a', text: '#f3ead8',
        heading: '#f6e2b8', glow: 'rgba(242, 180, 90, 0.45)', warm: ['rgba(242, 180, 90, 0.18)', 'rgba(242, 180, 90, 0.04)'],
        disc: ['#f6ecdc', '#cbb79a'], discRing: '#d4a85a', discShade: 'rgba(0, 0, 0, 0.25)',
        badge: ['#ffe3a3', '#d9962f'], tag: ['#ffe3a3', '#e9a948'], dark: '#2a1a06',
    }
    // The share of a card's height the next row shows below the shown ones (TutorialCardsTree.layout).
    static PEEK = 0.45
    // The first advanced lesson: the "Advanced tutorial" divider sits above its row (TutorialCardsTree.layout).
    // Hold the Walls opens the fourth row since Puzzle Rush came in, so the first three rows stay the basic lessons.
    static ADVANCED_FROM = 'tutorial-5'
    // Medallion pictures by tutorial id (not the display number): the file and its fit, as in the concept: 'unit'
    // sprites a little larger and lowered, 'low' buildings raised so their art is centred. The menu loads them as its
    // own images from these paths, so the sprite and visuals settings (which switch the shared assets' folders, see
    // render/loadassets.js loadSprites) never change them. A {shape: 'suburb'} entry has no file: the game's suburb
    // hexagon (sprites/elements/image.js SuburbImage, as the town interface's suburb portrait) is drawn in the disc.
    // An id without an entry keeps the empty medallion.
    static IMAGES = {
        'tutorial-0': {src: 'assets/sprites/noob.svg', fit: 'unit'},
        'tutorial-16': {src: 'assets/sprites/noob.svg', fit: 'moves', moves: {count: 2, left: 1}},
        'tutorial-17': {src: 'assets/sprites/normchel.svg', fit: 'unit'},
        'tutorial-1': {src: 'assets/sprites/archer.svg', fit: 'unit'},
        'tutorial-7': {src: 'assets/atmosphere/buildings/tower.svg'},
        'tutorial-3': {src: 'assets/atmosphere/buildings/wall.svg', fit: 'low'},
        'tutorial-18': {src: 'assets/atmosphere/buildings/farm.svg'},
        'tutorial-20': {shape: 'suburb'},
        'tutorial-21': {src: 'assets/atmosphere/buildings/demonPortalRanged.svg'},
        'tutorial-19': {src: 'assets/sprites/KOHb.svg', fit: 'unit'},
        'tutorial-2': {src: 'assets/atmosphere/buildings/barrack.svg'},
        'tutorial-5': {src: 'assets/sprites/emberArcher.svg', fit: 'unit'},
        'tutorial-15': {src: 'assets/atmosphere/buildings/bastion.svg', fit: 'low'},
        'tutorial-13': {src: 'assets/sprites/catapult.svg'},
        'tutorial-6': {src: 'assets/sprites/demonLord.svg', fit: 'unit'},
    }
    // The picture's box as a share of the medallion's diameter and its shift down as a share of that box.
    // 'moves': a unit sprite drawn over a unit's move bar (an entry's moves: {count, left}) as in the game.
    static IMAGE_FIT = {plain: {size: 0.86, shift: 0}, unit: {size: 0.92, shift: 0.06}, low: {size: 0.86, shift: -0.14},
        moves: {size: 0.86, shift: 0.03}}
    // The suburb shape's hexagon radius as a share of the disc's radius, its stroke as a share of the hexagon's radius
    // and its fill, as the town interface's suburb portrait (interface/entityinterface.js: r 0.275 and stroke 0.02 of
    // its panel height, filled with the panel's player colour, here the red player's of the tutorials).
    static SUBURB = {size: 0.6, stroke: 0.02 / 0.275, color: '#ff0000'}
    static images = {}
    // The loaded picture of a tutorial id (created on first use), or null while it loads or without an entry; a shape
    // entry is ready at once (the entry itself).
    static image(id) {
        const entry = TutorialCardsTree.IMAGES[id]
        if (!entry) return null
        if (entry.shape) return entry
        let image = TutorialCardsTree.images[entry.src]
        if (!image) {
            image = TutorialCardsTree.images[entry.src] = new Image()
            image.src = entry.src
        }
        return image.complete && image.naturalWidth > 0 ? image : null
    }
    constructor(_menu) {
        this.menu = _menu
        this.backButton = new Empty()
        this.entries = []
        this.passed = []
        this.nextId = null
        this.firstRow = 0
        this.dragY = null
        this.grid = {x: 0, y: 0, width: 0, height: 0}
        this.heading = {x: 0, y: 0, width: 0, height: 0}
        this.track = null
        this.columns = 3
        this.shownRows = 3
        this.peek = null
        this.divider = null
        this.peekCanvas = null
        this.buttons = [this.backButton]
    }
    get rows() {
        return Math.ceil(this.entries.length / this.columns)
    }
    get maxFirstRow() {
        return Math.max(0, this.rows - this.shownRows)
    }
    // The row the advanced lessons start at (ADVANCED_FROM), or null without it or in the first row.
    get dividerRow() {
        const index = this.entries.findIndex(entry => entry.id === TutorialCardsTree.ADVANCED_FROM)
        return index > 0 && index >= this.columns ? Math.floor(index / this.columns) : null
    }
    // "Tutorial N: Name" -> {number: 'N', name: 'Name'}; any other title is the whole name.
    static parseTitle(title) {
        const match = /^Tutorial\s+(\d+)\s*:\s*(.+)$/.exec(title)
        return match ? {number: match[1], name: match[2].trim()} : {number: '', name: title}
    }
    setParent(parent, _menu) {
        this.backButton = new HubButton('Back', _menu.setTree, parent, _menu)
        this.update()
    }
    enter() {
        this.firstRow = 0
        this.update()
    }
    update() {
        this.passed = readTutorialPassed()
        this.nextId = tutorials.find(tutorial => !this.passed.includes(tutorial.id))?.id ?? null
        this.entries = tutorials.map(tutorial => {
            TutorialCardsTree.image(tutorial.id)
            const button = new TutorialCard(this, tutorial)
            const checkMark = this.passed.includes(tutorial.id) ? {pos: {x: 0, y: 0}, width: 0, height: 0,
                get x() { return this.pos.x }, get y() { return this.pos.y }} : null
            return {id: tutorial.id, button, checkMark, next: tutorial.id === this.nextId}
        })
        this.buttons = [...this.entries.map(entry => entry.button), this.backButton]
        this.layout()
    }
    // The heading under the logo, Back at the bottom, the grid of equal cards between them (chooseGrid); rows above or
    // below the shown ones are moved off the grid and ignore clicks. The cards keep the size the menu opens with
    // (firstRow 0) at every firstRow: with rows to scroll, short enough that the shown rows and PEEK of a card fit the
    // grid (less the divider band's extra height when firstRow 0 shows it). While rows follow the shown ones, the next
    // row is placed under them as the peek (clipped to the grid when drawn, ignoring clicks); this.peek keeps its band,
    // its entries and the pill. At the last row nothing peeks and the strip under the last row stays empty. Peek cards
    // whose medallion and name would sit in the hidden part (tall cards: portrait phones) draw them centred in the
    // band instead (entry.contentY). While the divider row (dividerRow) is shown or peeks, the divider's band takes the
    // gap above it (this.divider) and the rows from it on move down by its extra height; cardStep stays a card and a
    // gap, so scrolling keeps whole rows. No pill is shown with the divider.
    layout() {
        const u = hubUnit(), logo = this.menu.logo.bounds
        const headingTop = logo.y + logo.height + 0.2 * u
        Object.assign(this.heading, {x: WIDTH / 2 - 12 * u, y: headingTop, width: 24 * u, height: 3.4 * u})
        const backHeight = 4.6 * u, backTop = HEIGHT - 1.4 * u - backHeight
        this.backButton.place?.(WIDTH / 2 - 9 * u, backTop, 18 * u, backHeight, 2.2 * u)
        if (this.backButton.rect) this.backButton.rect.cornerRadius = Array(4).fill(backHeight / 2)
        const gap = 1.3 * u, top = headingTop + this.heading.height + 1.1 * u, bottom = backTop - 1.1 * u
        Object.assign(this.grid, {x: 3 * u, y: top, width: WIDTH - 6 * u, height: bottom - top})
        const chosen = TutorialCardsTree.chooseGrid(this.entries.length, this.grid.width, this.grid.height, gap, u)
        this.columns = chosen.columns
        this.shownRows = chosen.rows
        this.firstRow = Math.min(this.firstRow, this.maxFirstRow)
        const peeking = this.firstRow < this.maxFirstRow, width = chosen.card.width
        const f = u * hubFontScale(), band = Math.max(2.6 * u, 2.4 * f), dividerRow = this.dividerRow
        // The divider's shown row at firstRow, or null while it is neither shown nor peeking.
        const dividerAtRow = firstRow => dividerRow !== null && dividerRow > firstRow &&
            dividerRow < firstRow + this.shownRows + (firstRow < this.maxFirstRow ? 1 : 0) ? dividerRow - firstRow : null
        const dividerAt = dividerAtRow(this.firstRow)
        const extra = dividerAt === null ? 0 : band - gap
        // The card size the menu opens with (firstRow 0) at every firstRow: no growing at the last row.
        const openPeeking = this.maxFirstRow > 0, openExtra = dividerAtRow(0) === null ? 0 : band - gap
        const height = openPeeking ? (this.grid.height - gap * this.shownRows - openExtra) / (this.shownRows + TutorialCardsTree.PEEK) :
            (this.grid.height - gap * (this.shownRows - 1) - openExtra) / this.shownRows
        this.cardStep = height + gap
        const rowY = row => this.grid.y + row * this.cardStep + (dividerAt !== null && row >= dividerAt ? extra : 0)
        this.divider = dividerAt === null ? null : {x: this.grid.x, y: rowY(dividerAt) - band, width: this.grid.width,
            height: band, text: 'Advanced tutorial', font: `700 ${1.5 * f}px ${Text.titleFamily}`}
        this.peek = null
        if (peeking) {
            const top = rowY(this.shownRows), bottom = this.grid.y + this.grid.height
            const lessons = this.entries.length - (this.firstRow + this.shownRows) * this.columns
            this.peek = {top, bottom, entries: [], lessons, text: `▼  ${lessons} more`}
        }
        this.entries.forEach((entry, index) => {
            const row = Math.floor(index / this.columns) - this.firstRow, column = index % this.columns
            const shown = row >= 0 && row < this.shownRows, peek = this.peek && row === this.shownRows
            const rect = entry.button.rect
            Object.assign(rect, {x: this.grid.x + column * (width + gap),
                y: shown || peek ? rowY(row) : -HEIGHT, width, height, cornerRadius: Array(4).fill(u)})
            entry.button.canClick = shown
            entry.peek = peek
            entry.contentY = null
            if (peek) {
                this.peek.entries.push(entry)
                const band = this.peek.bottom - this.peek.top, disc = TutorialCardsTree.discSize(rect, u)
                if (rect.y + rect.height / 2 + disc / 2 + 0.9 * u > this.peek.bottom && disc + 2.4 * u <= band)
                    entry.contentY = this.peek.top + band / 2
            }
            entry.button.text.fontSize = 2 * u
            entry.button.trimText()
            const badge = 2.6 * u
            if (entry.checkMark) Object.assign(entry.checkMark, {width: badge, height: badge,
                pos: {x: rect.x + rect.width - 0.9 * u - badge / 2, y: rect.y + 0.9 * u + badge / 2}})
        })
        if (this.peek && !this.divider) {
            const font = `700 ${1.5 * f}px ${Text.defaultFamily}`
            const pill = {height: 2.6 * f}
            pill.width = Math.max(11 * u, TutorialCardsTree.measure(this.peek.text, font) + 3 * f)
            Object.assign(pill, {x: this.grid.x + this.grid.width / 2 - pill.width / 2,
                y: this.peek.bottom - 0.2 * u - pill.height})
            this.peek.pill = {...pill, font}
        } else if (this.peek) this.peek.pill = null
        this.track = this.rows > this.shownRows ?
            {x: this.grid.x + this.grid.width + 1.1 * u, y: this.grid.y, width: 0.45 * u, height: this.grid.height} : null
    }
    // The medallion's diameter on a card rect: at most 82% of its height and 30% of its width, and small enough that
    // its ring and shade (0.7 u past the disc) stay 0.2 u inside the card on short cards (wide or low screens).
    static discSize(r, u) {
        return Math.min(0.82 * r.height, r.height - 1.8 * u, 0.3 * r.width)
    }
    static measure(text, font) {
        const ctx = TutorialCardsTree.measureCtx ??= document.createElement('canvas').getContext('2d')
        ctx.font = font
        return ctx.measureText(text).width
    }
    // The gold thumb on the track: the shown rows' share of every row.
    get thumbRect() {
        if (!this.track) return null
        const t = this.track, height = t.height * this.shownRows / this.rows
        return {x: t.x, y: t.y + (t.height - height) * this.firstRow / this.maxFirstRow, width: t.width, height}
    }
    scrollRows(rows) {
        const firstRow = Math.max(0, Math.min(this.maxFirstRow, this.firstRow + rows))
        if (firstRow === this.firstRow) return false
        this.firstRow = firstRow
        this.layout()
        return true
    }
    click(pos) {
        for (const button of this.buttons) if (button.click(pos)) return
    }
    wheel(pos, deltaY) {
        if (deltaY) this.scrollRows(Math.sign(deltaY))
    }
    scrollKey(key) {
        const rows = {ArrowDown: 1, ArrowUp: -1, PageDown: this.shownRows, PageUp: -this.shownRows,
            Home: -this.rows, End: this.rows}[key]
        if (rows) this.scrollRows(rows)
    }
    // Touch drag on the grid: a row per card step of travel (the anchor moves with each row, so a repeated call with
    // the same position does nothing).
    touchStart(pos) {
        const g = this.grid
        this.dragY = pos.x >= g.x && pos.x <= g.x + g.width + 3 * hubUnit() && pos.y >= g.y && pos.y <= g.y + g.height ? pos.y : null
    }
    touchMove(pos) {
        if (this.dragY === null) return
        const rows = Math.trunc((this.dragY - pos.y) / this.cardStep)
        if (!rows) return
        this.dragY -= rows * this.cardStep
        this.scrollRows(rows)
    }
    touchEnd() {
        this.dragY = null
    }
    draw(ctx) {
        this.layout()
        const u = hubUnit()
        this.drawHeading(ctx, u)
        for (const entry of this.entries) if (entry.button.canClick) this.drawCard(ctx, entry, u)
        if (this.peek) this.drawPeek(ctx, u)
        if (this.divider) this.drawDivider(ctx, u)
        if (this.track) {
            hubFillRounded(ctx, this.track, this.track.width / 2, 'rgba(255, 255, 255, 0.08)')
            const thumb = this.thumbRect
            hubFillRounded(ctx, thumb, thumb.width / 2, MENU_THEME.plain.rim)
        }
        this.backButton.draw(ctx)
    }
    // The peek row drawn on its own canvas (the screen's size, kept), faded from 0.9 at its top to nothing at the
    // grid's bottom and cut there, then the navy pill with a gold rim and "▼  N more" centred just above that bottom.
    drawPeek(ctx, u) {
        const peek = this.peek, canvas = this.peekCanvas ??= document.createElement('canvas')
        if (canvas.width !== ctx.canvas.width || canvas.height !== ctx.canvas.height) {
            canvas.width = ctx.canvas.width
            canvas.height = ctx.canvas.height
        }
        const layer = canvas.getContext('2d')
        layer.setTransform(1, 0, 0, 1, 0, 0)
        layer.globalCompositeOperation = 'source-over'
        layer.clearRect(0, 0, canvas.width, canvas.height)
        layer.setTransform(...['a', 'b', 'c', 'd', 'e', 'f'].map(key => ctx.getTransform()[key]))
        for (const entry of peek.entries) this.drawCard(layer, entry, u)
        layer.globalCompositeOperation = 'destination-in'
        const fade = layer.createLinearGradient(0, peek.top, 0, peek.bottom)
        fade.addColorStop(0, 'rgba(0, 0, 0, 0.9)')
        fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
        layer.fillStyle = fade
        layer.fillRect(0, peek.top, WIDTH, peek.bottom - peek.top)
        layer.globalCompositeOperation = 'source-over'
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, peek.top, WIDTH, peek.bottom - peek.top)
        ctx.clip()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(canvas, 0, 0)
        ctx.restore()
        const pill = peek.pill
        if (!pill) return
        hubFillRounded(ctx, pill, pill.height / 2, 'rgba(14, 20, 48, 0.88)')
        ctx.beginPath()
        roundedRectPath(ctx, pill.x, pill.y, pill.width, pill.height, pill.height / 2)
        ctx.strokeStyle = MENU_THEME.plain.rim
        ctx.lineWidth = 0.12 * u
        ctx.stroke()
        hubText(ctx, peek.text, pill.x + pill.width / 2, pill.y + pill.height / 2, pill.font, MENU_THEME.heading, 'center')
    }
    // "Advanced tutorial" centred in the divider's band, a dotted gold line from each grid edge to 1.2 u from it.
    drawDivider(ctx, u) {
        const d = this.divider, y = d.y + d.height / 2, centre = d.x + d.width / 2
        const inner = hubText(ctx, d.text, centre, y, d.font, MENU_THEME.heading, 'center') / 2 + 1.2 * u
        ctx.save()
        ctx.setLineDash([0.35 * u, 0.45 * u])
        ctx.lineCap = 'round'
        ctx.strokeStyle = MENU_THEME.plain.rim
        ctx.lineWidth = Math.max(1, 0.18 * u)
        ctx.beginPath()
        ctx.moveTo(d.x, y)
        ctx.lineTo(centre - inner, y)
        ctx.moveTo(d.x + d.width, y)
        ctx.lineTo(centre + inner, y)
        ctx.stroke()
        ctx.restore()
    }
    // "Tutorial" between two gold lines fading outwards.
    drawHeading(ctx, u) {
        const h = this.heading, y = h.y + h.height / 2, colours = TutorialCardsTree.CARD
        const width = hubText(ctx, 'Tutorial', WIDTH / 2, y, `800 ${2.6 * u}px ${Text.titleFamily}`, colours.heading, 'center')
        for (const side of [-1, 1]) {
            const inner = WIDTH / 2 + side * (width / 2 + 1.6 * u), outer = inner + side * 12 * u
            const line = ctx.createLinearGradient(outer, 0, inner, 0)
            line.addColorStop(0, 'rgba(201, 154, 78, 0)')
            line.addColorStop(1, MENU_THEME.plain.rim)
            ctx.fillStyle = line
            ctx.fillRect(Math.min(inner, outer), Math.round(y), 12 * u, Math.max(1, 0.1 * u))
        }
    }
    drawCard(ctx, entry, u) {
        const colours = TutorialCardsTree.CARD, button = entry.button, r = button.rect
        ctx.save()
        ctx.beginPath()
        r.drawShape(ctx)
        ctx.closePath()
        ctx.fillStyle = colours.glass
        if (entry.next) {
            ctx.shadowColor = colours.glow
            ctx.shadowBlur = 2.2 * u
        }
        ctx.fill()
        ctx.shadowColor = 'transparent'
        if (entry.next) {
            const warm = ctx.createLinearGradient(r.x, 0, r.x + 0.7 * r.width, 0)
            warm.addColorStop(0, colours.warm[0])
            warm.addColorStop(1, colours.warm[1])
            ctx.fillStyle = warm
            ctx.fill()
        }
        // The rim inside the card.
        const rim = (entry.next ? 0.3 : 0.14) * u
        ctx.beginPath()
        new Rect(r.x + rim / 2, r.y + rim / 2, r.width - rim, r.height - rim, r.cornerRadius.map(c => c - rim / 2)).drawShape(ctx)
        ctx.closePath()
        ctx.strokeStyle = entry.next ? colours.gold : colours.rim
        ctx.lineWidth = rim
        ctx.stroke()
        // The medallion (discSize), centred on the card's height (or on entry.contentY in the peek).
        const pad = 1.6 * u, disc = TutorialCardsTree.discSize(r, u)
        const cx = r.x + pad + disc / 2, cy = entry.contentY ?? r.y + r.height / 2
        this.drawMedallion(ctx, cx, cy, disc / 2, u)
        button.medallion = this.drawMedallionImage(ctx, entry.id, cx, cy, disc / 2)
        // The corner mark: Next's tag or the check badge.
        let corner = null
        if (entry.next) corner = this.drawNextTag(ctx, r, u)
        else if (entry.checkMark) {
            const m = entry.checkMark
            this.drawCheckBadge(ctx, m.x, m.y, m.width / 2)
            corner = {x: m.x - m.width / 2, y: m.y - m.height / 2, width: m.width, height: m.height}
        }
        this.drawLabel(ctx, button, r.x + pad + disc + pad, r.x + r.width - pad, cy, corner, u)
        ctx.restore()
    }
    drawMedallion(ctx, x, y, radius, u) {
        const colours = TutorialCardsTree.CARD
        ctx.beginPath()
        ctx.arc(x, y, radius + 0.45 * u, 0, Math.PI * 2)
        ctx.strokeStyle = colours.discShade
        ctx.lineWidth = 0.5 * u
        ctx.stroke()
        const fill = ctx.createRadialGradient(x, y - 0.2 * radius, 0, x, y, radius)
        fill.addColorStop(0, colours.disc[0])
        fill.addColorStop(1, colours.disc[1])
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, radius + 0.225 * u, 0, Math.PI * 2)
        ctx.strokeStyle = colours.discRing
        ctx.lineWidth = 0.45 * u
        ctx.stroke()
    }
    // The tutorial's picture contained in its fit box, clipped to the disc, with its moves bar (if any) drawn first
    // and the picture over it, as Unit.draw draws a unit's bars and then its body; returns what was drawn (or null).
    drawMedallionImage(ctx, id, x, y, radius) {
        const image = TutorialCardsTree.image(id)
        if (!image) return null
        if (image.shape === 'suburb') return this.drawMedallionSuburb(ctx, x, y, radius)
        const fit = TutorialCardsTree.IMAGE_FIT[TutorialCardsTree.IMAGES[id].fit ?? 'plain']
        const size = fit.size * 2 * radius, scale = Math.min(size / image.naturalWidth, size / image.naturalHeight)
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale
        const box = {x: x - width / 2, y: y + fit.shift * size - height / 2, width, height}
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        const moves = TutorialCardsTree.IMAGES[id].moves
        // Placed on the sprite as sprites/entities/units/unit/unit.js trimBars places a unit's: at the sprite's centre
        // plus movesBarMarginY (0.1 r), r = box.height / 1.6. Drawn under the sprite, as in the game.
        const r = box.height / 1.6
        const bar = moves ? this.drawMovesBar(ctx, moves, x, box.y + box.height / 2 + 0.1 * r, r) : undefined
        ctx.drawImage(image, box.x, box.y, box.width, box.height)
        ctx.restore()
        return {src: TutorialCardsTree.IMAGES[id].src, box, disc: {x, y, radius}, ...(bar && {bar})}
    }
    // The suburb hexagon (SuburbImage: the red player's fill, black stroke) centred in the disc and clipped to it.
    drawMedallionSuburb(ctx, x, y, radius) {
        const r = TutorialCardsTree.SUBURB.size * radius, strokeWidth = TutorialCardsTree.SUBURB.stroke * r
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        const suburb = new SuburbImage({x, y}, r, strokeWidth)
        suburb.color = TutorialCardsTree.SUBURB.color
        suburb.draw(ctx)
        ctx.restore()
        return {shape: 'suburb', r, strokeWidth, color: suburb.color, disc: {x, y, radius}}
    }
    // A unit's move bar as the game draws it (sprites/entities/units/unit/unit.js, sprites/entities/hpBar.js Bar):
    // count boxes of 0.4 x 0.225 hex radii r, 0.05 r apart, black 0.03 r outline, the first left boxes in the move
    // colour, the rest grey; r is the sprite's (assets.size is 1.6 r). (x, y) is Bar's pos: the bar centred on x, its
    // top 0.9 r above y (Bar's marginY).
    drawMovesBar(ctx, moves, x, y, r) {
        const width = 0.4 * r, gap = 0.05 * r, left = x - (moves.count * width + (moves.count - 1) * gap) / 2
        const top = y - 0.9 * r
        const boxes = []
        for (let i = 0; i < moves.count; ++i) {
            const rect = new Rect(left + i * (width + gap), top, width, 0.225 * r, undefined, 0.03 * r,
                i < moves.left ? '#ffa500' : '#b3b3b3', 'black')
            rect.draw(ctx)
            boxes.push({x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: rect.color})
        }
        return boxes
    }
    drawCheckBadge(ctx, x, y, radius) {
        const colours = TutorialCardsTree.CARD
        const fill = ctx.createRadialGradient(x - 0.3 * radius, y - 0.4 * radius, 0, x, y, radius)
        fill.addColorStop(0, colours.badge[0])
        fill.addColorStop(1, colours.badge[1])
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        // The concept's tick on a 24 x 24 grid, 60% of the badge.
        const k = radius * 1.2 / 24, px = v => x + (v - 12) * k, py = v => y + (v - 12) * k
        ctx.beginPath()
        ctx.moveTo(px(5), py(12.5))
        ctx.lineTo(px(9.5), py(17))
        ctx.lineTo(px(19), py(7.5))
        ctx.strokeStyle = colours.dark
        ctx.lineWidth = 3 * k
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
    }
    // The gold "Next" tag in the card's top-right corner; returns its box. Its font is in the hub's font unit (as
    // hubFont: the 1.5 units are 12 px on a 667x375 screen) and the tag grows with it.
    drawNextTag(ctx, r, u) {
        const colours = TutorialCardsTree.CARD, f = u * hubFontScale(), font = `800 ${1.5 * f}px ${Text.titleFamily}`
        ctx.font = font
        const height = 2.2 * f, width = ctx.measureText('Next').width + 1.8 * f
        const box = {x: r.x + r.width - 0.9 * u - width, y: r.y + 0.9 * u, width, height}
        const fill = ctx.createLinearGradient(0, box.y, 0, box.y + height)
        fill.addColorStop(0, colours.tag[0])
        fill.addColorStop(1, colours.tag[1])
        hubFillRounded(ctx, box, 0.4 * u, fill)
        hubText(ctx, 'Next', box.x + width / 2, box.y + height / 2, font, colours.dark, 'center')
        return box
    }
    // The gold number, then the name in at most 2 lines beside it, centred on y between left and right; the lines stop
    // short of the corner mark where they pass it. button.label keeps what was drawn (fonts, lines, box).
    drawLabel(ctx, button, left, right, y, corner, u) {
        const colours = TutorialCardsTree.CARD, numberFont = `800 ${3 * u}px ${Text.titleFamily}`
        const nameSize = 2 * u, nameFont = `800 ${nameSize}px ${Text.titleFamily}`, lineHeight = 1.15 * nameSize
        ctx.font = numberFont
        const numberWidth = button.number ? ctx.measureText(button.number).width + u : 0
        const nameLeft = left + numberWidth, top = y - lineHeight
        // Each line's right end: 0.6 u short of right, and clear of the corner mark when the line's band reaches it
        // (narrow cards, as on a portrait phone, need the room).
        const ends = [0, 1].map(i => corner && top + i * lineHeight < corner.y + corner.height + 0.3 * u ?
            Math.min(right - 0.6 * u, corner.x - 0.6 * u) : right - 0.6 * u)
        ctx.font = nameFont
        const lines = TutorialCardsTree.wrap(ctx, button.name, ends.map(end => end - nameLeft))
        const width = Math.max(0, ...lines.map(line => ctx.measureText(line).width))
        // On short cards (the divider's) a centred block can reach the mark's bottom: a block as wide as under the mark
        // then starts at that bottom.
        let blockTop = y - lines.length * lineHeight / 2
        if (corner && nameLeft + width > corner.x) blockTop = Math.max(blockTop, corner.y + corner.height)
        lines.forEach((line, i) => hubText(ctx, line, nameLeft, blockTop + (i + 0.5) * lineHeight, nameFont, colours.text))
        if (button.number) hubText(ctx, button.number, left, blockTop + 0.5 * lineHeight, numberFont, colours.gold)
        button.label = {numberFontSize: 3 * u, nameFontSize: nameSize, lines,
            nameBox: {x: nameLeft, y: blockTop, width, height: lines.length * lineHeight},
            numberBox: {x: left, y: blockTop, width: numberWidth, height: 3 * u}}
    }
    // text in ctx's font as at most widths.length lines, word by word; what is left past the last line ends it with an
    // ellipsis, as does a word wider than its line.
    static wrap(ctx, text, widths) {
        const words = text.split(/\s+/).filter(Boolean), lines = []
        for (let i = 0; i < widths.length && words.length; ++i) {
            let line = words.shift()
            while (words.length && ctx.measureText(line + ' ' + words[0]).width <= widths[i]) line += ' ' + words.shift()
            if (i === widths.length - 1 && words.length) line += ' ' + words.splice(0).join(' ')
            lines.push(hubEllipsis(ctx, line, widths[i]))
        }
        return lines
    }
}

// The menu (menu/menu.js) is built with its own tutorial list: the cards take its place, also as the Tutorial banner's
// target.
{
    const list = menu.tutorial, cards = new TutorialCardsTree(menu)
    menu.tutorial = cards
    for (const button of menu.mainButtons) if (button.parameters === list) button.parameters = cards
    cards.setParent(menu.main, menu)
}
