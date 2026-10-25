// The load screen's card of save slot index (LoadSlotsPanel) from what the slot stores (loadSlotInfo): each player's
// color, whooseTurn, gameRound, isFogOfWar and gameSettings.coop.demonSlot. Saves store no map name, so the title is
// always 'Hot seat game'. An empty slot's row has no id (no action).
function loadSlotRow(index, info) {
    if (info.whooseTurn == -1)
        return {kind: 'emptySlot', id: null, slot: index}
    const players = JSON.parse(info.players), turn = JSON.parse(info.whooseTurn)
    const coop = info.gameSettings ? JSON.parse(info.gameSettings).coop : null
    const colour = index => rgbToHex(players[index].color.r, players[index].color.g, players[index].color.b)
    // The neutral slot 0 and co-op's demon slot are not players.
    const slots = players.map((player, i) => i).filter(i => i > 0 && !(coop && i === coop.demonSlot))
    return {
        kind: 'save', id: index, slot: index, title: 'Hot seat game', mode: coop ? 'co-op' : 'competitive',
        tags: [slots.length === 1 ? '1 player' : `${slots.length} players`, ...(JSON.parse(info.fogOfWar) ? ['fog'] : [])],
        round: JSON.parse(info.gameRound),
        players: slots.map(i => ({colour: colour(i), toMove: i === turn})),
        mover: {colour: colour(turn), text: coop && turn === coop.demonSlot ? 'demons to move' : 'to move'},
    }
}
