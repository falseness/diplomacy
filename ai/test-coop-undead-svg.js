// Offline validation and visual evidence for the undead art in assets/undead/
// (demon-owned ordinary units). Modelled on test-coop-demon-svg.js, but renders
// with node-canvas (librsvg) so it needs no browser.
// Usage: node ai/test-coop-undead-svg.js [--output-dir <dir>]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const {loadImage, createCanvas} = require('canvas');
const {NAMES, undead} = require('./make-undead-svg');
const root = path.resolve(__dirname, '..');
function option(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `value required for ${name}`);
  return process.argv[i + 1];
}
const out = path.resolve(root, option('--output-dir', 'artifacts/TASK-415/out/undead-svg'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

function parse(source) {
  const doc = new JSDOM(source, {contentType: 'image/svg+xml'}).window.document;
  assert(!doc.querySelector('parsererror'), 'well-formed XML');
  const svg = doc.documentElement;
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  return {doc, svg};
}
function validate(source) {
  const {doc, svg} = parse(source);
  assert(!/<!DOCTYPE|<!ENTITY/i.test(source), 'no external XML entities');
  assert.equal(doc.querySelectorAll('image, foreignObject, script, style').length, 0, 'no <image>, <script> or foreign content');
  const ids = new Set([...doc.querySelectorAll('[id]')].map(n => n.id));
  for (const node of doc.querySelectorAll('*')) for (const attr of node.attributes) {
    assert(!/^on/i.test(attr.name), 'no event handlers');
    if (attr.name.startsWith('xmlns')) continue;
    assert(!/data:|https?:|\/\//i.test(attr.value), `no external reference in ${attr.name}`);
    if (attr.localName === 'href') assert(attr.value.startsWith('#') && ids.has(attr.value.slice(1)), `local href ${attr.value}`);
    for (const m of attr.value.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g))
      assert(m[1].startsWith('#') && ids.has(m[1].slice(1)), `resolved paint reference ${m[1]}`);
  }
  return {viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), height: svg.getAttribute('height')};
}
async function render(buffer, size) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return canvas;
}
function stats(canvas) {
  const {data} = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const mask = [];
  let red = 0;
  for (let i = 0; i < data.length; i += 4) {
    mask.push(data[i + 3] > 32);
    if (data[i + 3] > 32 && data[i] > 200 && data[i + 1] < 90 && data[i + 2] < 90) red++;
  }
  return {mask, red};
}

(async () => {
  fs.mkdirSync(path.join(out, 'png'), {recursive: true});
  console.log(`cwd=${process.cwd()} runtime=${process.execPath} version=${process.version} out=${path.relative(root, out)}`);
  // The validator must reject the defects this ticket forbids.
  const sample = fs.readFileSync(path.join(root, 'assets/undead/noob.svg'), 'utf8');
  for (const [name, bad] of [
    ['malformed XML', sample.replace('</svg>', '')],
    ['external use href', sample.replace('</svg>', '<use href="other.svg#x"/></svg>')],
    ['embedded image', sample.replace('</svg>', '<image href="#nb-noob-skin"/></svg>')],
    ['script', sample.replace('</svg>', '<script>1</script></svg>')]
  ]) {
    assert.throws(() => validate(bad), undefined, name);
    console.log(`check corruption rejected: ${name}`);
  }
  const report = [];
  for (const name of NAMES) {
    const srcPath = `assets/sprites/${name}.svg`, udPath = `assets/undead/${name}.svg`;
    const src = fs.readFileSync(path.join(root, srcPath)), ud = fs.readFileSync(path.join(root, udPath));
    const srcMeta = validate(src.toString('utf8')), udMeta = validate(ud.toString('utf8'));
    assert.deepEqual(udMeta, srcMeta, `${name}: viewBox and width/height identical to ${srcPath}`);
    assert.notEqual(hash(ud), hash(src), `${name}: content differs from source`);
    assert.equal(undead(name), ud.toString('utf8'), `${name}: file matches ai/make-undead-svg.js output`);
    const result = {name, source: srcPath, undead: udPath, sha256: hash(ud), sourceSha256: hash(src), ...udMeta, png: []};
    for (const size of [64, 128]) {
      const canvas = await render(ud, size);
      const file = path.join(out, 'png', `${name}-${size}.png`);
      fs.writeFileSync(file, canvas.toBuffer('image/png'));
      result.png.push(path.relative(root, file));
    }
    // Silhouette: alpha masks at 128 px overlap almost completely.
    const a = stats(await render(src, 128)), b = stats(await render(ud, 128));
    let inter = 0, union = 0;
    a.mask.forEach((v, i) => { if (v && b.mask[i]) inter++; if (v || b.mask[i]) union++; });
    result.silhouetteIoU = +(inter / union).toFixed(4);
    assert(result.silhouetteIoU >= 0.97, `${name}: silhouette IoU ${result.silhouetteIoU} >= 0.97`);
    const redSrc = stats(await render(src, 512)).red, redUd = stats(await render(ud, 512)).red;
    result.redPixels512 = {source: redSrc, undead: redUd};
    assert(redUd > redSrc + 20, `${name}: glowing red eyes add red pixels`);
    // Side-by-side original vs undead.
    const S = 256, compare = createCanvas(S * 2 + 30, S + 30), ctx = compare.getContext('2d');
    ctx.fillStyle = '#bbcbb0'; ctx.fillRect(0, 0, compare.width, compare.height);
    ctx.fillStyle = '#222'; ctx.font = '14px sans-serif';
    ctx.fillText(`${name} original`, 10, 18); ctx.fillText(`${name} undead`, S + 30, 18);
    ctx.drawImage(await loadImage(src), 10, 24, S, S);
    ctx.drawImage(await loadImage(ud), S + 20, 24, S, S);
    const cmpFile = path.join(out, 'png', `${name}-compare.png`);
    fs.writeFileSync(cmpFile, compare.toBuffer('image/png'));
    result.compare = path.relative(root, cmpFile);
    assert(fs.statSync(cmpFile).size > 1000, `${name}: compare PNG non-empty`);
    console.log(JSON.stringify(result));
    console.log(`PASS ${udPath} well-formed, no external refs, viewBox=${udMeta.viewBox} ${udMeta.width}x${udMeta.height} same as source, differs, silhouetteIoU=${result.silhouetteIoU}, png 64/128 + compare`);
    report.push(result);
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`all ${report.length} undead sprites validated`);
})().catch(error => { console.error(error); process.exitCode = 1; });
