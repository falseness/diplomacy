'use strict';

// Inject once per document, passing createTerminalCapture. This adapter reads
// lexical game globals, not a serialized/reconstructed board. No game getter is
// used, including for private production fields (reported as unavailable).
function installTerminalPageCapture(createCapture) {
    if (Object.hasOwn(globalThis, '__terminalPassive')) throw Error('capture already installed');
    const capture = createCapture();
    const getItem = Storage.prototype.getItem;
    const refs = new WeakMap();
    let serial = 0, retained = null;
    const own = (object, key) => {
        const d = Object.getOwnPropertyDescriptor(object, key);
        if (!d) return {absent: true};
        if (!('value' in d)) throw Error('accessor refused: ' + key);
        return d.value;
    };
    // A second, explicitly separate reference namespace covers extended storage.
    const id = value => {
        if (!refs.has(value)) refs.set(value, ++serial);
        return refs.get(value);
    };
    const fields = (object, names) => Object.fromEntries(names.map(k => {
        const value = own(object, k);
        if (value !== null && typeof value === 'object') {
            if (value.absent === true && Object.keys(value).length === 1) return [k, {absent: true}];
            throw Error('scalar storage required: ' + k);
        }
        if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null)
            throw Error('scalar storage required: ' + k);
        if (typeof value === 'number' && !Number.isFinite(value)) throw Error('finite storage required: ' + k);
        return [k, value];
    }));
    const coord = object => fields(own(object, 'coord'), ['x', 'y']);
    const list = (array, read) => {
        if (!Array.isArray(array)) throw Error('registry array required');
        const items = [];
        for (let i = 0; i < own(array, 'length'); i++) {
            if (!Object.hasOwn(array, i)) throw Error('sparse registry');
            items.push(read(own(array, String(i))));
        }
        return {ref: id(array), items};
    };
    const production = value => ({ref: id(value),
        ...fields(value, ['name', 'turns', 'cost']),
        // Production.coord is private backing storage; never invent a value.
        coord: Object.hasOwn(value, 'coord') ? coord(value) : {unavailable: 'Production.#coord'}});
    const entity = value => ({ref: id(value), ...fields(value, ['name', 'hp', 'killed']), coord: coord(value)});
    const maybe = (value, key, read) => Object.hasOwn(value, key) ? read(own(value, key)) : {absent: true};
    const town = value => ({...entity(value),
        suburbs: maybe(value, 'suburbs', a => list(a, h => ({ref: id(h), coord: coord(h),
            ...fields(h, ['playerColor', 'isSuburb'])}))),
        buildings: maybe(value, 'buildings', a => list(a, entity)),
        buildingProduction: maybe(value, 'buildingProduction', a => list(a, production)),
        activeProduction: maybe(value, 'activeProduction', production),
        unitProduction: Object.hasOwn(value, 'unitProduction') ? production(own(value, 'unitProduction')) :
            {unavailable: 'PreparingManufacture.#unitProduction'}});
    const read = () => {
        const timerStorage = [];
        for (let i = 0; i < players.length; i++) timerStorage.push(getItem.call(localStorage, gameSlot + 'timer' + i));
        const root = {players, grid, gameSettings, gameEvent, nextTurnButton, undoButton, actionManager,
            whooseTurn, gameRound, gameSlot, onlineCommit, onlineSocket, timer, timerStorage,
            oldSocket: retained ? retained.socket : null, oldTimer: retained ? retained.timer : null};
        return {schema: 'terminal-page-v1', state: capture(root),
            ui: {menu: own(menu, 'visible'), pause: own(nextTurnPauseInterface, 'visible')},
            extended: {
                towns: list(players, p => list(own(p, 'towns'), town)),
                external: list(external, entity), externalProduction: list(externalProduction, production),
                nature: list(nature, entity), goldmines: list(goldmines, entity),
            }};
    };
    const retain = () => {
        if (retained) throw Error('callbacks already retained');
        const events = ['gameStarted', 'playYourTurn', 'waitYouTurn'];
        const callbacks = events.flatMap(event => onlineSocket.listeners(event).map((fn, index) => ({event, index, fn})));
        for (const event of events) if (!callbacks.some(c => c.event === event)) throw Error('missing retained callback: ' + event);
        retained = {socket: onlineSocket, timer, callbacks};
        return callbacks.map(({event, index}) => ({event, index}));
    };
    const invoke = body => {
        if (!retained) throw Error('callbacks not retained');
        const receipts = [];
        for (const {event, index, fn} of retained.callbacks) {
            // Same bare-function invocation as the existing source-tier control.
            fn(body);
            receipts.push({event, index, returned: true});
        }
        return receipts;
    };
    Object.defineProperty(globalThis, '__terminalPassive', {value: {read, retain, invoke}});
}

module.exports = {installTerminalPageCapture};
