'use strict';

// Inject once per document, passing createTerminalCapture. This adapter reads
// lexical game globals, not a serialized/reconstructed board. Only explicitly
// pinned, single-return private-field getters may supplement own descriptors.
function installTerminalPageCapture(createCapture) {
    if (Object.hasOwn(globalThis, '__terminalPassive')) throw Error('capture already installed');
    const pin = (prototype, key, expected) => {
        const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
        if (typeof getter !== 'function' ||
            Function.prototype.toString.call(getter).replace(/\s+/g, '') !== expected)
            throw Error('unreviewed private getter: ' + key);
        return object => Reflect.apply(getter, object, []);
    };
    const unitProduction = pin(PreparingManufacture.prototype, 'unitProduction',
        'getunitProduction(){returnthis.#unitProduction}');
    const productionCoord = pin(Production.prototype, 'coord', 'getcoord(){returnthis.#coord}');
    const productionTown = pin(ManufactureProduction.prototype, 'town', 'gettown(){returnthis.#town}');
    const hasPrototype = (prototype, object) => Reflect.apply(Object.prototype.isPrototypeOf, prototype, [object]);
    const privateMoves = pin(InterationWithUnit.prototype, 'moves', 'getmoves(){returnthis.#moves}');
    const movesGetter = Object.getOwnPropertyDescriptor(InterationWithUnit.prototype, 'moves').get;
    const demonGold = pin(DemonPlayer.prototype, 'gold', 'getgold(){return0}');
    const menuVisible = pin(Menu.prototype, 'visible', 'getvisible(){returnthis.#visible}');
    const pauseVisible = pin(NextTurnPauseInterface.prototype, 'visible', 'getvisible(){returnthis.#visible}');
    const readVisible = (object, getter) => Object.hasOwn(object, 'visible') ? own(object, 'visible') : getter(object);
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
        // StaticNature stores an own hp with value undefined. Preserve it
        // distinctly from an absent descriptor without invoking a getter.
        if (value === undefined) return [k, {undefined: true}];
        if (value !== null && typeof value === 'object') {
            if (value.absent === true && Object.keys(value).length === 1) return [k, {absent: true}];
            throw Error('scalar storage required: ' + k);
        }
        if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null)
            throw Error('scalar storage required: ' + k);
        if (typeof value === 'number' && !Number.isFinite(value)) throw Error('finite storage required: ' + k);
        return [k, value];
    }));
    const readCoord = object => Object.hasOwn(object, 'coord') ? own(object, 'coord') : productionCoord(object);
    const readMoves = interaction => {
        if (!hasPrototype(InterationWithUnit.prototype, interaction)) {
            const d = Object.getOwnPropertyDescriptor(interaction, 'moves');
            if (d && !('value' in d)) throw Error('unreviewed moves accessor');
            return d?.value;
        }
        let proto = interaction, descriptor;
        while (proto && !descriptor) {
            descriptor = Object.getOwnPropertyDescriptor(proto, 'moves');
            proto = Object.getPrototypeOf(proto);
        }
        // Catapult and any future override require their own reviewed route;
        // never misrepresent the base private value as an overridden getter.
        if (descriptor?.get !== movesGetter) throw Error('unreviewed moves override');
        return privateMoves(interaction);
    };
    const readGold = player => {
        if (!Object.hasOwn(player, 'gold') && hasPrototype(DemonPlayer.prototype, player)) return demonGold(player);
        const d = Object.getOwnPropertyDescriptor(player, 'gold');
        if (d && !('value' in d)) throw Error('unreviewed gold accessor');
        return d?.value;
    };
    const capture = createCapture({readCoord, readMoves, readGold});
    const coord = object => fields(readCoord(object), ['x', 'y']);
    const list = (array, read) => {
        if (!Array.isArray(array)) throw Error('registry array required');
        const items = [];
        for (let i = 0; i < own(array, 'length'); i++) {
            if (!Object.hasOwn(array, i)) throw Error('sparse registry');
            items.push(read(own(array, String(i))));
        }
        return {ref: id(array), items};
    };
    const production = value => {
        const owner = hasPrototype(ManufactureProduction.prototype, value) ? productionTown(value) : null;
        return {ref: id(value), ...fields(value, ['name', 'turns', 'cost', 'killed']),
            coord: coord(value), townRef: owner == null ? null : id(owner)};
    };
    const entity = value => ({ref: id(value), ...fields(value, ['name', 'hp', 'killed']), coord: coord(value)});
    const maybe = (value, key, read) => Object.hasOwn(value, key) ? read(own(value, key)) : {absent: true};
    const town = value => ({...entity(value),
        suburbs: maybe(value, 'suburbs', a => list(a, h => ({ref: id(h), coord: coord(h),
            ...fields(h, ['playerColor', 'isSuburb'])}))),
        buildings: maybe(value, 'buildings', a => list(a, entity)),
        buildingProduction: maybe(value, 'buildingProduction', a => list(a, production)),
        activeProduction: maybe(value, 'activeProduction', production),
        unitProduction: production(Object.hasOwn(value, 'unitProduction') ? own(value, 'unitProduction') : unitProduction(value))});
    const read = () => {
        const timerStorage = [];
        for (let i = 0; i < players.length; i++) timerStorage.push(getItem.call(localStorage, gameSlot + 'timer' + i));
        const root = {players, grid, gameSettings, gameEvent, nextTurnButton, undoButton, actionManager,
            whooseTurn, gameRound, gameSlot, onlineCommit, onlineSocket, timer, timerStorage,
            oldSocket: retained ? retained.socket : null, oldTimer: retained ? retained.timer : null};
        return {schema: 'terminal-page-v1', state: capture(root),
            ui: {menu: readVisible(menu, menuVisible), pause: readVisible(nextTurnPauseInterface, pauseVisible)},
            extended: {
                towns: list(players, p => list(own(p, 'towns'), town)),
                external: list(external, entity), externalProduction: list(externalProduction, production),
                nature: list(nature, entity), goldmines: list(goldmines, entity),
            }};
    };
    // Only fields consumed by localGameplay in the pinned next-game helper.
    // Never ask Player.isLost/isGameEnded or pack registries: those prune storage.
    const gameplay = () => {
        const value = (object, key) => {
            const v = own(object, key);
            return v && v.absent === true ? undefined : v;
        };
        const row = e => {
            const c = readCoord(e);
            const r = {name: value(e, 'name'), x: c.x, y: c.y,
                hp: value(e, 'hp') ?? null, wasHitted: value(e, 'wasHitted') ?? null};
            const interaction = value(e, 'interaction');
            if (interaction !== undefined) r.moves = readMoves(interaction);
            if (value(e, 'id') !== undefined) r.id = value(e, 'id');
            if (Object.hasOwn(e, 'unitProduction') || hasPrototype(PreparingManufacture.prototype, e)) {
                const prod = Object.hasOwn(e, 'unitProduction') ? own(e, 'unitProduction') : unitProduction(e);
                const name = value(prod, 'name');
                r.production = name && name !== 'Empty' ? {name, turns: value(prod, 'turns') ?? null} : null;
            }
            return r;
        };
        return {
            gameRound, result: gameSettings.coop ? gameSettings.coop.result ?? null : null,
            ownership: grid.arr.map(column => column.map(cell => own(own(cell, 'hexagon'), 'playerColor'))),
            players: players.map((p, index) => ({index, gold: readGold(p),
                units: own(p, 'units').map(u => ({...row(u), killed: !!value(u, 'killed')})),
                towns: own(p, 'towns').map(row)})),
            registries: {external: external.map(row), externalProduction: externalProduction.map(row),
                nature: nature.map(row), goldmines: goldmines.map(row)}
        };
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
    Object.defineProperty(globalThis, '__terminalPassive', {value: {read, gameplay, retain, invoke}});
}

module.exports = {installTerminalPageCapture};
