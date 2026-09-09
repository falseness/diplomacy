// Diagnostic only: symmetric observation of an unchanged runtime and identity sham.
const assert = require('assert');
const crypto = require('crypto');
const vm = require('vm');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const fragment = `    let key = fastActionCoordKey(coord)
    if (seen[key]) {
        return
    }
    seen[key] = true`;

function identity(source) {
  assert.equal(source.split(fragment).length, 2, 'unique coordinate fragment');
  const output = source.replace(fragment, fragment);
  assert.equal(output, source, 'identity replacement bytes');
  return output;
}

function install(arm) {
  assert(['A', 'S'].includes(arm));
  const OriginalScript = vm.Script;
  const originalRun = OriginalScript.prototype.runInContext;
  const scripts = [];
  const metadata = new WeakMap();
  const counts = {replacements: 0, forwards: 0};
  // Both arms have the same observer below the optional intervention subclass.
  const ObservedScript = new Proxy(OriginalScript, {
    construct(target, args, newTarget) {
      const script = Reflect.construct(target, args, newTarget);
      const record = {filename: args[1]?.filename || '<anonymous>',
        sha256: hash(args[0]), executions: 0};
      scripts.push(record);
      metadata.set(script, record);
      return script;
    }
  });
  OriginalScript.prototype.runInContext = function(context, options) {
    const record = metadata.get(this);
    assert(record, 'every executed script was observed at construction');
    record.executions += 1;
    return originalRun.call(this, context, options);
  };
  vm.Script = arm === 'A' ? ObservedScript : class ShamScript extends ObservedScript {
    constructor(source, options) {
      if (options && options.filename === 'ai/mutableVectorGrid.js') {
        source = identity(source);
        counts.replacements += 1;
      }
      super(source, options);
    }
    runInContext(context, options) {
      counts.forwards += 1;
      return super.runInContext(context, options);
    }
  };
  return {scripts, counts, restore() {
    vm.Script = OriginalScript;
    OriginalScript.prototype.runInContext = originalRun;
  }};
}
module.exports = {identity, install};
