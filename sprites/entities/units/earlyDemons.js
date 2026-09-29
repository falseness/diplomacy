// Keep configured identity and statistics separate from inherited unit behavior.
function registerDemonVariant(UnitClass, type, asset) {
    UnitClass.type = type
    for (const [stat, key] of [['maxHP', 'health'], ['dmg', 'damage'], ['speed', 'movement']])
        Object.defineProperty(UnitClass, stat, {get() { return DEMON_TYPES[type][key] }})
    if (asset === 'archer' || asset === 'catapult')
        Object.defineProperty(UnitClass, 'range', {get() { return DEMON_TYPES[type].range }})
    // DEMON_TYPES loads later, so types without buildingDamage fall back at read time.
    Object.defineProperty(UnitClass, 'buildingDMG', {get() {
        const value = DEMON_TYPES[type].buildingDamage
        return value === undefined ? Object.getPrototypeOf(UnitClass).buildingDMG : value
    }})
    Object.assign(UnitClass, {healSpeed: 0, salary: 0})
}
class Imp extends Noob {}
registerDemonVariant(Imp, 'imp', 'noob')
class Clawling extends Noob {}
registerDemonVariant(Clawling, 'clawling', 'noob')
class Hound extends KOHb {}
registerDemonVariant(Hound, 'hound', 'KOHb')
