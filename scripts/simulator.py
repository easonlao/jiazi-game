"""甲子纪规则对齐模拟器。

该脚本只用于数值验证，不是第二套游戏规则。卡牌数据、评分公式和经济常量
均按 ``src/core`` 当前实现镜像，并在 ``test_simulator.py`` 中用固定动作做
确定性回归。运行示例：

    python scripts/simulator.py --games 200 --seed 20260801 --json
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


TOTAL_ROUNDS = 60
MAX_HAND_SIZE = 3
SEASONS = ("spring", "summer", "autumn", "winter")
SEASON_ELEMENTS = dict(zip(SEASONS, ("wood", "fire", "metal", "water")))
LEVERAGE_TABLE = ((2, 1.0), (5, 1.5), (8, 2.0), (11, 2.5), (12, 3.0))

# 与 BalanceConfig / QiManager / ScoreManager / LeverageCalculator 对齐。
MAX_QI = 80
INITIAL_QI = 50
BASE_RECOVERY = 10
WAIT_BONUS = 10
SELL_COST = 4
BASE_BUY_COST = 11
BUY_COST_FACTOR = 0.05
LQC = 14
BUY_ENTRY_FEE = 2
FORCED_QI_RETURN_FACTOR = 0.5
FORCED_SCORE_MULTIPLIER = 0.8
MARGIN_CALL_PENALTY_PER_SCORE = 6
HOLD_BONUS = 1.2
SELL_MULTIPLIER = 4
HOLD_QI_BASE = 1.5
HOLD_QI_SCORE_FACTOR = 0.4
HOLD_QI_MIN = 0.5
LEVERAGE_QI_COST_PER_X = 4

STEM_ELEMENT = {
    "甲": "wood", "乙": "wood", "丙": "fire", "丁": "fire",
    "戊": "earth", "己": "earth", "庚": "metal", "辛": "metal",
    "壬": "water", "癸": "water",
}
HIDDEN_STEMS = {
    "子": (("癸", 1.0),),
    "丑": (("己", 0.6), ("癸", 0.3), ("辛", 0.1)),
    "寅": (("甲", 0.6), ("丙", 0.3), ("戊", 0.1)),
    "卯": (("乙", 1.0),),
    "辰": (("戊", 0.6), ("乙", 0.3), ("癸", 0.1)),
    "巳": (("丙", 0.6), ("戊", 0.3), ("庚", 0.1)),
    "午": (("丁", 0.7), ("己", 0.3)),
    "未": (("己", 0.6), ("丁", 0.3), ("乙", 0.1)),
    "申": (("庚", 0.6), ("壬", 0.3), ("戊", 0.1)),
    "酉": (("辛", 1.0),),
    "戌": (("戊", 0.6), ("辛", 0.3), ("丁", 0.1)),
    "亥": (("壬", 0.7), ("甲", 0.3)),
}
WOOD_FIRE = {"wood", "fire"}
METAL_WATER = {"metal", "water"}
OPPOSITE = {frozenset(("wood", "metal")), frozenset(("fire", "water"))}


@dataclass(frozen=True)
class Card:
    id: int
    name: str
    tian_gan: str
    di_zhi: str
    tian_gan_element: str
    di_zhi_element: str
    main_element: str
    yin_yang: str


class Mulberry32:
    """与 src/core/RandomSource.ts 的 SeededRandomSource 完全一致。"""

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    @staticmethod
    def _imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = self._imul(t ^ (t >> 15), t | 1)
        t ^= (t + self._imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    def int(self, minimum: int, maximum_exclusive: int) -> int:
        return minimum + math.floor(self.next() * (maximum_exclusive - minimum))


def load_cards() -> list[Card]:
    path = Path(__file__).resolve().parents[1] / "assets" / "data" / "jiazi_cards.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    cards = [
        Card(
            id=item["id"],
            name=item["name"],
            tian_gan=item["tianGan"],
            di_zhi=item["diZhi"],
            tian_gan_element=item["tianGanElement"],
            di_zhi_element=item["diZhiElement"],
            main_element=item["mainElement"],
            yin_yang=item["yinYang"],
        )
        for item in raw
    ]
    if len(cards) != 60 or {card.id for card in cards} != set(range(1, 61)):
        raise ValueError("jiazi_cards.json 必须包含 ID 1-60 的完整牌池")
    return cards


def score_element_in_season(element: str, season_element: str) -> float:
    if element == "earth":
        return 1.0
    if element == season_element:
        return 4.0
    if (element in WOOD_FIRE and season_element in WOOD_FIRE) or (
        element in METAL_WATER and season_element in METAL_WATER
    ):
        return 2.0
    if frozenset((element, season_element)) in OPPOSITE:
        return -4.0
    return -2.0


def relation_score(tian_gan_element: str, di_zhi_element: str) -> float:
    if tian_gan_element == di_zhi_element:
        return 2.0
    if (tian_gan_element in WOOD_FIRE and di_zhi_element in WOOD_FIRE) or (
        tian_gan_element in METAL_WATER and di_zhi_element in METAL_WATER
    ):
        return 1.5
    if frozenset((tian_gan_element, di_zhi_element)) in OPPOSITE:
        return -2.0
    return 0.0


def js_round(value: float) -> int:
    """JavaScript Math.round 的非负/负数行为（本项目扣分均用此处）。"""
    return math.floor(value + 0.5)


def js_round_decimal(value: float, digits: int = 2) -> float:
    factor = 10 ** digits
    return js_round(value * factor) / factor


def calc_score(card: Card, season: str) -> float:
    season_element = SEASON_ELEMENTS[season]
    stem_score = score_element_in_season(card.tian_gan_element, season_element)
    hidden = HIDDEN_STEMS.get(card.di_zhi, ())
    branch_score = sum(
        score_element_in_season(STEM_ELEMENT[stem], season_element) * weight
        for stem, weight in hidden
    )
    relation = relation_score(card.tian_gan_element, card.di_zhi_element)
    return js_round_decimal(0.5 * stem_score + 0.3 * branch_score + 0.2 * relation)


class ScoreModel:
    """Raw 规则与逐牌四季均值校正候选的同源评分模型。"""

    MODES = ("raw", "centered", "centered_beta")

    def __init__(self, cards: Iterable[Card], mode: str = "raw", beta: float = 0.0):
        if mode not in self.MODES:
            raise ValueError(f"未知 score_mode: {mode}")
        self.mode = mode
        self.beta = float(beta)
        cards = list(cards)
        self.raw_values = {
            (card.id, season): calc_score(card, season)
            for card in cards
            for season in SEASONS
        }
        self.card_means = {
            card.id: statistics.mean(self.raw_values[(card.id, season)] for season in SEASONS)
            for card in cards
        }
        self.values = {}
        for card in cards:
            for season in SEASONS:
                raw = self.raw_values[(card.id, season)]
                if mode == "raw":
                    value = raw
                else:
                    value = raw - self.card_means[card.id]
                    if mode == "centered_beta":
                        value += self.beta
                self.values[(card.id, season)] = js_round_decimal(value)

    def score(self, card: Card, season: str) -> float:
        return self.values[(card.id, season)]

    def card_rows(self, cards: Iterable[Card]) -> list[dict]:
        cards = list(cards)
        rows = []
        for card in cards:
            scores = [self.score(card, season) for season in SEASONS]
            rows.append({
                "id": card.id,
                "name": card.name,
                "season_scores": dict(zip(SEASONS, scores)),
                "mean": statistics.mean(scores),
                "sd": statistics.pstdev(scores),
                "min": min(scores),
                "max": max(scores),
            })
        for row in rows:
            row["pareto_dominated_by_count"] = sum(
                all(other["season_scores"][season] >= row["season_scores"][season] for season in SEASONS)
                and any(other["season_scores"][season] > row["season_scores"][season] for season in SEASONS)
                for other in rows
                if other["id"] != row["id"]
            )
        return rows


def generate_season_lengths(random: Mulberry32) -> list[int]:
    n = random.int(5, 21)
    lengths = [3] * n
    remaining = TOTAL_ROUNDS - 3 * n
    underfull = list(range(n))
    while remaining:
        pick = random.int(0, len(underfull))
        index = underfull[pick]
        lengths[index] += 1
        remaining -= 1
        if lengths[index] >= 12:
            underfull.pop(pick)
    return lengths


def leverage_for_round(round_in_season: int) -> float:
    for maximum, multiplier in LEVERAGE_TABLE:
        if round_in_season <= maximum:
            return multiplier
    return LEVERAGE_TABLE[-1][1]


class CardPool:
    def __init__(self, cards: Iterable[Card], random: Mulberry32):
        self.random = random
        self.deck = list(cards)
        self.public: list[Card] = []
        # 当前核心在“卖出后进入下一回合”时会直接覆盖旧 publicCards；保留被
        # 覆盖的卡牌，既镜像该行为，也让牌数守恒检查能暴露这条待办。
        self.discarded: list[Card] = []
        self.shuffle()

    def shuffle(self) -> None:
        for index in range(len(self.deck) - 1, 0, -1):
            other = self.random.int(0, index + 1)
            self.deck[index], self.deck[other] = self.deck[other], self.deck[index]

    def draw(self) -> None:
        if self.public:
            self.discarded.extend(self.public)
        self.public = self.deck[:2]
        del self.deck[:2]

    def return_cards(self, cards: Iterable[Card]) -> None:
        for card in cards:
            index = self.random.int(0, len(self.deck) + 1)
            self.deck.insert(index, card)

    def buy(self, index: int) -> Card | None:
        if index < 0 or index >= len(self.public):
            return None
        card = self.public[index]
        self.return_cards(card_item for i, card_item in enumerate(self.public) if i != index)
        self.public = []
        return card

    def wait(self) -> None:
        self.return_cards(self.public)
        self.public = []


@dataclass
class Holding:
    card: Card
    buy_score: float
    use_leverage: bool
    locked_qi: int
    hold_earnings: float = 0.0


class GameState:
    def __init__(self, seed: int, score_mode: str = "raw", beta: float = 0.0):
        self.random = Mulberry32(seed)
        self.season_lengths = generate_season_lengths(self.random)
        self.season_index = 0
        self.round_in_season = 1
        self.current_round = 1
        cards = load_cards()
        self.score_model = ScoreModel(cards, score_mode, beta)
        self.pool = CardPool(cards, self.random)
        self.hand: list[Holding | None] = [None] * MAX_HAND_SIZE
        self.qi = float(INITIAL_QI)
        self.score = 0.0
        self.last_action: str | None = None
        self.total_buys = self.total_sells = self.total_waits = 0
        self.total_leverage_buys = self.margin_calls = 0
        self.total_qi_spent = self.total_qi_recovered = 0.0
        self.total_hold_earnings = self.total_sell_earnings = 0.0
        self.forced_waits = 0
        self.history: list[dict] = []

    def card_score(self, card: Card, season: str | None = None) -> float:
        return self.score_model.score(card, season or self.season)

    @property
    def season(self) -> str:
        return SEASONS[self.season_index % 4]

    def advance_season(self) -> None:
        self.current_round += 1
        self.round_in_season += 1
        if self.round_in_season > self.season_lengths[self.season_index]:
            self.season_index += 1
            self.round_in_season = 1

    def hand_size(self) -> int:
        return sum(slot is not None for slot in self.hand)

    def locked_qi(self) -> int:
        return sum(slot.locked_qi for slot in self.hand if slot is not None)

    def buy_cost(self, score: float, use_leverage: bool) -> int:
        cost = BASE_BUY_COST * (1 + BUY_COST_FACTOR * score)
        if use_leverage:
            cost += LQC
        return math.ceil(cost)

    def hold_qi_cost(self, score: float, leverage: float) -> float:
        base = max(HOLD_QI_MIN, HOLD_QI_BASE + HOLD_QI_SCORE_FACTOR * score)
        return base + (leverage * LEVERAGE_QI_COST_PER_X if leverage > 1 else 0)

    def settle(self) -> dict:
        detail = {"round": self.current_round, "season": self.season, "hold_earnings": 0.0,
                  "hold_qi_cost": 0.0, "margin_call": False, "margin_call_cards": []}
        for slot in self.hand:
            if slot is None:
                continue
            leverage = leverage_for_round(self.round_in_season) if slot.use_leverage else 1.0
            score = self.card_score(slot.card)
            earning = HOLD_BONUS * score * leverage
            qi_cost = self.hold_qi_cost(score, leverage)
            self.score += earning
            self.total_hold_earnings += earning
            slot.hold_earnings += earning
            detail["hold_earnings"] += earning
            detail["hold_qi_cost"] += qi_cost
        self.qi -= detail["hold_qi_cost"]
        if self.qi <= 0:
            detail["margin_call"] = self.margin_call()
            detail["margin_call_cards"] = detail.pop("margin_call_cards")
        return detail

    def margin_call(self) -> bool:
        leverage_indices = [
            index for index, slot in enumerate(self.hand)
            if slot is not None and slot.use_leverage
        ]
        if not leverage_indices:
            return False
        target = leverage_indices[self.random.int(0, len(leverage_indices))]
        slot = self.hand[target]
        assert slot is not None
        leverage = leverage_for_round(self.round_in_season) if slot.use_leverage else 1.0
        current_score = self.card_score(slot.card)
        sell_score = (current_score - slot.buy_score) * SELL_MULTIPLIER * leverage
        final_sell = math.floor(sell_score * FORCED_SCORE_MULTIPLIER) if sell_score > 0 else sell_score
        self.score += final_sell
        self.total_sell_earnings += final_sell
        penalty = js_round(leverage * abs(current_score) * MARGIN_CALL_PENALTY_PER_SCORE)
        self.score = max(0.0, self.score - penalty)
        self.hand[target] = None
        self.pool.return_cards([slot.card])
        self.qi = min(MAX_QI, self.qi + math.floor(slot.locked_qi * FORCED_QI_RETURN_FACTOR))
        self.margin_calls += 1
        return True

    def recover(self) -> None:
        self.qi = min(MAX_QI, self.qi + BASE_RECOVERY)
        self.total_qi_recovered += BASE_RECOVERY
        if self.last_action == "wait":
            self.qi = min(MAX_QI, self.qi + WAIT_BONUS)
            self.total_qi_recovered += WAIT_BONUS

    def draw_and_recover(self) -> dict:
        detail = self.settle()
        self.pool.draw()
        self.recover()
        return detail

    def buy(self, public_index: int, use_leverage: bool) -> bool:
        if self.current_round >= TOTAL_ROUNDS or self.hand_size() >= MAX_HAND_SIZE:
            return False
        card = self.pool.public[public_index] if 0 <= public_index < len(self.pool.public) else None
        if card is None:
            return False
        score = self.card_score(card)
        cost = self.buy_cost(score, use_leverage)
        if self.qi < cost:
            return False
        self.qi -= cost
        self.total_qi_spent += cost
        slot_index = self.hand.index(None)
        self.hand[slot_index] = Holding(card, score, use_leverage, cost - BUY_ENTRY_FEE)
        if use_leverage:
            self.total_leverage_buys += 1
        self.total_buys += 1
        self.pool.buy(public_index)
        self.last_action = "buy"
        return True

    def sell(self, slot_index: int) -> bool:
        if slot_index < 0 or slot_index >= len(self.hand):
            return False
        slot = self.hand[slot_index]
        if slot is None:
            return False
        if self.qi + slot.locked_qi < SELL_COST:
            return False
        current_score = self.card_score(slot.card)
        leverage = leverage_for_round(self.round_in_season) if slot.use_leverage else 1.0
        sell_score = (current_score - slot.buy_score) * SELL_MULTIPLIER * leverage
        self.hand[slot_index] = None
        self.pool.return_cards([slot.card])
        self.qi = min(MAX_QI, self.qi + slot.locked_qi)
        self.qi -= SELL_COST
        self.total_qi_spent += SELL_COST
        self.score += sell_score
        self.total_sell_earnings += sell_score
        self.total_sells += 1
        self.last_action = "sell"
        return True

    def wait(self) -> None:
        self.pool.wait()
        self.total_waits += 1
        self.last_action = "wait"

    def invariant(self) -> None:
        ids = [card.id for card in self.pool.deck + self.pool.public + self.pool.discarded]
        ids.extend(slot.card.id for slot in self.hand if slot is not None)
        if len(ids) != 60 or len(set(ids)) != 60:
            raise AssertionError(f"牌池守恒失败: {len(ids)} 张, {len(set(ids))} 个唯一 ID")

    def play(self, strategy: Callable[["GameState"], tuple[str, int | None, bool | None]]) -> "GameState":
        while self.current_round <= TOTAL_ROUNDS:
            detail = self.draw_and_recover()
            action, index, leverage = strategy(self)
            success = False
            if action == "buy":
                success = self.buy(index if index is not None else -1, bool(leverage))
            elif action == "sell":
                success = self.sell(index if index is not None else -1)
            if not success:
                if action != "wait":
                    self.forced_waits += 1
                self.wait()
            self.history.append({**detail, "action": self.last_action, "qi": self.qi, "score": self.score,
                                 "season_round": self.round_in_season, "leverage": leverage_for_round(self.round_in_season)})
            self.invariant()
            self.advance_season()
        return self


Strategy = Callable[[GameState], tuple[str, int | None, bool | None]]


def strategy_always_wait(game: GameState) -> tuple[str, int | None, bool | None]:
    return "wait", None, None


def strategy_random(game: GameState) -> tuple[str, int | None, bool | None]:
    actions: list[tuple[str, int | None, bool | None]] = [("wait", None, None)]
    for index, card in enumerate(game.pool.public):
        score = game.card_score(card)
        for leverage in (False, True):
            if game.hand_size() < MAX_HAND_SIZE and game.qi >= game.buy_cost(score, leverage):
                actions.append(("buy", index, leverage))
    for index, slot in enumerate(game.hand):
        if slot and game.qi + slot.locked_qi >= SELL_COST:
            actions.append(("sell", index, None))
    return actions[game.random.int(0, len(actions))]


def strategy_conservative(game: GameState) -> tuple[str, int | None, bool | None]:
    for index, slot in enumerate(game.hand):
        if slot and game.card_score(slot.card) - slot.buy_score < -5 and game.qi + slot.locked_qi >= SELL_COST:
            return "sell", index, None
    candidates = [
        (game.card_score(card), index)
        for index, card in enumerate(game.pool.public)
        if game.card_score(card) > 0 and game.qi >= game.buy_cost(game.card_score(card), False)
    ]
    if candidates:
        _, index = max(candidates)
        return "buy", index, False
    return strategy_always_wait(game)


def strategy_aggressive(game: GameState) -> tuple[str, int | None, bool | None]:
    candidates = [
        (game.card_score(card), index)
        for index, card in enumerate(game.pool.public)
        if game.qi >= game.buy_cost(game.card_score(card), True) and game.hand_size() < MAX_HAND_SIZE
    ]
    if candidates:
        _, index = max(candidates)
        return "buy", index, True
    return strategy_always_wait(game)


def strategy_balanced(game: GameState) -> tuple[str, int | None, bool | None]:
    current_hold_cost = sum(
        game.hold_qi_cost(game.card_score(slot.card), leverage_for_round(game.round_in_season) if slot.use_leverage else 1.0)
        for slot in game.hand if slot is not None
    )
    if game.qi - current_hold_cost < 5:
        for index, slot in enumerate(game.hand):
            if slot and game.qi + slot.locked_qi >= SELL_COST:
                return "sell", index, None
    candidates = []
    for index, card in enumerate(game.pool.public):
        score = game.card_score(card)
        leverage = game.qi > 30 and game.round_in_season > 3
        if score > 0.5 and game.qi >= game.buy_cost(score, leverage) and game.hand_size() < MAX_HAND_SIZE:
            candidates.append((score, index, leverage))
    if candidates:
        _, index, leverage = max(candidates)
        return "buy", index, leverage
    return strategy_always_wait(game)


STRATEGIES: dict[str, Strategy] = {
    "wait": strategy_always_wait,
    "random": strategy_random,
    "conservative": strategy_conservative,
    "aggressive": strategy_aggressive,
    "balanced": strategy_balanced,
}


def card_score_report(cards: list[Card], score_mode: str = "raw", beta: float = 0.0) -> dict:
    model = ScoreModel(cards, score_mode, beta)
    seasonal = {
        season: [model.score(card, season) for card in cards]
        for season in SEASONS
    }
    return {
        "score_mode": score_mode,
        "beta": beta,
        "seasons": {
            season: {
                "mean": statistics.mean(scores),
                "sd": statistics.pstdev(scores),
                "min": min(scores),
                "max": max(scores),
                "positive_share": sum(score > 0 for score in scores) / len(scores),
            }
            for season, scores in seasonal.items()
        },
        "cards": model.card_rows(cards),
        "pareto_dominated_total": sum(row["pareto_dominated_by_count"] > 0 for row in model.card_rows(cards)),
    }


def metric_summary(values: Iterable[float], binary: bool = False) -> dict:
    values = list(values)
    mean = statistics.mean(values)
    if binary:
        standard_error = math.sqrt(mean * (1 - mean) / len(values))
    else:
        standard_error = statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else 0.0
    half_width = 1.96 * standard_error
    return {"mean": mean, "ci95": [mean - half_width, mean + half_width]}


def summarize(games: list[GameState]) -> dict:
    scores = [game.score for game in games]
    margin = [game.margin_calls for game in games]
    return {
        "games": len(games),
        "score": {**metric_summary(scores), "median": statistics.median(scores), "min": min(scores), "max": max(scores)},
        "margin_call_rate": metric_summary([value > 0 for value in margin], binary=True),
        "margin_calls": metric_summary(margin),
        "buys": metric_summary([game.total_buys for game in games]),
        "sells": metric_summary([game.total_sells for game in games]),
        "waits": metric_summary([game.total_waits for game in games]),
        "forced_wait_rate": metric_summary([game.forced_waits > 0 for game in games], binary=True),
        "leverage_buys": metric_summary([game.total_leverage_buys for game in games]),
        "qi_end": metric_summary([game.qi for game in games]),
        "hold_earnings": metric_summary([game.total_hold_earnings for game in games]),
        "sell_earnings": metric_summary([game.total_sell_earnings for game in games]),
        "discarded_public_cards": metric_summary([len(game.pool.discarded) for game in games]),
    }


def run_baseline(games: int, seed: int, strategy_names: list[str], score_mode: str = "raw", beta: float = 0.0) -> dict:
    cards = load_cards()
    output = {"rule_source": "src/core mirror", "card_count": len(cards), "total_rounds": TOTAL_ROUNDS,
              "shadow_accounting": {
                  "discarded_public_cards": "Python-only accounting for public cards overwritten by current core draw; not a TypeScript core state",
              },
              "score_distribution": card_score_report(cards, score_mode, beta), "strategies": {}}
    for name in strategy_names:
        if name not in STRATEGIES:
            raise ValueError(f"未知策略: {name}")
        output["strategies"][name] = summarize([
            GameState(seed + index, score_mode, beta).play(STRATEGIES[name])
            for index in range(games)
        ])
    return output


def run_comparison(games: int, seed: int, strategy_names: list[str], beta: float = 0.0) -> dict:
    modes = {
        "baseline": ("raw", 0.0),
        "candidate_a": ("centered", 0.0),
        "candidate_b": ("centered_beta", beta),
    }
    return {
        "rule_source": "src/core mirror",
        "card_count": 60,
        "total_rounds": TOTAL_ROUNDS,
        "games_per_strategy": games,
        "seed": seed,
        "candidate_b_beta": beta,
        "shadow_accounting": {
            "discarded_public_cards": "Python-only accounting; not included in cross-language core snapshots",
        },
        "modes": {
            name: run_baseline(games, seed, strategy_names, mode, mode_beta)
            for name, (mode, mode_beta) in modes.items()
        },
    }


def snapshot(game: GameState) -> dict:
    """只返回可由 TurnManager 公开/可观察状态组成的快照。

    ``discarded`` 不放入快照：它是 Python 为牌数审计保留的 shadow accounting，
    并非 TypeScript 核心的真实状态。公共牌被下一轮 draw 覆盖的现状会直接体现在
    deck/public IDs 的对照中。
    """
    return {
        "round": game.current_round,
        "season": game.season,
        "seasonRound": game.round_in_season,
        "qi": game.qi,
        "score": game.score,
        "hand": [
            None if slot is None else {"id": slot.card.id, "lockedQi": slot.locked_qi, "useLeverage": slot.use_leverage}
            for slot in game.hand
        ],
        "deckIds": [card.id for card in game.pool.deck],
        "publicIds": [card.id for card in game.pool.public],
        "marginCallCount": game.margin_calls,
    }


def run_trace(payload: dict) -> dict:
    """运行一个由测试传入的固定动作 trace，供 Vitest 跨语言核对。"""
    game = GameState(int(payload["seed"]))
    if payload.get("season_lengths") is not None:
        lengths = [int(value) for value in payload["season_lengths"]]
        if sum(lengths) != TOTAL_ROUNDS or not all(3 <= value <= 12 for value in lengths):
            raise ValueError("trace season_lengths 必须是 3-12 且总和为60")
        game.season_lengths = lengths
    game.draw_and_recover()
    snapshots = [snapshot(game)]
    for action in payload["actions"]:
        kind = action["type"]
        if kind == "set_qi":
            game.qi = float(action["value"])
            continue
        if kind == "buy":
            ok = game.buy(int(action["cardIndex"]), bool(action.get("leverage", False)))
        elif kind == "sell":
            ok = game.sell(int(action["slotIndex"]))
        elif kind == "wait":
            game.wait()
            ok = True
        else:
            raise ValueError(f"未知 trace 动作: {kind}")
        if not ok:
            raise ValueError(f"trace 动作失败: {action}")
        game.advance_season()
        if game.current_round <= TOTAL_ROUNDS:
            game.draw_and_recover()
        snapshots.append(snapshot(game))
    return {"snapshots": snapshots, "shadowDiscardedCount": len(game.pool.discarded)}


def main() -> None:
    parser = argparse.ArgumentParser(description="甲子纪真实规则 Monte Carlo 基线与逐牌均值校正 A/B")
    parser.add_argument("--games", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--strategy", action="append", choices=sorted(STRATEGIES), dest="strategies")
    parser.add_argument("--score-mode", choices=ScoreModel.MODES, default="raw")
    parser.add_argument("--beta", type=float, default=0.0, help="candidate_b 的统一 beta 偏置，默认0")
    parser.add_argument("--compare", action="store_true", help="一次输出 baseline/candidate_a/candidate_b")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    parser.add_argument("--trace-stdin", action="store_true", help="从 stdin 读取固定动作 trace 并输出快照")
    args = parser.parse_args()
    if args.trace_stdin:
        print(json.dumps(run_trace(json.load(__import__("sys").stdin)), ensure_ascii=False, separators=(",", ":")))
        return
    names = args.strategies or list(STRATEGIES)
    report = run_comparison(args.games, args.seed, names, args.beta) if args.compare else run_baseline(
        args.games, args.seed, names, args.score_mode, args.beta
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
