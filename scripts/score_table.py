"""
生成60张甲子牌在四季的评分表，用于验证评分体系平衡性。
运行: python scripts/score_table.py
"""

# ── 基础数据 ──────────────────────────────────────────────

TIAN_GAN = {
    '甲': 'wood', '乙': 'wood',
    '丙': 'fire', '丁': 'fire',
    '戊': 'earth', '己': 'earth',
    '庚': 'metal', '辛': 'metal',
    '壬': 'water', '癸': 'water',
}

DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

# 地支藏干: [(天干, 权重), ...]
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

# ── 季节基础分 ─────────────────────────────────────────────

# 当季+4, 同组+2, 土+1, 跨组-2, 对立-4
SEASON_BASE = {
    'spring': {'wood': 4, 'fire': 2, 'earth': 1, 'metal': -4, 'water': -2},
    'summer': {'wood': 2, 'fire': 4, 'earth': 1, 'metal': -2, 'water': -4},
    'autumn': {'wood': -4, 'fire': -2, 'earth': 1, 'metal': 4, 'water': 2},
    'winter': {'wood': -2, 'fire': -4, 'earth': 1, 'metal': 2, 'water': 4},
}

# ── 关系分 ─────────────────────────────────────────────────

def relation_score(tg_elem, dz_elem):
    """天干地支关系分"""
    if tg_elem == dz_elem:
        return 2.0

    # 分组：木火组 / 金水组
    wood_fire = ['wood', 'fire']
    metal_water = ['metal', 'water']

    tg_wf = tg_elem in wood_fire
    dz_wf = dz_elem in wood_fire
    tg_mw = tg_elem in metal_water
    dz_mw = dz_elem in metal_water

    # 同组：+1.5
    if (tg_wf and dz_wf) or (tg_mw and dz_mw):
        return 1.5

    # 对立：-2（木↔金，火↔水）
    opposite = [('wood', 'metal'), ('fire', 'water')]
    if (tg_elem, dz_elem) in opposite or (dz_elem, tg_elem) in opposite:
        return -2.0

    # 跨组：0
    return 0.0

# ── 计算单张牌评分 ─────────────────────────────────────────

def calc_score(tg, dz, season):
    tg_elem = TIAN_GAN[tg]
    dz_elem = STEM_ELEMENT.get(dz, 'earth')  # 地支主五行（简化）

    # 天干基础分
    stem_score = SEASON_BASE[season][tg_elem]

    # 藏干加权分
    hidden = HIDDEN_STEMS.get(dz, [])
    if hidden:
        branch_score = sum(
            SEASON_BASE[season][STEM_ELEMENT[stem]] * weight
            for stem, weight in hidden
        )
    else:
        branch_score = SEASON_BASE[season][dz_elem]

    # 关系分
    rel_score = relation_score(tg_elem, dz_elem)

    # 最终评分
    return stem_score * 0.5 + branch_score * 0.3 + rel_score * 0.2

# ── 生成60张牌 ─────────────────────────────────────────────

def generate_cards():
    cards = []
    id = 1
    for tg in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        for dz in DI_ZHI:
            cards.append((id, tg, dz, f"{tg}{dz}"))
            id += 1
    return cards

# ── 输出 ───────────────────────────────────────────────────

def main():
    cards = generate_cards()
    seasons = ['spring', 'summer', 'autumn', 'winter']
    season_names = {'spring': '春', 'summer': '夏', 'autumn': '秋', 'winter': '冬'}

    # 按天干分组输出
    for tg in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        print(f"\n{'='*60}")
        print(f"天干: {tg} ({TIAN_GAN[tg]})")
        print(f"{'='*60}")
        print(f"{'牌名':>4} | {'春':>6} | {'夏':>6} | {'秋':>6} | {'冬':>6} | {'平均':>6}")
        print("------+--------+--------+--------+--------+--------")

        for id, card_tg, dz, name in cards:
            if card_tg != tg:
                continue
            scores = [calc_score(tg, dz, s) for s in seasons]
            avg = sum(scores) / 4
            scores_str = " | ".join(f"{s:>6.1f}" for s in scores)
            print(f"{name:>4} | {scores_str} | {avg:>6.1f}")

    # 统计分布
    print(f"\n{'='*60}")
    print("评分分布统计")
    print(f"{'='*60}")

    all_scores = []
    for id, tg, dz, name in cards:
        for s in seasons:
            all_scores.append(calc_score(tg, dz, s))

    print(f"最低分: {min(all_scores):.1f}")
    print(f"最高分: {max(all_scores):.1f}")
    print(f"平均分: {sum(all_scores)/len(all_scores):.1f}")
    print(f"中位数: {sorted(all_scores)[len(all_scores)//2]:.1f}")

    # 分季节统计
    for s in seasons:
        season_scores = []
        for id, tg, dz, name in cards:
            season_scores.append(calc_score(tg, dz, s))
        print(f"\n{season_names[s]}季: 最低={min(season_scores):.1f}, 最高={max(season_scores):.1f}, 平均={sum(season_scores)/len(season_scores):.1f}")

if __name__ == '__main__':
    main()
