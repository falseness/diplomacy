// Generates assets/undead/<name>.svg from assets/sprites/<name>.svg: the same
// shapes recoloured as undead (bone skin, glowing red eyes, dark tattered
// cloth, demon-purple accents) plus a few overlays kept inside the original
// silhouette. Run: node ai/make-undead-svg.js
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const NAMES = ['noob', 'archer', 'KOHb', 'KOHbLeft', 'normchel', 'catapult', 'catapultLeft'];
const NS = 'http://www.w3.org/2000/svg';
const DEMON = [160, 40, 180];
const EYE_WHITES = ['#fff8e9', '#f5ebd7'], PUPILS = ['#19251f', '#211f18'];

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h, s, l) {
  s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
const [DEMON_H, DEMON_S, DEMON_L] = hexToHsl('#' + DEMON.map(v => v.toString(16).padStart(2, '0')).join(''));

// role: skin | purple | siege | garment | cloth (default)
function recolour(hex, role) {
  hex = hex.toLowerCase();
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  const [h, s, l] = hexToHsl(hex);
  if (role === 'skin') return hslToHex(88, 0.16, 0.22 + 0.66 * l);
  if (role === 'purple') return hslToHex(DEMON_H, DEMON_S, DEMON_L * Math.min(1.5, l / 0.5));
  if (role === 'garment' && s < 0.12) return hslToHex(282, 0.12, l * 0.5);
  const warm = h >= 15 && h < 60 && s >= 0.12, green = h >= 60 && h < 170 && s >= 0.12;
  const red = (h < 15 || h >= 330) && s >= 0.3;
  if (role === 'siege') {
    if (warm || red) return hslToHex(22, s * 0.4, l * 0.42);          // dark weathered wood
    return hslToHex(DEMON_H, 0.14, l * 0.62);                          // dark iron, purple cast
  }
  if (red) return hslToHex(DEMON_H, DEMON_S, DEMON_L * Math.min(1.5, l / 0.45));
  if (green) return hslToHex(282, 0.2, l * 0.5);                       // rotten dark cloth
  if (warm) return hslToHex(h, s * 0.3, l * 0.55);                     // grimy leather
  return hslToHex(h, s * 0.5, l * 0.82);                               // tarnished metal
}

function el(doc, name, attrs, parent) {
  const node = doc.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}
function bbox(node) {
  const tag = node.localName;
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = +node.getAttribute('cx'), cy = +node.getAttribute('cy');
    const rx = +(node.getAttribute('rx') || node.getAttribute('r')), ry = +(node.getAttribute('ry') || node.getAttribute('r'));
    return {cx, cy, rx, ry};
  }
  const nums = (node.getAttribute('d').match(/-?\d*\.?\d+/g) || []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2};
}
// Zigzag torn edge between x0..x1 at baseline y (teeth hanging down by depth).
function tornBand(x0, x1, yTop, y, depth, teeth) {
  const step = (x1 - x0) / teeth;
  let d = `M${x0} ${yTop} L${x1} ${yTop} L${x1} ${y}`;
  for (let i = teeth - 1; i >= 0; i--) {
    const xm = x0 + step * (i + 0.5), dy = depth * (0.6 + 0.4 * ((i * 7) % 3) / 2);
    d += ` L${xm.toFixed(1)} ${(y + (i % 2 ? -dy * 0.5 : dy)).toFixed(1)} L${(x0 + step * i).toFixed(1)} ${y}`;
  }
  return d + 'Z';
}
function skull(doc, parent, cx, cy, r, id) {
  const g = el(doc, 'g', {id}, parent);
  el(doc, 'path', {d: `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}Q${cx + r} ${cy + r * 0.55} ${cx + r * 0.55} ${cy + r * 0.7}` +
    `V${cy + r * 1.05}H${cx - r * 0.55}V${cy + r * 0.7}Q${cx - r} ${cy + r * 0.55} ${cx - r} ${cy}Z`,
    fill: '#ddd8bd', stroke: '#4a4038', 'stroke-width': Math.max(1, r * 0.08)}, g);
  for (const sx of [-1, 1]) {
    el(doc, 'ellipse', {cx: cx + sx * r * 0.4, cy: cy + r * 0.08, rx: r * 0.27, ry: r * 0.3, fill: '#1c0e14'}, g);
    el(doc, 'circle', {cx: cx + sx * r * 0.4, cy: cy + r * 0.1, r: r * 0.11, fill: '#ff3a24'}, g);
  }
  el(doc, 'path', {d: `M${cx} ${cy + r * 0.38}L${cx - r * 0.12} ${cy + r * 0.6}H${cx + r * 0.12}Z`, fill: '#1c0e14'}, g);
  for (const k of [-0.3, 0, 0.3]) el(doc, 'path', {d: `M${cx + k * r} ${cy + r * 0.78}V${cy + r * 1.05}`,
    stroke: '#4a4038', 'stroke-width': Math.max(1, r * 0.07)}, g);
  return g;
}

// Copies a path's geometry into a new clipPath and returns a clipped overlay group.
function clippedGroup(doc, defs, sourcePath, id, insertAfter) {
  const clip = el(doc, 'clipPath', {id: id + '-clip'}, defs);
  el(doc, 'path', {d: sourcePath.getAttribute('d')}, clip);
  const g = doc.createElementNS(NS, 'g');
  g.setAttribute('id', id);
  g.setAttribute('clip-path', `url(#${id}-clip)`);
  insertAfter.after(g);
  return g;
}

function humanoidTatters(doc, prefix) {
  const shirt = doc.querySelector(`[id$="-shirt"][clip-path]`);
  const pants = doc.querySelector(`[id$="-pants"][clip-path]`);
  const dark = '#1b1320', purple = recolour('#000000', 'purple');
  // Torn sleeve cuffs and rips across the chest.
  el(doc, 'path', {d: 'M108 224 L150 245 L144 232 L134 238 L130 226 L120 230Z', fill: dark}, shirt);
  el(doc, 'path', {d: 'M404 224 L362 245 L368 232 L378 238 L382 226 L392 230Z', fill: dark}, shirt);
  el(doc, 'path', {d: 'M205 196 L222 214 L214 216 L231 238 L210 222 L216 220Z', fill: dark, opacity: .85}, shirt);
  el(doc, 'path', {d: 'M300 170 L286 196 L294 196 L281 222 L304 194 L296 193Z', fill: dark, opacity: .85}, shirt);
  el(doc, 'path', {d: 'M232 150 L256 178 L280 150', stroke: purple, 'stroke-width': 6, 'stroke-linejoin': 'round'}, shirt);
  // Ragged trouser hems with bone showing through a torn knee.
  el(doc, 'path', {d: tornBand(176, 336, 392, 406, 9, 12), fill: dark}, pants);
  el(doc, 'path', {d: 'M200 352 Q209 342 218 352 L214 366 Q207 371 202 364Z', fill: '#c9cdb5', stroke: dark, 'stroke-width': 3}, pants);
  el(doc, 'path', {d: 'M296 340 L305 352 L300 356 L309 370', stroke: dark, 'stroke-width': 4, 'stroke-linecap': 'round'}, pants);
  // Sunken cheeks and a stitched grin on the bone head.
  const head = doc.querySelector('[id$="-unit-head"]');
  const mouth = [...head.querySelectorAll('path')].find(p => /^M242 114 H270$/.test(p.getAttribute('d')));
  if (mouth) {
    mouth.setAttribute('stroke', '#2a1a22');
    for (const x of [247, 256, 265]) el(doc, 'path', {d: `M${x} 109 V119`, stroke: '#2a1a22', 'stroke-width': 2.5, 'stroke-linecap': 'round'}, head);
  }
  el(doc, 'path', {d: 'M214 92 Q220 104 230 106', stroke: '#6c7462', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: .8}, head);
  el(doc, 'path', {d: 'M298 92 Q292 104 282 106', stroke: '#6c7462', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: .8}, head);
}

function horsemanTatters(doc, defs) {
  const dark = '#1b1320';
  const tunic = doc.getElementById('kh-horseman-new-tunic') ||
    [...doc.querySelectorAll('path')].find(p => /^M282 124C274/.test(p.getAttribute('d')));
  const g = clippedGroup(doc, defs, tunic, 'ud-tunic-tatters', tunic);
  const left = !doc.getElementById('kh-horseman-new-tunic');
  const fx = x => left ? 512 - x : x;
  el(doc, 'path', {d: `M${fx(186)} 222 L${fx(196)} 205 L${fx(204)} 216 L${fx(214)} 200 L${fx(224)} 214 L${fx(236)} 199 L${fx(246)} 214 L${fx(258)} 200 L${fx(268)} 226 L${fx(186)} 230Z`, fill: dark}, g);
  el(doc, 'path', {d: `M${fx(236)} 150 L${fx(248)} 170 L${fx(242)} 171 L${fx(252)} 190`, stroke: dark, 'stroke-width': 4, 'stroke-linecap': 'round'}, g);
  el(doc, 'path', {d: `M${fx(230)} 128 L${fx(252)} 150 L${fx(272)} 132`, stroke: recolour('#000', 'purple'), 'stroke-width': 4}, g);
}

function catapultDetails(doc, name) {
  const svg = doc.documentElement;
  const left = name === 'catapultLeft', fx = x => left ? 512 - x : x;
  const g = el(doc, 'g', {id: 'ud-catapult-bones'}, svg);
  // A skull rides in the bucket instead of a stone, another is nailed to the front post.
  skull(doc, g, fx(98), 40, 17, 'ud-bucket-skull');
  skull(doc, g, fx(238), 262, 14, 'ud-post-skull');
  // Bone bracing tied across the near wheel.
  el(doc, 'path', {d: `M${fx(214)} 401 L${fx(234)} 393`, stroke: '#ddd8bd', 'stroke-width': 4, 'stroke-linecap': 'round'}, g);
}

function undead(name) {
  const source = fs.readFileSync(path.join(root, 'assets/sprites', name + '.svg'), 'utf8');
  const doc = new JSDOM(source, {contentType: 'image/svg+xml'}).window.document;
  const svg = doc.documentElement;
  let defs = svg.querySelector('defs');
  if (!defs) defs = svg.insertBefore(doc.createElementNS(NS, 'defs'), svg.firstChild);
  const siege = /^catapult/.test(name);
  const stops = g => [...g.querySelectorAll('stop')].map(s => (s.getAttribute('stop-color') || '').toLowerCase());
  const roles = {};
  for (const grad of doc.querySelectorAll('linearGradient, radialGradient')) {
    const colours = stops(grad);
    if (/skin|-left-arm$|-right-arm$/.test(grad.id) || colours.includes('#ffe1a0')) roles[grad.id] = 'skin';
    else if (/belt-paint|blanket|red-grip/.test(grad.id) || colours[0] === '#b2b680') roles[grad.id] = 'purple';
    else if (/shirt|sleeve|pants|rider-cloth/.test(grad.id)) roles[grad.id] = 'garment';
  }
  const eyes = [];
  for (const node of doc.querySelectorAll('*')) {
    const fill = (node.getAttribute('fill') || '').toLowerCase();
    if (EYE_WHITES.includes(fill)) { node.setAttribute('fill', '#1c0e14'); continue; }
    if (PUPILS.includes(fill)) { node.setAttribute('fill', '#ff2a1a'); eyes.push(node); continue; }
    const grad = node.localName === 'stop' ? node.parentNode.id : null;
    const role = siege ? 'siege' : roles[grad] || 'cloth';
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const v = node.getAttribute(attr);
      if (v && /^#[0-9a-f]{3,6}$/i.test(v)) node.setAttribute(attr, recolour(v, role));
    }
  }
  if (eyes.length) {
    const glow = el(doc, 'radialGradient', {id: 'ud-eye-glow'}, defs);
    el(doc, 'stop', {'stop-color': '#ffd04a', 'stop-opacity': 1}, glow);
    el(doc, 'stop', {offset: .35, 'stop-color': '#ff2a1a', 'stop-opacity': .95}, glow);
    el(doc, 'stop', {offset: 1, 'stop-color': '#ff2a1a', 'stop-opacity': 0}, glow);
    for (const eye of eyes) {
      const b = bbox(eye);
      const halo = el(doc, 'circle', {cx: b.cx.toFixed(2), cy: b.cy.toFixed(2), r: (Math.max(b.rx, b.ry) * 2).toFixed(2), fill: 'url(#ud-eye-glow)'});
      eye.after(halo);
    }
  }
  if (['noob', 'archer', 'normchel'].includes(name)) humanoidTatters(doc);
  if (/^KOHb/.test(name)) horsemanTatters(doc, defs);
  if (siege) catapultDetails(doc, name);
  const title = doc.querySelector('title');
  if (title) title.textContent = 'Undead ' + title.textContent.trim();
  const desc = doc.querySelector('desc');
  if (desc) desc.textContent = 'Undead demon-owned variant of the sprite with the same silhouette: bone-grey skin, glowing red eyes, ' +
    'dark tattered cloth and purple demon accents. Editable vector shapes, no raster images.';
  // The ~3000-element catapult exports are written without inter-element
  // whitespace so the generated file stays a handful of lines.
  if (siege) for (const node of [...doc.querySelectorAll('*')].flatMap(n => [...n.childNodes]))
    if (node.nodeType === 3 && !node.textContent.trim()) node.remove();
  return '<?xml version="1.0" encoding="utf-8"?>\n' + new doc.defaultView.XMLSerializer().serializeToString(svg) + '\n';
}

if (require.main === module) {
  const dir = path.join(root, 'assets/undead');
  fs.mkdirSync(dir, {recursive: true});
  for (const name of NAMES) {
    fs.writeFileSync(path.join(dir, name + '.svg'), undead(name));
    console.log('wrote assets/undead/' + name + '.svg');
  }
}
module.exports = {NAMES, undead, recolour};
