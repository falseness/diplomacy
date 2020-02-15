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
        this.width = this.maxWidth
        this.pos.x = this.centerX - this.width / 2
        this.updateBigTextSizes()

        this.background.width = this.width
        this.background.x = this.pos.x

        this.height = this.maxHeight
        this.background.height = this.height
    }
    updatePlayersInfo() {
        let w = this.playerInfoWidth
        let h = this.playerInfoHeight
        let textMargin = h * 0.13
        let textIndent = w * 0.15

        this.playersInfo = []

        for (let i = 1; i < players.length; ++i) {
            let x = this.pos.x + this.playerInfoWidth * ((i - 1) % this.playersCountInRow)
            
            let y = this.pos.y + this.playerInfoMarginY +
                this.playerInfoHeight * Math.floor((i - 1 ) / this.playersCountInRow)

            let text 
            if (players[i].isLost) {
                text = 'Lost'
            }
            else {
                text = 'gold: ' + players[i].gold + '\n' + 
                    'income: ' + players[i].income + '\n' +
                    'suburbs: ' + players[i].suburbsCount + '\n' +
                    'army cost: ' + players[i].armyCost + '\n' + 
                    'army salary: ' + players[i].armySalary
                
                if (isFogOfWar && i != whooseTurn) {
                    text = '???'
                }
            }
            this.playersInfo.push({
                rect: new Rect(x, y, this.playerInfoWidth, this.playerInfoHeight),
                textPlayer: new Text(x + w / 2, y + textMargin, 
                    h * 0.2, 'Player ' + i, players[i].hexColor),
                text: new Text(x + textIndent, y + textMargin * 2.5, 
                    h * 0.15, text, players[i].hexColor, 'left')
            })
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

        this.updateSizes()
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
        return true
    }
    draw(ctx) {
        if (!this.visible)
            return
        
        this.background.draw(ctx)
        this.roundtext.draw(ctx)
        this.suddenDeathText.draw(ctx)
        this.drawPlayersInfo(ctx)
    }
}