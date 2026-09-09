// Diagnostic only: resolve an undo-restored unit once per captured identity.
const assert = require('assert');
const crypto = require('crypto');
const vm = require('vm');

const original = `            for (let command of commands) {
                if (aiCommandSourceUnits.get(command) === state.entity) {
                    let restoredCell = getAiCommandCell({x: state.x, y: state.y})
                    let restored = restoredCell && restoredCell.unit
                    if (this.units.includes(restored)) {
                        aiCommandSourceUnits.set(command, restored)
                    }
                }
            }`;
const replacement = `            let resolved = false
            let restored
            let owned = false
            for (let command of commands) {
                if (aiCommandSourceUnits.get(command) === state.entity) {
                    if (!resolved) {
                        let restoredCell = getAiCommandCell({x: state.x, y: state.y})
                        restored = restoredCell && restoredCell.unit
                        owned = this.units.includes(restored)
                        resolved = true
                    }
                    if (owned) {
                        aiCommandSourceUnits.set(command, restored)
                    }
                }
            }`;

function transform(source, arm) {
  assert(['A', 'B', 'audit'].includes(arm));
  assert.equal(source.split(original).length, 2, 'unique undo rebind fragment');
  let result = source.replace(original, arm === 'A' ? original : replacement);
  if (arm === 'audit') {
    const start = source.indexOf('    undoCommandSimulation(commands, snapshot) {');
    const end = source.indexOf('    scoreActionCommandsWithFastVectorGrid(', start);
    assert(start >= 0 && end > start);
    const reference = source.slice(start, end).trim().replace('undoCommandSimulation(', 'function(');
    result += `
;(() => {
    const reference = ${reference};
    const candidate = AIPlayer.prototype.undoCommandSimulation;
    AIPlayer.prototype.undoCommandSimulation = function(commands, snapshot) {
        const before = commands.map(command => [aiCommandSourceUnits.has(command), aiCommandSourceUnits.get(command)]);
        const getCell = getAiCommandCell;
        const undo = actionManager.undo;
        let reads = 0;
        let originalReads;
        getAiCommandCell = function(...args) { ++reads; return getCell(...args); };
        try {
            reference.call(this, commands, snapshot);
            originalReads = reads;
            const expected = commands.map(command => [aiCommandSourceUnits.has(command), aiCommandSourceUnits.get(command)]);
            commands.forEach((command, i) => {
                if (before[i][0]) aiCommandSourceUnits.set(command, before[i][1]);
                else aiCommandSourceUnits.delete(command);
            });
            // Undo has already restored the real game. Replay only binding logic.
            actionManager.undo = function() {};
            reads = 0;
            candidate.call(this, commands, snapshot);
            commands.forEach((command, i) => {
                if (aiCommandSourceUnits.has(command) !== expected[i][0] ||
                    aiCommandSourceUnits.get(command) !== expected[i][1]) {
                    throw Error('undo command identity mismatch at ' + i);
                }
            });
            if (reads > originalReads) throw Error('undo resolution count increased');
            __task102RebindChecked(originalReads, reads, commands.length);
        } finally {
            getAiCommandCell = getCell;
            actionManager.undo = undo;
        }
    };
})();
`;
  }
  return result;
}

function install(arm) {
  const OriginalScript = vm.Script;
  const scripts = [];
  const counts = {replacements: 0, forwards: 0, checks: 0, originalReads: 0,
    candidateReads: 0, commands: 0};
  const records = new WeakMap();
  // Both timed arms use the same subclass, replacement and forwarding path.
  vm.Script = class RebindScript extends OriginalScript {
    constructor(source, options) {
      if (options && options.filename === 'ai/players.js') {
        source = transform(source, arm);
        counts.replacements++;
      }
      super(source, options);
      const record = {filename: options?.filename || '<anonymous>',
        sha256: crypto.createHash('sha256').update(source).digest('hex'), executions: 0};
      scripts.push(record);
      records.set(this, record);
    }
    runInContext(context, options) {
      counts.forwards++;
      records.get(this).executions++;
      if (arm === 'audit') context.__task102RebindChecked = (before, after, commands) => {
        counts.checks++;
        counts.originalReads += before;
        counts.candidateReads += after;
        counts.commands += commands;
      };
      return super.runInContext(context, options);
    }
  };
  return {scripts, counts, restore() { vm.Script = OriginalScript; }};
}

module.exports = {transform, install};
