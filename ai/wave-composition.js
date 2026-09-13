// Stable v1 algorithm: round-local unsigned LCG, declaration-order weighted
// selection among unlocked types that fit the remaining strength budget.
// Configured weight is both selection weight and strength cost. No Math.random,
// surviving-player count, portal count or previous call order affects a wave.
function composeCoopWave(seed, round, initialHumanCount) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new RangeError('Invalid wave seed')
    const rules = typeof module !== 'undefined' && module.exports ? require('./wave-config') :
        {COOP_WAVE_CONFIG, getCoopWaveStrength, getUnlockedCoopDemonTypes}
    const strength = rules.getCoopWaveStrength(round, initialHumanCount)
    const unlocked = rules.getUnlockedCoopDemonTypes(round)
    let remaining = strength
    let random = (seed ^ Math.imul(round, 2654435761)) >>> 0
    const types = []
    while (remaining > 0) {
        const eligible = unlocked.filter(id => rules.COOP_WAVE_CONFIG.types[id].weight <= remaining)
        const total = eligible.reduce((sum, id) => sum + rules.COOP_WAVE_CONFIG.types[id].weight, 0)
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0
        let ticket = random / 4294967296 * total
        for (const id of eligible) {
            const weight = rules.COOP_WAVE_CONFIG.types[id].weight
            ticket -= weight
            if (ticket < 0) {
                types.push(id)
                remaining -= weight
                break
            }
        }
    }
    return {round, strength, types}
}

// gameSettings already crosses the real save/load and network serialization
// boundary. Initialize lazily for existing co-op saves; callers may supply a
// seed on first use. Subsequent calls always use the saved seed and initial roster.
function generateCoopWave(round, seed = 0) {
    const coop = gameSettings.coop
    if (!coop) throw new Error('Wave generation requires co-op')
    const saved = coop.waveGeneration || {version: 1, seed, lastRound: 0}
    if (saved.version !== 1) throw new RangeError('Unsupported wave generation version')
    const wave = composeCoopWave(saved.seed, round, coop.initialHumanCount)
    coop.waveGeneration = {version: 1, seed: saved.seed, lastRound: round}
    return wave
}

if (typeof module !== 'undefined' && module.exports) module.exports = {composeCoopWave}
