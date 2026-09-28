"""Local process regressions only; these make no browser/gameplay claim."""
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import unittest


class SignalProvenance(unittest.TestCase):
    def run_case(self, *, send_signal=False, exit_code=0, timeout=False):
        with tempfile.TemporaryDirectory() as directory:
            out = pathlib.Path(directory) / "run"
            worker = ("import pathlib,sys,time;pathlib.Path(sys.argv[1]).mkdir();"
                      + ("time.sleep(30)" if send_signal or timeout else f"sys.exit({exit_code})"))
            launch = ("import sys;from ops.supervise_terminal_map_v3 import supervise;"
                      "sys.exit(supervise(sys.argv[1],['python3','-c',sys.argv[2],sys.argv[1]],"
                      f"stop_seconds={0.2 if timeout else 5},cleanup_seconds=1))")
            parent = subprocess.Popen(["python3", "-c", launch, str(out), worker],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                limit = time.monotonic() + 3
                start = out / "supervisor-start.json"
                sidecar = pathlib.Path(str(out) + "-supervisor-start.json")
                while not (start.exists() or sidecar.exists()) and time.monotonic() < limit:
                    time.sleep(0.01)
                initial = json.loads((start if start.exists() else sidecar).read_text())
                if send_signal:
                    os.kill(parent.pid, signal.SIGTERM)
                stdout, stderr = parent.communicate(timeout=4)
                self.assertEqual(stderr, "")
                receipt_path = out / "process-exit.json"
                if not receipt_path.exists():
                    receipt_path = pathlib.Path(str(out) + "-process-exit.json")
                receipt = json.loads(receipt_path.read_text())
                self.assertEqual(json.loads(stdout), receipt)
                self.assertFalse(pathlib.Path('/proc', str(initial['child']['pid'])).exists())
                self.assertEqual(receipt['escalated'], False)
                if send_signal:
                    self.assertEqual(parent.returncode, 1)
                    self.assertEqual(receipt['actualRunnerExit'], -signal.SIGTERM)
                    self.assertFalse(receipt['timedOut'])
                    rows = receipt['supervisorSignals']
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]['signal'], signal.SIGTERM)
                    self.assertEqual(rows[0]['senderPid'], os.getpid())
                    self.assertEqual(rows[0]['senderUid'], os.getuid())
                    # Linux asm-generic/siginfo.h: SI_USER (kill) is zero;
                    # Python 3.10 exposes siginfo but not this named constant.
                    self.assertEqual(rows[0]['siCode'], 0)
                    self.assertTrue(rows[0]['forwarded'])
                    self.assertNotIn('argv', rows[0]['sender'])
                    self.assertNotIn('environment', rows[0]['sender'])
                elif timeout:
                    self.assertEqual(parent.returncode, 1)
                    self.assertEqual(receipt['actualRunnerExit'], -signal.SIGTERM)
                    self.assertTrue(receipt['timedOut'])
                    self.assertEqual(receipt['supervisorSignals'], [])
                else:
                    self.assertEqual(parent.returncode, 0 if exit_code == 0 else 1)
                    self.assertEqual(receipt['actualRunnerExit'], exit_code)
                    self.assertFalse(receipt['timedOut'])
                    self.assertEqual(receipt['supervisorSignals'], [])
            finally:
                if parent.poll() is None:
                    parent.kill()
                parent.communicate()

    def test_success_receipt(self):
        self.run_case()

    def test_failure_receipt(self):
        self.run_case(exit_code=7)

    def test_sigterm_sender_and_forwarding(self):
        self.run_case(send_signal=True)

    def test_deadline_is_not_an_external_signal(self):
        self.run_case(timeout=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
