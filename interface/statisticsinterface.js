// The (i) panel's pause section and pill (TASK-1283): dark text on the white panel, muted secondary text, red vote
// errors, a greyed disabled vote button, the clock's 'running'/'frozen' tag; every text >= 4.5:1 against its background.
const PAUSE_LOOK = {
    text: '#1f1f1f',
    muted: '#555555',
    error: '#b00020',
    separator: '#d4d4d4',
    darkChip: '#000000',
    disabled: {fill: '#ececec', stroke: '#9a9a9a', text: '#5c5c5c'},
    running: {fill: '#e3f4e8', text: '#1e6b35'},
    frozen: {fill: '#e3edf8', text: '#1d4f86'},
    pill: {
        pausePending: {fill: '#8a4b00', stroke: '#5c3200', text: '#ffffff', label: 'Pause pending'},
        paused: {fill: '#1f2a44', stroke: '#0d1220', text: '#ffffff', label: 'Paused'},
    },
}
class StatisticsInterface {

    constructor() {
        this.visible = false

        this.centerX = WIDTH * 0.5

        this.width = WIDTH * 0.76
        this.height = 0.6 * HEIGHT

        this.cornerRadius = 0.03 * WIDTH
        let stroke = 0.001 * WIDTH

        this.pos = {
            x: this.centerX - this.width / 2,
            y: -stroke / 2, // 0.12
        } 

        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, 
            [0, 0, this.cornerRadius, this.cornerRadius], stroke, 'white')
        
        this.playersInfo = []
        this.playersCountInRow = 4
        this.playerInfoWidth = this.width  / this.playersCountInRow
        this.playerInfoHeight = this.height * 0.4
        this.playerInfoMarginY = this.height * 0.2

        this.roundtextMarginX = this.playerInfoWidth * 0.15
        this.roundtextMarginY = this.height * 0.1
        const bigTextSize = this.width * 0.05
        this.roundtext = new Text(this.pos.x + this.roundtextMarginX, this.pos.y + this.roundtextMarginY, 
            bigTextSize, undefined, 'black', 'left')
        this.suddenDeathText = new Text(this.pos.x + this.width - this.roundtextMarginX, 
            this.pos.y + this.roundtextMarginY, bigTextSize, undefined, 'black', 'right')

        this.roundTextSuddenDeathTextMinMargin = 0.075 * WIDTH

        // An online game's forfeit row under the players (onlineForfeit, options/onlineLogic.js): 'forfeit', then
        // 'Are you sure?' with 'yes' and 'no'. forfeitState: 'idle' | 'confirm' | 'sending' | 'error'.
        this.forfeitShown = false
        this.forfeitState = 'idle'
        this.forfeitText = new Text(NaN, NaN, 16, 'Are you sure?', 'black')
        const forfeitButton = (text, clickFunc) => new Button(new Rect(NaN, NaN, 0, 0,
            [0, 0, 0, 0], stroke * 2, 'white'), new Text(NaN, NaN, 16, text, 'black'), clickFunc, undefined, true, this)
        this.forfeitButton = forfeitButton('forfeit', this.askForfeit)
        this.yesButton = forfeitButton('yes', this.confirmForfeit)
        this.noButton = forfeitButton('no', this.cancelForfeit)

        // An online game's pause section between the players and the forfeit row (onlinePause, options/onlineLogic.js):
        // the status with the remaining voters' names, the vote error, the vote button (and, for the host while paused,
        // a 'Kick player N' per seat), the disabled vote's reason and the server clock. updatePauseSection() places it.
        this.pauseShown = false
        this.pauseState = null
        this.pauseHeight = 0
        this.pauseItems = []
        this.pauseTexts = {status: '', error: '', meta: ''}
        this.pauseTop = NaN
        this.voteButton = forfeitButton('', this.votePause)
        this.kickButtons = []
        this.makeButton = forfeitButton
        // The top-centre pill of a pending or full pause while the panel is closed; a click opens the panel.
        this.pillRect = null
        this.pillText = new Text(NaN, NaN, 16, '', 'white', 'left')
    }
    // Relative luminance and WCAG contrast of {r, g, b} colours.
    static luminance({r, g, b}) {
        const linear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
    static contrast(a, b) {
        const [la, lb] = [StatisticsInterface.luminance(a), StatisticsInterface.luminance(b)]
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    static rgb(hex) {
        return {r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16)}
    }
    // A player's name in their colour, on a chip that keeps it readable: white for a dark colour, black for a light
    // one (whichever contrasts more; one of them always reaches 4.5:1).
    playerChip(index, font, size) {
        const player = players[index]
        const color = player ? player.hexColor : PAUSE_LOOK.text
        const rgb = StatisticsInterface.rgb(color)
        const fill = StatisticsInterface.contrast(rgb, StatisticsInterface.rgb('#ffffff')) >=
            StatisticsInterface.contrast(rgb, StatisticsInterface.rgb(PAUSE_LOOK.darkChip)) ? '#ffffff' : PAUSE_LOOK.darkChip
        return {text: 'Player ' + index, color, font, size, chip: {fill, stroke: color}, player: index}
    }
    get pauseButtonHeight() {
        return Math.max(28, HEIGHT * 0.06)
    }
    get pauseFontSize() {
        return Math.max(14, this.pauseButtonHeight * 0.55)
    }
    get pauseRowHeight() {
        return this.pauseShown && this.pauseState ? this.pauseHeight : 0
    }
    // Lays tokens ({text, color, font, size, chip?, sep?, join?}) out in centred lines of at most maxWidth from the line
    // top y. Lines break between groups: a token starts one unless it joins the previous token's; a group too wide for
    // a line breaks between its words; a ' · ' separator never starts or ends a line. Returns the next line's top.
    flowPause(tokens, y, lineHeight, maxWidth) {
        const ctx = mainCtx
        const groups = []
        for (const token of tokens) {
            if (!token.join || !groups.length) groups.push([])
            for (const text of token.chip || token.sep ? [token.text] : token.text.split(' ').filter(Boolean)) {
                ctx.font = token.font
                const textWidth = ctx.measureText(text).width
                const pad = token.chip ? token.size * 0.45 : 0
                groups[groups.length - 1].push({...token, text, textWidth, pad, width: textWidth + pad * 2})
            }
        }
        const lines = [[]]
        let lineWidth = 0
        const widthOf = words => words.reduce((sum, word, i) => sum + word.width + (i ? word.size * 0.3 : 0), 0)
        const newLine = () => {
            const line = lines[lines.length - 1]
            while (line.length && line[line.length - 1].sep) line.pop()
            lines.push([])
            lineWidth = 0
        }
        const add = word => {
            const line = lines[lines.length - 1]
            lineWidth += (line.length ? word.size * 0.3 : 0) + word.width
            line.push(word)
        }
        for (const group of groups) {
            const line = lines[lines.length - 1]
            if (group[0].sep) {
                if (line.length) add(group[0])
                continue
            }
            const width = widthOf(group)
            if (line.length && lineWidth + group[0].size * 0.3 + width > maxWidth) newLine()
            if (width <= maxWidth) {
                group.forEach(add)
                continue
            }
            for (const word of group) {
                if (lines[lines.length - 1].length && lineWidth + word.size * 0.3 + word.width > maxWidth) newLine()
                add(word)
            }
        }
        newLine()
        for (const line of lines.filter(line => line.length)) {
            // Neighbouring words of one style are one text.
            const merged = []
            for (const word of line) {
                const last = merged[merged.length - 1]
                if (last && !last.chip && !word.chip && last.font === word.font && last.color === word.color) {
                    last.text += ' ' + word.text
                    ctx.font = last.font
                    last.textWidth = last.width = ctx.measureText(last.text).width
                } else merged.push({...word})
            }
            const width = merged.reduce((sum, word, i) => sum + word.width + (i ? word.size * 0.3 : 0), 0)
            let x = this.centerX - width / 2
            for (const word of merged) {
                const item = {text: word.text, color: word.color, font: word.font, x: x + word.pad, y: y + lineHeight / 2,
                    width: word.textWidth, size: word.size}
                if (word.chip) item.chip = {...word.chip, x, y: item.y - word.size * 0.7, width: word.width,
                    height: word.size * 1.4}
                if (word.player) item.player = word.player
                this.pauseItems.push(item)
                x += word.width + word.size * 0.3
            }
            y += lineHeight
        }
        return y
    }
    // Places buttons in centred rows of at most maxWidth from y; returns the bottom of the last row.
    placePauseButtons(buttons, y, maxWidth) {
        const height = this.pauseButtonHeight, gap = height * 0.3
        const rows = [[]]
        let rowWidth = 0
        for (const button of buttons) {
            const row = rows[rows.length - 1]
            if (row.length && rowWidth + gap + button.width > maxWidth) {
                rows.push([button])
                rowWidth = button.width
            } else {
                rowWidth += (row.length ? gap : 0) + button.width
                row.push(button)
            }
        }
        for (const [i, row] of rows.entries()) {
            let x = this.centerX - (row.reduce((sum, button) => sum + button.width, 0) + gap * (row.length - 1)) / 2
            for (const button of row) {
                button.pos = {x, y}
                x += button.width + gap
            }
            y += height + (i < rows.length - 1 ? gap : 0)
        }
        return y
    }
    // Lays out the pause section under the players (updateSizes calls it once the panel's width is known, and takes
    // its height): status, error, buttons, reason and clock.
    updatePauseSection() {
        const state = this.pauseState
        this.pauseItems = []
        if (!this.pauseShown || !state) {
            this.pauseHeight = 0
            return
        }
        // The buttons' font is the forfeit button's; the lines' at most 4.5% of a narrow (portrait) screen's width.
        const size = Math.min(this.pauseFontSize, Math.max(14, WIDTH * 0.045)), small = Math.max(13, size * 0.8)
        const font = (px, weight = '') => (weight ? weight + ' ' : '') + px + 'px ' + Text.defaultFamily
        const plain = (text, color = PAUSE_LOOK.text, weight = '') => ({text, color, font: font(size, weight), size})
        const sep = {...plain('·', PAUSE_LOOK.muted), sep: true}
        const line = size * 1.6
        const maxWidth = this.width * 0.92
        const buttonHeight = this.pauseButtonHeight
        const top = this.pauseTop = this.pos.y + this.maxHeight
        let y = top + line * 0.3

        const row = state.row
        const titles = {running: 'Game running', pausePending: 'Pause requested — finishing turns…', paused: 'Game paused'}
        const status = !row ? [plain(state.status, PAUSE_LOOK.muted)] : [plain(titles[row.status], PAUSE_LOOK.text, 'bold'),
            sep, plain(`${row.phase === 'resume' ? 'Resume' : 'Pause'} votes ${row.consent.length}/${row.required.length}`),
            sep, ...(state.remaining.length ? [plain('Waiting for'), ...state.remaining.map(index =>
                ({...this.playerChip(index, font(size, 'bold'), size), join: true}))] : [plain('All players voted')])]
        const errorColor = /rejected/i.test(state.error) ? PAUSE_LOOK.error : PAUSE_LOOK.text
        const clock = state.clockValue
        const seconds = clock ? Math.ceil(clock.ms / 1000) : 0
        const meta = [
            ...(state.voteLabel && !state.voteEnabled && state.voteReason ? [plain(state.voteReason, PAUSE_LOOK.muted)] : []),
            ...(state.voteReason && clock && state.voteLabel && !state.voteEnabled ? [sep] : []),
            ...(clock ? [plain('Server clock', PAUSE_LOOK.muted),
                {...plain(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, PAUSE_LOOK.text, 'bold'),
                    join: true},
                {join: true, text: clock.running ? 'running' : 'frozen', color: PAUSE_LOOK[clock.running ? 'running' : 'frozen'].text,
                    font: font(small), size: small, chip: {fill: PAUSE_LOOK[clock.running ? 'running' : 'frozen'].fill}}] : []),
        ]
        const lineText = tokens => tokens.map(token => token.text).join(' ')
        this.pauseTexts = {status: lineText(status), error: state.error, meta: lineText(meta)}

        y = this.flowPause(status, y, line, maxWidth)
        if (state.error) y = this.flowPause([plain(state.error, errorColor)], y, line, maxWidth)

        const placeButton = (button, label) => {
            button.text.text = label
            button.text.fontSize = this.pauseFontSize
            button.rect.width = Math.min(maxWidth, Math.max(70, WIDTH * 0.08, button.text.width + buttonHeight))
            button.rect.height = buttonHeight
            button.rect.cornerRadius = Array(4).fill(buttonHeight * 0.25)
        }
        this.voteButton.canClick = state.voteEnabled
        this.kickButtons = state.kickSeats.map(seat =>
            this.makeButton(`Kick player ${seat}`, () => onlinePause?.kick(seat)))
        const buttons = [...(state.voteLabel ? [this.voteButton] : []), ...this.kickButtons]
        if (state.voteLabel) placeButton(this.voteButton, state.voteLabel)
        for (const button of this.kickButtons) placeButton(button, button.text.text)
        const enabled = state.voteEnabled
        this.voteButton.rect.color = enabled ? 'white' : PAUSE_LOOK.disabled.fill
        this.voteButton.rect.strokeColor = enabled ? 'black' : PAUSE_LOOK.disabled.stroke
        this.voteButton.text.color = enabled ? 'black' : PAUSE_LOOK.disabled.text
        if (buttons.length) y = this.placePauseButtons(buttons, y + line * 0.2, maxWidth) + line * 0.2

        if (meta.length) y = this.flowPause(meta, y, line, maxWidth)
        this.pauseHeight = y + line * 0.3 - top
    }
    votePause() {
        onlinePause?.vote()
    }
    // onlinePause's change notification: the section's texts and buttons change, and with them the panel's height.
    pauseChanged() {
        if (!this.visible || !this.pauseShown || typeof onlinePause === 'undefined' || !onlinePause)
            return
        this.pauseState = onlinePause.state()
        this.updateSizes()
        if (this.forfeitShown) this.updateForfeitRow()
        this.updatePlayersInfo()
    }
    get forfeitRowHeight() {
        return this.forfeitShown ? Math.max(70, HEIGHT * 0.18) : 0
    }
    // Lays out the forfeit row at the bottom of the panel (updateSizes made room for it).
    updateForfeitRow() {
        const h = this.forfeitRowHeight
        const top = this.pos.y + this.height - h
        const buttonHeight = Math.max(28, HEIGHT * 0.06)
        const buttonWidth = Math.max(70, WIDTH * 0.08)
        const fontSize = Math.max(14, buttonHeight * 0.55)
        for (const button of [this.forfeitButton, this.yesButton, this.noButton]) {
            button.rect.width = buttonWidth
            button.rect.height = buttonHeight
            button.rect.cornerRadius = Array(4).fill(buttonHeight * 0.25)
            button.text.fontSize = fontSize
        }
        this.forfeitText.fontSize = fontSize
        this.forfeitText.pos = {x: this.centerX, y: top + h * 0.3}
        const buttonsY = top + h * (this.forfeitState === 'idle' ? 0.5 : 0.68) - buttonHeight / 2
        this.forfeitButton.pos = {x: this.centerX - buttonWidth / 2, y: buttonsY}
        this.yesButton.pos = {x: this.centerX - buttonWidth * 1.15, y: buttonsY}
        this.noButton.pos = {x: this.centerX + buttonWidth * 0.15, y: buttonsY}
        this.forfeitButton.canClick = this.forfeitState === 'idle'
        this.yesButton.canClick = this.noButton.canClick = this.forfeitState === 'confirm'
    }
    setForfeitState(state, text = 'Are you sure?') {
        this.forfeitState = state
        this.forfeitText.text = text
        this.updateForfeitRow()
    }
    askForfeit() {
        this.setForfeitState('confirm')
    }
    cancelForfeit() {
        this.setForfeitState('idle')
    }
    // 'yes': game:forfeit; on ok onlineForfeit closes the game to the menu, an error stays on this panel.
    async confirmForfeit() {
        const forfeit = onlineForfeit
        this.setForfeitState('sending', 'forfeiting…')
        const ack = await forfeit.send()
        if (ack.ok || forfeit !== onlineForfeit) return
        this.setForfeitState('error', 'Forfeit failed: ' + onlineErrorCode(ack.error))
        this.forfeitButton.canClick = true
    }
    get maxWidth() {
        let countInColumn = Math.min(this.playersCountInRow, players.length - 1)
        let w = countInColumn * this.playerInfoWidth

        this.width = w //temporary for easy calculation
        this.updateBigTextSizes()

        if (this.suddenDeathText.left - this.roundtext.right < this.roundTextSuddenDeathTextMinMargin)
                w += this.roundTextSuddenDeathTextMinMargin - 
                    (this.suddenDeathText.left - this.roundtext.right)
        
        return w
    }
    get maxHeight() {
        let rowsCount = Math.ceil((players.length - 1) / this.playersCountInRow)

        let h = this.playerInfoMarginY + rowsCount * this.playerInfoHeight + this.cornerRadius / 2
        return h
    }
    updateBigTextSizes() {
        this.roundtext.pos.x = this.pos.x + this.roundtextMarginX
        this.suddenDeathText.pos.x = this.pos.x + this.width - this.roundtextMarginX
    }
    updateSizes() {
        this.playersCountInRow = 4
        this.playerInfoWidth = WIDTH * 0.76 / 4
        // A portrait screen's rows stay as tall as its width allows (the texts are sized by the row height).
        this.playerInfoMarginY = Math.min(HEIGHT * 0.6 * 0.2, WIDTH * 0.15)
        this.playerInfoHeight = Math.min(HEIGHT * 0.6 * 0.4, WIDTH * 0.3)
        this.roundtext.fontSize = this.suddenDeathText.fontSize = WIDTH * 0.76 * 0.05
        if (gameSettings.coop) {
            this.playersCountInRow = WIDTH < 600 ? 3 : 4
            this.playerInfoWidth = WIDTH * 0.9 / this.playersCountInRow
            this.playerInfoMarginY = HEIGHT * 0.09
            this.playerInfoHeight = Math.min(HEIGHT * 0.2,
                HEIGHT * 0.72 / Math.ceil((players.length - 1) / this.playersCountInRow))
            this.roundtext.fontSize = this.suddenDeathText.fontSize = Math.max(15, WIDTH * 0.025)
        }
        this.width = this.maxWidth
        // The pause section needs room for its lines: half the screen (at least 460 px), at most the screen's width.
        if (this.pauseShown && this.pauseState)
            this.width = Math.max(this.width, Math.min(WIDTH * 0.96, Math.max(WIDTH * 0.5, 460)))
        this.pos.x = this.centerX - this.width / 2
        this.updateBigTextSizes()
        this.playerInfoWidth = Math.max(this.playerInfoWidth,
            this.width / Math.max(1, Math.min(this.playersCountInRow, players.length - 1)))

        this.background.width = this.width
        this.background.x = this.pos.x

        this.updatePauseSection()
        this.height = this.maxHeight + this.pauseRowHeight + this.forfeitRowHeight
        this.background.height = this.height
    }
    updatePlayersInfo() {
        let w = this.playerInfoWidth
        let h = this.playerInfoHeight
        let textMargin = h * 0.13
        let textIndent = w * (gameSettings.coop ? 0.06 : 0.15)
        // A panel wider than its players' columns (the round texts, the pause section) centres them.
        const columns = Math.min(this.playersCountInRow, players.length - 1)
        const left = this.pos.x + Math.max(0, (this.width - columns * this.playerInfoWidth) / 2)

        this.playersInfo = []

        for (let i = 1; i < players.length; ++i) {
            let x = left + this.playerInfoWidth * ((i - 1) % this.playersCountInRow)
            
            let y = this.pos.y + this.playerInfoMarginY +
                this.playerInfoHeight * Math.floor((i - 1 ) / this.playersCountInRow)

            let text 
            let textColor = players[i].hexColor
            if (players[i].isLost) {
                text = 'Lost'
                // A partial board: lost players come from the server's status and are greyed out.
                if (hiddenInfo) textColor = 'grey'
            }
            else {
                text = players[i].info
                
                if (isFogOfWar && !gameSettings.coop && i != whooseTurn) {
                    text = '???'
                }
                // A partial board's lists hide most of another player's economy.
                if (hiddenInfo && !players[whooseTurn]?.isAlliedWith(players[i])) {
                    text = '???'
                }
            }
            this.playersInfo.push({
                rect: new Rect(x, y, this.playerInfoWidth, this.playerInfoHeight),
                textPlayer: new Text(x + w / 2, y + textMargin, 
                    h * 0.2, 'Player ' + i, players[i].hexColor),
                text: new Text(x + textIndent, y + textMargin * 2.5, 
                    h * 0.15, text, textColor, 'left')
            })
            // Each label fits its column.
            const info = this.playersInfo[this.playersInfo.length - 1]
            for (const label of [info.textPlayer, info.text]) {
                const room = label === info.text ? w - textIndent - w * 0.04 : w * 0.88
                if (label.width > room) label.fontSize *= room / label.width
            }
        }
    }
    drawPlayersInfo(ctx) {
        for (let i = 0; i < this.playersInfo.length; ++i) {
            if (debug)
                this.playersInfo[i].rect.draw(ctx)
            this.playersInfo[i].textPlayer.draw(ctx)
            this.playersInfo[i].text.draw(ctx)
        }
    }
    updateSuddenDeathText() {
        if (gameRound < suddenDeathRound - 1) {
            this.suddenDeathText.color = 'black'
            this.suddenDeathText.text = 'sudden death ' + suddenDeathRound
            return
        }
        this.suddenDeathText.color = '#ff0000'
        if ((gameRound - suddenDeathRound) % 2) 
            this.suddenDeathText.text = 'sudden death now'
        else
            this.suddenDeathText.text = 'sudden death next round'
    }
    show() {
        this.visible = true

        this.roundtext.text = 'round ' + gameRound
        this.updateSuddenDeathText()

        this.forfeitShown = typeof onlineForfeit !== 'undefined' && !!onlineForfeit && gameSettings.isOnline &&
            onlineForfeit.available()
        this.forfeitState = 'idle'
        this.pauseShown = typeof onlinePause !== 'undefined' && !!onlinePause && gameSettings.isOnline &&
            !gameSettings.tutorial
        this.pauseState = this.pauseShown ? onlinePause.state() : null
        if (this.pauseShown) onlinePause.onchange = () => this.pauseChanged()
        this.updateSizes()
        if (this.forfeitShown) this.setForfeitState('idle')
        this.updatePlayersInfo()
    }
    hide() {
        this.visible = false
    }
    isInside(point) {
        return this.background.isInside(point)
    }
    click(pos) {
        // The closed panel's pill opens it.
        if (!this.visible) {
            if (!this.pausePillStatus || !this.pillRect || !this.pillRect.isInside(pos))
                return false
            this.show()
            return true
        }

        if (!this.isInside(pos)) {
            this.hide()
            return false
        }
        if (this.pauseShown && this.pauseState)
            this.voteButton.click(pos) || this.kickButtons.some(button => button.click(pos))
        if (this.forfeitShown && this.forfeitState !== 'sending')
            this.forfeitButton.click(pos) || this.yesButton.click(pos) || this.noButton.click(pos)
        return true
    }
    // A rounded rect filled (and outlined if stroke) at rect's bounds.
    static fillRounded(ctx, rect, radius, fill, stroke, lineWidth = 1) {
        const shape = new Rect(rect.x, rect.y, rect.width, rect.height, Array(4).fill(radius), stroke ? lineWidth : 0,
            fill, stroke || fill)
        shape.draw(ctx)
    }
    drawPauseSeparator(ctx, y) {
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = PAUSE_LOOK.separator
        ctx.lineWidth = Math.max(1, HEIGHT * 0.002)
        ctx.moveTo(this.pos.x + this.width * 0.05, y)
        ctx.lineTo(this.pos.x + this.width * 0.95, y)
        ctx.stroke()
        ctx.restore()
    }
    drawPauseSection(ctx) {
        const state = this.pauseShown && this.pauseState
        if (!state)
            return
        this.drawPauseSeparator(ctx, this.pauseTop)
        for (const item of this.pauseItems) {
            if (item.chip)
                StatisticsInterface.fillRounded(ctx, item.chip, item.chip.height / 2, item.chip.fill, item.chip.stroke,
                    Math.max(1, item.size * 0.08))
            ctx.font = item.font
            ctx.fillStyle = item.color
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(item.text, item.x, item.y)
        }
        // A disabled vote button stays on screen, greyed out (Button.draw draws only clickable buttons).
        if (state.voteLabel) {
            this.voteButton.rect.draw(ctx)
            this.voteButton.text.draw(ctx)
        }
        for (const button of this.kickButtons) button.draw(ctx)
        if (this.forfeitShown) this.drawPauseSeparator(ctx, this.pos.y + this.height - this.forfeitRowHeight)
    }
    // 'pausePending' or 'paused' while the panel is closed in an online game, else null (no pill).
    get pausePillStatus() {
        if (this.visible || typeof onlinePause === 'undefined' || !onlinePause || !gameSettings.isOnline ||
                gameSettings.tutorial)
            return null
        return PAUSE_LOOK.pill[onlinePauseStatus] ? onlinePauseStatus : null
    }
    // The pill at the top centre: a pause sign and 'Pause pending' or 'Paused'.
    drawPausePill(ctx) {
        const status = this.pausePillStatus
        if (!status) {
            this.pillRect = null
            return
        }
        const look = PAUSE_LOOK.pill[status]
        const size = Math.max(14, Math.min(WIDTH, HEIGHT) * 0.03)
        const text = this.pillText
        text.text = look.label
        text.fontSize = size
        text.fontWeight = 'bold'
        text.color = look.text
        const pad = size * 0.8, icon = size * 0.55, gap = size * 0.45, height = size * 1.8
        const width = pad * 2 + icon + gap + text.width
        const rect = this.pillRect = new Rect(this.centerX - width / 2, Math.max(6, HEIGHT * 0.012), width, height)
        StatisticsInterface.fillRounded(ctx, rect, height / 2, look.fill, look.stroke, Math.max(1, size * 0.08))
        ctx.fillStyle = look.text
        const barWidth = icon * 0.35, barHeight = size * 0.75, barTop = rect.y + (height - barHeight) / 2
        ctx.fillRect(rect.x + pad, barTop, barWidth, barHeight)
        ctx.fillRect(rect.x + pad + icon - barWidth, barTop, barWidth, barHeight)
        text.pos = {x: rect.x + pad + icon + gap, y: rect.y + height / 2}
        text.draw(ctx)
    }
    draw(ctx) {
        if (!this.visible) {
            this.drawPausePill(ctx)
            return
        }
        this.pillRect = null
        this.background.draw(ctx)
        this.roundtext.draw(ctx)
        this.suddenDeathText.draw(ctx)
        this.drawPlayersInfo(ctx)
        this.drawPauseSection(ctx)
        if (!this.forfeitShown)
            return
        if (this.forfeitState !== 'idle')
            this.forfeitText.draw(ctx)
        this.forfeitButton.draw(ctx)
        this.yesButton.draw(ctx)
        this.noButton.draw(ctx)
    }
}
// The game-over screen of a finished online game (options/onlineLogic.js onlineGameFinished): the result over the dimmed
// board, 'Watch replay' (game:replay of this game in the replay viewer, menu/replay.js; leaving it returns to the online
// hub) and 'Back to menu'. Shown once the last board the server sent is terminal (onlineGameOver): a winner's own
// finishing turn first reaches the server.
class OnlineResultInterface {
    constructor() {
        this.visible = false
        this.gameID = null
        this.loading = false
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, 0, 'rgba(0, 0, 0, 0.4)')
        this.panel = new Rect(WIDTH * 0.25, HEIGHT * 0.2, WIDTH * 0.5, HEIGHT * 0.6,
            [0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH, 0.02 * WIDTH], 0.0035 * WIDTH, 'white')
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, Math.min(0.06 * WIDTH, 0.09 * HEIGHT), 'Game over', 'black')
        this.subtitle = new Text(WIDTH / 2, HEIGHT * 0.375, Math.min(0.025 * WIDTH, 0.045 * HEIGHT), '', 'black')
        this.status = new Text(WIDTH / 2, HEIGHT * 0.755, Math.min(0.02 * WIDTH, 0.04 * HEIGHT), '', 'red')
        this.replayButton = OnlineResultInterface.getButton(HEIGHT * 0.43, 'Watch replay', this.watchReplay, this)
        this.backButton = OnlineResultInterface.getButton(HEIGHT * 0.58, 'Back to menu', menuBack, this)
    }
    static getButton(y, text, clickFunc, callThis) {
        const width = WIDTH * 0.36
        const rect = Menu.getButtonRect({x: WIDTH / 2 - width / 2, y: y})
        rect.width = width
        return new MenuButton(rect, Menu.getButtonText(text), clickFunc, undefined, true, callThis)
    }
    // This seat's result: co-op the shared result, else Victory for the last player standing, Defeat for a lost seat.
    resultTexts() {
        if (gameSettings.coop) {
            const labels = {victory: ['Victory', 'humans win'], defeat: ['Defeat', 'demons win'], draw: ['Draw', 'all sides eliminated']}
            return labels[players[0].coopResult] || ['Game over', '']
        }
        const alive = players.map((player, index) => index).filter(index => index > 0 && !players[index].isLost)
        const winner = hiddenInfo ? hiddenGameStatus().winner : alive.length === 1 ? alive[0] : null
        const wins = winner !== null && winner !== undefined ? `Player ${winner} wins` : ''
        if (winner === whooseTurn) return ['Victory', wins]
        if (players[whooseTurn]?.isLost) return ['Defeat', wins]
        return ['Game over', wins]
    }
    // Called every frame of an online game: shows the screen once the server's board of the open game is terminal.
    update() {
        const gameID = typeof onlineSession === 'undefined' ? null : onlineSession.openGameID
        if (!gameSettings.isOnline || gameSettings.tutorial || gameID === null || !onlineSocket || replayViewer) {
            if (this.visible) this.hide()
            return
        }
        if (this.visible && this.gameID === gameID) return
        if (!grid || typeof onlineGameOver !== 'function' || !onlineGameOver()) return
        this.show(gameID)
    }
    show(gameID) {
        this.gameID = gameID
        this.loading = false
        const [title, subtitle] = this.resultTexts()
        this.title.text = title
        this.title.color = title === 'Victory' ? 'green' : title === 'Defeat' ? 'red' : 'black'
        this.subtitle.text = subtitle
        this.status.text = ''
        this.replayButton.canClick = true
        this.visible = true
        statisticsInterface.hide()
        nextTurnPauseInterface.visible = false
    }
    hide() {
        this.visible = false
        this.loading = false
    }
    // game:replay; a finishing turn the server still commits answers NOT_FINISHED for a moment, so that is retried.
    async watchReplay() {
        if (this.loading) return
        const gameID = this.gameID
        this.loading = true
        this.status.text = 'loading…'
        let ack = await onlineSession.replayGame(gameID)
        for (let retry = 0; !ack.ok && ack.error === 'NOT_FINISHED' && retry < 10; ++retry) {
            await new Promise(resolve => setTimeout(resolve, 500))
            if (!this.visible || this.gameID !== gameID) return
            ack = await onlineSession.replayGame(gameID)
        }
        if (!this.visible || this.gameID !== gameID) return
        this.loading = false
        if (!ack.ok) {
            this.status.text = 'could not open the replay: ' + onlineErrorCode(ack.error)
            return
        }
        this.hide()
        menuBack()
        menu.onlineHub.showReplay(ack)
    }
    // The (i) statistics panel opens over this screen (its own clicks, outside it closes it); outside the panel only
    // the (i) and menu buttons take a click, the board none.
    click(pos) {
        if (!this.visible || statisticsInterface.visible)
            return false
        if (!this.panel.isInside(pos))
            iButton.click(pos) || backToMenuButton.click(pos)
        else if (!this.loading)
            this.replayButton.click(pos) || this.backButton.click(pos)
        return true
    }
    draw(ctx) {
        if (!this.visible || statisticsInterface.visible)
            return
        this.background.draw(ctx)
        this.panel.draw(ctx)
        this.title.draw(ctx)
        if (this.subtitle.text) this.subtitle.draw(ctx)
        this.replayButton.draw(ctx)
        this.backButton.draw(ctx)
        if (this.status.text) this.status.draw(ctx)
    }
}
