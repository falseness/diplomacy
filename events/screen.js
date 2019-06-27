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
            //
            //mainCtx.translate(this.speedX, this.speedY)

        // mainCtx.setTransform(1, 0, 0, 1, 0, 0)
        //mainCtx.scale(canvas.scale, canvas.scale)
        //mainCtx.translate(canvas.offset.x, canvas.offset.y)
        /*if (this.outOfBounds()) {
            
            mainCtx.scale(canvas.scale, canvas.scale)
        }*/
        //entityInterface.updatePos()
        //townInterface.updatePos()
    }
}