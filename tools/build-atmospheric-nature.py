#!/usr/bin/env python3
"""Relight existing painted surfaces; never alter geometry, opacity or anchors."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
for name in ('bush', 'hill', 'mountain', 'lake', 'sea'):
    source = (ROOT / 'assets/sprites' / (name + '.svg')).read_text()
    def relight(match):
        rgb = [int(match[1][i:i+2], 16) for i in (0, 2, 4)]
        # Existing bright upper-left facets receive warm light; shaded facets
        # receive cool reflected light. Water keeps its blue/teal pigment.
        r, g, b = rgb
        light = (max(rgb) + min(rgb)) / 2
        water = b > r and g > r
        if water:
            delta = (12, 5, -4) if light > 135 else (-9, -5, 7)
        elif light >= 145:
            delta = (23, 7, -17)
        elif light <= 115:
            delta = (-12, -5, 16)
        else:
            delta = (4, -2, -4)
        return '#' + ''.join(f'{max(0,min(255,v+d)):02x}' for v,d in zip(rgb,delta))
    result = re.sub(r'#([0-9a-fA-F]{6})\b', relight, source)
    (ROOT / 'assets/atmosphere/nature' / (name + '.svg')).write_text(result)
