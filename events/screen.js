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
        this.setSpeedX(0)
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
    correctSpeed() {
        let out = this.outOfBounds(canvas.offset.x - this.speedX, canvas.offset.y - this.speedY)
            // canvas.offset - speed = border <=> speed = canvas.offset - border
        if (out.x == 1)
            this.speedX = -(this.getScreenRight() - canvas.offset.x)
        if (out.x == -1)
            this.speedX = -(this.getScreenLeft() - canvas.offset.x)


        if (out.y == 1)
            this.speedY = -(this.getScreenBottom() - canvas.offset.y)
        if (out.y == -1)
            this.speedY = -(this.getScreenTop() - canvas.offset.y)
    }
    move() {
        this.correctSpeed()

        canvas.offset.x -= this.speedX
        canvas.offset.y -= this.speedY

        mainCtx.translate(this.speedX, this.speedY)
    }
    scale(pos, scale) {
        const ratio = 0.001

        let zoom = Math.exp(scale * ratio);

        if (canvas.scale * zoom > mapBorder.scale.max)
            zoom = mapBorder.scale.max / canvas.scale
        if (canvas.scale * zoom < mapBorder.scale.min)
            zoom = mapBorder.scale.min / canvas.scale

        mainCtx.translate(canvas.offset.x, canvas.offset.y)

        canvas.offset.x -= pos.x / (canvas.scale * zoom) - pos.x / canvas.scale;
        canvas.offset.y -= pos.y / (canvas.scale * zoom) - pos.y / canvas.scale;

        mainCtx.scale(zoom, zoom);
        mainCtx.translate(-canvas.offset.x, -canvas.offset.y);

        canvas.scale *= zoom;
        width = WIDTH / canvas.scale;
        height = HEIGHT / canvas.scale;
    }
    setMoveMain() {}
    draw() {}
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
        const scaleRatio = 1.0
        let scale = pointPythagorean(points[0], points[1]) - oldDist 
        super.scale(oldPos, scale)
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
class ComputerScreenGroup {
    constructor(mainScreen) {
        this.main = mainScreen
    }
    stopX() {
        this.main.setSpeedX(0)
    }
    stopY() {
        this.main.setSpeedY(0)
    }
    goLeft() {
        this.main.goLeft()
    }
    goRight() {
        this.main.goRight()
    }
    goUp() {
        this.main.goUp()
    }
    goDown() {
        this.main.goDown()
    }
    stop() {
        this.main.stop()
    }
    changeSpeed(pos) {
        this.main.changeSpeed(pos)
    }
    scale(pos, scale) {
        this.main.scale(pos, scale)
    }
    move() {
        this.main.move()
    }
    draw(ctx) {
        this.main.draw(ctx)
    }
}