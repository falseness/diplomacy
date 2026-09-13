// Keep identity and asset aliases separate from inherited unit behavior.
function registerDemonVariant(UnitClass, type, asset) {
    UnitClass.type = type
    for (const [stat, key] of [['maxHP', 'health'], ['dmg', 'damage'], ['speed', 'movement']])
        Object.defineProperty(UnitClass, stat, {get() { return DEMON_TYPES[type][key] }})
    if (asset === 'archer')
        Object.defineProperty(UnitClass, 'range', {get() { return DEMON_TYPES[type].range }})
    Object.assign(UnitClass, {healSpeed: 0, salary: 0})
    // Resolve aliases lazily so image loading and cache resizing remain standard.
    for (const registry of [assets, cachedImages])
        Object.defineProperty(registry, type, {get() { return registry[asset] }})
}
class Imp extends Noob {}
registerDemonVariant(Imp, 'imp', 'noob')
class Clawling extends Noob {}
registerDemonVariant(Clawling, 'clawling', 'noob')
class Hound extends KOHb {}
registerDemonVariant(Hound, 'hound', 'KOHb')
