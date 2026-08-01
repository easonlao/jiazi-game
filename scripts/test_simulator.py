"""模拟器与当前 TypeScript 核心规则的确定性回归测试。"""

from __future__ import annotations

import math
import statistics
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from simulator import (  # noqa: E402
    CardPool,
    EVALUATION_CONFIG_V0,
    GameState,
    Mulberry32,
    ScoreModel,
    SEASONS,
    calc_score,
    generate_season_lengths,
    leverage_for_round,
    load_cards,
    strategy_seasonal,
    _evaluate_band,
    evaluate_report,
    run_baseline,
)


class SimulatorParityTests(unittest.TestCase):
    def test_seeded_random_matches_mulberry32_reference_values(self) -> None:
        random = Mulberry32(1)
        self.assertEqual([random.int(0, 100) for _ in range(4)], [62, 0, 52, 98])

    def test_real_card_pool_and_score_fixtures(self) -> None:
        cards = load_cards()
        self.assertEqual(len(cards), 60)
        self.assertEqual([calc_score(next(card for card in cards if card.name == "甲子"), season) for season in SEASONS], [1.4, -0.2, -1.4, 0.2])
        self.assertEqual([calc_score(next(card for card in cards if card.name == "戊辰"), season) for season in SEASONS], [1.38, 1.14, 0.78, 1.02])

    def test_candidate_a_centers_each_card_without_changing_baseline(self) -> None:
        cards = load_cards()
        baseline = ScoreModel(cards, "raw")
        centered = ScoreModel(cards, "centered")
        for card in cards:
            raw_values = [baseline.score(card, season) for season in SEASONS]
            centered_values = [centered.score(card, season) for season in SEASONS]
            self.assertAlmostEqual(statistics.mean(centered_values), 0.0, delta=0.005)
            self.assertEqual(raw_values, [calc_score(card, season) for season in SEASONS])
        self.assertLessEqual(max(abs(centered.score(card, season)) for card in cards for season in SEASONS), 4.0)

    def test_candidate_b_beta_is_explicit_and_zero_matches_candidate_a(self) -> None:
        cards = load_cards()
        centered = ScoreModel(cards, "centered")
        candidate_b = ScoreModel(cards, "centered_beta", beta=0.0)
        self.assertEqual(
            [centered.score(card, season) for card in cards for season in SEASONS],
            [candidate_b.score(card, season) for card in cards for season in SEASONS],
        )

    def test_polarity_volatility_keeps_card_mean_and_changes_only_amplitude(self) -> None:
        cards = load_cards()
        raw = ScoreModel(cards, "raw")
        polarity = ScoreModel(cards, "polarity_volatility", gamma=0.15)
        for card in cards:
            raw_mean = statistics.mean(raw.score(card, season) for season in SEASONS)
            polarity_mean = statistics.mean(polarity.score(card, season) for season in SEASONS)
            self.assertAlmostEqual(polarity_mean, raw_mean, delta=0.005)
            raw_sd = statistics.pstdev(raw.score(card, season) for season in SEASONS)
            polarity_sd = statistics.pstdev(polarity.score(card, season) for season in SEASONS)
            expected_factor = 1.15 if card.yin_yang == "yang" else 0.85
            self.assertAlmostEqual(polarity_sd, raw_sd * expected_factor, delta=0.03)

    def test_centered_polarity_combines_zero_target_mean_with_amplitude_factor(self) -> None:
        cards = load_cards()
        centered = ScoreModel(cards, "centered")
        composite = ScoreModel(cards, "centered_polarity", beta=0.0, gamma=0.15)
        for card in cards:
            values = [composite.score(card, season) for season in SEASONS]
            self.assertAlmostEqual(statistics.mean(values), 0.0, delta=0.005)
            centered_sd = statistics.pstdev(centered.score(card, season) for season in SEASONS)
            composite_sd = statistics.pstdev(values)
            factor = 1.15 if card.yin_yang == "yang" else 0.85
            self.assertAlmostEqual(composite_sd, centered_sd * factor, delta=0.03)

    def test_seasonal_strategy_uses_public_information_only(self) -> None:
        cards = load_cards()

        class PublicOnlyPool:
            public = cards[:2]

            @property
            def deck(self):
                raise AssertionError("seasonal strategy must not inspect future deck")

        class PublicOnlyRandom:
            def int(self, *_args):
                raise AssertionError("seasonal strategy must not inspect future randomness")

        class PublicOnlyGame:
            season_index = 0
            season = "spring"
            round_in_season = 2
            qi = 50
            hand = []
            pool = PublicOnlyPool()
            random = PublicOnlyRandom()

            @staticmethod
            def card_score(card, season):
                return calc_score(card, season)

            @staticmethod
            def hand_size():
                return 0

            @staticmethod
            def buy_cost(_score, _leverage):
                return 11

            @staticmethod
            def hold_qi_cost(_score, _leverage):
                return 2

        action = strategy_seasonal(PublicOnlyGame())
        self.assertIn(action[0], {"buy", "wait"})

    def test_v0_evaluation_thresholds_have_pass_warn_fail_and_manual_states(self) -> None:
        self.assertEqual(_evaluate_band({"mean": 100, "ci95": [95, 105]}, 80, 140, "x")["status"], "pass")
        self.assertEqual(_evaluate_band({"mean": 100, "ci95": [70, 150]}, 80, 140, "x")["status"], "warn")
        self.assertEqual(_evaluate_band({"mean": 160, "ci95": [150, 170]}, 80, 140, "x")["status"], "fail")
        baseline = run_baseline(2, 20260801, ["wait", "random", "conservative", "aggressive", "seasonal", "chase_current"])
        evaluated = evaluate_report({"modes": {"baseline": baseline}})
        checks = evaluated["modes"]["baseline"]["checks"]
        self.assertEqual(evaluated["config"]["version"], EVALUATION_CONFIG_V0["version"])
        self.assertEqual(checks["manual_playtest"]["status"], "manual")
        self.assertEqual(checks["pareto_dominated"]["status"], "fail")

    def test_season_lengths_match_core_constraints(self) -> None:
        lengths = generate_season_lengths(Mulberry32(20260801))
        self.assertEqual(sum(lengths), 60)
        self.assertTrue(all(3 <= length <= 12 for length in lengths))

    def test_leverage_table_matches_core_boundaries(self) -> None:
        self.assertEqual([leverage_for_round(round_number) for round_number in (1, 2, 3, 5, 6, 8, 9, 11, 12)], [1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5, 3])

    def test_preset_actions_cover_buy_hold_sell_and_qi_flow(self) -> None:
        game = GameState(42)
        # Round 1: draw/recover, buy the first public card without leverage.
        game.draw_and_recover()
        card = game.pool.public[0]
        score = calc_score(card, game.season)
        cost = game.buy_cost(score, False)
        before_buy_qi = game.qi
        self.assertTrue(game.buy(0, False))
        self.assertEqual(game.qi, before_buy_qi - cost)
        self.assertEqual(game.hand_size(), 1)
        first = game.hand[0]
        assert first is not None
        self.assertEqual(first.locked_qi, cost - 2)
        game.advance_season()

        # Round 2 settlement: score and Qi must use current score/hold-cost formula.
        detail = game.draw_and_recover()
        expected_leverage = 1.0
        expected_earning = 1.2 * calc_score(first.card, game.season) * expected_leverage
        expected_qi_cost = max(0.5, 1.5 + 0.4 * calc_score(first.card, game.season))
        self.assertAlmostEqual(detail["hold_earnings"], expected_earning)
        self.assertAlmostEqual(detail["hold_qi_cost"], expected_qi_cost)
        self.assertAlmostEqual(game.score, expected_earning)

        # Sell returns locked Qi first, then charges fixed exit cost.
        before_sell_qi = game.qi
        current_score = calc_score(first.card, game.season)
        self.assertTrue(game.sell(0))
        self.assertAlmostEqual(game.qi, min(80, before_sell_qi + first.locked_qi) - 4)
        self.assertAlmostEqual(game.score, expected_earning + (current_score - first.buy_score) * 4)
        game.invariant()

    def test_leverage_margin_call_uses_dynamic_multiplier_and_one_liquidation(self) -> None:
        game = GameState(7)
        game.draw_and_recover()
        self.assertTrue(game.buy(0, True))
        game.advance_season()
        # Force the deterministic margin-call branch without changing game rules.
        game.qi = 0
        game.pool.draw()
        detail = game.settle()
        self.assertTrue(detail["margin_call"])
        self.assertEqual(game.margin_calls, 1)
        self.assertEqual(game.hand_size(), 0)
        game.invariant()


if __name__ == "__main__":
    unittest.main()
