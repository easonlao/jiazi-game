/**
 * V5 空亡·store 层集成测试（批 1 一审修复回归）：
 * - P1-1：空亡 Toast 不被同 tick 的 action toast 覆盖（玩家行动 / 终局路径最后写入）；
 * - P2-3：空亡牌不可买入（previewBuyCost 哨兵 -1 + executeBuy 失败原因文案区分）。
 *
 * 通过把自定义 V5 TurnManager 注入 store 并绑定回调（bindTurnManagerCallbacks 测试导出）
 * 在 store action 真实执行路径上验证 Toast 顺序，不 mock 引擎语义。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks } from '../../app/src/store';
import { _resetVoidTriggerSeq } from '../../app/src/store/fx-events';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource, type RandomSource } from '../../src/core/RandomSource';
import { VOID_CARD_ID_START, isVoidCard } from '../../src/core/VoidCard';
import { RULES_VERSION_VOID } from '../../src/core/GameSaveService';
import { BAND_FACTOR } from '../../src/core/ScoreVolatility';
import type { GameSnapshot } from '../../src/core/GameSaveService';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// TurnManager 依赖 localStorage（存档路径），mock 掉
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

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

/** 构造 V5 TurnManager（固定 seed，可复现 K/牌池）。 */
async function makeVoidTm(seed: number, random?: RandomSource): Promise<TurnManager> {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  const tm = new TurnManager(undefined, random ?? new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_VOID,
    volatilityRandom: new SeededRandomSource(seed + 1),
  });
  await tm.initialize();
  return tm;
}

/** 生成 V5 合法存档夹具（第 5 回合、空手、牌堆顶 = 空亡牌）。 */
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

/** 把自定义 TM 注入 store 并绑定回调（复用 initialize 的同款回调，含 onVoidTrigger → 空亡 toast 累积）。 */
function injectTm(tm: TurnManager): void {
  bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
  useGameStore.setState({ turnManager: tm });
  useGameStore.getState()._sync();
}

const origLog = console.log;
const origWarn = console.warn;

describe('V5 空亡 Toast 不被 action toast 覆盖（P1-1）', () => {
  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
    useGameStore.setState({ toast: null });
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
  });

  it('玩家行动路径：等待推进触发空亡吞噬，空亡 toast 为最后一次写入（不被「调息」覆盖）', async () => {
    // 脚本随机源：initialize 洗 63 张牌 = 62 次 int → 第 63 次为 K 掷骰（0.9 → K=11，春 r4 → 夏 r3），
    // 其后 returnCards 消耗 3 次（0.9 插回牌堆深处，避免下回合再抽到空亡）。
    const values = new Array<number>(66).fill(0.5);
    values[62] = 0.9; // K=11
    values[63] = 0.9;
    values[64] = 0.9;
    values[65] = 0.9;
    const tm = await makeVoidTm(7, new ScriptedRandom(values));
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // executeWait 推进 → 引擎同步吞掉第 6 回合（牌堆顶空亡）→ 回到 store action → flush
    useGameStore.getState().executeWait();
    expect(useGameStore.getState().currentRound).toBe(7);
    // 信息边界（mechanics.md §9 ⑥）：Toast 不含 K 数值，只报跳跃季节
    expect(useGameStore.getState().toast).toBe('空亡触发！时间被吞噬（春→夏）');
    expect(useGameStore.getState().toast).not.toContain('调息');
    expect(useGameStore.getState().toast).not.toMatch(/\d/);
  });

  it('同一行动批内多张空亡连续触发：合并为一条 Toast，不重复、不丢失', async () => {
    // 3 张空亡牌置牌堆顶，第 6 回合同回合触发 3 次（K 掷骰在 62/63/64，returnCards 在 65/66/67）。
    const values = new Array<number>(68).fill(0.9);
    const tm = await makeVoidTm(9, new ScriptedRandom(values));
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [VOID_CARD_ID_START, VOID_CARD_ID_START + 1, VOID_CARD_ID_START + 2, 2, 3, 4, 5, 6, 7], publicIds: [] },
    }));
    injectTm(tm);

    useGameStore.getState().executeWait();
    // 合并文案：空亡触发！连续吞噬 3 次（春→夏、夏→秋、秋→冬）——次数可见，无 K 数值（信息边界）
    expect(useGameStore.getState().toast).toMatch(/^空亡触发！连续吞噬 3 次（[春夏秋冬]→[春夏秋冬]、[春夏秋冬]→[春夏秋冬]、[春夏秋冬]→[春夏秋冬]）$/);
    expect(useGameStore.getState().toast).not.toContain('调息');
    expect(useGameStore.getState().toast).not.toContain('个季节'); // 无 K 总和
    expect(useGameStore.getState().toast).not.toContain('空亡触发！时间被吞噬'); // 只合并成一条，无重复单条
  });

  it('终局路径：最后一回合被空亡吞噬直接终局，空亡 toast 不被「一甲子终了」覆盖', async () => {
    const tm = await makeVoidTm(11);
    // 玩家在第 59 回合等待 → 第 60 回合抽入空亡被吞噬 → 直接终局
    tm.importSnapshot(makeVoidSnapshot({ currentRound: 59, state: 'player_action' }));
    injectTm(tm);

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().gameState).toBe('game_over');
    // 信息边界：Toast 无 K 数值
    expect(useGameStore.getState().toast).toMatch(/^空亡触发！时间被吞噬（[春夏秋冬]→[春夏秋冬]）/);
    expect(useGameStore.getState().toast).not.toContain('一甲子终了');
    expect(useGameStore.getState().toast).not.toMatch(/\d/);
  });

  it('非空亡回合：普通等待 toast 正常展示，无空亡残留', async () => {
    const tm = await makeVoidTm(13);
    // 牌堆顶无空亡：deck 从甲子牌开始，普通回合无触发
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [1, 2, 3, 4, 5, 6, VOID_CARD_ID_START, 7, 8], publicIds: [] },
    }));
    injectTm(tm);

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().toast).toContain('调息');
    expect(useGameStore.getState().toast).not.toContain('空亡');
  });
});

describe('V5 空亡牌不可买入（P2-3）', () => {
  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
    useGameStore.setState({ toast: null, selectedPublicCard: -1 });
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
  });

  it('previewBuyCost 对空亡牌返回 -1 哨兵（ActionBar 据此禁用纳灵）', async () => {
    const tm = await makeVoidTm(3);
    // 公共区直接摆空亡牌：index 0 = 空亡，index 1/2 = 甲子
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [2, 3, 4, 5, 6, 7], publicIds: [VOID_CARD_ID_START, 2, 3] },
    }));
    injectTm(tm);

    const cards = useGameStore.getState().publicCards;
    expect(isVoidCard(cards[0]!)).toBe(true);
    expect(useGameStore.getState().previewBuyCost(0)).toBe(-1);
    // 普通甲子牌成本仍为正常非负值
    expect(useGameStore.getState().previewBuyCost(1)).toBeGreaterThanOrEqual(0);
  });

  it('选中空亡牌 executeBuy 失败，且失败文案区分空亡原因', async () => {
    const tm = await makeVoidTm(5);
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [2, 3, 4, 5, 6, 7], publicIds: [VOID_CARD_ID_START, 2, 3] },
    }));
    injectTm(tm);

    useGameStore.getState().selectPublicCard(0); // 选中空亡牌
    const ok = useGameStore.getState().executeBuy();
    expect(ok).toBe(false);
    expect(useGameStore.getState().toast).toContain('空亡牌不可买入');
    expect(useGameStore.getState().hand.filter(Boolean)).toHaveLength(0);
  });
});

describe('V5 空亡动画（批 2 票 08：P2-2 信号存活 / P2-4 gameState 覆盖）', () => {
  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
    useGameStore.setState({ toast: null, voidTriggerEvent: null, _voidAnimationTrueState: null });
    // 锁死 voidTriggerEvent 自增序列：真实触发会从 id=1 开始，与预置的 id=900 严格区分
    _resetVoidTriggerSeq();
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
  });

  it('startGame 不再同 tick 清空 voidTriggerEvent（P2-2：开局首回合吞噬也能播动画）', async () => {
    const tm = await makeVoidTm(3);
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);
    // 模拟引擎刚 set 完的空亡事件（尚未被组件消费）；id=900 与真实触发（重置后从 1 起）严格区分
    useGameStore.setState({ voidTriggerEvent: {
      id: 900, k: 5, prevSeason: 'spring', nextSeason: 'summer',
      // 引擎会带出 K 步完整轨迹（批 2 动画倒数数据源）；此处给一条合法形状的占位路径
      path: [
        { season: 'spring', roundInSeason: 3 },
        { season: 'spring', roundInSeason: 4 },
        { season: 'summer', roundInSeason: 1 },
        { season: 'summer', roundInSeason: 2 },
        { season: 'summer', roundInSeason: 3 },
      ],
    } });

    // localOnly 走普通开局分支（绕过云端）。若该 seed 首回合被吞噬，onVoidTrigger 会
    // 以 id=1 覆盖预置事件——断言 id===900 会失败，因此这里用首回合非空的 seed。
    await useGameStore.getState().startGame(true);
    expect(useGameStore.getState().voidTriggerEvent).not.toBeNull();
    // 严格断言：事件原样存活（id 未被改写、未被清空），锁死「startGame 不清空」回归点
    expect(useGameStore.getState().voidTriggerEvent!.id).toBe(900);
  });

  it('begin/endVoidRoundAnimation：动画期间覆盖 void_round，结束后恢复 player_action（P2-4）', async () => {
    const tm = await makeVoidTm(7);
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);
    expect(useGameStore.getState().gameState).toBe('player_action');
    // 前置清理：前序 onVoidTrigger 用例可能遗留 voidPoolSlot
    useGameStore.setState({ voidPoolSlot: null });

    useGameStore.getState().beginVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('void_round');
    expect(useGameStore.getState()._voidAnimationTrueState).toBe('player_action');

    // voidPoolSlot（空亡牌在真实公共牌池的槽位）：动画期间保留、结束清除（v3 用户反馈）
    expect(useGameStore.getState().voidPoolSlot).toBeNull();
    useGameStore.setState({ voidPoolSlot: 0, voidSwallowing: true });
    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();
    expect(useGameStore.getState().voidPoolSlot).toBeNull();
    expect(useGameStore.getState().voidSwallowing).toBe(false);
  });

  it('终局被吞噬：动画结束恢复 game_over，不残留（P2-4）', async () => {
    const tm = await makeVoidTm(11);
    tm.importSnapshot(makeVoidSnapshot({ currentRound: 59, state: 'player_action' }));
    injectTm(tm);
    // 第 60 回合被空亡吞噬直接终局
    useGameStore.getState().executeWait();
    expect(useGameStore.getState().gameState).toBe('game_over');

    useGameStore.getState().beginVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('void_round');
    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('game_over');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();
  });

  it('动画期间 _sync 不覆盖 gameState（动画结束后恢复的锚点不被冲掉）', async () => {
    const tm = await makeVoidTm(7);
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);

    useGameStore.getState().beginVoidRoundAnimation();
    // 模拟动画期间引擎侧发生一次 _sync（如 tick 回调）：gameState 保持 void_round
    useGameStore.getState()._sync();
    expect(useGameStore.getState().gameState).toBe('void_round');

    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('player_action');
  });

  it('reset 清除动画覆盖锚点：被 reset 打断的动画不会恢复成旧局状态', async () => {
    const tm = await makeVoidTm(7);
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);

    useGameStore.getState().beginVoidRoundAnimation();
    useGameStore.getState().reset();
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();
    // 模拟组件卸载兜底的 endVoidRoundAnimation：不把 gameState 恢复成旧局的 player_action
    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('init');
  });

  it('空亡回合不产生 seasonEvent（季节跳变由空亡动画表达，不叠加 SeasonTransition）', async () => {
    // 脚本随机源：同 P1-1 首用例（K=11，春 r4 → 夏 r3）
    const values = new Array<number>(66).fill(0.5);
    values[62] = 0.9; // K=11
    values[63] = 0.9;
    values[64] = 0.9;
    values[65] = 0.9;
    const tm = await makeVoidTm(7, new ScriptedRandom(values));
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);
    useGameStore.setState({ seasonEvent: null });

    // 等待推进 → 第 6 回合抽入空亡被吞噬 → 引擎季节跳变
    useGameStore.getState().executeWait();
    expect(useGameStore.getState().toast).toContain('空亡');
    expect(useGameStore.getState().season).not.toBe('spring');
    // 空亡导致的季节跳变不得产生 seasonEvent（SeasonTransition 叠加消除）
    expect(useGameStore.getState().seasonEvent).toBeNull();
  });

  it('空亡回合抑制一次性：后续普通换季的 _sync 照常生成 seasonEvent', async () => {
    const values = new Array<number>(66).fill(0.5);
    values[62] = 0.9;
    values[63] = 0.9;
    values[64] = 0.9;
    values[65] = 0.9;
    const tm = await makeVoidTm(7, new ScriptedRandom(values));
    tm.importSnapshot(makeVoidSnapshot({ state: 'player_action' }));
    injectTm(tm);
    useGameStore.setState({ seasonEvent: null });

    // 空亡吞噬：本次季节跳变被抑制
    useGameStore.getState().executeWait();
    expect(useGameStore.getState().season).toBe('summer'); // 引擎真实状态照常同步
    expect(useGameStore.getState().seasonEvent).toBeNull();

    // 模拟后续某回合普通换季（非空亡）：改引擎季节后 _sync，应照常生成 seasonEvent
    // （抑制标志已被消费，不会误伤下一次正常换季）
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      currentRound: 8,
      season: { index: 2, roundInSeason: 1, lengths: [12, 12, 12, 12] }, // autumn
    }));
    useGameStore.getState()._sync();
    expect(useGameStore.getState().season).toBe('autumn');
    expect(useGameStore.getState().seasonEvent).not.toBeNull();
    expect(useGameStore.getState().seasonEvent!.season).toBe('autumn');
    expect(useGameStore.getState().seasonEvent!.prevSeason).toBe('summer');
  });

  it('同回合多张空亡连续触发：只抑制一次，seasonEvent 保持 null', async () => {
    // 3 张空亡牌置牌堆顶，同回合连续触发 3 次（复用 P1-1 合并 Toast 夹具）
    const values = new Array<number>(68).fill(0.9);
    const tm = await makeVoidTm(9, new ScriptedRandom(values));
    tm.importSnapshot(makeVoidSnapshot({
      state: 'player_action',
      pool: { deckIds: [VOID_CARD_ID_START, VOID_CARD_ID_START + 1, VOID_CARD_ID_START + 2, 2, 3, 4, 5, 6, 7], publicIds: [] },
    }));
    injectTm(tm);
    useGameStore.setState({ seasonEvent: null });

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().toast).toMatch(/^空亡触发！连续吞噬 3 次/);
    // 三次触发合并的最终季节跳变同样由空亡动画表达
    expect(useGameStore.getState().seasonEvent).toBeNull();
  });
});
