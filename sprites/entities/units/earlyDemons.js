// Legacy base retained only for ranged variants until TASK-078.
class EarlyMeleeDemon extends Unit {
    static get maxHP() { return DEMON_TYPES[this.type].health }
    static get dmg() { return DEMON_TYPES[this.type].damage }
    static get speed() { return DEMON_TYPES[this.type].movement }
    static healSpeed = 0
    static salary = 0
    constructor(x, y, name) {
        const slot = gameSettings.coop && gameSettings.coop.demonSlot
        if (!Number.isInteger(slot) || !players[slot] || players[slot].role !== 'DEMONS')
            throw new Error('demon unit requires demon ownership')
        super(x, y, name)
        Object.defineProperty(this, 'ownerSlot', {value: slot})
    }
    // Unit registers ownership during super(), before ownerSlot is assigned.
    get playerColor() { return this.ownerSlot === undefined ? gameSettings.coop.demonSlot : this.ownerSlot }
    get info() {
        const result = super.info
        if (EarlyMeleeDemon.visualTypes.includes(this.name)) {
            result.displayName = DEMON_TYPES[this.name].name
            result.info.owner = 'DEMONS'
        }
        return result
    }
    static visualTypes = ['spitter', 'emberArcher', 'hexcaster']
    // Normalized silhouettes are shared by map units and selection portraits.
    static drawSymbol(ctx, type, x, y, size) {
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(size, size)
        ctx.fillStyle = '#40134f'
        ctx.strokeStyle = '#f4d8ff'
        ctx.lineWidth = 0.025
        const polygon = points => {
            ctx.beginPath()
            points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        if (type === 'spitter') { // Crouched acid beast and a detached projectile.
            ctx.fillStyle = '#285c32'
            polygon([[-.4,.27],[-.3,-.05],[-.17,-.19],[.02,-.2],[.12,-.07],
                [.28,-.05],[.28,.07],[.08,.09],[.17,.28],[-.02,.28],[-.09,.13],[-.22,.28]])
            ctx.fillStyle = '#b8f35d'
            polygon([[.32,-.06],[.45,-.16],[.43,.02],[.36,.06]])
        } else if (type === 'emberArcher') { // Hood, tall bow and flaming arrow.
            ctx.fillStyle = '#783019'
            polygon([[-.31,-.12],[-.2,-.36],[-.06,-.12],[-.12,.02],[.03,.31],[-.36,.31],[-.26,.02]])
            ctx.strokeStyle = '#ffb34f'
            ctx.beginPath()
            ctx.moveTo(.13,-.35); ctx.quadraticCurveTo(.48,0,.13,.35)
            ctx.lineTo(.13,-.35)
            ctx.moveTo(-.14,0); ctx.lineTo(.4,0); ctx.stroke()
            ctx.fillStyle = '#ffb34f'
            polygon([[.3,-.06],[.47,0],[.3,.06]])
        } else if (type === 'hexcaster') { // Floating robe, staff and violet spell diamond.
            ctx.fillStyle = '#652f91'
            polygon([[-.26,-.19],[-.14,-.37],[-.02,-.19],[-.08,-.02],
                [.06,.28],[-.08,.22],[-.18,.32],[-.34,.25],[-.23,-.02]])
            ctx.strokeStyle = '#d6a4ff'
            ctx.lineWidth = .04
            ctx.beginPath(); ctx.moveTo(.22,-.2); ctx.lineTo(.22,.32); ctx.stroke()
            ctx.fillStyle = '#c585ff'
            polygon([[.22,-.4],[.34,-.27],[.22,-.14],[.1,-.27]])
        }
        ctx.restore()
    }
    drawBody(ctx) {
        const x = this.pos.x + assets.size / 2
        const y = this.pos.y + assets.size / 2
        if (EarlyMeleeDemon.visualTypes.includes(this.name)) {
            EarlyMeleeDemon.drawSymbol(ctx, this.name, x, y - assets.size * .06, assets.size * .85)
            ctx.save()
            ctx.font = `bold ${assets.size * .14}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const label = DEMON_TYPES[this.name].name
            const width = ctx.measureText(label).width + assets.size * .06
            ctx.fillStyle = '#210d31'
            ctx.fillRect(x - width / 2, y + assets.size * .29, width, assets.size * .18)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(label, x, y + assets.size * .38)
            ctx.restore()
        } else {
            ctx.save()
            ctx.fillStyle = this.player.fullColor.hex
            ctx.beginPath()
            ctx.arc(x, y, assets.size * .25, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.fillText(DEMON_TYPES[this.name].name[0], x, y)
            ctx.restore()
        }
    }
    draw(ctx) {
        this.drawBody(ctx)
        this.drawBars(ctx)
    }
}
// Keep identity and asset aliases separate from inherited unit behavior.
function registerMeleeDemon(UnitClass, type, asset) {
    UnitClass.type = type
    for (const [stat, key] of [['maxHP', 'health'], ['dmg', 'damage'], ['speed', 'movement']])
        Object.defineProperty(UnitClass, stat, {get() { return DEMON_TYPES[type][key] }})
    Object.assign(UnitClass, {healSpeed: 0, salary: 0})
    // Resolve aliases lazily so image loading and cache resizing remain standard.
    for (const registry of [assets, cachedImages])
        Object.defineProperty(registry, type, {get() { return registry[asset] }})
}
class Imp extends Noob {}
registerMeleeDemon(Imp, 'imp', 'noob')
class Clawling extends Noob {}
registerMeleeDemon(Clawling, 'clawling', 'noob')
class Hound extends KOHb {}
registerMeleeDemon(Hound, 'hound', 'KOHb')
