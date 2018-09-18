class Empty
{
    isEmpty()
    {
        return true
    }
    select()
    {
        selected = false
    }
    getInfo()
    {
        EntityInterface.hide()
        return {
            name: '',
            player: 0,
            info: []
        }
    }
    getHexColor()
    {
        return '#D0D0D0'
    }
}