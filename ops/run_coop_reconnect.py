#!/usr/bin/env python3
"""Run sibling-server reconnect regressions with isolated, local evidence.

The historical server fixture has a fixed output path. Temporarily add an
output override and explicit Imp ownership, then restore its exact original bytes, keeping the regression
workflow in this repository without requiring a second repository commit.
"""
import argparse
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--server-dir', type=Path,
                        default=Path(__file__).resolve().parents[2] / 'diplomacy_server')
    parser.add_argument('--node', default='/usr/local/bin/node20')
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    fixture = args.server_dir / 'tests/coop/browser-reconnect.test.js'
    original = fixture.read_bytes()
    old = b"const out=path.join(root,'artifacts/TASK-056');"
    new = (b'const out=process.env.COOP_TEST_OUTPUT_DIR\n'
           b'    ? path.resolve(process.env.COOP_TEST_OUTPUT_DIR)\n'
           b"    : path.join(root,'artifacts/TASK-056');")
    if original.count(old) != 1:
        raise RuntimeError('Reconnect output declaration changed; inspect before adapting')
    spawn = b'f.evaluate(`new Imp(2,4);'
    owned_spawn = b'f.evaluate(`grid.getHexagon({x:2,y:4}).playerColor=3;new Imp(2,4);'
    if original.count(spawn) != 1:
        raise RuntimeError('Reconnect Imp fixture changed; inspect ownership setup')
    adapted = original.replace(old, new).replace(spawn, owned_spawn)
    (out / 'browser-reconnect.test.js').write_bytes(adapted)
    command = [args.node, '--test', 'tests/coop/phase-idempotence.test.js',
               'tests/coop/browser-reconnect.test.js']
    print('COMMAND='+repr(command), 'CWD='+str(args.server_dir), flush=True)
    fixture.write_bytes(adapted)
    try:
        result = subprocess.run(command, cwd=args.server_dir,
                                env={**os.environ, 'COOP_TEST_OUTPUT_DIR':str(out)},
                                timeout=600)
    finally:
        if fixture.read_bytes() != adapted:
            raise RuntimeError('Fixture edited during run; refusing to overwrite it')
        fixture.write_bytes(original)
    print('EXIT_STATUS='+str(result.returncode), flush=True)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
