import copy
import unittest

from review_remote_fixture_archive import CATEGORIES, WEAK_STATS, WAVES, economy, validate_assertion


class IndependentReplayTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(scenario="income-after-wall-undo", initial=[
            {"role": "neutral", "gold": 0}, {"role": "human", "gold": 100},
            {"role": "human", "gold": 75}, {"role": "demon", "gold": 0}],
            rules={"income": {"town": 4}, "purchase": {"wall": 2}, "salary": {"noob": 1}},
            events=[{"id": "buy", "owner": 1, "type": "purchase", "rule": "wall", "count": 1},
                    {"id": "undo", "owner": 1, "type": "reversal", "reverses": "buy"},
                    {"id": "town", "owner": 1, "type": "income", "rule": "town", "count": 1},
                    {"id": "salary", "owner": 1, "type": "salary", "rule": "noob", "count": 1}],
            expected={"balances": [0, 103, 75, 0], "assets": []},
            observed={"balances": [0, 103, 75, 0], "assets": []})

    def test_independent_economy_and_reversal(self):
        self.assertEqual(economy(self.row), {"balances": [0, 103, 75, 0], "assets": []})
        self.assertEqual(validate_assertion(self.row), "economy")

    def test_rehashed_expected_and_observed_double_income_rejects(self):
        self.row["expected"]["balances"][1] = 107
        self.row["observed"]["balances"][1] = 107
        with self.assertRaisesRegex(ValueError, "economy-derived-expectation"):
            validate_assertion(self.row)

    def test_rehashed_price_change_rejects(self):
        self.row["rules"]["income"]["town"] = 8
        with self.assertRaisesRegex(ValueError, "literal-price"):
            validate_assertion(self.row)

    def test_double_reversal_rejects(self):
        self.row["events"].append({"id": "undo-again", "owner": 1, "type": "reversal", "reverses": "buy"})
        with self.assertRaisesRegex(ValueError, "invalid-reversal"):
            validate_assertion(self.row)

    def test_rehashed_configuration_corruption_rejects(self):
        configurations = [
            ("combat-current-fixture", {"side": 14, "version": 4, "balance": 2,
                                         "categories": dict(CATEGORIES)}, "literal-fixture-expectation"),
            ("combat-current-weak-stats", copy.deepcopy(WEAK_STATS), "literal-weak-stats"),
            ("combat-final-wave-schedule", {"waveInterval": 4, "categories": {
                k: [{"round": r, "type": t} for r, t in v] for k, v in WAVES.items()}},
             "literal-wave-schedule")]
        for scenario, value, reason in configurations:
            with self.subTest(scenario=scenario):
                row = dict(scenario=scenario, expected=copy.deepcopy(value), observed=copy.deepcopy(value))
                validate_assertion(row)
                if isinstance(value, list):
                    value[0][0] += 1
                elif "categories" in value and "side" in value:
                    value["categories"]["melee"] += 1
                else:
                    value["waveInterval"] += 1
                row.update(expected=value, observed=copy.deepcopy(value))
                with self.assertRaisesRegex(ValueError, reason):
                    validate_assertion(row)

    def test_entity_replay_and_corrupt_wire_projection(self):
        unit = dict(id="human-one", kind="unit", name="noob", owner=1, x=2, y=3)
        moved = dict(unit, x=3)
        row = dict(scenario="legal-move", initial=[unit],
                   events=[dict(type="move", id="human-one", destination={"x": 3, "y": 3})],
                   expected=[moved], observed={"live": [moved], "map": [moved], "ownership": [moved],
                   "problems": [], "serialized": [dict(owner=1, x=3, y=3, name="noob")],
                   "portals": [], "serializedNature": []})
        self.assertEqual(validate_assertion(row), "entity")
        broken = copy.deepcopy(row)
        broken["observed"]["serialized"][0]["x"] = 9
        with self.assertRaisesRegex(ValueError, "wire-projection:serialized"):
            validate_assertion(broken)
        broken = copy.deepcopy(row)
        broken["expected"][0]["x"] = 9
        with self.assertRaisesRegex(ValueError, "entity-derived-expectation"):
            validate_assertion(broken)


if __name__ == "__main__":
    unittest.main()
