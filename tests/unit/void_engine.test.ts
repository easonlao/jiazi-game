/**
 * V5 空亡规则·引擎层（TurnManager）单元测试。
 *
 * 覆盖（mechanics.md §9 / 票 03 验收；一审 P1-① 定案 V5 计分 = V4 计分）：
 * 1. V5 牌堆 = 63 张（60 甲子 + 3 空亡）；V1-V4 牌堆仍 60 张；
 * 2. 双时钟吞噬：空亡回合游戏回合 +1、季节时钟 +K（K uniform 2~12）；
 * 3. 吞噬回合玩家不可行动（自动推进）、仅自然回复 +10（无调息加成）；
 * 4. 吞噬回合持仓结算一次且落在跳跃后的季节；反噬/强平照常判定；
 * 5. 空亡牌不可买入（executeBuy 与预览一致拒绝）；
 * 6. 空亡牌可锁定；锁定保留期间不重复触发；
 * 7. K 掷骰走注入的种子随机源（脚本源精确定位 K，不引入 Math.random）；同种子可复现；
 * 8. V5 计分 = V4 计分（同参数下 getCardScore 逐值一致、释灵 6、存档按 V4 形状持久化）。
 */
import { describe, it, expect } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource, type RandomSource } from '../../src/core/RandomSource';
import { isVoidCard, VOID_CARD_ID_START } from '../../src/core/VoidCard';
import { RULES_VERSION_VOID, RULES_VERSION_BALANCED_TRADE, type SupportedRulesVersion } from '../../src/core/GameSaveService';
import { BAND_FACTOR } from '../../src/core/ScoreVolatility';
import type { GameSnapshot } from '../../src/core/GameSaveService';
import type { CardPoolManager } from '../../src/core/CardPoolManager';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as any).localStorage = new (class {
  store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
})();

async function makeTm(seed = 42, rulesVersion?: SupportedRulesVersion) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  // V5 是波动规则版本：吞噬回合会刷新波动（独立流），主随机与波动流分离，
  // 保证固定 seed 下主流（牌堆/K/回堆）的脚本定位不被波动掷骰扰动。
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), rulesVersion !== undefined
    ? { rulesVersion, volatilityRandom: new SeededRandomSource(seed + 1) }
    : undefined);
  await tm.initialize();
  return tm;
}

/** 把一张空亡牌放到牌堆顶（顶层 3 张 = 1 空亡 + 2 甲子），保证第一回合必触发且只触发一次。 */
function forceVoidOnTop(tm: TurnManager): void {
  const pool = (tm as any).cardPoolManager as CardPoolManager;
  const deck = pool.getDeck();
  const jiazi = deck.filter((c) => !isVoidCard(c));
  const voids = deck.filter((c) => isVoidCard(c));
  deck.length = 0;
  deck.push(voids[0]!, ...jiazi, ...voids.slice(1));
}

/** 当前季节时钟已消耗回合数（含当前回合）。 */
function clockPosition(tm: TurnManager): number {
  const sc = (tm as any).seasonCycle as { getSeasonLengths(): number[]; getCurrentSeasonIndex(): number; getCurrentRoundInSeason(): number };
  const lengths = sc.getSeasonLengths();
  const index = sc.getCurrentSeasonIndex();
  let sum = 0;
  for (let i = 0; i < index; i++) sum += lengths[i] ?? 0;
  return sum + sc.getCurrentRoundInSeason();
}

/** 脚本随机源：按固定序列吐 [0,1) 值（int 由 next 派生），用尽后默认 0.5。 */
class ScriptedRandom implements RandomSource {
  private i = 0;
  constructor(private readonly values: number[]) {}
  next(): number {
    const v = this.values[this.i] ?? 0.5;
    this.i++;
    return v;
  }
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
}

/** 生成一份 V5 合法存档（第 5 回合、空手、空亡在牌堆顶）。 */
function makeVoidSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const deckIds = [
    VOID_CARD_ID_START, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    VOID_CARD_ID_START + 1, VOID_CARD_ID_START + 2, 1,
  ];
  return {
    currentRound: 5,
    state: 'draw',
    lastAction: null,
    qi: 60,
    score: 0,
    totalHoldEarnings: 0,
    totalSellEarnings: 0,
    totalBuys: 0,
    totalSells: 0,
    totalWaits: 0,
    totalLeverageBuys: 0,
    season: { index: 0, roundInSeason: 3, lengths: [12, 12, 12, 12] },
    hand: [null, null, null],
    pool: { deckIds, publicIds: [] },
    lockedCardIds: [],
    schemaVersion: 1,
    rulesVersion: RULES_VERSION_VOID,
    // V5 是交易规则家族（计分 = V4），存档按 V4 形状持久化 scoreVolatility + scoreRules。
    // 测试夹具用 scale=0 波动（校验合法但零幅度），让空亡语义测试的数值可精确推导。
    scoreVolatility: {
      remainingRounds: 2,
      deltaByDiZhi: {},
      model: 'conflict_banded',
      scale: 0,
      directionByDiZhi: {
        子: 0.5, 丑: -0.5, 寅: 0, 卯: 0.5, 辰: -0.5, 巳: 0,
        午: 0.5, 未: -0.5, 申: 0, 酉: 0.5, 戌: -0.5, 亥: 0,
      },
      bandFactors: { ...BAND_FACTOR, conflict: 3 },
    },
    scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
    ...overrides,
  };
}

describe('V5 牌堆组成', () => {
  it('V5 牌堆 = 63 张（60 甲子 + 3 空亡）', async () => {
    const tm = await makeTm(1, RULES_VERSION_VOID);
    const pool = (tm as any).cardPoolManager as CardPoolManager;
    expect(pool.getDeck().length).toBe(63);
    expect(pool.getDeck().filter((c) => isVoidCard(c)).length).toBe(3);
  });

  it('V1-V4（base）牌堆仍为 60 张且不含空亡牌', async () => {
    const tm = await makeTm(1);
    const pool = (tm as any).cardPoolManager as CardPoolManager;
    expect(pool.getDeck().length).toBe(60);
    expect(pool.getDeck().some((c) => isVoidCard(c))).toBe(false);
  });
});

describe('V5 双时钟吞噬回合', () => {
  it('空亡回合：游戏回合 +1、季节时钟 +K（K ∈ [2,12]）、玩家无需行动即自动推进', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    const before = clockPosition(tm);
    tm.startGame();

    // 回合 1 被空亡吞噬：无玩家行动，直接推进到回合 2
    expect(tm.getCurrentRound()).toBe(2);
    expect(tm.getState()).toBe('player_action');
    const k = clockPosition(tm) - before;
    expect(k).toBeGreaterThanOrEqual(2);
    expect(k).toBeLessThanOrEqual(12);

    // 回合 1 的记录：action=null（无玩家行动），结算只含自然回复 10、无调息加成
    const voidEntry = tm.getRoundLog()[0];
    expect(voidEntry.round).toBe(1);
    expect(voidEntry.action).toBeNull();
    expect(voidEntry.settlement.baseQiRecover).toBe(10);
    expect(voidEntry.settlement.waitQiRecover).toBe(0);
  });

  it('K 掷骰走注入的种子随机源：脚本源精确定位 K=5，不引入 Math.random', async () => {
    // RNG 消耗：initialize 洗 63 张牌 = 62 次 int → 第 63 次为 K 掷骰（int(2,13)），
    // 其后 returnCards 消耗 3 次（值取 0.9 保证插回牌堆深处，避免第 6 回合再抽到空亡）。
    const values = new Array<number>(66).fill(0.5);
    values[62] = 0.3; // int(2,13): 2 + floor(0.3*11) = 5
    values[63] = 0.9;
    values[64] = 0.9;
    values[65] = 0.9;
    // volatilityRandom 独立成流：V5 继承 V4 波动语义后，吞噬回合 refreshScoreVolatility
    // 会从波动流掷骰——必须与主随机分离，避免扰动 K/回堆的脚本定位。
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    tm.importSnapshot(makeVoidSnapshot({ currentRound: 5, season: { index: 0, roundInSeason: 3, lengths: [12, 12, 12, 12] } }));
    const before = clockPosition(tm); // 3
    tm.startGame();
    expect(tm.getCurrentRound()).toBe(6); // 5 → 6
    expect(clockPosition(tm) - before).toBe(5); // K=5，春 r3 → r8
    expect(tm.getRoundLog()[0].round).toBe(5);
    expect(tm.getRoundLog()[0].season).toBe('spring');
    expect(tm.getRoundLog()[0].roundInSeason).toBe(8);
  });

  it('空亡回合持仓结算落在跳跃后的季节，反噬/强平照常判定', async () => {
    const values = new Array<number>(67).fill(0.5);
    values[62] = 0.3; // K=5
    values[63] = 0.95; // 强平回牌
    values[64] = 0.95; // 公共牌回堆 ×3
    values[65] = 0.95;
    values[66] = 0.95;
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999), // 波动流独立，见上一条注释
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    // 春 r10，K=5 → 越过春末进入夏 r3；手持 1 张杠杆牌，气 3 → 夏季结算气耗触发强平
    tm.importSnapshot(makeVoidSnapshot({
      qi: 3,
      score: 100,
      season: { index: 0, roundInSeason: 10, lengths: [12, 12, 12, 12] },
      hand: [{
        cardId: 1,
        buyScore: 3,
        useLeverage: true,
        leverage: 2.0,
        buyRound: 1,
        lockedQi: 10,
        holdEarnings: 0,
      }, null, null],
    }));
    const handSlot = tm.getHand()[0]!;
    handSlot.card.getSeasonScore = () => 4.0;

    tm.startGame();

    expect(tm.getCurrentRound()).toBe(6);
    // 读档补录：手牌买 round=1 会在 roundLog 头补一条买入记录，按 round 定位空亡回合记录
    const voidEntry = tm.getRoundLog().find((e) => e.round === 5)!;
    // 结算落在跳跃后的夏季 r3（杠杆 2.0x → 持仓气耗 6 → 气 3-6 ≤ 0 → 强平）
    expect(voidEntry.season).toBe('summer');
    expect(voidEntry.roundInSeason).toBe(3);
    expect(voidEntry.settlement.marginCallTriggered).toBe(true);
    expect(voidEntry.settlement.marginCallDetails.length).toBeGreaterThan(0);
    expect(voidEntry.settlement.marginCallDetails[0].leverage).toBe(2.0);
    expect(tm.getHand()[0]).toBeNull(); // 被反噬牌已强平
    expect(tm.getMarginCallCount()).toBe(1);
  });

  it('空亡回合仅自然回复 +10：即使上回合调息（wait）也不给 +10 加成', async () => {
    const tm = await makeTm(9, RULES_VERSION_VOID);
    // 存档构造"上回合 wait、本回合牌堆顶空亡"的确定性场景：空亡牌第 5 回合触发。
    tm.importSnapshot(makeVoidSnapshot({
      currentRound: 5,
      lastAction: 'wait',
      qi: 40,
      state: 'draw',
    }));
    const beforeQi = tm.getQi();
    tm.startGame(); // 回合 5 被空亡吞噬（后续回合 6 另有 +10 自然回复）
    const voidEntry = tm.getRoundLog()[0];
    expect(voidEntry.round).toBe(5);
    expect(voidEntry.action).toBe('wait'); // 上一回合行动归档
    expect(voidEntry.settlement.baseQiRecover).toBe(10);
    expect(voidEntry.settlement.waitQiRecover).toBe(0);
    // 空亡回合结束时气 = 40 + 10（仅自然回复，无调息 +10）
    expect(voidEntry.settlement.finalQi).toBe(beforeQi + 10);
  });
});

describe('V5 空亡牌行为', () => {
  it('空亡牌不可买入（executeBuy 与 previewSettlement 一致拒绝）', async () => {
    const tm = await makeTm(3, RULES_VERSION_VOID);
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [2, 3, 4], publicIds: [VOID_CARD_ID_START, 2, 3] },
    }));
    expect(tm.getState()).toBe('player_action');
    expect(tm.executeBuy(0, false)).toBe(false); // 空亡在索引 0
    expect(tm.getHand().filter(Boolean)).toHaveLength(0);
    expect(tm.previewSettlement({ type: 'buy', cardIndex: 0, leverage: false })).toBeNull();
    // 同回合可正常预览/买入其余牌
    expect(tm.previewSettlement({ type: 'buy', cardIndex: 1, leverage: false })).not.toBeNull();
  });

  it('空亡牌可被锁定（锁定期间不重复触发）', async () => {
    const tm = await makeTm(5, RULES_VERSION_VOID);
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [2, 3, 4, 5, 6, 7], publicIds: [VOID_CARD_ID_START, 2, 3] },
    }));
    // 锁定空亡牌
    const lock = tm.executeLockCard(0);
    expect(lock.ok).toBe(true);
    expect(tm.getLockedCardIds()).toContain(VOID_CARD_ID_START);

    // 调息推进：锁定空亡保留在公共区，非新抽入 → 不重复触发（季节时钟只走 1）
    const beforePos = clockPosition(tm);
    expect(tm.executeWait()).toBe(true);
    expect(tm.getCurrentRound()).toBe(6); // 5 → 6，只走 1 回合
    expect(clockPosition(tm) - beforePos).toBe(1); // 正常 advance，无 K 跳跃
    expect(tm.getPublicCards().some((c) => isVoidCard(c))).toBe(true); // 锁定牌仍在公共区
  });
});

describe('V5 确定性复现', () => {
  it('同种子两局行为完全一致（含空亡触发路径）', async () => {
    const run = async () => {
      const tm = await makeTm(1234, RULES_VERSION_VOID);
      forceVoidOnTop(tm);
      tm.startGame();
      let guard = 0;
      while (tm.getState() === 'player_action' && guard < 30) {
        tm.executeWait();
        guard++;
      }
      return {
        round: tm.getCurrentRound(),
        season: tm.getCurrentSeason(),
        roundInSeason: tm.getCurrentRoundInSeason(),
        qi: tm.getQi(),
        score: tm.getScore(),
        roundLog: JSON.stringify(tm.getRoundLog()),
        deckSize: tm.getDeckSize(),
      };
    };
    expect(await run()).toEqual(await run());
  });
});

describe('V5 空亡参数注入（voidConfig，票 05 授权扩展）', () => {
  it('缺省 voidConfig：K ∈ [2,12] 且牌堆 63 张（定稿值不回归）', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    const pool = (tm as any).cardPoolManager as CardPoolManager;
    expect(pool.getDeck().length).toBe(63);
    forceVoidOnTop(tm);
    const before = clockPosition(tm);
    tm.startGame();
    const k = clockPosition(tm) - before;
    expect(k).toBeGreaterThanOrEqual(2);
    expect(k).toBeLessThanOrEqual(12);
    expect(tm.getVoidStats().triggers).toBe(1);
  });

  it('voidCardCount=0：V5 牌堆 60 张无空亡牌，整局无触发', async () => {
    const tm = new TurnManager(undefined, new SeededRandomSource(11), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(12),
      voidConfig: { voidCardCount: 0 },
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    const pool = (tm as any).cardPoolManager as CardPoolManager;
    expect(pool.getDeck().length).toBe(60);
    expect(pool.getDeck().some((c) => isVoidCard(c))).toBe(false);
    tm.startGame();
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 60) {
      tm.executeWait();
      guard++;
    }
    expect(tm.getVoidStats()).toEqual({ triggers: 0, swallowedEvents: 0, maxVoidK: 0 });
  });

  it('voidKMin=voidKMax=1：K 恒为 1（脚本源验证注入 K 范围生效）', async () => {
    // RNG 消耗：initialize 洗 63 张牌 = 62 次 int → 第 63 次为 K 掷骰（int(1,2)，任意值 → 1）。
    const values = new Array<number>(66).fill(0.9);
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
      voidConfig: { voidKMin: 1, voidKMax: 1 },
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    forceVoidOnTop(tm);
    const before = clockPosition(tm);
    tm.startGame();
    expect(tm.getCurrentRound()).toBe(2); // 回合 1 被吞噬，游戏回合只走 1
    expect(clockPosition(tm) - before).toBe(1); // K=1：季节时钟只走 1（不跨季，无整季吞掉）
    expect(tm.getVoidStats()).toEqual({ triggers: 1, swallowedEvents: 0, maxVoidK: 1 });
  });

  it('吞季统计：强 K 一次吞噬跨过至少一季 → swallowedEvents=1（与 probe fullSkip 口径一致）', async () => {
    // 春 r1 + K=13，季长 4：1+13 > 4+4 → 越过夏整季（并继续越过秋）→ 落冬 r2。
    // 季索引净差 = 3 ≥ 2 → 整季吞掉事件计数 1（事件口径，非按季累计）。
    const values = new Array<number>(66).fill(0.9);
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
      voidConfig: { voidKMin: 13, voidKMax: 13 },
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    // 让首季长度为 4（懒生成第 0 季在首次访问 getCurrentSeasonLength 时抽取，
    // 直接用 importSnapshot 注入 4 长度并让空亡在牌堆顶，保持引擎语义精确可控）。
    tm.importSnapshot(makeVoidSnapshot({
      currentRound: 3,
      season: { index: 0, roundInSeason: 1, lengths: [4, 4, 4, 4] },
      pool: { deckIds: [VOID_CARD_ID_START, 2, 3, 4, 5, 6], publicIds: [] },
    }));
    const before = clockPosition(tm); // 1（春 r1）
    tm.startGame();
    expect(tm.getCurrentRound()).toBe(4); // 3 → 4
    expect(tm.getCurrentSeason()).toBe('winter'); // 春 r1 + 13 → 越过夏、秋 → 冬 r2
    expect(clockPosition(tm) - before).toBe(13);
    expect(tm.getVoidStats()).toEqual({ triggers: 1, swallowedEvents: 1, maxVoidK: 13 });
    // 整季吞掉事件沉淀到 roundLog：该空亡回合 voidSwallow.swallowed = 1（供存档续局重建）
    expect(tm.getRoundLog()[0].voidSwallow).toEqual({ count: 1, totalK: 13, maxK: 13, swallowed: 1 });
  });
});

describe('V5 批 1 引擎增强（票 09/10/11：onVoidTrigger / void_round / maxVoidK）', () => {
  it('onVoidTrigger 回调：每张空亡牌掷 K 后调用，携带 k 与跳跃前后季节', async () => {
    // RNG 消耗：initialize 洗 63 张牌 = 62 次 int → 第 63 次为 K 掷骰（int(2,13)，0.3 → K=5），
    // 其后 returnCards 消耗 3 次（0.9 插回牌堆深处）。
    const values = new Array<number>(66).fill(0.5);
    values[62] = 0.3; // K=5
    values[63] = 0.9;
    values[64] = 0.9;
    values[65] = 0.9;
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    tm.importSnapshot(makeVoidSnapshot({
      currentRound: 5,
      season: { index: 0, roundInSeason: 3, lengths: [12, 12, 12, 12] },
    }));

    const calls: { k: number; prevSeason: string; nextSeason: string }[] = [];
    tm.setOnVoidTrigger((info) => calls.push({ ...info }));

    tm.startGame();
    expect(calls).toEqual([{ k: 5, prevSeason: 'spring', nextSeason: 'spring' }]);
    // roundLog 空亡标记（票 09 TradeDashboard 数据源）：本回合被吞噬，季节时钟 +5 仍在春内（无整季吞掉）
    expect(tm.getRoundLog()[0].voidSwallow).toEqual({ count: 1, totalK: 5, maxK: 5, swallowed: 0 });
  });

  it('void_round 状态转换：吞噬回合置 void_round → 结束自动恢复 player_action', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    const states: string[] = [];
    tm.setOnStateChange((s) => states.push(s));

    tm.startGame();
    // 回合 1 被空亡吞噬：引擎先广播 void_round（玩家不可行动），吞噬结束恢复 player_action
    expect(states).toEqual(['void_round', 'player_action']);
    expect(tm.getState()).toBe('player_action');
    // 普通回合（第 2 回合）无空亡触发：后续状态序列不再含 void_round
    tm.executeWait();
    expect(states.filter((s) => s === 'void_round').length).toBe(1);
  });

  it('void_round → game_over：第 60 回合被空亡吞噬直接终局', async () => {
    const tm = new TurnManager(undefined, new ScriptedRandom(new Array<number>(66).fill(0.5)), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    tm.importSnapshot(makeVoidSnapshot({ currentRound: 60 }));

    const states: string[] = [];
    tm.setOnStateChange((s) => states.push(s));
    tm.startGame();
    expect(states).toEqual(['void_round', 'game_over']);
    expect(tm.getState()).toBe('game_over');
    expect(tm.getVoidStats().triggers).toBe(1);
  });

  it('maxVoidK 统计：多张空亡牌同回合触发取单次最大 K', async () => {
    // 3 张空亡牌置牌堆顶，同回合各掷一次 K：0.1→3 / 0.5→7 / 0.9→11。
    // RNG 消耗：initialize 62 次 → K×3（62/63/64）→ returnCards ×3（65/66/67）。
    const values = new Array<number>(68).fill(0.9);
    values[62] = 0.1; // K=3：春 r3 → 春 r6
    values[63] = 0.5; // K=7：春 r6 → 夏 r1
    values[64] = 0.9; // K=11：夏 r1 → 夏 r12（季长 12，不跨季）
    const tm = new TurnManager(undefined, new ScriptedRandom(values), {
      rulesVersion: RULES_VERSION_VOID,
      volatilityRandom: new SeededRandomSource(999),
    });
    (globalThis as any).fetch = async () => ({
      json: async () => JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8')),
    });
    await tm.initialize();
    tm.importSnapshot(makeVoidSnapshot({
      currentRound: 5,
      season: { index: 0, roundInSeason: 3, lengths: [12, 12, 12, 12] },
      pool: { deckIds: [VOID_CARD_ID_START, VOID_CARD_ID_START + 1, VOID_CARD_ID_START + 2, 2, 3, 4, 5, 6, 7], publicIds: [] },
    }));

    const calls: { k: number; prevSeason: string; nextSeason: string }[] = [];
    tm.setOnVoidTrigger((info) => calls.push({ ...info }));

    tm.startGame();
    expect(calls).toEqual([
      { k: 3, prevSeason: 'spring', nextSeason: 'spring' },
      { k: 7, prevSeason: 'spring', nextSeason: 'summer' },
      { k: 11, prevSeason: 'summer', nextSeason: 'summer' },
    ]);
    expect(tm.getVoidStats()).toEqual({ triggers: 3, swallowedEvents: 0, maxVoidK: 11 });
    // 同回合 3 次触发的空亡回合标记：count=3、totalK=21、maxK=11、无整季吞掉
    expect(tm.getRoundLog()[0].voidSwallow).toEqual({ count: 3, totalK: 21, maxK: 11, swallowed: 0 });
  });

  it('V1-V4（base）路径不进入 void_round、统计恒 0', async () => {
    const tm = await makeTm(3);
    const states: string[] = [];
    tm.setOnStateChange((s) => states.push(s));
    tm.startGame();
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 60) {
      tm.executeWait();
      guard++;
    }
    expect(tm.getState()).toBe('game_over');
    expect(states).not.toContain('void_round');
    expect(tm.getVoidStats()).toEqual({ triggers: 0, swallowedEvents: 0, maxVoidK: 0 });
  });

  it('局中存档→续局→getVoidStats() 与原局一致（票 P2-1：void 统计从 roundLog 重建）', async () => {
    // V5 按 V4 生产方式接线（conflict_banded 波动 + scoreRules），存档可合法往返
    const makeWired = async (seed: number) => {
      const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
      (globalThis as any).fetch = async () => ({ json: async () => cardData });
      const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
        rulesVersion: RULES_VERSION_VOID,
        scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
        volatility: {
          enabled: true,
          model: 'conflict_banded',
          scale: 0,
          minDuration: 1,
          maxDuration: 3,
          maxScoreDelta: 2,
          bandFactors: { ...BAND_FACTOR, conflict: 3 },
        },
        volatilityRandom: new SeededRandomSource(seed + 1),
      });
      await tm.initialize();
      return tm;
    };

    const tm = await makeWired(11);
    forceVoidOnTop(tm);
    tm.startGame(); // 首回合必被空亡吞噬（触发数 ≥ 1）
    const originalStats = tm.getVoidStats();
    expect(originalStats.triggers).toBeGreaterThan(0);
    expect(tm.getRoundLog().some((e) => e.voidSwallow)).toBe(true);

    // 局中存档：新引擎读档后统计必须与原局一致（不再归零）
    const snapshot = tm.exportSnapshot();
    const tm2 = await makeWired(99);
    tm2.importSnapshot(snapshot);
    expect(tm2.getVoidStats()).toEqual(originalStats);
    expect(tm2.getVoidStats().maxVoidK).toBe(originalStats.maxVoidK);

    // 续局打完终局：统计保持累积（续局后新增触发只增不减）
    let guard = 0;
    while (tm2.getState() === 'player_action' && guard < 60) {
      tm2.executeWait();
      guard++;
    }
    expect(tm2.getState()).toBe('game_over');
    expect(tm2.getVoidStats().triggers).toBeGreaterThanOrEqual(originalStats.triggers);
  });
});

describe('V5 计分继承 V4（一审 P1-① 定案：V4 计分 + 空亡）', () => {
  /** 同参数构造 V4 与 V5，验证计分逐值一致。 */
  async function makeScoringTm(version: SupportedRulesVersion) {
    const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
    (globalThis as any).fetch = async () => ({ json: async () => cardData });
    const tm = new TurnManager(undefined, new SeededRandomSource(42), {
      rulesVersion: version,
      scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
      volatility: {
        enabled: true,
        model: 'conflict_banded',
        scale: 4,
        minDuration: 1,
        maxDuration: 3,
        maxScoreDelta: 2,
        bandFactors: { ...BAND_FACTOR, conflict: 3 },
      },
      volatilityRandom: new SeededRandomSource(7),
    });
    await tm.initialize();
    return tm;
  }

  it('同参数下 getCardScore 逐值一致、波动状态一致、存档按 V4 形状持久化', async () => {
    const v4 = await makeScoringTm(RULES_VERSION_BALANCED_TRADE);
    const v5 = await makeScoringTm(RULES_VERSION_VOID);

    // 波动状态同源（同 volatilityRandom seed）且都激活
    expect(v4.getScoreVolatilityState()).not.toBeNull();
    expect(v5.getScoreVolatilityState()).not.toBeNull();
    expect(v5.getScoreVolatilityState()).toEqual(v4.getScoreVolatilityState());

    // 全牌 × 四季 getCardScore 逐值一致（含当前季波动叠加）
    const seasons = ['spring', 'summer', 'autumn', 'winter'];
    for (const card of v4.getPublicCards()) {
      for (const season of seasons) {
        expect(v5.getCardScore(card, season)).toBe(v4.getCardScore(card, season));
      }
    }

    // 计分参数 = V4（释灵 6）：存档形状一致
    expect(v5.exportSnapshot().scoreRules).toEqual({ holdBonus: 1.2, sellMultiplier: 6 });
    expect(v5.exportSnapshot().scoreRules).toEqual(v4.exportSnapshot().scoreRules);
    // 波动模型按 V4 形状（conflict_banded）
    expect(v5.exportSnapshot().scoreVolatility?.model).toBe('conflict_banded');
    expect(v5.exportSnapshot().scoreVolatility).toEqual(v4.exportSnapshot().scoreVolatility);

    // V5 存档可按 V4 形状往返（base 构造读 V5 档不抛）
    const base = await makeTm(1);
    expect(() => base.importSnapshot(v5.exportSnapshot())).not.toThrow();
    expect(base.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOID);
  });
});
