const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const scriptCache = new Map();
const readCounts = new Map();
const compileCounts = new Map();
let cachedBrowserScriptSources = null;
let cachedBrowserScriptBundle = null;

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

function compileBrowserScriptBundle() {
  if (cachedBrowserScriptBundle) {
    return cachedBrowserScriptBundle;
  }
  const parts = [];
  for (const source of browserScriptSources()) {
    const normalized = source.replace(/\\/g, '/');
    parts.push('\n// ' + normalized + '\n' + readRepoFile(normalized));
    compileCounts.set(normalized, (compileCounts.get(normalized) || 0) + 1);
  }
  cachedBrowserScriptBundle = new vm.Script(parts.join('\n'), {
    filename: 'browser-script-bundle.js'
  });
  return cachedBrowserScriptBundle;
}

function shouldUseBrowserScriptCache(options) {
  if (process.env.DIPLOMACY_DISABLE_BROWSER_SCRIPT_CACHE === '1') {
    return false;
  }
  return !(options && options.disableBrowserScriptCache);
}

function loadBrowserScripts(context, options) {
  const cacheEnabled = shouldUseBrowserScriptCache(options || {});
  if (cacheEnabled) {
    compileBrowserScriptBundle().runInContext(context);
    return;
  }
  for (const source of browserScriptSources()) {
    compileBrowserScript(source, cacheEnabled).runInContext(context);
  }
}

function resetBrowserScriptCache() {
  scriptCache.clear();
  readCounts.clear();
  compileCounts.clear();
  cachedBrowserScriptSources = null;
  cachedBrowserScriptBundle = null;
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
    cachedScripts: scriptCache.size + (cachedBrowserScriptBundle ? 1 : 0),
    readCounts: mapToObject(readCounts),
    compileCounts: mapToObject(compileCounts)
  };
}

module.exports = {
  getBrowserScriptCacheStats,
  loadBrowserScripts,
  resetBrowserScriptCache,
  shouldUseBrowserScriptCache
};
