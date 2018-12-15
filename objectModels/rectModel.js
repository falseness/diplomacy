function createRectByModel(model)
{
     model = setDefaultModel(model)
    
     this.object = new Konva.Rect({
        x: model.x,
        y: model.y,
        width: model.width,
        height: model.height,
        fill: model.color,
        stroke: model.borderColor,
        strokeWidth: model.stroke,
        cornerRadius: model.cornerRadius
    })
    setObjectOffset(object, model.offset)
    setObjectListening(object, model.listening)
    return object
}