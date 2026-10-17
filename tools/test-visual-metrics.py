#!/usr/bin/env python3
"""Focused checks of tools/visual-metrics.py on synthetic images."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

TOOL = Path(__file__).resolve().with_name('visual-metrics.py')
spec = importlib.util.spec_from_file_location('visual_metrics', TOOL)
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)

failures = 0


def expect(name, ok, detail):
    global failures
    failures += not ok
    print(f'{"PASS" if ok else "FAIL"} {name} {detail}')


def image(fn, w=400, h=400):
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    return fn(xs, ys)


def gray(lum):
    return np.repeat(lum[..., None], 3, axis=2)


board = (0, 400, 0, 400)

flat = gray(image(lambda x, y: np.full_like(x, 0.5)))
m = vm.metrics(flat, board)
expect('flat_block_std', m['block_std'] == 0.0, f"block_std={m['block_std']}")
expect('flat_p90_p10', abs(m['block_p90_p10'] - 1.0) < 1e-12, f"block_p90_p10={m['block_p90_p10']}")
expect('flat_median', abs(m['median'] - 0.5) < 1e-12, f"median={m['median']}")
expect('flat_ul_lr', abs(m['ul_lr'] - 1.0) < 1e-12, f"ul_lr={m['ul_lr']}")
expect('gray_warm_rb', abs(m['warm_rb']) < 1e-12, f"warm_rb={m['warm_rb']}")
expect('gray_bright_sat', abs(m['bright_sat']) < 1e-12, f"bright_sat={m['bright_sat']}")

# Diagonal gradient L = 1 - (x + y) / 1600 on a 400x400 board: the upper-left
# quadrant mean is 1 - 199/1600 and the lower-right is 1 - 599/1600.
grad = gray(image(lambda x, y: 1 - (x + y) / 1600))
m = vm.metrics(grad, board)
expected = (1 - (99.5 + 99.5) / 1600) / (1 - (299.5 + 299.5) / 1600)
expect('gradient_ul_lr', abs(m['ul_lr'] - expected) < 1e-9, f"ul_lr={m['ul_lr']:.6f} expected={expected:.6f}")
expect('gradient_block_std_positive', m['block_std'] > 0, f"block_std={m['block_std']:.6f}")

warm = np.zeros((400, 400, 3))
warm[..., 0], warm[..., 1], warm[..., 2] = 0.8, 0.5, 0.3
m = vm.metrics(warm, board)
expect('warm_rb', abs(m['warm_rb'] - 0.5) < 1e-12, f"warm_rb={m['warm_rb']}")
expect('bright_sat', abs(m['bright_sat'] - 0.5) < 1e-12, f"bright_sat={m['bright_sat']}")

# Background with embers: a 600x600 dark frame, board in the middle, five 3x3
# bright dots, one single-pixel speck (too small) and one 20x20 square (too big).
bg = np.full((600, 600), 0.1)
bg[200:400, 200:400] = 0.7
for x, y in ((20, 20), (60, 500), (500, 40), (550, 550), (300, 560)):
    bg[y:y + 3, x:x + 3] = 0.9
bg[100, 100] = 0.95
bg[480:500, 100:120] = 0.9
m = vm.metrics(gray(bg), (200, 400, 200, 400), bg_margin=10)
expect('ember_count', m['ember_count'] == 5, f"ember_count={m['ember_count']}")

detected = vm.detect_board(gray(bg))
expect('auto_board', detected == (200, 400, 200, 400), f'board={detected}')

# Threshold profile: CLI exits 0 on pass and 1 on failure, naming the metric.
with tempfile.TemporaryDirectory() as tmp:
    png = os.path.join(tmp, 'flat.png')
    Image.fromarray((flat * 255).round().astype(np.uint8)).save(png)
    prof_ok = os.path.join(tmp, 'ok.json')
    prof_bad = os.path.join(tmp, 'bad.json')
    Path(prof_ok).write_text(json.dumps({'median': {'min': 0.4, 'max': 0.6}}))
    Path(prof_bad).write_text(json.dumps({'median': {'min': 0.4}, 'block_std': {'min': 0.07}}))
    ok = subprocess.run([sys.executable, str(TOOL), png, '--thresholds', prof_ok], capture_output=True, text=True)
    bad = subprocess.run([sys.executable, str(TOOL), png, '--thresholds', prof_bad], capture_output=True, text=True)
    expect('cli_threshold_pass', ok.returncode == 0, f'exit={ok.returncode}')
    expect('cli_threshold_fail', bad.returncode == 1 and 'THRESHOLDS_FAILED block_std' in bad.stderr,
           f'exit={bad.returncode} stderr_tail={bad.stderr.strip().splitlines()[-1]!r}')

# Region grout ratio: a soft line passes; a black dotted outline beside a bright bevel (same box mean)
# fails, because grout pixels are clipped at the stone mean before averaging.
def grout_image(kind):
    im = np.full((40, 40), 0.6)
    if kind == 'soft':
        im[20:22, 0:20] = 0.36
    else:
        im[19:22, 0:20:2] = 0.06
        im[22:24, 0:20] = 0.765
    return gray(im)
prof = {'regions': {'stone': [[20, 40, 0, 20]], 'grout': [[0, 20, 16, 26]], 'lampPool': [[20, 40, 30, 40]],
                    'boardEdge': [[20, 40, 30, 40]], 'skyBelowBoard': [[20, 40, 30, 40]]}}
soft, dotted = grout_image('soft'), grout_image('dotted')
rs, rd = vm.region_compare(soft, soft, prof, prof), vm.region_compare(soft, dotted, prof, prof)
same_mean = abs(rs['regions']['grout']['ours']['L'] - rd['regions']['grout']['ours']['L']) < 0.005
gs, gd = rs['regions']['grout']['ours']['groutStoneRatio'], rd['regions']['grout']['ours']['groutStoneRatio']
expect('grout_clip', same_mean and gs >= 0.9 > gd,
       f"soft={gs} dotted={gd} boxMeanL soft={rs['regions']['grout']['ours']['L']} dotted={rd['regions']['grout']['ours']['L']}")

print(f'UNIT_RESULT {"PASS" if failures == 0 else "FAIL"} failures={failures}')
sys.exit(1 if failures else 0)
