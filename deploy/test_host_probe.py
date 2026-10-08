#!/usr/bin/env python3
import unittest
from unittest.mock import patch
import host_probe as probe
import source
import types
from pathlib import Path


class ProbeTests(unittest.TestCase):
    def test_legacy_host_preflight(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return types.SimpleNamespace(returncode=0, stdout='v20.20.2\n')
        with patch('pwd.getpwuid', return_value=types.SimpleNamespace(pw_name='bakharevns')), \
             patch.object(source.subprocess, 'run', side_effect=run), \
             patch.object(source.shutil, 'which', return_value='/fixture/tool'), \
             patch.object(source.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=2**31)):
            source.preflight([Path('/fixture')], True)
        self.assertIn(['sudo', '-n', '-k', '-l', 'systemctl', 'restart', 'diplomacy-server.service'], calls)
        print('PASS sudo 1.8 compatible noninteractive non-updating preflight')

    def test_health_requires_service_and_db(self):
        with patch.object(probe, 'process'), patch.object(probe, 'command', return_value='DB_READY\n'):
            probe.health()
        with patch.object(probe, 'process'), patch.object(probe, 'command', return_value=''):
            with self.assertRaises(RuntimeError): probe.health()
        with patch.object(probe, 'process', side_effect=RuntimeError('Service unavailable')):
            with self.assertRaises(RuntimeError): probe.health()

    def test_existing_failures_allowed_new_failures_rejected(self):
        before = {'old': {'ok': False, 'error': 'legacy'}, 'good': {'ok': True}}
        probe.compare(before, before)
        probe.compare(before, {})  # Concurrent deletion is not a new failure.
        for after in [{'good': {'ok': False}}, {'new': {'ok': False}},
                      {'old': {'ok': False, 'error': 'changed'}}]:
            with self.assertRaises(RuntimeError): probe.compare(before, after)


if __name__ == '__main__': unittest.main()
