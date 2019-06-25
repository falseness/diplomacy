class Screen {
    constructor(margin = 0.15 * height, speed = 0.01 * height) {
        this.topBorder = margin
        this.leftBorder = margin
        this.rightBorder = width - margin
        this.bottomBorder = height - margin
        this.speed = speed

        this.speedX = 0
        this.speedY = 0
    }
    setSpeedX(speed) {
        this.speedX = speed
    }
    setSpeedY(speed) {
        this.speedY = speed
    }
    stop() {
        this.setSpeedX(0)
        this.setSpeedY(0)
    }
    changeSpeed(pos) {
        this.stop()
        if (pos.x > this.rightBorder)
            this.setSpeedX(-this.speed)
        if (pos.x < this.leftBorder)
            this.setSpeedX(this.speed)

        if (pos.y > this.bottomBorder)
            this.setSpeedY(-this.speed)
        if (pos.y < this.topBorder)
            this.setSpeedY(this.speed)
    }
    draw() {
        if (!debug)
            return

        const lineWidth = 2
        const color = 'green'
        ctx.beginPath()

        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color

        ctx.moveTo(this.leftBorder - canvasOffset.x, this.topBorder - canvasOffset.y)
        ctx.lineTo(this.rightBorder - canvasOffset.x, this.topBorder - canvasOffset.y)
        ctx.lineTo(this.rightBorder - canvasOffset.x, this.bottomBorder - canvasOffset.y)
        ctx.lineTo(this.leftBorder - canvasOffset.x, this.bottomBorder - canvasOffset.y)
        ctx.lineTo(this.leftBorder - canvasOffset.x, this.topBorder - canvasOffset.y)

        ctx.stroke()

        ctx.closePath()
    }
    move() {
        canvasOffset.x += this.speedX
        canvasOffset.y += this.speedY

        ctx.translate(this.speedX, this.speedY)

        entityInterface.updatePos()
        townInterface.updatePos()
        nextTurnButton.updatePos()
    }
}