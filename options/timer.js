class Timer {
    constructor() {
        // this.time is turn time
        // initialization in nextTurn or in loader:

        this.text = new Text(WIDTH - WIDTH * 0.06, HEIGHT - nextTurnButtonSize * 1.1 / 2, WIDTH * 0.03,
            'timer text', 'white')
        this.isTick = false
    }
    calcTime() {
        // units * 10  + gold (seconds) + 20
        let player = players[whooseTurn]
        const unitsRatio = 12
        let result = player.unitsCount * unitsRatio
        if (player.townsCount)
            result += Math.floor(player.gold / 3) + player.townsCount * 10
        //+ player.townsCount * townRatio + player.barracksCount * barrackRatio
        result *= 1000
        // now milliseconds in result
        
        return result
    }
    updateLastPause() {
        this.lastPause = Date.now()
        this.isTick = true
    }
    get seconds() {
        return Math.floor(this.time / 1000)
    }
    nextTurn() {
        this.pause()
        this.time = this.calcTime()
    }
    pause() {
        this.isTick = false
    }
    check() {
        if (Date.now() - this.lastPause > this.time) {
            nextTurn()
        }
    }
    get timeLeft() {
        if (this.isTick)
            return this.time - (Date.now() - this.lastPause)
        return this.time
    }
    toJSON() {
        let res = {
            time: this.timeLeft, 
            enable: true,
            type: 'classic'
        }
        return res
    }
    get timerText() {
        if (this.isTick)
            this.check()
        let millisecondsLeft = this.timeLeft
        let secondsLeft = Math.floor(millisecondsLeft / 1000)

        let m = Math.floor(secondsLeft / 60)
        let s = secondsLeft % 60
        if (!m)
            return String(s)
        let res = m + 'm'
        if (s)
            res += s + 's'
        return res
    }
    draw(ctx) {
        if (!this.isTick) {
            return
        }
        
        this.text.text = this.timerText

        this.text.draw(ctx)
    }
}
const STANDARTTIME = 0 * 60 * 1000
class LongTimer extends Timer {
    constructor(fullTime = STANDARTTIME, timeAdd = 2.5 * 60 * 1000) {
        super()
        this.time = fullTime
        this.timeAdd = timeAdd
    }
    calcTime() {
        let t = unpacker.getPlayerTime()
        if (isNaN(t))
            t = STANDARTTIME
        return t + this.timeAdd
    }
    pause() {
        this.isTick = false
        if (!isNaN(this.lastPause))
            this.time -= Math.floor(Date.now() - this.lastPause)
        this.time = Math.max(this.time, 0)

        unpacker.savePlayerTime()
    }
    nextTurn() {
        let oldWhooseTurn = whooseTurn
        whooseTurn = (whooseTurn - 1 + players.length) % players.length
        if (whooseTurn == 0)
            whooseTurn = players.length - 1
        this.pause()
        whooseTurn = oldWhooseTurn
        this.time = this.calcTime()
    }
    toJSON() {
        let res = super.toJSON()
        res.type = 'long'
        return res
    }
}