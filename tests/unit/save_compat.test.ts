/**
 * 存档版本兼容测试。
 *
 * 游戏已上线，老玩家浏览器中存着旧版本存档。新代码读取旧档时，
 * importSnapshot 有兼容逻辑：缺 lockedQi/useLeverage 时回退计算、
 * 缺 lockedCardIds 时置空。这些回退路径此前无测试——一旦破坏，
 * 老玩家更新后读档会崩溃（发布崩溃风险）。
 */
import { describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import {
  GameSaveService,
  CURRENT_SCHEMA_VERSION,
  RULES_BASE,
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_TRADE,
  RULES_VERSION_VOLATILE,
} from '../../src/core/GameSaveService';
import { BAND_FACTOR } from '../../src/core/ScoreVolatility';
import { createBranchRollState } from '../../src/core/BranchRoll';
import { TREND_WINDOW_REPLAY_RULES, CLEAN_POOL_REPLAY_RULES } from '../../src/core/ReplayRules';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameSnapshot } from '../../src/core/GameSaveService';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

async function makeTm(seed = 42) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed));
  await tm.initialize();
  return tm;
}

/** 生成一份合法存档：第 5 回合、持有 1 张牌、气 60 */
function makeValidSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    currentRound: 5,
    state: 'player_action',
    lastAction: 'buy',
    qi: 60,
    score: 120,
    totalHoldEarnings: 10,
    totalSellEarnings: 110,
    totalBuys: 1,
    totalSells: 0,
    totalWaits: 0,
    totalLeverageBuys: 0,
    season: { index: 0, roundInSeason: 5, lengths: [12, 12, 12, 12] },
    hand: [{
      cardId: 1,
      buyScore: 10,
      useLeverage: false,
      leverage: 1,
      buyRound: 1,
      lockedQi: 10,
      holdEarnings: 5,
    }, null, null],
    pool: { deckIds: [2, 3, 4], publicIds: [5, 6, 7] },
    lockedCardIds: [],
    ...overrides,
  };
}

/** 构造 volatility 开启的 TurnManager（显式实验模式）：验证"存档声明优先"门控。 */
async function makeVolatileTm(seed = 42, volSeed = 7) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    volatility: { enabled: true },
    volatilityRandom: new SeededRandomSource(volSeed),
  });
  await tm.initialize();
  return tm;
}

/** 构造 v3 交易实验局：用于验证读旧档时不会继承当前构造函数的卖出倍率。 */
async function makeTradeTm(seed = 42, volSeed = 7) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_TRADE,
    scoreRules: { holdBonus: 1.2, sellMultiplier: 14 },
    volatility: {
      enabled: true,
      model: 'conflict_banded',
      scale: 4,
      bandFactors: { ...BAND_FACTOR, conflict: 6 },
    },
    volatilityRandom: new SeededRandomSource(volSeed),
  });
  await tm.initialize();
  return tm;
}

/** 构造 V6 生产方式实验局（V4 计分 + 空亡 + 地支波动）：用于验证 V6 存档协议。 */
async function makeBranchRollTm(seed = 42, rollSeed = 7) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_BRANCH_ROLL,
    scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
    volatility: {
      enabled: true,
      model: 'conflict_banded',
      scale: 4,
      bandFactors: { ...BAND_FACTOR, conflict: 3 },
    },
    volatilityRandom: new SeededRandomSource(seed + 1),
    branchRollRandom: new SeededRandomSource(rollSeed),
  });
  await tm.initialize();
  return tm;
}

/** 构造 V7 趋势窗口实验局：用于验证 V7 存档协议。 */
async function makeTrendWindowTm(seed = 42) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_TREND_WINDOW,
    scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
    volatility: TREND_WINDOW_REPLAY_RULES.volatility,
    voidConfig: { voidCardCount: 3 },
  });
  await tm.initialize();
  return tm;
}

/** 构造 V8 洁净牌池生产规则局：用于验证 V8 存档协议。 */
async function makeCleanPoolTm(seed = 42) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_CLEAN_POOL,
    scoreRules: CLEAN_POOL_REPLAY_RULES.scoreRules,
    volatility: CLEAN_POOL_REPLAY_RULES.volatility,
    voidConfig: { voidCardCount: 3 },
  });
  await tm.initialize();
  return tm;
}

describe('存档版本兼容（旧档 → 新代码）', () => {
  it('完整新版存档：正常还原不报错', async () => {
    const tm = await makeTm();
    expect(() => tm.importSnapshot(makeValidSnapshot())).not.toThrow();
    expect(tm.getCurrentRound()).toBe(5);
    expect(tm.getQi()).toBe(60);
    expect(tm.getScore()).toBe(120);
    expect(tm.getHand().filter(Boolean)).toHaveLength(1);
  });

  it('旧档缺 lockedQi：回退为 buyCost - entryFee，不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    const slot = oldSave.hand[0] as any;
    delete slot.lockedQi; // 模拟旧版存档没有该字段

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    const restored = tm.getHand()[0];
    expect(restored).not.toBeNull();
    // 回退值 = max(0, buyCost(10, 无杠杆) - entryFee(2))，buyCost = ceil(11*(1+0.005*10)) = ceil(11.55) = 12 → 10
    expect(restored!.lockedQi).toBe(10);
  });

  it('旧档缺 useLeverage：按 leverage > 1 回退判断', async () => {
    const tm = await makeTm();
    // 场景 A：leverage=1 → 回退为 false（未启用杠杆）
    const plainOld = makeValidSnapshot();
    const slotA = plainOld.hand[0] as any;
    delete slotA.useLeverage;
    slotA.leverage = 1;
    tm.importSnapshot(plainOld);
    expect(tm.getHand()[0]!.useLeverage).toBe(false);

    // 场景 B：leverage=2.5 → 回退为 true（启用杠杆）
    const leverageOld = makeValidSnapshot();
    const slotB = leverageOld.hand[0] as any;
    delete slotB.useLeverage;
    slotB.leverage = 2.5;
    tm.importSnapshot(leverageOld);
    expect(tm.getHand()[0]!.useLeverage).toBe(true);
  });

  it('旧档缺 lockedCardIds：置空不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).lockedCardIds;

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getLockedCardIds()).toEqual([]);
  });

  it('旧档缺 totalBuys 等统计字段：回退为 0 不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).totalBuys;
    delete (oldSave as any).totalSells;
    delete (oldSave as any).totalWaits;
    delete (oldSave as any).totalLeverageBuys;

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getTotalBuys()).toBe(0);
    expect(tm.getTotalSells()).toBe(0);
  });

  it('旧档手牌含 null 槽位：安全跳过', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    oldSave.hand = [null, null, null]; // 空手牌存档

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getHand()).toHaveLength(3);
    expect(tm.getHand().filter(Boolean)).toHaveLength(0);
  });

  it('坏档（卡牌 ID 不存在）：importSnapshot 抛错（由 GameSaveService 捕获）', async () => {
    const tm = await makeTm();
    const badSave = makeValidSnapshot();
    (badSave.hand[0] as any).cardId = 9999; // 不存在的卡

    expect(() => tm.importSnapshot(badSave)).toThrow();
  });

  it('新档含 totalMarginCallPenalty：还原保留；老档缺该字段：回退 0', async () => {
    // 新档：含反噬罚分累计
    const tm1 = await makeTm();
    tm1.importSnapshot(makeValidSnapshot({ totalMarginCallPenalty: 42 }));
    expect(tm1.getTotalMarginCallPenalty()).toBe(42);

    // 老档：无该字段（模拟旧版本存档）
    const tm2 = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).totalMarginCallPenalty;
    tm2.importSnapshot(oldSave);
    expect(tm2.getTotalMarginCallPenalty()).toBe(0);
  });
});

describe('规则版本化存档（schemaVersion / rulesVersion）', () => {
  it('旧档（无版本字段）：按 base 规则导入，score / buyScore 事实不变，不启用波动', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getScore()).toBe(120);
    expect(tm.getHand()[0]!.buyScore).toBe(10);
    expect(tm.getHand()[0]!.holdEarnings).toBe(5);
    // 缺 rulesVersion → 显式归属 base 规则：波动状态不还原
    expect(tm.getScoreVolatilityState()).toBeNull();
  });

  it('旧档继续游戏后再次保存：写时归属，自声明 schemaVersion / rulesVersion = base', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;
    tm.importSnapshot(oldSave);

    const re = tm.exportSnapshot();
    expect(re.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(re.rulesVersion).toBe(RULES_BASE);
  });

  it('新档（带 schemaVersion / rulesVersion=1）：完整还原', async () => {
    const tm = await makeTm();
    tm.importSnapshot(makeValidSnapshot({ schemaVersion: 1, rulesVersion: 1 }));
    expect(tm.getCurrentRound()).toBe(5);
    expect(tm.getScore()).toBe(120);
    expect(tm.getHand().filter(Boolean)).toHaveLength(1);
    expect(tm.getScoreVolatilityState()).toBeNull();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_BASE);
  });

  it('构造时 volatility enabled，旧档（无 rulesVersion）仍按 base 导入：不继承构造期随机波动', async () => {
    const tm = await makeVolatileTm();
    // 构造期已创建了波动状态（volatility enabled），读旧档必须被覆盖为 null
    expect(tm.getScoreVolatilityState()).not.toBeNull();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;

    tm.importSnapshot(oldSave);
    expect(tm.getScoreVolatilityState()).toBeNull();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_BASE);
  });

  it('构造时 volatility enabled + 旧档无 rulesVersion：换季也不自动重新启用波动', async () => {
    const tm = await makeVolatileTm();
    // 存档放在季末（roundInSeason=12）：下一步行动必然换季 → refreshScoreVolatility 被 rulesVersion 门挡掉
    const oldSave = makeValidSnapshot({ season: { index: 0, roundInSeason: 12, lengths: [12, 12, 12, 12] } });
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;
    tm.importSnapshot(oldSave);
    expect(tm.getScoreVolatilityState()).toBeNull();

    tm.executeWait(); // 换季
    expect(tm.getCurrentSeason()).not.toBe('spring');
    expect(tm.getScoreVolatilityState()).toBeNull();
    // 换季后 getCardScore 不叠加任何波动偏移
    const card = tm.getPublicCards()[0];
    expect(tm.getCardScore(card, tm.getCurrentSeason()))
      .toBe(card.getSeasonScore(tm.getCurrentSeason(), (tm as any).balanceConfig));
  });

  it('构造时 volatility enabled + 旧档无 rulesVersion：季内倒计时刷新（不换季）也不重新启用波动', async () => {
    const tm = await makeVolatileTm();
    // 存档放季中（roundInSeason=10）：连续等待不跨季，走 advanceTurn 的"倒计时递减"分支
    const oldSave = makeValidSnapshot({ season: { index: 0, roundInSeason: 10, lengths: [12, 12, 12, 12] } });
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;
    tm.importSnapshot(oldSave);
    expect(tm.getScoreVolatilityState()).toBeNull();

    // 连续两个等待（仍在春季）：倒计时分支因状态为 null 而整体跳过，波动保持关闭
    tm.executeWait();
    tm.executeWait();
    expect(tm.getCurrentSeason()).toBe('spring');
    expect(tm.getScoreVolatilityState()).toBeNull();
    // 季内 getCardScore 也不叠加任何波动偏移
    const card = tm.getPublicCards()[0];
    expect(tm.getCardScore(card, tm.getCurrentSeason()))
      .toBe(card.getSeasonScore(tm.getCurrentSeason(), (tm as any).balanceConfig));
  });

  it('reset 是"开新局"：读旧档（base）后 reset，规则回到构造默认，不继承旧档声明', async () => {
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).schemaVersion;
    delete (oldSave as any).rulesVersion;

    // 实验构造（volatility enabled）：reset 后新局按构造默认开波动规则
    const tm = await makeVolatileTm();
    tm.importSnapshot(oldSave);
    expect(tm.getScoreVolatilityState()).toBeNull();
    tm.reset();
    expect(tm.getScoreVolatilityState()).not.toBeNull();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOLATILE);

    // 产品构造（base）：reset 后新局仍是 base 规则
    const productTm = await makeTm();
    productTm.importSnapshot(oldSave);
    productTm.reset();
    expect(productTm.getScoreVolatilityState()).toBeNull();
    expect(productTm.exportSnapshot().rulesVersion).toBe(RULES_BASE);
  });

  it('旧档含 scoreVolatility 数据但无 rulesVersion：波动不还原（base 规则）', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).rulesVersion;
    oldSave.scoreVolatility = { remainingRounds: 2, deltaByDiZhi: { 子: 1, 丑: -1 } };

    tm.importSnapshot(oldSave);
    expect(tm.getScoreVolatilityState()).toBeNull();
    // 再次保存：该档自声明 base 规则，scoreVolatility 数据不再随档保留
    const re = tm.exportSnapshot();
    expect(re.rulesVersion).toBe(RULES_BASE);
    expect(re.scoreVolatility).toBeUndefined();
  });

  it('夹具档声明 rulesVersion=2 且含 scoreVolatility：波动状态还原（构造函数开关不覆盖读档声明）', async () => {
    // 用"未开启波动"的构造（base 默认）读 volatile 档：还原门控只看存档声明
    const tm = await makeTm();
    const fixture = makeValidSnapshot({
      schemaVersion: 1,
      rulesVersion: RULES_VERSION_VOLATILE,
      scoreVolatility: { remainingRounds: 3, deltaByDiZhi: { 子: 2, 丑: -2, 寅: 1 } },
    });

    tm.importSnapshot(fixture);
    const restored = tm.getScoreVolatilityState();
    expect(restored).not.toBeNull();
    expect(restored!.remainingRounds).toBe(3);
    expect(restored!.deltaByDiZhi).toEqual({ 子: 2, 丑: -2, 寅: 1 });
    // 再次保存：写时归属该档自声明的 volatile 规则
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOLATILE);
  });

  it('v3 构造读取 v2 旧波动档：恢复旧卖出倍率 4，且不写入 v3 scoreRules', async () => {
    const tm = await makeTradeTm();
    const fixture = makeValidSnapshot({
      schemaVersion: 1,
      rulesVersion: RULES_VERSION_VOLATILE,
      scoreVolatility: { remainingRounds: 3, deltaByDiZhi: {} },
      hand: [{
        cardId: 1,
        buyScore: -1000,
        useLeverage: false,
        leverage: 1,
        buyRound: 1,
        lockedQi: 10,
        holdEarnings: 5,
      }, null, null],
    });

    tm.importSnapshot(fixture);
    const slot = tm.getHand()[0]!;
    const currentScore = tm.getCardScore(slot.card, tm.getCurrentSeason());
    expect(tm.previewSellScore(slot)).toBe((currentScore - slot.buyScore) * 4);
    expect(tm.exportSnapshot().scoreRules).toBeUndefined();
  });

  it('base 构造可读取 V4 存档，并保持 V4 波动与计分参数', async () => {
    const tm = await makeTm();
    const fixture = makeValidSnapshot({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rulesVersion: RULES_VERSION_BALANCED_TRADE,
      scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
      scoreVolatility: {
        remainingRounds: 2,
        deltaByDiZhi: { 子: 6 },
        model: 'conflict_banded',
        scale: 4,
        directionByDiZhi: { 子: 0.5 },
        bandFactors: { ...BAND_FACTOR, conflict: 3 },
      },
    });

    expect(() => tm.importSnapshot(fixture)).not.toThrow();
    expect(tm.exportSnapshot()).toMatchObject({
      rulesVersion: RULES_VERSION_BALANCED_TRADE,
      scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
      scoreVolatility: {
        model: 'conflict_banded',
        scale: 4,
        bandFactors: { ...BAND_FACTOR, conflict: 3 },
      },
    });
  });
});

describe('GameSaveService 坏档防护（load 路径）', () => {
  it('qi 为 NaN / 缺失：拒绝并清理存档，失败原因 invalid_or_import_failed', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    // 用 GameSaveService 的 load 直接测（注入内存 storage）
    const svc = new GameSaveService(storage as any);

    store['jiazi_game_save'] = JSON.stringify({ currentRound: 3, qi: 'not-a-number' });
    const ok = svc.load(() => {});
    expect(ok).toBe(false);
    expect(store['jiazi_game_save']).toBeUndefined(); // 坏档已清理
    expect(svc.getLastLoadError()).toBe('invalid_or_import_failed');
  });

  it('JSON 损坏：load 捕获异常返回 false 不崩溃，失败原因 invalid_or_import_failed', () => {
    const store: Record<string, string> = { 'jiazi_game_save': '{broken json' };
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: () => {},
      removeItem: (k: string) => { delete store[k]; },
    };
    const svc = new GameSaveService(storage as any);
    expect(() => svc.load(() => {})).not.toThrow();
    expect(svc.getLastLoadError()).toBe('invalid_or_import_failed');
  });

  it('schemaVersion 超前（99）：拒绝读档返回 false，存档保留不清理，失败原因 schema_too_new', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    const svc = new GameSaveService(storage as any);

    // 未来版本存档（即使 qi 等字段合法）也拒绝解析，绝不按坏档清理
    store['jiazi_game_save'] = JSON.stringify(makeValidSnapshot({ schemaVersion: 99, rulesVersion: 1 }));
    let called = false;
    const ok = svc.load(() => { called = true; });
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(store['jiazi_game_save']).toBeDefined(); // 存档保留
    expect(svc.getLastLoadError()).toBe('schema_too_new');

    // 当前版本（schemaVersion = 1）正常读档
    store['jiazi_game_save'] = JSON.stringify(makeValidSnapshot({ schemaVersion: 1, rulesVersion: 1 }));
    const ok2 = svc.load(() => { called = true; });
    expect(ok2).toBe(true);
    expect(called).toBe(true);
    expect(svc.getLastLoadError()).toBeNull(); // 成功后失败原因清空
  });

  it('未知 rulesVersion（99）：拒绝读档返回 false，存档保留不清理，失败原因 rules_version_unsupported', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    const svc = new GameSaveService(storage as any);

    // 未知规则版本档：拒绝解析并保留原始存档（与 schemaVersion 超前同一策略）
    store['jiazi_game_save'] = JSON.stringify(makeValidSnapshot({ schemaVersion: 1, rulesVersion: 99 }));
    let called = false;
    const ok = svc.load(() => { called = true; });
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(store['jiazi_game_save']).toBeDefined(); // 存档保留
    expect(svc.getLastLoadError()).toBe('rules_version_unsupported');
  });

  it('schemaVersion 超前（99）：即使 qi 无效也不清理（保留原始存档）', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    const svc = new GameSaveService(storage as any);

    // 未来版本的坏档：版本拒绝优先于坏档清理，原始数据保留
    store['jiazi_game_save'] = JSON.stringify({ schemaVersion: 99, currentRound: 3, qi: 'not-a-number' });
    const ok = svc.load(() => {});
    expect(ok).toBe(false);
    expect(store['jiazi_game_save']).toBeDefined();
  });
});

describe('V6 地支波动存档（rulesVersion=6 / branchRoll，schemaVersion 保持 1）', () => {
  it('V6 档完整往返：base 构造读 V6 档还原 roll 状态与评分（声明版本优先）', async () => {
    const src = await makeBranchRollTm();
    src.startGame();
    expect(src.executeBuy(0, false)).toBe(true);
    const snapshot = src.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);
    expect(snapshot.branchRoll).toEqual(src.getBranchRollState());

    // base 构造读 V6 档：规则版本随存档声明还原（含分支波动 roll 状态）
    const tm = await makeTm();
    expect(() => tm.importSnapshot(snapshot)).not.toThrow();
    expect(tm.getRulesVersion()).toBe(RULES_VERSION_BRANCH_ROLL);
    expect(tm.getBranchRollState()).toEqual(src.getBranchRollState());
    const season = src.getCurrentSeason();
    for (const card of src.getPublicCards()) {
      expect(tm.getCardScore(card, season)).toBe(src.getCardScore(card, season));
    }
    // 再导出：写时归属 V6，branchRoll 随档保留
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_BRANCH_ROLL);
    expect(tm.exportSnapshot().branchRoll).toEqual(src.getBranchRollState());
  });

  it('V6 档缺 branchRoll：拒绝读档（版本门控，不静默降级）', async () => {
    const src = await makeBranchRollTm();
    src.startGame();
    const snapshot = src.exportSnapshot();
    delete (snapshot as any).branchRoll;

    const tm = await makeTm();
    expect(() => tm.importSnapshot(snapshot)).toThrowError(/branchRoll/);
  });

  it('非 6 档携带 branchRoll 字段：读档忽略、再导出不携带（协议不变形）', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    (oldSave as any).branchRoll = createBranchRollState(new SeededRandomSource(7), 0);

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getBranchRollState()).toBeNull();
    expect((tm.exportSnapshot() as any).branchRoll).toBeUndefined();
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_BASE);
  });
});

describe('存档 voidCardCount 校验与兼容（Standards P2）', () => {
  it('合法的 voidCardCount 正常还原并同步牌库', async () => {
    const tm = await makeTm();
    const save = makeValidSnapshot({ voidCardCount: 3 });
    expect(() => tm.importSnapshot(save)).not.toThrow();
    expect(tm.getVoidCardCount()).toBe(3);
    expect(tm.getCardById(63)).toBeDefined();

    const save2 = makeValidSnapshot({ voidCardCount: 2 });
    expect(() => tm.importSnapshot(save2)).not.toThrow();
    expect(tm.getVoidCardCount()).toBe(2);
    expect(tm.getCardById(63)).toBeUndefined();
  });

  it('非法/异常 voidCardCount（负数、小数、超上限、非数字）明确拒绝读档', async () => {
    const tm = await makeTm();

    // 负数
    const negSave = makeValidSnapshot({ voidCardCount: -1 });
    expect(() => tm.importSnapshot(negSave)).toThrowError(/voidCardCount 非法/);

    // 小数
    const floatSave = makeValidSnapshot({ voidCardCount: 2.5 });
    expect(() => tm.importSnapshot(floatSave)).toThrowError(/voidCardCount 非法/);

    // 超出上限 (> 10)
    const overflowSave = makeValidSnapshot({ voidCardCount: 99 });
    expect(() => tm.importSnapshot(overflowSave)).toThrowError(/voidCardCount 非法/);

    // 非数字
    const stringSave = makeValidSnapshot({ voidCardCount: '3' as any });
    expect(() => tm.importSnapshot(stringSave)).toThrowError(/voidCardCount 非法/);
  });
});

describe('V8 洁净牌池存档（rulesVersion=8 / clean_pool，schemaVersion 保持 1）', () => {
  it('V8 档完整往返：声明版本优先，正确还原牌池守恒、锁定状态与地支波动 branchRoll，二次导出可再读档', async () => {
    const src = await makeCleanPoolTm();
    src.startGame();
    expect(src.executeLockCard(0).ok).toBe(true);
    expect(src.executeWait()).toBe(true);

    const snapshot = src.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_CLEAN_POOL);
    expect(snapshot.lockedCardIds.length).toBeGreaterThan(0);
    expect(snapshot.branchRoll).toBeDefined();
    expect(snapshot.branchRoll).toEqual(src.getBranchRollState());

    // base 构造读 V8 档：声明版本优先，正确还原为 V8
    const tm = await makeTm();
    expect(() => tm.importSnapshot(snapshot)).not.toThrow();
    expect(tm.getRulesVersion()).toBe(RULES_VERSION_CLEAN_POOL);
    expect(tm.validateCardPoolIntegrity()).toBe(true);
    expect(tm.getLockedCardIds()).toEqual(src.getLockedCardIds());
    // 关键断言 1：branchRoll 状态完整还原，地支评分不漂移
    expect(tm.getBranchRollState()).toEqual(src.getBranchRollState());
    const season = src.getCurrentSeason();
    for (const card of src.getPublicCards()) {
      expect(tm.getCardScore(card, season)).toBe(src.getCardScore(card, season));
    }

    // 重新导出：保持 V8 规则声明、branchRoll 与锁定牌 ID
    const reExported = tm.exportSnapshot();
    expect(reExported.rulesVersion).toBe(RULES_VERSION_CLEAN_POOL);
    expect(reExported.branchRoll).toEqual(src.getBranchRollState());
    expect(reExported.lockedCardIds).toEqual(src.getLockedCardIds());

    // 关键断言 2：二次导出后的快照能被第三个实例无损再读档（不丢字段）
    const tm3 = await makeTm();
    expect(() => tm3.importSnapshot(reExported)).not.toThrow();
    expect(tm3.getRulesVersion()).toBe(RULES_VERSION_CLEAN_POOL);
    expect(tm3.getBranchRollState()).toEqual(src.getBranchRollState());
    expect(tm3.validateCardPoolIntegrity()).toBe(true);
  });

  it('旧版 V7 档读入后保持 rulesVersion=7，不被篡改为 V8', async () => {
    const srcV7 = await makeTrendWindowTm();
    srcV7.startGame();
    expect(srcV7.executeWait()).toBe(true);
    const saveV7 = srcV7.exportSnapshot();

    const tm = await makeTm();
    expect(() => tm.importSnapshot(saveV7)).not.toThrow();
    expect(tm.getRulesVersion()).toBe(RULES_VERSION_TREND_WINDOW);
    expect(tm.exportSnapshot().rulesVersion).toBe(RULES_VERSION_TREND_WINDOW);
  });
});

describe('isLocalOnly 本地试玩存档兼容性与往返（GameSnapshot 字段级扩展）', () => {
  it('1. 旧存档缺 isLocalOnly 字段时安全回退为 false，二次导出不产生冗余键', async () => {
    const legacySave = makeValidSnapshot();
    delete legacySave.isLocalOnly;

    const tm = await makeTm();
    expect(() => tm.importSnapshot(legacySave)).not.toThrow();
    expect(tm.getIsLocalOnly()).toBe(false);

    const exported = tm.exportSnapshot();
    expect(exported.isLocalOnly).toBeUndefined();
  });

  it('2. 新本地试玩存档 (isLocalOnly: true) 准确读回为 true，并可在往返中保持', async () => {
    const trialSave = makeValidSnapshot({ isLocalOnly: true });

    const tm = await makeTm();
    expect(() => tm.importSnapshot(trialSave)).not.toThrow();
    expect(tm.getIsLocalOnly()).toBe(true);

    const exported = tm.exportSnapshot();
    expect(exported.isLocalOnly).toBe(true);

    // 二次读档
    const tm2 = await makeTm();
    expect(() => tm2.importSnapshot(exported)).not.toThrow();
    expect(tm2.getIsLocalOnly()).toBe(true);
  });

  it('3. 普通云端/正常存档 (isLocalOnly: false) 准确读回为 false', async () => {
    const cloudSave = makeValidSnapshot({ isLocalOnly: false });

    const tm = await makeTm();
    expect(() => tm.importSnapshot(cloudSave)).not.toThrow();
    expect(tm.getIsLocalOnly()).toBe(false);

    const exported = tm.exportSnapshot();
    expect(exported.isLocalOnly).toBeUndefined();
  });
});
