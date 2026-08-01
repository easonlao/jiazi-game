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
    GameState,
    Mulberry32,
    ScoreModel,
    SEASONS,
    calc_score,
    generate_season_lengths,
    leverage_for_round,
    load_cards,
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
