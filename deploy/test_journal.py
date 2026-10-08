import shlex
import subprocess
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
import journal
import verify_live

class JournalTests(unittest.TestCase):
    def test_commands(self):
        for stamp in ['2026-10-08T12:13:14.987Z', '2026-10-08 12:13:14 UTC',
                      datetime(2026, 10, 8, 15, 13, 14, tzinfo=timezone(timedelta(hours=3)))]:
            local = journal.command(stamp)
            remote = journal.command(stamp, 'operator@example.invalid')
            self.assertEqual(local[local.index('--since') + 1], '2026-10-08 12:13:14 UTC')
            self.assertEqual(shlex.split(remote[-1]), ['sudo', '-n', *local])
            # Actual systemd parser on the assembled argv; no local journal is required.
            p = subprocess.run(local, capture_output=True, text=True)
            self.assertNotIn('Failed to parse timestamp', p.stderr)
            self.assertIn(p.returncode, (0, 1))
            print('PASS actual journalctl parser argv='+repr(local)+' exit='+str(p.returncode)+' stderr='+repr(p.stderr))
        with self.assertRaises(ValueError): journal.utc(datetime(2026, 1, 1))
        print('PASS canonical UTC and SSH assembled command preserve timestamp argument')

    def test_final(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as temp, patch('journal.subprocess.check_output', return_value='@@actionEnforce on\n@@hiddenInfo on\n') as call:
            verify_live.final_checks('2026-10-08T12:13:14Z', Path(temp))
            self.assertEqual(call.call_args.args[0], journal.command('2026-10-08T12:13:14Z'))
            self.assertEqual((Path(temp)/'journal-error-grep.txt').read_text(), '')
        print('PASS final-checks invocation uses same canonical UTC builder; empty error grep exists')

if __name__ == '__main__': unittest.main()
