// Explicit diagnostic preload; never imported by the production runtime.
const assert = require('assert');
const vm = require('vm');
const OriginalScript = vm.Script;
const apply = `    refreshMutableVectorGridGlobalChannels(
        mutableGrid,
        currentGlobalChannels)`;
const undo = `        refreshMutableVectorGridGlobalChannels(
            mutableGrid,
            token.previousGlobalChannels)`;
const helper = `
function task102GlobalChannelsChanged(before, after) {
    let channels = mutableVectorGridGlobalChannelList()
    for (let i = 0; i < channels.length; ++i) {
        if (before[channels[i]] !== after[channels[i]]) return true
    }
    return false
}
`;
vm.Script = class GlobalRefreshPrototypeScript extends OriginalScript {
  constructor(source, options) {
    if (options && options.filename === 'ai/mutableVectorGrid.js') {
      assert.equal(source.split(apply).length, 2, 'exact apply refresh site');
      assert.equal(source.split(undo).length, 2, 'exact undo refresh site');
      source = source.replace(apply,
        '    if (task102GlobalChannelsChanged(previousGlobalChannels, currentGlobalChannels)) {\n' + apply + '\n    }');
      source = source.replace(undo,
        '        if (task102GlobalChannelsChanged(token.currentGlobalChannels, token.previousGlobalChannels)) {\n' + undo + '\n        }');
      source += helper;
    }
    super(source, options);
  }
};
