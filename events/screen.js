class Screen {
    constructor() {
        this.speedX = 0
        this.speedY = 0
        // movement accumulated at the current speed up to integratedUntil (event/frame clock, ms)
        this.pendingOffset = { x: 0, y: 0 }
        this.integratedUntil = undefined
    }
    static kFrameDuration = 1000 / 60
    static kMaxFrameDuration = 100
    // call before a speed change so a press released between frames still moves the camera
    advanceTo(time) {
        if (time === undefined)
            return
        if (this.integratedUntil !== undefined) {
            const elapsed = Math.min(Math.max(time - this.integratedUntil, 0), Screen.kMaxFrameDuration)
            const distanceRatio = elapsed / Screen.kFrameDuration
            this.pendingOffset.x += this.speedX * distanceRatio
            this.pendingOffset.y += this.speedY * distanceRatio
        }
        this.integratedUntil = Math.max(this.integratedUntil ?? time, time)
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
    move(frameDuration = 1000 / 60, frameTime = undefined) {
        let old_value_x = canvas.offset.x
        let old_value_y = canvas.offset.y
        
        if (frameTime === undefined) {
            const distanceRatio = frameDuration / (1000 / 60)
            canvas.offset.x -= this.speedX * distanceRatio
            canvas.offset.y -= this.speedY * distanceRatio
        }
        else {
            this.advanceTo(frameTime)
            canvas.offset.x -= this.pendingOffset.x
            canvas.offset.y -= this.pendingOffset.y
            this.pendingOffset = { x: 0, y: 0 }
        }
        
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
    // direction: -1 left/up, 1 right/down, 0 stop
    setDirectionX(direction) {
        this.setSpeedX(-direction * this.speed)
    }
    setDirectionY(direction) {
        this.setSpeedY(-direction * this.speed)
    }
    getEdgeDirection(pos) {
        let direction = { x: 0, y: 0 }
        if (pos.x > this.rightBorder)
            direction.x = 1
        if (pos.x < this.leftBorder)
            direction.x = -1

        if (pos.y > this.bottomBorder)
            direction.y = 1
        if (pos.y < this.topBorder)
            direction.y = -1
        return direction
    }
    changeSpeed(pos) {
        let direction = this.getEdgeDirection(pos)
        this.setDirectionX(direction.x)
        this.setDirectionY(direction.y)
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
