// Reusable offline asset validation and visual evidence for the demon art tickets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const {JSDOM} = require('jsdom');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const parents = {imp:['noob','normchel'], clawling:['noob','normchel'], hound:['KOHb'],
  brute:['normchel'], bulwark:['normchel'], spitter:['archer'], emberArcher:['archer'],
  hexcaster:['archer'], ravager:['KOHb'], demonLord:['normchel'], demonPortal:['goldmine']};
function option(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `value required for ${name}`);
  return process.argv[i + 1];
}
if (process.argv.includes('--all')) {
  const {spawnSync} = require('node:child_process');
  for (const type of Object.keys(parents).filter(n => n !== 'demonPortal')) {
    const args = [__filename, '--type', type, '--output-dir',
      path.join(option('--output-dir', 'artifacts/TASK-102'), 'svg', type)];
    console.log('command='+JSON.stringify([process.execPath,...args]));
    const result = spawnSync(process.execPath, args, {stdio:'inherit'});
    console.log(`child_type=${type} exit_status=${result.status}`);
    if (result.error) console.error(result.error);
    if (result.status !== 0) process.exit(1);
  }
  console.log('PASS all ten demon SVGs validated');
  process.exit(0);
}
const type = option('--type', 'imp');
assert(Object.hasOwn(parents, type), 'known demon type required');
const out = path.resolve(root, option('--output-dir', 'artifacts/TASK-092'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function compare(scenario, observed, expected) {
  console.log(JSON.stringify({scenario, expected, observed}));
  assert.deepEqual(observed, expected, scenario);
  console.log(`PASS ${scenario}`);
}
function validate(source) {
  const doc = new JSDOM(source, {contentType:'image/svg+xml'}).window.document;
  const svg = doc.documentElement;
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 512 512');
  assert(doc.querySelector('title')?.textContent.trim(), 'title required');
  assert(doc.querySelector('desc')?.textContent.trim(), 'description required');
  assert.equal(doc.querySelectorAll('image, foreignObject, script, style').length, 0, 'vector-only passive shapes');
  assert(!/<!DOCTYPE|<!ENTITY/i.test(source), 'no external XML entities');
  const ids = [...doc.querySelectorAll('[id]')].map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'unique IDs');
  const refs = [];
  for (const el of doc.querySelectorAll('*')) for (const attr of el.attributes) {
    assert(!/^on/i.test(attr.name), 'no event handlers');
    assert(!/data:|https?:|\/\//i.test(attr.value) || attr.name.startsWith('xmlns'), 'no external/raster references');
    if (attr.localName === 'href') {assert(attr.value.startsWith('#'), 'local href'); refs.push(attr.value.slice(1));}
    for (const match of attr.value.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
      assert(match[1].startsWith('#'), 'local paint reference'); refs.push(match[1].slice(1));
    }
    if (attr.name === 'aria-labelledby') refs.push(...attr.value.split(/\s+/));
  }
  for (const ref of refs) assert(ids.includes(ref), `resolved reference ${ref}`);
  return {viewBox:svg.getAttribute('viewBox'), ids:ids.length, references:refs.length, rasterImages:0};
}
(async () => {
  fs.mkdirSync(out, {recursive:true});
  console.log(`cwd=${process.cwd()} runtime=${process.execPath} version=${process.version}`);
  const assetPath = `assets/sprites/${type}.svg`;
  const source = fs.readFileSync(path.join(root, assetPath), 'utf8');
  console.log(JSON.stringify({asset:assetPath, sha256:hash(source), xml:validate(source)}));
  console.log('PASS XML viewBox metadata unique IDs resolved references vector-only');
  const directional = ['hound','ravager'].includes(type) &&
    fs.existsSync(path.join(root, `assets/sprites/${type}Left.svg`));
  if (directional) {
    const left = fs.readFileSync(path.join(root, `assets/sprites/${type}Left.svg`), 'utf8');
    console.log(JSON.stringify({asset:`assets/sprites/${type}Left.svg`,sha256:hash(left),xml:validate(left)}));
    console.log('PASS directional XML viewBox metadata unique IDs resolved references vector-only');
  }
  for (const [name, corrupt] of [
    ['malformed XML', source.replace('</svg>', '')],
    ['wrong viewBox', source.replace('0 0 512 512', '0 0 256 256')],
    ['duplicate ID', source.replace('</svg>', '<g id="'+new JSDOM(source,{contentType:'image/svg+xml'}).window.document.querySelector('[id]').id+'"/></svg>')],
    ['missing reference', source.replace('</svg>', '<path fill="url(#missing-probe)"/></svg>')],
    ['embedded raster', source.replace('</svg>', '<image href="data:image/png;base64,AA=="/></svg>')],
    ['external reference', source.replace('</svg>', '<use href="other.svg#x"/></svg>')]
  ]) {
    assert.throws(() => validate(corrupt), undefined, name);
    console.log(`PASS deliberate corruption rejected: ${name} (in-process expected assertion)`);
  }
  const names = [...new Set([...parents[type], type, ...(directional ? [type+'Left'] : []), ...Object.keys(parents).filter(n =>
    n !== type && fs.existsSync(path.join(root, 'assets/sprites', n+'.svg')))])];
  const files = Object.fromEntries(names.map(n => [`/${n}.svg`, fs.readFileSync(path.join(root,'assets/sprites',n+'.svg'))]));
  const requests = [], errors = [];
  const server = http.createServer((req, res) => {
    const body = files[req.url];
    requests.push({url:req.url,status:body ? 200 : 404});
    res.writeHead(body ? 200 : 404, {'Content-Type':'image/svg+xml','Access-Control-Allow-Origin':'*'}); res.end(body || 'Missing asset');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const screenshots = [];
  try {
    browser = await chromium.launch({headless:true});
    console.log(`browser=chromium version=${browser.version()}`);
    const page = await browser.newPage({viewport:{width:1200,height:760},deviceScaleFactor:1});
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type() === 'error') errors.push(m.text());});
    page.on('requestfailed', req => errors.push(req.url()+': '+req.failure().errorText));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function capture(filename, html, selector) {
      await page.setContent('<body style="margin:0;font:16px sans-serif">'+html+'</body>');
      await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      const target = selector ? page.locator(selector) : page.locator('body');
      const destination = path.join(out,filename);
      await target.screenshot({path:destination,omitBackground:true});
      screenshots.push({path:path.relative(root,destination),sha256:hash(fs.readFileSync(destination))});
      console.log(`PASS screenshot ${path.relative(root,destination)} sha256=${screenshots.at(-1).sha256}`);
    }
    for (const size of [512,32,48,64]) {
      await capture(`${type}-${size}.png`, `<img crossorigin="anonymous" id="asset" width="${size}" height="${size}" src="${base}/${type}.svg">`, '#asset');
      const pixels = await page.locator('#asset').evaluate(img => {
        const c = document.createElement('canvas'); c.width=img.width; c.height=img.height;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0,img.width,img.height);
        const data=ctx.getImageData(0,0,c.width,c.height).data;
        let ink=0, edge=0;
        for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) if(data[(y*c.width+x)*4+3]) {
          ink++; if(!x||!y||x===c.width-1||y===c.height-1) edge++;
        }
        return {ink,edge,total:c.width*c.height};
      });
      console.log(JSON.stringify({scenario:`pixels ${size}px`,...pixels}));
      compare(`${size}px transparent margins`,pixels.edge,0);
      compare(`${size}px visible miniature occupancy 10–85%`,pixels.ink/pixels.total>0.1 && pixels.ink/pixels.total<0.85,true);
    }
    await capture('comparison.png', '<div style="display:flex;flex-wrap:wrap;background:#bbcbb0">'+names.map(n=>
      `<div style="text-align:center">${n}<br><img width="256" height="256" src="${base}/${n}.svg"></div>`).join('')+'</div>');
    await capture('board-scales.png', [32,48,64].map(size=>`<div style="padding:20px;background:#bbcbb0">${size}px `+names.map(n=>
      `<span style="display:inline-block;margin:10px;text-align:center">${n}<br><img width="${size}" height="${size}" src="${base}/${n}.svg"></span>`).join('')+'</div>').join(''));
    if (['hound','ravager'].includes(type)) {
      await capture('mirror.png', [256,32,48,64].map(size => `<div style="background:#bbcbb0;padding:12px">${size}px original / horizontal mirror${directional ? ' / directional asset' : ''}<br><img width="${size}" src="${base}/${type}.svg"><img style="transform:scaleX(-1)" width="${size}" src="${base}/${type}.svg">${directional ? `<img width="${size}" src="${base}/${type}Left.svg">` : ''}</div>`).join(''));
      if (directional) {
        const mirrorMatches = await page.evaluate(async ({base,type}) => {
          const images = await Promise.all([type,type+'Left'].map(async name => {
            const img = new Image(); img.crossOrigin='anonymous'; img.src=`${base}/${name}.svg`;
            await img.decode(); return img;
          }));
          const pixels = images.map((img,i) => {
            const c=document.createElement('canvas'); c.width=c.height=512;
            const ctx=c.getContext('2d');
            if (!i) {ctx.translate(512,0);ctx.scale(-1,1);}
            ctx.drawImage(img,0,0); return ctx.getImageData(0,0,512,512).data;
          });
          return pixels[0].every((value,i) => value===pixels[1][i]);
        }, {base,type});
        compare('directional asset equals horizontal mirror at 512px',mirrorMatches,true);
      }
    }
    compare('browser console/page/network errors', errors, []);
    compare('missing assets', requests.filter(r=>r.status!==200), []);
    fs.writeFileSync(path.join(out,'browser-report.json'), JSON.stringify({type,assetPath,sha256:hash(source),browser:browser.version(),parents:parents[type],compared:names,screenshots,errors,requests},null,2)+'\n');
    const identities = [assetPath,'ai/test-coop-demon-svg.js',...names.filter(n=>n!==type).map(n=>'assets/sprites/'+n+'.svg')];
    fs.writeFileSync(path.join(out,'source-identity.json'),JSON.stringify(Object.fromEntries(identities.map(p=>[p,hash(fs.readFileSync(path.join(root,p)))])),null,2)+'\n');
    console.log(`PASS ${type} SVG validation and browser previews complete`);
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
