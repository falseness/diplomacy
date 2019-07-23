class Player
{
    constructor(color, neutral)
    {
        this.color =
        {
            r: color.r,
            g: color.g,
            b: color.b
        }
        this.towns = []
        if (neutral) {
            this.hexagon = this.calcSuburbHexagon()
        }
        else {
            this.hexagon = this.calcHexagon()
        }
        this.suburbHexagon = this.calcSuburbHexagon()
    }
    addTown(town) {
        this.towns.push(town)
    }
    startTurn() {
        for (let i = 0; i < this.towns.length; ++i) {
            this.towns[i].startTurn()
        }
    }
    calcSuburbHexagon() {
        let tmpCanvas = document.createElement('canvas')
        
        const strokeWidth = basis.strokeWidth
        let pos = {
            x: basis.hexHalfRectWithStrokeOffset.width, 
            y: basis.hexHalfRectWithStrokeOffset.height
        } 
        tmpCanvas.width = pos.x * 2
        tmpCanvas.height = pos.y * 2
        
        let tmpCtx = tmpCanvas.getContext('2d');
        
        tmpCtx.beginPath()

        tmpCtx.fillStyle = this.getHexColor()
        tmpCtx.strokeStyle = 'black'
        tmpCtx.lineWidth = strokeWidth

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.stroke()
        tmpCtx.closePath()
        
        return tmpCanvas
    }
    calcHexagon() {
        let tmpCanvas = document.createElement('canvas')
        
        const strokeWidth = basis.strokeWidth
        let pos = {
            x: basis.hexHalfRectWithStrokeOffset.width, 
            y: basis.hexHalfRectWithStrokeOffset.height
        } 
        tmpCanvas.width = pos.x * 2
        tmpCanvas.height = pos.y * 2
        
        let tmpCtx = tmpCanvas.getContext('2d');
        
        tmpCtx.beginPath()

        tmpCtx.fillStyle = this.getHexColor()
        tmpCtx.strokeStyle = 'black'
        tmpCtx.lineWidth = strokeWidth

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.stroke()
        tmpCtx.closePath()
        
        const suburbAlpha = 0.4
        const maxRGBInt = 255
        let color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`
        
        tmpCtx.beginPath()

        tmpCtx.fillStyle = color

        tmpCtx.moveTo(pos.x + basis.r * Math.cos(0), pos.y + basis.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            tmpCtx.lineTo(pos.x + basis.r * Math.cos(i * 2 * Math.PI / 6), pos.y + basis.r * Math.sin(i * 2 * Math.PI / 6))

        tmpCtx.fill()
        tmpCtx.closePath()
        return tmpCanvas
    }
    getColor()
    {
        return (this.color.r + ', ' + this.color.g + ', ' + this.color.b)
    }
    getRGB()
    {
        return this.color
    }
    getHexColor()
    {
        return rgbToHex(this.color.r, this.color.g, this.color.b)
    }
    getFullColor()
    {
        let color = 
        {
            hex: this.getHexColor(),
            text: this.getColor(),
            rgb: this.color
        }
        return color
    }
}
