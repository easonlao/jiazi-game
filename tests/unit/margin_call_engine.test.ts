/**
 * MarginCallEngine 直接单测（Phase 3 抽取后，此前仅经 TurnManager 间接覆盖）。
 *
 * 强平引擎依赖多模块 + 随机源 + 回调。这里用轻量 mock 隔离，
 * 聚焦强平循环的领域逻辑：随机选牌、扣分、返气、终止条件。
 */
import { describe, it, expect, vi } from 'vitest';
import { MarginCallEngine } from '../../src/core/MarginCallEngine';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

function makeCard(id: number, name: string): JiaziCard {
  return new JiaziCard({
    id, name,
    tianGan: '甲', diZhi: '子',
    tianGanElement: Element.WOOD, diZhiElement: Element.WATER,
    mainElement: Element.WOOD, yinYang: YinYang.YANG,
  });
}

/** mock 手牌槽位（只要 execute 用到的字段） */
interface MockSlot {
  card: JiaziCard;
  buyScore: number;
  useLeverage: boolean;
  lockedQi: number;
}

function makeSlot(card: JiaziCard, useLeverage: boolean, lockedQi: number): MockSlot {
  return { card, buyScore: 0, useLeverage, lockedQi };
}

interface MockState {
  qi: number;
  hand: (MockSlot | null)[];
  score: number;
  sellEarnings: number;
  marginCallCount: number;
  returnedCards: JiaziCard[];
}

function makeDeps(initialQi: number, slots: (MockSlot | null)[], cardScores: Record<number, number>) {
  const state: MockState = {
    qi: initialQi,
    hand: slots,
    score: 0,
    sellEarnings: 0,
    marginCallCount: 0,
    returnedCards: [],
  };

  const qiManager = {
    getQi: () => state.qi,
    recover: vi.fn((n: number) => { state.qi += n; }),
    getForcedLiquidationScoreMultiplier: () => 0.8,
    getForcedLiquidationQiReturnFactor: () => 0.5,
  };
  const handManager = {
    getHand: () => state.hand,
    sell: vi.fn((index: number) => {
      const slot = state.hand[index];
      state.hand[index] = null;
      return slot as any;
    }),
  };
  const cardPoolManager = {
    returnCards: vi.fn((cards: JiaziCard[]) => { state.returnedCards.push(...cards); }),
  };
  const scoreManager = {
    calculateSellScore: vi.fn((current: number, buy: number, leverage: number) =>
      (current - buy) * 4 * leverage),
    addSellEarnings: vi.fn((n: number) => { state.sellEarnings += n; state.score += n; }),
    applyMarginCallPenalty: vi.fn((n: number) => { state.score -= n; }),
  };
  const leverageCalculator = {
    getMultiplier: vi.fn(() => 2.0),
  };
  const seasonCycle = {
    getCurrentRoundInSeason: () => 3,
    getCurrentSeason: () => 'spring',
  };
  const random = {
    int: vi.fn(() => 0), // 固定选第一张，保证确定性
  };
  const getCardScore = vi.fn((card: JiaziCard) => cardScores[card.id] ?? 0);
  const getTotalLockedQi = vi.fn(() => 10);
  const onMarginCall = vi.fn(() => { state.marginCallCount++; });

  const engine = new MarginCallEngine({
    qiManager: qiManager as any,
    handManager: handManager as any,
    cardPoolManager: cardPoolManager as any,
    scoreManager: scoreManager as any,
    leverageCalculator: leverageCalculator as any,
    seasonCycle: seasonCycle as any,
    random: random as any,
    balanceConfig: DEFAULT_BALANCE_CONFIG,
    getCardScore: getCardScore as any,
    getTotalLockedQi: getTotalLockedQi as any,
    onMarginCall: onMarginCall as any,
  });

  return { engine, state, qiManager, handManager, cardPoolManager, scoreManager, random, onMarginCall };
}

describe('MarginCallEngine 直接单测', () => {
  it('气为正：不触发任何强平动作', () => {
    const { engine, state, onMarginCall } = makeDeps(20, [makeSlot(makeCard(1, '甲子'), true, 10)], { 1: 5 });
    const details = engine.execute();
    expect(details).toEqual([]);
    expect(onMarginCall).not.toHaveBeenCalled();
    expect(state.marginCallCount).toBe(0);
  });

  it('气归零且有杠杆牌：强平一张，扣分 + 返气 + 牌回堆 + 计数', () => {
    const { engine, state, onMarginCall, scoreManager, cardPoolManager } = makeDeps(
      0,
      [makeSlot(makeCard(1, '甲子'), true, 10)],
      { 1: 5 },
    );
    const details = engine.execute();

    // 强平一次
    expect(onMarginCall).toHaveBeenCalledTimes(1);
    expect(state.marginCallCount).toBe(1);
    // 卖出收益 = (5-0)*4*2 = 40，正收益 × 0.8 → 32
    expect(state.sellEarnings).toBe(32);
    // 强平扣分 = 2 × |5| × 3 = 30
    expect(scoreManager.applyMarginCallPenalty).toHaveBeenCalledWith(30);
    // 返气 = floor(10 × 0.5) = 5
    expect(state.qi).toBe(5);
    // 牌回牌堆
    expect(cardPoolManager.returnCards).toHaveBeenCalled();
    expect(state.returnedCards.map(c => c.id)).toEqual([1]);
    // 明细含卡名与原因
    expect(details).toHaveLength(1);
    expect(details[0].cardName).toBe('甲子');
    expect(details[0].reason).toContain('杠杆 2x');
  });

  it('气归零但无杠杆牌：不强制平仓（普通牌允许气为 0 持有）', () => {
    const { engine, state, onMarginCall } = makeDeps(
      0,
      [makeSlot(makeCard(1, '甲子'), false, 0)],
      { 1: 5 },
    );
    const details = engine.execute();
    expect(details).toEqual([]);
    expect(onMarginCall).not.toHaveBeenCalled();
    expect(state.hand.filter(Boolean)).toHaveLength(1); // 牌保留
  });

  it('气归零且手牌为空：安全终止不崩溃', () => {
    const { engine, state, onMarginCall } = makeDeps(0, [], {});
    const details = engine.execute();
    expect(details).toEqual([]);
    expect(onMarginCall).not.toHaveBeenCalled();
    expect(state.marginCallCount).toBe(0);
  });

  it('多张杠杆牌：每次强平只处理一张（一次结算最多 1 张）', () => {
    const { engine, state, onMarginCall } = makeDeps(
      0,
      [
        makeSlot(makeCard(1, '甲子'), true, 10),
        makeSlot(makeCard(2, '乙丑'), true, 10),
      ],
      { 1: 5, 2: 3 },
    );
    const details = engine.execute();
    // 强平一张后气回正（+5），循环终止——一次只平一张
    expect(onMarginCall).toHaveBeenCalledTimes(1);
    expect(state.hand.filter(Boolean)).toHaveLength(1);
    expect(details).toHaveLength(1);
  });

  it('固定随机源：选择与注入的 random.int 一致', () => {
    const { engine, random } = makeDeps(
      0,
      [
        makeSlot(makeCard(1, '甲子'), true, 10),
        makeSlot(makeCard(2, '乙丑'), true, 10),
      ],
      { 1: 5, 2: 3 },
    );
    engine.execute();
    // random.int(0, 2) → mock 固定返回 0 → 选中第一张（1 号牌）
    expect(random.int).toHaveBeenCalledWith(0, 2);
  });
});
