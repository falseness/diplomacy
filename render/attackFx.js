// Attack animations (TASK-1421, concept B 'hop & slash'), UI only: the rules resolve the attack at once (hp, kill,
// the attacker's moves and coord change in Unit.sendInstructions as before); only the drawing animates, as moveTween
// does for moves. Input is never blocked: nothing waits for an effect; a second attack queues its own effect.
// Melee: the attacker hops toward the target in an arc and back, a white slash with gold sparks crosses the target,
// a red flash, '-N' floats up. Last hit: after the slash the target (a snapshot of its sprite: it is already gone
// in the rules) greys, falls back in a dust puff and fades; an attacker that moved into the hex slides in after it.
// While an effect plays its attacker is left out of the grid's unit passes (Grid.getStillUnit) and drawn here. Effects
// draw over the board's frame (drawMain, TASK-1425): a held still or level-of-detail frame stays held (one drawImage of
// its snapshot, taken before the effects), a zoom gesture keeps its raster; no frame is drawn live for an effect and the
// board cache is not rebuilt for one: a finished effect keeps its units (drawn in place, as the board draws them) until
// the board changes anyway (the next attack, the unit moving or dying, the turn's end), so they leave and rejoin the
// board's frame only in frames an attack redraws already.
// Ranged (TASK-1422): an archer draws back and an arrow arcs with a short trail, sparks and a knock-back on the hit
// (B2-archer); an ember archer's bow glows and a burning arrow trails embers, small flames on the hit (B3-ember-archer);
// a hexcaster gathers violet sparks, a wobbling orb flies, a hex sigil spins on the target's ground (B3-hexcaster). A
// ranged last hit falls and fades like the melee one; a shot building flashes in place. A unit target that lives is
// left out of the grid's unit passes too while the effect plays (drawn here, knocked back).
// Siege (TASK-1423): a catapult recoils and lobs a boulder high with its shadow along the ground, the impact flashes,
// raises dust and debris (B2-catapult); a bombard fires a flat cannonball with a muzzle flash and smoke, a fireball and
// smoke on the impact (B3-bombard); a mortar shoots up a red-hot shell lobbed high, a large explosion with a shockwave
// ring (B3-mortar). '-N' rises from the building (none for a 0-hp town only marked hit); a destroyed building collapses
// from its snapshot in the dust. Only the impact (and a collapsing snapshot) shakes, never the view. A shot into a cell
// fogged for the screen's player lands with a muffled grey puff and nothing else: the effect keeps no target data.
// Plain canvas code: paths, arcs, ellipses, the cached unit sprites (and one tinted copy per sprite, made once);
// no shadowBlur, filters or new assets. Off when otherSettings.animateAttacks is false (no effect is queued).
// Others' attacks (TASK-1424): AI players and the demon turn act through the same unit code (the same hooks); an online
// opponent's attack is read from the server's change (remoteBefore / remoteAfter around applyCellDiff). The rules never
// wait for an effect. Such an effect plays only for what the screen's player sees (grid.fogOfWar): both cells -> the
// whole effect; only the target -> the shot enters from the fog edge on the line from the attacker (melee: only the hit
// on the target); only the attacker -> the shot leaves toward the target and ends at the fog edge with no result (the
// effect keeps no target data); neither -> nothing. It starts once the pass-device screen is gone, and a new viewer (hot
// seat with fog: the next human's view) drops the effects queued for the last one. The AI turn itself only stores
// the hooks' events (queue); they become effects on the first frame drawn (flush).
// API: play(event), draw(ctx, now), isActive(), clear(); the hooks call before(unit, cell) / after(snapshot),
// remoteBefore(cells) / remoteAfter(snapshot), endTurn(), setViewer(slot) and flush().
// Removing this file and its guarded calls leaves the game as it was.
class AttackFx {
    // Most effects playing at once: a new one drops the oldest.
    maxEffects = 12
    // Whether the effect code's warm-up was scheduled (scheduleWarmUp: once a page).
    static warm = false
    // ms per kind.
    durations = {melee: 650, lasthit: 700, archer: 650, ember: 650, hexcaster: 650, catapult: 700, bombard: 650, mortar: 700}
    // Concept time units an effect's duration covers (the last hit runs on to the captured hex's pulse).
    spans = {melee: 1, lasthit: 1.3, archer: 1, ember: 1, hexcaster: 1, catapult: 1, bombard: 1, mortar: 1}
    // Ranged kinds (concept time units): the shot lands at hit; the shooter draws back pull r; a unit target is knocked
    // back kb r and tinted (tint, alpha, fade span); '-N' rises from text over textSpan; a last hit falls from hit + 0.15
    // for 0.35 (the ember archer's runs on to 1.05: its duration grows with it). An arrow leaves muzzle r (ahead toward
    // the target, down) from the shooter's centre.
    ranged = {
        archer: {hit: 0.5, pull: 0.07, kb: 0.1, tint: 'red', tintAlpha: 0.55, tintSpan: 0.25, text: 0.5, textSpan: 0.48, muzzle: [0.3, 0.05]},
        ember: {hit: 0.55, pull: 0.06, kb: 0.1, tint: 'orange', tintAlpha: 0.55, tintSpan: 0.3, text: 0.57, textSpan: 0.42, muzzle: [0.45, 0.1]},
        hexcaster: {hit: 0.5, pull: 0, kb: 0, tint: 'violet', tintAlpha: 0.6, tintSpan: 0.3, text: 0.52, textSpan: 0.46}
    }
    // Siege kinds (concept time units): the shot leaves at fly0 and lands at fly1, its arc's height is height of the
    // distance; it leaves muzzle r (ahead toward the target, down) from the shooter's centre; the shooter recoils recoil
    // r away (mortar: partly down) on [fly0, fly0 + 0.15); the impact shakes shake r (concept frames: frames).
    siege = {
        catapult: {fly0: 0.18, fly1: 0.6, height: 0.43, muzzle: [-0.2, -0.55], recoil: 0.1, shake: 0.09, shakeSpan: 0.3, frames: 46},
        bombard: {fly0: 0.2, fly1: 0.45, height: 0.23, muzzle: [0.5, -0.45], recoil: 0.14, shake: 0.08, shakeSpan: 0.35, frames: 40},
        mortar: {fly0: 0.2, fly1: 0.6, height: 0.52, muzzle: [0, -0.58], recoil: 0.14, shake: 0.14, shakeSpan: 0.35, frames: 50}
    }
    // Siege debris, made once: direction, reach (in r), half size (in r).
    debris = (() => {
        let seed = 7
        const random = (a, b) => a + (b - a) * (seed = (seed * 16807) % 2147483647) / 2147483647
        const debris = new Float32Array(54)
        for (let i = 0; i < 54; i += 3) {
            debris[i] = random(-Math.PI, 0)
            debris[i + 1] = random(0.8, 2.2)
            debris[i + 2] = random(0.03, 0.07)
        }
        return debris
    })()
    effects = []
    // The units effects draw, bars and sprite as one image each (drawUnitImage): unit -> {image, bars state, scale, canvas}; the
    // canvases' pool.
    barImages = new WeakMap()
    barPool = new Array(32)
    barNext = 0
    // Unit images made in this frame (draw resets it): at most imageBudget a frame, the others drawn directly until a later
    // frame makes theirs; none in the frame drawn after a batch of others' attacks started (flush: the board changed with
    // the turn and draws live in that frame), so a turn's batch never makes its images in its own first frame (TASK-1425).
    imagesMade = 0
    imageBudget = 2
    // Tinted copies made in this frame ahead of the effects' hits (prepareTint), as imagesMade.
    tintsMade = 0
    tintBudget = 1
    // Canvases made ready in idle time (fillPools) for tinted copies.
    spares = []
    batchFrame = false
    // The units the effects draw (hideUnits).
    hidden = new Set()
    // The camera at the last prune (offset and scale), to tell a pan.
    camera = {x: NaN, y: NaN, scale: NaN}
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
    // Counters for tests and evidence: queued, dropped by the cap, others' attacks cut to a fog edge or not seen at all.
    stats = {queued: 0, dropped: 0, edge: 0, unseen: 0}
    // The slot whose view (fog) the queued effects were made for.
    viewer = null
    // The fog of the local human whose turn ended (offline), kept until the next view is set: an AI or demon unit's move
    // adds its own vision to grid.fogOfWar during its turn, so others' attacks are judged by this copy.
    view = null
    enabled() {
        return typeof otherSettings === 'undefined' || otherSettings.animateAttacks !== false
    }
    // The target cell's enemy unit and building with their hp, before unit acts on cell; null when no effect can
    // come of it (off, no enemy there, a kind of attacker with no effect).
    before(unit, cell) {
        if (!this.enabled() || !cell || !unit || unit.isEmpty())
            return null
        const kind = this.kindOf(unit)
        if (!kind)
            return null
        if (this.siege[kind])
            return this.beforeSiege(unit, cell)
        const colour = unit.playerColor
        const targetUnit = this.enemyOf(cell.unit, colour), building = this.enemyOf(cell.building, colour)
        if (!targetUnit && !building)
            return null
        // (the attacker's sprite: read when the effect is made, it stays alive; the target's now, it may die)
        return {attacker: unit, from: {x: unit.coord.x, y: unit.coord.y}, fromPos: {x: unit.pos.x, y: unit.pos.y},
            image: undefined, coord: {x: cell.hexagon.coord.x, y: cell.hexagon.coord.y},
            ranged: !!this.ranged[kind], unit: targetUnit, unitHp: targetUnit?.hp, unitPos: targetUnit && {x: targetUnit.pos.x, y: targetUnit.pos.y},
            unitImage: targetUnit && this.imageOf(targetUnit),
            building, buildingHp: building?.hp,
            buildingPos: building && {x: building.pos.x, y: building.pos.y},
            buildingImage: building && this.imageOf(building)}
    }
    // entity when it is an enemy of colour with hp (not nature), else null.
    enemyOf(entity, colour) {
        return entity && entity.notEmpty() && entity.hp !== undefined && entity.playerColor !== colour && !entity.isNature ? entity : null
    }
    // A siege shot's snapshot: the shooter's moves and the target building; a cell fogged for the screen's player (the
    // shot takes the fog branch) keeps nothing of what is there.
    beforeSiege(unit, cell) {
        const coord = {x: cell.hexagon.coord.x, y: cell.hexagon.coord.y}
        const fog = typeof isFogOfWar !== 'undefined' && isFogOfWar && !!grid.fogOfWar && !this.seen(coord)
        const building = !fog && cell.building && cell.building.notEmpty() && cell.building.hp !== undefined &&
            cell.building.playerColor !== unit.playerColor && !cell.building.isNature ? cell.building : null
        const p = cell.hexagon.calcPos()
        return {siege: true, fog, attacker: unit, moves: unit.moves, from: {x: unit.coord.x, y: unit.coord.y},
            fromPos: {x: unit.pos.x, y: unit.pos.y}, image: undefined, coord,
            targetPos: {x: p.x - assets.size / 2, y: p.y - assets.size / 2},
            building, buildingHp: building?.hp, buildingImage: building && this.imageOf(building)}
    }
    // After a siege shot (the shooter stayed and spent moves): the effect, with the building's hp lost, destroyed or (a
    // 0-hp town only marked hit) no number; a fog shot's effect has no target fields at all.
    afterSiege(s) {
        const a = s.attacker
        if (a.killed || a.coord.x !== s.from.x || a.coord.y !== s.from.y || !(a.moves < s.moves))
            return false
        const event = {kind: this.kindOf(a), attacker: a, own: this.isOwn(a), image: s.image, from: s.from, fromPos: s.fromPos,
            to: s.from, target: s.coord, targetPos: s.targetPos}
        if (s.fog) {
            event.fog = true
            return this.queue(event)
        }
        const b = s.building, killed = !!b && grid.getBuilding(s.coord) !== b
        event.targetImage = s.buildingImage
        event.targetIsUnit = false
        event.damage = b ? Math.max(0, s.buildingHp - (killed ? 0 : b.hp)) : 0
        event.killed = killed
        return this.queue(event)
    }
    // After the action: plays the effect of a hit on the snapshot's unit or building (hp lost or killed).
    after(snapshot) {
        if (!snapshot)
            return false
        if (snapshot.siege)
            return this.afterSiege(snapshot)
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
        return this.queue({kind: this.kindOf(attacker), attacker, own: this.isOwn(attacker), image: s.image, from: s.from, fromPos: s.fromPos,
            to: {x: attacker.coord.x, y: attacker.coord.y}, target: coord, targetPos: target.pos, targetImage: target.image,
            targetIsUnit: target.unit, targetUnit, damage: target.damage, killed: target.killed})
    }
    // Whether unit belongs to a local human (its own attack: shown whole, from the turn's start; online, only the local
    // player's units act here). AI players, demons and neutrals are other classes than Player.
    isOwn(unit) {
        return typeof players === 'undefined' || players[unit.playerColor]?.constructor === Player
    }
    // An online change's cells before applyCellDiff (records: the diff's cells): their units with hp and moves, buildings
    // with hp, and whether the screen's player saw each cell.
    remoteBefore(records) {
        if (!this.enabled() || !Array.isArray(records))
            return null
        const cells = []
        for (const record of records) {
            const cell = grid.arr[record.x]?.[record.y]
            if (!cell)
                continue
            const coord = {x: record.x, y: record.y}
            const unit = cell.unit.notEmpty() ? cell.unit : null, building = cell.building.notEmpty() && cell.building.hp !== undefined &&
                !cell.building.isNature ? cell.building : null
            // (owners before: a unit's colour is its hexagon's, which a capture repaints)
            cells.push({coord, seen: this.seen(coord), unit, owner: unit?.playerColor, buildingOwner: building?.playerColor, hp: unit?.hp, moves: unit?.moves, pos: unit && {x: unit.pos.x, y: unit.pos.y},
                image: unit && this.imageOf(unit), building, buildingHp: building?.hp,
                buildingPos: building && {x: building.pos.x, y: building.pos.y}, buildingImage: building && this.imageOf(building)})
        }
        return cells
    }
    // After applyCellDiff: an attack in the change (a unit or building that lost hp or was killed) plays its effect. Its
    // attacker is the enemy unit of the change that spent moves nearest the target (unknown: its cell is not in the change,
    // then only the hit plays). A cell counts as seen when it was seen before or after the change.
    remoteAfter(before) {
        if (!before)
            return []
        const played = []
        for (const cell of before) {
            const coord = cell.coord
            let target = null
            // (a unit gone from its cell but not killed moved: no target)
            if (cell.unit && (cell.unit.killed || grid.getUnit(coord) === cell.unit && cell.unit.hp < cell.hp)) {
                const killed = !!cell.unit.killed
                target = {owner: cell.owner, killed, damage: cell.hp - (killed ? 0 : cell.unit.hp), pos: cell.pos,
                    image: cell.image, isUnit: true, unit: cell.unit}
            }
            else if (cell.building && (grid.getBuilding(coord) !== cell.building || cell.building.hp < cell.buildingHp)) {
                const killed = grid.getBuilding(coord) !== cell.building
                target = {owner: cell.buildingOwner, killed, damage: cell.buildingHp - (killed ? 0 : cell.building.hp),
                    pos: cell.buildingPos, image: cell.buildingImage, isUnit: false}
            }
            if (!target || !(target.damage > 0))
                continue
            let source = null, best = Infinity
            for (const other of before) {
                const u = other.unit
                if (!u || other === cell || u.killed || other.owner === target.owner || !(u.moves < other.moves))
                    continue
                const d = Math.hypot(other.coord.x - coord.x, other.coord.y - coord.y)
                if (d < best) {
                    best = d
                    source = other
                }
            }
            const seenTo = cell.seen || this.seen(coord)
            let event
            if (source) {
                const a = source.unit, kind = this.kindOf(a)
                if (!kind)
                    continue
                const to = {x: a.coord.x, y: a.coord.y}
                event = {kind, attacker: a, image: source.image, from: source.coord, fromPos: source.pos, to, target: coord,
                    targetPos: target.pos, targetImage: target.image, targetIsUnit: target.isUnit,
                    targetUnit: this.ranged[kind] && target.isUnit && !target.killed ? target.unit : null,
                    damage: target.damage, killed: target.killed,
                    seen: {from: source.seen || this.seen(source.coord), to: seenTo}}
            }
            else
                // An unseen attacker: only the hit on the target.
                event = {kind: 'melee', attacker: null, image: null, from: null, fromPos: target.pos, to: null, target: coord,
                    targetPos: target.pos, targetImage: target.image, targetIsUnit: target.isUnit, targetUnit: null,
                    damage: target.damage, killed: target.killed, seen: {from: false, to: seenTo}}
            const effect = this.play(event)
            if (!effect)
                continue
            played.push(effect)
            // A drawn attacker's move into the hex is the effect's (the hint's tween would draw it twice).
            if (effect.image && effect.attacker && (effect.to.x !== effect.from.x || effect.to.y !== effect.from.y) &&
                    typeof moveTween !== 'undefined')
                moveTween.cancel(effect.attacker)
        }
        return played
    }
    // The effect kind of an attacker's hits; null: none (cached per class: AI turns call it for every action).
    kindOf(unit) {
        const type = unit.constructor
        let kind = this.kinds.get(type)
        if (kind === undefined)
            this.kinds.set(type, kind = this.kindOfClass(unit))
        return kind
    }
    kinds = new Map()
    // The demon variants extend Archer, Mortar extends Bombard extends Catapult: they are picked first.
    kindOfClass(unit) {
        if (typeof Mortar !== 'undefined' && unit instanceof Mortar)
            return 'mortar'
        if (typeof Bombard !== 'undefined' && unit instanceof Bombard)
            return 'bombard'
        if (typeof Catapult !== 'undefined' && unit instanceof Catapult)
            return 'catapult'
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
    // Whether the screen's player sees coord: no fog, or in vision (and not an unknown cell).
    seen(coord) {
        if (!coord || typeof grid === 'undefined')
            return false
        if (grid.arr?.[coord.x]?.[coord.y]?.hexagon?.unknown)
            return false
        return typeof isFogOfWar === 'undefined' || !isFogOfWar || Boolean((this.view || grid.fogOfWar)?.[coord.x]?.[coord.y])
    }
    // What of an attack the screen's player sees: 'both', 'target', 'attacker' or null (nothing). Own attacks are seen
    // whole (a fog shot is the player's own aim); others' by the cells in vision (event.seen: given by remoteAfter).
    visibility(event) {
        if (event.own)
            return 'both'
        const from = event.seen ? event.seen.from : this.seen(event.from)
        const to = event.seen ? event.seen.to : !event.fog && this.seen(event.target)
        return from && to ? 'both' : to ? 'target' : from ? 'attacker' : null
    }
    // The point (top-left pos, as unit.pos) where the line between the cells' centres from seen to hidden crosses into
    // the fog: halfway between the last sample in a seen cell and the first in a hidden one (the nearest cell centre).
    fogEdge(seenCoord, hiddenCoord) {
        const half = assets.size / 2
        const centre = c => {
            const p = grid.arr[c.x][c.y].hexagon.calcPos()
            return {x: p.x, y: p.y}
        }
        const S = centre(seenCoord), H = centre(hiddenCoord)
        const cells = []
        for (let x = Math.min(seenCoord.x, hiddenCoord.x) - 1; x <= Math.max(seenCoord.x, hiddenCoord.x) + 1; ++x)
            for (let y = Math.min(seenCoord.y, hiddenCoord.y) - 1; y <= Math.max(seenCoord.y, hiddenCoord.y) + 1; ++y)
                if (grid.arr[x]?.[y])
                    cells.push({coord: {x, y}, p: centre({x, y})})
        let last = S
        for (let i = 1; i <= 32; ++i) {
            const q = i / 32, x = S.x + (H.x - S.x) * q, y = S.y + (H.y - S.y) * q
            let nearest = null, best = Infinity
            for (const c of cells) {
                const d = (c.p.x - x) ** 2 + (c.p.y - y) ** 2
                if (d < best) {
                    best = d
                    nearest = c.coord
                }
            }
            if (!this.seen(nearest))
                return {x: (last.x + x) / 2 - half, y: (last.y + y) / 2 - half}
            last = {x, y}
        }
        return {x: H.x - half, y: H.y - half}
    }
    // An effect of what the screen's player sees (mode from visibility): 'target' -> the attacker is not drawn and the
    // shot enters from the fog edge (melee or an unknown attacker: only the hit); 'attacker' -> no target data, the shot
    // ends at the fog edge (a melee attacker that moved into the fog: nothing).
    cut(event, mode) {
        if (mode === 'both')
            return event
        if (mode === 'target') {
            const fromPos = event.from && !this.siege[event.kind] && !this.ranged[event.kind] ? event.targetPos :
                event.from ? this.fogEdge(event.target, event.from) : event.targetPos
            event.edge = 'in'
            event.image = null
            event.from = null
            event.fromPos = fromPos
            return event
        }
        const moved = event.to && (event.to.x !== event.from.x || event.to.y !== event.from.y)
        if (moved || !event.target)
            return null
        return {kind: event.kind, attacker: event.attacker, image: event.image, from: event.from, fromPos: event.fromPos,
            to: event.to, edge: 'out', targetPos: this.fogEdge(event.from, event.target)}
    }
    // event: {kind, attacker, image, from, fromPos, to, target, targetPos, targetImage, targetIsUnit, targetUnit, damage,
    // killed, fog}; targetUnit: a living unit target the effect draws (ranged kinds); fog: a siege shot into fog (no
    // target fields).
    // An attack's event from the hooks: an own attack plays at once; others' (an AI or demon turn) wait in later and are
    // played (visibility, fog-edge cut, cap) on the first frame drawn or when the next view is set (flush): the turn
    // spends nothing on them. Returns the event (or the own effect), or null.
    queue(event) {
        if (event.own)
            return this.play(event)
        this.later.push(event)
        if (this.later.length > 4 * this.maxEffects) {
            this.later.shift()
            ++this.stats.dropped
        }
        return event
    }
    later = []
    flush() {
        if (!this.later.length)
            return
        const later = this.later
        this.later = []
        this.flushing = true
        try {
            for (const event of later)
                this.play(event)
        } finally {
            this.flushing = false
        }
        this.hideUnits()
        this.batchFrame = true
    }
    flushing = false
    // Returns the queued effect (event itself, or its fog-edge cut, with the effect's fields set: no copy, AI turns call
    // this for every hit), or null.
    play(event) {
        if (!this.enabled() || !event || !event.kind)
            return null
        if (event.image === undefined)
            event.image = event.attacker ? this.imageOf(event.attacker) : null
        const mode = this.visibility(event)
        if (!mode) {
            ++this.stats.unseen
            return null
        }
        event = this.cut(event, mode)
        if (!event) {
            ++this.stats.unseen
            return null
        }
        if (event.edge)
            ++this.stats.edge
        const kind = event.kind === 'melee' && event.killed ? 'lasthit' : event.kind
        const style = this.ranged[kind]
        const span = style && event.killed && event.targetIsUnit ? Math.max(this.spans[kind], style.hit + 0.5) : this.spans[kind]
        // Others' effects start on the first frame drawn without the pass-device screen (prune).
        const duration = Math.round(this.durations[kind] * span / this.spans[kind])
        if (!duration)
            return null
        const effect = event
        effect.kind = kind
        effect.span = span
        effect.startTime = event.own ? this.now() : null
        effect.duration = duration
        // One effect per attacker: a new attack of the same unit replaces its effect. The finished effects (held at their
        // end, prune) let their units go: the attack changes the board in this frame anyway (TASK-1425).
        const now = this.now()
        this.effects = this.effects.filter(e => e.attacker !== event.attacker && !this.finished(e, now))
        this.effects.push(effect)
        ++this.stats.queued
        while (this.effects.length > this.maxEffects) {
            this.effects.shift()
            ++this.stats.dropped
        }
        // (a batch hides its units once: flush)
        if (!this.flushing)
            this.hideUnits()
        return effect
    }
    clear() {
        this.batchFrame = false
        this.effects.length = 0
        this.hidden.clear()
        this.later.length = 0
        this.view = null
    }
    // A turn ends: its own effects stop; others' (an AI or demon turn just played) stay for the next view. A local
    // human's ending turn leaves its fog as the view others' attacks are judged by.
    endTurn() {
        this.effects = this.effects.filter(e => !e.own)
        this.hideUnits()
        const ending = typeof players !== 'undefined' && typeof whooseTurn !== 'undefined' ? players[whooseTurn] : null
        if (ending && ending.constructor === Player && !(typeof gameSettings !== 'undefined' && gameSettings.isOnline))
            this.view = typeof isFogOfWar !== 'undefined' && isFogOfWar && grid.fogOfWar ? grid.fogOfWar.map(column => Array.from(column)) : null
    }
    // The screen shows slot's view (fog, rebuilt from its vision): the effects queued for another human's view are
    // dropped (no leak to the next human). An AI slot's turn (hot seat with an AI) keeps the last human's view.
    setViewer(slot) {
        if (typeof players !== 'undefined' && players[slot]?.constructor !== Player)
            return
        if (this.viewer !== null && this.viewer !== slot)
            this.clear()
        else
            this.flush()
        this.viewer = slot
        this.view = null
    }
    // The pass-device screen covers the board: others' effects wait.
    held() {
        return typeof nextTurnPauseInterface !== 'undefined' && !!nextTurnPauseInterface?.visible
    }
    // Starts waiting effects (no pass-device screen), drops finished ones and those of a drawn attacker no longer where
    // the rules left it (killed, moved, undone).
    prune(now = this.now()) {
        if (!AttackFx.warm)
            this.scheduleWarmUp()
        this.flush()
        // (the camera is followed in every prune, so the first frame of new effects does not see a pan)
        const keep = !this.panning()
        if (!this.effects.length)
            return
        const held = this.held()
        for (const e of this.effects)
            if (e.startTime === null && !held)
                e.startTime = now
        // TASK-1425: a finished effect stays (drawn at its end: its units in place, bars on, as the board draws them)
        // while it draws a unit, until the board changes anyway: the next attack (play), the unit moving or dying, the
        // turn's end or a new view. A unit leaving or rejoining the board's frame makes it draw live (and, without the
        // atmospheric visuals, patches the surface cache, which holds the unit bodies); an attack does so already, so
        // its units leave in that frame and come back in another such frame, never in one of their own. A camera pan
        // (out of a zoom gesture: the camera moved at the same scale, or Screen.surfaceMoving, set with the atmospheric
        // visuals only) draws its frames live (never held, no zoom raster), so there a finished effect gives its units back
        // to the board's unit passes rather than drawing them itself each frame.
        this.effects = this.effects.filter(e => (e.startTime === null || now - e.startTime < e.duration || keep && this.drawsUnit(e)) &&
            (e.edge === 'in' || !e.attacker || !e.attacker.killed && e.attacker.coord.x === e.to.x &&
                e.attacker.coord.y === e.to.y && grid.getUnit(e.to) === e.attacker))
        this.hideUnits()
    }
    // Whether the camera pans (prune): moved since the last prune at the same scale, or Screen.surfaceMoving, out of a
    // zoom gesture.
    panning() {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (typeof canvas === 'undefined' || !canvas?.offset)
            return false
        const c = this.camera, o = canvas.offset
        const moved = (c.x !== o.x || c.y !== o.y) && c.scale === canvas.scale
        c.x = o.x
        c.y = o.y
        c.scale = canvas.scale
        return (moved || !!screen?.surfaceMoving) && !screen?.zoomGesture
    }
    // TASK-1425: an effect's code costs several ms on its first runs (first calls, inline caches, a new canvas's first
    // context and draws), and a page's first effects often come as a demon or AI turn's batch, in the frame drawn with
    // the turn's change. Once a board with units is drawn, an idle task (browsers only) makes the canvases for unit images
    // and tinted copies ready (fillPools) and runs every kind once on a scratch instance: through the hooks, the flush
    // and the drawing into a small canvas of its own (through those pool canvases). This instance's effects, the board
    // and its units are not changed.
    scheduleWarmUp() {
        if (typeof requestIdleCallback !== 'function' || typeof document === 'undefined' || typeof grid === 'undefined' || !grid?.arr)
            return
        AttackFx.warm = true
        requestIdleCallback(() => {
            try {
                this.fillPools()
                const fx = new AttackFx()
                fx.barPool = this.barPool
                fx.tints = this.tints
                fx.warmUp()
            } catch (error) {
                // (a warm-up only: the effects work without it)
            }
        }, {timeout: 2000})
    }
    // The unit images' canvases (barPool) at the size of a unit with its bars at the main canvas's scale, and 16 spare
    // canvases of a sprite's size for tinted copies, each with its context made and drawn on once.
    fillPools() {
        const t = typeof mainCtx !== 'undefined' ? mainCtx.getTransform() : null
        const size = assets.size, box = Math.ceil(Math.max(1, t ? Math.abs(t.a) : 1) * 1.5 * size) + 4
        const make = (w, h) => {
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            canvas.getContext('2d').clearRect(0, 0, 1, 1)
            return canvas
        }
        for (let i = 0; i < this.barPool.length; ++i)
            this.barPool[i] ||= make(box, box)
        while (this.spares.length < 16)
            this.spares.push(make(size, size))
    }
    warmUp() {
        const cells = grid.arr.flat().filter(c => c?.unit?.notEmpty?.() && c.unit.pos && c.unit.coord)
        if (!cells.length)
            return
        const a = cells[0].unit, colour = a.playerColor
        const enemyCell = cells.find(c => c.unit.playerColor !== colour) || cells[cells.length - 1]
        const b = enemyCell.unit, from = {x: a.coord.x, y: a.coord.y}, target = {x: b.coord.x, y: b.coord.y}
        // The hooks, an attacker of each class on the board: its snapshot (a copy) is told the target lost 1 hp (a siege
        // shooter: spent moves), so after() makes the event (on this instance) without any unit changing.
        const classes = new Set()
        for (const c of cells) {
            const unit = c.unit
            if (classes.has(unit.constructor))
                continue
            classes.add(unit.constructor)
            const s = this.before(unit, cells.find(o => o.unit.playerColor !== unit.playerColor) || enemyCell)
            if (s?.siege)
                s.moves = unit.moves + 1
            else if (s?.unit)
                s.unitHp = s.unit.hp + 1
            else if (s?.building)
                s.buildingHp = s.building.hp + 1
            this.after(s)
        }
        this.after(this.beforeSiege(a, enemyCell))
        this.flush()
        const image = this.imageOf(a) || null, targetImage = this.imageOf(b) || image
        const event = (kind, more) => ({kind, attacker: a, own: false, image, from, fromPos: {x: a.pos.x, y: a.pos.y}, to: from,
            target, targetPos: {x: b.pos.x, y: b.pos.y}, targetImage, targetIsUnit: true, targetUnit: null, damage: 2,
            killed: false, seen: {from: true, to: true}, ...more})
        const effects = [event('melee'), event('melee', {killed: true}), event('archer', {targetUnit: b}), event('ember', {killed: true}),
            event('hexcaster'), event('catapult', {targetIsUnit: false}), event('bombard', {targetIsUnit: false, killed: true}),
            event('mortar', {targetIsUnit: false}), event('catapult', {fog: true, seen: {from: true, to: false}}),
            event('archer', {seen: {from: true, to: false}}), event('archer', {seen: {from: false, to: true}})]
        for (const e of effects) {
            // (one effect per attacker: each kind's own run)
            this.effects.length = 0
            this.queue(e)
            this.flush()
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 64
            const ctx = canvas.getContext('2d')
            for (const effect of this.effects) {
                effect.startTime = 0
                for (let time = 0; time <= effect.duration + 50; time += 50) {
                    ctx.setTransform(0.25, 0, 0, 0.25, 32 - 0.25 * (effect.targetPos.x + assets.size / 2), 32 - 0.25 * (effect.targetPos.y + assets.size / 2))
                    this.draw(ctx, time)
                }
            }
        }
        this.clear()
    }
    // Whether e draws a unit (its attacker, but for a shot entering from the fog edge, or a ranged hit's living target).
    drawsUnit(e) {
        return !!e.attacker && e.edge !== 'in' || this.drawsTarget(e)
    }
    // Whether e has played to its end (finished effects stay while they draw a unit: prune).
    finished(e, now = this.now()) {
        return e.startTime !== null && now - e.startTime >= e.duration
    }
    // The units the effects draw, left out of the grid's unit passes until the next prune (Grid.getStillUnit, run for every
    // unit of every pass, looks them up in this set directly): attackers (but a shot entering from the fog edge) and a ranged hit's living
    // target while it stays on its cell. An effect waiting behind the pass-device screen hides its units already (drawn
    // at its first pose), so the board's frame drops them with the turn's own change, not in the next view's first frame.
    hideUnits() {
        const hidden = this.hidden
        hidden.clear()
        for (const e of this.effects) {
            if (e.attacker && e.edge !== 'in')
                hidden.add(e.attacker)
            if (this.drawsTarget(e))
                hidden.add(e.targetUnit)
        }
    }
    // An effect plays (a waiting one or one held at its end does not).
    isActive() {
        this.prune()
        const now = this.now()
        return this.effects.some(e => e.startTime !== null && now - e.startTime < e.duration)
    }
    // Whether unit is drawn by an effect (left out of the grid's unit passes): its attacker, or a ranged hit's living
    // unit target while it stays on the target cell.
    hidesUnit(unit) {
        return this.hidden.size > 0 && this.hidden.has(unit)
    }
    drawsTarget(e) {
        return !!e.targetUnit && !e.targetUnit.killed && grid.getUnit(e.target) === e.targetUnit
    }
    draw(ctx, now = this.now()) {
        this.prune(now)
        this.imagesMade = this.batchFrame ? this.imageBudget : 0
        this.tintsMade = this.batchFrame ? this.tintBudget : 0
        this.batchFrame = false
        if (!this.effects.length)
            return
        const t = ctx.getTransform(), margin = 3 * basis.r
        // (drawn after Grid.draw: its level of detail from the camera, as the board's)
        const lod = typeof grid !== 'undefined' && (grid.lod || !!grid.lodTransform?.(ctx))
        for (const e of this.effects) {
            // Off-screen effects are skipped (the target's centre and reach against the canvas).
            const cx = e.targetPos.x + assets.size / 2, cy = e.targetPos.y + assets.size / 2
            const x = t.a * cx + t.c * cy + t.e, y = t.b * cx + t.d * cy + t.f
            const reach = Math.abs(t.a) * margin
            if (x < -reach || y < -reach || x > ctx.canvas.width + reach || y > ctx.canvas.height + reach)
                continue
            if (this.tintsMade < this.tintBudget && e.targetImage && !this.finished(e, now))
                this.prepareTint(e)
            ctx.save()
            if (this.finished(e, now)) {
                this.drawEnd(ctx, e, lod)
                ctx.restore()
                continue
            }
            // (an effect waiting behind the pass-device screen: its first pose)
            const time = e.startTime === null ? 0 : Math.min(1, (now - e.startTime) / e.duration) * e.span
            if (this.siege[e.kind])
                this.drawSiege(ctx, e, time, lod)
            else if (this.ranged[e.kind])
                this.drawRanged(ctx, e, time, lod)
            else
                this.drawMelee(ctx, e, time, lod)
            ctx.restore()
        }
    }
    // A finished effect (held until the board changes, prune): only the units it keeps from the board, where they are.
    drawEnd(ctx, e, lod) {
        if (e.attacker && e.edge !== 'in')
            this.drawUnitAt(ctx, e.attacker, this.imageOf(e.attacker) || e.image, e.attacker.pos.x, e.attacker.pos.y, lod)
        if (this.drawsTarget(e))
            this.drawUnitAt(ctx, e.targetUnit, this.imageOf(e.targetUnit) || e.targetImage, e.targetUnit.pos.x, e.targetUnit.pos.y, lod)
    }
    ease(t) {
        return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
    }
    // Tinted copies of a sprite, each made on first use: red (flash), grey with a dark red cast (a dying unit), orange and
    // violet (ranged demon hits). names: the copies wanted (none: red and grey). TASK-1425: an effect makes its copies in
    // the frames before its hit, one a frame (prepareTint), so a turn's batch does not make them all in its hit frame.
    tinted(image, ...names) {
        let tint = this.tints.get(image)
        if (!tint) {
            if (this.tints.size > 64)
                this.tints.clear()
            this.tints.set(image, tint = {})
        }
        for (const name of names.length ? names : ['red', 'grey'])
            if (!tint[name])
                tint[name] = this.tintCopy(image, name)
        return tint
    }
    tintColors = {red: 'rgb(255, 40, 30)', orange: 'rgb(255, 110, 20)', violet: 'rgb(150, 40, 220)'}
    tintCopy(image, name) {
        const c = this.spares.pop() || document.createElement('canvas')
        c.width = image.width
        c.height = image.height
        const g = c.getContext('2d')
        g.drawImage(image, 0, 0)
        if (name === 'grey') {
            g.globalCompositeOperation = 'saturation'
            g.fillStyle = 'rgb(128, 128, 128)'
            g.fillRect(0, 0, c.width, c.height)
            g.globalCompositeOperation = 'destination-in'
            g.drawImage(image, 0, 0)
            g.globalCompositeOperation = 'source-atop'
            g.fillStyle = 'rgba(120, 20, 20, 0.4)'
        }
        else {
            g.globalCompositeOperation = 'source-atop'
            g.fillStyle = this.tintColors[name]
        }
        g.fillRect(0, 0, c.width, c.height)
        return c
    }
    // The tinted copies e draws (drawMelee; drawRanged and its drawDying; drawCollapse), kept on e.
    tintNames(e) {
        if (!e.tints) {
            const style = this.ranged[e.kind]
            e.tints = !e.targetImage ? [] : this.siege[e.kind] ? (e.killed ? ['grey'] : []) :
                style ? (e.killed && e.targetIsUnit ? [style.tint, 'red', 'grey'] : [style.tint]) : e.kind === 'lasthit' ? ['red', 'grey'] : ['red']
        }
        return e.tints
    }
    // Makes one of e's missing tinted copies (draw: an effect still playing, at most tintBudget a frame, none in a batch's
    // first frame; its hit makes those still missing).
    prepareTint(e) {
        const tint = this.tints.get(e.targetImage)
        for (const name of this.tintNames(e))
            if (!tint?.[name]) {
                ++this.tintsMade
                this.tinted(e.targetImage, name)
                return
            }
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
        const moved = !!e.from && (e.to.x !== e.from.x || e.to.y !== e.from.y)
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
        // (tinted copies from the hit on: an effect's first frames, e.g. a turn's batch behind the pass-device screen, make none)
        const tint = hit && e.targetImage && this.tinted(e.targetImage, ...this.tintNames(e))
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
        // (a shot toward the fog edge: no slash, flash or number)
        if (time >= 0.28 && time < 0.48 && e.edge !== 'out')
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
        if (lod || !unit.drawBars || !this.drawUnitImage(ctx, unit, image, x - unit.pos.x, y - unit.pos.y)) {
            if (!lod && unit.drawBars) {
                ctx.save()
                ctx.translate(x - unit.pos.x, y - unit.pos.y)
                unit.drawBars(ctx)
                ctx.restore()
            }
            ctx.drawImage(image, x, y)
        }
    }
    // TASK-1425: a unit's bars (unit.drawBars, 8-14 fills and strokes) and its sprite over them, moved by dx, dy, as one
    // image: drawn once into a small canvas at the camera's scale and the device-pixel phase of the unit's place (there
    // the image is pixel for pixel what drawing them does), then one drawImage a frame at whole device pixels of that
    // phase (a moving unit within half a device pixel). Remade when the bars or the sprite change, or the scale or that
    // phase with the camera at rest (while it zooms or pans the image is scaled and moved along).
    // Canvases come from a pool of barPool.length, reused in turn (12 effects draw at most 24 units). False (nothing
    // drawn) when the transform is not a plain scale and translation, or this frame made imageBudget images already.
    drawUnitImage(ctx, unit, image, dx, dy) {
        const t = ctx.getTransform()
        const rects = unit.hpBar?.rects, moves = unit.movesBar?.rects
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || !rects || typeof document === 'undefined')
            return false
        let x0 = unit.pos.x, y0 = unit.pos.y, x1 = x0 + image.width, y1 = y0 + image.height
        for (const list of [rects, moves || []])
            for (const r of list) {
                const w = r.strokeWidth || 0
                x0 = Math.min(x0, r.x - w); y0 = Math.min(y0, r.y - w)
                x1 = Math.max(x1, r.x + r.width + w); y1 = Math.max(y1, r.y + r.height + w)
            }
        // device position of the box at rest, its phase (fraction of a device pixel)
        const X = t.a * x0 + t.e, Y = t.d * y0 + t.f, fx = X - Math.floor(X), fy = Y - Math.floor(Y)
        const showMoves = typeof shouldShowMovesBar === 'function' && shouldShowMovesBar(unit)
        const alwaysHP = !!otherSettings?.alwaysDisplayHPBar, w0 = x1 - x0, h0 = y1 - y0
        let entry = this.barImages.get(unit)
        const same = entry && entry.canvas.owner === entry && entry.image === image && entry.hp === unit.hp && entry.maxHP === unit.maxHP &&
            entry.moves === unit.moves && entry.showMoves === showMoves && entry.alwaysHP === alwaysHP && entry.r === basis.r &&
            entry.w0 === w0 && entry.h0 === h0
        const exact = same && entry.a === t.a && entry.d === t.d && Math.abs(entry.fx - fx) < 1e-3 && Math.abs(entry.fy - fy) < 1e-3
        // While the camera zooms or pans the image is drawn scaled and moved with it, remade once the camera rests.
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const moving = !!screen && (screen.zoomGesture || screen.surfaceMoving)
        if (!exact && !(same && moving)) {
            if (this.imagesMade >= this.imageBudget)
                return false
            ++this.imagesMade
            const canvas = this.barPool[this.barNext] ||= document.createElement('canvas')
            this.barNext = (this.barNext + 1) % this.barPool.length
            entry = {image, hp: unit.hp, maxHP: unit.maxHP, moves: unit.moves, showMoves, alwaysHP, r: basis.r, w0, h0, a: t.a, d: t.d, fx, fy, canvas}
            canvas.owner = entry
            const w = Math.ceil(t.a * w0 + fx) + 2, h = Math.ceil(t.d * h0 + fy) + 2
            if (canvas.width < w || canvas.height < h) {
                canvas.width = Math.max(canvas.width, w)
                canvas.height = Math.max(canvas.height, h)
            }
            entry.w = w
            entry.h = h
            const g = canvas.getContext('2d')
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.clearRect(0, 0, w, h)
            g.lineJoin = ctx.lineJoin
            g.lineCap = ctx.lineCap
            // the box's corner at device (1 + fx, 1 + fy) of the canvas
            g.setTransform(t.a, 0, 0, t.d, 1 + fx - t.a * x0, 1 + fy - t.d * y0)
            unit.drawBars(g)
            g.drawImage(image, unit.pos.x, unit.pos.y)
            this.barImages.set(unit, entry)
        }
        // the box's corner now (moved by dx, dy)
        const X1 = t.a * (x0 + dx) + t.e, Y1 = t.d * (y0 + dy) + t.f
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (entry.a === t.a && entry.d === t.d)
            ctx.drawImage(entry.canvas, 0, 0, entry.w, entry.h, Math.round(X1 - entry.fx) - 1, Math.round(Y1 - entry.fy) - 1, entry.w, entry.h)
        else {
            const kx = t.a / entry.a, ky = t.d / entry.d
            ctx.drawImage(entry.canvas, 0, 0, entry.w, entry.h, X1 - (1 + entry.fx) * kx, Y1 - (1 + entry.fy) * ky, entry.w * kx, entry.h * ky)
        }
        ctx.restore()
        return true
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
        const tint = t >= hit && e.targetImage && this.tinted(e.targetImage, ...this.tintNames(e))
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
            this.drawHexcaster(ctx, t, A, E, ux, uy, dy, r, e.edge)
        else {
            const [ahead, down] = e.edge === 'in' ? [0, 0] : style.muzzle
            const S = {x: A.x + ux * ahead * r, y: A.y + uy * ahead * r + down * r}
            const T = e.edge === 'out' ? E : {x: E.x - ux * 0.1 * r, y: E.y - uy * 0.1 * r + 0.05 * r}
            if (e.kind === 'ember')
                this.drawEmber(ctx, t, S, T, 0.26 * dist, r, e.edge)
            else
                this.drawArrow(ctx, t, S, T, 0.26 * dist, E, r, e.edge)
        }
        this.drawDamage(ctx, E, (t - style.text) / style.textSpan, e.damage, r)
    }
    // The arrow: flies S -> T on [0.22, 0.5) with a short white trail; sparks burst from the target on [0.48, 0.66).
    // edge: 'in' (from the fog edge), 'out' (to the fog edge: no sparks).
    drawArrow(ctx, t, S, T, h, E, r, edge) {
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
        if (t >= 0.48 && t < 0.66 && edge !== 'out') {
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
    drawEmber(ctx, t, S, T, h, r, edge) {
        if (t < 0.24 && edge !== 'in') {
            ctx.fillStyle = 'rgba(255, 140, 30, 0.55)'
            ctx.beginPath()
            ctx.arc(S.x, S.y, (0.08 + 0.1 * t / 0.24) * r, 0, 2 * Math.PI)
            ctx.fill()
        }
        if (t >= 0.22 && t < 0.56) {
            const q = (t - 0.22) / 0.34, trail = this.embers.trail
            // TASK-1425: the embers in 4 age bands, one fill a band (the band's middle age gives colour and alpha).
            for (let band = 0; band < 4; ++band) {
                const mid = (band + 0.5) / 4
                ctx.fillStyle = `rgba(255, ${Math.round(200 - 150 * mid)}, 40, ${(0.9 * (1 - mid)).toFixed(3)})`
                ctx.beginPath()
                let any = false
                for (let i = 0; i < trail.length; i += 3) {
                    const qq = q + trail[i] * 1.5, age = -trail[i] / 0.06
                    if (qq < 0 || Math.min(3, Math.floor(age * 4)) !== band)
                        continue
                    const c = this.arc(S, T, h, qq), x = c.x, y = c.y + trail[i + 1] * age * r
                    ctx.moveTo(x + trail[i + 2] * r, y)
                    ctx.arc(x, y, trail[i + 2] * r, 0, 2 * Math.PI)
                    any = true
                }
                if (any)
                    ctx.fill()
            }
            this.drawShaft(ctx, S, T, h, q, r, 'rgb(60, 30, 15)', true)
        }
        if (t >= 0.55 && t < 0.95 && edge !== 'out') {
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
    drawHexcaster(ctx, t, A, E, ux, uy, lift, r, edge) {
        const O = edge === 'in' ? A : {x: A.x + ux * 0.6 * r, y: A.y + uy * 0.6 * r - 0.5 * r + lift}
        if (t < 0.32 && edge !== 'in') {
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
        if (t >= 0.5 && t < 0.95 && edge !== 'out') {
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
    // Siege shots (B2-catapult, B3-bombard, B3-mortar), t in concept time units [0, 1]; sizes in r as drawMelee.
    drawSiege(ctx, e, t, lod) {
        const r = basis.r, half = assets.size / 2, st = this.siege[e.kind], {fly0, fly1} = st
        const A = {x: e.fromPos.x + half, y: e.fromPos.y + half}
        const E = {x: e.targetPos.x + half, y: e.targetPos.y + half + 0.1 * r}
        const vx = E.x - A.x, vy = E.y - A.y, dist = Math.hypot(vx, vy) || 1
        const ux = vx / dist, uy = vy / dist
        const M = e.edge === 'in' ? A : {x: A.x + ux * st.muzzle[0] * r, y: A.y + uy * st.muzzle[0] * r + st.muzzle[1] * r}
        const s = t >= fly1 ? (t - fly1) / (1 - fly1) : -1
        // The impact shakes (the target hex's effect and collapsing snapshot only).
        const frame = t * (st.frames - 1)
        const amp = !e.fog && s >= 0 && s < st.shakeSpan ? st.shake * r * (1 - s / st.shakeSpan) : 0
        const sx = amp * Math.sin(frame * 2.1), sy = amp * Math.cos(frame * 1.7)
        // A destroyed building: its snapshot until the impact, then it sinks greying and fades.
        if (e.killed && e.targetImage)
            this.drawCollapse(ctx, e, s, sx, sy)
        // The shooter recoils (a catapult also tips back).
        const k = t >= fly0 && t < fly0 + 0.15 ? Math.sin(Math.PI * (t - fly0) / 0.15) : 0
        const rec = st.recoil * r * k
        let dx = -ux * rec, dy = -uy * rec
        if (e.kind === 'mortar') {
            dx *= 0.4
            dy = 0.6 * rec
        }
        if (e.kind === 'catapult' && k) {
            ctx.save()
            const bx = A.x + dx, by = A.y + 0.5 * r + dy
            ctx.translate(bx, by)
            ctx.rotate(-Math.sign(ux || 1) * 3 * Math.PI / 180 * k)
            ctx.translate(-bx, -by)
            this.drawUnitAt(ctx, e.attacker, e.image, e.fromPos.x + dx, e.fromPos.y + dy, lod)
            ctx.restore()
        }
        else
            this.drawUnitAt(ctx, e.attacker, e.image, e.fromPos.x + dx, e.fromPos.y + dy, lod)
        // Muzzle flash and smoke (bombard: toward the target, mortar: up).
        if (e.kind !== 'catapult' && e.edge !== 'in' && t >= fly0 && t < fly0 + 0.4) {
            const q = (t - fly0) / 0.4
            const up = e.kind === 'mortar'
            if (t < fly0 + 0.12) {
                const f = (t - fly0) / 0.12, fr = (0.18 + 0.28 * f) * r
                ctx.fillStyle = `rgba(255, 220, 120, ${(1 - f).toFixed(3)})`
                ctx.beginPath()
                ctx.arc(M.x + (up ? 0 : ux) * fr * 0.6, M.y + (up ? -1 : uy) * fr * 0.6, fr, 0, 2 * Math.PI)
                ctx.fill()
            }
            ctx.fillStyle = `rgba(170, 165, 160, ${(150 / 255 * (1 - q)).toFixed(3)})`
            ctx.beginPath()
            for (let j = 0; j < 4; ++j) {
                const x = M.x + (up ? 0 : ux * (0.2 + 0.3 * q) * r) + 0.12 * r * Math.sin(j * 2)
                const y = M.y - (up ? (0.4 * q + 0.12 * j) * r : 0.1 * q * r)
                const pr = (0.1 + 0.18 * q) * r
                ctx.moveTo(x + pr, y)
                ctx.arc(x, y, pr, 0, 2 * Math.PI)
            }
            ctx.fill()
        }
        // The shot in flight with its shadow along the ground.
        if (t >= fly0 && t < fly1) {
            const q = (t - fly0) / (fly1 - fly0), h = st.height * dist, lift = Math.sin(Math.PI * q)
            const gx = A.x + (E.x - A.x) * q, gy = A.y + 0.5 * r + (E.y + 0.4 * r - A.y - 0.5 * r) * q
            const sr = (0.08 + 0.06 * (1 - lift)) * r
            ctx.fillStyle = `rgba(0, 0, 0, ${(e.kind === 'catapult' ? (60 + 60 * (1 - lift)) / 255 : 90 / 255).toFixed(3)})`
            ctx.beginPath()
            ctx.ellipse(gx, gy, 1.6 * sr, 0.6 * sr, 0, 0, 2 * Math.PI)
            ctx.fill()
            if (e.kind === 'mortar')
                for (let j = 4; j >= 0; --j) {
                    const c = this.arc(M, E, h, Math.max(0, q - 0.03 * j))
                    ctx.fillStyle = `rgba(255, 140, 40, ${((160 - 30 * j) / 255).toFixed(3)})`
                    ctx.beginPath()
                    ctx.arc(c.x, c.y, (0.06 - 0.01 * j) * r, 0, 2 * Math.PI)
                    ctx.fill()
                }
            const c = this.arc(M, E, h, q), x = c.x, y = c.y
            const [br, fill, edge, shine] = {catapult: [0.13, 'rgb(95, 88, 80)', 'rgb(40, 35, 30)', 'rgb(160, 150, 140)'],
                bombard: [0.11, 'rgb(60, 50, 50)', 'rgb(25, 20, 20)', 'rgb(150, 140, 130)'],
                mortar: [0.14, 'rgb(120, 40, 30)', 'rgb(25, 20, 20)', 'rgb(255, 160, 60)']}[e.kind]
            ctx.fillStyle = fill
            ctx.strokeStyle = edge
            ctx.lineWidth = 0.02 * r
            ctx.beginPath()
            ctx.arc(x, y, br * r, 0, 2 * Math.PI)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = shine
            ctx.beginPath()
            ctx.arc(x - 0.25 * br * r, y - 0.35 * br * r, 0.25 * br * r, 0, 2 * Math.PI)
            ctx.fill()
        }
        if (s < 0 || e.edge === 'out')
            return
        if (e.fog) {
            this.drawFogPuff(ctx, E, s, r)
            return
        }
        ctx.save()
        ctx.translate(sx, sy)
        if (e.kind === 'catapult')
            this.drawBoulderImpact(ctx, E, s, r)
        else
            this.drawExplosion(ctx, E, s, r, e.kind === 'mortar')
        if (e.damage > 0)
            this.drawDamage(ctx, {x: E.x, y: E.y - 0.4 * r}, s * 1.1, e.damage, r)
        ctx.restore()
    }
    // A destroyed building's snapshot: whole until the impact (s < 0), then it sinks below its base greying and fades
    // over s in [0, 0.7], shaken by sx, sy.
    drawCollapse(ctx, e, s, sx, sy) {
        const image = e.targetImage, x = e.targetPos.x, y = e.targetPos.y
        if (s < 0) {
            ctx.drawImage(image, x, y)
            return
        }
        if (s >= 0.7)
            return
        const k = this.ease(s / 0.7), grey = this.tinted(image, 'grey').grey
        ctx.save()
        ctx.beginPath()
        ctx.rect(x - image.width, y - image.height, 3 * image.width, 2 * image.height)
        ctx.clip()
        ctx.globalAlpha = 1 - k
        ctx.drawImage(k < 0.15 ? image : grey, x + sx, y + sy + 0.6 * image.height * k)
        ctx.restore()
    }
    // The boulder's impact: a flash, a ring of dust and debris falling (B2-catapult), s in [0, 1].
    drawBoulderImpact(ctx, E, s, r) {
        if (s < 0.25) {
            const f = (0.6 + 1.4 * s / 0.25) * r
            ctx.fillStyle = `rgba(255, 220, 150, ${(200 / 255 * (1 - s / 0.25)).toFixed(3)})`
            ctx.beginPath()
            ctx.ellipse(E.x, E.y, f, 0.7 * f, 0, 0, 2 * Math.PI)
            ctx.fill()
        }
        ctx.fillStyle = `rgba(200, 180, 150, ${(190 / 255 * (1 - s)).toFixed(3)})`
        ctx.beginPath()
        const rr = (0.3 + 1.1 * this.ease(Math.min(1, s * 1.5))) * r, pr = (0.22 + 0.18 * s) * r
        for (let j = 0; j < 10; ++j) {
            const angle = j / 10 * 2 * Math.PI
            const x = E.x + Math.cos(angle) * rr, y = E.y + 0.3 * r + Math.sin(angle) * rr * 0.4
            ctx.moveTo(x + pr, y)
            ctx.ellipse(x, y, pr, 0.8 * pr, 0, 0, 2 * Math.PI)
        }
        ctx.fill()
        this.drawDebris(ctx, E, s, r, 1, 16, 'rgb(110, 80, 50)')
    }
    // A shell's explosion (B3-bombard, B3-mortar: big, 1.6 times as large with a shockwave ring), s in [0, 1].
    drawExplosion(ctx, E, s, r, big) {
        const sc = big ? 1.6 : 1
        if (s < 0.3) {
            const f = (0.4 + 0.9 * s / 0.3) * sc * r, a = 1 - s / 0.3
            ctx.fillStyle = `rgba(255, 200, 90, ${(230 / 255 * a).toFixed(3)})`
            ctx.beginPath()
            ctx.ellipse(E.x, E.y, f, 0.75 * f, 0, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = `rgba(255, 250, 210, ${a.toFixed(3)})`
            ctx.beginPath()
            ctx.ellipse(E.x, E.y, 0.55 * f, 0.41 * f, 0, 0, 2 * Math.PI)
            ctx.fill()
        }
        if (big && s < 0.5) {
            const f = (0.6 + 3 * s) * r
            ctx.strokeStyle = `rgba(255, 235, 200, ${(200 / 255 * (1 - s / 0.5)).toFixed(3)})`
            ctx.lineWidth = 0.06 * r
            ctx.beginPath()
            ctx.ellipse(E.x, E.y + 0.3 * r, f, 0.4 * f, 0, 0, 2 * Math.PI)
            ctx.stroke()
        }
        const g = Math.round(150 - 60 * s)
        ctx.fillStyle = `rgba(${g}, ${g - 10}, ${g - 20}, ${(200 / 255 * (1 - s)).toFixed(3)})`
        ctx.beginPath()
        const rr = (0.3 + 1.1 * this.ease(Math.min(1, s * 1.4))) * sc * r, pr = (0.22 + 0.22 * s) * sc * r
        for (let j = 0; j < 12; ++j) {
            const angle = j / 12 * 2 * Math.PI
            const x = E.x + Math.cos(angle) * rr, y = E.y + 0.25 * r + Math.sin(angle) * rr * 0.4 - 0.4 * r * s
            ctx.moveTo(x + pr, y)
            ctx.ellipse(x, y, pr, 0.8 * pr, 0, 0, 2 * Math.PI)
        }
        ctx.fill()
        this.drawDebris(ctx, E, s, r, sc, 18, 'rgb(90, 60, 40)')
    }
    // n debris squares thrown up from E and falling, s in [0, 1].
    drawDebris(ctx, E, s, r, sc, n, colour) {
        const debris = this.debris
        ctx.globalAlpha = 1 - s
        ctx.fillStyle = colour
        ctx.beginPath()
        for (let i = 0; i < 3 * n; i += 3) {
            const d = debris[i + 1] * s * sc * r, size = debris[i + 2] * r
            ctx.rect(E.x + Math.cos(debris[i]) * d - size, E.y + Math.sin(debris[i]) * d + 3.8 * r * s * s - size, 2 * size, 2 * size)
        }
        ctx.fill()
        ctx.globalAlpha = 1
    }
    // A shot into fog lands with a muffled grey puff: no flash, debris, number or shake, s in [0, 1].
    drawFogPuff(ctx, E, s, r) {
        if (s >= 0.8)
            return
        const q = s / 0.8, rr = (0.15 + 0.4 * this.ease(Math.min(1, q * 1.5))) * r, pr = (0.12 + 0.12 * q) * r
        ctx.fillStyle = `rgba(150, 150, 150, ${(0.5 * (1 - q)).toFixed(3)})`
        ctx.beginPath()
        for (let j = 0; j < 6; ++j) {
            const angle = j / 6 * 2 * Math.PI
            const x = E.x + Math.cos(angle) * rr, y = E.y + 0.25 * r + Math.sin(angle) * rr * 0.4 - 0.2 * r * q
            ctx.moveTo(x + pr, y)
            ctx.ellipse(x, y, pr, 0.8 * pr, 0, 0, 2 * Math.PI)
        }
        ctx.fill()
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
        if (!(u > 0 && u <= 1) || !(damage > 0))
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
