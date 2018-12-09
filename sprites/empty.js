class Empty
{
    constructor()
    {
        this.player = 0
    }
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
        entityInterface.hide()
        return {
            name: '',
            player: 0,
            info: 
            {
                
            }
        }
    }
    getHexColor()
    {
        return '#D0D0D0'
    }
    nextTurn(whooseTurn)
    {
        
    }
}