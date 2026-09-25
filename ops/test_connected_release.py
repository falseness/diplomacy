"""Separate diagnostic fixture builder. Never imported by production discovery."""
import json, os, shutil, subprocess, sys, tempfile, time, hashlib, socket
from pathlib import Path
import prepare_release as source
import prepare_runtime_bundle as bundle

def main():
    output=Path(sys.argv[1]).resolve(); output.mkdir(exist_ok=False)
    started=int(time.time()*1000); stop=started+540000
    plan={'cases':['connected-local-finalization','forged-signature-worker','forged-signature-supervisor','copied-invocation-worker','copied-invocation-supervisor','sentinel-cleanup'], 'tier':'real isolated HTTPS/Socket.IO/MongoDB; archive-derived current runtime; synthetic prerequisite/local trust; no browser or production readiness', 'estimateMs':300000,'stopAt':stop,'fullTaskPass':False,'commands':[sys.argv], 'exclusions':['production staging','TASK-225 proof','public gameplay','activation']}
    (output/'verification-plan.json').write_text(json.dumps(plan,indent=2))
    code=1
    release_sources={}
    with tempfile.TemporaryDirectory(prefix='connected-release-') as tmp:
        root=Path(tmp); client=root/'diplomacy'; server=root/'diplomacy_server'
        for name,origin,dest in [('diplomacy',Path('/root/diplomacy'),client),('diplomacy_server',Path('/root/diplomacy_server'),server)]:
            dest.mkdir()
            paths=subprocess.check_output(['git','-C',str(origin),'ls-files','-z','--cached','--others','--exclude-standard']).decode().split('\0')
            for rel in sorted(set(paths)):
                p=origin/rel
                if source.release_path(name,rel) and p.is_file():
                    release_sources[str(p)]=source.sha(p.read_bytes())
                    target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
            for argv in [['init','-q'],['config','core.hooksPath','/dev/null'],['config','user.email','fixture@example.invalid'],['config','user.name','fixture'],['add','.'],['commit','-qm','diagnostic current source bytes']]:
                subprocess.run(['git','-C',str(dest),*argv],check=True,stdout=subprocess.DEVNULL)
        sources=root/'sources.json'
        sources.write_text(json.dumps({'sources':{str(p):source.sha(p.read_bytes()) for repo in [client,server] for p in repo.rglob('*') if p.is_file() and '.git' not in p.parts}}))
        runtime=root/'runtime';(runtime/'bin').mkdir(parents=True);shutil.copy2('/usr/local/bin/node20',runtime/'bin/node',follow_symlinks=True)
        deps=root/'dependencies';shutil.copytree('/root/diplomacy_server/server/node_modules',deps,symlinks=True)
        receipt=root/'runtime.json';receipt.write_text(json.dumps({'source_manifest_sha256':source.sha(sources.read_bytes()),'identity':{'node':'v20.20.2','platform':'linux','arch':'x64'},'runtime':bundle.snapshot(runtime,stop/1000)[0],'dependencies':bundle.snapshot(deps,stop/1000)[0]}))
        prior=root/'prior';prior.mkdir();roots={role:prior/role for role in ['client','server','runtime','web','config']}
        # Strip repository metadata from retained installation, preserving runtime bytes.
        for role,src in [('client',client),('server',server),('runtime',runtime)]:shutil.copytree(src,roots[role],symlinks=True,ignore=shutil.ignore_patterns('.git'))
        shutil.copytree(deps,roots['server']/'server/node_modules',symlinks=True)
        roots['web'].mkdir();(roots['web']/'index.html').write_bytes((client/'index.html').read_bytes())
        roots['config'].mkdir();(roots['config']/'service.conf').write_text('diagnostic owned layout; no systemd attribution')
        sentinel=root/'unrelated-sentinel';sentinel.write_text('preserve unrelated bytes')
        # Actual live process identity, on the host owning retained paths. No systemd claim.
        host=subprocess.Popen([str(roots['runtime']/'bin/node'),'-e','setInterval(()=>{},1000)'],cwd=roots['server']/'server')
        try:
            observation={'host':socket.gethostname(),'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'service':'diagnostic-owned-process','pid':host.pid,'process_start':Path(f'/proc/{host.pid}/stat').read_text().rsplit(')',1)[1].split()[19],'observed_at':str(time.time()),'roots':{k:str(v) for k,v in roots.items()},'cwd':str(roots['server']/'server'),'executable':str(roots['runtime']/'bin/node')}
            obs=root/'observation.json';obs.write_text(json.dumps(observation))
            config={'client':str(client),'server':str(server),'sources':str(sources),'runtime':str(runtime),'dependencies':str(deps),'runtimeReceipt':str(receipt),'rollbackRoots':{k:str(v)for k,v in roots.items()},'observationFile':str(obs),'observationSha256':source.sha(obs.read_bytes()),'observerArgv':[sys.executable,str(Path(__file__).with_name('test_connected_observer.py')),str(obs)],'helperRoot':'/root/diplomacy_server/tests/reliability/helpers','scope':'diagnostic','host':socket.gethostname(),'machineId':Path('/etc/machine-id').read_text().strip()}
            options={'config':config,'outputDir':str(output),'startedMs':started,'stopAt':stop,'privateRoot':str(root),'sentinel':str(sentinel),'serverDir':'/root/diplomacy_server'}
            opt=root/'options.json';opt.write_text(json.dumps(options));opt.chmod(0o600)
            command=['/usr/local/bin/node20','/root/diplomacy/ai/task245-supervisor.js',str(output/'owned.jsonl'),str(stop),'/usr/local/bin/node20',str(Path(__file__).with_suffix('.js')),str(opt)]
            with (output/'verification.log').open('w') as log:
                log.write('COMMAND '+repr(command)+' CWD='+os.getcwd()+'\n');log.flush()
                result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=max(1,stop/1000-time.time())+30)
                code=result.returncode;log.write('ACTUAL_EXIT='+str(code)+'\n')
                for repo in ['/root/diplomacy','/root/diplomacy_server']:
                    log.write('COMMAND git diff --check CWD='+repo+'\n');log.flush()
                    check=subprocess.run(['git','diff','--check'],cwd=repo,stdout=log,stderr=subprocess.STDOUT);log.write('ACTUAL_EXIT='+str(check.returncode)+'\n');code=code or check.returncode
            assert sentinel.read_text()=='preserve unrelated bytes'
            if code == 0:
                for name,digest in release_sources.items(): assert source.sha(Path(name).read_bytes())==digest, 'current source drift: '+name
                identities=json.loads((output/'source-identities.json').read_text())
                identities['releaseSources']=release_sources
                identities['releaseSourceCount']=len(release_sources)
                (output/'source-identities.json').write_text(json.dumps(identities,indent=2))
                required=['release-manifest.json','rollback-manifest.json','smoke-inputs.json','dry-run.log','checkpoints.json','source-identities.json','verification.log','verification-plan.json','coverage-results.json','cleanup.json']
                with (output/'verification.log').open('a') as log:
                    for name in required:
                        assert (output/name).is_file(),name
                        log.write('AUDIT_EXISTS '+name+'=true\n')
                    for marker in ['candidate-start','candidate-health','rollback-start','rollback-health']:
                        text='PASS '+marker+' ACTUAL_EXIT=0'
                        assert text in (output/'dry-run.log').read_text()
                        log.write('AUDIT_MARKER '+text+'\n')
                    log.write('AUDIT_SOURCE_MATCH count='+str(len(release_sources))+'\n')
                # Required real gate is exercised once after new wiring. It must
                # remain failed when authoritative prerequisite inputs are absent.
                gate=output/'green-full-gate'
                command=['/usr/local/bin/node20','tests/reliability/run.js','--suite','release-preparation','--output-dir',str(gate)]
                with (output/'full-gate-command.log').open('w') as log:
                    log.write('COMMAND NODE_PATH=/opt/diplomacy/node_modules '+repr(command)+' CWD=/root/diplomacy_server\n');log.flush()
                    real=subprocess.run(command,cwd='/root/diplomacy_server',stdout=log,stderr=subprocess.STDOUT,timeout=max(1,stop/1000-time.time())+20)
                    log.write('ACTUAL_EXIT='+str(real.returncode)+'\n')
                assert real.returncode==1, 'unexpected production gate result'
                assert not (gate/'candidate').exists(), 'unexpected staging'
                (output/'production-readiness.json').write_text(json.dumps({'fullTaskPass':False,'releaseReady':False,'requiredGateExit':real.returncode,'missing':['finalized current TASK-225 proof (saved review-45: 151 unresolved; not rerun)','RELEASE_TRUSTED_CONFIG'],'proof':'green-full-gate/prerequisite.json'},indent=2))
        finally:
            host.terminate();host.wait(timeout=10)
    elapsed=int(time.time()*1000)-started
    budget={'diagnosticPass':code==0 and elapsed<600000,'fullTaskPass':False,'releaseReady':False,'startedMs':started,'finishedMs':int(time.time()*1000),'elapsedMs':elapsed,'stopAt':stop,'cleanup':not root.exists(),'invocationExit':code}
    (output/'verification-budget.json').write_text(json.dumps(budget,indent=2))
    print(json.dumps(budget));return code
if __name__=='__main__':sys.exit(main())
