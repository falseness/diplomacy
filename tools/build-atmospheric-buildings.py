#!/usr/bin/env python3
"""Bake light into existing SVG paints; preserve geometry, alpha and identity motifs."""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[1]
NAMES = ('town', 'farm', 'barrack', 'wall', 'bastion', 'tower', 'goldmine',
         'demonPortalMelee', 'demonPortalRanged', 'demonPortalSiege',
         'demonPortalHeavy', 'demonPortalCavalry', 'demonPortalChaos', 'demonPortalMage')
DEST = ROOT / 'assets/atmosphere/buildings'
DEST.mkdir(parents=True, exist_ok=True)
for name in NAMES:
    source = (ROOT / 'assets/sprites' / (name + '.svg')).read_text()
    def gradient(m):
        block = m[0]
        ident = re.search(r'id="([^"]+)"', block)[1]
        # Keep category-specific hats, orbs, sigils and all direct paints unchanged.
        portal = name.startswith('demonPortal')
        stone = {'dome', 'left', 'front', 'right', 'light', 'arch', 'arch-right', 'reveal', 'floor', 'gold', 'cave'}
        if portal and ident not in stone | {'rift'}:
            return block
        if 'shadow' in ident or ident in ('ground', 'contact'):
            return block
        colors = list(re.finditer(r'#[0-9a-fA-F]{6}\b', block))
        index = 0
        def paint(c):
            nonlocal index
            t = index / max(1, len(colors)-1)
            index += 1
            rgb = [int(c[0][i:i+2],16) for i in (1,3,5)]
            if portal and ident == 'rift':
                # Same hue, restrained brightening of the existing light source.
                rgb = [round(v+(255-v)*0.10) for v in rgb]
            elif (name == 'town' and ident in ('town-paint-door','town-paint-window')) or (name == 'goldmine' and ident == 'cave'):
                target = ((255, 250, 185) if t < .5 else (255, 206, 108)) if 'window' in ident else ((255, 224, 132) if t < .5 else (180, 112, 48))
                strength = .85 if name == 'goldmine' else .55
                rgb = [round(v*(1-strength)+w*strength) for v,w in zip(rgb,target)]
            else:
                delta = (20-28*t, 7-12*t, -15+24*t)
                rgb = [round(v+d) for v,d in zip(rgb,delta)]
            return '#' + ''.join(f'{max(0,min(255,v)):02x}' for v in rgb)
        return re.sub(r'#[0-9a-fA-F]{6}\b', paint, block)
    result = re.sub(r'<(?:linear|radial)Gradient\b.*?</(?:linear|radial)Gradient>', gradient, source, flags=re.S)
    # Compact inter-element whitespace in generated variants, not geometry.
    result = re.sub(r'>\s+<', '><', result).strip() + '\n'
    (DEST / (name+'.svg')).write_text(result)
