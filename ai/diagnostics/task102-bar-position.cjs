// Isolated allocation prototype. Never installed by production or benchmarks.
const assert = require('assert');
const original = '            this.rects[i].pos = \n' +
    '                {x: pos.x - hpBarWidth / 2 + i * this.width + i * intervalX,\n' +
    '                y: pos.y + marginY}';
const replacement = `            // Rect.pos only copies these two scalars. Avoid its temporary object.
            const rect = this.rects[i]
            rect.x = pos.x - hpBarWidth / 2 + i * this.width + i * intervalX
            rect.y = pos.y + marginY`;
function transform(source) {
    assert.equal(source.split(original).length, 2, 'expected one Bar.pos assignment');
    return source.replace(original, replacement);
}
module.exports = {transform};
