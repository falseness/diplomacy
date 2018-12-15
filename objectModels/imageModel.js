function createImageByModel(model)
{
    model = setDefaultModel(model)
    
    let object = new Konva.Image({
        x: model.x,
        y: model.y,
        width: model.width,
        height: model.height,
        image: model.image
    }) 
    setObjectOffset(object, model.offset)
    setObjectListening(object, model.listening)
    return object
}