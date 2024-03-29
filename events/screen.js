class Screen {
    constructor() {
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
        this.stopX()
        this.stopY()
    }
    stopX() {
        this.setSpeedX(0)
    }
    stopY() {
        this.setSpeedY(0)
    }
    getScreenRight() {
        let res = mapBorder.right - width + mapBorderMargin / canvas.scale
        return res
    }
    getScreenLeft() {
        let res = mapBorder.left - mapBorderMargin / canvas.scale
        return res
    }
    getScreenBottom() {
        let res = mapBorder.bottom - height + mapBorderMargin / canvas.scale
        return res
    }
    getScreenTop() {
        let res = mapBorder.top - mapBorderMargin / canvas.scale
        return res
    }
    outOfBounds(x, y) {
        let out = { x: 0, y: 0 }

        if (x > this.getScreenRight()) {
            out.x = 1
        }
        if (x < this.getScreenLeft()) {
            out.x = -1
        }

        if (y > this.getScreenBottom()) {
            out.y = 1
        }
        if (y < this.getScreenTop()) {
            out.y = -1
        }
        return out
    }
    correctCanvas() {
        canvas.offset.x = Math.min(canvas.offset.x, this.getScreenRight())
        canvas.offset.x = Math.max(canvas.offset.x, this.getScreenLeft())
        canvas.offset.y = Math.min(canvas.offset.y, this.getScreenBottom())
        canvas.offset.y = Math.max(canvas.offset.y, this.getScreenTop())
    }
    move() {
        let old_value_x = canvas.offset.x
        let old_value_y = canvas.offset.y
        
        canvas.offset.x -= this.speedX
        canvas.offset.y -= this.speedY
        
        this.correctCanvas()

        mainCtx.translate(old_value_x - canvas.offset.x, old_value_y - canvas.offset.y)
    }
    scale(pos, scale) {
        const ratio = 0.001

        let zoom = Math.exp(scale * ratio)

        if (canvas.scale * zoom > mapBorder.scale.max)
            zoom = mapBorder.scale.max / canvas.scale
        if (canvas.scale * zoom < mapBorder.scale.min)
            zoom = mapBorder.scale.min / canvas.scale

        mainCtx.translate(canvas.offset.x, canvas.offset.y)

        canvas.offset.x -= pos.x / (canvas.scale * zoom) - pos.x / canvas.scale
        canvas.offset.y -= pos.y / (canvas.scale * zoom) - pos.y / canvas.scale

        mainCtx.scale(zoom, zoom)
        mainCtx.translate(-canvas.offset.x, -canvas.offset.y)

        canvas.scale *= zoom
        width = WIDTH / canvas.scale
        height = HEIGHT / canvas.scale
    }
    setMoveMain() {}
    draw() {}
    moveToPlayer(player) {
        let pos
        if (player.towns.length) {
            pos = player.towns[0].pos
        }
        else {
            pos = grid.center
        }

        this.moveTo(pos)
    }
    moveTo(posOnGrid) {
        let result = {
            x: canvas.offset.x - posOnGrid.x + width / 2,
            y: canvas.offset.y - posOnGrid.y + height / 2
        }
        this.speedX = result.x
        this.speedY = result.y
        //здесь нельзя использовать this.setSpeedX, т.к. он должен учитывать масштабирование экрана
        this.move()
        this.stop()
    }
}
class MobileScreen extends Screen {
    constructor() {
        super()
        this.ACCELERATION = 0.001 * HEIGHT
        this.speedRatio = 1
    }
    setSpeedX(speedX) {
        this.speedX = speedX * this.speedRatio / canvas.scale
    }
    setSpeedY(speedY) {
        this.speedY = speedY * this.speedRatio / canvas.scale
    }
    move() {
        super.move()
        this.stop()
    }
    scale(points, oldDist, oldPos) {
        const scaleRatio = 0.75
        let scale = pointPythagorean(points[0], points[1]) - oldDist 
        super.scale(oldPos, scale * scaleRatio)
    }
}
class ComputerScreen extends Screen {
    constructor(margin = 0.15 * height, speed = 0.01 * height) {
        super()
        this.topBorder = margin
        this.leftBorder = margin
        this.rightBorder = width - margin
        this.bottomBorder = height - margin
        this.speed = speed
    }
    goLeft() {
        this.setSpeedX(this.speed)
    }
    goRight() {
        this.setSpeedX(-this.speed)
    }
    goUp() {
        this.setSpeedY(this.speed)
    }
    goDown() {
        this.setSpeedY(-this.speed)
    }
    changeSpeed(pos) {
        this.stop()
        if (pos.x > this.rightBorder)
            this.goRight()
        if (pos.x < this.leftBorder)
            this.goLeft()

        if (pos.y > this.bottomBorder)
            this.goDown()
        if (pos.y < this.topBorder)
            this.goUp()
    }
    draw(ctx) {
        if (!debug)
            return

        const lineWidth = 2
        const color = 'green'
        ctx.beginPath()

        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color

        ctx.moveTo(this.leftBorder, this.topBorder)
        ctx.lineTo(this.rightBorder, this.topBorder)
        ctx.lineTo(this.rightBorder, this.bottomBorder)
        ctx.lineTo(this.leftBorder, this.bottomBorder)
        ctx.lineTo(this.leftBorder, this.topBorder)

        ctx.stroke()

        ctx.closePath()
    }
}
