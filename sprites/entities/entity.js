const UNDEAD_UNIT_NAMES = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
// Entity.bodyImageName's keys by entity name.
const BODY_IMAGE_NAMES = new Map()
class Entity extends Sprite {
    constructor(x, y, name) {
        super(x, y)
        this.hp = this.maxHP
        
        this.killed = this.hp <= 0

        this.hpBarMarginY = basis.r * 1.4
        
        if (this.hasBar) {
            this.hpBar = new HealthBar(
                {x: this.pos.x + assets.size / 2, 
                y: this.pos.y + assets.size / 2 + this.hpBarMarginY}, 
                this.maxHP)
        }
        
        this.wasHitted = false
        
        this.name = name
    }
    get isNature() {
        return false
    }
    get hasBar() {
        return true
    }
    updateHPBar() {
        if (this.hasBar)
            this.hpBar.repaintRects(this.hp)
    }
    get maxHP() {
        return this.constructor.maxHP
    }
    get healSpeed() {
        return this.constructor.healSpeed
    }
    get isFullHP() {
        return this.hp == this.maxHP
    }
    static get description() {
        let name = this.name[0].toLowerCase()
        for (let i = 1; i < this.name.length; ++i) {
            name += this.name[i]
        }
        let res = {
            name: name,
            info: {
                hp: this.maxHP,
            }
        }
        res.info['heal speed'] = this.healSpeed
        // The panel shows displayName; name stays the image key.
        if (this.displayName) res.displayName = this.displayName
        return res
    }
    calcPos() {
        let pos = super.calcPos()

        pos.x -= assets.size / 2
        pos.y -= assets.size / 2
        
        return pos
    }
    isObstacle() {
        return false
    }
    isExternalProduction() {
        return false
    }
    isBarrier() {
        return false
    }
    toJSON() {
        let res = {
            name: this.name,
            coord: {
                x: this.coord.x,
                y: this.coord.y
            },
            hp: this.hp,
            wasHitted: this.wasHitted
        }
        return res
    }
    updatePlayer() {}
    get playerColor() {
        return grid.getHexagon(this.coord).playerColor
    }
    get player() {
        return players[this.playerColor]
    }
    // The colour of the entity's info panel. An entity on an unknown cell (hidden-information board: public terrain
    // such as a lake on a cell the server has not sent) has player players[null], undefined (nobody's ally, see
    // Unit.cellHasTeammate and Player.isAlliedWith); its panel shows the neutral colour, players[0]'s.
    get panelColor() {
        return (this.player ?? players[0]).fullColor
    }
    get isPassable() {
        return false
    }
    get isHealing() {
        return this.hp != this.maxHP && !this.wasHitted
    }
    get hpIncrease() {
        if (this.wasHitted)
            return 0
        return Math.min(this.maxHP - this.hp, this.healSpeed)
    }
    get info() {
        let hp = this.hp
        if (this.isHealing)
            hp += ' (+' + this.hpIncrease + ')'
        hp += ' / ' + this.maxHP
        return {
            name: this.name,
            ...(this.constructor.displayName ? {displayName: this.constructor.displayName} : {}),
            bodyImageName: this.bodyImageName,
            info: {
                hp: hp
            }
        }
    }
    get isHitable() {
        return true
    }
    hit(dmg) {
        this.hp -= dmg

        this.updateHPBar()

        this.wasHitted = true

        if (this.hp <= 0)
            this.kill()

        return this.killed
    }
    get isMyTurn() {
        return this.playerColor == whooseTurn
    }
    select() {
        return true
    }
    removeSelect() {
        return true
    }
    isBuildingProduction() {
        return false
    }
    get isBuilding() {
        return false
    }
    get isUnit() {
        return false
    }
    get isStandable() {
        return false
    }
    drawBars(ctx) {
        if (otherSettings.alwaysDisplayHPBar || !this.isFullHP)
            this.hpBar.draw(ctx)
    }
    // Only classes with a mirrored ('Left') image (KOHb, Catapult and their
    // demon variants) turn mirrorX into a different image key.
    get hasMirroredImage() {
        return false
    }
    // Image key: mirrored classes (KOHb, Catapult) add 'Left'; ordinary units
    // owned by the demon slot use the undead art. Demon variants keep their own.
    get bodyImageName() {
        // The keys are built once per name: frames look them up for every cell (no new strings).
        let keys = BODY_IMAGE_NAMES.get(this.name)
        if (!keys) {
            const name = this.name
            keys = {plain: name, left: name + 'Left', undead: UNDEAD_UNIT_NAMES.includes(name),
                undeadPlain: 'undead/' + name, undeadLeft: 'undead/' + name + 'Left'}
            BODY_IMAGE_NAMES.set(name, keys)
        }
        const left = this.mirrorX && this.hasMirroredImage
        if (keys.undead && this.player?.role === 'DEMONS')
            return left ? keys.undeadLeft : keys.undeadPlain
        return left ? keys.left : keys.plain
    }
    draw(ctx) {
        drawCachedImage(ctx, cachedImages[this.bodyImageName], this.pos)
    }
    nextTurn() {
        console.log("ERROR entity next turn")
    }
}