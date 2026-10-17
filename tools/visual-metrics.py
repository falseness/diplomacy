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

Region comparison (concept match):
  visual-metrics.py --region-compare CONCEPT OURS [--regions FILE] [--profile NAME]
                    [--thresholds FILE] [--json-out FILE] [--overlay FILE]

Samples matched regions given as fixed pixel boxes in --regions (default
artifacts/reference/concept-regions.json): the "concept" profile for CONCEPT and, for OURS,
the profile whose "size" equals the OURS image size (or --profile NAME). Per region: mean
CIE Lab (sRGB D65, mean of per-pixel Lab), deltaE76 against the concept, mean luminance L
(plus, for information, the deltaE76 of each matched box pair and their mean).
Derived: grout/stone luminance ratio (mean of the grout-box luminance clipped at the stone mean,
over the stone mean, so bright bevels do not mask dark outlines), slab margins
(stone L - boardEdge L, boardEdge L - skyBelowBoard L) and the earth mover's distance between
the whole-image luminance histograms (64 bins over 0..1, unit = full luminance range).
--thresholds checks "region.metric" rules and exits 1 on any failure.
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


def srgb_to_lab(rgb):
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = lin @ np.array([[0.4124564, 0.3575761, 0.1804375],
                          [0.2126729, 0.7151522, 0.0721750],
                          [0.0193339, 0.1191920, 0.9503041]]).T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def region_pixels(rgb, boxes):
    """Pixels of a list of [x0, x1, y0, y1] boxes (rounded to whole pixels) as an (n, 3) array."""
    parts = []
    for x0, x1, y0, y1 in boxes:
        parts.append(rgb[int(round(y0)):int(round(y1)), int(round(x0)):int(round(x1))].reshape(-1, 3))
    return np.concatenate(parts)


HIST_BINS = 64


def lum_histogram_emd(a, b):
    ha = np.histogram(luminance(a), bins=HIST_BINS, range=(0, 1))[0].astype(np.float64)
    hb = np.histogram(luminance(b), bins=HIST_BINS, range=(0, 1))[0].astype(np.float64)
    return float(np.abs(np.cumsum(ha / ha.sum()) - np.cumsum(hb / hb.sum())).sum() / HIST_BINS)


def region_stats(rgb, profile):
    out = {}
    for name, boxes in profile['regions'].items():
        px = region_pixels(rgb, boxes)
        lab = srgb_to_lab(px).mean(axis=0)
        out[name] = {'pixels': int(len(px)), 'lab': [round(float(v), 3) for v in lab],
                     'L': round(float(luminance(px).mean()), 4)}
    return out


def region_compare(concept_rgb, ours_rgb, concept_profile, ours_profile):
    c, o = region_stats(concept_rgb, concept_profile), region_stats(ours_rgb, ours_profile)
    result = {'regions': {}}
    for name in c:
        de = float(np.linalg.norm(np.array(o[name]['lab']) - np.array(c[name]['lab'])))
        # Informational: deltaE76 of each matched box pair (same cell / same sky box).
        boxes = [float(np.linalg.norm(srgb_to_lab(region_pixels(ours_rgb, [ob])).mean(axis=0) -
                                      srgb_to_lab(region_pixels(concept_rgb, [cb])).mean(axis=0)))
                 for cb, ob in zip(concept_profile['regions'][name], ours_profile['regions'][name])]
        result['regions'][name] = {'concept': c[name], 'ours': o[name], 'deltaE': round(de, 3),
                                   'boxDeltaE': [round(v, 2) for v in boxes], 'meanBoxDeltaE': round(float(np.mean(boxes)), 3)}
    for side, stats in (('concept', c), ('ours', o)):
        # Grout darkness: grout pixels are clipped at the stone mean before averaging, so a bright bevel
        # highlight next to a dark outline cannot cancel it out.
        rgb, profile = (concept_rgb, concept_profile) if side == 'concept' else (ours_rgb, ours_profile)
        grout_l = np.minimum(luminance(region_pixels(rgb, profile['regions']['grout'])), stats['stone']['L']).mean()
        stats['grout']['groutClippedL'] = round(float(grout_l), 4)
        result['regions']['grout'][side]['groutStoneRatio'] = round(float(grout_l) / stats['stone']['L'], 4)
        result['regions']['boardEdge'][side]['belowStone'] = round(stats['stone']['L'] - stats['boardEdge']['L'], 4)
        result['regions']['boardEdge'][side]['aboveSky'] = round(stats['boardEdge']['L'] - stats['skyBelowBoard']['L'], 4)
    result['histogram'] = {'bins': HIST_BINS, 'emd': round(lum_histogram_emd(concept_rgb, ours_rgb), 5)}
    return result


def region_value(result, key):
    """'stone.deltaE', 'grout.groutStoneRatio' (ours side), 'histogram.emd'."""
    region, metric = key.split('.')
    if region == 'histogram':
        return result['histogram'][metric]
    entry = result['regions'][region]
    return entry['deltaE'] if metric == 'deltaE' else entry['ours'][metric]


def draw_overlay(path, concept_rgb, ours_rgb, concept_profile, ours_profile):
    from PIL import ImageDraw
    colours = {'stone': (0, 200, 255), 'grout': (255, 0, 255), 'lampPool': (255, 140, 0), 'boardEdge': (0, 255, 0),
               'skyBelowBoard': (160, 160, 160), 'skyUpperLeft': (255, 255, 0), 'skyLowerLeft': (255, 60, 60)}
    images = []
    for rgb, profile in ((concept_rgb, concept_profile), (ours_rgb, ours_profile)):
        im = Image.fromarray((rgb * 255).round().astype(np.uint8))
        if im.height != concept_rgb.shape[0]:
            k = concept_rgb.shape[0] / im.height
            im = im.resize((round(im.width * k), concept_rgb.shape[0]), Image.LANCZOS)
        else:
            k = 1
        d = ImageDraw.Draw(im)
        for name, boxes in profile['regions'].items():
            for x0, x1, y0, y1 in boxes:
                d.rectangle([x0 * k, y0 * k, x1 * k - 1, y1 * k - 1], outline=colours.get(name, (255, 255, 255)), width=2)
        y, lx = 8, round(im.width * 0.2)
        for name, colour in colours.items():
            d.rectangle([lx, y, lx + 16, y + 12], fill=colour)
            d.text((lx + 22, y), name, fill=(255, 255, 255))
            y += 18
        images.append(im)
    out = Image.new('RGB', (sum(i.width for i in images) + 10, images[0].height), (255, 255, 255))
    out.paste(images[0], (0, 0))
    out.paste(images[1], (images[0].width + 10, 0))
    out.save(path)


def main_region_compare(args):
    with open(args.regions) as f:
        regions = json.load(f)
    concept_rgb, ours_rgb = load_rgb(args.region_compare[0]), load_rgb(args.region_compare[1])
    size = f'{ours_rgb.shape[1]}x{ours_rgb.shape[0]}'
    name = args.profile or next((k for k, v in regions['profiles'].items() if k != 'concept' and v['size'] == size), None)
    if name is None:
        print(f'no region profile for image size {size}', file=sys.stderr)
        return 2
    concept_profile, ours_profile = regions['profiles']['concept'], regions['profiles'][name]
    if ours_profile['size'] != size:
        print(f'profile {name} is for {ours_profile["size"]}, image is {size}', file=sys.stderr)
        return 2
    result = region_compare(concept_rgb, ours_rgb, concept_profile, ours_profile)
    result.update({'concept': args.region_compare[0], 'ours': args.region_compare[1], 'oursSize': size, 'profile': name})
    for region, entry in result['regions'].items():
        extra = ''.join(f' {k}={entry["ours"][k]}' for k in ('groutStoneRatio', 'belowStone', 'aboveSky') if k in entry['ours'])
        print(f'{region}: deltaE={entry["deltaE"]} meanBoxDeltaE={entry["meanBoxDeltaE"]} L={entry["ours"]["L"]} (concept {entry["concept"]["L"]}) '
              f'lab={entry["ours"]["lab"]} (concept {entry["concept"]["lab"]}){extra}')
    print(f'histogram: emd={result["histogram"]["emd"]}')
    status = 0
    if args.thresholds:
        with open(args.thresholds) as f:
            profile = json.load(f)
        failures, checks = [], []
        for key, rule in profile.items():
            if key.startswith('_'):
                continue
            value = region_value(result, key)
            ok = ('min' not in rule or value >= rule['min']) and ('max' not in rule or value <= rule['max'])
            checks.append({'check': key, 'value': value, **rule, 'pass': ok})
            bounds = ' '.join(f'{k}={v}' for k, v in rule.items())
            print(f'{"PASS" if ok else "FAIL"} {key}={value:.4f} {bounds}', file=sys.stderr)
            if not ok:
                failures.append(key)
        result['checks'] = checks
        if failures:
            print('THRESHOLDS_FAILED ' + ','.join(failures), file=sys.stderr)
            status = 1
        else:
            print('THRESHOLDS_PASSED', file=sys.stderr)
    if args.json_out:
        with open(args.json_out, 'w') as f:
            json.dump(result, f, indent=2)
            f.write('\n')
    if args.overlay:
        draw_overlay(args.overlay, concept_rgb, ours_rgb, concept_profile, ours_profile)
    return status


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('image', nargs='?')
    ap.add_argument('--region-compare', nargs=2, metavar=('CONCEPT', 'OURS'))
    ap.add_argument('--regions', default='artifacts/reference/concept-regions.json')
    ap.add_argument('--profile', help='region profile for OURS (default: the profile matching its size)')
    ap.add_argument('--json-out', help='write the region comparison as JSON')
    ap.add_argument('--overlay', help='write CONCEPT | OURS with the region boxes drawn')
    ap.add_argument('--board', help='x0,x1,y0,y1 board box in pixels (default: auto-detect)')
    ap.add_argument('--bg-margin', type=int, default=BG_MARGIN,
                    help='pixels outside the board box excluded from background metrics (default %(default)s)')
    ap.add_argument('--json', action='store_true', help='print metrics as JSON')
    ap.add_argument('--thresholds', help='threshold profile JSON; exit 1 on any failure')
    args = ap.parse_args(argv)
    if args.region_compare:
        return main_region_compare(args)
    if not args.image:
        ap.error('IMAGE or --region-compare is required')
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
