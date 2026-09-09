#!/usr/bin/env python3
"""Reject missing and failed factorial captures without touching raw evidence."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys


def main():
    original, output = (Path(arg).resolve() for arg in sys.argv[1:])
    assert not output.is_relative_to(original), 'negative copies must be outside source'
    output.mkdir()
    path = Path(__file__).resolve().parents[1] / 'task102-audit-full-phases.py'
    spec = importlib.util.spec_from_file_location('phases', path)
    auditor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auditor)
    for name in ('missing-log', 'failed-exit', 'changed-time'):
        case = output / name
        shutil.copytree(original, case, symlinks=True, copy_function=os.link)
        if name == 'missing-log':
            (case / 'run-1-A/command.log').unlink()
        else:
            target = case / 'runs.json'
            runs = json.loads(target.read_text())
            target.unlink()  # Break the hard link before editing the deliberate defect.
            if name == 'failed-exit':
                runs[0]['exit_code'] = 42
            else:
                runs[0]['seconds'] += 1
            target.write_text(json.dumps(runs) + '\n')
        log = io.StringIO()
        try:
            with contextlib.redirect_stdout(log):
                auditor.audit(case)
        except (FileNotFoundError, AssertionError) as error:
            if name == 'missing-log':
                assert isinstance(error, FileNotFoundError) and error.filename.endswith('run-1-A/command.log')
            else:
                expected = 'invalid run 1' if name == 'failed-exit' else 'raw elapsed drift'
                assert str(error) == expected, str(error)
            log.write(f'EXPECTED_REJECTION: {error}\n')
        else:
            raise AssertionError(f'accepted corrupt capture: {name}')
        (output / (name + '.log')).write_text(log.getvalue())
        print(f'CORRUPT_FACTORIAL_EVIDENCE: PASS {name} rejected; original raw evidence untouched')


if __name__ == '__main__':
    main()
