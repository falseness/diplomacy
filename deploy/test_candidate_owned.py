import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import json
from candidate_owned import owned_environment


class CleanupTest(unittest.TestCase):
    def test_detached_child_cleanup_on_failure(self):
        foreign = subprocess.Popen(['sleep', '30'], start_new_session=True)
        try:
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                with self.assertRaisesRegex(RuntimeError, 'injected timeout'):
                    with owned_environment(os.environ, output) as env:
                        child = subprocess.Popen(['sleep', '30'], env=env, start_new_session=True)
                        (Path(env['TMPDIR']) / 'resource').write_text('owned')
                        raise RuntimeError('injected timeout')
                child.wait(timeout=5)
                proof = json.loads((output / 'owned-cleanup.json').read_text())
                self.assertIn(child.pid, proof['residualBeforeCleanup'])
                self.assertEqual(proof['aliveAfter'], [])
                self.assertFalse(proof['existsAfter'])
                self.assertIsNone(foreign.poll())
                print('PASS detached timeout cleanup; owned process and temporary resources removed; foreign process preserved')
        finally:
            foreign.terminate()
            foreign.wait()


if __name__ == '__main__':
    unittest.main()
