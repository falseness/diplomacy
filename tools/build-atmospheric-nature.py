#!/usr/bin/env python3
"""Relight existing painted surfaces; never alter geometry, opacity or anchors."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def paint(hex_color, delta):
    rgb = [int(hex_color[i:i+2], 16) for i in (0, 2, 4)]
    return '#' + ''.join(f'{max(0, min(255, v+d)):02x}' for v, d in zip(rgb, delta))


for name in ('bush', 'hill', 'mountain', 'lake', 'sea'):
    source = (ROOT / 'assets/sprites' / (name + '.svg')).read_text()

    def relight(match):
        rgb = [int(match[1][i:i+2], 16) for i in (0, 2, 4)]
        r, g, b = rgb
        light = (max(rgb) + min(rgb)) / 2
        if b > r and g > r:  # Water keeps its blue/teal pigment.
            delta = (12, 5, -4) if light > 135 else (-9, -5, 7)
        elif light >= 145:
            delta = (34, 9, -35)
        elif light <= 115:
            delta = (-22, -12, 12)
        else:
            delta = (16, 0, -20)
        return paint(match[1], delta)

    result = re.sub(r'#([0-9a-fA-F]{6})\b', relight, source)
    # The authored mountain gradients describe surface orientation explicitly.
    # Bright snow on a right-facing plane is still in shade: luminance alone
    # cannot distinguish it from a sun-facing surface. Preserve all stops,
    # coordinates and opacity, changing only paint in these existing gradients.
    faces = {
        'stone-left': (30, 8, -30), 'stone-lit': (30, 10, -34),
        'stone-front': (15, 0, -22), 'stone-side': (-34, -26, 4),
        'stone-dark': (-30, -20, 8), 'snow': (0, -3, -30),
        'snow-side': (-28, -22, -2), 'snow-shade': (-48, -32, 2),
    } if name == 'mountain' else {}
    for face, delta in faces.items():
        pattern = r'<linearGradient id="' + face + r'"[^>]*>.*?</linearGradient>'
        original = re.search(pattern, source)[0]
        shaded = re.sub(r'#([0-9a-fA-F]{6})\b', lambda m: paint(m[1], delta), original)
        result = re.sub(pattern, lambda _: shaded, result)
    (ROOT / 'assets/atmosphere/nature' / (name + '.svg')).write_text(result)
