const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {transform} = require('../diagnostics/task102-bar-position.cjs');
const root = path.resolve(__dirname, '../..');
const bar = fs.readFileSync(path.join(root, 'sprites/entities/hpBar.js'), 'utf8');
const rect = fs.readFileSync(path.join(root, 'sprites/elements/rect.js'), 'utf8');
function load(source) {
    const context = vm.createContext({basis: {r: 1}, WIDTH: 100});
    new vm.Script(rect + '\n' + source + `
        globalThis.createBar = (...args) => new Bar(...args);
        globalThis.positionCalls = 0;
        const setter = Object.getOwnPropertyDescriptor(Rect.prototype, 'pos').set;
        Object.defineProperty(Rect.prototype, 'pos', {
            set(value) { positionCalls++; setter.call(this, value); }
        });
    `).runInContext(context);
    return context;
}
// Retain NaN, signed zero and undefined when comparing values from different VMs.
function plain(value) {
    if (Array.isArray(value)) return Array.from(value, plain);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).map(key => [key, plain(value[key])]));
    }
    return value;
}
function compare(a, b) {
    assert.deepStrictEqual(plain(a), plain(b), 'bar state differs');
    assert.strictEqual(a.pos, b.pos, 'preserve existing position getter behavior');
}
function draw(bar) {
    const calls = [];
    const ctx = new Proxy({}, {
        get: (_, key) => (...args) => calls.push([key, ...args]),
        set: (_, key, value) => { calls.push(['set', key, value]); return true; }
    });
    bar.draw(ctx);
    return calls;
}
const before = load(bar), after = load(transform(bar));
let cases = 0, rectangles = 0;
for (const radius of [0, -0, 0.1, 1, 19.37, 1e-300, 1e300, Infinity, NaN]) {
    for (const count of [0, 1, 2, 5, 12]) {
        for (const position of [{x: 0, y: -0}, {x: 1.2, y: -3.4}, {x: -123, y: 456}]) {
            before.basis.r = after.basis.r = radius;
            const a = before.createBar(position, count);
            const b = after.createBar(position, count);
            const retained = Array.from(b.rects);
            compare(a, b);
            for (const liveRadius of [1, 17.23]) {
                before.basis.r = after.basis.r = liveRadius;
                a.pos = b.pos = {x: -0, y: -29.7};
                a.healthColor = b.healthColor = '#123456';
                a.dmgColor = b.dmgColor = '#654321';
                a.repaintRects(Math.floor(count / 2));
                b.repaintRects(Math.floor(count / 2));
                compare(a, b);
                assert.deepStrictEqual(draw(a), draw(b), 'real Rect.draw callbacks differ');
                retained.forEach((r, i) => assert.strictEqual(r, b.rects[i]));
            }
            assert.equal(new Set(b.rects.map(r => r.cornerRadius)).size, count);
            rectangles += count;
            cases++;
        }
    }
}
assert.equal(before.positionCalls, rectangles * 3);
assert.equal(after.positionCalls, 0);
const savedCalls = before.positionCalls;
const faulty = load(transform(bar).replace('rect.y = pos.y + marginY', 'rect.y = pos.y + marginY + 1'));
before.basis.r = faulty.basis.r;
assert.throws(() => compare(before.createBar({x: 0, y: 0}, 1),
    faulty.createBar({x: 0, y: 0}, 1)), /bar state differs/);
console.log(`BAR_POSITION: PASS ${cases} real Bar/Rect cases, exact state/draw, live radius, signed zero, independent rectangles`);
console.log(`ALLOCATION_MECHANISM: PASS ${savedCalls} temporary-object setter calls -> ${after.positionCalls}`);
console.log('NEGATIVE_CONTROL: PASS changed real rectangle coordinate rejected');
