import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import orchestrate as o
import verify_live as v

class VerificationTests(unittest.TestCase):
    def test_baseline_traffic(self):
        old={'good':{'ok':True,'documentHash':'1'},'legacy':{'ok':False,'error':'old-format','documentHash':'2'},'removed':{'ok':True,'documentHash':'3'}}
        new={'good':{'ok':True,'documentHash':'changed'},'legacy':old['legacy'],'new':{'ok':True,'documentHash':'4'}}
        self.assertEqual(v.compare_games(old,new)['concurrent_removed'],['removed'])
        with self.assertRaises(RuntimeError): v.compare_games(old,{**new,'good':{'ok':False,'error':'regression'}})
        with self.assertRaises(RuntimeError): v.compare_games(old,{**new,'new':{'ok':False,'error':'bad'}})
        print('PASS compatibility baseline permits concurrent real traffic and unchanged legacy failures; rejects new open regressions')

    def test_signal_lock_boundary(self):
        import source, signal
        events=[]; handlers={}
        class Child:
            def send_signal(self,sig): events.append('forward')
            def wait(self):
                handlers[signal.SIGTERM](signal.SIGTERM,None)
                events.append('child rollback completed')
                return 1
        def install(sig, handler):
            prior=handlers.get(sig,signal.SIG_DFL);handlers[sig]=handler;return prior
        with patch.object(source.subprocess,'Popen',return_value=Child()), patch.object(source.signal,'signal',side_effect=install):
            with self.assertRaises(RuntimeError): source.finish(Path('/client'),Path('/server'))
        self.assertEqual(events,['forward','child rollback completed'])
        self.assertEqual(set(handlers.values()),{signal.SIG_DFL})
        print('PASS source signal forwarding waits for rollback before returning to release flock; handlers restored')

    def test_live_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=o.Deployment(Path('/client'),Path('/server'),{'backups':tmp,'health_probe':'/health','existing_games_probe':'/games'},Path(tmp))
            d.root=Path(tmp);d.identity={};d.before={};d.started=__import__('datetime').datetime.now(__import__('datetime').timezone.utc)
            google=Path(tmp)/'client-id';google.write_text('public-id')
            d.config.update(public_url='https://example.invalid',google_client_id=str(google),socket_url='wss://example.invalid',smoke_key='/private/key')
            d.expires=1
            with patch.object(d.host,'validate'),patch.object(d.host,'probe'),patch.object(d.host,'process',return_value={'cwd':'release','exe':'node'}),patch.object(d.host,'properties',return_value={'MainPID':'42','InvocationID':'a'}),patch.object(v,'assets',return_value={'status':'pass'}),patch.object(v,'run',side_effect=RuntimeError('gameplay failed')),patch.object(v,'games',return_value={}),patch.object(v,'final_checks') as final:
                with self.assertRaisesRegex(RuntimeError,'gameplay failed'): d.verification()
                final.assert_not_called()
            print('PASS production live verification never accepts health-only success; original gameplay failure propagates')

if __name__ == '__main__':unittest.main()
