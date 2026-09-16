const AiRuntime = {
    recordHumanCommand() {
        humanCommands.push(vectoriseGrid())
        console.log('added human command')
    },
    trainFromHumanCommands() {
        // Training compares human commands with the AI opponent's recorded
        // choices; games without that recording (hotseat, co-op) have nothing
        // to train and must still advance past an eliminated player.
        const opponent = players[2]
        if (!opponent || !Array.isArray(opponent.chosenGrids)) return
        return trainModelByHumanData()
    }
}
