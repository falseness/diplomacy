// Heal animations (TASK-1445, concept B 'heal vs repair'), UI only: the rules heal at a turn's start as before
// (Entity.hpIncrease, applied in Player.nextTurn); only the drawing animates, as attackFx does for attacks. Input is
// never blocked: nothing waits for an effect.
// A healed unit stands in a rising green light column with a bright ground ellipse and rising motes, lifts by at most
// 0.05 r (5 px at the concept's r = 100) with a short green tint (one tinted copy per sprite, made once), its new hp
// pips fill in with a flash and a green '+N' floats up. Buildings are not animated yet (their hp is final at once).
// Offline the turn player's heals are read around its nextTurn (before / after, offlineNextTurn); their clock starts on
// the first frame drawn without the pass-device screen (prune), so nothing plays behind it. While an effect plays its
// unit is left out of the grid's unit passes (Grid.getStillUnit reads hidden) and drawn here, over the board's frame
// (drawMain): a held still or level-of-detail frame stays held, a zoom gesture keeps its raster, the board cache is not
// rebuilt for an effect. A finished effect keeps its unit (drawn in place, as the board draws it) until the board
// changes anyway (the unit moves, dies or its bars change, a camera pan, an undo, the turn's end), as attackFx does.
// Plain canvas code: rects, arcs, ellipses, one gradient made once; no shadowBlur, filters or new assets. Off when
// otherSettings.animateHeals is false (no effect is queued; running ones end at once).
// API: play(event), draw(ctx, now), isActive(), clear(), now(); the hooks call before(slot) / after(snapshot) and prune().
// Removing this file and its guarded calls leaves the game as it was.
class HealFx {
    // Most effects playing at once: a new one drops the oldest.
    maxEffects = 24
    // ms of the unit effect (the concept's unit part: 0.7 of its 1 s loop).
    durations = {unit: 700}
    effects = []
    // The units the effects draw (hideUnits; Grid.getStillUnit looks them up directly).
    hidden = new Set()
    // image -> green tinted copy (a canvas of the sprite's size), made on first use.
    tints = new Map()
    // The column's gradient (top clear -> bottom green, in a unit square), made once per context.
    gradient = null
    gradientCtx = null
    // Mote x offsets in r (the concept's 6 motes), made once.
    motes = Float32Array.from({length: 6}, (_, j) => -0.35 + 0.7 * ((j * 37) % 10) / 10)
    // Counters for tests and evidence: effects queued, dropped by the cap, heals not animated (buildings).
    stats = {queued: 0, dropped: 0, skipped: 0}
    // A prune ran since the last draw (draw).
    pruned = false
    // The camera at the last prune (offset and scale), to tell a pan.
    camera = {x: NaN, y: NaN, scale: NaN}
    // Clock in ms; tests may replace it.
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    }
    enabled() {
        return typeof otherSettings === 'undefined' || otherSettings.animateHeals !== false
    }
    // The hp of slot's units and buildings before its turn start heals them (offlineNextTurn); null when off or slot is
    // not a local human (others' heals are not shown yet).
    before(slot) {
        if (!this.enabled() || typeof players === 'undefined' || players[slot]?.constructor !== Player || typeof grid === 'undefined')
            return null
        const entities = [], hp = []
        for (const unit of players[slot].units)
            if (!unit.killed && unit.hp < unit.maxHP) {
                entities.push(unit)
                hp.push(unit.hp)
            }
        for (const column of grid.arr)
            for (const cell of column) {
                const b = cell.building
                if (b.notEmpty() && !b.isNature && b.hp !== undefined && b.playerColor === slot && b.hp < b.maxHP) {
                    entities.push(b)
                    hp.push(b.hp)
                }
            }
        return {entities, hp}
    }
    // After the turn start: a heal event for each entity whose hp rose.
    after(snapshot) {
        if (!snapshot)
            return 0
        let n = 0
        for (let i = 0; i < snapshot.entities.length; ++i) {
            const entity = snapshot.entities[i], amount = entity.hp - snapshot.hp[i]
            if (!(amount > 0) || entity.killed)
                continue
            const unit = entity.isUnit
            const coord = unit ? entity.coord : entity.hexagon?.coord ?? entity.coord
            if (this.play({entity, coord: {x: coord.x, y: coord.y}, kind: unit ? 'unit' : 'building', amount, from: snapshot.hp[i],
                    sprite: this.imageOf(entity)}))
                ++n
        }
        return n
    }
    // event: {entity, coord, kind 'unit' | 'building', amount, from (hp before), sprite}. Its clock starts on the first frame
    // drawn without the pass-device screen (prune). Returns the effect, or null.
    play(event) {
        if (!this.enabled() || !event || !event.entity || !(event.amount > 0))
            return null
        if (event.kind !== 'unit') {
            ++this.stats.skipped
            return null
        }
        const unit = event.entity
        const effect = event
        effect.from ??= unit.hp - event.amount
        effect.sprite ??= this.imageOf(unit)
        effect.duration = this.durations.unit
        effect.startTime = null
        effect.hp = unit.hp
        effect.moves = unit.moves
        // The bar before the heal (the pips the effect fills in): its own HealthBar at the unit's bar position.
        effect.oldBar = null
        if (unit.hpBar && typeof HealthBar !== 'undefined') {
            effect.oldBar = new HealthBar(unit.hpBar.pos, unit.maxHP)
            effect.oldBar.repaintRects(effect.from)
        }
        this.effects = this.effects.filter(e => e.entity !== unit)
        this.effects.push(effect)
        ++this.stats.queued
        while (this.effects.length > this.maxEffects) {
            this.effects.shift()
            ++this.stats.dropped
        }
        this.hideUnits()
        return effect
    }
    clear() {
        this.effects.length = 0
        this.hidden.clear()
    }
    // The pass-device screen covers the board: the effects wait.
    held() {
        return typeof nextTurnPauseInterface !== 'undefined' && !!nextTurnPauseInterface?.visible
    }
    finished(e, now = this.now()) {
        return e.startTime !== null && now - e.startTime >= e.duration
    }
    // Starts waiting effects (no pass-device screen) and drops those whose unit is no longer as the heal left it (moved,
    // killed, hit, its moves spent) and finished ones once the camera pans (their units go back to the board's passes in a
    // frame drawn live anyway).
    prune(now = this.now()) {
        this.pruned = true
        if (!this.enabled() && this.effects.length)
            this.clear()
        const moved = this.cameraMoved()
        if (!this.effects.length)
            return
        const held = this.held()
        const panning = this.panning(moved)
        const before = this.effects.length
        this.effects = this.effects.filter(e => {
            if (e.startTime === null && !held)
                e.startTime = now
            const u = e.entity
            return !u.killed && u.coord.x === e.coord.x && u.coord.y === e.coord.y && grid.getUnit(e.coord) === u &&
                u.hp === e.hp && u.moves === e.moves && !(panning && this.finished(e, now))
        })
        if (this.effects.length !== before)
            this.hideUnits()
    }
    // Whether the camera moved since the last prune at the same scale (and follows it).
    cameraMoved() {
        if (typeof canvas === 'undefined' || !canvas?.offset)
            return false
        const c = this.camera, o = canvas.offset
        const moved = (c.x !== o.x || c.y !== o.y) && c.scale === canvas.scale
        c.x = o.x
        c.y = o.y
        c.scale = canvas.scale
        return moved
    }
    // Whether the camera pans: moved or Screen.surfaceMoving, out of a zoom gesture.
    panning(moved) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent?.screen : undefined
        return (moved || !!screen?.surfaceMoving) && !screen?.zoomGesture
    }
    hideUnits() {
        this.hidden.clear()
        for (const e of this.effects)
            this.hidden.add(e.entity)
    }
    // An effect plays (a waiting one or one held at its end does not).
    isActive() {
        this.prune()
        const now = this.now()
        return this.effects.some(e => e.startTime !== null && now - e.startTime < e.duration)
    }
    imageOf(entity) {
        return typeof cachedImages !== 'undefined' && typeof grid !== 'undefined' ? cachedImages[grid.getEntityBodyImageName(entity)] : undefined
    }
    ease(t) {
        return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
    }
    // drawMain prunes before the board is drawn (its units left out by that prune's hidden set); the draw after it in the
    // same frame does not prune again.
    draw(ctx, now = this.now()) {
        if (!this.pruned)
            this.prune(now)
        this.pruned = false
        if (!this.effects.length)
            return
        const t = ctx.getTransform(), margin = 3 * basis.r, half = assets.size / 2
        const lod = typeof grid !== 'undefined' && (grid.lod || !!grid.lodTransform?.(ctx))
        for (const e of this.effects) {
            const u = e.entity
            const cx = u.pos.x + half, cy = u.pos.y + half
            const x = t.a * cx + t.c * cy + t.e, y = t.b * cx + t.d * cy + t.f
            const reach = Math.abs(t.a) * margin
            if (x < -reach || y < -reach || x > ctx.canvas.width + reach || y > ctx.canvas.height + reach)
                continue
            ctx.save()
            // (an effect waiting behind the pass-device screen: its first pose, the bar before the heal)
            const s = e.startTime === null ? 0 : Math.min(1, (now - e.startTime) / e.duration)
            if (this.finished(e, now))
                this.drawUnit(ctx, e, 0, 1, 0, lod)
            else
                this.drawUnitHeal(ctx, e, s, lod)
            ctx.restore()
        }
    }
    // The unit heal (H-B), s in [0, 1]. Sizes in r (basis.r): the concept's scene had r = 100 px.
    drawUnitHeal(ctx, e, s, lod) {
        const r = basis.r, u = e.entity, half = assets.size / 2
        // the ground point: 0.4 r below the sprite's centre
        const gx = u.pos.x + half, gy = u.pos.y + half + 0.4 * r
        const a = s > 0 && s < 1 ? Math.sin(Math.PI * s) : 0
        if (a > 0) {
            // light column (rising to its top over the first half), soft edge, ground ellipse, rising motes
            const top = gy - 0.4 * r - 1.8 * r * this.ease(Math.min(1, s * 2))
            const g = this.columnGradient(ctx)
            ctx.fillStyle = g
            for (const [w, k] of [[0.6, 0.35], [0.45, 1]]) {
                ctx.save()
                ctx.globalAlpha = a * k
                ctx.translate(gx - w * r, top)
                ctx.scale(2 * w * r, gy - top)
                ctx.fillRect(0, 0, 1, 1)
                ctx.restore()
            }
            ctx.fillStyle = 'rgb(150, 255, 170)'
            for (const [rx, ry, k] of [[0.72, 0.24, 0.3], [0.6, 0.18, 0.67]]) {
                ctx.globalAlpha = a * k
                ctx.beginPath()
                ctx.ellipse(gx, gy, rx * r, ry * r, 0, 0, 2 * Math.PI)
                ctx.fill()
            }
            if (!lod) {
                ctx.fillStyle = 'rgb(230, 255, 230)'
                for (let j = 0; j < this.motes.length; ++j) {
                    const q = (s * 2 + j / 6) % 1
                    ctx.globalAlpha = 0.86 * a * (1 - q)
                    ctx.beginPath()
                    ctx.arc(gx + this.motes[j] * r, gy - 1.6 * r * q, 0.03 * r, 0, 2 * Math.PI)
                    ctx.fill()
                }
            }
            ctx.globalAlpha = 1
        }
        this.drawUnit(ctx, e, -0.05 * r * a, (s - 0.35) / 0.3, 0.3 * a, lod)
        if (!lod)
            this.drawGain(ctx, gx, gy - 1.5 * r, (s - 0.35) / 0.65, e.amount, r)
    }
    // The unit lifted by dy, its hp bar filled to k (0: before the heal, 1: after; the new pips flash around k = 0.6) and
    // its sprite tinted green at tint.
    drawUnit(ctx, e, dy, k, tint, lod) {
        const u = e.entity, image = this.imageOf(u) || e.sprite
        ctx.save()
        ctx.translate(0, dy)
        if (!lod)
            this.drawBars(ctx, e, k)
        if (image) {
            ctx.drawImage(image, u.pos.x, u.pos.y)
            if (tint > 0) {
                ctx.globalAlpha = tint
                ctx.drawImage(this.tinted(image), u.pos.x, u.pos.y)
                ctx.globalAlpha = 1
            }
        }
        ctx.restore()
    }
    // The unit's bars as Unit.drawBars draws them, its hp bar crossfading from the bar before the heal to the bar now.
    drawBars(ctx, e, k) {
        const u = e.entity
        k = Math.max(0, Math.min(k, 1.4))
        const old = e.oldBar
        if (!old || k >= 1.4)
            u.drawBars(ctx)
        else {
            if (otherSettings.alwaysDisplayHPBar || e.from < u.maxHP) {
                if (k < 1)
                    old.draw(ctx)
                if (k > 0) {
                    ctx.globalAlpha = Math.min(1, k)
                    u.hpBar.draw(ctx)
                    ctx.globalAlpha = 1
                }
                // the new pips' flash: a light outline peaking at k = 0.6
                const f = 0.9 * Math.max(0, 1 - Math.abs(k - 0.6) / 0.6)
                if (f > 0) {
                    const rects = u.hpBar.rects, w = 0.03 * basis.r
                    ctx.globalAlpha = f
                    ctx.strokeStyle = 'rgb(220, 255, 220)'
                    ctx.lineWidth = w
                    for (let i = 0; i < rects.length; ++i) {
                        const n = rects[i], o = old.rects[i]
                        if (o && o.healthy === n.healthy && o.width === n.width)
                            continue
                        ctx.strokeRect(n.x - 2 * w, n.y - 2 * w, n.width + 4 * w, n.height + 4 * w)
                    }
                    ctx.globalAlpha = 1
                }
            }
            if (typeof shouldShowMovesBar === 'function' && shouldShowMovesBar(u))
                u.movesBar.draw(ctx)
        }
    }
    // '+N' rising from y, q in (0, 1].
    drawGain(ctx, x, y, q, amount, r) {
        if (!(q > 0 && q <= 1))
            return
        ctx.globalAlpha = q < 0.6 ? 1 : (1 - q) / 0.4
        ctx.font = `bold ${Math.round(0.38 * r)}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 0.08 * r
        ctx.strokeStyle = 'rgb(0, 50, 10)'
        ctx.fillStyle = 'rgb(90, 255, 110)'
        const text = '+' + amount, ty = y - (0.3 + 0.45 * q) * r
        ctx.strokeText(text, x, ty)
        ctx.fillText(text, x, ty)
        ctx.globalAlpha = 1
    }
    // The column's gradient in a unit square (y 0 -> 1: clear -> green), made once for ctx.
    columnGradient(ctx) {
        if (!this.gradient || this.gradientCtx !== ctx) {
            const g = ctx.createLinearGradient(0, 0, 0, 1)
            g.addColorStop(0, 'rgba(110, 255, 150, 0)')
            g.addColorStop(1, 'rgba(110, 255, 150, 0.43)')
            this.gradient = g
            this.gradientCtx = ctx
        }
        return this.gradient
    }
    // image's green copy (its shape filled green), made on first use.
    tinted(image) {
        let c = this.tints.get(image)
        if (!c) {
            if (this.tints.size > 64)
                this.tints.clear()
            c = document.createElement('canvas')
            c.width = image.width
            c.height = image.height
            const g = c.getContext('2d')
            g.drawImage(image, 0, 0)
            g.globalCompositeOperation = 'source-atop'
            g.fillStyle = 'rgb(90, 255, 130)'
            g.fillRect(0, 0, c.width, c.height)
            this.tints.set(image, c)
        }
        return c
    }
}

// The one instance the hooks call.
const healFx = new HealFx()
