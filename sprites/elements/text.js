// The menu controls on the night sky: dark translucent plaques with a thin gold rim and light text, primary
// actions in gold with dark text, disabled ones dimmed. Menu.draw sets Text.menuTheme to it while it draws, so
// menu controls drawn anywhere else (the in-game tutorial result) keep their own look.
const MENU_THEME = {
    text: '#f3ead8',
    mutedText: '#cdc3b0',
    fontWeight: 500,
    plain: {fill: '#1a2342', alpha: 0.85, rim: '#c99a4e', text: '#f3ead8'},
    primary: {fill: '#c99a4e', alpha: 1, rim: '#f0d394', text: '#1a2342'},
    disabled: {fill: '#1a2342', alpha: 0.4, rim: '#6f6656', text: '#948d7e', dash: true},
    // List screens (online hub): the panel behind the rows, section headings, the row states.
    panel: {fill: '#0e1430', alpha: 0.6, rim: '#c99a4e', text: '#f3ead8'},
    heading: '#f0d394',
    yourTurn: {fill: '#c99a4e', alpha: 1, rim: '#f0d394', text: '#1a2342'},
    myLobby: {fill: '#245c3c', alpha: 0.95, rim: '#8fd19e', text: '#f3ead8'},
    selectedRim: '#f3ead8',
    // The rim width as a fraction of the control's own stroke width.
    rimRatio: 0.6,
}
// Font size of the menu's DOM texts (sign-in status, replays panel) in CSS px: a fraction of the screen like the
// canvas texts.
function menuDomFontSize() {
    return Math.min(WIDTH * 0.016, HEIGHT * 0.035) / devicePixelRatio
}
class Text {
    // Family of a Text without its own; the menu switches it while it draws (menu/menu.js Menu.draw).
    static defaultFamily = 'Times New Roman'
    // MENU_THEME while the menu draws, else null.
    static menuTheme = null
    constructor(x, y, fontSize = Math.round(basis.r * 9.8625 * 0.05), text = 'error', color = 'white',
        textAlign = 'center', textBaseline = 'middle', ratio = 1.2, fontFamily = undefined, fontWeight = undefined) {
        this.pos = {
            x: x,
            y: y
        }
        this.text = text

        this.color = color
        this.fontSize = fontSize
        this.textAlign = textAlign
        this.textBaseline = textBaseline
        this.selected = false
        this.ratio = ratio
        this.fontFamily = fontFamily
        this.fontWeight = fontWeight
    }
    font(fontSize = this.fontSize) {
        return (this.fontWeight ? this.fontWeight + ' ' : '') + fontSize + 'px ' + (this.fontFamily ?? Text.defaultFamily)
    }
    get right() {
        if (this.textAlign == 'left')
            return this.pos.x + this.width
        if (this.textAlign == 'right')
            return this.pos.x
        return this.pos.x + this.width / 2
    }
    get left() {
        if (this.textAlign == 'left')
            return this.pos.x
        if (this.textAlign == 'right')
            return this.pos.x - this.width
        return this.pos.x - this.width / 2
    }
    get width() {
        let max = -1
        let lines = this.text.split('\n')
        
        let tmpCtx = mainCtx
        tmpCtx.font = this.font()
        for (let i = 0; i < lines.length; ++i) {
            if (tmpCtx.measureText(lines[i]).width > max)
                max = tmpCtx.measureText(lines[i]).width
        }
        return max
    }
    get height() {
        mainCtx.font = this.font()
        // The size, not a leading weight
        return parseInt(mainCtx.font.match(/(\d+)(\.\d+)?px/)?.[1], 10)
    }
    get x() {
        return this.pos.x
    }
    set x(val) {
        this.pos.x = val
    }
    get y() {
        return this.pos.y
    }
    set y(val) {
        this.pos.y = val
    }
    // Draws in another colour and weight, keeping this Text's own.
    drawAs(ctx, color, fontWeight = this.fontWeight) {
        const {color: ownColor, fontWeight: ownWeight} = this
        this.color = color
        this.fontWeight = fontWeight
        try {
            this.draw(ctx)
        } finally {
            this.color = ownColor
            this.fontWeight = ownWeight
        }
    }
    select() {
        this.selected = true
    }
    removeSelect() {
        this.selected = false
    }
    draw(ctx) {
        let fontSize = this.fontSize
        if (this.selected)
            fontSize *= this.ratio
        ctx.font = this.font(fontSize)
        ctx.fillStyle = this.color
        ctx.textAlign = this.textAlign
        ctx.textBaseline = this.textBaseline

        let lines = this.text.split('\n')
        for (let i = 0; i < lines.length; ++i)
            ctx.fillText(lines[i], this.pos.x, this.pos.y + (i * this.height))
    }
}
class CoordText extends Sprite {
    static get defaultFontSize() {
        return Math.round(basis.r * 9.8625 * 0.05)
    }
    constructor(x, y, text, color = 'white', fontSize = CoordText.defaultFontSize,
            strokeColor = 'black', strokeWidth = 0) {
        super(x, y)
        this.color = color
        this.fontSize = fontSize
        this.text = text
        this.strokeWidth = strokeWidth
        this.strokeColor = strokeColor
    }
    draw(ctx) {
            let pos = this.pos
            ctx.font = this.fontSize + 'px Times New Roman'
            ctx.fillStyle = this.color
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"

            if (this.strokeWidth) {
                ctx.strokeStyle = this.strokeColor
                ctx.lineWidth = this.strokeWidth
                ctx.strokeText(this.text, pos.x, pos.y)
            }
            ctx.fillText(this.text, pos.x, pos.y)
            
        }
        /*createObject(model)
        {
            let pos = this.getPos()
            model.x         =   model.x         || pos.x
            model.y         =   model.y         || pos.y
            model.fontSize  =   model.fontSize  || Math.floor(basis.r * 0.5)
            model.text      =   model.text      || this.text
            model.offset    =   model.offset    || {x: 0.5, y: 0.5}
            this.object = createTextByModel(model)
            return this.object
        }*/
}