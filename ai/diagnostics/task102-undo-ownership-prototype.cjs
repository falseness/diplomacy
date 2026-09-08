// Explicit diagnostic preload; production runtime never imports this module.
const assert = require('assert');
const vm = require('vm');
const original = 'vector: mutableGrid.cells[coord.x][coord.y].slice()';
const replacement = 'vector: mutableGrid.cells[coord.x][coord.y]';
const OriginalScript = vm.Script;
vm.Script = class UndoOwnershipPrototypeScript extends OriginalScript {
  constructor(source, options) {
    if (options && options.filename === 'ai/mutableVectorGrid.js') {
      assert.equal(source.split(original).length, 2, 'exact undo capture site');
      source = source.replace(original, replacement);
    }
    super(source, options);
  }
};
