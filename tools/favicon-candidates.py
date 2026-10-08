#!/usr/bin/env python3
"""TASK-752 vector study. Requires Pillow and node-canvas via NODE_PATH.

Run: NODE_PATH=/opt/diplomacy/node_modules python3 tools/favicon-candidates.py
Writes review assets only; never modifies shipped artwork.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/TASK-752'
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
SIZES = (16, 32, 48, 180, 512)
INK, IVORY, RED, GOLD = '#211a30', '#fff0c8', '#d64e64', '#ffc86a'
SOURCES = ['assets/sprites/' + n + '.svg' for n in
           ('imp', 'normchel', 'emberArcher', 'demonPortalMelee', 'ravager')]

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def hashes():
    paths = subprocess.check_output(['git', 'ls-files', 'assets', 'sprites'], cwd=ROOT, text=True).splitlines()
    return {p: sha(ROOT / p) for p in paths if p.endswith('.svg')}

before = hashes()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'source-before.json').write_text(json.dumps(before, indent=2) + '\n')
(OUT / 'candidates').mkdir(exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
records = {}

def part(file, group, indices, transform, colors, stroke=3):
    """Copy exact source child geometry; flatten paint and enlarge contours."""
    source = 'assets/sprites/' + file + '.svg'
    root = ET.parse(ROOT / source).getroot()
    parent = next(e for e in root.iter() if e.get('id') == group)
    elements = list(parent)
    wrapper = ET.Element('{' + NS + '}g', {'transform': transform})
    refs = []
    for i, color in zip(indices, colors):
        original = elements[i]
        element = copy.deepcopy(original)
        assert element.tag.rsplit('}', 1)[-1] in ('path', 'circle', 'ellipse')
        geometry = {k: v for k, v in original.attrib.items() if k in ('d', 'cx', 'cy', 'rx', 'ry', 'r')}
        element.attrib.clear()
        element.attrib.update(geometry)
        element.attrib.update(fill=color, stroke=INK, **{'stroke-width': str(stroke), 'stroke-linejoin': 'round', 'stroke-linecap': 'round'})
        if color == 'none':
            element.set('stroke', IVORY)
        wrapper.append(element)
        refs.append({'source': source, 'sha256': before[source], 'group_id': group,
                     'child_index_zero_based': i, 'geometry': geometry,
                     'paint': dict(element.attrib), 'transform': transform})
    return wrapper, refs

def make(letter, name, parts):
    svg = ET.Element('{' + NS + '}svg', {'viewBox': '0 0 512 512', 'width': '512', 'height': '512', 'fill': 'none'})
    refs = []
    for element, provenance in parts:
        svg.append(element)
        refs.extend(provenance)
    ET.ElementTree(svg).write(OUT / 'candidates' / (letter + '.svg'), encoding='unicode')
    records[letter] = {'name': name, 'edits': 'Exact geometry; selected details omitted; flat paint, contour width and affine transforms changed.', 'parts': refs}

# Each composition uses different game objects or a different combination/silhouette.
make('A', 'Imp mask', [part('imp', 'imp-head', [0,1,3,4,5,6,7,13], 'translate(-320 -28) scale(2.25)', [RED,RED,IVORY,IVORY,RED,IVORY,IVORY,IVORY])])
make('B', 'Single sword', [part('normchel', 'classic-sword', [0,1,2,5], 'translate(114 -20) scale(1.4)', [RED,GOLD,IVORY,GOLD], 5)])
make('C', 'Crossed swords', [part('normchel', 'classic-sword', [0,1,2,5], f'translate(256 256) rotate({angle}) translate(-135 -270) scale(1.25)', [RED,GOLD,IVORY,GOLD], 5) for angle in (-30,55)])
make('D', 'Ember bow and arrow', [part('emberArcher', 'ember-bow', [0,1,2], 'translate(60 -120) scale(1.55)', ['none',GOLD,RED], 5), part('emberArcher', 'ember-arrow', [0,1,2], 'translate(-220 -90) scale(1.5)', [RED,GOLD,IVORY], 5)])
make('E', 'Horned portal', [part('demonPortalMelee', 'recessed-entrance', [0,1], 'translate(-35 -25) scale(1.18)', [INK,RED], 6), part('demonPortalMelee', 'carved-stone-arch', [0], 'translate(-35 -25) scale(1.18)', [IVORY], 6), part('demonPortalMelee', 'horns', [0,1], 'translate(-35 -25) scale(1.18)', [GOLD,GOLD], 6)])
make('F', 'Spiked portal crown', [part('demonPortalMelee', 'melee-claw-motif', [2], 'translate(-535 -10) scale(3.2)', [RED], 2)])
make('G', 'Charging ravager head', [part('ravager', 'ravager-lowered-head', [0,1,2,3,6,7], 'translate(-695 -245) scale(2.35)', [RED,RED,IVORY,GOLD,INK,IVORY], 3)])
make('H', 'Arrow through shield', [part('normchel', 'classic-shield', [0], 'translate(-525 -200) scale(1.95)', [RED], 5), part('emberArcher', 'ember-arrow', [0,1,2], 'translate(-835 -485) scale(2.7)', [GOLD,IVORY,IVORY], 4)])
make('I', 'Horned ember face', [part('emberArcher', 'ea-unit-head', [0,2,3,4,5], 'translate(-590 -30) scale(3.3)', [RED,INK,IVORY,'none',IVORY], 2), part('emberArcher', 'ember-horns', [0,1], 'translate(-590 -30) scale(3.3)', [GOLD,GOLD], 2)])
make('J', 'Clawed hand', [part('imp', 'imp-arms', [2], 'translate(-590 -1965) scale(7.1)', [RED], 1.2)])
(OUT / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')

allowed = {'svg', 'g', 'path', 'circle', 'ellipse'}
for letter, record in records.items():
    path = OUT / 'candidates' / (letter + '.svg')
    svg = ET.parse(path).getroot()
    assert svg.get('viewBox') == '0 0 512 512'
    for e in svg.iter():
        assert e.tag.rsplit('}', 1)[-1] in allowed
        assert not (e.text or '').strip()
        assert not any('href' in k or 'url(' in v or 'data:' in v for k, v in e.attrib.items())
    for ref in record['parts']:
        root = ET.parse(ROOT / ref['source']).getroot()
        parent = next(e for e in root.iter() if e.get('id') == ref['group_id'])
        source = list(parent)[ref['child_index_zero_based']]
        assert all(source.get(k) == v for k, v in ref['geometry'].items())
    print(f'PASS {letter}.svg XML valid; square viewBox; no external/raster/text elements; exact attributed source geometry', flush=True)
assert sorted(p.name for p in (OUT / 'candidates').iterdir()) == [c + '.svg' for c in records]
node = os.environ.get('NODE', '/usr/local/bin/node20')
js = r"""
const {createCanvas,loadImage}=require('canvas');
const fs=require('fs');
(async()=>{for(const c of 'ABCDEFGHIJ')for(const size of [16,32,48,180,512]){
const image=await loadImage(process.argv[1]+'/candidates/'+c+'.svg');
const canvas=createCanvas(size,size); canvas.getContext('2d').drawImage(image,0,0,size,size);
fs.writeFileSync(process.argv[1]+'/renders/'+c+'-'+size+'.png',canvas.toBuffer('image/png'));
console.log('PASS render '+c+'.svg '+size+'px');
}})().catch(e=>{console.error(e);process.exitCode=1});
"""
subprocess.run([node, '-e', js, str(OUT)], check=True)
for c in records:
    for size in SIZES:
        im = Image.open(OUT / 'renders' / f'{c}-{size}.png')
        assert im.size == (size, size) and im.getbbox()
# All sizes are displayed at native resolution on both backgrounds.
width, row = 1700, 548
sheet = Image.new('RGB', (width, 40 + row * 10), 'white')
draw = ImageDraw.Draw(sheet)
draw.text((12, 12), 'Native sizes: 16 / 32 / 48 / 180 / 512 | light and dark', fill='black')
for i, c in enumerate(records):
    y = 40 + i * row
    for column, bg in enumerate(('#f5f4f0', '#181c26')):
        x = column * 850
        draw.rectangle((x,y,x+849,y+row-1), fill=bg)
        draw.text((x+12,y+8), c+' - '+records[c]['name'], fill='black' if column==0 else 'white')
        left = x+12
        for size in SIZES:
            im = Image.open(OUT / 'renders' / f'{c}-{size}.png')
            sheet.paste(im, (left,y+28+(512-size)//2), im)
            left += size + 12
sheet.save(OUT / 'contact-sheet.png')
tabs = Image.new('RGB', (1000, 700), 'white')
draw = ImageDraw.Draw(tabs)
for i, c in enumerate(records):
    for col, bg in enumerate(('#f5f4f0', '#181c26')):
        x,y = col*500,i*70
        draw.rectangle((x,y,x+499,y+69), fill=bg)
        fg = 'black' if col==0 else 'white'
        im = Image.open(OUT / 'renders' / f'{c}-16.png')
        tabs.paste(im, (x+16,y+26),im)
        draw.text((x+42,y+28), c+'  Diplomacy  |  x',fill=fg)
        enlarged=im.resize((64,64),getattr(Image, 'Resampling', Image).NEAREST)
        tabs.paste(enlarged,(x+325,y+3),enlarged)
        draw.text((x+402,y+28),'4x',fill=fg)
tabs.save(OUT / 'tab-mockups.png')
after = hashes()
with (OUT / 'source-integrity.log').open('w') as log:
    for path in before:
        log.write(f'{path} BEFORE={before[path]} AFTER={after[path]} identical={before[path]==after[path]}\n')
    assert before == after
    log.write(f'PASS all {len(before)} tracked source SVG and logo hashes identical\n')
print('PASS exactly ten candidates; 50 renders; contact sheet and tab mockups produced; source hashes identical')
