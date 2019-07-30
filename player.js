class Player {
    constructor(color, gold = 0, neutral) {
        this.gold = gold
        this.towns = []
        this.units = []

        this.color = {
            r: color.r,
            g: color.g,
            b: color.b
        }
        if (neutral) {
            this.hexagon = this.calcSuburbHexagon()
        } else {
            this.hexagon = this.calcHexagon()
        }
        this.suburbHexagon = this.calcSuburbHexagon()
    }
    updateUnits() {
        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
            }
        }
    }
    toJSON() {
        this.updateUnits()

        let res = {}
        res.gold = this.gold
        res.towns = this.towns
        res.units = this.units
        res.color = this.color

        return res
    }
    get income() {
        let income = 0
        for (let i = 0; i < this.towns.length; ++i) {
            if (this.towns[i].killed) {
                this.towns.splice(i--, 1)
                continue
            }
            income += this.towns[i].income
        }

        if (!this.towns.length) {
            console.log("LOOSE")
        }

        for (let i = 0; i < this.units.length; ++i) {
            if (this.units[i].killed) {
                this.units.splice(i--, 1)
                continue
            }
            income -= this.units[i].salary
        }
        return income
    }
    crisisPenalty() {
        for (let i = 0; i < this.units.length; ++i) {
            this.units[i].kill()
        }
        this.units = []
    }
    nextTurn() {
        this.gold += this.income

        if (this.gold < 0) {
            this.crisisPenalty()
            this.gold = 0
        }
        for (let i = 0; i < this.units.length; ++i) {
            this.units[i].nextTurn()
        }
        for (let i = 0; i < this.towns.length; ++i) {
            this.towns[i].nextTurn()
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

        tmpCtx.fillStyle = this.hexColor
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

        tmpCtx.fillStyle = this.hexColor
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
    get textColor() {
        return (this.color.r + ', ' + this.color.g + ', ' + this.color.b)
    }
    get RGB() {
        return this.color
    }
    get hexColor() {
        return rgbToHex(this.color.r, this.color.g, this.color.b)
    }
    get fullColor() {
        let color = {
            hex: this.hexColor,
            text: this.textColor,
            rgb: this.color
        }
        return color
    }
}