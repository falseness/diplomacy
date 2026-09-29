#!/usr/bin/env bash
# TASK-239 guarded switch from the running TASK-065 release to the TASK-239
# candidate. Modeled on switch_release.sh; stage_release_task239.sh must have
# written READY first. Usage: sudo bash switch_release_task239.sh activate|rollback
set -Eeuo pipefail
release=/home/bakharevns/diplomacy_releases/TASK-239-20260929
candidate="$release/candidate"
prior=/home/bakharevns/diplomacy_releases/TASK-065-20260913
service=diplomacy-server.service
override=/etc/systemd/system/diplomacy-server.service.d/90-task239-release.conf
web=/var/www/html
[[ $EUID == 0 && $(hostname) == diplomacy ]]

health() {
    systemctl is-active --quiet "$service"
    for attempt in {1..30}; do
        if curl -kfsS --max-time 3 'https://127.0.0.1:8080/socket.io/?EIO=4&transport=polling' |
            python3 -c 'import sys,json; s=sys.stdin.read(); assert s.startswith("0"); d=json.loads(s[1:]); assert "sid" in d'; then
            echo 'PASS Socket.IO Engine.IO handshake'
            return 0
        fi
        sleep 1
    done
    return 1
}

process_paths() {
    local pid
    pid=$(systemctl show "$service" -p MainPID --value)
    test "$pid" -gt 0
    test "$(readlink -f "/proc/$pid/cwd")" = "$1/diplomacy_server/server"
    test "$(readlink -f "/proc/$pid/exe")" = "$1/node-v20.20.2-linux-x64/bin/node"
    echo "PASS MainPID=$pid cwd=$(readlink -f "/proc/$pid/cwd") exe=$(readlink -f "/proc/$pid/exe")"
}

check_prior() {
    python3 - "$release/rollback/prior-manifest.json" <<'PY'
import hashlib,json,os,pathlib,sys
m=json.load(open(sys.argv[1]))
for p,h in m['files'].items():
    assert hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h,p
print('PASS prior release matches manifest files=%d' % len(m['files']))
PY
}

rollback() {
    # Only undo this release's own changes; the TASK-065 tree is never modified.
    if [[ -e $override ]]; then
        cmp "$override" "$release/90-task239-release.conf"
    fi
    local link
    link=$(readlink "$web" || true)
    if [[ $link == "$prior/candidate/diplomacy" && ! -e $override ]]; then
        systemctl is-active --quiet "$service" || systemctl start "$service"
        health
        process_paths "$prior/candidate"
        echo 'PASS already on prior layout'
        return 0
    fi
    [[ $link == "$candidate/diplomacy" || $link == "$prior/candidate/diplomacy" ]]
    systemctl stop "$service"
    ln -sfn "$prior/candidate/diplomacy" "$web.task239-rollback"
    mv -T "$web.task239-rollback" "$web"
    rm -f "$override"
    systemctl daemon-reload
    systemctl start "$service"
    health
    test "$(readlink "$web")" = "$(cat "$release/rollback/web-link-before.txt")"
    process_paths "$prior/candidate"
    check_prior
    systemctl show "$service" -p MainPID -p ExecStart -p WorkingDirectory
    echo 'PASS rollback restored preserved prior service and web layout'
}

case ${1:-} in
rollback) rollback ;;
activate)
    (cd "$release" && sha256sum -c READY)
    test -L "$web" && test "$(readlink "$web")" = "$(cat "$release/rollback/web-link-before.txt")"
    test ! -e "$override"
    cmp <(systemctl show "$service" -p MainPID -p ActiveEnterTimestamp -p ExecStart -p WorkingDirectory) "$release/rollback/service-before.txt"
    (cd "$candidate" && sha256sum --quiet -c "$release/staged-files.sha256")
    echo 'PASS staged candidate checksums'
    check_prior
    trap 'rc=$?; trap - ERR; echo "FAIL activation exit_status=$rc; restoring prior release"; bash "$0" rollback || echo "FAIL automatic rollback; inspect service immediately"; exit "$rc"' ERR
    systemctl stop "$service"
    ln -sfn "$candidate/diplomacy" "$web.task239-new"
    mv -T "$web.task239-new" "$web"
    install -m 644 "$release/90-task239-release.conf" "$override"
    systemctl daemon-reload
    systemctl start "$service"
    health
    process_paths "$candidate"
    pid=$(systemctl show "$service" -p MainPID --value)
    tr '\0' '\n' < "/proc/$pid/environ" | grep -qx "DIPLOMACY_SMOKE_ALLOWLIST=$release/smoke-allowlist.json"
    echo 'PASS service environment carries the TASK-239 smoke allowlist'
    systemctl show "$service" -p MainPID -p ExecStart -p WorkingDirectory
    echo 'PASS activated intended process paths; real gameplay verification is still required'
    trap - ERR
    ;;
*) echo 'Usage: switch_release_task239.sh activate|rollback' >&2; exit 2 ;;
esac
