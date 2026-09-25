import copy
import unittest

from review_remote_protocol_archive import CATEGORIES, validate_protocol


class ProtocolReviewTests(unittest.TestCase):
    def setUp(self):
        self.lifecycle = dict(startedAt="2026-09-25T00:00:00Z", stoppedAt="2026-09-25T00:01:00Z",
                              endpoints={"https": "https://127.0.0.1:1234"})
        self.owned = dict(runID="run", endpoint=self.lifecycle["endpoints"]["https"],
                          identities=[dict(identity="one", userId="u1"), dict(identity="two", userId="u2")],
                          games=["game"])
        self.trace = []

        def row(kind, **fields):
            value = dict(type=kind, time="2026-09-25T00:00:01Z", runID="run",
                         endpoint=self.owned["endpoint"], seed=1, **fields)
            self.trace.append(value)
            return value

        row("manifest")
        row("fixture", name="combat", generation=dict(testRun="run", version=4, playerCount=2,
            seed=1, size="tiny", testFixture=dict(kind="declared-local-fixture", generated=False)))
        row("connected", identity="one")
        row("connected", identity="two")
        row("request", identity="one", event="startGameOrConnect", game=dict(
            grid=[[0]*14 for _ in range(14)], external=[dict(name="demonPortal", category=c)
            for c, count in CATEGORIES.items() for _ in range(count)]))
        for revision in (0, 1):
            for identity in ("one", "two"):
                commit = dict(gameID="game", revision=revision)
                row("receive", identity=identity, event="playYourTurn", commit=commit,
                    payload=dict(coopCommit=copy.deepcopy(commit), players=[dict(gold=100,
                        units=[dict(hp=2, moves=2)])]))
        row("cleanup", socketsDisconnected=True, identities=["one", "two"], games=[["game", 1]])

    def validate(self):
        return validate_protocol(self.trace, self.owned, self.lifecycle, 1)

    def test_complete_trace(self):
        self.assertEqual(self.validate()["receivedRevisions"], [0, 1])

    def test_wrong_run(self):
        self.trace[5]["runID"] = "other"
        with self.assertRaisesRegex(ValueError, "wrong-run"):
            self.validate()

    def test_unconnected_identity(self):
        self.trace = [r for r in self.trace if not (r["type"] == "connected" and r["identity"] == "two")]
        with self.assertRaisesRegex(ValueError, "unconnected-identity"):
            self.validate()

    def test_omitted_commit(self):
        self.trace = [r for r in self.trace if r.get("commit", {}).get("revision") != 1]
        with self.assertRaisesRegex(ValueError, "revision-sequence"):
            self.validate()

    def test_omitted_recipient(self):
        self.trace.pop(-2)
        with self.assertRaisesRegex(ValueError, "revision-recipients"):
            self.validate()

    def test_hp_moves_gold_corruption(self):
        original = copy.deepcopy(self.trace)
        for field in ("hp", "moves", "gold"):
            with self.subTest(field=field):
                self.trace = copy.deepcopy(original)
                player = self.trace[-2]["payload"]["players"][0]
                (player if field == "gold" else player["units"][0])[field] += 1
                with self.assertRaisesRegex(ValueError, "same-revision-state"):
                    self.validate()

    def test_wrong_game_even_with_matching_payload(self):
        self.trace[-2]["commit"]["gameID"] = "other"
        self.trace[-2]["payload"]["coopCommit"]["gameID"] = "other"
        with self.assertRaisesRegex(ValueError, "wrong-game"):
            self.validate()

    def test_duplicate_identity(self):
        self.owned["identities"][1]["identity"] = "one"
        with self.assertRaisesRegex(ValueError, "duplicate-identity"):
            self.validate()

    def test_time_outside_service_lifetime(self):
        self.trace[-1]["time"] = "2026-09-25T00:02:00Z"
        with self.assertRaisesRegex(ValueError, "trace-time-order"):
            self.validate()

    def test_incomplete_cleanup(self):
        self.trace[-1]["socketsDisconnected"] = False
        with self.assertRaisesRegex(ValueError, "socket-cleanup"):
            self.validate()

    def test_typed_portal_quota(self):
        self.trace[4]["game"]["external"][0]["category"] = "chaos"
        with self.assertRaisesRegex(ValueError, "opening-portals"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
