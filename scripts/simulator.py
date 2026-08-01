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
from collections import Counter
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


def calc_score(card: Card, season: str) -> float:
    season_element = SEASON_ELEMENTS[season]
    stem_score = score_element_in_season(card.tian_gan_element, season_element)
    hidden = HIDDEN_STEMS.get(card.di_zhi, ())
    branch_score = sum(
        score_element_in_season(STEM_ELEMENT[stem], season_element) * weight
        for stem, weight in hidden
    )
    relation = relation_score(card.tian_gan_element, card.di_zhi_element)
    return round(0.5 * stem_score + 0.3 * branch_score + 0.2 * relation, 2)


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
    def __init__(self, seed: int):
        self.random = Mulberry32(seed)
        self.season_lengths = generate_season_lengths(self.random)
        self.season_index = 0
        self.round_in_season = 1
        self.current_round = 1
        self.pool = CardPool(load_cards(), self.random)
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
            score = calc_score(slot.card, self.season)
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
        current_score = calc_score(slot.card, self.season)
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
        score = calc_score(card, self.season)
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
        current_score = calc_score(slot.card, self.season)
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
        score = calc_score(card, game.season)
        for leverage in (False, True):
            if game.hand_size() < MAX_HAND_SIZE and game.qi >= game.buy_cost(score, leverage):
                actions.append(("buy", index, leverage))
    for index, slot in enumerate(game.hand):
        if slot and game.qi + slot.locked_qi >= SELL_COST:
            actions.append(("sell", index, None))
    return actions[game.random.int(0, len(actions))]


def strategy_conservative(game: GameState) -> tuple[str, int | None, bool | None]:
    for index, slot in enumerate(game.hand):
        if slot and calc_score(slot.card, game.season) - slot.buy_score < -5 and game.qi + slot.locked_qi >= SELL_COST:
            return "sell", index, None
    candidates = [
        (calc_score(card, game.season), index)
        for index, card in enumerate(game.pool.public)
        if calc_score(card, game.season) > 0 and game.qi >= game.buy_cost(calc_score(card, game.season), False)
    ]
    if candidates:
        _, index = max(candidates)
        return "buy", index, False
    return strategy_always_wait(game)


def strategy_aggressive(game: GameState) -> tuple[str, int | None, bool | None]:
    candidates = [
        (calc_score(card, game.season), index)
        for index, card in enumerate(game.pool.public)
        if game.qi >= game.buy_cost(calc_score(card, game.season), True) and game.hand_size() < MAX_HAND_SIZE
    ]
    if candidates:
        _, index = max(candidates)
        return "buy", index, True
    return strategy_always_wait(game)


def strategy_balanced(game: GameState) -> tuple[str, int | None, bool | None]:
    current_hold_cost = sum(
        game.hold_qi_cost(calc_score(slot.card, game.season), leverage_for_round(game.round_in_season) if slot.use_leverage else 1.0)
        for slot in game.hand if slot is not None
    )
    if game.qi - current_hold_cost < 5:
        for index, slot in enumerate(game.hand):
            if slot and game.qi + slot.locked_qi >= SELL_COST:
                return "sell", index, None
    candidates = []
    for index, card in enumerate(game.pool.public):
        score = calc_score(card, game.season)
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


def card_score_report(cards: list[Card]) -> dict:
    values = {season: [calc_score(card, season) for card in cards] for season in SEASONS}
    return {
        season: {
            "mean": statistics.mean(scores),
            "sd": statistics.pstdev(scores),
            "min": min(scores),
            "max": max(scores),
            "positive_share": sum(score > 0 for score in scores) / len(scores),
        }
        for season, scores in values.items()
    }


def summarize(games: list[GameState]) -> dict:
    scores = [game.score for game in games]
    margin = [game.margin_calls for game in games]
    return {
        "games": len(games),
        "score": {"mean": statistics.mean(scores), "median": statistics.median(scores), "min": min(scores), "max": max(scores)},
        "margin_call_rate": sum(value > 0 for value in margin) / len(margin),
        "margin_calls_mean": statistics.mean(margin),
        "buys_mean": statistics.mean(game.total_buys for game in games),
        "sells_mean": statistics.mean(game.total_sells for game in games),
        "waits_mean": statistics.mean(game.total_waits for game in games),
        "forced_wait_rate": sum(game.forced_waits > 0 for game in games) / len(games),
        "leverage_buys_mean": statistics.mean(game.total_leverage_buys for game in games),
        "qi_end_mean": statistics.mean(game.qi for game in games),
        "hold_earnings_mean": statistics.mean(game.total_hold_earnings for game in games),
        "sell_earnings_mean": statistics.mean(game.total_sell_earnings for game in games),
        "discarded_public_cards_mean": statistics.mean(len(game.pool.discarded) for game in games),
    }


def run_baseline(games: int, seed: int, strategy_names: list[str]) -> dict:
    cards = load_cards()
    output = {"rule_source": "src/core mirror", "card_count": len(cards), "total_rounds": TOTAL_ROUNDS,
              "score_distribution": card_score_report(cards), "strategies": {}}
    for name in strategy_names:
        if name not in STRATEGIES:
            raise ValueError(f"未知策略: {name}")
        output["strategies"][name] = summarize([GameState(seed + index).play(STRATEGIES[name]) for index in range(games)])
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="甲子纪真实规则 Monte Carlo 基线")
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--strategy", action="append", choices=sorted(STRATEGIES), dest="strategies")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    names = args.strategies or list(STRATEGIES)
    report = run_baseline(args.games, args.seed, names)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
