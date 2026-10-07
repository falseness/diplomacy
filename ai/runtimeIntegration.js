const AiRuntime = {
    // Only trainModelByHumanData reads human commands, and only in the vs-AI
    // mode that records the AI opponent's choices; each entry is a full board
    // snapshot, so other modes (hotseat, co-op, online) must not keep them.
    isRecordingHumanCommands() {
        const opponent = players[2]
        return Boolean(opponent && Array.isArray(opponent.chosenGrids))
    },
    recordHumanCommand() {
        if (!this.isRecordingHumanCommands()) return
        humanCommands.push(vectoriseGrid())
        console.log('added human command')
    },
    // Keyboard and button undo: drop the last command only if an action was
    // actually undone.
    undoHumanCommand() {
        if (!actionManager.undo()) return
        ActionRecorder.record({t: 'undo'})
        if (!humanCommands.length) return
        humanCommands.pop()
        console.log('pop human command')
    },
    clearHumanCommands() {
        humanCommands.length = 0
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
