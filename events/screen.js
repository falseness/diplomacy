// The camera's translate and scale calls on the main canvas, logged so another canvas can be given
// the very transform the main canvas draws with (Grid's rest snapshot, apply). The canvas concatenates
// each call in single precision, so one setTransform of getTransform()'s values rounds a hair apart
// from the calls' product, and the light map's color-dodge shows that as a few levels at odd pixels.
// The log starts from getTransform() at its first call after any other change of the transform (a
// setTransform elsewhere, which that reproduces exactly); past MAX_OPS calls it starts again so.
const cameraTransform = {
    MAX_OPS: 30000,
    log: null,
    translate(x, y) {
        this.call('translate', x, y)
    },
    scale(x, y) {
        this.call('scale', x, y)
    },
    call(name, x, y) {
        if (typeof mainCtx.getTransform !== 'function') {
            mainCtx[name](x, y)
            return
        }
        const t = mainCtx.getTransform()
        if (!this.log || !this.same(t, this.log.after) || this.log.ops.length >= this.MAX_OPS)
            this.log = {base: [t.a, t.b, t.c, t.d, t.e, t.f], ops: []}
        mainCtx[name](x, y)
        this.log.ops.push([name, x, y])
        this.log.after = mainCtx.getTransform()
    },
    same(a, b) {
        return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.e === b.e && a.f === b.f
    },
    // The calls that make the main canvas's transform t (taken now): the log, or t itself when
    // the transform has been set since.
    capture(t) {
        const log = this.log
        if (log && this.same(t, log.after))
            return {base: log.base, ops: log.ops.slice(), t}
        return {base: [t.a, t.b, t.c, t.d, t.e, t.f], ops: [], t}
    },
    // Gives g the captured transform: its calls replayed, or setTransform should they not reach it.
    apply(g, camera) {
        g.setTransform(...camera.base)
        for (const [name, x, y] of camera.ops) g[name](x, y)
        if (!this.same(g.getTransform(), camera.t))
            g.setTransform(camera.t)
    },
}

class Screen {
    constructor() {
        this.speedX = 0
        this.speedY = 0
        // movement accumulated at the current speed up to integratedUntil (event/frame clock, ms)
        this.pendingOffset = { x: 0, y: 0 }
        this.integratedUntil = undefined
        this.glide = null
    }
    // A zoom gesture, for the surface cache and the light map: 160 ms after a zoom input, and in
    // any case the first two board frames drawn after it (Grid.draw counts them), so frames slower
    // than the window on a loaded device do not drop a continuing gesture onto the direct path.
    get surfaceZooming() {
        return performance.now() < this.surfaceZoomUntil || this.surfaceZoomFrames > 0
    }
    // TASK-1374: a zoom gesture with either visuals, for the zoom raster (Grid.drawZoomRaster): 160 ms after a zoom input and
    // in any case the ZOOM_GESTURE_FRAMES frames drawn after it, so that on a device drawing a frame in 100-200 ms a gesture's
    // inputs a few frames apart do not each end it (each ending rebuilds the board at its scale).
    static ZOOM_GESTURE_FRAMES = 4
    get zoomGesture() {
        return performance.now() < this.zoomGestureUntil || this.zoomGestureFrames > 0
    }
    // A zoom gesture, or a camera pan in the same window (160 ms after a move of the view, and the
    // first two board frames drawn after it), and the SURFACE_LAYER_HOLD ms after either, when a
    // gesture often goes on: the overlays may come from their layer (Grid.drawOverlayLayer).
    // Settled frames draw them directly.
    get surfaceMoving() {
        return this.surfaceZooming || performance.now() < this.surfacePanUntil || this.surfacePanFrames > 0 ||
            performance.now() < this.surfaceLayerUntil
    }
    static SURFACE_LAYER_HOLD = 600
    static kFrameDuration = 1000 / 60
    static kMaxFrameDuration = 100
    // keyboard, edge-scroll and drag panning move the camera this many times slower; zoom is unaffected
    static kCameraPanSlowdown = 1.5
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
    // Pan limits on each axis (TASK-1298): the camera may go mapBorderMargin (m = mapBorderMargin / canvas.scale) past
    // the slab (mapBorder.slab: the board's top face and sides) again, so the cells under a right-side panel (the town
    // panel covers the screen's right 26%) can always be brought out (user report 2026-10-24: zoomed out, the town panel
    // hid cells the camera could not move right to; TASK-1219 centred a slab smaller than the screen, TASK-1292 kept it
    // whole on screen and gave a slightly larger one only its overflow, so at the slab-width scale the camera could not
    // move right at all). The offset may be anywhere the sky beside the slab is at most the margin on either side,
    // [slab.left - m, slab.right - w + m] (the pre-TASK-1219 limits), or the whole slab is on screen,
    // [slab.right - w, slab.left]: the union of both. Panned fully right, the slab's right edge is at w - m on screen,
    // or, for a slab narrower than w - m, the whole slab is on screen from the left edge: either way left of the panel,
    // and the board is never pushed off the screen. The ends are continuous in the scale (at slab size w the interval is
    // [slab.left - m, slab.left + m], at w - m both parts meet), so zooming never jumps the camera (TASK-1292).
    // Without a slab, mapBorder's margin limits (getScreenLeft/Right/Top/Bottom).
    static panRange(low, high, size, margin) {
        return {low: Math.min(low - margin, high - size), high: Math.max(high - size + margin, low)}
    }
    correctCanvas() {
        const slab = mapBorder.slab, m = mapBorderMargin / canvas.scale
        const x = slab ? Screen.panRange(slab.left, slab.right, width, m) : {low: this.getScreenLeft(), high: this.getScreenRight()}
        const y = slab ? Screen.panRange(slab.top, slab.bottom, height, m) : {low: this.getScreenTop(), high: this.getScreenBottom()}
        canvas.offset.x = Math.max(Math.min(canvas.offset.x, x.high), x.low)
        canvas.offset.y = Math.max(Math.min(canvas.offset.y, y.high), y.low)
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
        
        this.stepGlide()
        this.correctCanvas()

        if ((canvas.offset.x !== old_value_x || canvas.offset.y !== old_value_y) && otherSettings.atmosphericVisuals) {
            this.surfacePanUntil = performance.now() + 160
            this.surfacePanFrames = 2
            this.surfaceLayerUntil = performance.now() + Screen.SURFACE_LAYER_HOLD
        }
        cameraTransform.translate(old_value_x - canvas.offset.x, old_value_y - canvas.offset.y)
    }
    scale(pos, scale) {
        const ratio = 0.001

        this.zoomBy(pos, Math.exp(scale * ratio))
    }
    // multiplies canvas.scale by zoom within the map limits, keeping the world point under pos
    zoomBy(pos, zoom) {
        const requested = zoom
        if (canvas.scale * zoom > mapBorder.scale.max)
            zoom = mapBorder.scale.max / canvas.scale
        if (canvas.scale * zoom < mapBorder.scale.min)
            zoom = mapBorder.scale.min / canvas.scale
        // a NaN zoom or a non-finite anchor would turn canvas.scale and canvas.offset into NaN for good
        if (!Number.isFinite(zoom) || zoom <= 0 || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y))
            return

        // Reuse the existing board raster while scaling. This is only a render
        // hint: input anchors, sensitivity and limits remain unchanged. A gesture held
        // against a zoom limit is still a gesture: it keeps the raster too, rather than
        // drawing the whole board directly between its steps.
        if (requested !== 1 && otherSettings.atmosphericVisuals) {
            this.surfaceZoomUntil = performance.now() + 160
            this.surfaceZoomFrames = 2
            this.surfaceLayerUntil = performance.now() + Screen.SURFACE_LAYER_HOLD
        }
        // TASK-1374: with either visuals, the gesture's frames draw the board's last frame scaled (Grid.drawZoomRaster),
        // taken now, before the camera changes.
        if (requested !== 1 && typeof grid !== 'undefined' && grid) {
            this.zoomGestureUntil = performance.now() + 160
            this.zoomGestureFrames = Screen.ZOOM_GESTURE_FRAMES
            grid.captureZoomRaster()
        }

        cameraTransform.translate(canvas.offset.x, canvas.offset.y)

        canvas.offset.x -= pos.x / (canvas.scale * zoom) - pos.x / canvas.scale
        canvas.offset.y -= pos.y / (canvas.scale * zoom) - pos.y / canvas.scale

        cameraTransform.scale(zoom, zoom)
        cameraTransform.translate(-canvas.offset.x, -canvas.offset.y)

        canvas.scale *= zoom
        width = WIDTH / canvas.scale
        height = HEIGHT / canvas.scale
    }
    setMoveMain() {}
    draw() {}
    // The whole board top face is on screen.
    showsWholeBoard() {
        const b = mapDepth.surfaceBounds
        return !!b && b.left >= canvas.offset.x && b.right <= canvas.offset.x + width &&
            b.top >= canvas.offset.y && b.bottom <= canvas.offset.y + height
    }
    // The camera is still the fitted one GameManager.fitCamera opened the board with (not zoomed or moved since).
    isFittedView() {
        const fit = typeof GameManager != 'undefined' && GameManager.cameraFit
        return !!fit && fit.fitted && canvas.scale === fit.scale &&
            canvas.offset.x === fit.offset.x && canvas.offset.y === fit.offset.y
    }
    moveToPlayer(player) {
        // An untouched fitted board stays where it is: the player's towns are in view.
        if (this.isFittedView() && this.showsWholeBoard())
            return
        let pos
        if (player.towns.length) {
            pos = player.towns[0].pos
        }
        else {
            pos = grid.center
        }

        this.moveTo(pos)
    }
    // TASK-1428: a camera glide (the attack replay, render/attackFx.js): the screen's centre goes to posOnGrid in duration ms,
    // eased, the scale unchanged, a frame's share in each move() (the pan path: no board rebuild). It adds to the player's
    // own panning, which it never blocks (each frame moves the camera by the glide's progress since the last frame); a zoom
    // keeps it going, by the world point at the centre. clock: the glide's ms clock (the replay's).
    static GLIDE_DURATION = 300
    centre() {
        return {x: canvas.offset.x + width / 2, y: canvas.offset.y + height / 2}
    }
    glideTo(posOnGrid, duration = Screen.GLIDE_DURATION, clock = () => performance.now()) {
        this.glide = {from: this.centre(), to: {x: posOnGrid.x, y: posOnGrid.y}, start: clock(), duration, clock, done: 0}
    }
    stopGlide() {
        this.glide = null
    }
    stepGlide() {
        const g = this.glide
        if (!g)
            return
        const t = Math.max(0, Math.min(1, (g.clock() - g.start) / g.duration))
        const q = 0.5 - 0.5 * Math.cos(Math.PI * t), d = q - g.done
        g.done = q
        if (t >= 1)
            this.glide = null
        canvas.offset.x += (g.to.x - g.from.x) * d
        canvas.offset.y += (g.to.y - g.from.y) * d
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
        this.speedRatio = 1 / Screen.kCameraPanSlowdown
    }
    // touchmoves between two frames add up; move() applies the total once and clears it
    setSpeedX(speedX) {
        this.speedX += speedX * this.speedRatio / canvas.scale
    }
    setSpeedY(speedY) {
        this.speedY += speedY * this.speedRatio / canvas.scale
    }
    stopX() {
        this.speedX = 0
    }
    stopY() {
        this.speedY = 0
    }
    move() {
        super.move()
        this.stop()
    }
    scale(points, oldDist, oldPos) {
        const scaleRatio = 0.75
        if (!Array.isArray(points) || points.length != 2)
            return
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
        this.speed = speed / Screen.kCameraPanSlowdown
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
