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
                # Bright core, warm inner ring; keep the category hue at the rim.
                target = (255, 255, 235) if t == 0 else (255, 237, 174)
                strength = .96 if t == 0 else .72 if t < .5 else .16
                rgb = [round(v+(max(v,w)-v)*strength) for v,w in zip(rgb,target)]
            elif (name == 'town' and ident in ('town-paint-door','town-paint-window')) or (name == 'goldmine' and ident == 'cave'):
                target = (255, 255, 231) if t == 0 else (255, 226, 139) if t < .75 else (239, 158, 63)
                rgb = list(target)
            elif ident in ('reveal', 'floor', 'arch'):
                # Existing entrance surround catches warm near-source light.
                target = (255, 211, 126) if t == 0 else (148, 95, 63)
                rgb = [round(v*.55+w*.45) for v,w in zip(rgb,target)]
            elif ('side' in ident and ident != 'canvas-side') or ident in ('right', 'arch-right', 'right-flap'):
                # Opposing planes keep their material hue under cool ambient light.
                rgb = [round(v*k+d) for v,k,d in zip(rgb,(.53,.62,.80),(0,5,15))]
            elif name == 'tower' and ident in ('top', 'edge'):
                rgb = [round(v+d) for v,d in zip(rgb,(30,5,-55))]
            else:
                # Broad surface contrast, baked into existing gradient coordinates.
                delta = (48-100*t, 20-60*t, -25+24*t)
                rgb = [round(v+d) for v,d in zip(rgb,delta)]
            return '#' + ''.join(f'{max(0,min(255,v)):02x}' for v in rgb)
        return re.sub(r'#[0-9a-fA-F]{6}\b', paint, block)
    result = re.sub(r'<(?:linear|radial)Gradient\b.*?</(?:linear|radial)Gradient>', gradient, source, flags=re.S)
    # Compact inter-element whitespace in generated variants, not geometry.
    result = re.sub(r'>\s+<', '><', result).strip() + '\n'
    (DEST / (name+'.svg')).write_text(result)
