const AiRuntime = {
    recordHumanCommand() {
        humanCommands.push(vectoriseGrid())
        console.log('added human command')
    },
    trainFromHumanCommands() {
        return trainModelByHumanData()
    }
}
