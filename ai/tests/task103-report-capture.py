#!/usr/bin/env python3
"""Runner lifecycle controls using fixture children; never gameplay evidence."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('driver', Path(__file__).with_name('task103-evidence.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

with tempfile.TemporaryDirectory() as temporary:
    dest = Path(temporary)
    for label, code, pause in [('success', 0, 0), ('failure', 7, 0), ('timeout', 124, 30)]:
        reports = dest / label
        reports.mkdir()
        child = '''import os, pathlib, sys, time
p = pathlib.Path(os.environ['AI_REGRESSION_REPORT_DIR'])
(p / 'partial.json').write_text('{"fixture": true, "candidateWon": false}')
print('FIXTURE_CHILD_OUTPUT', flush=True)
time.sleep(int(sys.argv[1]))
sys.exit(int(sys.argv[2]))
'''
        env = dict(os.environ, AI_REGRESSION_REPORT_DIR=str(reports))
        record = driver.execute(dest, label, [sys.executable, '-c', child, str(pause), str(code)],
                                dest, 1 if pause else 10, env)
        assert record['exit_code'] == code
        captured = driver.capture_reports(dest, label, reports)
        assert captured['files'] == 1
        hashes = json.loads(Path(captured['manifest']).read_text())
        assert hashes == {label + '/partial.json': driver.sha(reports / 'partial.json')}
        assert driver.sha(Path(captured['manifest'])) == captured['sha256']
        assert 'FIXTURE_CHILD_OUTPUT' in Path(record['log']).read_text()
        print(f'REPORT_CAPTURE: PASS fixture={label} preserved_exit={code} files=1')
    empty = dest / 'empty'
    empty.mkdir()
    captured = driver.capture_reports(dest, 'empty', empty)
    assert captured['files'] == 0
    assert Path(captured['manifest']).is_file()
    assert json.loads(Path(captured['manifest']).read_text()) == {}
    print('EMPTY_REPORT_INVENTORY: PASS exists files=0; no gameplay pass claim')
print('Report capture lifecycle controls passed')
