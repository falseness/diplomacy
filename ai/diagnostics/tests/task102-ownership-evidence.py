#!/usr/bin/env python3
"""Reject actual corrupted ownership captures without touching the originals."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys

AUDITOR = Path(__file__).resolve().parents[1] / 'task102-audit-full-phases.py'
SOURCE_PATH = 'ai/mutableVectorGrid.js'


def main():
    original, output = (Path(value).resolve() for value in sys.argv[1:])
    output.mkdir()
    spec = importlib.util.spec_from_file_location('phase_auditor', AUDITOR)
    auditor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auditor)
    for name, expected in (('source', 'unexpected reversal source'), ('exit', 'invalid run 1')):
        case = output / name
        # Hardlink immutable captured files; unlink the single file before mutation.
        shutil.copytree(original, case, symlinks=True, copy_function=os.link)
        target = case / ('source-reversal/' + SOURCE_PATH if name == 'source' else 'runs.json')
        contents = target.read_text()
        target.unlink()
        if name == 'source':
            target.write_text(contents + '\n// deliberate negative control\n')
        else:
            runs = json.loads(contents)
            runs[0]['exit_code'] = 42
            target.write_text(json.dumps(runs) + '\n')
        log = io.StringIO()
        try:
            with contextlib.redirect_stdout(log):
                auditor.audit(case)
        except AssertionError as error:
            assert str(error) == expected, (name, str(error))
            log.write(f'EXPECTED_REJECTION: {error}\n')
        else:
            raise AssertionError(f'auditor accepted corrupt {name}')
        (output / f'{name}.log').write_text(log.getvalue())
        print(f'CORRUPT_{name.upper()}_CONTROL: PASS {expected}; original evidence untouched')


if __name__ == '__main__':
    main()
