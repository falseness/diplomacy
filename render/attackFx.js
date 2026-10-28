// Attack animations (TASK-1421, concept B 'hop & slash'), UI only: the rules resolve the attack at once (hp, kill,
// the attacker's moves and coord change in Unit.sendInstructions as before); only the drawing animates, as moveTween
// does for moves. Input is never blocked: nothing waits for an effect; a second attack queues its own effect.
// Melee: the attacker hops toward the target in an arc and back, a white slash with gold sparks crosses the target,
// a red flash, '-N' floats up. Last hit: after the slash the target (a snapshot of its sprite: it is already gone
// in the rules) greys, falls back in a dust puff and fades; an attacker that moved into the hex slides in after it.
// While an effect plays its attacker is left out of the grid's unit passes (Grid.getStillUnit) and drawn here, and
// frames are drawn live (zoomRasterTweens: no held, still or zoom raster frame), the board cache is not rebuilt.
// Plain canvas code: paths, arcs, ellipses, the cached unit sprites (and one tinted copy per sprite, made once);
// no shadowBlur, filters or new assets. Off when otherSettings.animateAttacks is false (no effect is queued).
// API: play(event), draw(ctx, now), isActive(), clear(); the hooks call before(unit, cell) / after(snapshot).
// Removing this file and its guarded calls leaves the game as it was.
class AttackFx {
    // Most effects playing at once: a new one drops the oldest.
    maxEffects = 12
    // ms per kind.
    durations = {melee: 650, lasthit: 700}
    // Concept time units an effect's duration covers (the last hit runs on to the captured hex's pulse).
    spans = {melee: 1, lasthit: 1.3}
    effects = []
    // Clock in ms; tests may replace it.
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    }
    // Spark directions and reach (in r) of the slash, made once.
    sparks = (() => {
        let seed = 3
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
        const sparks = new Float32Array(28)
        for (let i = 0; i < 28; i += 2) {
            sparks[i] = random() * 2 * Math.PI
            sparks[i + 1] = 0.6 + random() * 0.8
        }
        return sparks
    })()
    // image -> {red, grey} tinted copies (canvases of the sprite's size), made on first use.
    tints = new Map()
    // Counters for tests and evidence.
    stats = {queued: 0, dropped: 0}
    enabled() {
        return typeof otherSettings === 'undefined' || otherSettings.animateAttacks !== false
    }
    // The target cell's enemy unit and building with their hp, before unit acts on cell; null when no effect can
    // come of it (off, no enemy there, a kind of attacker with no effect).
    before(unit, cell) {
        if (!this.enabled() || !cell || !unit || unit.isEmpty() || !this.kindOf(unit))
            return null
        const enemy = entity => entity && entity.notEmpty() && entity.hp !== undefined &&
            entity.playerColor !== unit.playerColor && !entity.isNature ? entity : null
        const target = {unit: enemy(cell.unit), building: enemy(cell.building)}
        if (!target.unit && !target.building)
            return null
        return {attacker: unit, from: {x: unit.coord.x, y: unit.coord.y}, fromPos: {x: unit.pos.x, y: unit.pos.y},
            image: this.imageOf(unit), coord: {x: cell.hexagon.coord.x, y: cell.hexagon.coord.y},
            unit: target.unit, unitHp: target.unit?.hp, unitPos: target.unit && {x: target.unit.pos.x, y: target.unit.pos.y},
            unitImage: target.unit && this.imageOf(target.unit),
            building: target.building, buildingHp: target.building?.hp,
            buildingPos: target.building && {x: target.building.pos.x, y: target.building.pos.y},
            buildingImage: target.building && this.imageOf(target.building)}
    }
    // After the action: plays the effect of a hit on the snapshot's unit or building (hp lost or killed).
    after(snapshot) {
        if (!snapshot)
            return false
        const s = snapshot, coord = s.coord
        let target = null
        if (s.unit && (s.unit.killed || grid.getUnit(coord) !== s.unit || s.unit.hp < s.unitHp)) {
            const killed = !!s.unit.killed || grid.getUnit(coord) !== s.unit
            target = {killed, damage: s.unitHp - (killed ? 0 : s.unit.hp), pos: s.unitPos, image: s.unitImage, unit: true}
        }
        else if (s.building && (grid.getBuilding(coord) !== s.building || s.building.hp < s.buildingHp)) {
            const killed = grid.getBuilding(coord) !== s.building
            target = {killed, damage: s.buildingHp - (killed ? 0 : s.building.hp), pos: s.buildingPos, image: s.buildingImage, unit: false}
        }
        if (!target || !(target.damage > 0))
            return false
        const attacker = s.attacker
        return this.play({kind: this.kindOf(attacker), attacker, image: s.image, from: s.from, fromPos: s.fromPos,
            to: {x: attacker.coord.x, y: attacker.coord.y}, target: coord, targetPos: target.pos, targetImage: target.image,
            targetIsUnit: target.unit, damage: target.damage, killed: target.killed})
    }
    // The effect kind of an attacker's hits; null: none (ranged and siege kinds come with TASK-1422/1423).
    kindOf(unit) {
        if (typeof RangeUnit !== 'undefined' && unit instanceof RangeUnit)
            return null
        return 'melee'
    }
    imageOf(entity) {
        return typeof cachedImages !== 'undefined' && typeof grid !== 'undefined' ? cachedImages[grid.getEntityBodyImageName(entity)] : undefined
    }
    // Visible to the screen's player: no fog, or both cells in vision (TASK-1424 refines this for others' attacks).
    visible(event) {
        if (typeof isFogOfWar === 'undefined' || !isFogOfWar)
            return true
        const seen = c => Boolean(grid.fogOfWar?.[c.x]?.[c.y])
        return seen(event.from) && seen(event.target)
    }
    // event: {kind, attacker, image, from, fromPos, to, target, targetPos, targetImage, targetIsUnit, damage, killed}.
    // Returns the queued effect, or null.
    play(event) {
        if (!this.enabled() || !event || !event.kind || !this.visible(event))
            return null
        const kind = event.kind === 'melee' && event.killed ? 'lasthit' : event.kind
        const effect = {...event, kind, startTime: this.now(), duration: this.durations[kind]}
        if (!effect.duration)
            return null
        // One effect per attacker: a new attack of the same unit replaces its effect.
        this.effects = this.effects.filter(e => e.attacker !== event.attacker)
        this.effects.push(effect)
        ++this.stats.queued
        while (this.effects.length > this.maxEffects) {
            this.effects.shift()
            ++this.stats.dropped
        }
        return effect
    }
    clear() {
        this.effects.length = 0
    }
    // Drops finished effects and those of an attacker no longer where the rules left it (killed, moved, undone).
    prune(now = this.now()) {
        if (!this.effects.length)
            return
        this.effects = this.effects.filter(e => now - e.startTime < e.duration && !e.attacker.killed &&
            e.attacker.coord.x === e.to.x && e.attacker.coord.y === e.to.y && grid.getUnit(e.to) === e.attacker)
    }
    isActive() {
        this.prune()
        return this.effects.length > 0
    }
    // Whether unit is drawn by an effect (left out of the grid's unit passes).
    hidesUnit(unit) {
        if (!this.effects.length)
            return false
        for (const e of this.effects)
            if (e.attacker === unit)
                return this.now() - e.startTime < e.duration
        return false
    }
    draw(ctx, now = this.now()) {
        this.prune(now)
        if (!this.effects.length)
            return
        const t = ctx.getTransform(), margin = 3 * basis.r
        const lod = typeof grid !== 'undefined' && grid.lod
        for (const e of this.effects) {
            // Off-screen effects are skipped (the target's centre and reach against the canvas).
            const cx = e.targetPos.x + assets.size / 2, cy = e.targetPos.y + assets.size / 2
            const x = t.a * cx + t.c * cy + t.e, y = t.b * cx + t.d * cy + t.f
            const reach = Math.abs(t.a) * margin
            if (x < -reach || y < -reach || x > ctx.canvas.width + reach || y > ctx.canvas.height + reach)
                continue
            ctx.save()
            this.drawMelee(ctx, e, Math.min(1, (now - e.startTime) / e.duration) * this.spans[e.kind], lod)
            ctx.restore()
        }
    }
    ease(t) {
        return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
    }
    // Tinted copies of a sprite: red (flash) and grey with a dark red cast (a dying unit).
    tinted(image) {
        let tint = this.tints.get(image)
        if (tint)
            return tint
        const make = paint => {
            const c = document.createElement('canvas')
            c.width = image.width
            c.height = image.height
            const g = c.getContext('2d')
            g.drawImage(image, 0, 0)
            paint(g, c)
            return c
        }
        tint = {
            red: make((g, c) => {
                g.globalCompositeOperation = 'source-atop'
                g.fillStyle = 'rgb(255, 40, 30)'
                g.fillRect(0, 0, c.width, c.height)
            }),
            grey: make((g, c) => {
                g.globalCompositeOperation = 'saturation'
                g.fillStyle = 'rgb(128, 128, 128)'
                g.fillRect(0, 0, c.width, c.height)
                g.globalCompositeOperation = 'destination-in'
                g.drawImage(image, 0, 0)
                g.globalCompositeOperation = 'source-atop'
                g.fillStyle = 'rgba(120, 20, 20, 0.4)'
                g.fillRect(0, 0, c.width, c.height)
            })
        }
        if (this.tints.size > 64)
            this.tints.clear()
        this.tints.set(image, tint)
        return tint
    }
    // Melee hit and last hit (B2-melee, B2-lasthit), t in concept time units ([0, 1], the last hit [0, 1.3]). Sizes in r
    // (basis.r): the concepts' scene had r = 100 px.
    drawMelee(ctx, e, t, lod) {
        const r = basis.r, half = assets.size / 2
        const last = e.kind === 'lasthit'
        const A = {x: e.fromPos.x + half, y: e.fromPos.y + half}
        const E = {x: e.targetPos.x + half, y: e.targetPos.y + half}
        const vx = E.x - A.x, vy = E.y - A.y
        const time = t
        const moved = e.to.x !== e.from.x || e.to.y !== e.from.y
        // The attacker: hop toward the target (k of the way, hop up), back, or (last hit, moved in) into the hex.
        let k = 0, hop = 0
        if (time < 0.3) {
            k = 0.45 * this.ease(time / 0.3)
            hop = -0.34 * r * Math.sin(Math.PI * time / 0.3 * 0.95)
        }
        else if (time < 0.5)
            k = 0.45
        else if (!last) {
            if (time < 0.75) {
                k = 0.45 * (1 - this.ease((time - 0.5) / 0.25))
                hop = -0.18 * r * Math.sin(Math.PI * (time - 0.5) / 0.25)
            }
        }
        else {
            if (time < 0.8)
                k = 0.45
            else if (moved) {
                k = 0.45 + 0.55 * this.ease((time - 0.8) / 0.2)
                hop = time < 1 ? -0.14 * r * Math.sin(Math.PI * (time - 0.8) / 0.2) : 0
            }
            else {
                k = 0.45 * (1 - this.ease((time - 0.8) / 0.2))
                hop = time < 1 ? -0.14 * r * Math.sin(Math.PI * (time - 0.8) / 0.2) : 0
            }
        }
        const hit = time >= 0.3
        const tint = e.targetImage && this.tinted(e.targetImage)
        // The target: a red flash over it (a hit) or its snapshot dying (last hit).
        if (!last) {
            if (hit && time < 0.55 && tint) {
                ctx.globalAlpha = 0.55 * (1 - (time - 0.3) / 0.25)
                ctx.drawImage(tint.red, e.targetPos.x, e.targetPos.y)
                ctx.globalAlpha = 1
            }
        }
        else if (time < 0.45) {
            if (e.targetImage) {
                ctx.drawImage(e.targetImage, e.targetPos.x, e.targetPos.y)
                if (hit && tint) {
                    ctx.globalAlpha = 0.55 * (time - 0.3) / 0.15
                    ctx.drawImage(tint.red, e.targetPos.x, e.targetPos.y)
                    ctx.globalAlpha = 1
                }
            }
        }
        else if (time < 0.8) {
            const s = (time - 0.45) / 0.35
            const foot = {x: E.x, y: E.y + 0.7 * r}
            if (tint) {
                ctx.save()
                ctx.globalAlpha = 1 - this.ease(s)
                ctx.translate(foot.x + vx * 0.12 * s, foot.y + vy * 0.12 * s + 0.1 * r * s)
                if (e.targetIsUnit)
                    ctx.rotate(80 * Math.PI / 180 * this.ease(Math.min(1, s * 1.4)))
                ctx.drawImage(tint.grey, e.targetPos.x - foot.x, e.targetPos.y - foot.y)
                ctx.restore()
            }
            if (s < 0.7) {
                ctx.fillStyle = `rgba(215, 195, 165, ${(0.67 * (1 - s / 0.7)).toFixed(3)})`
                ctx.beginPath()
                const rr = (0.25 + 0.55 * s) * r
                for (let j = 0; j < 7; ++j) {
                    const angle = j / 7 * Math.PI + Math.PI
                    const px = foot.x + Math.cos(angle) * rr * 1.3, py = foot.y - 0.1 * r + Math.sin(angle) * rr * 0.35
                    ctx.moveTo(px + 0.16 * r, py)
                    ctx.ellipse(px, py, 0.16 * r, 0.12 * r, 0, 0, 2 * Math.PI)
                }
                ctx.fill()
            }
        }
        // The attacker over the target, its bars with it (but in a level-of-detail frame).
        if (e.image) {
            const dx = vx * k, dy = vy * k + hop
            if (!lod && e.attacker.drawBars) {
                ctx.save()
                ctx.translate(e.fromPos.x + dx - e.attacker.pos.x, e.fromPos.y + dy - e.attacker.pos.y)
                e.attacker.drawBars(ctx)
                ctx.restore()
            }
            ctx.drawImage(e.image, e.fromPos.x + dx, e.fromPos.y + dy)
        }
        if (time >= 0.28 && time < 0.48)
            this.drawSlash(ctx, E, (time - 0.28) / 0.2, r)
        // The captured hex's outline pulses once the attacker is in.
        if (last && moved && time >= 1) {
            const s = Math.min(1, (time - 1) / 0.3), rr = (0.9 + 0.3 * s) * r
            ctx.globalAlpha = 0.8 * (1 - s)
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 0.05 * r
            ctx.beginPath()
            for (let j = 0; j < 6; ++j)
                ctx.lineTo(E.x + rr * Math.cos(Math.PI / 3 * j), E.y + rr * Math.sin(Math.PI / 3 * j))
            ctx.closePath()
            ctx.stroke()
            ctx.globalAlpha = 1
        }
        this.drawDamage(ctx, E, (time - 0.33) / 0.55, e.damage, r)
    }
    drawSlash(ctx, E, s, r) {
        const end = (-150 + 140 * Math.min(1, s * 1.6)) * Math.PI / 180, start = -160 * Math.PI / 180
        const fade = 1 - Math.max(0, s - 0.5) / 0.5
        ctx.lineCap = 'round'
        ctx.globalAlpha = fade
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 0.1 * r
        ctx.beginPath()
        ctx.arc(E.x, E.y, 0.65 * r, start, end)
        ctx.stroke()
        ctx.globalAlpha = fade / 2
        ctx.strokeStyle = 'rgb(255, 230, 150)'
        ctx.lineWidth = 0.04 * r
        ctx.beginPath()
        ctx.arc(E.x, E.y, 0.59 * r, start, end)
        ctx.stroke()
        ctx.globalAlpha = fade
        ctx.fillStyle = 'rgb(255, 210, 90)'
        ctx.beginPath()
        const sparks = this.sparks
        for (let i = 0; i < sparks.length; i += 2) {
            const d = sparks[i + 1] * s * r
            const x = E.x + Math.cos(sparks[i]) * d, y = E.y + Math.sin(sparks[i]) * d
            ctx.moveTo(x + 0.04 * r, y)
            ctx.arc(x, y, 0.04 * r, 0, 2 * Math.PI)
        }
        ctx.fill()
        ctx.globalAlpha = 1
    }
    // '-N' rising from the target, u in (0, 1].
    drawDamage(ctx, E, u, damage, r) {
        if (!(u > 0 && u <= 1))
            return
        ctx.globalAlpha = u < 0.6 ? 1 : (1 - u) / 0.4
        ctx.font = `bold ${Math.round(0.4 * r)}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 0.08 * r
        ctx.strokeStyle = 'rgb(40, 0, 0)'
        ctx.fillStyle = 'rgb(255, 60, 40)'
        const text = '-' + damage, y = E.y - (0.4 + 0.5 * u) * r
        ctx.strokeText(text, E.x, y)
        ctx.fillText(text, E.x, y)
        ctx.globalAlpha = 1
    }
}

// The one instance the hooks call.
const attackFx = new AttackFx()
