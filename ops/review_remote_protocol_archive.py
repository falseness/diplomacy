#!/usr/bin/env python3
"""Independent TASK-225 review of TASK-230's persisted network boundaries.

This does not assign evidence tiers or close a clause. Keep the original archive
immutable; this later report binds its inputs and separates transport consistency
from the gameplay oracle in review_remote_fixture_archive.py.
"""
import argparse
import collections
import datetime
import json
from pathlib import Path

from review_remote_fixture_archive import TYPES, CATEGORIES, digest, read, rows, same

# Derived from the selected test programs, not the observed traces: gameplay
# submits two humans for four rounds; recovery has four accepted submissions;
# terminal submits once for victory, twice for draw, three times for elimination,
# and twice per round from the declared round-39 opening through round 48.
TRACES = {**{"remote-gameplay/" + name: 8 for name in TYPES},
          "remote-economy-recovery/recovery": 4,
          "remote-terminal/focused-victory": 1,
          "remote-terminal/focused-simultaneous-draw": 2,
          "remote-terminal/focused-individual-elimination": 3,
          "remote-terminal/long-2-1": (48 - 39) * 2}
SUITES = ("remote-gameplay", "remote-economy-recovery", "remote-terminal")


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate_protocol(trace, ownership, lifecycle, final_revision=None):
    """Validate raw rows, so rehashing corrupted evidence cannot bypass checks."""
    obsolete = final_revision is None
    identities = [i["identity"] for i in ownership["identities"]]
    same(len(identities), 1 if obsolete else 2, "identity-count")
    same(len(set(identities)), len(identities), "duplicate-identity")
    same(len(set(i["userId"] for i in ownership["identities"])), len(identities), "duplicate-user")
    same(ownership["endpoint"], lifecycle["endpoints"]["https"], "service-endpoint")
    same(len(ownership["games"]), 0 if obsolete else 1, "owned-game-count")
    same(trace[0]["type"], "manifest", "missing-opening-manifest")
    same(trace[-1]["type"], "cleanup", "missing-final-cleanup")
    same(trace[-1]["socketsDisconnected"], True, "socket-cleanup")
    same(sorted(trace[-1]["identities"]), sorted(identities), "cleanup-identities")
    same(trace[-1]["games"], [[game, final_revision] for game in ownership["games"]], "cleanup-games")
    connected, revisions, payloads, received = set(), set(), {}, collections.defaultdict(set)
    previous = timestamp(lifecycle["startedAt"])
    fixtures, requests, failures = [], [], []
    for row in trace:
        same(row["runID"], ownership["runID"], "wrong-run")
        same(row["endpoint"], ownership["endpoint"], "wrong-endpoint")
        same(row["seed"], 1, "wrong-seed")
        now = timestamp(row["time"])
        if not previous <= now <= timestamp(lifecycle["stoppedAt"]):
            raise ValueError("trace-time-order")
        previous = now
        if "identity" in row and row["identity"] not in identities:
            raise ValueError("unowned-identity")
        if row["type"] == "connected":
            connected.add(row["identity"])
        if row["type"] in ("request", "receive") and row["identity"] not in connected:
            raise ValueError("unconnected-identity")
        if row["type"] == "fixture":
            fixtures.append(row)
        if row["type"] == "request":
            requests.append(row)
        if row["type"] == "failure":
            failures.append(row["message"])
        if "commit" in row:
            same(row["type"], "receive", "non-received-commit")
            same(row["commit"]["gameID"], ownership["games"][0], "wrong-game")
            revision = row["commit"]["revision"]
            if type(revision) is not int or revision < 0:
                raise ValueError("invalid-revision")
            state = row["payload"]
            same(state["coopCommit"], row["commit"], "payload-commit")
            # whooseTurn is recipient-specific. Everything else must converge,
            # including unit HP/moves, gold, typed portals and production queues.
            canonical = {k: v for k, v in state.items() if k != "whooseTurn"}
            if revision in payloads:
                same(canonical, payloads[revision], "same-revision-state")
            payloads[revision] = canonical
            revisions.add(revision)
            received[revision].add(row["identity"])
    same(connected, set(identities), "connected-identities")
    same(len(fixtures), 1, "fixture-count")
    generation = fixtures[0]["generation"]
    same(generation["testRun"], ownership["runID"], "fixture-run")
    same(generation["version"], 1 if obsolete else 4, "fixture-generation")
    same(generation["playerCount"], 2, "fixture-humans")
    same(generation["seed"], 1, "fixture-seed")
    same(generation["size"], "tiny", "fixture-size")
    expected_failures = (["Action/connection timeout: never-emitted-recovery-event"]
                         if fixtures[0]["name"] == "economy-recovery" else [])
    same(failures, expected_failures, "unexpected-failure")
    if obsolete:
        same([(r["event"], r["payload"]) for r in trace if r["type"] == "receive"],
             [("error", "catched error")], "obsolete-rejection")
        same([r["event"] for r in requests], ["startGameOrConnect"], "obsolete-request")
        same(revisions, set(), "obsolete-committed")
    else:
        same(generation["testFixture"]["kind"], "declared-local-fixture", "fixture-label")
        same(generation["testFixture"]["generated"], False, "fixture-not-natural")
        same(revisions, set(range(final_revision + 1)), "revision-sequence")
        for revision in revisions:
            same(received[revision], set(identities), "revision-recipients")
        opening = requests[0]["game"]
        same(requests[0]["event"], "startGameOrConnect", "opening-request")
        same([len(opening["grid"]), *set(map(len, opening["grid"]))], [14, 14], "opening-size")
        portals = [p for p in opening["external"] if p["name"] == "demonPortal"]
        same(dict(collections.Counter(p["category"] for p in portals)), CATEGORIES, "opening-portals")
    return dict(connectedIdentities=len(connected), receivedRevisions=sorted(revisions),
                rows=len(trace), runID=ownership["runID"],
                expectedFinalRevision=final_revision, intentionalFailures=failures)


def review(directory):
    directory = directory.resolve()
    manifest = read(directory / "coverage-results.json")["evidenceHashes"]
    proofs = {}

    def bound(name):
        file = (directory / name).resolve()
        if not file.is_relative_to(directory) or not file.is_file():
            raise ValueError("missing-or-escaped-proof:" + name)
        same(digest(file), manifest[name], "changed-proof:" + name)
        proofs[name] = manifest[name]
        return file

    lifecycle = read(bound("lifecycle.json"))
    sources = read(bound("source-identities.json"))
    source_count = 0
    for role in ("client", "server"):
        source = sources[role]
        for name, wanted in source["files"].items():
            root = Path(source["repo"]).resolve()
            file = (root / name).resolve()
            if not file.is_relative_to(root) or not file.is_file():
                raise ValueError("missing-or-escaped-source:" + name)
            same(digest(file), wanted, "stale-source:" + name)
            source_count += 1
    same(lifecycle["readiness"]["database"]["ping"], 1, "database-not-ready")
    https = lifecycle["readiness"]["https"]
    same([https["statusCode"], https["authorized"], https["engineHandshake"]],
         [200, True, True], "https-not-ready")
    same(lifecycle["readiness"]["socketIo"]["connected"], True, "socket-not-ready")
    same(lifecycle["certificateTrust"]["rejectUnauthorized"], True, "tls-validation-disabled")
    same(https["peerFingerprint256"], lifecycle["certificateTrust"]["fingerprint256"], "tls-peer")
    summaries = {}
    checkpoints = read(bound("checkpoints.json"))["checks"]
    for suite in SUITES:
        selected = {key: value for key, value in TRACES.items() if key.startswith(suite + "/")}
        selected[suite + "/reproduction"] = None
        same({str(f.relative_to(directory)) for f in (directory / suite).glob("*-protocol.jsonl")},
             {key + "-protocol.jsonl" for key in selected}, "trace-selection:" + suite)
        for key, final_revision in selected.items():
            trace = rows(bound(key + "-protocol.jsonl"))
            # Only the basename of the recorded absolute ownership path is used;
            # the archive manifest still binds the actual contained file.
            name = suite + "/" + Path(trace[0]["manifestFile"]).name
            ownership = read(bound(name))
            summaries[key] = validate_protocol(trace, ownership, lifecycle, final_revision)
            if final_revision is None:
                opening = next(r["game"] for r in trace if r["type"] == "request")
                same(opening, read(bound(suite + "/obsolete-board.json")), "obsolete-board-substitution")
        rejection = rows(bound(suite + "/reproduction-protocol.jsonl"))
        for key, final_revision in selected.items():
            if final_revision is not None:
                accepted = rows(bound(key + "-protocol.jsonl"))
                same(timestamp(rejection[-1]["time"]) < timestamp(accepted[0]["time"]),
                     True, "rejection-not-first")
        log = bound(suite + "/reproduction-server.log").read_text()
        same("Unsupported co-op generation version" in log, True, "missing-server-rejection")
        matched = [c for c in checkpoints if c["id"] == suite + "/zero-persistence"]
        same(len(matched), 1, "missing-persistence-check")
        # This assertion proves zero *delta*, not an empty shared database.
        c = matched[0]
        # Shared services retain earlier games: eleven gameplay fixtures precede
        # recovery, then one recovery fixture precedes terminal. Two users/game;
        # obsolete attempts must add neither a user, game nor turn.
        prior_games = {"remote-gameplay": 0, "remote-economy-recovery": 11, "remote-terminal": 12}[suite]
        expected = dict(users=2 * prior_games, games=prior_games, turns=0)
        same(c["expected"], expected, "persistence-baseline")
        same(c["observed"], expected, "persistence-delta")
        same(c["pass"], True, "persistence-failed")
    return dict(pass_=True, completeAudit=False, archive=str(directory),
                archiveCoverageSha256=digest(directory / "coverage-results.json"),
                createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                provenance="Later read-only review of original persisted bytes; not a new execution.",
                proofs=proofs, traces=summaries, currentSourceHashes=source_count,
                limits=["Transport consistency is not independent gameplay correctness.",
                        "Zero persistence delta uses the saved before/after database checkpoint.",
                        "No browser workflow or consumed evidence-tier binding is established."])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be new")
    result = review(args.archive)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"PASS 19 protocol traces: 3 rejected boards, 16 accepted games; completeAudit=false")
