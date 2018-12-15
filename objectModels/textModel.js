function createTextByModel(model)
{
    model = setDefaultModel(model)
    
    let object = new Konva.Text({
            x: model.x,
            y: model.y,
            text: model.text,
            fontSize: model.fontSize,
            fontFamily: model.fontFamily,
            fill: model.color
        })
    setObjectOffset(object, model.offset)
    setObjectListening(object, model.listening)
    return object
}