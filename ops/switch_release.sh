#!/usr/bin/env bash
# TASK-065 host-specific switch procedure. Preparation never invokes this file.
# Usage: sudo bash switch_release.sh activate|rollback
set -Eeuo pipefail
release=/home/bakharevns/diplomacy_releases/TASK-065-20260913
candidate="$release/candidate"
service=diplomacy-server.service
override=/etc/systemd/system/diplomacy-server.service.d/65-release.conf
web=/var/www/html
old_web=/var/www/html.TASK-065-previous
[[ $EUID == 0 && $(hostname) == diplomacy ]]

health() {
    systemctl is-active --quiet "$service"
    for attempt in {1..20}; do
        if curl -kfsS --max-time 3 'https://127.0.0.1:8080/socket.io/?EIO=4&transport=polling' |
            python3 -c 'import sys,json; s=sys.stdin.read(); assert s.startswith("0"); d=json.loads(s[1:]); assert "sid" in d'; then
            echo 'PASS Socket.IO Engine.IO handshake'
            return 0
        fi
        sleep 1
    done
    return 1
}

rollback() {
    # Only undo this release's own changes. Original server/client dirs are retained.
    if [[ -e $override ]]; then
        cmp "$override" "$release/65-release.conf"
    fi
    if [[ -L $web ]]; then
        [[ $(readlink "$web") == "$candidate/diplomacy" && -d $old_web ]]
    elif [[ ! -e $old_web && -d $web && ! -e $override ]]; then
        systemctl start "$service"
        health
        echo 'PASS already on prior layout'
        return 0
    else
        [[ ! -e $web && -d $old_web ]]
    fi
    systemctl stop "$service"
    if [[ -L $web ]]; then rm "$web"; fi
    if [[ -d $old_web ]]; then mv "$old_web" "$web"; fi
    if [[ -e $override ]]; then rm "$override"; fi
    systemctl daemon-reload
    systemctl start "$service"
    health
    systemctl show "$service" -p MainPID -p ExecStart -p WorkingDirectory
    echo 'PASS rollback restored preserved prior service and web layout'
}

case ${1:-} in
rollback) rollback ;;
activate)
    test -f "$release/READY"
    test -d "$web" && test ! -L "$web"
    test ! -e "$old_web" && test ! -e "$override"
    cmp <(systemctl show "$service" -p MainPID -p ActiveEnterTimestamp -p ExecStart -p WorkingDirectory) "$release/rollback/service-before.txt"
    (cd "$candidate" && sha256sum -c "$release/staged-files.sha256")
    # The prior tree must still match the concrete rollback inventory.
    python3 - "$release/rollback/prior-manifest.json" <<'PY'
import hashlib,json,pathlib,sys
m=json.load(open(sys.argv[1]))
for p,h in m['files'].items():
    assert hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h,p
print('PASS prior release unchanged before activation')
PY
    trap 'rc=$?; trap - ERR; echo "FAIL activation exit_status=$rc; restoring prior release"; bash "$0" rollback || echo "FAIL automatic rollback; inspect service immediately"; exit "$rc"' ERR
    systemctl stop "$service"
    mv "$web" "$old_web"
    ln -s "$candidate/diplomacy" "$web"
    mkdir -p "$(dirname "$override")"
    install -m 644 "$release/65-release.conf" "$override"
    systemctl daemon-reload
    systemctl start "$service"
    health
    pid=$(systemctl show "$service" -p MainPID --value)
    test "$(readlink -f "/proc/$pid/cwd")" = "$candidate/diplomacy_server/server"
    test "$(readlink -f "/proc/$pid/exe")" = "$candidate/node-v20.20.2-linux-x64/bin/node"
    systemctl show "$service" -p MainPID -p ExecStart -p WorkingDirectory
    echo 'PASS activated intended process paths; real gameplay verification is still required'
    trap - ERR
    ;;
*) echo 'Usage: switch_release.sh activate|rollback' >&2; exit 2 ;;
esac
