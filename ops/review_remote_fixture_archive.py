#!/usr/bin/env python3
"""Read TASK-230 proof without executing game code or modifying its archive.

Recompute economy from declared events and literal prices, check entity wire
projections, and bind each check to the original manifest. This is a prerequisite
review, not a TASK-225 completion certificate or a replacement for clause review.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path


SUITES = {"remote-gameplay": 11, "remote-economy-recovery": 1, "remote-terminal": 5}
TYPES = ["bombard", "imp", "clawling", "hound", "brute", "bulwark", "spitter",
         "emberArcher", "hexcaster", "ravager", "demonLord"]
PRICES = {"income": {"town": 4, "suburb": 1}, "salary": {"noob": 1},
          "purchase": {"wall": 2}, "production": {"noob": 20}}
CATEGORIES = {"melee": 6, "ranged": 6, "siege": 2, "heavy": 2, "support": 2, "chaos": 2}
NEGATIVES = {"bombard-reject-wrong-identity-entities": "entity-projection:live",
             "bombard-reject-wrong-balance-economy": "expected-observed:bombard-reject-wrong-balance-economy",
             "reject-wrong-revision": "expected-observed:reject-wrong-revision"}
ASSERTION_COUNTS = {"remote-gameplay": 1830, "remote-economy-recovery": 428, "remote-terminal": 937}
WEAK_STATS = [[4, 0, 2, 2, False, True], [2, 1, 2, 1, True, False],
              [1, 2, 2, 1, True, False], [2, 1, 5, 1, True, False],
              [3, 2, 2, 1, True, False], [7, 1, 2, 1, True, False],
              [2, 1, 2, 1, True, True], [1, 1, 2, 3, True, True],
              [1, 3, 1, 2, True, True], [4, 1, 3, 1, True, False], [5, 3, 2, 1, True, False]]
WAVES = {"melee": [(4, "imp"), (8, "clawling"), (16, "brute")],
         "ranged": [(4, "spitter"), (12, "emberArcher"), (20, "hexcaster")],
         "siege": [(16, "bombard")], "heavy": [(20, "bulwark")],
         "support": [(16, "ravager"), (24, "hound")], "chaos": [(28, "demonLord")]}


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(file):
    return json.loads(file.read_text())


def rows(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line.strip()]


def same(actual, expected, label):
    if actual != expected:
        raise ValueError(label)


def economy(row):
    """Use authored opening balances and events; never infer a delta from gold."""
    balances = [actor["gold"] for actor in row["initial"]]
    entries, reversed_ids = {}, set()
    for kind, rates in row["rules"].items():
        for name, rate in rates.items():
            same(rate, PRICES[kind][name], "literal-price:" + kind + "/" + name)
    for event in row["events"]:
        key, owner, kind = event["id"], event["owner"], event["type"]
        if key in entries or row["initial"][owner]["role"] != "human":
            raise ValueError("invalid-economy-event")
        if kind == "reversal":
            original = entries[event["reverses"]]
            if (event["reverses"] in reversed_ids or original[0] != owner
                    or original[1] not in ("purchase", "production")):
                raise ValueError("invalid-reversal")
            reversed_ids.add(event["reverses"])
            amount = -original[2]
        else:
            count = event["count"]
            if type(count) is not int or count <= 0:
                raise ValueError("invalid-economic-count")
            amount = PRICES[kind][event["rule"]] * count * (1 if kind == "income" else -1)
        entries[key] = (owner, kind, amount)
        balances[owner] += amount
    return {"balances": balances, "assets": []}


def entities(row):
    live = {e["id"]: dict(e) for e in row["initial"]}
    used = set(live)
    same(len(live), len(row["initial"]), "duplicate-initial-identity")
    for event in row["events"]:
        kind = event["type"]
        if kind in ("spawn", "production"):
            value = event["entity"]
            if value["id"] in used:
                raise ValueError("reused-entity-identity")
            used.add(value["id"])
            live[value["id"]] = dict(value)
        elif kind == "death":
            del live[event["id"]]
        elif kind == "move":
            live[event["id"]].update(event["destination"])
        elif kind == "capture":
            live[event["id"]]["owner"] = event["owner"]
        else:
            raise ValueError("unknown-entity-event")
    return sorted(live.values(), key=lambda e: e["id"])


def validate_assertion(row):
    expected, observed = row["expected"], row["observed"]
    if "rules" in row:
        expected = economy(row)
        same(row["expected"], expected, "economy-derived-expectation")
    elif "initial" in row:
        expected = entities(row)
        sort_id = lambda values: sorted(values, key=lambda e: e["id"])
        same(sort_id(row["expected"]), expected, "entity-derived-expectation")
        for key in ("live", "map", "ownership"):
            same(sort_id(observed[key]), expected, "entity-projection:" + key)
        same(observed["problems"], [], "entity-reference-problems")
        for key, kind in (("serialized", "unit"), ("portals", "portal"), ("serializedNature", "nature")):
            fields = ("x", "y", "name") if kind == "nature" else ("owner", "x", "y", "name")
            wanted = [{k: e[k] for k in fields} for e in expected if e["kind"] == kind]
            canonical = lambda values: sorted(json.dumps(e, sort_keys=True) for e in values)
            same(canonical(observed[key]), canonical(wanted), "wire-projection:" + key)
        return "entity"
    elif row["scenario"].endswith("-current-fixture"):
        expected = {"side": 14, "version": 4, "balance": 2, "categories": CATEGORIES}
        same(row["expected"], expected, "literal-fixture-expectation")
    elif row["scenario"].endswith("-current-weak-stats"):
        expected = WEAK_STATS
        same(row["expected"], expected, "literal-weak-stats")
    elif row["scenario"].endswith("-configured-identities"):
        expected = TYPES
        same(row["expected"], expected, "literal-unit-identities")
    elif row["scenario"].endswith("-final-wave-schedule"):
        expected = {"waveInterval": 4, "categories": {
            category: [{"round": r, "type": name} for r, name in events]
            for category, events in WAVES.items()}}
        same(row["expected"], expected, "literal-wave-schedule")
    same(observed, expected, "expected-observed:" + row["scenario"])
    return "economy" if "rules" in row else "recorded-comparison"


def review(directory):
    directory = directory.resolve()
    coverage = read(directory / "coverage-results.json")
    manifest = coverage["evidenceHashes"]
    checks = []

    def check(label, observed, expected, proof):
        checks.append(dict(id=label, observed=observed, expected=expected,
                           pass_=observed == expected, proof=proof))

    for name, wanted in manifest.items():
        file = (directory / name).resolve()
        if not file.is_relative_to(directory) or not file.is_file():
            raise ValueError("missing-or-escaped-proof:" + name)
        same(digest(file), wanted, "changed-proof:" + name)
    check("all-original-evidence-hashes", len(manifest), len(manifest), "coverage-results.json")
    identity = read(directory / "source-identities.json")
    differences = []
    for role, source in identity.items():
        for name, wanted in source["files"].items():
            file = Path(source["repo"]) / name
            if not file.is_file() or digest(file) != wanted:
                differences.append(role + "/" + name)
    check("current-source-differences", differences, [], "source-identities.json")
    check("selected-case-set", sorted(c["id"] for c in coverage["cases"]),
          sorted(read(directory / "verification-plan.json")["cases"]), "coverage-results.json")
    check("positive-case-results", all(c["pass"] for c in coverage["cases"]), True, "coverage-results.json")
    budget = read(directory / "verification-budget.json")
    check("final-budget-and-cleanup", budget["pass"] and budget["cleanup"] and
          0 <= budget["elapsedMs"] <= 3600000 and all(e == 0 for e in budget["exits"]), True,
          "verification-budget.json")
    summary = {}
    for suite, count in SUITES.items():
        log = (directory / suite / "test.log").read_text()
        for marker in (f"# pass {count}\n", "# fail 0\n", "# skipped 0\n"):
            check(suite + "/" + marker.strip(), marker in log, True, suite + "/test.log")
        check(suite + "/rejection-reason", "Unsupported co-op generation version" in
              (directory / suite / "reproduction-server.log").read_text(), True,
              suite + "/reproduction-server.log")
        protocol = rows(directory / suite / "reproduction-protocol.jsonl")
        check(suite + "/obsolete-error", [(r["event"], r["payload"]) for r in protocol
              if r.get("type") == "receive"], [("error", "catched error")], suite + "/reproduction-protocol.jsonl")
        assertions = rows(directory / suite / "assertions.jsonl")
        check(suite + "/assertion-count", len(assertions), ASSERTION_COUNTS[suite], suite + "/assertions.jsonl")
        counts, negatives, failures = collections.Counter(), [], []
        for index, row in enumerate(assertions):
            negative = row["scenario"] in NEGATIVES
            try:
                kind = validate_assertion(row)
                if negative:
                    failures.append({"line": index + 1, "scenario": row["scenario"], "reason": "corruption-accepted"})
                else:
                    counts[kind] += 1
            except (ValueError, KeyError, TypeError) as error:
                if negative and str(error) == NEGATIVES[row["scenario"]]:
                    negatives.append(row["scenario"])
                else:
                    failures.append({"line": index + 1, "scenario": row["scenario"], "reason": str(error)})
        check(suite + "/assertion-failures", failures, [], suite + "/assertions.jsonl")
        check(suite + "/expected-corruptions", sorted(negatives),
              sorted(NEGATIVES) if suite == "remote-gameplay" else [], suite + "/assertions.jsonl")
        summary[suite] = dict(rows=len(assertions), independentlyReplayed=dict(counts), failures=failures)
    return dict(archive=str(directory), archiveCoverageSha256=digest(directory / "coverage-results.json"),
                pass_=all(c["pass_"] for c in checks), completeAudit=False,
                sourceDifferences=differences, summaries=summary, checks=checks,
                limits=["Recorded scalar/turn comparisons are not independent turn oracles.",
                        "Entity initial arrangements remain authored declarations, not natural-game coverage.",
                        "Browser traces and exact clause consumption require separate review."])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be new")
    result = review(args.archive)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"pass": result["pass_"], "completeAudit": False, "summaries": result["summaries"]}))
    raise SystemExit(0 if result["pass_"] else 1)
