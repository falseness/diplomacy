// Heal animations (TASK-1445, concept B 'heal vs repair'), UI only: the rules heal at a turn's start as before
// (Entity.hpIncrease, applied in Player.nextTurn); only the drawing animates, as attackFx does for attacks. Input is
// never blocked: nothing waits for an effect.
// A healed unit stands in a rising green light column with a bright ground ellipse and rising motes, lifts by at most
// 0.05 r (5 px at the concept's r = 100) with a short green tint (one tinted copy per sprite, made once), its new hp
// pips fill in with a flash and a green '+N' floats up. A healed building is repaired (TASK-1446): a hammer taps twice at
// its roof with gold spark bursts, brick chips fly in to its walls, its new pips flash in and a green '+N' floats up (its
// hp bar is left out of the grid's bar passes while the effect holds it: Grid.healBarHidden).
// TASK-1446: a turn start's heals play as a staggered wave once it is seen (startWave): those whose cell is off screen
// then are skipped (their hp and pips are final), the rest start one after another by their distance from the screen's
// centre, min(60 ms, 1500 ms / n) apart (the last about 1.5 s after the first at most); at most maxDrawn effects play at
// once, one due while that many play is skipped (startDue), not delayed.
// Offline the turn player's heals are read around its nextTurn (before / after, offlineNextTurn); their clock starts on
// the first frame drawn without the pass-device screen (prune), so nothing plays behind it. While an effect plays its
// unit is left out of the grid's unit passes (Grid.getStillUnit reads hidden) and drawn here, over the board's frame
// (drawMain): a held still or level-of-detail frame stays held, a zoom gesture keeps its raster, the board cache is not
// rebuilt for an effect. A finished effect keeps its unit (drawn in place, as the board draws it) until the board
// changes anyway (the unit moves, dies or its bars change, a camera pan, an undo, the turn's end), as attackFx does.
// Plain canvas code: rects, arcs, ellipses, one gradient made once; no shadowBlur, filters or new assets. Off when
// otherSettings.animateHeals is false (no effect is queued; running ones end at once).
// TASK-1447: others' heals the screen's player sees play too, in place (no camera move), in the next wave of its view.
// Offline an AI's turn start heals its units and buildings and then plays (Player.nextTurn calls healed before the AI's
// moves); each heal on a cell the viewer sees (the last local human's fog: endTurn keeps a copy, as attackFx; all cells
// without fog) is queued, fogged ones get nothing. endTurn drops the ended turn's own effects and keeps others' waiting
// ones; a new local human viewer drops those (setViewer, no leak to the next human). Online and co-op the heals arrive
// in the server's cell diffs (remoteBefore / remoteAfter around applyCellDiff in gameDiffHandler.apply, as attackFx):
// the same entity on the same cell with more hp, not hit before the diff (a heal needs wasHitted false; an undo of a hit
// restores hp of a hit entity), on a cell seen before and after it (a cell revealed from fog is not a heal); the player's
// own heals online too. A peer's observed mid-turn action (onlineObservation) never heals (heals happen at turn starts).
// API: play(event), draw(ctx, now), isActive(), clear(), now(); the hooks call before(slot) / after(snapshot), healed(player),
// endTurn(), setViewer(slot), remoteBefore(records) / remoteAfter(snapshot) and prune().
// Removing this file and its guarded calls leaves the game as it was.
class HealFx {
    // Most effects queued (a bound on memory): a new one drops the oldest.
    maxEffects = 256
    // Most effects playing at once (the wave's cap): one due while that many play is skipped.
    maxDrawn = 16
    // ms of the unit effect (the concept's unit part: 0.7 of its 1 s loop) and of the building repair.
    durations = {unit: 700, building: 900}
    // The wave's start step: min(step, span / n) ms for n heals.
    wave = {step: 60, span: 1500}
    // The last wave started (tests and evidence): its clock, heals started, step, heals skipped off screen.
    lastWave = null
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
    // Brick chips (the concept's 10): angle (radians) and start (in the repair's s), made once.
    chips = Float32Array.from({length: 20}, (_, j) => j % 2 ? 0.15 + 0.3 * ((Math.floor(j / 2) * 0.381 + 0.17) % 1) :
        2 * Math.PI * ((j / 2 * 0.618 + 0.05) % 1))
    // The repair's two taps: when their spark bursts start (in s).
    static TAPS = [0.15, 0.45]
    // Counters for tests and evidence: effects queued, dropped by the queue bound, heals of no animated kind, heals skipped
    // off screen when their wave started, effects skipped by the cap (maxDrawn).
    stats = {queued: 0, dropped: 0, skipped: 0, offscreen: 0, capped: 0}
    // A prune ran since the last draw (draw).
    pruned = false
    // The camera at the last prune (offset and scale), to tell a pan.
    camera = {x: NaN, y: NaN, scale: NaN}
    // The local human whose view the effects are for (offline), and the ended human's fog others' heals are judged by.
    viewer = null
    view = null
    // The turn start snapshot waiting for its heals (before -> healed / after).
    pending = null
    // Clock in ms; tests may replace it.
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    }
    enabled() {
        return typeof otherSettings === 'undefined' || otherSettings.animateHeals !== false
    }
    // Whether the screen's player sees coord: no fog, else the ended human's fog copy (an AI turn's vision is in
    // grid.fogOfWar then) or the board's fog.
    seen(coord) {
        if (typeof isFogOfWar === 'undefined' || !isFogOfWar || typeof grid === 'undefined' || !grid.fogOfWar)
            return true
        return Boolean((this.view || grid.fogOfWar)[coord.x]?.[coord.y])
    }
    // The hp of slot's units and buildings before its turn start heals them (offlineNextTurn); null when off. A slot that is
    // not a local human (an AI) is others': its heals are queued for the cells the viewer sees.
    before(slot) {
        this.pending = null
        if (!this.enabled() || typeof players === 'undefined' || !players[slot] || players[slot].isNeutral || typeof grid === 'undefined')
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
        return this.pending = {slot, player: players[slot], other: players[slot].constructor !== Player, entities, hp, done: false}
    }
    // Player.nextTurn has applied player's heals (an AI plays after it): the pending snapshot's heals are read now.
    healed(player) {
        if (this.pending && this.pending.player === player)
            this.after(this.pending)
    }
    // After the turn start: a heal event for each entity whose hp rose (others': on a cell the viewer sees). Once per
    // snapshot.
    after(snapshot) {
        if (!snapshot || snapshot.done)
            return 0
        snapshot.done = true
        if (this.pending === snapshot)
            this.pending = null
        let n = 0
        for (let i = 0; i < snapshot.entities.length; ++i) {
            const entity = snapshot.entities[i], amount = entity.hp - snapshot.hp[i]
            if (!(amount > 0) || entity.killed)
                continue
            const unit = entity.isUnit
            const coord = unit ? entity.coord : entity.hexagon?.coord ?? entity.coord
            if (snapshot.other && !this.seen(coord))
                continue
            const effect = this.play({entity, coord: {x: coord.x, y: coord.y}, kind: unit ? 'unit' : 'building', amount, from: snapshot.hp[i],
                sprite: this.imageOf(entity)})
            if (effect) {
                effect.other = snapshot.other
                ++n
            }
        }
        return n
    }
    // A turn ends: its own effects stop; others' waiting ones (an AI turn just played) stay for the next view. A local
    // human's ending turn leaves its fog as the view others' heals are judged by (offline).
    endTurn() {
        this.pending = null
        this.effects = this.effects.filter(e => e.other && !e.begun)
        this.hideUnits()
        const ending = typeof players !== 'undefined' && typeof whooseTurn !== 'undefined' ? players[whooseTurn] : null
        if (ending && ending.constructor === Player && !(typeof gameSettings !== 'undefined' && gameSettings.isOnline))
            this.view = typeof isFogOfWar !== 'undefined' && isFogOfWar && grid.fogOfWar ? grid.fogOfWar.map(column => Array.from(column)) : null
    }
    // The screen shows slot's view (its fog rebuilt): others' effects queued for another human's view are dropped (slot's
    // own heals stay). An AI slot keeps the last human's view.
    setViewer(slot) {
        if (typeof players !== 'undefined' && players[slot]?.constructor !== Player)
            return
        if (this.viewer !== null && this.viewer !== slot) {
            this.effects = this.effects.filter(e => !e.other)
            this.hideUnits()
        }
        this.viewer = slot
        this.view = null
    }
    // An online change's cells before applyCellDiff (records: the diff's cells): their unit and building with hp, whether
    // each was hit, and whether the screen's player saw the cell.
    remoteBefore(records) {
        if (!this.enabled() || !Array.isArray(records) || typeof grid === 'undefined')
            return null
        const cells = []
        for (const record of records) {
            const cell = grid.arr[record.x]?.[record.y]
            if (!cell || cell.hexagon.unknown)
                continue
            const coord = {x: record.x, y: record.y}
            if (!this.seen(coord))
                continue
            const unit = cell.unit.notEmpty() && cell.unit.hp < cell.unit.maxHP && !cell.unit.wasHitted ? cell.unit : null
            const b = cell.building
            const building = b.notEmpty() && !b.isNature && b.hp !== undefined && b.hp < b.maxHP && !b.wasHitted ? b : null
            if (unit || building)
                cells.push({coord, unit, hp: unit?.hp, building, buildingHp: building?.hp, moves: unit?.moves})
        }
        return cells
    }
    // After applyCellDiff: the same unit or building on its cell with more hp, the cell still seen, is a heal event.
    remoteAfter(before) {
        if (!before)
            return 0
        let n = 0
        for (const cell of before) {
            const coord = cell.coord
            if (!this.seen(coord) || grid.arr[coord.x][coord.y].hexagon.unknown)
                continue
            for (const [entity, from, kind] of [[cell.unit, cell.hp, 'unit'], [cell.building, cell.buildingHp, 'building']]) {
                if (!entity || entity.killed || !(entity.hp > from))
                    continue
                if ((kind === 'unit' ? grid.getUnit(coord) : grid.getBuilding(coord)) !== entity)
                    continue
                const effect = this.play({entity, coord: {x: coord.x, y: coord.y}, kind, amount: entity.hp - from, from,
                    sprite: this.imageOf(entity)})
                if (effect) {
                    effect.other = true
                    ++n
                }
            }
        }
        return n
    }
    // event: {entity, coord, kind 'unit' | 'building', amount, from (hp before), sprite}. Its clock starts on the first frame
    // drawn without the pass-device screen (prune). Returns the effect, or null.
    play(event) {
        if (!this.enabled() || !event || !event.entity || !(event.amount > 0))
            return null
        if (event.kind !== 'unit' && event.kind !== 'building') {
            ++this.stats.skipped
            return null
        }
        const unit = event.entity
        const effect = event
        effect.from ??= unit.hp - event.amount
        effect.sprite ??= this.imageOf(unit)
        effect.duration = this.durations[event.kind]
        // (set by startWave; begun: started by startDue)
        effect.startTime = null
        effect.begun = false
        effect.hp = unit.hp
        effect.moves = unit.moves
        // The bar before the heal (the pips the effect fills in): its own HealthBar at the entity's bar position.
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
    // Starts waiting effects as a wave (no pass-device screen: startWave), drops those whose entity is no longer as the
    // heal left it (a unit moved, killed, hit, its moves spent; a building destroyed or hit) and finished ones once the
    // camera pans (their units and bars go back to the board's passes in a frame drawn live anyway), and starts the due
    // ones under the cap (startDue).
    prune(now = this.now()) {
        this.pruned = true
        if (!this.enabled() && this.effects.length)
            this.clear()
        const moved = this.cameraMoved()
        if (!this.effects.length)
            return
        const panning = this.panning(moved)
        const before = this.effects.length
        if (!this.held() && this.effects.some(e => e.startTime === null))
            this.startWave(now)
        this.effects = this.effects.filter(e => {
            const u = e.entity
            if (u.killed || u.hp !== e.hp || panning && this.finished(e, now))
                return false
            // (others' waiting heals: the AI played on after its heals; a unit still on its cell keeps its effect)
            if (e.other && !e.begun)
                e.moves = u.moves
            if (e.kind === 'building')
                return grid.arr[e.coord.x]?.[e.coord.y]?.building === u
            return u.coord.x === e.coord.x && u.coord.y === e.coord.y && grid.getUnit(e.coord) === u && u.moves === e.moves
        })
        this.startDue(now)
        if (this.effects.length !== before)
            this.hideUnits()
    }
    // The waiting effects' wave, from now: those whose entity's centre is off the main canvas are skipped (stats.offscreen,
    // settled: finished at once), the rest start by their distance from the canvas centre, min(wave.step, wave.span / n) ms
    // apart. The effects are kept in start order.
    startWave(now) {
        const ctx = typeof mainCtx !== 'undefined' ? mainCtx : null
        const t = ctx?.getTransform?.(), w = ctx?.canvas?.width, h = ctx?.canvas?.height
        const half = typeof assets !== 'undefined' ? assets.size / 2 : 0
        let offscreen = 0, n = 0
        const wave = []
        for (const e of this.effects) {
            if (e.startTime !== null)
                continue
            e.distance = 0
            if (t && w > 0 && h > 0) {
                const cx = e.entity.pos.x + half, cy = e.entity.pos.y + half
                const x = t.a * cx + t.c * cy + t.e, y = t.b * cx + t.d * cy + t.f
                if (!(x >= 0 && y >= 0 && x <= w && y <= h)) {
                    ++offscreen
                    this.settle(e, now)
                    e.offscreen = true
                    continue
                }
                e.distance = Math.hypot(x - w / 2, y - h / 2)
            }
            ++n
            wave.push(e)
        }
        wave.sort((a, b) => a.distance - b.distance)
        const step = n ? Math.min(this.wave.step, this.wave.span / n) : 0
        for (let i = 0; i < wave.length; ++i)
            wave[i].startTime = now + i * step
        this.effects.sort((a, b) => a.startTime - b.startTime)
        this.stats.offscreen += offscreen
        this.lastWave = {at: now, n, step, offscreen}
    }
    // Starts the effects due by now in start order; one due while maxDrawn play is skipped (stats.capped, settled: its hp
    // and pips final).
    startDue(now) {
        let playing = 0
        for (const e of this.effects)
            if (e.begun && now - e.startTime < e.duration)
                ++playing
        for (const e of this.effects) {
            if (e.begun || e.startTime === null || e.startTime > now)
                continue
            if (playing >= this.maxDrawn) {
                this.settle(e, now)
                e.capped = true
                ++this.stats.capped
            }
            else {
                e.begun = true
                if (now - e.startTime < e.duration)
                    ++playing
            }
        }
    }
    // A skipped heal (off screen at its wave's start, or due while maxDrawn play): finished at once, its unit or building
    // drawn here as the board draws it (hp and pips final) until the board changes anyway, as a finished effect. It stays
    // in effects so the board's unit and bar passes (hidden) do not change during the wave: a change there makes the
    // board's held still frame again (TASK-1448: one board redraw and snapshot per skipped heal).
    settle(e, now) {
        e.startTime = now - e.duration
        e.begun = true
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
    // An effect plays or waits for its start in a wave (one behind the pass-device screen or held at its end does not).
    isActive() {
        this.prune()
        const now = this.now()
        return this.effects.some(e => e.startTime !== null && now - e.startTime < e.duration)
    }
    // How many effects play (started by startDue, not finished) at now.
    playing(now = this.now()) {
        let n = 0
        for (const e of this.effects)
            if (e.begun && now - e.startTime < e.duration)
                ++n
        return n
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
        // (the board's transform: cached bars are made for it, blitBars)
        this.restTransform = t
        for (const e of this.effects) {
            const u = e.entity
            const cx = u.pos.x + half, cy = u.pos.y + half
            const x = t.a * cx + t.c * cy + t.e, y = t.b * cx + t.d * cy + t.f
            const reach = Math.abs(t.a) * margin
            if (x < -reach || y < -reach || x > ctx.canvas.width + reach || y > ctx.canvas.height + reach)
                continue
            ctx.save()
            // (an effect waiting behind the pass-device screen or for its start in the wave: its first pose, the bar before
            // the heal)
            const s = e.startTime === null || !e.begun ? 0 : Math.max(0, Math.min(1, (now - e.startTime) / e.duration))
            if (e.kind === 'building')
                this.drawRepair(ctx, e, this.finished(e, now) && e.begun ? 1 : s, lod)
            else if (this.finished(e, now) && e.begun)
                this.drawUnit(ctx, e, 0, 1.4, 0, lod)
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
    // The building repair (H-B), s in [0, 1] (1: done, its bars as the board draws them). Sizes in r from the sprite's centre
    // (the concept's town at r = 100 px): the hammer pivots at (0.7, -0.85) and taps twice in the first 60 %, spark bursts
    // at (0.35, -0.55) from each tap, chips fly in from 1.2 r to the walls (0.2 r up), pips from s = 0.45, '+N' over it.
    drawRepair(ctx, e, s, lod) {
        const r = basis.r, b = e.entity, half = assets.size / 2
        const tx = b.pos.x + half, ty = b.pos.y + half
        if (s > 0 && s < 1) {
            const a = Math.min(1, s * 5, (1 - s) * 5)
            const tap = Math.abs(Math.sin(2 * Math.PI * Math.min(1, s / 0.6)))
            this.drawHammer(ctx, tx + 0.7 * r, ty - 0.85 * r, (160 + 55 * (1 - tap)) * Math.PI / 180, a, r)
            ctx.strokeStyle = 'rgb(255, 220, 110)'
            ctx.lineWidth = 0.03 * r
            ctx.lineCap = 'butt'
            for (const when of HealFx.TAPS) {
                const q = (s - when) / 0.2
                if (!(q > 0 && q < 1))
                    continue
                const hx = tx + 0.35 * r, hy = ty - 0.55 * r, d = (0.1 + 0.4 * q) * r
                ctx.globalAlpha = 1 - q
                ctx.beginPath()
                for (let j = 0; j < 8; ++j) {
                    const c = Math.cos(-Math.PI * j / 7), si = Math.sin(-Math.PI * j / 7)
                    ctx.moveTo(hx + c * d, hy + si * d)
                    ctx.lineTo(hx + c * (d + 0.08 * r), hy + si * (d + 0.08 * r))
                }
                ctx.stroke()
            }
            if (!lod) {
                ctx.fillStyle = 'rgb(190, 120, 80)'
                ctx.strokeStyle = 'rgb(90, 50, 30)'
                ctx.lineWidth = 0.012 * r
                for (let j = 0; j < this.chips.length; j += 2) {
                    const q = (s - this.chips[j + 1]) / 0.35
                    if (!(q > 0 && q < 1))
                        continue
                    const d = 1.2 * r * (1 - this.ease(q)), ang = this.chips[j]
                    const x = tx + Math.cos(ang) * d, y = ty - 0.2 * r + Math.sin(ang) * d * 0.6
                    ctx.globalAlpha = Math.min(1, (1 - q) * 3)
                    ctx.fillRect(x - 0.05 * r, y - 0.03 * r, 0.1 * r, 0.06 * r)
                    ctx.strokeRect(x - 0.05 * r, y - 0.03 * r, 0.1 * r, 0.06 * r)
                }
            }
            ctx.globalAlpha = 1
        }
        if (!lod) {
            this.drawBars(ctx, e, s >= 1 ? 1.4 : (s - 0.45) / 0.25)
            this.drawGain(ctx, tx, ty - 1.1 * r, (s - 0.45) / 0.55, e.amount, r)
        }
    }
    // A hammer from its pivot (x, y) at angle ang: a wooden handle 0.34 r long, a grey head across its end.
    drawHammer(ctx, x, y, ang, a, r) {
        const c = Math.cos(ang), si = Math.sin(ang)
        const hx = x + c * 0.34 * r, hy = y + si * 0.34 * r, px = -si * 0.13 * r, py = c * 0.13 * r
        ctx.globalAlpha = a
        ctx.strokeStyle = 'rgb(120, 80, 40)'
        ctx.lineWidth = 0.06 * r
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(hx, hy)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(hx + px - c * 0.05 * r, hy + py - si * 0.05 * r)
        ctx.lineTo(hx + px + c * 0.09 * r, hy + py + si * 0.09 * r)
        ctx.lineTo(hx - px + c * 0.09 * r, hy - py + si * 0.09 * r)
        ctx.lineTo(hx - px - c * 0.05 * r, hy - py - si * 0.05 * r)
        ctx.closePath()
        ctx.fillStyle = 'rgb(170, 175, 185)'
        ctx.fill()
        ctx.strokeStyle = 'rgb(60, 60, 70)'
        ctx.lineWidth = 0.012 * r
        ctx.stroke()
    }
    // The entity's bars as its drawBars draws them, its hp bar crossfading from the bar before the heal to the bar now.
    drawBars(ctx, e, k) {
        const u = e.entity
        k = Math.max(0, Math.min(k, 1.4))
        const old = e.oldBar
        if ((k <= 0 || k >= 1.4 || !old) && this.blitBars(ctx, e, k <= 0 && old ? 'before' : 'after'))
            return
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
            if (e.kind === 'unit' && typeof shouldShowMovesBar === 'function' && shouldShowMovesBar(u))
                u.movesBar.draw(ctx)
        }
    }
    // TASK-1448: an effect's bars at rest ('before': the bar before the heal, k = 0; 'after': as the board draws them,
    // k = 1.4) are drawn once into a small canvas at the board's device scale and pixel phase (barsImage) and blitted each
    // frame, where every pip was a fill and a stroke every frame for every effect (most of a wave's draw time); the
    // crossfade and flash between them are drawn live. A lifted unit's bars (drawUnit's dy) are blitted at the nearest
    // device pixel. False (drawn live) for a rotated or rescaled context and entities with their own drawBars.
    blitBars(ctx, e, pose) {
        const t = ctx.getTransform(), rest = this.restTransform, u = e.entity
        if (!rest || t.a !== rest.a || t.d !== rest.d || t.b || t.c || typeof document === 'undefined' ||
                u.drawBars !== Entity.prototype.drawBars && !(typeof Unit !== 'undefined' && u.drawBars === Unit.prototype.drawBars))
            return false
        const image = this.barsImage(e, pose, rest)
        if (!image)
            return false
        if (image.canvas) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.drawImage(image.canvas, image.x + Math.round(t.e - rest.e), image.y + Math.round(t.f - rest.f))
            ctx.restore()
        }
        return true
    }
    // The pose's bars in device pixels for transform t: {canvas, x, y} (canvas null: no bar shown), remade when what they
    // show or the transform's scale or sub-pixel phase changed. One canvas per effect, reused.
    barsImage(e, pose, t) {
        const u = e.entity, moves = e.kind === 'unit' && typeof shouldShowMovesBar === 'function' && shouldShowMovesBar(u)
        const hp = pose === 'before' ? (otherSettings.alwaysDisplayHPBar || e.from < u.maxHP ? e.oldBar : null) :
            otherSettings.alwaysDisplayHPBar || !u.isFullHP ? u.hpBar : null
        const bars = [hp, moves ? u.movesBar : null]
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const bar of bars) {
            if (!bar)
                continue
            for (const r of bar.rects) {
                const w = r.strokeWidth || 0
                x0 = Math.min(x0, r.x - w)
                y0 = Math.min(y0, r.y - w)
                x1 = Math.max(x1, r.x + r.width + w)
                y1 = Math.max(y1, r.y + r.height + w)
            }
        }
        const key = [pose, t.a, t.d, t.e - Math.floor(t.e), t.f - Math.floor(t.f), u.hp, u.maxHP, u.moves, moves,
            otherSettings.alwaysDisplayHPBar, x0, y0, x1, y1].join()
        const cached = e.bars
        if (cached && cached.key === key)
            return cached.image
        const image = {canvas: null, x: 0, y: 0}
        if (x0 <= x1) {
            const X0 = Math.floor(t.a * x0 + t.e) - 2, Y0 = Math.floor(t.d * y0 + t.f) - 2
            const w = Math.ceil(t.a * x1 + t.e) + 2 - X0, h = Math.ceil(t.d * y1 + t.f) + 2 - Y0
            if (!(w > 0 && h > 0 && w * h <= 1 << 20))
                return null
            const canvas = cached?.canvas || document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const c = canvas.getContext('2d')
            c.setTransform(t.a, 0, 0, t.d, t.e - X0, t.f - Y0)
            if (pose === 'after')
                u.drawBars(c)
            else
                for (const bar of bars)
                    bar?.draw(c)
            Object.assign(image, {canvas, x: X0, y: Y0})
        }
        e.bars = {key, image, canvas: image.canvas || cached?.canvas}
        return image
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
