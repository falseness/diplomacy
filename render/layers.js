class Layers
{
    constructor(layers)
    {
        for (let i = 0; i < layers.length; ++i)
        {
            this[layers[i]] = new Konva.Layer()
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