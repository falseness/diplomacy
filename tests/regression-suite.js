(async () => {
    const results = []
    const assert = (condition, message) => {
        if (!condition)
            throw new Error(message)
    }
    const equal = (actual, expected, message) => {
        const actualJson = JSON.stringify(actual)
        const expectedJson = JSON.stringify(expected)
        if (actualJson != expectedJson)
            throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
    }
    const test = async (name, callback) => {
        try {
            await callback()
            results.push({name, passed: true, details: ''})
        }
        catch (error) {
            results.push({name, passed: false, details: error.stack || String(error)})
        }
    }
    const startMap = map => {
        isFogOfWar = false
        gameSettings.isOnline = false
        map.start(GameManager, false)
        GameManager.initValues()
        whooseTurn = 1
        nextTurnPauseInterface.visible = false
        gameEvent.waitingMode = false
        gameEvent.selected = new Empty()
    }
    const countMask = () => {
        let count = 0
        for (let x = 0; x < grid.arr.length; ++x)
            for (let y = 0; y < grid.arr[x].length; ++y)
                count += grid.arr[x][y].building.isMapEdge ? 1 : 0
        return count
    }
    const findEmptyTownCell = town => {
        for (const hexagon of town.suburbs) {
            const cell = grid.getCell(hexagon.coord)
            if (!coordsEqually(hexagon.coord, town.coord) && cell.building.isEmpty() && cell.unit.isEmpty())
                return cell
        }
        throw new Error('no empty town cell found')
    }
    const findEmptyNeighbour = coord => {
        for (const neighbour of grid.getHexagon(coord).neighbours) {
            if (isCoordNotOnMap(neighbour, grid.arr.length, grid.arr[0].length))
                continue
            const cell = grid.getCell(neighbour)
            if (!cell.building.isMapEdge && !cell.building.isObstacle(1) && cell.unit.isEmpty())
                return cell
        }
        throw new Error('no empty neighbour found')
    }
    const combatSetup = () => {
        startMap(maps['open field'][1])
        const attacker = players[1].units.find(candidate => !candidate.killed)
        const target = findEmptyNeighbour(attacker.coord)
        target.hexagon.firstpaint(2)
        return {attacker, target, source: {...attacker.coord}, targetHex: target.hexagon.toUndoJSON()}
    }
    const prepareBuilding = name => {
        const town = players[1].towns[0]
        const initialGold = town.gold
        assert(town.prepare(name), `${name} preparation did not start`)
        const available = town.activeProduction.availableHexagons
        assert(available && available.length, `${name} has no placement cell`)
        const target = available
            .map(hexagon => grid.getCell(hexagon.coord))
            .find(cell => town.activeProduction.canCreateOnCell(cell, town))
        assert(target, `${name} has no valid placement cell`)
        const coord = target.coord
        town.sendInstructions(grid.getCell(coord))
        return {town, coord, initialGold}
    }

    await test('rectangular maps use rectangular mode', () => {
        startMap(maps['open field'][0])
        equal(gameSettings.mapShape, {type: 'rectangular'}, 'default map shape')
        equal([grid.arr.length, grid.arr[0].length], [21, 21], 'rectangular backing size')
        equal(countMask(), 0, 'rectangular edge-mask count')
    })

    await test('rectangular sudden death floods the perimeter', () => {
        startMap(maps['open field'][0])
        const flooded = new Set()
        players[0].floodCell = (x, y) => flooded.add(`${x},${y}`)
        gameRound = suddenDeathRound
        players[0].suddenDeath()
        equal(flooded.size, 80, 'first 21x21 rectangular perimeter')
    })

    await test('hexagonal map creates a complete invisible edge mask', () => {
        startMap(maps['open field'][1])
        equal(gameSettings.mapShape.type, 'hexagonal', 'hex map type')
        equal([grid.arr.length, grid.arr[0].length], [26, 26], 'hex backing size')
        equal(countMask(), 169, 'invisible edge count')
        equal(26 * 26 - countMask(), 507, 'playable cell count')
        for (let x = 0; x < grid.arr.length; ++x) {
            for (let y = 0; y < grid.arr[x].length; ++y) {
                const edge = Boolean(grid.arr[x][y].building.isMapEdge)
                equal(edge, getHexagonalLayer(x, y, gameSettings.mapShape.center) > gameSettings.mapShape.radius, `mask membership ${x},${y}`)
            }
        }
    })

    await test('invisible mountains are impassable and not rendered as entities', () => {
        startMap(maps['open field'][1])
        const edge = grid.arr.flatMap(column => column.map(cell => cell.building)).find(building => building.isMapEdge)
        assert(edge instanceof InvisibleMountain, 'edge is not an InvisibleMountain')
        assert(edge.isObstacle(), 'edge mountain is not an obstacle')
        assert(!edge.isPassable, 'edge mountain is passable')
        assert(edge.isBarrier(), 'edge mountain does not block ranged paths')
        assert(!grid.isCacheableBuilding(edge), 'edge mountain entered the render cache')
        assert(unpacker.buildingClass.invisibleMountain === InvisibleMountain, 'save loader lacks invisible mountain class')
    })

    await test('hexagonal sudden death floods equal rings and towns together', () => {
        startMap(maps['open field'][1])
        const towns = players.slice(1).map(player => player.towns[0].coord)
        equal(towns.map(town => getHexagonalLayer(town.x, town.y, gameSettings.mapShape.center)), [8, 8, 8], 'town radial layers')
        const townKeys = new Set(towns.map(town => `${town.x},${town.y}`))
        const townCycles = {}
        const flooded = new Set()
        const shellSizes = []
        players[0].floodCell = (x, y) => {
            const key = `${x},${y}`
            assert(!grid.arr[x][y].building.isMapEdge, `edge mask flooded at ${key}`)
            assert(!flooded.has(key), `cell flooded twice at ${key}`)
            flooded.add(key)
            shellSizes[shellSizes.length - 1]++
            if (townKeys.has(key))
                townCycles[key] = (gameRound - suddenDeathRound) / 2
        }
        for (let cycle = 0; cycle < 13; ++cycle) {
            shellSizes.push(0)
            gameRound = suddenDeathRound + cycle * 2
            players[0].suddenDeath()
        }
        equal(shellSizes, [75,69,63,57,51,45,39,33,27,21,15,9,3], 'radial shell sizes')
        equal(Object.values(townCycles).sort(), [5,5,5], 'town flood cycles')
        equal(flooded.size, 507, 'all playable cells flooded once')
    })

    await test('new games clear stale undo history', () => {
        startMap(maps['open field'][1])
        actionManager.startAction('unit')
        equal(actionManager.arr.length, 1, 'precondition undo size')
        startMap(maps['open field'][0])
        equal(actionManager.arr.length, 0, 'undo size after new game')
    })

    await test('unit movement undo restores unit, moves, and ownership', () => {
        startMap(maps['open field'][1])
        const unit = players[1].units.find(candidate => !candidate.killed)
        const source = {...unit.coord}
        const target = findEmptyNeighbour(source)
        const targetHex = target.hexagon.toUndoJSON()
        unit.select()
        unit.sendInstructions(target)
        assert(coordsEqually(unit.coord, target.coord), 'unit did not move')
        equal(actionManager.arr.length, 1, 'movement undo count')
        actionManager.undo()
        const restored = grid.getUnit(source)
        assert(restored instanceof Noob, 'source unit was not restored')
        equal(restored.moves, restored.speed, 'restored unit moves')
        assert(grid.getUnit(target.coord).isEmpty(), 'target unit was not cleared')
        equal(target.hexagon.toUndoJSON(), targetHex, 'target hex ownership')
        equal(countMask(), 169, 'mask after movement undo')
    })

    await test('skip-moves undo restores movement points', () => {
        startMap(maps['open field'][1])
        const unit = players[1].units.find(candidate => !candidate.killed)
        unit.skipMoves()
        equal(unit.moves, 0, 'moves after skip')
        actionManager.undo()
        equal(grid.getUnit(unit.coord).moves, unit.speed, 'moves after undo')
    })

    await test('combat undo restores a damaged surviving unit', () => {
        const {attacker, target, source, targetHex} = combatSetup()
        const defender = new Noob(target.coord.x, target.coord.y)
        attacker.select()
        attacker.sendInstructions(target)
        equal(defender.hp, defender.maxHP - attacker.dmg, 'defender damage')
        actionManager.undo()
        const restoredAttacker = grid.getUnit(source)
        const restoredDefender = grid.getUnit(target.coord)
        equal(restoredAttacker.hp, restoredAttacker.maxHP, 'attacker hp after undo')
        equal(restoredAttacker.moves, restoredAttacker.speed, 'attacker moves after undo')
        equal(restoredDefender.hp, restoredDefender.maxHP, 'defender hp after undo')
        equal(target.hexagon.toUndoJSON(), targetHex, 'defender hex after undo')
    })

    await test('combat undo resurrects a killed unit', () => {
        const {attacker, target, source, targetHex} = combatSetup()
        const defender = new Noob(target.coord.x, target.coord.y)
        defender.hp = attacker.dmg
        defender.updateHPBar()
        attacker.select()
        attacker.sendInstructions(target)
        assert(grid.getUnit(target.coord) === attacker, 'attacker did not occupy defeated unit cell')
        actionManager.undo()
        assert(grid.getUnit(source) instanceof Noob, 'attacker not restored after kill undo')
        const restoredDefender = grid.getUnit(target.coord)
        assert(restoredDefender instanceof Noob, 'defender not resurrected')
        equal(restoredDefender.hp, attacker.dmg, 'defender pre-attack hp')
        equal(target.hexagon.toUndoJSON(), targetHex, 'captured hex after kill undo')
    })

    await test('combat undo restores a damaged building', () => {
        const {attacker, target, source, targetHex} = combatSetup()
        const wall = new Wall(target.coord.x, target.coord.y)
        attacker.select()
        attacker.sendInstructions(target)
        equal(wall.hp, wall.maxHP - attacker.dmg, 'wall damage')
        actionManager.undo()
        assert(grid.getUnit(source) instanceof Noob, 'attacker not restored after building undo')
        const restoredWall = grid.getBuilding(target.coord)
        assert(restoredWall instanceof Wall, 'wall not restored')
        equal(restoredWall.hp, restoredWall.maxHP, 'wall hp after undo')
        equal(target.hexagon.toUndoJSON(), targetHex, 'wall hex after undo')
    })

    await test('capture undo restores town ownership and player indexes', () => {
        const {attacker, target, source, targetHex} = combatSetup()
        const town = new Town(target.coord.x, target.coord.y, false, -1)
        town.hp = 0
        town.updateHPBar()
        attacker.select()
        attacker.sendInstructions(target)
        equal(grid.getHexagon(target.coord).playerColor, 1, 'captured town owner')
        actionManager.undo()
        assert(grid.getUnit(source) instanceof Noob, 'attacker not restored after capture undo')
        const restoredTown = grid.getBuilding(target.coord)
        assert(restoredTown instanceof Town, 'town not restored after capture undo')
        equal(restoredTown.playerColor, 2, 'restored town owner')
        equal(target.hexagon.toUndoJSON(), targetHex, 'town hex after undo')
        const indexed = players.map(player => player.towns.filter(candidate => !candidate.killed && coordsEqually(candidate.coord, target.coord)).length)
        equal(indexed, [0, 0, 1, 0], 'town player indexes after undo')
    })

    await test('unit-production undo restores town and gold', () => {
        startMap(maps['open field'][1])
        const town = players[1].towns[0]
        const coord = {...town.coord}
        const gold = town.gold
        assert(town.prepare('noob'), 'unit preparation failed')
        assert(town.unitProduction.notEmpty(), 'unit production missing')
        actionManager.undo()
        const restored = grid.getBuilding(coord)
        assert(restored instanceof Town, 'town not restored after production undo')
        assert(restored.unitProduction.isEmpty(), 'unit production not cleared')
        equal(restored.gold, gold, 'gold after unit-production undo')
    })

    await test('building-placement undo restores town, target, and gold', () => {
        startMap(maps['open field'][1])
        const state = prepareBuilding('farm')
        assert(grid.getBuilding(state.coord).isBuildingProduction(), 'farm production was not placed')
        actionManager.undo()
        assert(grid.getBuilding(state.coord).isEmpty(), 'farm production target not cleared')
        const restored = grid.getBuilding(state.town.coord)
        assert(restored instanceof Town, 'town not restored after farm undo')
        equal(restored.gold, state.initialGold, 'gold after farm undo')
    })

    await test('suburb-placement undo removes suburb and restores gold', () => {
        startMap(maps['open field'][1])
        const town = players[1].towns[0]
        let candidate
        for (const suburb of town.suburbs) {
            candidate = suburb.neighbours.find(coord => !isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length) && !grid.getBuilding(coord).isMapEdge && !grid.getHexagon(coord).isSuburb && grid.getBuilding(coord).isEmpty())
            if (candidate)
                break
        }
        assert(candidate, 'no suburb expansion candidate')
        grid.getHexagon(candidate).firstpaint(1)
        const gold = town.gold
        assert(town.prepare('suburb'), 'suburb preparation failed')
        assert(town.activeProduction.availableHexagons.some(hexagon => coordsEqually(hexagon.coord, candidate)), 'candidate not offered')
        town.sendInstructions(grid.getCell(candidate))
        assert(grid.getHexagon(candidate).isSuburb, 'suburb was not created')
        actionManager.undo()
        assert(!grid.getHexagon(candidate).isSuburb, 'suburb remained after undo')
        equal(grid.getBuilding(town.coord).gold, gold, 'gold after suburb undo')
    })

    await test('destroy-building undo restores an external building', () => {
        startMap(maps['open field'][1])
        const cell = findEmptyTownCell(players[1].towns[0])
        const wall = new Wall(cell.coord.x, cell.coord.y)
        gameEvent.selected = wall
        destroySelected()
        assert(grid.getBuilding(cell.coord).isEmpty(), 'wall was not destroyed')
        actionManager.undo()
        assert(grid.getBuilding(cell.coord) instanceof Wall, 'wall was not restored')
    })

    await test('destroy-town undo restores the town', () => {
        startMap(maps['open field'][1])
        const town = players[1].towns[0]
        const coord = {...town.coord}
        town.isRecentlyCaptured = true
        gameEvent.selected = town
        destroySelected()
        assert(grid.getBuilding(coord).isEmpty(), 'town was not destroyed')
        actionManager.undo()
        assert(grid.getBuilding(coord) instanceof Town, 'town was not restored')
    })

    await test('destroy-building-production undo restores queued construction', () => {
        startMap(maps['open field'][1])
        const state = prepareBuilding('farm')
        actionManager.clear()
        const queued = grid.getBuilding(state.coord)
        gameEvent.selected = queued
        destroySelected()
        equal(actionManager.lastAction.type, 'destroyBuildingProduction', 'destroy production undo type')
        actionManager.undo()
        const restored = grid.getBuilding(state.coord)
        assert(restored.isBuildingProduction() && restored.name == 'farm', 'farm production was not restored')
    })

    await test('destroy-external-production undo restores queued wall', () => {
        startMap(maps['open field'][1])
        const state = prepareBuilding('wall')
        actionManager.clear()
        const queued = grid.getBuilding(state.coord)
        gameEvent.selected = queued
        destroySelected()
        equal(actionManager.lastAction.type, 'destroyExternalProduction', 'destroy external production undo type')
        actionManager.undo()
        const restored = grid.getBuilding(state.coord)
        assert(restored.isExternalProduction() && restored.name == 'wall', 'wall production was not restored')
    })

    await test('undo stack enforces its maximum size', () => {
        const manager = new ActionManager()
        for (let index = 0; index < manager.maximumSize + 2; ++index)
            manager.startAction(`test-${index}`)
        equal(manager.arr.length, manager.maximumSize, 'maximum undo size')
        equal(manager.arr[0].type, 'test-2', 'oldest retained action')
    })

    await test('save/load preserves hex shape, mask, units, and settings', () => {
        startMap(maps['open field'][1])
        const unit = players[1].units.find(candidate => !candidate.killed)
        unit.moves = 1
        players[1].gold = 123
        gameRound = 17
        const unitCoord = {...unit.coord}
        const snapshot = JSON.stringify(getGameObject())
        actionManager.startAction('unit')
        loadFromJson(snapshot)
        GameManager.load()
        equal(gameSettings.mapShape.type, 'hexagonal', 'loaded map type')
        equal(gameSettings.mapShape.radius, 13, 'loaded map radius')
        equal(countMask(), 169, 'loaded invisible edge count')
        equal(players[1].gold, 123, 'loaded player gold')
        equal(gameRound, 17, 'loaded game round')
        equal(grid.getUnit(unitCoord).moves, 1, 'loaded unit moves')
        equal(actionManager.arr.length, 0, 'undo history after load')
        assert(mapDepth.outline, 'map outline missing after load')
    })

    await test('slot save/load roundtrip restores a playable game', () => {
        const savedSlot = 918273
        gameSlot = savedSlot
        startMap(maps['open field'][1])
        whooseTurn = 1
        gameRound = 23
        players[1].gold = 147
        const unit = players[1].units.find(candidate => !candidate.killed)
        const unitCoord = {...unit.coord}
        unit.moves = 1
        saveManager.save()
        assert(hasSave(savedSlot), 'save slot was not written')

        startMap(maps['open field'][0])
        players[1].gold = 0
        actionManager.startAction('unit')
        load(savedSlot)

        equal(gameSettings.mapShape.type, 'hexagonal', 'slot-loaded map type')
        equal(countMask(), 169, 'slot-loaded invisible edge count')
        equal(whooseTurn, 1, 'slot-loaded active player')
        equal(gameRound, 23, 'slot-loaded round')
        equal(players[1].gold, 147, 'slot-loaded gold')
        equal(grid.getUnit(unitCoord).moves, 1, 'slot-loaded unit moves')
        equal(actionManager.arr.length, 0, 'slot load retained stale undo history')
        assert(mapDepth.outline, 'slot-loaded map outline missing')
        localStorage.clear()
    })

    await test('clicking an invisible mountain behaves like clicking outside', () => {
        startMap(maps['open field'][1])
        let edgeCell
        for (let x = 0; x < grid.arr.length && !edgeCell; ++x)
            edgeCell = grid.arr[x].find(cell => cell.building.isMapEdge)
        assert(edgeCell, 'no invisible edge cell')
        const unit = players[1].units.find(candidate => !candidate.killed)
        const coord = {...unit.coord}
        const moves = unit.moves
        unit.select()
        gameEvent.selected = unit
        const edgePos = edgeCell.pos
        assert(Number.isFinite(edgePos.x) && Number.isFinite(edgePos.y), `invalid edge position ${JSON.stringify(edgePos)}`)
        equal(getCoord(edgePos.x, edgePos.y), edgeCell.coord, 'edge position roundtrip')
        gameEvent.click({x: -100, y: -100}, edgePos)
        assert(gameEvent.selected.isEmpty(), 'edge click retained a selection')
        equal(unit.coord, coord, 'unit coordinate after edge click')
        equal(unit.moves, moves, 'unit moves after edge click')
        equal(actionManager.arr.length, 0, 'undo action created by edge click')
        assert(!entityInterface.visible && !townInterface.visible && !barrackInterface.visible, 'interface remained open after edge click')
    })

    const passed = results.filter(result => result.passed).length
    return {passed, failed: results.length - passed, results}
})()
