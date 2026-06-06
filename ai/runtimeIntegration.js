const AiRuntime = {
    recordHumanCommand() {
        humanCommands.push(vectoriseGrid())
        let command = humanCommands[humanCommands.length - 1]
        console.log('added human command', predict(ai_model, [command])[0][0])
    },
    trainFromHumanCommands() {
        return trainModelByHumanData()
    }
}
