#!/usr/bin/env python3
"""Luminance/atmosphere metrics for board screenshots (read-only; no rendering).

Usage:
  visual-metrics.py IMAGE [--board x0,x1,y0,y1] [--json] [--thresholds FILE]

Without --board the board is auto-detected as the largest bright hex-tile region.
Board metrics (L = 0.2126R + 0.7152G + 0.0722B on 0..1 sRGB values): median,
block_std / block_p90_p10 (std and p90/p10 of 40 px block means), highlight_p997,
bright_sat (mean max-min channel of the 2% brightest pixels), ul_lr (upper-left
over lower-right quadrant mean) and warm_rb (mean R - mean B). Background metrics
(bg_p90, bg_std, ember_count = blobs of L >= 0.6, >= 2 px area and 2..12 px
across) use everything outside the board box grown by --bg-margin.

With --thresholds the metrics are checked against a profile and the exit status
is 1 when any check fails.
"""
import argparse
import json
import sys
from collections import deque

import numpy as np
from PIL import Image

BLOCK = 40
EMBER_L = 0.6
EMBER_MIN, EMBER_MAX = 2, 12  # blob size: >= 2 px area, 2..12 px across
# The board box is an interior box; the background starts this far outside it so
# that edge tiles, the board's side faces, cast shadow and rim glow are not counted.
BG_MARGIN = 40


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255.0


def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def block_means(lum, block=BLOCK):
    """Means of the complete block x block tiles of a 2-D array."""
    h, w = lum.shape
    bh, bw = h // block, w // block
    if bh == 0 or bw == 0:
        return np.array([lum.mean()])
    tiles = lum[:bh * block, :bw * block].reshape(bh, block, bw, block)
    return tiles.mean(axis=(1, 3)).ravel()


def components(mask):
    """(area, extent) of each 8-connected component; extent = larger bbox side in px."""
    seen = np.zeros_like(mask, dtype=bool)
    h, w = mask.shape
    sizes = []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        queue = deque([(y, x)])
        size = 0
        top, bottom, left, right = y, y, x, x
        while queue:
            cy, cx = queue.popleft()
            size += 1
            top, bottom = min(top, cy), max(bottom, cy)
            left, right = min(left, cx), max(right, cx)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
        sizes.append((size, max(bottom - top, right - left) + 1))
    return sizes


def detect_board(rgb, block=20):
    """Bounding box of the largest connected region of bright, low-texture tile blocks."""
    lum = luminance(rgb)
    h, w = lum.shape
    bh, bw = h // block, w // block
    tiles = lum[:bh * block, :bw * block].reshape(bh, block, bw, block)
    mean = tiles.mean(axis=(1, 3))
    # Board tiles are the bright plateau of the frame; background sky/clouds are darker.
    level = max(0.35, float(np.percentile(mean, 50)) * 0.9)
    level = min(level, float(np.percentile(mean, 90)) * 0.8)
    mask = mean >= level
    best = None
    seen = np.zeros_like(mask)
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        queue, cells = deque([(y, x)]), []
        while queue:
            cy, cx = queue.popleft()
            cells.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < bh and 0 <= nx < bw and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if best is None or len(cells) > len(best):
            best = cells
    ys = np.array([c[0] for c in best])
    xs = np.array([c[1] for c in best])
    # Trim sparse rows/columns (UI overlaps, stray bright blocks) to the dense core.
    def dense_range(idx, n):
        counts = np.bincount(idx, minlength=n)
        keep = np.nonzero(counts >= 0.5 * counts.max())[0]
        return int(keep.min()), int(keep.max())
    y0, y1 = dense_range(ys, bh)
    x0, x1 = dense_range(xs, bw)
    return x0 * block, min(w, (x1 + 1) * block), y0 * block, min(h, (y1 + 1) * block)


def metrics(rgb, board, bg_margin=BG_MARGIN):
    x0, x1, y0, y1 = board
    lum = luminance(rgb)
    b_rgb = rgb[y0:y1, x0:x1]
    b_lum = lum[y0:y1, x0:x1]
    blocks = block_means(b_lum)
    p10, p90 = np.percentile(blocks, [10, 90])
    flat = b_lum.ravel()
    top = flat >= np.percentile(flat, 98)
    chan = b_rgb.reshape(-1, 3)
    sat = chan.max(axis=1) - chan.min(axis=1)
    bh, bw = b_lum.shape
    ul = b_lum[:bh // 2, :bw // 2].mean()
    lr = b_lum[bh - bh // 2:, bw - bw // 2:].mean()
    bg_mask = np.ones(lum.shape, dtype=bool)
    bg_mask[max(0, y0 - bg_margin):y1 + bg_margin, max(0, x0 - bg_margin):x1 + bg_margin] = False
    bg = lum[bg_mask]
    ember_mask = (lum >= EMBER_L) & bg_mask
    embers = sum(1 for area, extent in components(ember_mask)
                 if area >= EMBER_MIN and EMBER_MIN <= extent <= EMBER_MAX)
    return {
        'board': [int(x0), int(x1), int(y0), int(y1)],
        'bg_margin': int(bg_margin),
        'bg_pixels': int(bg.size),
        'median': float(np.median(flat)),
        'block_std': float(blocks.std()),
        'block_p90_p10': float(p90 / p10) if p10 > 0 else float('inf'),
        'highlight_p997': float(np.percentile(flat, 99.7)),
        'bright_sat': float(sat[top].mean()),
        'ul_lr': float(ul / lr) if lr > 0 else float('inf'),
        'warm_rb': float(chan[:, 0].mean() - chan[:, 2].mean()),
        'bg_p90': float(np.percentile(bg, 90)) if bg.size else 0.0,
        'bg_std': float(bg.std()) if bg.size else 0.0,
        'ember_count': int(embers),
    }


def check(values, profile):
    """Profile entries: {"metric": {"min": a}} / {"max": b} / {"min": a, "max": b}."""
    failures = []
    for name, rule in profile.items():
        if name.startswith('_'):
            continue
        value = values[name]
        ok = ('min' not in rule or value >= rule['min']) and ('max' not in rule or value <= rule['max'])
        if not ok:
            failures.append(name)
        yield name, value, rule, ok
    check.failures = failures


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('image')
    ap.add_argument('--board', help='x0,x1,y0,y1 board box in pixels (default: auto-detect)')
    ap.add_argument('--bg-margin', type=int, default=BG_MARGIN,
                    help='pixels outside the board box excluded from background metrics (default %(default)s)')
    ap.add_argument('--json', action='store_true', help='print metrics as JSON')
    ap.add_argument('--thresholds', help='threshold profile JSON; exit 1 on any failure')
    args = ap.parse_args(argv)
    rgb = load_rgb(args.image)
    if args.board:
        board = tuple(int(v) for v in args.board.split(','))
        if len(board) != 4:
            ap.error('--board needs x0,x1,y0,y1')
        source = 'explicit'
    else:
        board = detect_board(rgb)
        source = 'auto'
    values = metrics(rgb, board, args.bg_margin)
    values['board_source'] = source
    values['image'] = args.image
    values['size'] = [rgb.shape[1], rgb.shape[0]]
    if args.json:
        print(json.dumps(values, indent=2))
    else:
        for k, v in values.items():
            print(f'{k}: {v}')
    if args.thresholds:
        with open(args.thresholds) as f:
            profile = json.load(f)
        for name, value, rule, ok in check(values, profile):
            bounds = ' '.join(f'{k}={v}' for k, v in rule.items())
            print(f'{"PASS" if ok else "FAIL"} {name}={value:.4f} {bounds}', file=sys.stderr)
        if check.failures:
            print('THRESHOLDS_FAILED ' + ','.join(check.failures), file=sys.stderr)
            return 1
        print('THRESHOLDS_PASSED', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
