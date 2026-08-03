"""
三策略混合验证：抄底(差价) + 持有 + 土牌 混合是否优于单一策略？
手牌3格，验证：
1. 单一策略基准：差价流 / 持有流(最优形态) / 土牌长持 / 土牌杠杆×1
2. 两两混合：1土保底+2差价 / 1土保底+2持有
3. 动态三策略：1土保底 + 剩余格子按"差价机会/持有机会"择优

== 与 repo/src/core 逐条对齐声明（2026-08-03 收敛）==
- 参数来源：优先读 repo/assets/data/balance_config.json（由 npm run export:config 从 TS 源码导出）；
  读不到时回退下方硬编码（此时应在控制台看到警告，说明桥接失效需排查）
- 评分输出：get_score 已 ×10 取整（roundScore10 一致，-35~+35 整数）
- 气耗：持仓基础与杠杆额外均 ceil（LeverageCalculator.calculateHoldQiCost 一致）
- 强平：随机选牌（TurnManager.handleMarginCall 一致）、一次结算最多 1 张、返还气截断、强平牌回牌堆
- 卖出：可用气 = qi + lockedQi < 卖出费时拒绝（executeSell 一致）、卖出牌回牌堆
- 买入/回牌/等待/回气/杠杆表/季节{8,12}/min4：与 CardPoolManager/SeasonCycle/BalanceConfig 一致
- 已知边界：**锁定机制（LOCK_COST=5、MAX=2）未模拟**——当前 4 个固定策略均不使用锁定，故不影响现有结论；若未来策略设计使用锁定，需扩展本引擎
"""
import json, random, statistics, math, sys
from pathlib import Path

# 数据文件基于脚本位置解析（docs 版在 docs/analysis/，repo 版在 repo/scripts/）
_SCRIPT_DIR = Path(__file__).resolve().parent
if _SCRIPT_DIR.name == 'analysis':
    # docs/analysis/three_strategy_mix.py → 上两级是 jiazi-game/，再进 repo/
    _REPO_DIR = _SCRIPT_DIR.parent.parent / 'repo'
else:
    # repo/scripts/three_strategy_mix.py → 上一级是 repo/
    _REPO_DIR = _SCRIPT_DIR.parent
REPO_ASSETS = _REPO_DIR / 'assets' / 'data'
CARDS_PATH = REPO_ASSETS / 'jiazi_cards.json'
CONFIG_PATH = REPO_ASSETS / 'balance_config.json'
CARDS = json.load(open(CARDS_PATH, encoding='utf-8'))

# ========== 参数加载：优先 balance_config.json（TS 导出），回退硬编码 ==========
def _load_config():
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            cfg = json.load(f)
        print(f'[three_strategy_mix] 从 balance_config.json 加载 {len(cfg)} 个参数（{cfg.get("_meta", {}).get("exportedAt", "?")}）', file=sys.stderr)
        return cfg
    except FileNotFoundError:
        print('[three_strategy_mix] ⚠️ 未找到 balance_config.json——使用硬编码参数，数值可能与游戏不同步！', file=sys.stderr)
        return None

CFG = _load_config() or {}

def _c(key, fallback):
    """从配置取参数，缺 key 时回退硬编码值。"""
    return CFG.get(key, fallback)

SEASONS = ['spring', 'summer', 'autumn', 'winter']
WANG_QI = {'spring': 'wood', 'summer': 'fire', 'autumn': 'metal', 'winter': 'water'}
WF, MW = {'wood', 'fire'}, {'metal', 'water'}
OPP = {frozenset(('wood', 'metal')), frozenset(('fire', 'water'))}

# 评分基线（BalanceConfig）
SCORE_BETA = _c('scoreBeta', 0.02)
POLARITY = {'yang': _c('yangPolarityFactor', 1.1), 'yin': _c('yinPolarityFactor', 0.9)}
# 收益系数（ScoreManager 镜像）
HOLD_BONUS = _c('holdBonus', 1.2)
SPREAD = _c('spreadMultiplier', 4)
# 气经济（BalanceConfig）
QI_MAX, QI_INIT, QI_RECOVERY, WAIT_BONUS = (_c(k, v) for k, v in
    [('maxQi', 80), ('initialQi', 50), ('baseRecovery', 10), ('waitBonus', 10)])
SELL_COST, BASE_BUY, BUY_FACTOR, LQC, ENTRY_FEE = (_c(k, v) for k, v in
    [('sellCost', 4), ('baseBuyCost', 11), ('buyCostFactor', 0.005), ('lqc', 8), ('buyEntryFee', 2)])
HOLD_QI_BASE, HOLD_QI_FACTOR, HOLD_QI_MIN = (_c(k, v) for k, v in
    [('holdQiBase', 1.5), ('holdQiScoreFactor', 0.04), ('holdQiMin', 0.5)])
MARGIN_PENALTY, FL_SCORE_MULT, FL_QI_RETURN = (_c(k, v) for k, v in
    [('marginCallPenaltyPerScore', 3), ('forcedLiquidationScoreMultiplier', 0.8), ('forcedLiquidationQiReturnFactor', 0.5)])
HAND_SIZE, TOTAL_ROUNDS = _c('maxHandSize', 3), _c('totalRounds', 60)
LEVERAGE_TABLE = [[r, m] for r, m in _c('leverageTable', [[2, 1.0], [5, 2.0], [8, 2.5], [11, 3.0], [12, 3.5]])]
EARTH_LEV_QI = _c('earthLeverageQiCostPerX', 5)

# 五行季节分（JiaziCard.ts 镜像）
EARTH_BASE = _c('earthMirror', 0.8)
IN_SEASON, SAME_GROUP, OPPOSITE, CROSS_GROUP = (_c(k, v) for k, v in
    [('inSeasonScore', 4.0), ('sameGroupScore', 2.0), ('oppositeScore', -4.0), ('crossGroupScore', -2.0)])
# 干支关系分
REL_SAME_ELEM, REL_SAME_GROUP, REL_OPP = (_c(k, v) for k, v in
    [('relationSameElement', 2.0), ('relationSameGroup', 1.5), ('relationOpposite', -2.0)])
# 评分权重
STEM_W, BRANCH_W, REL_W = _c('stemWeight', 0.5), _c('branchWeight', 0.3), _c('relationWeight', 0.2)
EARTH_STEM_W, EARTH_BRANCH_W = _c('earthStemWeight', 0.5), _c('earthBranchWeight', 0.5)
# 季节生成（SeasonCycle 镜像）
SEASON_POOL = _c('seasonSegmentPool', [8, 12])
SEASON_MIN = _c('seasonMinLength', 4)

CANG_GAN = {
    '子': [('癸', 1.0)], '丑': [('己', 0.6), ('癸', 0.3), ('辛', 0.1)],
    '寅': [('甲', 0.6), ('丙', 0.3), ('戊', 0.1)], '卯': [('乙', 1.0)],
    '辰': [('戊', 0.6), ('乙', 0.3), ('癸', 0.1)], '巳': [('丙', 0.6), ('戊', 0.3), ('庚', 0.1)],
    '午': [('丁', 0.7), ('己', 0.3)], '未': [('己', 0.6), ('丁', 0.3), ('乙', 0.1)],
    '申': [('庚', 0.6), ('壬', 0.3), ('戊', 0.1)], '酉': [('辛', 1.0)],
    '戌': [('戊', 0.6), ('辛', 0.3), ('丁', 0.1)], '亥': [('壬', 0.7), ('甲', 0.3)],
}
GAN_ELEMENT = {
    '甲': 'wood', '乙': 'wood', '丙': 'fire', '丁': 'fire', '戊': 'earth', '己': 'earth',
    '庚': 'metal', '辛': 'metal', '壬': 'water', '癸': 'water',
}

def s_el(e, se):
    if e == 'earth': return EARTH_BASE
    if e == se: return IN_SEASON
    if (e in WF and se in WF) or (e in MW and se in MW): return SAME_GROUP
    if frozenset((e, se)) in OPP: return OPPOSITE
    return CROSS_GROUP

def hidden(card, se):
    return sum(s_el(GAN_ELEMENT[g], se) * w for g, w in CANG_GAN[card['diZhi']])

def rel(card):
    tg, dz = card['tianGanElement'], card['diZhiElement']
    if tg == dz: return REL_SAME_ELEM
    if (tg in WF and dz in WF) or (tg in MW and dz in MW): return REL_SAME_GROUP
    if frozenset((tg, dz)) in OPP: return REL_OPP
    return 0.0

def raw(card, season):
    se = WANG_QI[season]
    return s_el(card['tianGanElement'], se) * STEM_W + hidden(card, se) * BRANCH_W + rel(card) * REL_W

def get_score(card, season):
    """最终季节评分：与 JiaziCard.ts roundScore10 一致（×10 取整为整数）"""
    if card['tianGanElement'] == 'earth':
        se = WANG_QI[season]
        stem = s_el('earth', se)
        br = hidden(card, se)
        bm = statistics.mean([hidden(card, WANG_QI[s]) for s in SEASONS])
        return round((stem * EARTH_STEM_W + (br - bm) * EARTH_BRANCH_W + rel(card) * REL_W) * 10)
    raws = [raw(card, s) for s in SEASONS]
    m = sum(raws) / 4
    f = POLARITY[card['yinYang']]
    return round((SCORE_BETA + f * (raw(card, season) - m)) * 10)

def lev_for(r):
    for mr, lv in LEVERAGE_TABLE:
        if r <= mr: return lv
    return 3.5

def gen_lens(rng):
    """季节长度：与 SeasonCycle.ts generateSeasonLengths() 一致（2026-08-03 方案B）"""
    n = rng.choice(SEASON_POOL)      # 段数池 {8,12}，4 的倍数保证四季均衡
    lengths = [SEASON_MIN] * n       # min_len = 4（先铺 4 保证每段至少 4 回合操作空间）
    rem = TOTAL_ROUNDS - SEASON_MIN * n
    uf = list(range(n))
    while rem > 0:
        p = rng.randint(0, len(uf) - 1)
        idx = uf[p]; lengths[idx] += 1; rem -= 1
        if lengths[idx] >= 12: uf.pop(p)
    return lengths

def buy_cost(score, lev):
    return math.ceil(BASE_BUY * (1 + BUY_FACTOR * score) + (LQC if lev else 0))

def hold_qi(card, score, lev):
    base = math.ceil(max(HOLD_QI_MIN, HOLD_QI_BASE + HOLD_QI_FACTOR * score))
    if lev > 1:
        coeff = EARTH_LEV_QI if card['tianGanElement'] == 'earth' else _c('leverageQiCostPerX', 2)
        return base + math.ceil(lev * coeff)
    return base

class Mulberry32:
    """与 src/core/RandomSource.ts 的 SeededRandomSource 完全一致（trace 模式用）。"""

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
        """左闭右开 [min, maxExclusive)，与 TS SeededRandomSource.int 一致。"""
        return minimum + math.floor(self.next() * (maximum_exclusive - minimum))

    def choice(self, seq):
        """随机选一个（与 TS random.int(0, len) 一致）。"""
        return seq[self.int(0, len(seq))]


class Game:
    def __init__(self, rng, draw_count=3, lens=None):
        self.rng = rng
        self.draw_count = draw_count
        self.lens = lens if lens is not None else gen_lens(rng)
        self.qi = QI_INIT
        self.score = 0.0
        self.hand = []
        self.deck = [c for c in CARDS]
        # 洗牌：普通模式用 rng.shuffle；trace 模式（Mulberry32）用 Fisher-Yates 对齐 TS
        if isinstance(rng, Mulberry32):
            for i in range(len(self.deck) - 1, 0, -1):
                j = self._ts_int(0, i + 1)
                self.deck[i], self.deck[j] = self.deck[j], self.deck[i]
        else:
            rng.shuffle(self.deck)
        self.public = []
        self.round = 1
        self.margin_calls = 0
        self._season_idx = 0
        self._round_in_season = 1
        self.last_action = None
        self.qi_wasted = 0.0
        self.waits = 0

    def _ts_int(self, minimum, maximum_exclusive):
        """左闭右开随机整数：TS SeededRandomSource.int 语义（trace 模式）"""
        if isinstance(self.rng, Mulberry32):
            return self.rng.int(minimum, maximum_exclusive)
        # 普通模式：Python randint 是闭区间，转成 TS 左闭右开语义
        return self.rng.randint(minimum, maximum_exclusive - 1)

    def season(self):
        return SEASONS[self._season_idx % 4]

    def next_season(self):
        return SEASONS[(self._season_idx + 1) % 4]

    def lev(self):
        return lev_for(self._round_in_season)

    def season_remaining(self):
        return self.lens[self._season_idx] - self._round_in_season

    def advance(self):
        self.round += 1
        self._round_in_season += 1
        if self._round_in_season > self.lens[self._season_idx]:
            self._season_idx += 1
            self._round_in_season = 1

    def draw(self):
        n = min(self.draw_count, len(self.deck))
        self.public = self.deck[:n]
        self.deck = self.deck[n:]

    def return_to_deck(self, cards):
        for card in cards:
            # TS returnCards: random.int(0, deck.length + 1) → [0, len+1)
            idx = self._ts_int(0, len(self.deck) + 1)
            self.deck.insert(idx, card)

    def settle(self):
        total_qi_cost = 0.0
        for slot in self.hand:
            sc = get_score(slot['card'], self.season())
            lv = self.lev() if slot['lev'] else 1.0
            earn = HOLD_BONUS * sc * lv
            qc = hold_qi(slot['card'], sc, lv)
            self.score += earn
            total_qi_cost += qc
        if total_qi_cost > 0:
            self.qi -= total_qi_cost
        # 爆仓：与 TurnManager.handleMarginCall 一致——随机选一张杠杆牌强平，
        # 一次结算最多强平一张；气仍≤0 则下回合 settle 再触发。
        if self.qi <= 0:
            lev_slots = [s for s in self.hand if s['lev']]
            if lev_slots:
                target = self.rng.choice(lev_slots)  # 随机选，与 handleMarginCall 一致
                sc = get_score(target['card'], self.season())
                lv = self.lev()
                base_sell = (sc - target['buy_score']) * SPREAD * lv
                final_sell = base_sell if base_sell <= 0 else math.floor(base_sell * FL_SCORE_MULT)
                self.score += final_sell
                penalty = round(lv * abs(sc) * MARGIN_PENALTY)
                self.score -= penalty
                # 返还气截断到上限（与 QiManager.recover 一致）
                self.qi = min(QI_MAX, self.qi + math.floor(target['locked_qi'] * FL_QI_RETURN))
                self.hand.remove(target)
                self.return_to_deck([target['card']])  # 强平牌回牌堆（与 handleMarginCall 一致）
                self.margin_calls += 1

    def recover(self):
        before = self.qi
        self.qi = min(QI_MAX, self.qi + QI_RECOVERY)
        self.qi_wasted += max(0.0, (before + QI_RECOVERY) - QI_MAX)
        if self.last_action == 'wait':
            before = self.qi
            self.qi = min(QI_MAX, self.qi + WAIT_BONUS)
            self.qi_wasted += max(0.0, (before + WAIT_BONUS) - QI_MAX)

    def buy(self, card, lev):
        if len(self.hand) >= HAND_SIZE: return False
        if self.round >= TOTAL_ROUNDS: return False
        sc = get_score(card, self.season())
        cost = buy_cost(sc, lev)
        if self.qi < cost: return False
        self.qi -= cost
        self.hand.append({'card': card, 'buy_score': sc, 'lev': lev,
                          'buy_round': self.round, 'locked_qi': cost - ENTRY_FEE})
        rest = [c for c in self.public if c['id'] != card['id']]
        self.return_to_deck(rest)
        self.public = []
        return True

    def sell(self, idx):
        slot = self.hand[idx]
        # 卖出气门槛：可用气 = 当前气 + 该卡牌锁定气（与 TurnManager.executeSell 一致）
        if self.qi + slot['locked_qi'] < SELL_COST:
            return False
        sc = get_score(slot['card'], self.season())
        lv = self.lev() if slot['lev'] else 1.0
        sell_score = (sc - slot['buy_score']) * SPREAD * lv
        self.score += sell_score
        self.qi = min(QI_MAX, self.qi + slot['locked_qi'])
        self.qi -= SELL_COST
        self.return_to_deck([slot['card']])
        del self.hand[idx]
        return True

    def wait(self):
        self.return_to_deck(self.public)
        self.public = []
        self.last_action = 'wait'
        self.waits += 1

    # ========== 单一策略 ==========

    def run_trend(self, max_hand=3, quality=1.5):
        """差价流：季末抄底（下季涨），转负前卖"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            s = self.season(); ns = self.next_season()
            remaining = self.season_remaining()
            for i, slot in enumerate(self.hand):
                cur = get_score(slot['card'], s); buy = slot['buy_score']
                holds = self.round - slot['buy_round']
                if cur >= buy + 1.5 and get_score(slot['card'], ns) < cur:
                    self.sell(i); self.last_action = 'sell'; break
                elif cur > 0 and get_score(slot['card'], ns) < 0:
                    self.sell(i); self.last_action = 'sell'; break
                elif holds > 12 and cur <= buy:
                    self.sell(i); self.last_action = 'sell'; break
            else:
                if len(self.hand) < max_hand:
                    cands = [c for c in self.public if c['tianGanElement'] != 'earth'
                             and get_score(c, ns) > get_score(c, s) and get_score(c, s) < 2.0]
                    if cands and remaining <= 3:
                        best = max(cands, key=lambda c: get_score(c, ns) - get_score(c, s))
                        if self.qi >= buy_cost(get_score(best, s), 0.0):
                            self.buy(best, False); self.last_action = 'buy'
                            self.advance(); continue
                self.wait()
            self.advance()
        return self.score

    def run_hold(self, max_hand=2, quality=0.5):
        """持有流：同组两季窗口（当季+下季正分），下季转负前卖"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            s = self.season(); ns = self.next_season()
            season_end = self._round_in_season >= self.lens[self._season_idx]
            for i, slot in enumerate(self.hand):
                cur = get_score(slot['card'], s); nxt = get_score(slot['card'], ns)
                if nxt < 0 and cur > 0:
                    self.sell(i); self.last_action = 'sell'; break
                elif cur < 0 and season_end:
                    self.sell(i); self.last_action = 'sell'; break
            else:
                if len(self.hand) < max_hand:
                    cands = [c for c in self.public if c['tianGanElement'] != 'earth']
                    buyable = []
                    for c in cands:
                        cur = get_score(c, s); nxt = get_score(c, ns)
                        if cur >= quality and nxt >= 0:
                            buyable.append((cur, c))
                    if buyable:
                        best = max(buyable, key=lambda x: x[0])
                        if self.qi >= buy_cost(get_score(best[1], s), 0.0):
                            self.buy(best[1], False); self.last_action = 'buy'
                            self.advance(); continue
                self.wait()
            self.advance()
        return self.score

    def run_hold_best(self, quality=0.5, exp_next=5.0):
        """持有流最优形态：期望买入（当季剩余回合×当季分 + 期望下季长×下季分）+ 满3格"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            s = self.season(); ns = self.next_season()
            remaining = self.season_remaining()
            season_end = self._round_in_season >= self.lens[self._season_idx]
            sold = False
            for i, slot in enumerate(self.hand):
                cur = get_score(slot['card'], s); nxt = get_score(slot['card'], ns)
                if nxt < 0 and cur > 0:
                    self.sell(i); self.last_action = 'sell'; sold = True; break
                elif cur < 0 and season_end:
                    self.sell(i); self.last_action = 'sell'; sold = True; break
            if sold:
                self.advance(); continue
            if len(self.hand) < HAND_SIZE:
                best = None; best_exp = -999
                for c in self.public:
                    if c['tianGanElement'] == 'earth': continue
                    cur = get_score(c, s); nxt = get_score(c, ns)
                    if cur < quality or nxt < 0: continue
                    exp = remaining * cur + exp_next * nxt
                    if exp > best_exp:
                        best_exp = exp; best = c
                if best and self.qi >= buy_cost(get_score(best, s), 0.0):
                    self.buy(best, False); self.last_action = 'buy'
                else:
                    self.wait()
            else:
                self.wait()
            self.advance()
        return self.score

    def run_earth_lev(self, n_earth=1):
        """土牌杠杆长持"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            if len([s for s in self.hand if s['card']['tianGanElement'] == 'earth']) < n_earth:
                earths = [c for c in self.public if c['tianGanElement'] == 'earth']
                if earths:
                    best = max(earths, key=lambda c: get_score(c, self.season()))
                    if self.qi >= buy_cost(get_score(best, self.season()), 1.0):
                        self.buy(best, True); self.last_action = 'buy'
                        self.advance(); continue
            self.wait()
            self.advance()
        return self.score

    def run_earth_hold(self):
        """土牌无杠杆长持"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            if len(self.hand) < HAND_SIZE:
                earths = [c for c in self.public if c['tianGanElement'] == 'earth']
                if earths:
                    best = max(earths, key=lambda c: get_score(c, self.season()))
                    if self.qi >= buy_cost(get_score(best, self.season()), 0.0):
                        self.buy(best, False); self.last_action = 'buy'
                        self.advance(); continue
            self.wait()
            self.advance()
        return self.score

    # ========== 混合策略 ==========

    def _sell_logic(self, slot, s, ns):
        """通用卖出：差价/持有规则"""
        cur = get_score(slot['card'], s)
        buy = slot['buy_score']
        holds = self.round - slot['buy_round']
        if slot['card']['tianGanElement'] == 'earth':
            return False  # 土牌不卖
        nxt = get_score(slot['card'], ns)
        if cur >= buy + 1.5 and nxt < cur: return True
        if cur > 0 and nxt < 0: return True
        if holds > 12 and cur <= buy: return True
        if nxt < 0 and cur > 0: return True
        return False

    def run_mix_2(self, mix_type):
        """两两混合：mix_type = 'trend_earth' (1土杠杆+2差价) / 'hold_earth' (1土杠杆+2持有)"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            s = self.season(); ns = self.next_season()
            remaining = self.season_remaining()
            n_earth = len([sl for sl in self.hand if sl['card']['tianGanElement'] == 'earth'])
            # 卖出（非土牌）
            for i, slot in enumerate(self.hand):
                if slot['card']['tianGanElement'] == 'earth': continue
                if self._sell_logic(slot, s, ns):
                    self.sell(i); self.last_action = 'sell'; break
            else:
                # 买入：优先保底土牌杠杆
                if n_earth < 1:
                    earths = [c for c in self.public if c['tianGanElement'] == 'earth']
                    if earths:
                        best = max(earths, key=lambda c: get_score(c, s))
                        if self.qi >= buy_cost(get_score(best, s), 1.0):
                            self.buy(best, True); self.last_action = 'buy'
                            self.advance(); continue
                # 再按主策略
                if len(self.hand) < HAND_SIZE:
                    if mix_type == 'trend_earth':
                        cands = [c for c in self.public if c['tianGanElement'] != 'earth'
                                 and get_score(c, ns) > get_score(c, s) and get_score(c, s) < 2.0]
                        if cands and remaining <= 3:
                            best = max(cands, key=lambda c: get_score(c, ns) - get_score(c, s))
                            if self.qi >= buy_cost(get_score(best, s), 0.0):
                                self.buy(best, False); self.last_action = 'buy'
                                self.advance(); continue
                    else:  # hold_earth
                        buyable = []
                        for c in self.public:
                            if c['tianGanElement'] == 'earth': continue
                            cur = get_score(c, s); nxt = get_score(c, ns)
                            if cur >= 0.5 and nxt >= 0:
                                buyable.append((cur, c))
                        if buyable:
                            best = max(buyable, key=lambda x: x[0])
                            if self.qi >= buy_cost(get_score(best[1], s), 0.0):
                                self.buy(best[1], False); self.last_action = 'buy'
                                self.advance(); continue
                self.wait()
            self.advance()
        return self.score

    def run_mix_3(self):
        """动态三策略：1土保底 + 剩余格子按"差价机会/持有机会"择优（看谁期望高买谁）"""
        while self.round <= TOTAL_ROUNDS:
            self.settle(); self.draw(); self.recover()
            s = self.season(); ns = self.next_season()
            remaining = self.season_remaining()
            n_earth = len([sl for sl in self.hand if sl['card']['tianGanElement'] == 'earth'])
            # 卖出（非土牌）
            for i, slot in enumerate(self.hand):
                if slot['card']['tianGanElement'] == 'earth': continue
                if self._sell_logic(slot, s, ns):
                    self.sell(i); self.last_action = 'sell'; break
            else:
                # 买入：优先保底土牌杠杆
                if n_earth < 1:
                    earths = [c for c in self.public if c['tianGanElement'] == 'earth']
                    if earths:
                        best = max(earths, key=lambda c: get_score(c, s))
                        if self.qi >= buy_cost(get_score(best, s), 1.0):
                            self.buy(best, True); self.last_action = 'buy'
                            self.advance(); continue
                # 剩余格子：差价机会 vs 持有机会 择优
                if len(self.hand) < HAND_SIZE:
                    best_buy = None; best_val = -999
                    for c in self.public:
                        if c['tianGanElement'] == 'earth': continue
                        cur = get_score(c, s); nxt = get_score(c, ns)
                        # 差价机会：下季涨 + 季末买（评分差大=期望高）
                        if nxt > cur and cur < 2.0 and remaining <= 3:
                            val = (nxt - cur) * SPREAD * 0.5  # 差价期望
                            if val > best_val:
                                best_val = val; best_buy = (c, False, 'trend')
                        # 持有机会：当季正分 + 下季正分（两季窗口）
                        if cur >= 0.5 and nxt >= 0 and remaining > 1:
                            val = HOLD_BONUS * cur * (remaining + 5)  # 持有期望
                            if val > best_val:
                                best_val = val; best_buy = (c, False, 'hold')
                    if best_buy:
                        c, lev, typ = best_buy
                        if self.qi >= buy_cost(get_score(c, s), lev):
                            self.buy(c, lev); self.last_action = 'buy'
                            self.advance(); continue
                self.wait()
            self.advance()
        return self.score


def run_all(strategy_name, games=400, seed=42):
    rng = random.Random(seed)
    scores, mcs = [], []
    for _ in range(games):
        g = Game(rng)
        fn = getattr(g, strategy_name)
        scores.append(fn())
        mcs.append(g.margin_calls)
    return (statistics.mean(scores), statistics.stdev(scores), statistics.mean(mcs),
            sum(1 for x in mcs if x > 0) / len(mcs) * 100)


# ========== trace 模式（替代已归档官方模拟器的 --trace-stdin，供 Vitest parity 对照）==========

def _trace_snapshot(game):
    """输出与 TurnManager 可观察状态对齐的快照（与官方 snapshot 字段一致）。"""
    # 手牌固定长度 3（含空位 null），与 HandManager.getHand 返回结构一致
    hand = [None] * HAND_SIZE
    for idx, slot in enumerate(game.hand):
        hand[idx] = {"id": slot['card']['id'], "lockedQi": slot['locked_qi'], "useLeverage": bool(slot['lev'])}
    return {
        "round": game.round,
        "season": game.season(),
        "seasonRound": game._round_in_season,
        "qi": game.qi,
        "score": game.score,
        "hand": hand,
        "deckIds": [c['id'] for c in game.deck],
        "publicIds": [c['id'] for c in game.public],
        "marginCallCount": game.margin_calls,
    }


def run_trace(payload):
    """运行固定动作 trace：与官方 run_trace 节奏一致（初始快照 → 动作 → advance → 结算抽牌回气 → 快照）。
    随机源用 Mulberry32（与 TS SeededRandomSource 对齐），保证 deck/public 序列逐步一致。"""
    seed = int(payload["seed"])
    lengths = [int(v) for v in payload.get("season_lengths", [])]
    if lengths:
        if sum(lengths) != TOTAL_ROUNDS or not all(SEASON_MIN <= v <= 12 for v in lengths):
            raise ValueError("trace season_lengths 必须 4-12 且总和为 60")
    game = Game(Mulberry32(seed), lens=lengths if lengths else None)
    # 与官方节奏对齐：先结算+抽牌+回气（相当于官方 draw_and_recover）
    game.settle(); game.draw(); game.recover()
    snapshots = [_trace_snapshot(game)]
    for action in payload["actions"]:
        kind = action["type"]
        if kind == "set_qi":
            game.qi = float(action["value"])
            continue
        if kind == "buy":
            card = game.public[int(action["cardIndex"])]
            ok = game.buy(card, bool(action.get("leverage", False)))
            game.last_action = 'buy'  # 与 TS executeBuy 一致（wait 奖励只在 wait 后生效）
        elif kind == "sell":
            ok = game.sell(int(action["slotIndex"]))
            game.last_action = 'sell'  # 与 TS executeSell 一致
        elif kind == "wait":
            game.wait()
            ok = True
        else:
            raise ValueError(f"未知 trace 动作: {kind}")
        if not ok:
            raise ValueError(f"trace 动作失败: {action}")
        game.advance()
        if game.round <= TOTAL_ROUNDS:
            game.settle(); game.draw(); game.recover()
        snapshots.append(_trace_snapshot(game))
    return {"snapshots": snapshots}


if __name__ == '__main__':
    import argparse
    _parser = argparse.ArgumentParser(description='三策略混合验证 / trace 模式')
    _parser.add_argument('--trace-stdin', action='store_true', help='从 stdin 读取固定动作 trace 并输出快照')
    _args = _parser.parse_args()
    if _args.trace_stdin:
        import json as _json
        payload = _json.load(sys.stdin)
        print(_json.dumps(run_trace(payload), ensure_ascii=False, separators=(',', ':')))
        sys.exit(0)
    print('=== 三策略混合验证（评分1.2，土牌杠杆气耗5，真实抽牌，400局） ===')
    print(f'{"策略":<26} {"均分":>8} {"σ":>6} {"爆仓/局":>7} {"有爆仓局":>7}')
    strategies = [
        ('差价流(纯操作)', 'run_trend'),
        ('持有流(同组两季)', 'run_hold'),
        ('土牌长持(纯保底)', 'run_earth_hold'),
        ('土牌杠杆×1(纯保底)', 'run_earth_lev'),
        ('混合:1土+2差价', 'run_mix_2'),
        ('混合:1土+2持有', 'run_mix_2'),
        ('混合:1土+差价+持有', 'run_mix_3'),
    ]
    results = {}
    for name, fn in strategies:
        if fn == 'run_mix_2':
            rng = random.Random(42)
            scores, mcs = [], []
            mix_type = 'trend_earth' if '差价' in name else 'hold_earth'
            for _ in range(400):
                g = Game(rng)
                scores.append(g.run_mix_2(mix_type))
                mcs.append(g.margin_calls)
            mean, sd, mc = statistics.mean(scores), statistics.stdev(scores), statistics.mean(mcs)
            mc_rate = sum(1 for x in mcs if x > 0) / len(mcs) * 100
        else:
            mean, sd, mc, mc_rate = run_all(fn)
        results[name] = mean
        print(f'{name:<26} {mean:>8.1f} {sd:>6.1f} {mc:>7.2f} {mc_rate:>6.0f}%')
    print()
    print('=== 结论 ===')
    best_single = max(results['差价流(纯操作)'], results['持有流(同组两季)'], results['土牌长持(纯保底)'])
    best_mix = max(results['混合:1土+2差价'], results['混合:1土+2持有'], results['混合:1土+差价+持有'])
    print(f'最优单一: {best_single:.1f}  最优混合: {best_mix:.1f}  混合-单一: {best_mix-best_single:+.1f}')
