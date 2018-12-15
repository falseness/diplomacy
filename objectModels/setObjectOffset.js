function setObjectOffset(object, offset)
{
    object.setOffset(
    {
        x: object.getWidth() * offset.x,
        y: object.getHeight() * offset.y
    })
}