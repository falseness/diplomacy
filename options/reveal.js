// Autoscouting prefetch (artifacts/actions_feature_prd.txt sec. 7.2): the cells NOT visible now that ONE legal
// action of a player can reveal, computed on the current board without applying anything.
//
//   revealableByOneAction(playerIndex) -> [{x, y}, ...] sorted by x, then y
//   RevealScout.compute(playerIndex)   -> {cells, bySource: {move, attack, capture, suburb, wallKill, destroy}
//                                          (cells each source reveals; a cell can count for several),
//                                          stats: {units, skippedUnits, events, visits}}
//
// "Visible" is the player's vision recomputed from the current board, plus grid.fogOfWar > 0 when that mask is the
// player's (whooseTurn, or the shared co-op team mask the player belongs to: it also keeps what earlier moves of this
// turn saw). Fog of war off -> nothing to reveal.
// The reveal is judged as the server's exact fog after the action: the player's vision recomputed from the board
// the action leaves (Player.changeFogOfWarByVision). Reveal sources, each the real rules' outcome:
//   move     - every cell a unit can end a move on (its Way.create BFS over the current board, blockers and the
//              player's fog as they stand), seen from there with the unit's visionRange, ignoring barriers where
//              that cell's building has rangeIncrease (hill, tower, town), as Unit.changeFogOfWarByVision does;
//   attack   - a melee hit whose target dies (or a town falling to 0 hp) moves the attacker onto the target cell;
//   capture  - the attacker in the captured town plus the vision ring of every suburb the capture keeps
//              (Town.updateSuburbsAndBuildings) and vision through the barriers the capture kills;
//   suburb   - the ring (SUBURBSVISIONRANGE) of every suburb purchase the town can afford;
//   wallKill - vision of the current viewers recomputed without a barrier one attack of one unit kills;
//   destroy  - the same without an own barrier the player may destroy.
// Chains (break a wall, then walk through) are not included; neither is undo (it returns to an earlier board of the
// turn, at turn start there is nothing to undo). Units whose disk of radius moves + visionRange + 1 is
// already visible and that have no enemy entity within reach are skipped.
// Nothing here draws, selects, touches the interfaces or calls refreshCoopVision / VisionWay: the searches run on
// the units' own Way objects with a headless border, and the vision search is a private copy of VisionWay.
//
// Loaded after options/actionApi.js (HeadlessActionBorder) in index.html and server/loadGameCode.js.

const RevealScout = {
    border: null,

    compute(playerIndex) {
        let player = typeof players !== 'undefined' ? players[playerIndex] : null
        let result = {cells: [], bySource: {move: 0, attack: 0, capture: 0, suburb: 0, wallKill: 0, destroy: 0},
            stats: {units: 0, skippedUnits: 0, events: 0, visits: 0}}
        if (!player || !isFogOfWar || typeof grid === 'undefined' || !grid || !grid.arr || !grid.arr.length)
            return result
        let scout = RevealScout.prepare(playerIndex, player)
        RevealScout.collect(scout)
        RevealScout.finish(scout, result)
        return result
    },

    prepare(playerIndex, player) {
        let n = grid.arr.length
        let m = grid.arr[0].length
        let size = n * m
        let geometry = RevealScout.geometry(n, m)
        let scout = {
            p: playerIndex, player: player, n: n, m: m, size: size, nbr: geometry.nbr,
            stamp: geometry.stamp, budget: geometry.budget, dist: geometry.dist, queue: geometry.queue,
            visible: new Uint8Array(size), revealed: new Uint8Array(size), source: new Uint8Array(size),
            moveSources: {plain: [], ignore: []}, events: [], visits: 0, units: 0, skippedUnits: 0
        }
        if (!RevealScout.border)
            RevealScout.border = new HeadlessActionBorder()
        RevealScout.viewerSources(scout)
        RevealScout.currentVisibility(scout)
        return scout
    },

    // Neighbour table and scratch arrays, rebuilt when the map size changes.
    geometry(n, m) {
        let cached = RevealScout.cachedGeometry
        if (cached && cached.arr === grid.arr && cached.n === n && cached.m === m)
            return cached
        let size = n * m
        let nbr = new Int32Array(size * 6).fill(-1)
        for (let x = 0; x < n; ++x) {
            for (let y = 0; y < m; ++y) {
                let neighbours = grid.arr[x][y].hexagon.neighbours
                for (let i = 0; i < neighbours.length && i < 6; ++i) {
                    let t = neighbours[i]
                    if (!isCoordNotOnMap(t, n, m))
                        nbr[(x * m + y) * 6 + i] = t.x * m + t.y
                }
            }
        }
        RevealScout.cachedGeometry = {arr: grid.arr, n: n, m: m, nbr: nbr, stamp: new Int32Array(size),
            budget: new Int32Array(size), dist: new Int32Array(size), queue: new Int32Array(size * 7 + 16), epoch: 0}
        return RevealScout.cachedGeometry
    },

    nextEpoch() {
        let geometry = RevealScout.cachedGeometry
        if (++geometry.epoch >= 0x7fffffff) {
            geometry.stamp.fill(0)
            geometry.epoch = 1
        }
        return geometry.epoch
    },

    index(scout, coord) {
        return coord.x * scout.m + coord.y
    },

    coordOf(scout, index) {
        return {x: Math.floor(index / scout.m), y: index % scout.m}
    },

    buildingAt(scout, index) {
        return grid.arr[Math.floor(index / scout.m)][index % scout.m].building
    },

    isLive(entity) {
        return Boolean(entity) && typeof entity.notEmpty === 'function' && entity.notEmpty() && !entity.killed
    },

    // The vision sources Player.changeFogOfWarByVision uses: co-op humans share the vision of every allied human
    // (current assets only), everybody else sees with their own units and town suburbs.
    viewerSources(scout) {
        let player = scout.player
        let shared = Boolean(gameSettings.coop) && player.role === 'HUMAN'
        let viewers = shared ? players.filter(other => other && other.role === 'HUMAN' && player.isAlliedWith(other)) :
            [player]
        scout.shared = shared
        scout.viewers = viewers
        scout.unitSources = []
        scout.suburbSources = []
        for (let viewer of viewers) {
            for (let unit of viewer.units) {
                if (shared && (unit.killed || unit.player !== viewer))
                    continue
                scout.unitSources.push({index: RevealScout.index(scout, unit.coord), range: unit.visionRange,
                    unit: unit})
            }
            for (let town of viewer.towns) {
                if (shared && (town.killed || town.player !== viewer))
                    continue
                for (let suburb of town.suburbs) {
                    if (shared && (!suburb.isSuburb || suburb.player !== viewer))
                        continue
                    scout.suburbSources.push({index: RevealScout.index(scout, suburb.coord), range: SUBURBSVISIONRANGE})
                }
            }
        }
    },

    // Visible = grid.fogOfWar > 0 when that mask is this player's, plus the vision recomputed from the board as it
    // stands (a mask kept incrementally can lag behind it: a competitive ranged wall kill does not refresh the fog).
    currentVisibility(scout) {
        let visible = scout.visible
        let ownMask = grid.fogOfWar && grid.fogOfWar.length === scout.n && (gameSettings.coop ?
            scout.shared && gameSettings.coop.humanSlots && players[gameSettings.coop.humanSlots[0]] &&
                players[gameSettings.coop.humanSlots[0]].isAlliedWith(scout.player) :
            scout.p === whooseTurn)
        for (let x = 0; x < scout.n; ++x) {
            let column = ownMask ? grid.fogOfWar[x] : null
            for (let y = 0; y < scout.m; ++y)
                visible[x * scout.m + y] = (column ? column[y] > 0 : grid.arr[x][y].building.isAlwaysVisible) ? 1 : 0
        }
        let sources = scout.unitSources.concat(scout.suburbSources).map(source =>
            RevealScout.withIgnore(scout, source, null))
        RevealScout.vision(scout, sources, null, index => { visible[index] = 1 })
    },

    // A source's barrier flag on the board after the action: a removed building leaves an Empty cell.
    withIgnore(scout, source, removed) {
        let building = removed && removed.has(source.index) ? null : RevealScout.buildingAt(scout, source.index)
        return {index: source.index, range: source.range, ignore: Boolean(building && building.rangeIncrease)}
    },

    // VisionWay.changeFogOfWarByVision for many sources at once (the union of their single-source searches): a
    // source always expands, any other cell stops the search when it is the hexagonal map edge or, unless the source
    // ignores barriers, a barrier that is not `removed`. Budgets are processed from the largest down, so every cell
    // expands once with the largest budget any source brings to it. `visit(index)` gets every seen cell.
    vision(scout, sources, removed, visit) {
        for (let ignore of [false, true]) {
            let group = sources.filter(source => source.ignore === ignore && source.range >= 0)
            if (group.length)
                RevealScout.visionGroup(scout, group, ignore, removed, visit)
        }
    },

    visionGroup(scout, sources, ignore, removed, visit) {
        let epoch = RevealScout.nextEpoch()
        let stamp = scout.stamp
        let budget = scout.budget
        let nbr = scout.nbr
        let maxRange = 0
        for (let source of sources)
            maxRange = Math.max(maxRange, source.range)
        let buckets = []
        for (let b = 0; b <= maxRange; ++b)
            buckets.push([])
        // budget[] holds the expansion budget of a cell + 1 (0 = seen, never expands); stamp[] marks this search.
        const reach = (index, b, isSource) => {
            if (stamp[index] !== epoch) {
                stamp[index] = epoch
                budget[index] = 0
                visit(index)
                ++scout.visits
            }
            if (!isSource && RevealScout.stopsVision(scout, index, ignore, removed))
                return
            if (b + 1 > budget[index]) {
                budget[index] = b + 1
                buckets[b].push(index)
            }
        }
        for (let source of sources)
            reach(source.index, source.range, true)
        for (let b = maxRange; b > 0; --b) {
            let bucket = buckets[b]
            for (let i = 0; i < bucket.length; ++i) {
                let v = bucket[i]
                if (budget[v] !== b + 1)
                    continue
                for (let k = v * 6; k < v * 6 + 6; ++k) {
                    if (nbr[k] >= 0)
                        reach(nbr[k], b - 1, false)
                }
            }
        }
    },

    stopsVision(scout, index, ignore, removed) {
        let building = RevealScout.buildingAt(scout, index)
        if (building.isMapEdge)
            return true
        return !ignore && !(removed && removed.has(index)) && building.isBarrier()
    },

    // Cells within `radius` steps of `index` on the bare grid (no obstacles): visit(cell) -> true stops early.
    disk(scout, centres, radius, visit) {
        let epoch = RevealScout.nextEpoch()
        let stamp = scout.stamp
        let dist = scout.dist
        let queue = scout.queue
        let head = 0
        let tail = 0
        for (let centre of centres) {
            if (stamp[centre] === epoch)
                continue
            stamp[centre] = epoch
            dist[centre] = 0
            queue[tail++] = centre
        }
        while (head < tail) {
            let v = queue[head++]
            if (visit(v, dist[v]))
                return true
            if (dist[v] >= radius)
                continue
            for (let k = v * 6; k < v * 6 + 6; ++k) {
                let t = scout.nbr[k]
                if (t < 0 || stamp[t] === epoch)
                    continue
                stamp[t] = epoch
                dist[t] = dist[v] + 1
                queue[tail++] = t
            }
        }
        return false
    },

    collect(scout) {
        RevealScout.quietly(() => {
            for (let unit of scout.player.units) {
                if (!RevealScout.isLive(unit) || unit.playerColor !== scout.p)
                    continue
                ++scout.units
                RevealScout.unitActions(scout, unit)
            }
        })
        RevealScout.suburbPurchases(scout)
        RevealScout.ownBarrierDestroys(scout)

        // Plain moves and kill-moves: one multi-source search per barrier mode, barriers as they stand.
        RevealScout.vision(scout, scout.moveSources.plain.concat(scout.moveSources.ignore), null,
            index => RevealScout.mark(scout, index, 'move'))
        for (let event of scout.events)
            RevealScout.runEvent(scout, event)
    },

    // Way.create resets the grid's logic text and turns its drawing on (Grid.newLogicText): keep the display as it is.
    quietly(run) {
        let drawLogicText = grid.drawLogicText
        let hasOwn = Object.prototype.hasOwnProperty.call(grid, 'newLogicText')
        let own = grid.newLogicText
        grid.newLogicText = function() {}
        try {
            run()
        } finally {
            if (hasOwn)
                grid.newLogicText = own
            else
                delete grid.newLogicText
            grid.drawLogicText = drawLogicText
        }
    },

    // A cell counts once in the set and once for every source that reveals it (bySource).
    mark(scout, index, kind) {
        if (scout.visible[index])
            return
        scout.revealed[index] = 1
        scout.source[index] |= RevealScout.SOURCE_BITS[kind]
    },

    SOURCE_BITS: {move: 1, attack: 2, capture: 4, suburb: 8, wallKill: 16, destroy: 32},

    isRangeInteraction(interaction) {
        return typeof InteractionWithRangeUnit === 'function' && interaction instanceof InteractionWithRangeUnit
    },

    isSiegeInteraction(interaction) {
        return typeof InteractionWithCatapult === 'function' && interaction instanceof InteractionWithCatapult
    },

    unitActions(scout, unit) {
        let interaction = unit.interaction
        if (!interaction || !(interaction.moves > 0))
            return
        let isRange = RevealScout.isRangeInteraction(interaction)
        if (isRange && typeof interaction.updateRange === 'function')
            interaction.updateRange(unit)
        let moves = interaction.moves
        let reachRadius = Math.max(moves, isRange ? interaction.range : 0) + 1
        let origin = RevealScout.index(scout, unit.coord)

        let allVisible = !RevealScout.disk(scout, [origin], moves + unit.visionRange + 1,
            index => !scout.visible[index])
        if (allVisible && !RevealScout.disk(scout, [origin], reachRadius,
                index => RevealScout.hasEnemyEntity(scout, index, unit))) {
            ++scout.skippedUnits
            return
        }

        // select(): the move search with the moves left (and the range search of a ranged unit).
        let way = interaction.way
        let destinations = way.create(unit.coord, moves, grid.arr, scout.p, RevealScout.border)
        if (isRange)
            interaction.rangeWay.create(unit.coord, interaction.range, grid.arr, scout.p, RevealScout.border)

        for (let d of destinations) {
            if (coordsEqually(d, unit.coord))
                continue
            let cell = grid.arr[d.x][d.y]
            if (!way.cellHasEnemyEntity(cell, scout.p)) {
                if (!allVisible && RevealScout.canMoveOnto(interaction, unit, cell))
                    RevealScout.addMoveSource(scout, unit, d, null)
                continue
            }
            if (!isRange)
                RevealScout.meleeAttack(scout, unit, interaction, cell, allVisible)
        }
        if (isRange)
            RevealScout.rangedBarrierShots(scout, unit, interaction)
    },

    hasEnemyEntity(scout, index, unit) {
        let x = Math.floor(index / scout.m)
        let y = index % scout.m
        let cell = grid.arr[x][y]
        let building = cell.building
        return (cell.unit.notEmpty() && !unit.player.isAlliedWith(cell.unit.player)) ||
            (building.notEmpty() && !building.isNature && !unit.player.isAlliedWith(building.player))
    },

    // The sendInstructions branches that end in a move for a cell without an enemy entity.
    canMoveOnto(interaction, unit, cell) {
        if (!RevealScout.isRangeInteraction(interaction))
            return true
        if (cell.building.isStaticNature || cell.unit.notEmpty())
            return false
        let enemyProduction = interaction.cellHasEnemyBuildingProduction(cell, unit)
        if (typeof InteractionWithBombard === 'function' && interaction instanceof InteractionWithBombard)
            return !enemyProduction && !interaction.cellHasEnemyBuilding(cell, unit)
        // Archers and catapults shoot at an enemy production in range instead of moving onto it.
        return !(enemyProduction && !interaction.cantRangeInteract(cell.coord, unit))
    },

    addMoveSource(scout, unit, coord, building) {
        if (building === null)
            building = grid.getBuilding(coord)
        let source = {index: RevealScout.index(scout, coord), range: unit.visionRange,
            ignore: Boolean(building && building.rangeIncrease)}
        scout.moveSources[source.ignore ? 'ignore' : 'plain'].push(source)
    },

    // entity.hit(dmg) on a stand-in (same prototype and fields, kill() only flags it): the real damage rules
    // without touching the board.
    probeHit(entity, dmg) {
        // Own property descriptors: a portal's ownerSlot is a non-enumerable own property.
        let probe = Object.create(Object.getPrototypeOf(entity), Object.getOwnPropertyDescriptors(entity))
        Object.defineProperty(probe, 'updateHPBar', {value: function() {}, configurable: true, writable: true})
        Object.defineProperty(probe, 'kill', {value: function() { this.killed = true }, configurable: true,
            writable: true})
        probe.hit(dmg)
        return probe
    },

    // InterationWithUnit.move on an enemy cell: hitIfCellHasEnemy, then cantStandOnCell on the result.
    meleeAttack(scout, unit, interaction, cell, allVisible) {
        let building = cell.building
        let target = cell.unit
        let buildingAfter = building
        let unitAfter = target
        let buildingKilled = false
        let hitUnit = true
        if (interaction.cellHasEnemyBuilding(cell, unit) && !interaction.demonShieldsPortal(cell, unit) &&
                building.isHitable) {
            let probe = RevealScout.probeHit(building, unit.dmg)
            buildingKilled = Boolean(probe.killed)
            buildingAfter = buildingKilled ? new Empty() : probe
            hitUnit = false
        }
        if (hitUnit && interaction.cellHasEnemyUnit(cell, unit)) {
            if (RevealScout.probeHit(target, unit.dmg).killed)
                unitAfter = new Empty()
        }
        let after = {building: buildingAfter, unit: unitAfter, coord: cell.coord, hexagon: cell.hexagon}
        let stands = !interaction.cantStandOnCell(after, unit)
        let removed = buildingKilled && building.isBarrier() ? [RevealScout.index(scout, cell.coord)] : []
        let standCoord = stands ? cell.coord : interaction.way.getParent(cell.coord)
        let captures = stands && !buildingKilled && typeof building.isTown === 'function' && building.isTown() &&
            building.playerColor != scout.p
        if (captures) {
            RevealScout.captureEvent(scout, unit, interaction, cell, removed)
            return
        }
        let moved = !coordsEqually(standCoord, unit.coord)
        if (!removed.length) {
            if (moved && stands && !allVisible)
                RevealScout.addMoveSource(scout, unit, standCoord, buildingKilled ? null : buildingAfter)
            // A failed attack ends on the path's parent, a destination of its own.
            return
        }
        // The attacker is re-added where it stands (its old place when the attack ends on it).
        let newSources = [{index: RevealScout.index(scout, standCoord), range: unit.visionRange}]
        scout.events.push({kind: 'attack', removed: removed, newSources: newSources, mover: unit})
    },

    // Town.updatePlayer -> updateSuburbsAndBuildings after paintHexagons repainted the path and the town cell.
    captureEvent(scout, unit, interaction, cell, removed) {
        let town = cell.building
        let previousColor = town.playerColor
        let path = new Set()
        let coord = {x: cell.coord.x, y: cell.coord.y}
        while (!coordsEqually(coord, unit.coord)) {
            path.add(RevealScout.index(scout, coord))
            let parent = interaction.way.getParent(coord)
            if (coordsEqually(parent, coord))
                break
            coord = parent
        }
        let townIndex = RevealScout.index(scout, cell.coord)
        let newSources = [{index: townIndex, range: unit.visionRange, ignore: true}]
        for (let suburb of town.suburbs) {
            let index = RevealScout.index(scout, suburb.coord)
            let suburbCell = grid.getCell(suburb.coord)
            let colour = path.has(index) ? scout.p : suburbCell.hexagon.playerColor
            if (colour != previousColor && colour != scout.p)
                continue
            if (typeof isLiveDemonPortal === 'function' && isLiveDemonPortal(suburbCell.building))
                continue
            // The defender killed on the town cell has left it; the attacker has not arrived yet.
            let occupant = index === townIndex ? new Empty() : suburbCell.unit
            if (occupant.notEmpty())
                continue
            let building = suburbCell.building
            if (index !== townIndex && building.notEmpty() && building.isBarrier() && building.canBeDestroyed &&
                    building.name !== 'goldmine' && !building.isNature)
                removed = removed.concat([index])
            if (scout.shared && !suburb.isSuburb)
                continue
            newSources.push({index: index, range: SUBURBSVISIONRANGE, ignore: false})
        }
        scout.events.push({kind: 'capture', removed: removed, newSources: newSources, mover: unit})
    },

    // Ranged shots (InteractionWithRangeUnit / InteractionWithCatapult / InteractionWithBombard sendInstructions)
    // that kill an enemy barrier: visible cells only, a barrier in fog hides nothing any viewer could see past.
    rangedBarrierShots(scout, unit, interaction) {
        let siege = RevealScout.isSiegeInteraction(interaction)
        let origin = RevealScout.index(scout, unit.coord)
        RevealScout.disk(scout, [origin], interaction.range, index => {
            if (!scout.visible[index] || index === origin)
                return false
            let cell = grid.arr[Math.floor(index / scout.m)][index % scout.m]
            let building = cell.building
            if (building.isEmpty() || !building.isBarrier() || building.isStaticNature || !building.isHitable)
                return false
            if (interaction.cantRangeInteract(cell.coord, unit) || unit.player.ignoresCell(cell))
                return false
            if (!interaction.cellHasEnemyBuilding(cell, unit) || interaction.demonShieldsPortal(cell, unit))
                return false
            if (building.isBuildingProduction())
                return false
            if (siege && interaction.isBlindArea(cell.coord))
                return false
            let probe = RevealScout.probeHit(building, siege ? unit.buildingDMG : unit.dmg)
            if (probe.killed)
                scout.events.push({kind: 'wallKill', removed: [index], newSources: [], mover: null})
            return false
        })
    },

    // ActionApi.build for 'suburb': prepare (economy, not badly damaged, the base cost), then a cell of
    // SuburbProduction.paintTownBorders' offer that the town can pay for at its distance cost.
    suburbPurchases(scout) {
        let player = scout.player
        let config = typeof production !== 'undefined' ? production.suburb : null
        if (!config || player.economyEnabled === false)
            return
        let helper = new SuburbProduction(config.turns, config.cost, config.class, 'suburb')
        let arr = grid.arr
        for (let town of player.towns) {
            if (!RevealScout.isLive(town) || town.playerColor !== scout.p || town.isBadlyDamaged ||
                    town.gold < config.cost)
                continue
            let ourSuburbs = helper.getSuburbKeys(town.suburbs)
            let offered = new Set()
            for (let suburb of town.suburbs) {
                for (let neighbour of suburb.neighbours) {
                    if (isCoordNotOnMap(neighbour, scout.n, scout.m) || arr[neighbour.x][neighbour.y].building.isMapEdge ||
                            grid.getHexagon(neighbour).playerColor != scout.p ||
                            helper.isSuburb(neighbour, arr, scout.p))
                        continue
                    offered.add(RevealScout.index(scout, neighbour))
                }
            }
            if (!offered.size)
                continue
            let distance = helper.getDistances(town, arr, scout.p)
            let sources = []
            for (let index of offered) {
                let coord = RevealScout.coordOf(scout, index)
                if (town.gold >= helper.suburbsCostformula(distance[coord.x][coord.y]))
                    sources.push({index: index, range: SUBURBSVISIONRANGE, ignore: false})
            }
            RevealScout.vision(scout, sources, null, index => RevealScout.mark(scout, index, 'suburb'))
        }
    },

    // ActionApi.destroy of an own barrier (wall, tower, bastion, bush, hill, a recently captured town).
    ownBarrierDestroys(scout) {
        for (let x = 0; x < scout.n; ++x) {
            for (let y = 0; y < scout.m; ++y) {
                let building = grid.arr[x][y].building
                if (!RevealScout.isLive(building) || !building.isBarrier() || building.playerColor !== scout.p ||
                        !building.canBeDestroyed || building.isMapEdge)
                    continue
                let index = x * scout.m + y
                if (!scout.visible[index])
                    continue
                scout.events.push({kind: 'destroy', removed: [index], newSources: [], mover: null})
            }
        }
    },

    // Vision after an action that removes barriers: the new sources plus every current viewer source that can reach
    // a removed cell (the others see exactly what they saw), with the barrier flags of the board after it.
    runEvent(scout, event) {
        let removed = new Set(event.removed)
        let sources = event.newSources.map(source => source.ignore === undefined ?
            RevealScout.withIgnore(scout, source, removed) : source)
        if (removed.size) {
            let maxRange = 0
            for (let source of scout.unitSources)
                maxRange = Math.max(maxRange, source.range)
            let near = new Map()
            RevealScout.disk(scout, Array.from(removed), maxRange, (index, distance) => {
                near.set(index, distance)
                return false
            })
            for (let source of scout.unitSources.concat(scout.suburbSources)) {
                if (event.mover && source.unit === event.mover)
                    continue
                let distance = near.get(source.index)
                if (distance !== undefined && distance <= source.range)
                    sources.push(RevealScout.withIgnore(scout, source, removed))
            }
        }
        let kind = event.kind
        RevealScout.vision(scout, sources, removed, index => RevealScout.mark(scout, index, kind))
    },

    finish(scout, result) {
        for (let index = 0; index < scout.size; ++index) {
            if (!scout.revealed[index])
                continue
            result.cells.push(RevealScout.coordOf(scout, index))
            for (let kind in RevealScout.SOURCE_BITS) {
                if (scout.source[index] & RevealScout.SOURCE_BITS[kind])
                    ++result.bySource[kind]
            }
        }
        result.stats = {units: scout.units, skippedUnits: scout.skippedUnits, events: scout.events.length,
            visits: scout.visits}
    }
}

function revealableByOneAction(playerIndex) {
    return RevealScout.compute(playerIndex).cells
}
