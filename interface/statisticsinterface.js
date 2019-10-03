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
        
        this.turnTextMarginX = this.width * 0.1
        this.turnTextMarginY = this.height * 0.1
        this.turnText = new Text(this.pos.x + this.turnTextMarginX, this.pos.y + this.turnTextMarginY, 
            this.width * 0.06, undefined, 'black')

        this.playersInfo = []
        this.playersCountInRow = 4
        this.playerInfoWidth = this.width  / this.playersCountInRow
        this.playerInfoHeight = this.height * 0.4
        this.playerInfoMarginY = this.height * 0.2
    }
    get maxWidth() {
        let countInColumn = Math.min(this.playersCountInRow, players.length - 1)

        let w = countInColumn * this.playerInfoWidth
        return w
    }
    get maxHeight() {
        let rowsCount = Math.ceil((players.length - 1) / this.playersCountInRow)

        let h = this.playerInfoMarginY + rowsCount * this.playerInfoHeight + this.cornerRadius / 2
        return h
    }
    updateSizes() {
        this.width = this.maxWidth
        this.pos.x = this.centerX - this.width / 2
        this.turnText.pos.x = this.pos.x + this.turnTextMarginX

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

            let text = 'gold: ' + players[i].gold + '\n' + 
                'income: ' + players[i].income + '\n' +
                'suburbs: ' + players[i].suburbsCount + '\n' +
                'army cost: ' + players[i].armyCost + '\n' + 
                'army salary: ' + players[i].armySalary
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
            //this.playersInfo[i].rect.draw(ctx)
            this.playersInfo[i].textPlayer.draw(ctx)
            this.playersInfo[i].text.draw(ctx)
        }
    }
    show() {
        this.visible = true
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
        this.turnText.draw(ctx)
        this.drawPlayersInfo(ctx)
    }
}