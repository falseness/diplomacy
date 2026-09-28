"""Source-only supervisor regression: detached worker stops, parent records exit."""
import ast,json,os,pathlib,signal,subprocess,tempfile,time,unittest

class Shutdown(unittest.TestCase):
 def test_detached_worker_finalizes_parent(self):
  source=pathlib.Path(__file__).with_name('run_terminal_map_v2.py').read_text()
  function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='stop_owned')
  scope={'os':os,'signal':signal,'pathlib':pathlib}
  exec(compile(ast.Module(body=[function],type_ignores=[]),'<stop_owned>','exec'),scope)
  with tempfile.TemporaryDirectory() as directory:
   ready=pathlib.Path(directory)/'ready.json';receipt=pathlib.Path(directory)/'receipt.json'
   code="""import subprocess,sys,json,pathlib
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)','/test-only/terminal-flow.test.js'],start_new_session=True)
pathlib.Path(sys.argv[1]).write_text(json.dumps({'pid':child.pid}))
status=child.wait()
pathlib.Path(sys.argv[2]).write_text(json.dumps({'actualExit':status}))
"""
   parent=subprocess.Popen(['python3','-c',code,str(ready),str(receipt)],start_new_session=True)
   worker=None
   try:
    stop=time.monotonic()+5
    while not ready.exists() and time.monotonic()<stop:time.sleep(.02)
    worker=json.loads(ready.read_text())['pid']
    forwarded=scope['stop_owned'](parent)
    self.assertEqual(forwarded['workersSignaled'],[worker])
    self.assertEqual(parent.wait(timeout=5),0)
    self.assertEqual(json.loads(receipt.read_text()),{'actualExit':-signal.SIGTERM})
    self.assertFalse(pathlib.Path('/proc',str(worker)).exists())
   finally:
    for pid in [worker,parent.pid]:
     if pid:
      try:os.killpg(pid,signal.SIGKILL)
      except ProcessLookupError:pass
    parent.wait()

if __name__=='__main__':unittest.main(verbosity=2)
