"""
Monte Carlo 对局模拟器
模拟多种玩家策略下的完整对局，验证经济循环健康度。
运行: python scripts/simulator.py
"""

import random
from collections import defaultdict

# ── 基础数据（与 score_table.py 保持一致）─────────────────────

TIAN_GAN = {
    '甲': 'wood', '乙': 'wood',
    '丙': 'fire', '丁': 'fire',
    '戊': 'earth', '己': 'earth',
    '庚': 'metal', '辛': 'metal',
    '壬': 'water', '癸': 'water',
}

DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

HIDDEN_STEMS = {
    '子': [('癸', 1.0)],
    '丑': [('己', 0.6), ('癸', 0.3), ('辛', 0.1)],
    '寅': [('甲', 0.6), ('丙', 0.3), ('戊', 0.1)],
    '卯': [('乙', 1.0)],
    '辰': [('戊', 0.6), ('乙', 0.3), ('癸', 0.1)],
    '巳': [('丙', 0.6), ('戊', 0.3), ('庚', 0.1)],
    '午': [('丁', 0.7), ('己', 0.3)],
    '未': [('己', 0.6), ('丁', 0.3), ('乙', 0.1)],
    '申': [('庚', 0.6), ('壬', 0.3), ('戊', 0.1)],
    '酉': [('辛', 1.0)],
    '戌': [('戊', 0.6), ('辛', 0.3), ('丁', 0.1)],
    '亥': [('壬', 0.7), ('甲', 0.3)],
}

STEM_ELEMENT = {
    '甲': 'wood', '乙': 'wood',
    '丙': 'fire', '丁': 'fire',
    '戊': 'earth', '己': 'earth',
    '庚': 'metal', '辛': 'metal',
    '壬': 'water', '癸': 'water',
}

SEASON_BASE = {
    'spring': {'wood': 4, 'fire': 2, 'earth': 1, 'metal': -4, 'water': -2},
    'summer': {'wood': 2, 'fire': 4, 'earth': 1, 'metal': -2, 'water': -4},
    'autumn': {'wood': -4, 'fire': -2, 'earth': 1, 'metal': 4, 'water': 2},
    'winter': {'wood': -2, 'fire': -4, 'earth': 1, 'metal': 2, 'water': 4},
}

SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter']

# ── 游戏常量 ─────────────────────────────────────────────────

MAX_QI = 80
INITIAL_QI = 50
BASE_RECOVERY = 10
WAIT_BONUS = 10
SELL_COST = 4
SELL_BASE = 0
BASE_BUY_COST = 11
BUY_COST_FACTOR = 0.05
LQC = 14  # 杠杆买入额外消耗
BUY_ENTRY_FEE = 2
MAX_HAND_SIZE = 3
TOTAL_ROUNDS = 60

# 杠杆倍率表: (季节内最大回合, 倍数)
LEVERAGE_TABLE = [
    (3, 1.0),
    (6, 1.5),
    (9, 2.0),
    (11, 2.5),
    (12, 3.0),
]

# ── 评分计算 ─────────────────────────────────────────────────

def relation_score(tg_elem, dz_elem):
    if tg_elem == dz_elem:
        return 2.0
    wood_fire = ['wood', 'fire']
    metal_water = ['metal', 'water']
    tg_wf = tg_elem in wood_fire
    dz_wf = dz_elem in wood_fire
    tg_mw = tg_elem in metal_water
    dz_mw = dz_elem in metal_water
    if (tg_wf and dz_wf) or (tg_mw and dz_mw):
        return 1.5
    opposite = [('wood', 'metal'), ('fire', 'water')]
    if (tg_elem, dz_elem) in opposite or (dz_elem, tg_elem) in opposite:
        return -2.0
    return 0.0

def calc_score(tg, dz, season):
    tg_elem = TIAN_GAN[tg]
    stem_score = SEASON_BASE[season][tg_elem]
    hidden = HIDDEN_STEMS.get(dz, [])
    if hidden:
        branch_score = sum(
            SEASON_BASE[season][STEM_ELEMENT[stem]] * weight
            for stem, weight in hidden
        )
    else:
        branch_score = SEASON_BASE[season]['earth']
    rel_score = relation_score(tg_elem, STEM_ELEMENT.get(dz, 'earth'))
    return stem_score * 0.5 + branch_score * 0.3 + rel_score * 0.2

# ── 卡牌生成 ─────────────────────────────────────────────────

def generate_cards():
    cards = []
    cid = 1
    for tg in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        for dz in DI_ZHI:
            cards.append({
                'id': cid, 'tg': tg, 'dz': dz, 'name': f"{tg}{dz}",
                'element': TIAN_GAN[tg],
            })
            cid += 1
    return cards

# ── 季节循环 ─────────────────────────────────────────────────

def generate_season_lengths():
    """生成填满60回合的季节长度列表"""
    lengths = []
    total = 0
    while total < TOTAL_ROUNDS:
        l = random.randint(3, 12)
        if total + l > TOTAL_ROUNDS:
            l = TOTAL_ROUNDS - total
        lengths.append(l)
        total += l
    return lengths

def get_season_at_round(season_lengths, round_num):
    """获取指定回合的季节和季节内回合"""
    cumulative = 0
    for i, length in enumerate(season_lengths):
        cumulative += length
        if round_num <= cumulative:
            season_index = i % 4
            round_in_season = round_num - (cumulative - length)
            return SEASON_ORDER[season_index], round_in_season, season_index, length
    # 超出范围，返回最后一个
    return SEASON_ORDER[-1], season_lengths[-1], len(season_lengths) - 1, season_lengths[-1]

# ── 杠杆计算 ─────────────────────────────────────────────────

def get_leverage_multiplier(round_in_season):
    for max_round, mult in LEVERAGE_TABLE:
        if round_in_season <= max_round:
            return mult
    return 3.0

# ── 游戏状态 ─────────────────────────────────────────────────

class GameState:
    def __init__(self):
        self.all_cards = generate_cards()
        random.shuffle(self.all_cards)
        self.deck = list(self.all_cards)
        self.public_cards = []
        self.hand = [None] * MAX_HAND_SIZE  # HandSlot: {card, buy_score, leverage, buy_round, locked_qi, hold_earnings}
        self.qi = INITIAL_QI
        self.score = 0
        self.total_hold_earnings = 0
        self.total_sell_earnings = 0
        self.current_round = 1
        self.season_lengths = generate_season_lengths()
        self.last_action = None
        self.total_buys = 0
        self.total_sells = 0
        self.total_waits = 0
        self.total_leverage_buys = 0
        self.margin_call_count = 0
        self.forced_waits = 0  # 被迫等待次数（气不足）
        self.total_qi_spent = 0
        self.total_qi_recovered = 0
        self.history = []

    def get_season_info(self):
        return get_season_at_round(self.season_lengths, self.current_round)

    def get_total_locked_qi(self):
        return sum(slot['locked_qi'] for slot in self.hand if slot is not None)

    def get_current_max_qi(self):
        return MAX_QI - self.get_total_locked_qi()

    def draw_cards(self):
        """从牌堆抽2张到公共区"""
        num = min(2, len(self.deck))
        self.public_cards = self.deck[:num]
        self.deck = self.deck[num:]

    def calculate_buy_cost(self, card_score, use_leverage):
        cost = BASE_BUY_COST * (1 + BUY_COST_FACTOR * card_score)
        if use_leverage:
            cost += LQC
        return int(__import__('math').ceil(cost))

    def settle_holdings(self):
        """结算持仓：计算收益、扣除气耗、检查爆仓"""
        season, round_in_season, _, _ = self.get_season_info()
        total_qi_cost = 0
        total_hold_earning = 0

        for i, slot in enumerate(self.hand):
            if slot is not None:
                card_score = slot['card']['element']
                # 计算卡牌当季评分
                card_score_val = calc_score(slot['card']['tg'], slot['card']['dz'], season)
                leverage = slot['leverage']

                # 持仓收益
                hold_earning = 1.2 * card_score_val * leverage
                self.score += hold_earning
                self.total_hold_earnings += hold_earning
                slot['hold_earnings'] += hold_earning
                total_hold_earning += hold_earning

                # 持仓气耗
                base_cost = max(0.5, 1.5 + 0.4 * card_score_val)
                leverage_extra = 6 if leverage > 1 else 0
                qi_cost = base_cost + leverage_extra
                total_qi_cost += qi_cost

        # 扣除气耗
        self.qi -= total_qi_cost

        # 爆仓检查
        margin_call_happened = False
        while self.qi <= 0:
            # 找杠杆牌
            leverage_indices = [i for i, slot in enumerate(self.hand) if slot is not None and slot['leverage'] > 1]
            if not leverage_indices:
                break

            # 随机强平一张
            target = random.choice(leverage_indices)
            slot = self.hand[target]
            season, _, _, _ = self.get_season_info()
            current_score = calc_score(slot['card']['tg'], slot['card']['dz'], season)

            # 卖出得分
            sell_score = (SELL_BASE + (current_score - slot['buy_score']) * 4) * slot['leverage']
            if sell_score > 0:
                sell_score = int(sell_score * 0.8)
            self.score += sell_score
            self.total_sell_earnings += sell_score

            # 爆仓扣分
            penalty = round(slot['leverage'] * abs(current_score) * 6)
            self.score = max(0, self.score - penalty)

            # 返还保证金
            qi_return = int(slot['locked_qi'] * 0.5)
            self.qi += qi_return

            # 移除卡牌
            self.hand[target] = None
            self.margin_call_count += 1
            margin_call_happened = True

        return margin_call_happened

    def recover_qi(self):
        """气回复"""
        # 自然回复
        recovery = BASE_RECOVERY
        max_qi = self.get_current_max_qi()
        self.qi = min(max_qi, self.qi + recovery)
        self.total_qi_recovered += recovery

        # 等待额外回复
        if self.last_action == 'wait':
            self.qi = min(max_qi, self.qi + WAIT_BONUS)
            self.total_qi_recovered += WAIT_BONUS

    def can_afford(self, amount):
        return self.qi >= amount

    def execute_buy(self, public_index, use_leverage):
        """执行买入"""
        if not self.public_cards:
            return False
        if public_index >= len(self.public_cards):
            return False

        card = self.public_cards[public_index]
        season, round_in_season, _, _ = self.get_season_info()
        card_score = calc_score(card['tg'], card['dz'], season)
        buy_cost = self.calculate_buy_cost(card_score, use_leverage)

        if not self.can_afford(buy_cost):
            return False

        # 检查手牌空间
        empty_slot = None
        for i, slot in enumerate(self.hand):
            if slot is None:
                empty_slot = i
                break
        if empty_slot is None:
            return False

        # 执行买入
        self.qi -= buy_cost
        self.total_qi_spent += buy_cost
        leverage = get_leverage_multiplier(round_in_season) if use_leverage else 1.0
        locked_qi = buy_cost - BUY_ENTRY_FEE

        self.hand[empty_slot] = {
            'card': card,
            'buy_score': card_score,
            'leverage': leverage,
            'buy_round': self.current_round,
            'locked_qi': locked_qi,
            'hold_earnings': 0,
        }

        # 未选的牌回牌堆
        remaining = [c for i, c in enumerate(self.public_cards) if i != public_index]
        self.deck.extend(remaining)
        self.public_cards = []

        self.total_buys += 1
        if use_leverage:
            self.total_leverage_buys += 1
        self.last_action = 'buy'
        return True

    def execute_sell(self, hand_index):
        """执行卖出"""
        if hand_index >= len(self.hand) or self.hand[hand_index] is None:
            return False

        if not self.can_afford(SELL_COST):
            return False

        slot = self.hand[hand_index]
        season, _, _, _ = self.get_season_info()
        current_score = calc_score(slot['card']['tg'], slot['card']['dz'], season)

        # 卖出得分
        sell_score = (SELL_BASE + (current_score - slot['buy_score']) * 4) * slot['leverage']
        self.score += sell_score
        self.total_sell_earnings += sell_score

        # 固定扣气
        self.qi -= SELL_COST
        self.total_qi_spent += SELL_COST

        # 移除卡牌
        self.hand[hand_index] = None
        self.total_sells += 1
        self.last_action = 'sell'
        return True

    def execute_wait(self):
        """执行等待"""
        # 公共牌回牌堆
        self.deck.extend(self.public_cards)
        self.public_cards = []
        self.total_waits += 1
        self.last_action = 'wait'
        return True

    def advance_round(self):
        self.current_round += 1

    def is_game_over(self):
        return self.current_round > TOTAL_ROUNDS

# ── 玩家策略 ─────────────────────────────────────────────────

def strategy_always_wait(game):
    """永远等待（基线策略）"""
    return ('wait', None, None)

def strategy_random(game):
    """随机策略"""
    actions = [('wait', None, None)]
    if game.public_cards and game.get_total_locked_qi() < MAX_QI - 10:
        for i in range(len(game.public_cards)):
            season, ris, _, _ = game.get_season_info()
            card_score = calc_score(game.public_cards[i]['tg'], game.public_cards[i]['dz'], season)
            cost = game.calculate_buy_cost(card_score, False)
            if game.can_afford(cost):
                actions.append(('buy', i, False))
                if game.can_afford(cost + LQC):
                    actions.append(('buy', i, True))
    for i, slot in enumerate(game.hand):
        if slot is not None and game.can_afford(SELL_COST):
            actions.append(('sell', i, None))
    return random.choice(actions)

def strategy_conservative(game):
    """保守策略：只买无杠杆，评分>0才买，亏损>5就卖"""
    season, ris, _, _ = game.get_season_info()

    # 先检查是否有该卖的
    for i, slot in enumerate(game.hand):
        if slot is not None:
            current_score = calc_score(slot['card']['tg'], slot['card']['dz'], season)
            profit = current_score - slot['buy_score']
            if profit < -5 and game.can_afford(SELL_COST):
                return ('sell', i, None)

    # 再考虑买
    if game.public_cards:
        best_idx = None
        best_score = -999
        for i, card in enumerate(game.public_cards):
            card_score = calc_score(card['tg'], card['dz'], season)
            cost = game.calculate_buy_cost(card_score, False)
            if card_score > 0 and game.can_afford(cost) and card_score > best_score:
                best_score = card_score
                best_idx = i
        if best_idx is not None:
            return ('buy', best_idx, False)

    return ('wait', None, None)

def strategy_aggressive(game):
    """激进策略：永远加杠杆，永远买最高分"""
    season, ris, _, _ = game.get_season_info()

    if game.public_cards:
        best_idx = None
        best_score = -999
        for i, card in enumerate(game.public_cards):
            card_score = calc_score(card['tg'], card['dz'], season)
            cost = game.calculate_buy_cost(card_score, True)
            if game.can_afford(cost) and card_score > best_score:
                best_score = card_score
                best_idx = i
        if best_idx is not None:
            return ('buy', best_idx, True)

    # 没牌可买就等
    return ('wait', None, None)

def strategy_balanced(game):
    """平衡策略：根据气量决定是否加杠杆，有赚就卖"""
    season, ris, _, _ = game.get_season_info()

    # 持仓气耗过高就卖
    total_hold_cost = 0
    for slot in game.hand:
        if slot is not None:
            card_score = calc_score(slot['card']['tg'], slot['card']['dz'], season)
            base = max(0.5, 1.5 + 0.4 * card_score)
            total_hold_cost += base + (6 if slot['leverage'] > 1 else 0)

    # 气不够就卖一张
    if game.qi - total_hold_cost < 5:
        for i, slot in enumerate(game.hand):
            if slot is not None and game.can_afford(SELL_COST):
                return ('sell', i, None)

    # 买牌逻辑
    if game.public_cards:
        best_idx = None
        best_score = -999
        for i, card in enumerate(game.public_cards):
            card_score = calc_score(card['tg'], card['dz'], season)
            # 气量健康就加杠杆
            use_leverage = game.qi > 30 and ris > 3
            cost = game.calculate_buy_cost(card_score, use_leverage)
            if card_score > 0.5 and game.can_afford(cost) and card_score > best_score:
                best_score = card_score
                best_idx = i
                best_leverage = use_leverage
        if best_idx is not None:
            return ('buy', best_idx, best_leverage)

    return ('wait', None, None)

# ── 模拟引擎 ─────────────────────────────────────────────────

def run_single_game(strategy, verbose=False):
    """运行单局游戏，返回最终状态"""
    game = GameState()

    while not game.is_game_over():
        # 1. 持仓结算
        game.settle_holdings()

        # 2. 刷牌
        game.draw_cards()

        # 3. 气回复
        game.recover_qi()

        # 4. 玩家决策
        action, idx, leverage = strategy(game)

        if action == 'buy':
            success = game.execute_buy(idx, leverage)
            if not success:
                game.execute_wait()
        elif action == 'sell':
            success = game.execute_sell(idx)
            if not success:
                game.execute_wait()
        else:
            game.execute_wait()

        # 5. 推进回合
        game.advance_round()

    return game

def run_simulation(strategy, strategy_name, num_games=1000):
    """运行多局模拟，统计结果"""
    results = []
    for _ in range(num_games):
        game = run_single_game(strategy, verbose=False)
        results.append({
            'score': game.score,
            'buys': game.total_buys,
            'sells': game.total_sells,
            'waits': game.total_waits,
            'leverage_buys': game.total_leverage_buys,
            'margin_calls': game.margin_call_count,
            'qi_spent': game.total_qi_spent,
            'qi_recovered': game.total_qi_recovered,
            'hold_earnings': game.total_hold_earnings,
            'sell_earnings': game.total_sell_earnings,
        })

    scores = [r['score'] for r in results]
    margin_calls = [r['margin_calls'] for r in results]
    buys = [r['buys'] for r in results]
    sells = [r['sells'] for r in results]
    waits = [r['waits'] for r in results]
    leverage_buys = [r['leverage_buys'] for r in results]

    print(f"\n{'='*60}")
    print(f"策略: {strategy_name} ({num_games} 局)")
    print(f"{'='*60}")
    print(f"最终分数: 平均={sum(scores)/len(scores):.1f}, 中位数={sorted(scores)[len(scores)//2]:.1f}, 最低={min(scores):.1f}, 最高={max(scores):.1f}")
    print(f"操作统计: 平均买={sum(buys)/len(buys):.1f}, 卖={sum(sells)/len(sells):.1f}, 等={sum(waits)/len(waits):.1f}")
    print(f"杠杆买入: 平均={sum(leverage_buys)/len(leverage_buys):.1f}")
    print(f"爆仓次数: 平均={sum(margin_calls)/len(margin_calls):.2f}, 最多={max(margin_calls)}, 爆仓局数={sum(1 for m in margin_calls if m > 0)}/{num_games}")

    # 分数分布
    buckets = [0, 0, 0, 0, 0]  # <0, 0-10, 10-30, 30-60, >60
    for s in scores:
        if s < 0:
            buckets[0] += 1
        elif s < 10:
            buckets[1] += 1
        elif s < 30:
            buckets[2] += 1
        elif s < 60:
            buckets[3] += 1
        else:
            buckets[4] += 1
    print(f"分数分布: <0={buckets[0]}, 0-10={buckets[1]}, 10-30={buckets[2]}, 30-60={buckets[3]}, >60={buckets[4]}")

    return results

def main():
    print("=" * 60)
    print("甲子纪 Monte Carlo 对局模拟器")
    print("=" * 60)

    # 先验证评分系统
    print("\n【评分系统验证】")
    all_scores = []
    seasons = ['spring', 'summer', 'autumn', 'winter']
    for card in generate_cards():
        for s in seasons:
            all_scores.append(calc_score(card['tg'], card['dz'], s))
    print(f"60张牌×4季节评分范围: [{min(all_scores):.1f}, {max(all_scores):.1f}]")
    print(f"平均: {sum(all_scores)/len(all_scores):.1f}, 中位数: {sorted(all_scores)[len(all_scores)//2]:.1f}")

    # 运行各策略模拟
    strategies = [
        (strategy_always_wait, "永远等待（基线）"),
        (strategy_random, "随机策略"),
        (strategy_conservative, "保守策略"),
        (strategy_aggressive, "激进策略"),
        (strategy_balanced, "平衡策略"),
    ]

    all_results = {}
    for strategy, name in strategies:
        results = run_simulation(strategy, name, num_games=2000)
        all_results[name] = results

    # 策略对比
    print(f"\n{'='*60}")
    print("策略对比总结")
    print(f"{'='*60}")
    print(f"{'策略':<20} | {'平均分':>8} | {'中位数':>8} | {'最低':>8} | {'最高':>8} | {'爆仓率':>8}")
    print("-" * 80)
    for name, results in all_results.items():
        scores = [r['score'] for r in results]
        margin_rate = sum(1 for r in results if r['margin_calls'] > 0) / len(results) * 100
        print(f"{name:<20} | {sum(scores)/len(scores):>8.1f} | {sorted(scores)[len(scores)//2]:>8.1f} | {min(scores):>8.1f} | {max(scores):>8.1f} | {margin_rate:>7.1f}%")

if __name__ == '__main__':
    main()
