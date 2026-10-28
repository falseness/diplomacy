// Attack animations (TASK-1421, concept B 'hop & slash'), UI only: the rules resolve the attack at once (hp, kill,
// the attacker's moves and coord change in Unit.sendInstructions as before); only the drawing animates, as moveTween
// does for moves. Input is never blocked: nothing waits for an effect; a second attack queues its own effect.
// Melee: the attacker hops toward the target in an arc and back, a white slash with gold sparks crosses the target,
// a red flash, '-N' floats up. Last hit: after the slash the target (a snapshot of its sprite: it is already gone
// in the rules) greys, falls back in a dust puff and fades; an attacker that moved into the hex slides in after it.
// While an effect plays its attacker is left out of the grid's unit passes (Grid.getStillUnit) and drawn here, and
// frames are drawn live (zoomRasterTweens: no held, still or zoom raster frame), the board cache is not rebuilt.
// Ranged (TASK-1422): an archer draws back and an arrow arcs with a short trail, sparks and a knock-back on the hit
// (B2-archer); an ember archer's bow glows and a burning arrow trails embers, small flames on the hit (B3-ember-archer);
// a hexcaster gathers violet sparks, a wobbling orb flies, a hex sigil spins on the target's ground (B3-hexcaster). A
// ranged last hit falls and fades like the melee one; a shot building flashes in place. A unit target that lives is
// left out of the grid's unit passes too while the effect plays (drawn here, knocked back).
// Plain canvas code: paths, arcs, ellipses, the cached unit sprites (and one tinted copy per sprite, made once);
// no shadowBlur, filters or new assets. Off when otherSettings.animateAttacks is false (no effect is queued).
// API: play(event), draw(ctx, now), isActive(), clear(); the hooks call before(unit, cell) / after(snapshot).
// Removing this file and its guarded calls leaves the game as it was.
class AttackFx {
    // Most effects playing at once: a new one drops the oldest.
    maxEffects = 12
    // ms per kind.
    durations = {melee: 650, lasthit: 700, archer: 650, ember: 650, hexcaster: 650}
    // Concept time units an effect's duration covers (the last hit runs on to the captured hex's pulse).
    spans = {melee: 1, lasthit: 1.3, archer: 1, ember: 1, hexcaster: 1}
    // Ranged kinds (concept time units): the shot lands at hit; the shooter draws back pull r; a unit target is knocked
    // back kb r and tinted (tint, alpha, fade span); '-N' rises from text over textSpan; a last hit falls from hit + 0.15
    // for 0.35 (the ember archer's runs on to 1.05: its duration grows with it). An arrow leaves muzzle r (ahead toward
    // the target, down) from the shooter's centre.
    ranged = {
        archer: {hit: 0.5, pull: 0.07, kb: 0.1, tint: 'red', tintAlpha: 0.55, tintSpan: 0.25, text: 0.5, textSpan: 0.48, muzzle: [0.3, 0.05]},
        ember: {hit: 0.55, pull: 0.06, kb: 0.1, tint: 'orange', tintAlpha: 0.55, tintSpan: 0.3, text: 0.57, textSpan: 0.42, muzzle: [0.45, 0.1]},
        hexcaster: {hit: 0.5, pull: 0, kb: 0, tint: 'violet', tintAlpha: 0.6, tintSpan: 0.3, text: 0.52, textSpan: 0.46}
    }
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
    // Ember archer particles, made once: the trail's 40 embers (age offset in q, sideways drift in r, radius in r) and the
    // hit's 16 sparks (direction, reach in r).
    embers = (() => {
        let seed = 9
        const random = (a, b) => a + (b - a) * (seed = (seed * 16807) % 2147483647) / 2147483647
        const trail = new Float32Array(120), burst = new Float32Array(32)
        for (let i = 0; i < 120; i += 3) {
            trail[i] = random(-0.06, 0)
            trail[i + 1] = random(-0.06, 0.06)
            trail[i + 2] = random(0.02, 0.05)
        }
        for (let i = 0; i < 32; i += 2) {
            burst[i] = random(-Math.PI, 0)
            burst[i + 1] = random(0.4, 1.2)
        }
        return {trail, burst}
    })()
    // A point of an arc (reused).
    point = {x: 0, y: 0}
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
            ranged: !!this.ranged[this.kindOf(unit)], unit: target.unit, unitHp: target.unit?.hp, unitPos: target.unit && {x: target.unit.pos.x, y: target.unit.pos.y},
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
        // A ranged hit's living unit target is drawn by the effect (knocked back).
        const targetUnit = s.ranged && target.unit && !target.killed ? s.unit : null
        return this.play({kind: this.kindOf(attacker), attacker, image: s.image, from: s.from, fromPos: s.fromPos,
            to: {x: attacker.coord.x, y: attacker.coord.y}, target: coord, targetPos: target.pos, targetImage: target.image,
            targetIsUnit: target.unit, targetUnit, damage: target.damage, killed: target.killed})
    }
    // The effect kind of an attacker's hits; null: none (siege kinds come with TASK-1423). The demon variants extend
    // Archer: they are picked first.
    kindOf(unit) {
        if (typeof EmberArcher !== 'undefined' && unit instanceof EmberArcher)
            return 'ember'
        if (typeof Hexcaster !== 'undefined' && unit instanceof Hexcaster)
            return 'hexcaster'
        if (typeof Archer !== 'undefined' && unit instanceof Archer)
            return 'archer'
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
    // event: {kind, attacker, image, from, fromPos, to, target, targetPos, targetImage, targetIsUnit, targetUnit, damage,
    // killed}; targetUnit: a living unit target the effect draws (ranged kinds).
    // Returns the queued effect, or null.
    play(event) {
        if (!this.enabled() || !event || !event.kind || !this.visible(event))
            return null
        const kind = event.kind === 'melee' && event.killed ? 'lasthit' : event.kind
        const style = this.ranged[kind]
        const span = style && event.killed && event.targetIsUnit ? Math.max(this.spans[kind], style.hit + 0.5) : this.spans[kind]
        const effect = {...event, kind, span, startTime: this.now(), duration: Math.round(this.durations[kind] * span / this.spans[kind])}
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
    // Whether unit is drawn by an effect (left out of the grid's unit passes): its attacker, or a ranged hit's living
    // unit target while it stays on the target cell.
    hidesUnit(unit) {
        if (!this.effects.length)
            return false
        for (const e of this.effects)
            if ((e.attacker === unit || this.drawsTarget(e) && e.targetUnit === unit) && this.now() - e.startTime < e.duration)
                return true
        return false
    }
    drawsTarget(e) {
        return !!e.targetUnit && !e.targetUnit.killed && grid.getUnit(e.target) === e.targetUnit
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
            const time = Math.min(1, (now - e.startTime) / e.duration) * e.span
            if (this.ranged[e.kind])
                this.drawRanged(ctx, e, time, lod)
            else
                this.drawMelee(ctx, e, time, lod)
            ctx.restore()
        }
    }
    ease(t) {
        return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
    }
    // Tinted copies of a sprite: red (flash) and grey with a dark red cast (a dying unit); orange and violet (ranged
    // demon hits) made on first use.
    tinted(image, name) {
        let tint = this.tints.get(image)
        if (tint) {
            if (name && !tint[name])
                tint[name] = this.tintCopy(image, this.tintColors[name])
            return tint
        }
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
        return name ? this.tinted(image, name) : tint
    }
    tintColors = {red: 'rgb(255, 40, 30)', orange: 'rgb(255, 110, 20)', violet: 'rgb(150, 40, 220)'}
    tintCopy(image, color) {
        const c = document.createElement('canvas')
        c.width = image.width
        c.height = image.height
        const g = c.getContext('2d')
        g.drawImage(image, 0, 0)
        g.globalCompositeOperation = 'source-atop'
        g.fillStyle = color
        g.fillRect(0, 0, c.width, c.height)
        return c
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
        else
            this.drawDying(ctx, e, time, 0.3, 0.45, E, vx * 0.12, vy * 0.12, tint)
        // The attacker over the target, its bars with it (but in a level-of-detail frame).
        this.drawUnitAt(ctx, e.attacker, e.image, e.fromPos.x + vx * k, e.fromPos.y + vy * k + hop, lod)
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
    // A killed target (from its sprite's snapshot): shown until fallAt, flashing red from hitAt; then it greys, falls back
    // (drifting dx, dy per unit of s) in a dust puff and fades over 0.35.
    drawDying(ctx, e, time, hitAt, fallAt, E, dx, dy, tint) {
        const r = basis.r
        if (time < fallAt) {
            if (e.targetImage) {
                ctx.drawImage(e.targetImage, e.targetPos.x, e.targetPos.y)
                if (time >= hitAt && tint) {
                    ctx.globalAlpha = 0.55 * (time - hitAt) / 0.15
                    ctx.drawImage(tint.red, e.targetPos.x, e.targetPos.y)
                    ctx.globalAlpha = 1
                }
            }
        }
        else if (time < fallAt + 0.35) {
            const s = (time - fallAt) / 0.35
            const foot = {x: E.x, y: E.y + 0.7 * r}
            if (tint) {
                ctx.save()
                ctx.globalAlpha = 1 - this.ease(s)
                ctx.translate(foot.x + dx * s, foot.y + dy * s + 0.1 * r * s)
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
    }
    // A unit's sprite at x, y with its bars moved along (no bars in a level-of-detail frame).
    drawUnitAt(ctx, unit, image, x, y, lod) {
        if (!image)
            return
        if (!lod && unit.drawBars) {
            ctx.save()
            ctx.translate(x - unit.pos.x, y - unit.pos.y)
            unit.drawBars(ctx)
            ctx.restore()
        }
        ctx.drawImage(image, x, y)
    }
    // The point q of the shot's arc from S to T, height h at its middle (into this.point).
    arc(S, T, h, q) {
        this.point.x = S.x + (T.x - S.x) * q
        this.point.y = S.y + (T.y - S.y) * q - h * Math.sin(Math.PI * q)
        return this.point
    }
    // Ranged hits (B2-archer, B3-ember-archer, B3-hexcaster), t in concept time units ([0, 1], a last hit [0, max(1,
    // hit + 0.5)]); sizes in r as drawMelee. The shooter draws back (a hexcaster rises), the shot flies, lands at hit.
    drawRanged(ctx, e, t, lod) {
        const r = basis.r, half = assets.size / 2, style = this.ranged[e.kind], hit = style.hit
        const A = {x: e.fromPos.x + half, y: e.fromPos.y + half}
        const E = {x: e.targetPos.x + half, y: e.targetPos.y + half}
        const vx = E.x - A.x, vy = E.y - A.y, dist = Math.hypot(vx, vy) || 1
        const ux = vx / dist, uy = vy / dist
        const tint = e.targetImage && this.tinted(e.targetImage, style.tint)
        // The target: a living unit (drawn here) knocked back and flashing, a dying one falling, a building flashing.
        const flash = t >= hit && t < hit + style.tintSpan ? style.tintAlpha * (1 - (t - hit) / style.tintSpan) : 0
        if (e.killed && e.targetIsUnit)
            this.drawDying(ctx, e, t, hit, hit + 0.15, E, ux * 0.21 * r, uy * 0.21 * r, tint)
        else {
            let x = e.targetPos.x, y = e.targetPos.y
            const living = this.drawsTarget(e)
            if (living && t >= hit && t < hit + 0.2) {
                const kb = style.kb * r * Math.sin(Math.PI * (t - hit) / 0.2)
                x += ux * kb
                y += uy * kb
            }
            if (living)
                this.drawUnitAt(ctx, e.targetUnit, e.targetImage, x, y, lod)
            else if (e.killed && e.targetImage && t < hit + 0.3) {
                // A destroyed building's snapshot fades after the hit.
                ctx.globalAlpha = t < hit ? 1 : 1 - (t - hit) / 0.3
                ctx.drawImage(e.targetImage, x, y)
                ctx.globalAlpha = 1
            }
            // (a destroyed building's flash fades with its snapshot)
            const shown = !e.killed || living ? 1 : Math.max(0, 1 - (t - hit) / 0.3)
            if (flash && tint && shown) {
                ctx.globalAlpha = flash * shown
                ctx.drawImage(tint[style.tint], x, y)
                ctx.globalAlpha = 1
            }
        }
        // The shooter.
        let dx = 0, dy = 0
        if (e.kind === 'hexcaster')
            dy = t < 0.3 ? -0.06 * r * Math.sin(Math.PI * t / 0.3) : 0
        else {
            const pull = style.pull * r * (t < 0.2 ? this.ease(t / 0.2) : t < 0.26 ? 1 - this.ease((t - 0.2) / 0.06) : 0)
            dx = -ux * pull
            dy = -uy * pull
        }
        this.drawUnitAt(ctx, e.attacker, e.image, e.fromPos.x + dx, e.fromPos.y + dy, lod)
        if (e.kind === 'hexcaster')
            this.drawHexcaster(ctx, t, A, E, ux, uy, dy, r)
        else {
            const [ahead, down] = style.muzzle
            const S = {x: A.x + ux * ahead * r, y: A.y + uy * ahead * r + down * r}
            const T = {x: E.x - ux * 0.1 * r, y: E.y - uy * 0.1 * r + 0.05 * r}
            if (e.kind === 'ember')
                this.drawEmber(ctx, t, S, T, 0.26 * dist, r)
            else
                this.drawArrow(ctx, t, S, T, 0.26 * dist, E, r)
        }
        this.drawDamage(ctx, E, (t - style.text) / style.textSpan, e.damage, r)
    }
    // The arrow: flies S -> T on [0.22, 0.5) with a short white trail; sparks burst from the target on [0.48, 0.66).
    drawArrow(ctx, t, S, T, h, E, r) {
        if (t >= 0.22 && t < 0.5) {
            const p = (t - 0.22) / 0.28, q = this.ease(p) * 0.5 + p * 0.5
            for (let j = 1; j < 5; ++j) {
                const c = this.arc(S, T, h, Math.max(0, q - 0.025 * j))
                ctx.fillStyle = `rgba(255, 255, 255, ${((90 - 20 * j) / 255).toFixed(3)})`
                ctx.beginPath()
                ctx.arc(c.x, c.y, 0.02 * r, 0, 2 * Math.PI)
                ctx.fill()
            }
            this.drawShaft(ctx, S, T, h, q, r, 'rgb(70, 45, 20)', false)
        }
        if (t >= 0.48 && t < 0.66) {
            const s = (t - 0.48) / 0.18, sparks = this.sparks
            ctx.globalAlpha = 1 - s
            ctx.strokeStyle = 'rgb(255, 220, 120)'
            ctx.lineWidth = 0.03 * r
            ctx.lineCap = 'round'
            ctx.beginPath()
            for (let i = 0; i < 18; i += 2) {
                const d = sparks[i + 1] * 0.6 * s * r, cos = Math.cos(sparks[i]), sin = Math.sin(sparks[i])
                ctx.moveTo(E.x + cos * d, E.y + sin * d)
                ctx.lineTo(E.x + cos * (d + 0.1 * r), E.y + sin * (d + 0.1 * r))
            }
            ctx.stroke()
            ctx.globalAlpha = 1
        }
    }
    // An arrow's shaft at q of the arc: a plain steel head with red fletching, or (burning) a fire ball.
    drawShaft(ctx, S, T, h, q, r, shaft, burning) {
        const back = this.arc(S, T, h, Math.max(0, q - 0.02)), bx = back.x, by = back.y
        const c = this.arc(S, T, h, q), x = c.x, y = c.y
        const angle = Math.atan2(y - by, x - bx), ca = Math.cos(angle), sa = Math.sin(angle)
        const tail = {x: x - ca * 0.38 * r, y: y - sa * 0.38 * r}
        ctx.lineCap = 'butt'
        ctx.strokeStyle = shaft
        ctx.lineWidth = 0.04 * r
        ctx.beginPath()
        ctx.moveTo(tail.x, tail.y)
        ctx.lineTo(x, y)
        ctx.stroke()
        if (burning) {
            ctx.fillStyle = 'rgba(255, 150, 30, 0.3)'
            ctx.beginPath()
            ctx.arc(x, y, 0.15 * r, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'rgba(255, 170, 40, 0.9)'
            ctx.beginPath()
            ctx.arc(x, y, 0.09 * r, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'rgb(255, 250, 200)'
            ctx.beginPath()
            ctx.arc(x, y, 0.04 * r, 0, 2 * Math.PI)
            ctx.fill()
            return
        }
        ctx.fillStyle = 'rgb(200, 200, 210)'
        ctx.strokeStyle = 'rgb(40, 40, 40)'
        ctx.lineWidth = 0.01 * r
        ctx.beginPath()
        ctx.moveTo(x + ca * 0.1 * r, y + sa * 0.1 * r)
        ctx.lineTo(x - sa * 0.06 * r, y + ca * 0.06 * r)
        ctx.lineTo(x + sa * 0.06 * r, y - ca * 0.06 * r)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = 'rgb(230, 60, 40)'
        ctx.lineWidth = 0.03 * r
        ctx.beginPath()
        for (const sign of [1, -1]) {
            ctx.moveTo(tail.x, tail.y)
            ctx.lineTo(tail.x + ca * 0.09 * r - sign * sa * 0.07 * r, tail.y + sa * 0.09 * r + sign * ca * 0.07 * r)
        }
        ctx.stroke()
    }
    // The ember archer: the bow glows on [0, 0.24), a burning arrow flies on [0.22, 0.56) trailing embers; on the hit
    // (0.55) sparks burst and three small flames lick the target until 0.95.
    drawEmber(ctx, t, S, T, h, r) {
        if (t < 0.24) {
            ctx.fillStyle = 'rgba(255, 140, 30, 0.55)'
            ctx.beginPath()
            ctx.arc(S.x, S.y, (0.08 + 0.1 * t / 0.24) * r, 0, 2 * Math.PI)
            ctx.fill()
        }
        if (t >= 0.22 && t < 0.56) {
            const q = (t - 0.22) / 0.34, trail = this.embers.trail
            for (let i = 0; i < trail.length; i += 3) {
                const qq = q + trail[i] * 1.5
                if (qq < 0)
                    continue
                const age = -trail[i] / 0.06, c = this.arc(S, T, h, qq)
                ctx.fillStyle = `rgba(255, ${Math.round(200 - 150 * age)}, 40, ${(0.9 * (1 - age)).toFixed(3)})`
                ctx.beginPath()
                ctx.arc(c.x, c.y + trail[i + 1] * age * r, trail[i + 2] * r, 0, 2 * Math.PI)
                ctx.fill()
            }
            this.drawShaft(ctx, S, T, h, q, r, 'rgb(60, 30, 15)', true)
        }
        if (t >= 0.55 && t < 0.95) {
            const s = (t - 0.55) / 0.4, burst = this.embers.burst
            ctx.globalAlpha = 1 - s
            ctx.fillStyle = 'rgb(255, 200, 60)'
            ctx.beginPath()
            for (let i = 0; i < burst.length; i += 2) {
                const d = burst[i + 1] * this.ease(Math.min(1, s * 2)) * r
                const x = T.x + Math.cos(burst[i]) * d, y = T.y + Math.sin(burst[i]) * d + 0.6 * r * s * s
                ctx.moveTo(x + 0.03 * r, y)
                ctx.arc(x, y, 0.03 * r, 0, 2 * Math.PI)
            }
            ctx.fill()
            // The flames flicker with time (the concept's per frame sine: frame = 39 t).
            for (let j = 0; j < 3; ++j) {
                const fx = T.x + (j - 1) * 0.25 * r, base = T.y + 0.4 * r
                const fh = (0.22 + 0.1 * Math.sin(39 * t * 1.3 + j)) * r * (1 - s)
                ctx.fillStyle = `rgb(255, ${120 + 40 * j}, 20)`
                ctx.beginPath()
                ctx.moveTo(fx - 0.09 * r, base)
                ctx.lineTo(fx + 0.09 * r, base)
                ctx.lineTo(fx, base - fh)
                ctx.closePath()
                ctx.fill()
            }
            ctx.globalAlpha = 1
        }
    }
    // The hexcaster: violet sparks gather on the staff on [0, 0.32), a wobbling orb flies on [0.3, 0.52), a spinning hex
    // sigil brands the target's ground on [0.5, 0.95) with a flash ring on its first 0.3.
    drawHexcaster(ctx, t, A, E, ux, uy, lift, r) {
        const O = {x: A.x + ux * 0.6 * r, y: A.y + uy * 0.6 * r - 0.5 * r + lift}
        if (t < 0.32) {
            const k = t / 0.32
            ctx.fillStyle = 'rgba(190, 90, 255, 0.25)'
            ctx.beginPath()
            ctx.arc(O.x, O.y, (0.1 + 0.32 * k) * r, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'rgba(190, 90, 255, 0.6)'
            ctx.beginPath()
            ctx.arc(O.x, O.y, (0.06 + 0.22 * k) * r, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = 'rgba(230, 180, 255, 0.86)'
            ctx.beginPath()
            for (let j = 0; j < 6; ++j) {
                const angle = j + t * 20, d = 0.5 * r * (1 - k)
                const x = O.x + Math.cos(angle) * d, y = O.y + Math.sin(angle) * d
                ctx.moveTo(x + 0.03 * r, y)
                ctx.arc(x, y, 0.03 * r, 0, 2 * Math.PI)
            }
            ctx.fill()
        }
        if (t >= 0.3 && t < 0.52) {
            const q = (t - 0.3) / 0.22
            for (let j = 5; j >= 0; --j) {
                const qq = Math.max(0, q - 0.05 * j)
                const x = O.x + (E.x - O.x) * qq, y = O.y + (E.y - O.y) * qq + 0.08 * r * Math.sin(qq * 25)
                ctx.fillStyle = `rgba(170, 70, 255, ${((200 - 30 * j) / 255).toFixed(3)})`
                ctx.beginPath()
                ctx.arc(x, y, (0.13 - 0.02 * j) * r * (j ? 1 : 1.5), 0, 2 * Math.PI)
                ctx.fill()
            }
            const x = O.x + (E.x - O.x) * q, y = O.y + (E.y - O.y) * q + 0.08 * r * Math.sin(q * 25)
            ctx.fillStyle = 'rgb(245, 225, 255)'
            ctx.beginPath()
            ctx.arc(x, y, 0.07 * r, 0, 2 * Math.PI)
            ctx.fill()
        }
        if (t >= 0.5 && t < 0.95) {
            const s = (t - 0.5) / 0.45, alpha = s < 0.6 ? 1 : (1 - s) / 0.4
            const R = (0.55 + 0.15 * Math.min(1, s * 3)) * r, rot = s * 2, cy = E.y + 0.55 * r
            const hex = j => [E.x + R * Math.cos(rot + Math.PI / 3 * j), cy + R * 0.45 * Math.sin(rot + Math.PI / 3 * j)]
            ctx.lineJoin = 'round'
            // A wide faint stroke under the sigil stands in for the concept's glow.
            for (const [width, colour, a] of [[0.12, '200, 120, 255', 0.3], [0.04, '200, 120, 255', 1]]) {
                ctx.strokeStyle = `rgba(${colour}, ${(a * alpha).toFixed(3)})`
                ctx.lineWidth = width * r
                ctx.beginPath()
                for (let j = 0; j < 6; ++j)
                    ctx.lineTo(...hex(j))
                ctx.closePath()
                ctx.stroke()
            }
            ctx.strokeStyle = `rgba(220, 160, 255, ${Math.min(1, alpha / 2 + 40 / 255).toFixed(3)})`
            ctx.lineWidth = 0.02 * r
            ctx.beginPath()
            for (let j = 0; j < 2; ++j) {
                ctx.moveTo(...hex(j))
                ctx.lineTo(...hex(j + 2))
                ctx.lineTo(...hex(j + 4))
                ctx.closePath()
            }
            ctx.stroke()
            if (s < 0.3) {
                ctx.strokeStyle = `rgba(230, 190, 255, ${(1 - s / 0.3).toFixed(3)})`
                ctx.lineWidth = 0.05 * r
                ctx.beginPath()
                ctx.arc(E.x, E.y, (0.4 + 0.6 * s / 0.3) * r, 0, 2 * Math.PI)
                ctx.stroke()
            }
        }
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
