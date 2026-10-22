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
        this.playerInfoMarginY = HEIGHT * 0.6 * 0.2
        this.playerInfoHeight = HEIGHT * 0.6 * 0.4
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
        this.pos.x = this.centerX - this.width / 2
        this.updateBigTextSizes()

        this.background.width = this.width
        this.background.x = this.pos.x

        this.height = this.maxHeight + this.forfeitRowHeight
        this.background.height = this.height
    }
    updatePlayersInfo() {
        let w = this.playerInfoWidth
        let h = this.playerInfoHeight
        let textMargin = h * 0.13
        let textIndent = w * (gameSettings.coop ? 0.06 : 0.15)

        this.playersInfo = []

        for (let i = 1; i < players.length; ++i) {
            let x = this.pos.x + this.playerInfoWidth * ((i - 1) % this.playersCountInRow)
            
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
            if (gameSettings.coop) {
                const info = this.playersInfo[this.playersInfo.length - 1]
                for (const label of [info.textPlayer, info.text]) {
                    if (label.width > w * 0.88) label.fontSize *= w * 0.88 / label.width
                }
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
        if (!this.visible)
            return false
        
        if (!this.isInside(pos)) {
            this.hide()
            return false
        }
        if (this.forfeitShown && this.forfeitState !== 'sending')
            this.forfeitButton.click(pos) || this.yesButton.click(pos) || this.noButton.click(pos)
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        
        this.background.draw(ctx)
        this.roundtext.draw(ctx)
        this.suddenDeathText.draw(ctx)
        this.drawPlayersInfo(ctx)
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
