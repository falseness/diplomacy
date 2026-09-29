#!/bin/bash
# TASK-239 host staging: unpack the verified candidate next to the running
# TASK-065 release and preserve a concrete rollback inventory. Never touches the
# running service, web tree, systemd unit or nginx configuration.
# Usage (as bakharevns on the host): bash stage_release_task239.sh
set -euo pipefail
release=/home/bakharevns/diplomacy_releases/TASK-239-20260929
prior=/home/bakharevns/diplomacy_releases/TASK-065-20260913
node_dist=node-v20.20.2-linux-x64
service=diplomacy-server.service
cd "$release"
test ! -e candidate && test ! -e rollback
python3 - <<'CHECK'
import hashlib,json,pathlib
m=json.load(open('candidate-manifest.json'))
assert hashlib.sha256(pathlib.Path('candidate.tar.gz').read_bytes()).hexdigest()==m['archive_sha256']
print('PASS uploaded candidate archive checksum matches release manifest')
CHECK
echo "72ebdbb51db61ecfc98ef0a41d5f8e1578eb0cabceb31c4ebe2f41c061f75207  $prior/$node_dist.tar.gz" | sha256sum -c

# Rollback inventory first: the prior release is the running TASK-065 layout.
umask 077
mkdir rollback
systemctl show "$service" -p MainPID -p ActiveEnterTimestamp -p ExecStart -p WorkingDirectory > rollback/service-before.txt
systemctl cat "$service" > rollback/diplomacy-server.service
readlink /var/www/html > rollback/web-link-before.txt
test "$(cat rollback/web-link-before.txt)" = "$prior/candidate/diplomacy"
sudo -n tar -czf rollback/prior.tar.gz -C / "${prior#/}/candidate" "${prior#/}/65-release.conf" \
    var/www/html etc/systemd/system/diplomacy-server.service etc/systemd/system/diplomacy-server.service.d etc/nginx
sudo -n chown bakharevns:bakharevns rollback/prior.tar.gz
sudo -n python3 - "$prior" <<'PY'
import hashlib,json,os,pathlib,sys
prior=sys.argv[1]
roots=[prior+'/candidate','/etc/nginx','/etc/systemd/system/diplomacy-server.service.d']
files={}
for root in roots:
    for p in sorted(pathlib.Path(root).rglob('*')):
        if p.is_file() and not p.is_symlink():
            files[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
for p in ['/etc/systemd/system/diplomacy-server.service',prior+'/65-release.conf']:
    files[p]=hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
base=pathlib.Path('rollback')
m={'prior_release':prior,'roots':roots,'files':files,
   'web_link':os.readlink('/var/www/html'),
   'archive_sha256':hashlib.sha256((base/'prior.tar.gz').read_bytes()).hexdigest(),
   'prior_working_directory':prior+'/candidate/diplomacy_server/server',
   'prior_node':prior+'/candidate/node-v20.20.2-linux-x64/bin/node',
   'database':'gameDB stays in place; no migration or database rollback'}
(base/'prior-manifest.json').write_text(json.dumps(m,indent=1)+'\n')
print('PASS preserved prior release files='+str(len(files))+' archive_sha256='+m['archive_sha256'])
PY
sudo -n chown -R bakharevns:bakharevns rollback

umask 022
mkdir candidate
tar -xzf candidate.tar.gz -C candidate
tar -xzf "$prior/$node_dist.tar.gz" -C candidate
chmod 755 "$release" candidate
chmod -R a+rX candidate
(cd candidate && sha256sum --quiet -c ../candidate-files.sha256 && echo 'PASS extracted candidate files match candidate-files.sha256')
export PATH="$release/candidate/$node_dist/bin:$PATH"
test "$(node --version)" = v20.20.2
cd candidate/diplomacy_server/server
npm ci --omit=dev --no-audit --no-fund
node - <<'JS'
(() => {
const assert = require('node:assert/strict');
const path = require('node:path');
for (const name of ['canvas','mongodb','socket.io','js-sha256','ws']) {
  require(name); console.log('PASS installed dependency '+name);
}
const runtime = require('./loadGameCode.js');
assert.equal(runtime.gameDir, path.resolve('../../diplomacy'));
assert.equal(runtime.scriptOrder.length, 89);
console.log('PASS staged runtime Node='+process.version+' gameDir='+runtime.gameDir+' scripts='+runtime.scriptOrder.length);
})();
JS
cd "$release"
cat > 90-task239-release.conf <<EOF
[Service]
WorkingDirectory=$release/candidate/diplomacy_server/server
ExecStart=
ExecStart=$release/candidate/$node_dist/bin/node .
Environment=DIPLOMACY_SMOKE_ALLOWLIST=$release/smoke-allowlist.json
EOF
python3 - <<'CHECK'
import json,re
entries=json.load(open('smoke-allowlist.json'))
assert len(entries)==6 and {e['run'] for e in entries}=={'TASK239_g1','TASK239_g2'}
assert all(re.fullmatch('[a-f0-9]{64}',e['userId']) for e in entries)
print('PASS smoke allowlist entries=6 runs=TASK239_g1,TASK239_g2 only')
CHECK
python3 - <<'CHECK'
import hashlib,pathlib
root=pathlib.Path('candidate')
files=[p for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink()]
with open('staged-files.sha256','w') as f:
    for p in files: f.write(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(root))+'\n')
print('PASS staged full inventory files='+str(len(files)))
CHECK
bash -n switch_release_task239.sh
systemctl show "$service" -p MainPID -p ActiveEnterTimestamp -p ExecStart -p WorkingDirectory > service-after-staging.txt
cmp rollback/service-before.txt service-after-staging.txt
test "$(readlink /var/www/html)" = "$prior/candidate/diplomacy"
test ! -e /etc/systemd/system/diplomacy-server.service.d/90-task239-release.conf
sha256sum candidate-manifest.json 90-task239-release.conf smoke-allowlist.json staged-files.sha256 switch_release_task239.sh rollback/prior-manifest.json > READY
echo 'PASS staging only expected_service_change=false observed_service_change=false'
