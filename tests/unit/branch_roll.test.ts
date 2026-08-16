/**
 * V6 地支波动（Branch Roll）引擎测试。
 *
 * 覆盖（issue 02 验收 + 校准需求）：
 * 1. roll 确定性：同 seed 同值（createBranchRollState 与 TurnManager 构造）；
 * 2. 换季重掷：季内恒定、跨季变化；换季消耗 branchRollRandom 的抽取次数确定；
 * 3. 空亡 K 步跨季：每跨一季重掷（跨季重掷 / 未跨季不重掷）；
 * 4. 存档往返：V6 档导出/导入后 roll 状态与评分一致；V6 缺 branchRoll 拒绝；
 *    非 6 版本忽略 branchRoll 字段；
 * 5. 土牌减半生效：土牌注入 = 2.5×偏移差（=5×0.5），非土 = 3×阴阳因子×偏移差；
 * 6. V6 门控：V5 及以下不创建不消耗 branchRollRandom（路径逐字节不变）；
 * 7. V6 重放确定性：ReplayRunner 同 seed 两次重放结果一致。
 *
 * 使用真实 TurnManager（真引擎），不复刻 Python 模拟脚本（AGENTS.md 退役约束）；
 * 校准对照由独立临时脚本完成。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource, type RandomSource } from '../../src/core/RandomSource';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import {
  BRANCH_ROLL_DI_ZHI,
  BRANCH_ROLL_DELTA,
  BRANCH_ROLL_EARTH_COEF,
  BRANCH_ROLL_NON_EARTH_BASE_COEF,
  createBranchRollState,
  isValidBranchRollState,
  type BranchRollState,
} from '../../src/core/BranchRoll';
import {
  CURRENT_SCHEMA_VERSION,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_VOID,
  type GameSnapshot,
  type SupportedRulesVersion,
} from '../../src/core/GameSaveService';
import { BAND_FACTOR, type ScoreVolatilityConfig } from '../../src/core/ScoreVolatility';
import { isVoidCard } from '../../src/core/VoidCard';
import { replayGame, type ReplayAction, type ReplayRequest } from '../../src/core/ReplayRunner';
import { YinYang, Element } from '../../src/core/JiaziCard';

(globalThis as any).localStorage = new (class {
  store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
})();

const CARD_DATA = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));

/** V6 生产方式（计分 = V5：conflict_banded 波动 + 释灵 6，与 BRANCH_ROLL_REPLAY_RULES 同形）。 */
const WIRED_VOLATILITY: ScoreVolatilityConfig = {
  enabled: true,
  model: 'conflict_banded',
  scale: 4,
  minDuration: 1,
  maxDuration: 3,
  maxScoreDelta: 2,
  bandFactors: { ...BAND_FACTOR, conflict: 3 },
};

/** 计数随机源：统计 branchRollRandom 被调用次数（V5 零消耗门控用）。 */
class CountingRandomSource implements RandomSource {
  intCalls = 0;
  nextCalls = 0;
  private readonly inner = new SeededRandomSource(1234);
  next(): number { this.nextCalls++; return this.inner.next(); }
  int(min: number, maxExclusive: number): number { this.intCalls++; return this.inner.int(min, maxExclusive); }
}

async function makeTm(seed = 42, opts?: {
  rulesVersion?: SupportedRulesVersion;
  volatility?: Partial<ScoreVolatilityConfig>;
  branchRollRandom?: RandomSource;
  branchRollSeed?: number;
  voidConfig?: { voidCardCount?: number; voidKMin?: number; voidKMax?: number };
}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => CARD_DATA }));
  const options: Record<string, unknown> = {};
  if (opts?.rulesVersion !== undefined) options.rulesVersion = opts.rulesVersion;
  if (opts?.branchRollRandom) options.branchRollRandom = opts.branchRollRandom;
  else if (opts?.branchRollSeed !== undefined) options.branchRollRandom = new SeededRandomSource(opts.branchRollSeed);
  if (opts?.voidConfig) options.voidConfig = opts.voidConfig;
  if (opts?.volatility) {
    options.volatility = { enabled: true, ...opts.volatility };
    options.volatilityRandom = new SeededRandomSource((opts.branchRollSeed ?? 7) + 1);
  }
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), options as never);
  await tm.initialize();
  return tm;
}

/** 生成一份合法 V6 存档（conflict_banded 零方向波动 + scoreRules + branchRoll）。 */
function makeV6Snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const zeroDeltas = Object.fromEntries(BRANCH_ROLL_DI_ZHI.map((d) => [d, 0]));
  return {
    currentRound: 1,
    state: 'player_action',
    lastAction: null,
    qi: 60,
    score: 0,
    totalHoldEarnings: 0,
    totalSellEarnings: 0,
    totalBuys: 0,
    totalSells: 0,
    totalWaits: 0,
    totalLeverageBuys: 0,
    season: { index: 0, roundInSeason: 1, lengths: [4, 4, 4, 4] },
    hand: [null, null, null],
    pool: { deckIds: Array.from({ length: 63 }, (_, i) => i + 1), publicIds: [] },
    lockedCardIds: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION_BRANCH_ROLL,
    scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
    scoreVolatility: {
      model: 'conflict_banded',
      scale: 4,
      remainingRounds: 0,
      deltaByDiZhi: zeroDeltas,
      directionByDiZhi: Object.fromEntries(BRANCH_ROLL_DI_ZHI.map((d) => [d, 0])),
      bandFactors: { ...BAND_FACTOR, conflict: 3 },
    },
    branchRoll: createBranchRollState(new SeededRandomSource(99), 0),
    ...overrides,
  };
}

/** 把一张空亡牌放到牌堆顶，保证下一回合必触发。 */
function forceVoidOnTop(tm: TurnManager): void {
  const pool = (tm as any).cardPoolManager;
  const deck = pool.getDeck();
  const jiazi = deck.filter((c: unknown) => !isVoidCard(c as never));
  const voids = deck.filter((c: unknown) => isVoidCard(c as never));
  deck.length = 0;
  deck.push(voids[0], ...jiazi, ...voids.slice(1));
}

/** 等待直到换季（最多 guard 次等待），返回是否已换季。 */
function waitUntilSeasonChange(tm: TurnManager, guard = 15): boolean {
  const s0 = tm.getCurrentSeason();
  for (let i = 0; i < guard; i++) {
    if (tm.getState() !== 'player_action') break;
    tm.executeWait();
    if (tm.getCurrentSeason() !== s0) return true;
  }
  return tm.getCurrentSeason() !== s0;
}

describe('BranchRollState 生成（createBranchRollState）', () => {
  it('同 seed 同值：12 地支 raw 偏移 + 四季均值确定', () => {
    const a1 = createBranchRollState(new SeededRandomSource(123), 0);
    const a2 = createBranchRollState(new SeededRandomSource(123), 0);
    expect(a1).toEqual(a2);
    expect(Object.keys(a1.rollByDiZhi)).toHaveLength(12);
    expect(Object.keys(a1.meanByDiZhi)).toHaveLength(12);
    const b = createBranchRollState(new SeededRandomSource(456), 0);
    expect(a1).not.toEqual(b);
  });

  it('raw 偏移在 ±2 内（δ=2，连续均匀 [-2,2]），均值也在 ±2 内', () => {
    const state = createBranchRollState(new SeededRandomSource(7), 0);
    for (const dz of BRANCH_ROLL_DI_ZHI) {
      expect(state.rollByDiZhi[dz]).toBeGreaterThanOrEqual(-BRANCH_ROLL_DELTA);
      expect(state.rollByDiZhi[dz]).toBeLessThanOrEqual(BRANCH_ROLL_DELTA);
      expect(state.meanByDiZhi[dz]).toBeGreaterThanOrEqual(-BRANCH_ROLL_DELTA);
      expect(state.meanByDiZhi[dz]).toBeLessThanOrEqual(BRANCH_ROLL_DELTA);
    }
  });

  it('季节坐标 = seasonIndex % 4：同年内同季索引（0 与 4）产出相同状态', () => {
    const spring = createBranchRollState(new SeededRandomSource(123), 0);
    const springAgain = createBranchRollState(new SeededRandomSource(123), 4);
    expect(spring).toEqual(springAgain);
  });

  it('isValidBranchRollState：合法快照通过；缺字段/错误版本/非法值拒绝', () => {
    const good = createBranchRollState(new SeededRandomSource(7), 0);
    expect(isValidBranchRollState(good)).toBe(true);
    expect(isValidBranchRollState({ ...good, rulesVersion: 5 })).toBe(false);
    expect(isValidBranchRollState({ ...good, meanByDiZhi: undefined })).toBe(false);
    expect(isValidBranchRollState({ ...good, rollByDiZhi: { ...good.rollByDiZhi, 子: 'x' } })).toBe(false);
    expect(isValidBranchRollState(null)).toBe(false);
    expect(isValidBranchRollState(42)).toBe(false);
  });
});

describe('V6 引擎 roll 确定性（同 seed 同值）', () => {
  it('同 seed 构造：roll 状态与全部卡牌评分一致', async () => {
    const tm1 = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    const tm2 = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    expect(tm1.getBranchRollState()).toEqual(tm2.getBranchRollState());
    expect(tm1.getBranchRollState()).not.toBeNull();
    const season = tm1.getCurrentSeason();
    for (let id = 1; id <= 60; id++) {
      const card = tm1.getCardById(id)!;
      expect(tm1.getCardScore(card, season)).toBe(tm2.getCardScore(card, season));
    }
  });

  it('不同 seed 构造：roll 状态不同', async () => {
    const tm1 = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    const tm2 = await makeTm(42, { rulesVersion: 6, branchRollSeed: 8 });
    expect(tm1.getBranchRollState()).not.toEqual(tm2.getBranchRollState());
  });
});

describe('V6 换季重掷（季内恒定、跨季变化）', () => {
  it('季内恒定：无波动接线时评分与 roll 状态跨回合不变', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    tm.startGame();
    const season = tm.getCurrentSeason();
    const state0 = tm.getBranchRollState()!;
    // 固定卡牌对象：等待会重抽公共牌，评分对比必须用同一批卡
    const cards = tm.getPublicCards();
    const before = cards.map((c) => tm.getCardScore(c, season));
    // 连续等待（仍在本季）：评分与 roll 状态逐字节不变
    expect(tm.executeWait()).toBe(true);
    expect(tm.getCurrentSeason()).toBe(season);
    expect(tm.getBranchRollState()).toEqual(state0);
    expect(cards.map((c) => tm.getCardScore(c, season))).toEqual(before);
  });

  it('换季重掷：跨季后 roll 状态变化', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    tm.startGame();
    const state0 = tm.getBranchRollState()!;
    expect(waitUntilSeasonChange(tm)).toBe(true);
    const state1 = tm.getBranchRollState()!;
    expect(state1).not.toEqual(state0);
  });

  it('换季消耗 branchRollRandom：构造 48 次 next()（12 地支 × 4 季节坐标，与 Python 基线抽取结构一致）、换季再 48 次', async () => {
    const counter = new CountingRandomSource();
    const tm = await makeTm(42, {
      rulesVersion: 6,
      branchRollRandom: counter,
      voidConfig: { voidCardCount: 0 }, // 关空亡，避免吞噬跨季引入额外重掷
    });
    // 连续口径：mean_u 需该地支 4 个季节坐标偏移（与 Python `[uniform(-δ,δ) for _ in range(4)]` 同结构），
    // 故每季 12 地支 × 4 = 48 次 next()；不走 int()。
    expect(counter.nextCalls).toBe(12 * 4);
    expect(counter.intCalls).toBe(0);
    tm.startGame();
    expect(waitUntilSeasonChange(tm)).toBe(true);
    expect(counter.nextCalls).toBe(12 * 4 * 2); // 换季重掷：再 48 次
  });
});

describe('V6 空亡跨季重掷', () => {
  it('空亡 K 步跨季：每跨一季重掷（跨季 → 状态变为按当前季坐标重掷）', async () => {
    // branchRollRandom 流推演：构造（index 0）→ 空亡跨季后（index 1）
    const rollRng = new SeededRandomSource(7);
    createBranchRollState(rollRng, 0); // = 构造首季
    const imported = createBranchRollState(new SeededRandomSource(99), 0);

    const tm = await makeTm(42, {
      rulesVersion: 6,
      branchRollRandom: new SeededRandomSource(7),
      voidConfig: { voidKMin: 1, voidKMax: 1 },
    });
    // 季末快照（roundInSeason=4 == length）：K≥1 必跨季
    tm.importSnapshot(makeV6Snapshot({ season: { index: 0, roundInSeason: 4, lengths: [4, 4, 4, 4] }, branchRoll: imported }));
    forceVoidOnTop(tm);
    tm.startGame();

    expect(tm.getCurrentSeason()).toBe('summer'); // 第 1 回合被空亡吞噬，跨到夏
    const expected = createBranchRollState(rollRng, 1); // 跨季后重掷（index 1）
    expect(tm.getBranchRollState()).toEqual(expected);
    expect(tm.getBranchRollState()).not.toEqual(imported);
  });

  it('空亡未跨季：不重掷，状态保持导入值', async () => {
    const imported = createBranchRollState(new SeededRandomSource(99), 0);
    const tm = await makeTm(42, {
      rulesVersion: 6,
      branchRollRandom: new SeededRandomSource(7),
      voidConfig: { voidKMin: 1, voidKMax: 1 },
    });
    // 季中快照（roundInSeason=2，length=4）：K=1 不跨季
    tm.importSnapshot(makeV6Snapshot({ season: { index: 0, roundInSeason: 2, lengths: [4, 4, 4, 4] }, branchRoll: imported }));
    forceVoidOnTop(tm);
    tm.startGame();

    expect(tm.getCurrentSeason()).toBe('spring');
    expect(tm.getBranchRollState()).toEqual(imported);
  });
});

describe('V6 存档往返', () => {
  it('V6 生产方式（wired conflict_banded）：导出 → 导入后 roll 状态与评分一致', async () => {
    const tm1 = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7, volatility: WIRED_VOLATILITY });
    tm1.startGame();
    expect(tm1.executeBuy(0, false)).toBe(true);
    expect(tm1.executeWait()).toBe(true);

    const snapshot = tm1.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);
    expect(snapshot.branchRoll).toEqual(tm1.getBranchRollState());
    expect(snapshot.scoreRules).toEqual({ holdBonus: 1.2, sellMultiplier: 6 });

    const tm2 = await makeTm(99, { rulesVersion: 6, branchRollSeed: 11, volatility: WIRED_VOLATILITY });
    tm2.importSnapshot(snapshot);
    expect(tm2.exportSnapshot().rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);
    expect(tm2.getBranchRollState()).toEqual(tm1.getBranchRollState());
    const season = tm1.getCurrentSeason();
    for (const card of tm1.getPublicCards()) {
      expect(tm2.getCardScore(card, season)).toBe(tm1.getCardScore(card, season));
    }
  });

  it('V6 存档缺 branchRoll：拒绝读档（版本门控）', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7, volatility: WIRED_VOLATILITY });
    tm.startGame();
    const snapshot = tm.exportSnapshot();
    delete (snapshot as any).branchRoll;
    expect(() => tm.importSnapshot(snapshot)).toThrowError(/branchRoll/);
  });

  it('V6 存档 branchRoll 非法（错误版本声明）：拒绝读档', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7, volatility: WIRED_VOLATILITY });
    tm.startGame();
    const snapshot = tm.exportSnapshot();
    (snapshot.branchRoll as any).rulesVersion = 5;
    expect(() => tm.importSnapshot(snapshot)).toThrowError(/branchRoll/);
  });

  it('非 6 版本读档忽略 branchRoll 字段：不还原、再导出不携带', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7, volatility: WIRED_VOLATILITY });
    tm.startGame();
    const v6 = tm.exportSnapshot();

    const base = await makeTm(99); // base 构造
    const v5Snapshot = makeV6Snapshot({ rulesVersion: RULES_VERSION_VOID, branchRoll: v6.branchRoll }) as GameSnapshot;
    base.importSnapshot(v5Snapshot);
    expect(base.getBranchRollState()).toBeNull();
    expect(base.exportSnapshot().branchRoll).toBeUndefined();
  });

  it('V6 只读 roll 状态不随读档注入外部状态：导入快照即还原、换季仍按自声明版本重掷', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    const imported = createBranchRollState(new SeededRandomSource(123), 0);
    tm.importSnapshot(makeV6Snapshot({ branchRoll: imported }));
    expect(tm.getBranchRollState()).toEqual(imported);
    // 换季重掷仍走 branchRollRandom（构造 seed 7 已推进 48 次 → 第二次生成 = index 1）
    const rollRng = new SeededRandomSource(7);
    createBranchRollState(rollRng, 0); // 构造
    const expected = createBranchRollState(rollRng, 1); // 换季
    expect(waitUntilSeasonChange(tm)).toBe(true);
    expect(tm.getBranchRollState()).toEqual(expected);
  });
});

describe('V6 土牌减半生效', () => {
  it('土牌注入 = 2.5×偏移差（=5×0.5 减半）；非土 = 3×阴阳因子×偏移差', async () => {
    expect(BRANCH_ROLL_EARTH_COEF).toBe(5 * 0.5);
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    tm.startGame();
    const season = tm.getCurrentSeason();
    const state = tm.getBranchRollState()!;
    // 找一个偏移差非 0 的地支
    const entry = Object.entries(state.rollByDiZhi).find(
      ([dz, u]) => u - state.meanByDiZhi[dz] !== 0,
    )!;
    const dz = entry[0];
    const shift = entry[1] - state.meanByDiZhi[dz];

    // 同地支取一张土牌（戊X）与一张非土牌（同阴阳）
    const earthCard = tm.getCardById(CARD_DATA.find((c: { diZhi: string; tianGanElement: string }) =>
      c.diZhi === dz && c.tianGanElement === 'earth')!.id)!;
    const nonEarthCard = tm.getCardById(CARD_DATA.find((c: { diZhi: string; tianGanElement: string }) =>
      c.diZhi === dz && c.tianGanElement !== 'earth')!.id)!;

    // 土牌：系数 = 2.5
    expect(tm.getCardScore(earthCard, season)).toBe(Math.round(
      earthCard.getSeasonScorePreRound(season, DEFAULT_BALANCE_CONFIG) + BRANCH_ROLL_EARTH_COEF * shift,
    ));
    // 非土：系数 = 3 × 阴阳因子
    const f = nonEarthCard.yinYang === YinYang.YANG
      ? DEFAULT_BALANCE_CONFIG.yangPolarityFactor
      : DEFAULT_BALANCE_CONFIG.yinPolarityFactor;
    expect(tm.getCardScore(nonEarthCard, season)).toBe(Math.round(
      nonEarthCard.getSeasonScorePreRound(season, DEFAULT_BALANCE_CONFIG)
      + BRANCH_ROLL_NON_EARTH_BASE_COEF * f * shift,
    ));
    // 同偏移差下土牌注入幅度 < 非土（yang）注入幅度
    expect(Math.abs(BRANCH_ROLL_EARTH_COEF * shift))
      .toBeLessThan(Math.abs(BRANCH_ROLL_NON_EARTH_BASE_COEF * 1.1 * shift));
  });

  it('土牌与同地支非土牌共享同一偏移差（同地支族整体移动）', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7 });
    tm.startGame();
    const state = tm.getBranchRollState()!;
    const dz = BRANCH_ROLL_DI_ZHI[0];
    const cards = CARD_DATA.filter((c: { diZhi: string }) => c.diZhi === dz);
    expect(cards.length).toBe(5);
    for (const c of cards) {
      const card = tm.getCardById(c.id)!;
      const shift = state.rollByDiZhi[dz] - state.meanByDiZhi[dz];
      const coef = c.tianGanElement === 'earth'
        ? BRANCH_ROLL_EARTH_COEF
        : BRANCH_ROLL_NON_EARTH_BASE_COEF * (card.yinYang === YinYang.YANG ? 1.1 : 0.9);
      expect(tm.getCardScore(card, tm.getCurrentSeason())).toBe(Math.round(
        card.getSeasonScorePreRound(tm.getCurrentSeason(), DEFAULT_BALANCE_CONFIG) + coef * shift,
      ));
    }
  });
});

describe('V6 门控（V5 及以下零消耗）', () => {
  it('V5 路径：不创建、不消耗 branchRollRandom，换季前评分 = 基础分', async () => {
    const counter = new CountingRandomSource();
    const tm = await makeTm(42, { rulesVersion: RULES_VERSION_VOID, branchRollRandom: counter });
    expect(tm.getBranchRollState()).toBeNull();
    expect(counter.intCalls + counter.nextCalls).toBe(0);
    tm.startGame();
    // 换季前：V5 未接线波动（构造无 volatility 开关），评分 = 基础分（逐字节不变）
    const season = tm.getCurrentSeason();
    for (const card of tm.getPublicCards()) {
      expect(tm.getCardScore(card, season)).toBe(card.getSeasonScore(season, DEFAULT_BALANCE_CONFIG));
    }
    // 换季也不消耗 branchRollRandom（V5 路径零消耗）
    waitUntilSeasonChange(tm);
    expect(counter.intCalls + counter.nextCalls).toBe(0);
    expect(tm.getBranchRollState()).toBeNull();
  });

  it('base（V1）路径：branchRollRandom 回退主随机源也不消耗', async () => {
    const counter = new CountingRandomSource();
    const tm = await makeTm(42, { branchRollRandom: counter });
    tm.startGame();
    tm.executeWait();
    expect(counter.intCalls + counter.nextCalls).toBe(0);
    expect(tm.getBranchRollState()).toBeNull();
  });
});

describe('V6 重放确定性（ReplayRunner 透传 branchRollRandom）', () => {
  it('同 seed 两次 replayGame 结果一致（含空亡/换季路径）', async () => {
    const tm = await makeTm(42, { rulesVersion: 6, branchRollSeed: 7, volatility: WIRED_VOLATILITY });
    tm.startGame();
    const actions: ReplayAction[] = [];
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 200) {
      expect(tm.executeWait()).toBe(true);
      actions.push({ type: 'wait' });
      guard++;
    }
    expect(tm.getState()).toBe('game_over');
    expect(actions.length).toBeGreaterThan(0);

    const request: ReplayRequest = {
      seed: 42,
      actions,
      rulesVersion: RULES_VERSION_BRANCH_ROLL,
      volatility: WIRED_VOLATILITY,
      scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
    };
    const result1 = await replayGame(request);
    const result2 = await replayGame(request);
    expect(result1).toEqual(result2);
    expect(result1.rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);
  });
});

describe('V6 审核补充（reviewer P2-1/P2-2/P2-5，2026-08-16）', () => {
  // P2-1：键集合必须精确等于 12 地支（缺失/多余均拒绝——引擎导出恒为全键，无合法残缺来源）
  it('isValidBranchRollState：rollByDiZhi 缺 1 键或含多余键 → 拒绝；meanByDiZhi 同理', () => {
    const good = createBranchRollState(new SeededRandomSource(1), 0);
    expect(isValidBranchRollState(good)).toBe(true);

    const missingRoll = structuredClone(good);
    delete missingRoll.rollByDiZhi['子'];
    expect(isValidBranchRollState(missingRoll)).toBe(false);

    const extraRoll = structuredClone(good);
    extraRoll.rollByDiZhi['额外'] = 0;
    expect(isValidBranchRollState(extraRoll)).toBe(false);

    const missingMean = structuredClone(good);
    delete missingMean.meanByDiZhi['亥'];
    expect(isValidBranchRollState(missingMean)).toBe(false);
  });

  // P2-2：冻结快照契约——V6 的 branchRoll 参数必须与引擎常量一致（引擎不读快照参数）
  it('cloneReplayRulesSnapshot：V6 快照 delta≠BRANCH_ROLL_DELTA 或 enabled≠true → 抛错；合法快照正常克隆', async () => {
    const { BRANCH_ROLL_REPLAY_RULES, cloneReplayRulesSnapshot } = await import('../../src/core/ReplayRules');
    const cloned = cloneReplayRulesSnapshot(BRANCH_ROLL_REPLAY_RULES);
    expect(cloned.rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);

    const badDelta = structuredClone(BRANCH_ROLL_REPLAY_RULES);
    badDelta.branchRoll = { ...badDelta.branchRoll, delta: BRANCH_ROLL_DELTA + 1 };
    expect(() => cloneReplayRulesSnapshot(badDelta)).toThrow(/branch_roll_rules_mismatch/);

    const badEnabled = structuredClone(BRANCH_ROLL_REPLAY_RULES);
    badEnabled.branchRoll = { ...badEnabled.branchRoll, enabled: false };
    expect(() => cloneReplayRulesSnapshot(badEnabled)).toThrow(/branch_roll_rules_mismatch/);
  });

  // P2-5①：空亡 K 步连跨两季——逐跨重掷，roll 按最终季坐标（index%4）取偏移
  it('空亡 K=8 从春末连跨两季（春→夏→秋）：重掷两次，最终状态 = 按秋坐标（index 2）重掷', async () => {
    // branchRollRandom 流推演：构造（index 0，48 次）→ 跨季 1（48 次）→ 跨季 2（48 次，即最终状态）
    const rollRng = new SeededRandomSource(7);
    createBranchRollState(rollRng, 0); // = 构造首季
    createBranchRollState(rollRng, 1); // = 跨季 1 重掷（春→夏）
    const expected = createBranchRollState(rollRng, 2); // = 跨季 2 重掷（夏→秋）→ 最终状态

    const tm = await makeTm(42, {
      rulesVersion: 6,
      branchRollRandom: new SeededRandomSource(7),
      voidConfig: { voidKMin: 8, voidKMax: 8 },
    });
    // 季末快照（roundInSeason=4 == length）：K=8 步 advance——步 1 跨春→夏、步 5 跨夏→秋（lengths 全 4）
    tm.importSnapshot(makeV6Snapshot({ season: { index: 0, roundInSeason: 4, lengths: [4, 4, 4, 4] } }));
    forceVoidOnTop(tm);
    tm.startGame();

    expect(tm.getCurrentSeason()).toBe('autumn');
    expect(tm.getBranchRollState()).toEqual(expected);
  });

  // P2-5②：第 60 回合终局不推进季节循环（advanceTurn 提前返回），roll 状态不重掷
  it('第 60 回合终局：季节循环不再推进，roll 状态保持、branchRollRandom 零新增消耗', async () => {
    const counter = new CountingRandomSource();
    const tm = await makeTm(42, {
      rulesVersion: 6,
      branchRollRandom: counter,
      voidConfig: { voidCardCount: 0 },
    });
    const baseline = counter.nextCalls; // 构造首季消耗（48 次）
    const state0 = createBranchRollState(new SeededRandomSource(99), 0);
    // 第 60 回合 + 季末快照：若终局误推进季节，会触发重掷（牌堆与 voidCardCount:0 一致 = 60 张）
    tm.importSnapshot(makeV6Snapshot({
      currentRound: 60,
      season: { index: 0, roundInSeason: 4, lengths: [4, 4, 4, 4] },
      branchRoll: state0,
      pool: { deckIds: Array.from({ length: 60 }, (_, i) => i + 1), publicIds: [] },
    }));
    tm.startGame();
    expect(tm.executeWait()).toBe(true);
    expect(tm.getState()).toBe('game_over');
    expect(counter.nextCalls).toBe(baseline); // 终局无重掷消耗
    expect(tm.getBranchRollState()).toEqual(state0); // 状态保持导入值
  });
});
