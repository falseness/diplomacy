// Observational wrappers. No references to game objects escape into the host.
module.exports = String.raw`
;(() => {
    const sink = globalThis.__task102AllocationSink;
    const ids = new WeakMap();
    let nextId = 0;
    const clone = AIPlayer.prototype.cloneMutableVectorGridForPrediction;
    AIPlayer.prototype.cloneMutableVectorGridForPrediction = function(grid) {
        const value = clone.call(this, grid);
        const id = ++nextId;
        ids.set(value, id);
        sink('snapshot', JSON.stringify(value), {id,
            cells: value[0].reduce((n, row) => n + row.length, 0),
            channels: value[0].reduce((n, row) => n + row.reduce((m, cell) => m + cell.length, 0), 0)});
        return value;
    };
    const chances = AIPlayer.prototype.getWinningChances;
    AIPlayer.prototype.getWinningChances = function(inputs) {
        sink('inputs', JSON.stringify(inputs), inputs.map(input => ids.get(input) || null));
        const result = chances.call(this, inputs);
        sink('scores', JSON.stringify(result), null);
        return result;
    };
    const score = AIPlayer.prototype.scoreActionCommandsWithFastVectorGrid;
    AIPlayer.prototype.scoreActionCommandsWithFastVectorGrid = function(commands, apply) {
        sink('commands', JSON.stringify(commands), null);
        const result = score.call(this, commands, apply);
        sink('accepted', JSON.stringify(result), null);
        return result;
    };
})();
`;
