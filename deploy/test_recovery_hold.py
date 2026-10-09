#!/usr/bin/env python3
"""Exercise the real privilege-boundary command with a sudo env-reset stand-in."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import source

GAME = '2e456b63-6c57-4014-8025-0ea0a16d4505'

class RecoveryHold(unittest.TestCase):
    def invoke(self, hold):
        with tempfile.TemporaryDirectory(prefix='recovery-hold-') as tmp:
            root = Path(tmp)
            (root / 'deploy').mkdir()
            (root / 'sudo').write_text('#!/bin/sh\n[ "$1" = "-n" ] && shift\nexec env -i PATH="/usr/bin:/bin" "$@"\n')
            (root / 'sudo').chmod(0o755)
            (root / 'deploy/orchestrate.py').write_text(
                'import os\nassert os.environ.get("DIPLOMACY_RECOVERY_HOLD") == ' + repr(hold) + '\n')
            env = dict(os.environ, PATH=str(root) + ':' + os.environ['PATH'])
            env.pop('DIPLOMACY_RECOVERY_HOLD', None)
            if hold is not None:
                env['DIPLOMACY_RECOVERY_HOLD'] = hold
            with patch.dict(os.environ, env, clear=True):
                return source.finish(root, root / 'server')

    def test_normal_release_has_no_recovery_hold(self):
        self.assertEqual(self.invoke(None), 0)

    def test_authorized_hold_survives_sudo_environment_reset(self):
        self.assertEqual(self.invoke(GAME), 0)

    def test_unknown_recovery_target_refused_before_privileged_spawn(self):
        with patch.dict(os.environ, {'DIPLOMACY_RECOVERY_HOLD': 'wrong-game'}), patch.object(source.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(RuntimeError, 'Unknown recovery maintenance target'):
                source.finish(Path('/unused'), Path('/unused-server'))
            spawn.assert_not_called()

if __name__ == '__main__':
    unittest.main(verbosity=2)
