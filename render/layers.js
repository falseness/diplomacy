class Layers
{
    constructor(layers)
    {
        for (let i = 0; i < layers.length; ++i)
        {
            this[layers[i]] = new Konva.Layer()
            this[layers[i]].listening(false)
        }
    }
    addToStage()
    {
        for (let i in this)
        {
            stage.add(this[i])
        }
    }
}