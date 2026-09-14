#!/usr/bin/env python3
"""Run TASK-086's complete repair checks with durable timing and exit evidence."""
import argparse
import datetime
import pathlib
import shlex
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default='/usr/local/bin/node20')
    parser.add_argument('--output-dir', default='artifacts/TASK-086')
    parser.add_argument('--timeout', type=float, default=1200,
                        help='Per-suite deadline in seconds (default: 1200)')
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    root = pathlib.Path(__file__).resolve().parents[1]
    out = pathlib.Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    names = ['balance', 'connectivity', 'starts', 'terrain', 'portal-layout']
    # Preserve previous passing evidence and failures before replacing any output.
    existing = [p for p in out.iterdir() if p.is_file() and
                (p.name in ['verification.log'] + [n + '.log' for n in names]
                 or p.name.endswith('-matrix.json'))]
    if existing:
        archive = out / ('previous-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        archive.mkdir()
        for p in existing:
            p.rename(archive / p.name)
    version = subprocess.check_output([args.node, '--version'], text=True).strip()
    failed = False
    with (out / 'verification.log').open('w') as combined:
        for name in names:
            script = 'ai/test-coop-' + (name if name == 'portal-layout' else 'generation-' + name) + '.js'
            cmd = [args.node, script, '--output-dir', str(out)]
            header = (f'UTC={datetime.datetime.now(datetime.timezone.utc).isoformat()} '
                      f'cwd={root} runtime={args.node} version={version}\n'
                      f'COMMAND: {shlex.join(cmd)}\nWATCHDOG_SECONDS={args.timeout}\n')
            started = time.monotonic()
            with (out / (name + '.log')).open('w') as log:
                log.write(header)
                log.flush()
                try:
                    result = subprocess.run(cmd, cwd=root, stdout=log,
                                            stderr=subprocess.STDOUT, timeout=args.timeout)
                    status = result.returncode
                    outcome = f'EXIT_STATUS={status}'
                except subprocess.TimeoutExpired:
                    status = 124
                    outcome = 'WATCHDOG_TIMEOUT=true\nEXIT_STATUS=unavailable\nWATCHDOG_STATUS=124'
                elapsed = time.monotonic() - started
                log.write(f'\nELAPSED_SECONDS={elapsed:.3f}\n{outcome}\n')
            combined.write((out / (name + '.log')).read_text())
            combined.flush()
            print(f'{name}: elapsed_seconds={elapsed:.3f} {outcome}', flush=True)
            failed |= status != 0
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
