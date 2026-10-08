'use strict'
const path = require('path')
const req = m => require(path.join(process.cwd(), m))
const realLog = console.log
console.log = () => {}
req('./loadGameCode.js')
const {unpackGame} = req('./roundStorage.js')
const {validateCoopSave, validateCoopSnapshot} = req('./coopSaveValidation.js')
const {MongoClient} = req('node_modules/mongodb')
console.log = realLog
const copy = v => JSON.parse(JSON.stringify(v))
const latestBoard = game => {
    const round = game.rounds[game.rounds.length - 1]
    for (let c = round.length - 1; c >= 1; --c) if (round[c].componentResult) return round[c].componentResult
    return round[0].parallelTurnResult
}
;(async () => {
    const client = await MongoClient.connect(process.env.DIPLOMACY_LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017', {readPreference: 'secondaryPreferred'})
    const db = client.db(process.env.DIPLOMACY_TEST_DB || 'gameDB')
    const results = []
    for await (const game of db.collection('games').find({}, {sort: {_id: 1}})) {
        const r = {gameID: game.gameID, rounds: game.rounds?.length, documentHash: require('crypto').createHash('sha256').update(JSON.stringify(game)).digest('hex')}
        try {
            const g = unpackGame(copy(game))
            r.coop = validateCoopSave(g)
            const last = g.rounds[g.rounds.length - 1]
            r.legacyUpgradeNeeded = !last.every(c => c.componentResult && Number.isInteger(c.nextTurnIndex))
            const board = copy(latestBoard(g))
            validateCoopSnapshot(board)
            const humans = board.players.map((_, i) => i).filter(i => i > 0 && (!board.gameSettings?.coop || i !== board.gameSettings.coop.demonSlot))
            if (!humans.includes(board.whooseTurn)) board.whooseTurn = humans[0]
            loadFromJson(JSON.stringify(board))
            const out = getGameObject()
            // The open path's prepareHumanTurnState (server/index.js), in memory only.
            if (!players[whooseTurn].isLost) { externalNextTurn(); players[whooseTurn].nextTurn() }
            getGameObject()
            r.preparedTurnFor = whooseTurn
            r.grid = [grid.arr.length, grid.arr[0].length]
            r.players = players.length
            r.towns = players.reduce((n, p) => n + p.towns.length, 0)
            r.units = players.reduce((n, p) => n + p.units.length, 0)
            r.portals = out.external.filter(e => e.name === 'demonPortal').length
            r.gameRound = board.gameRound
            r.ok = true
        } catch (e) {
            r.ok = false
            r.error = String(e && e.message || e).slice(0, 200)
        }
        realLog(JSON.stringify(r))
        results.push(r)
    }
    await client.close()
    const ok = results.filter(r => r.ok).length
    realLog(`SUMMARY games=${results.length} opened=${ok} failed=${results.length - ok} code=${process.cwd()}`)
})().catch(e => { realLog('FAIL', e.stack); process.exit(1) })
