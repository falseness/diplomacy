const fs = require('fs');
const path = require('path');
const vm = require('vm');
const v8 = require('v8');

const repoRoot = path.resolve(__dirname, '..');
const scriptCache = new Map();
const readCounts = new Map();
const compileCounts = new Map();
let cachedBrowserScriptSources = null;

function detachBrowserResult(result) {
  // A VM object's prototype retains its realm, including the entire game.
  // Transfer data to host-owned objects before callers retain results or batches.
  // V8 serialization preserves undefined, non-finite numbers and shared references.
  return v8.deserialize(v8.serialize(result));
}

function createBrowserContext(globals) {
  // Fresh global/lexical state, without Node's global proxy when supported.
  // Only compiled scripts are shared between games.
  const context = vm.constants && vm.constants.DONT_CONTEXTIFY
    ? vm.createContext(vm.constants.DONT_CONTEXTIFY)
    : vm.createContext({});
  Object.assign(context, globals);
  context.window = context;
  context.globalThis = context;
  return context;
}

function readRepoFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  readCounts.set(normalized, (readCounts.get(normalized) || 0) + 1);
  return fs.readFileSync(path.join(repoRoot, normalized), 'utf8');
}

function browserScriptSources() {
  if (cachedBrowserScriptSources) {
    return cachedBrowserScriptSources.slice();
  }
  const html = readRepoFile('index.html');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  const sources = [];
  let match;
  while ((match = scriptPattern.exec(html))) {
    if (!/^https?:/.test(match[1])) {
      sources.push(match[1]);
    }
  }
  cachedBrowserScriptSources = sources;
  return sources.slice();
}

function compileBrowserScript(relativePath, cacheEnabled) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (cacheEnabled && scriptCache.has(normalized)) {
    return scriptCache.get(normalized);
  }
  const script = new vm.Script(readRepoFile(normalized), { filename: normalized });
  compileCounts.set(normalized, (compileCounts.get(normalized) || 0) + 1);
  if (cacheEnabled) {
    scriptCache.set(normalized, script);
  }
  return script;
}

function shouldUseBrowserScriptCache(options) {
  if (process.env.DIPLOMACY_DISABLE_BROWSER_SCRIPT_CACHE === '1') {
    return false;
  }
  return !(options && options.disableBrowserScriptCache);
}

function loadBrowserScript(context, relativePath, options) {
  compileBrowserScript(relativePath, shouldUseBrowserScriptCache(options)).runInContext(context);
}

function loadBrowserScripts(context, options) {
  const cacheEnabled = shouldUseBrowserScriptCache(options || {});
  for (const source of browserScriptSources()) {
    compileBrowserScript(source, cacheEnabled).runInContext(context);
  }
}

function resetBrowserScriptCache() {
  scriptCache.clear();
  readCounts.clear();
  compileCounts.clear();
  cachedBrowserScriptSources = null;
}

function mapToObject(map) {
  const result = {};
  for (const [key, value] of map.entries()) {
    result[key] = value;
  }
  return result;
}

function getBrowserScriptCacheStats() {
  return {
    sources: browserScriptSources(),
    cachedScripts: scriptCache.size,
    readCounts: mapToObject(readCounts),
    compileCounts: mapToObject(compileCounts)
  };
}

module.exports = {
  createBrowserContext,
  detachBrowserResult,
  getBrowserScriptCacheStats,
  loadBrowserScript,
  loadBrowserScripts,
  resetBrowserScriptCache,
  shouldUseBrowserScriptCache
};
