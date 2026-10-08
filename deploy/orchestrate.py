#!/usr/bin/env python3
"""Release transaction, invoked under source.py's inherited host lock."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import uuid
import signal
import activate
import candidate
import check_candidate
import verify_live as live

DEFAULT_CONFIG = Path('/home/bakharevns/.config/diplomacy/deploy.json')


class Deployment:
    def __init__(self, client, server, config, output):
        self.client, self.server, self.config, self.output = client, server, config, output
        self.package = output / 'release'
        self.root = self.package / 'candidate'
        self.manifest = self.package / 'candidate-manifest.json'
        self.record = output / 'recovery.json'
        self.host = activate.Host(Path(config['backups']), Path(config['health_probe']), Path(config['existing_games_probe']))
        self.run_id = 'deploy' + uuid.uuid4().hex[:20]
        self.cleanup_status = {'status': 'not-started'}

    def prepare(self):
        self.identity = candidate.prepare(self.client, self.server, self.package, Path(self.config['node_dist']))
        self.package.chmod(0o755)
        return self.identity

    def isolated(self):
        check_candidate.check(self.root, self.manifest, self.output / 'isolated', int(os.environ.get('TEST_JOBS', '6')))
        return {'status': 'pass'}

    def endpoint(self):
        env = dict(os.environ, NODE_PATH=str(self.root / 'diplomacy_server/node_modules'))
        live.run([self.root / 'runtime/bin/node', Path(__file__).with_name('endpoint.js'),
                  self.config['socket_url']], self.output / 'endpoint.log', env=env, timeout=15)
        return {'status': 'pass', 'url': self.config['socket_url'],
                'protocol': 'TLS/Engine.IO/Socket.IO', 'application_events': 0}

    def baseline(self):
        process = self.host.process()
        self.before = live.games(process['exe'], process['cwd'], self.output / 'existing-before.log')
        return {'status': 'pass', 'games': len(self.before)}

    def admission(self):
        # New allowlist is installed only in the candidate's owned service override.
        # Preserve existing entries; keys are reused and never copied into releases.
        allow = Path(self.config['smoke_allowlist'])
        entries = json.loads(allow.read_text())
        if any(e['run'] == self.run_id for e in entries): raise RuntimeError('Smoke namespace collision')
        self.expires = int(datetime.now(timezone.utc).timestamp() * 1000) + 3600000
        entries.append({'run': self.run_id, 'expiresAt': self.expires,
                        'identities': [f'prod_smoke_{self.run_id}_game_p{i}' for i in (1, 2)]})
        self.allow = self.output / 'smoke-allowlist.json'
        activate.atomic_file(self.allow, (json.dumps(entries) + '\n').encode(), 0o644)
        # The service user must be able to traverse the release directory.
        self.output.chmod(0o755)
        self.host.release_environment = {'DIPLOMACY_SMOKE_ALLOWLIST': str(self.allow),
                                         'DIPLOMACY_SMOKE_AUTH_KEY_FILE': self.config['smoke_key']}
        self.before_residue = live.residue(self.run_id)
        if any(self.before_residue['owned'].values()): raise RuntimeError('Smoke namespace not fresh')
        return {'status': 'pass', 'namespace': self.run_id}

    def activation(self):
        self.started = datetime.now(timezone.utc)
        self.activation_result = activate.activate(self.host, self.root, self.manifest, self.record)
        if self.activation_result['status'] != 'activated':
            raise RuntimeError('Activation failed')
        return self.activation_result

    def verification(self):
        self.host.validate(self.root, self.manifest)
        self.host.probe()
        process = self.host.process()
        properties = self.host.properties()
        assets = live.assets(self.root, self.identity, self.config['public_url'],
                            Path(self.config['google_client_id']).read_text(), self.output / 'public-assets.json')
        args = [self.root / 'runtime/bin/node', Path(__file__).with_name('live_game.js'),
                '--url', self.config['socket_url'], '--client-root', self.root / 'diplomacy',
                '--server-root', self.root / 'diplomacy_server', '--run', self.run_id, '--game', 'game',
                '--smoke-key-file', self.config['smoke_key'], '--expires-at', str(self.expires),
                '--server-log', self.output / 'game-journal.log', '--journal-since', live.journal.utc(self.started),
                '--out', self.output / 'gameplay']
        env = dict(os.environ, DIPLOMACY_CLIENT_ROOT=str(self.root / 'diplomacy'),
                   NODE_PATH=str(self.root / 'diplomacy_server/node_modules'), TMPDIR='/mnt/storage/tmp-diplomacy')
        try:
            live.run(args, self.output / 'verification.log', env=env)
        finally:
            result = self.output / 'gameplay/result.json'
            if result.exists(): self.cleanup_status = json.loads(result.read_text())['cleanup']
            else: self.cleanup_status = {'status': 'unconfirmed', 'reason': 'verifier terminated without cleanup result'}
        after = live.games(self.root / 'runtime/bin/node', self.root / 'diplomacy_server/server', self.output / 'existing-after.log')
        compatibility = live.compare_games(self.before, after)
        live.final_checks(self.started, self.output)
        if self.host.process() != process or any(self.host.properties().get(k) != properties.get(k) for k in ('MainPID', 'InvocationID')):
            raise RuntimeError('Service changed during live verification')
        return {'status': 'pass', 'identity': 'complete manifest and process', 'assets': assets,
                'auth_lobby_action_undo_commit_filtered_diffs_replay': 'pass', 'existing_games': compatibility,
                'journal': 'pass', 'live_process': process,
                'service': {k: properties.get(k) for k in ('MainPID', 'InvocationID', 'ActiveEnterTimestamp')}, 'readiness': 'service and DB protocol operations passed'}

    def cleanup(self):
        if not hasattr(self, 'before_residue'): return {'status': 'not-needed', 'reason': 'no smoke admitted'}
        owned = self.output / 'gameplay/owned.json'
        after = live.residue(self.run_id, json.loads(owned.read_text()) if owned.exists() else self.before_residue)
        (self.output / 'residue.json').write_text(json.dumps(after, indent=2) + '\n')
        if any(after['owned'].values()): raise RuntimeError('Smoke residue remains; retained for operator cleanup')
        return {**self.cleanup_status, 'residue': 'empty', 'counts': after['counts'],
                'traffic_policy': 'record counts; no global count equality or real-data deletion'}

    def rollback(self):
        return activate.restore(self.host, json.loads(self.record.read_text()))


def execute(deployment):
    result = {'status': 'failed', 'stages': {}, 'rollback': {'status': 'not-needed'},
              'cleanup': {'status': 'not-started'}}
    stage = 'package'
    activated = False
    handlers = {}
    def interrupt(signum, frame): raise activate.Interrupted(signal.Signals(signum).name)
    try:
        for sig in (signal.SIGINT, signal.SIGTERM): handlers[sig] = signal.signal(sig, interrupt)
        for stage, method in [('package', 'prepare'), ('preactivation-smoke', 'isolated'),
                              ('endpoint', 'endpoint'), ('baseline', 'baseline'), ('smoke-admission', 'admission'), ('activation', 'activation'),
                              ('live-verification', 'verification')]:
            print('START ' + stage, flush=True)
            result['stages'][stage] = getattr(deployment, method)()
            if stage == 'activation': activated = True
            print('PASS ' + stage, flush=True)
        stage = 'cleanup'
        result['cleanup'] = deployment.cleanup()
        result['status'] = 'complete'
    except Exception as error:
        result['failure'] = {'stage': stage, 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}
        for sig in handlers: signal.signal(sig, signal.SIG_IGN)
        try: result['cleanup'] = deployment.cleanup()
        except Exception as cleanup_error: result['cleanup'] = {'status': 'failed', 'reason': str(cleanup_error)}
        if activated:
            try: result['rollback'] = deployment.rollback()
            except Exception as rollback_error: result['rollback'] = {'status': 'failed', 'reason': str(rollback_error)}
        elif hasattr(deployment, 'activation_result'):
            result['rollback'] = deployment.activation_result['rollback']
            result['activation'] = deployment.activation_result
    finally:
        for sig, handler in handlers.items(): signal.signal(sig, handler)
    if hasattr(deployment, 'identity'): result['identity'] = deployment.identity
    result['paths'] = {'candidate': str(deployment.root), 'recovery': str(deployment.record),
                       'backups': str(deployment.host.backups), 'web': str(deployment.host.web)}
    result['backup_receipts'] = [str(p) for p in deployment.host.backups.glob('gameDB-*/validated.json')]
    result['started'] = live.journal.utc(deployment.started) if hasattr(deployment, 'started') else None
    activate.atomic_file(deployment.output / 'result.json', (json.dumps(result, indent=2) + '\n').encode())
    print('RESULT ' + result['status'], flush=True)
    return result


def deploy(client, server, config_file=DEFAULT_CONFIG):
    os.umask(0o077)
    config = json.loads(config_file.read_text())
    output = Path(config['releases']) / ('deploy-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8])
    output.mkdir(mode=0o700, parents=True)
    os.environ['TMPDIR'] = '/mnt/storage/tmp-diplomacy'
    os.environ['DIPLOMACY_CLIENT_ROOT'] = str(client)
    import contextlib
    with (output / 'orchestration.log').open('x') as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        result = execute(Deployment(client, server, config, output))
    print('Release result: ' + str(output / 'result.json'))
    if result['status'] != 'complete': raise RuntimeError('Deployment failed; retained result: ' + str(output / 'result.json'))
    return 0


if __name__ == '__main__':
    raise SystemExit(deploy(Path(sys.argv[1]), Path(sys.argv[2])))
