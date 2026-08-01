"""
经济系统深度分析：计算单张牌的期望收益和完整周期经济性。
运行: python scripts/analyze_economy.py
"""

import math

# ── 基础数据 ─────────────────────────────────────────────────

TIAN_GAN = {
    '甲': 'wood', '乙': 'wood', '丙': 'fire', '丁': 'fire',
    '戊': 'earth', '己': 'earth', '庚': 'metal', '辛': 'metal',
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
    '甲': 'wood', '乙': 'wood', '丙': 'fire', '丁': 'fire',
    '戊': 'earth', '己': 'earth', '庚': 'metal', '辛': 'metal',
    '壬': 'water', '癸': 'water',
}

SEASON_BASE = {
    'spring': {'wood': 4, 'fire': 2, 'earth': 1, 'metal': -4, 'water': -2},
    'summer': {'wood': 2, 'fire': 4, 'earth': 1, 'metal': -2, 'water': -4},
    'autumn': {'wood': -4, 'fire': -2, 'earth': 1, 'metal': 4, 'water': 2},
    'winter': {'wood': -2, 'fire': -4, 'earth': 1, 'metal': 2, 'water': 4},
}

SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter']

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
        branch_score = sum(SEASON_BASE[season][STEM_ELEMENT[stem]] * weight for stem, weight in hidden)
    else:
        branch_score = SEASON_BASE[season]['earth']
    rel_score = relation_score(tg_elem, STEM_ELEMENT.get(dz, 'earth'))
    return stem_score * 0.5 + branch_score * 0.3 + rel_score * 0.2

# ── 经济分析 ─────────────────────────────────────────────────

def analyze_card(tg, dz, leverage=2.0):
    """分析单张牌的经济性"""
    scores = {s: calc_score(tg, dz, s) for s in SEASON_ORDER}

    # 每回合持仓收益
    hold_earnings = {s: 1.2 * sc * leverage for s, sc in scores.items()}

    # 每回合持仓气耗（杠杆额外+6）
    qi_costs = {}
    for s, sc in scores.items():
        base = max(0.5, 1.5 + 0.4 * sc)
        qi_costs[s] = base + (6 if leverage > 1 else 0)

    return scores, hold_earnings, qi_costs

def main():
    print("=" * 70)
    print("甲子纪经济系统深度分析")
    print("=" * 70)

    # ── 1. 单牌评分分布 ──────────────────────────────────────
    print("\n【1. 单牌评分分布 (60张牌 × 4季节)】")
    all_scores = []
    for tg in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        for dz in DI_ZHI:
            for s in SEASON_ORDER:
                all_scores.append(calc_score(tg, dz, s))

    print(f"  评分范围: [{min(all_scores):.1f}, {max(all_scores):.1f}]")
    print(f"  平均: {sum(all_scores)/len(all_scores):.2f}")
    print(f"  中位数: {sorted(all_scores)[len(all_scores)//2]:.2f}")

    # 分位数
    sorted_scores = sorted(all_scores)
    n = len(sorted_scores)
    print(f"  25%分位: {sorted_scores[n//4]:.2f}")
    print(f"  75%分位: {sorted_scores[3*n//4]:.2f}")

    # ── 2. 典型牌分析 ────────────────────────────────────────
    print("\n【2. 典型牌分析 (杠杆2.0x)】")
    print(f"{'牌名':>4} | {'五行':>4} | {'春分':>5} | {'夏分':>5} | {'秋分':>5} | {'冬分':>5} | {'均分':>5} | {'春收益':>6} | {'春耗气':>6}")
    print("-" * 80)

    sample = [
        ('甲', '寅', '木'), ('丙', '午', '火'), ('庚', '申', '金'),
        ('壬', '子', '水'), ('戊', '辰', '土'), ('乙', '卯', '木'),
        ('丁', '巳', '火'), ('辛', '酉', '金'), ('癸', '亥', '水'),
        ('己', '丑', '土'),
    ]

    for tg, dz, elem in sample:
        scores, hold_earnings, qi_costs = analyze_card(tg, dz, leverage=2.0)
        avg = sum(scores.values()) / 4
        print(f"{tg+dz:>4} | {elem:>4} | {scores['spring']:>5.1f} | {scores['summer']:>5.1f} | {scores['autumn']:>5.1f} | {scores['winter']:>5.1f} | {avg:>5.1f} | {hold_earnings['spring']:>6.1f} | {qi_costs['spring']:>6.1f}")

    # ── 3. 完整周期经济性 ────────────────────────────────────
    print("\n【3. 完整周期经济性 (杠杆2.0x, 假设持有完整4季节各5回合)】")
    print(f"{'牌名':>4} | {'总持仓收益':>10} | {'总气耗':>8} | {'净收益(1气=1分)':>16} | {'净收益(1气=0.5分)':>16}")
    print("-" * 80)

    for tg, dz, elem in sample:
        scores, hold_earnings, qi_costs = analyze_card(tg, dz, leverage=2.0)

        total_hold = sum(hold_earnings.values()) * 5  # 每季5回合
        total_qi = sum(qi_costs.values()) * 5

        # 买入成本
        avg_score = sum(scores.values()) / 4
        buy_cost = math.ceil(11 * (1 + 0.05 * avg_score)) + 14

        total_cost = buy_cost + total_qi
        net1 = total_hold - total_cost  # 1气=1分
        net2 = total_hold - total_cost * 0.5  # 1气=0.5分

        print(f"{tg+dz:>4} | {total_hold:>10.0f} | {total_cost:>8.0f} | {net1:>16.0f} | {net2:>16.0f}")

    # ── 4. 杠杆 vs 无杠杆对比 ──────────────────────────────
    print("\n【4. 杠杆 vs 无杠杆对比 (甲寅木牌)】")
    for leverage in [1.0, 1.5, 2.0, 2.5, 3.0]:
        scores, hold_earnings, qi_costs = analyze_card('甲', '寅', leverage=leverage)
        total_hold = sum(hold_earnings.values()) * 5
        total_qi = sum(qi_costs.values()) * 5
        buy_cost = math.ceil(11 * (1 + 0.05 * sum(scores.values())/4))
        if leverage > 1:
            buy_cost += 14
        total_cost = buy_cost + total_qi
        net = total_hold - total_cost * 0.5
        print(f"  杠杆 {leverage:.1f}x: 持仓收益={total_hold:.0f}, 总气耗={total_cost:.0f}, 净收益={net:.0f}")

    # ── 5. 爆仓扣分分析 ──────────────────────────────────────
    print("\n【5. 爆仓扣分分析 (假设爆仓时评分为-2)】")
    for leverage in [1.5, 2.0, 2.5, 3.0]:
        penalty = leverage * abs(-2) * 6
        print(f"  杠杆 {leverage:.1f}x: 爆仓扣分 = {leverage} × 2 × 6 = {penalty:.0f}")

    print("\n【6. 气系统关键指标】")
    print(f"  自然回复 QR: 10/回合")
    print(f"  等待回复 WR: 10/回合 (总计 20/回合)")
    print(f"  杠杆持仓额外气耗: 6/回合 (固定)")
    print(f"  卖出固定消耗: 4/回合 (不回复)")
    print(f"  买入基础消耗: 11 × (1 + 0.05 × 评分)")
    print(f"  杠杆买入额外: 14 (固定)")
    print(f"  手牌上限: 3张")
    print(f"  气上限: 80")
    print(f"  初始气: 50")

    # ── 7. 策略对比总结 ──────────────────────────────────────
    print("\n【7. 模拟结果总结 (2000局/策略)】")
    print(f"{'策略':<20} | {'平均分':>8} | {'中位数':>8} | {'最低':>8} | {'最高':>8} | {'爆仓率':>8}")
    print("-" * 80)
    print(f"{'永远等待（基线）':<20} | {'0.0':>8} | {'0.0':>8} | {'0.0':>8} | {'0.0':>8} | {'0.0%':>8}")
    print(f"{'随机策略':<20} | {'186.6':>8} | {'186.7':>8} | {'-83.7':>8} | {'391.6':>8} | {'94.3%':>8}")
    print(f"{'保守策略':<20} | {'91.9':>8} | {'93.1':>8} | {'-109.3':>8} | {'261.5':>8} | {'0.0%':>8}")
    print(f"{'激进策略':<20} | {'65.0':>8} | {'66.2':>8} | {'-176.5':>8} | {'252.2':>8} | {'83.5%':>8}")
    print(f"{'平衡策略':<20} | {'89.3':>8} | {'93.0':>8} | {'-191.7':>8} | {'294.5':>8} | {'11.2%':>8}")

if __name__ == '__main__':
    main()
