'use strict';

// Source-tier capture primitive. Keep one instance per page across boundaries.
// Never traverse gameplay prototypes, call getters, pack boards or call toJSON.
// IDs belong to this observer session; they are not network/game unit IDs.
function createTerminalCapture() {
    const identities = new WeakMap();
    let next = 1;
    const own = (object, key) => {
        if (object === null || typeof object !== 'object') throw new Error(`object required: ${key}`);
        const d = Object.getOwnPropertyDescriptor(object, key);
        if (!d) return undefined;
        if (!('value' in d)) throw new Error(`accessor refused: ${key}`);
        return d.value;
    };
    const identity = object => {
        if (object === null || typeof object !== 'object') throw new Error('identity requires object');
        if (!identities.has(object)) identities.set(object, next++);
        return identities.get(object);
    };
    const scalar = value => {
        if (value === undefined) return {absent: true};
        if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        throw new Error('finite scalar required');
    };
    const fields = (object, keys) => Object.fromEntries(keys.map(key => [key, scalar(own(object, key))]));
    const array = (value, read) => {
        if (!Array.isArray(value)) throw new Error('array required');
        const items = [];
        for (let i = 0; i < own(value, 'length'); i++) {
            if (!Object.hasOwn(value, i)) throw new Error('sparse array refused');
            items.push(read(own(value, String(i))));
        }
        return {identity: identity(value), items};
    };
    const entity = value => {
        const interaction = own(value, 'interaction');
        return {identity: identity(value), ...fields(value, ['id', 'name', 'hp', 'killed', 'wasHitted']),
            coord: fields(own(value, 'coord'), ['x', 'y']),
            // Unit.moves is a getter; its backing storage is interaction.moves.
            moves: interaction === undefined ? {absent: true} : scalar(own(interaction, 'moves'))};
    };
    const clock = value => value === null ? null : {identity: identity(value),
        ...fields(value, ['time', 'timeAdd', 'lastPause', 'isTick'])};
    const socket = value => value === null ? null : {identity: identity(value), ...fields(value, ['id', 'connected'])};
    return root => {
        const players = own(root, 'players');
        const coop = own(own(root, 'gameSettings'), 'coop');
        const commit = own(root, 'onlineCommit');
        const result = {
            schema: 'terminal-passive-v1',
            ...fields(root, ['whooseTurn', 'gameRound', 'gameSlot']),
            players: array(players, p => ({identity: identity(p), gold: scalar(own(p, 'gold')),
                units: array(own(p, 'units'), entity), towns: array(own(p, 'towns'), entity)})),
            grid: array(own(own(root, 'grid'), 'arr'), column => array(column, cell => ({
                identity: identity(cell),
                hexagon: fields(own(cell, 'hexagon'), ['playerColor', 'isSuburb']),
                unit: entity(own(cell, 'unit')), building: entity(own(cell, 'building'))}))),
            result: coop == null ? null : scalar(own(coop, 'result')),
            waiting: scalar(own(own(root, 'gameEvent'), 'waitingMode')),
            next: fields(own(root, 'nextTurnButton'), ['canClick', 'unactive']),
            undo: fields(own(root, 'undoButton'), ['canClick']),
            undoLength: scalar(own(own(own(root, 'actionManager'), 'arr'), 'length')),
            commit: commit === null ? null : fields(commit, ['gameID', 'revision']),
            socket: socket(own(root, 'onlineSocket')), oldSocket: socket(own(root, 'oldSocket')),
            timer: clock(own(root, 'timer')), oldTimer: clock(own(root, 'oldTimer')),
            // Caller supplies raw Storage.getItem strings, never Timer.toJSON.
            timerStorage: array(own(root, 'timerStorage'), value => {
                if (value !== null && typeof value !== 'string') throw new Error('raw timer string required');
                return value;
            }).items,
        };
        if (result.timerStorage.length !== result.players.items.length) throw new Error('timer slot count mismatch');
        return result;
    };
}

module.exports = {createTerminalCapture};
