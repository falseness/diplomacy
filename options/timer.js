class Timer {
    constructor() {
        // this.time is turn time
        // initialization in nextTurn or in loader:
        /*this.time = time
        this.lastPause = Date.now()*/

        this.text = new Text(WIDTH - WIDTH * 0.07, HEIGHT - WIDTH * 0.1 + WIDTH * 0.05, WIDTH * 0.04,
            'timer text', 'white')
        this.isTick = false
    }
    calcTime() {
        // units * 10  + gold (seconds) + 20
        let player = players[whooseTurn]
        const unitsRatio = 8
        let result = player.armySalary * unitsRatio
        if (player.townsCount)
            result += player.gold + player.townsCount * 20
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
        this.time = this.calcTime()
        this.pause()
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
            enable: true
        }
        return res
    }
    draw(ctx) {
        if (!this.isTick) {
            return
        }
        this.check()
        let millisecondsLeft = this.timeLeft
        let secondsLeft = Math.floor(millisecondsLeft / 1000)
        this.text.text = String(secondsLeft)

        this.text.draw(ctx)
    }
}