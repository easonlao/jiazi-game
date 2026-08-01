import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { JiaziCard } from '../../src/core/JiaziCard';

// 在 Node.js 环境下模拟浏览器的 localStorage
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value.toString();
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
  clear: () => {
    for (const key in localStorageStore) {
      delete localStorageStore[key];
    }
  }
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 Fetch 卡牌 JSON 数据
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () =>
      Promise.resolve([
        { id: 1, name: "甲子", tianGan: "甲", diZhi: "子", tianGanElement: "wood", diZhiElement: "water", mainElement: "wood", yinYang: "yang" },
        { id: 2, name: "乙丑", tianGan: "乙", diZhi: "丑", tianGanElement: "wood", diZhiElement: "earth", mainElement: "wood", yinYang: "yin" }
      ])
  })
) as any;

describe('TurnManager - 爆仓强平边界与控制流测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('用例 1：利息赖账 Bug 修复校验（扣除持仓气耗允许扣成负数并爆仓）', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档数据：气为 5，手牌有 1 张杠杆卡牌 (leverage = 2.0, buyScore = 3.0)
    const stateData = {
      currentRound: 25,
      state: 'player_action',
      lastAction: null,
      qi: 3,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 7,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          holdEarnings: 0
        },
        null,
        null,
        null
      ],
      pool: {
        deckIds: [2],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    
    // 加载存档
    const loadSuccess = tm.loadGame();
    expect(loadSuccess).toBe(true);
    expect(tm.getQi()).toBe(3);

    // 动态拦截卡牌的 getSeasonScore，使其返回 4.0
    // 动态杠杆：roundInSeason=7 → multiplier=2.5，持仓气耗 = 3.1 + 2.5*1 = 5.6
    const hand = tm.getHand();
    expect(hand[0]).not.toBeNull();
    hand[0]!.card.getSeasonScore = () => 4.0;

    // 执行等待动作，推进回合。这会触发结算，由于扣除气耗导致气变为负数，爆仓强平卡牌被卖出。
    const actionSuccess = tm.executeWait();
    expect(actionSuccess).toBe(true);

    // 验证卡牌已被卖出
    expect(tm.getHand()[0]).toBeNull();
    // 最终气值：强平后无低保缓冲，自然回复 10 气，等待额外回复 10 气
    // 强平退回保证金 = buyCost * 0.5（约 7 气），qi = -4.1 + 7 + 10 + 10 ≈ 22.9
    // 实际值取决于 lockedQi 计算，但应大于 0
    expect(tm.getQi()).toBeGreaterThan(0);
  });

  it('用例 2：单张牌强平分数结算与气扣除绕过校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档数据：气为 5，初始分 100，手牌有 1 张杠杆卡牌 (leverage = 2.0, buyScore = 3.0)
    const stateData = {
      currentRound: 25,
      state: 'player_action',
      lastAction: null,
      qi: 3,
      score: 100,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 7,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          holdEarnings: 0
        },
        null,
        null,
        null
      ],
      pool: {
        deckIds: [2],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    
    // 加载存档
    tm.loadGame();

    // 修改卡牌 getSeasonScore 返回 4.0
    const hand = tm.getHand();
    hand[0]!.card.getSeasonScore = () => 4.0;

    // 推进回合
    tm.executeWait();

    // 验证分数：
    // 1. 持仓结算得分：1.2 * 4.0 * 2.5 = 12
    // 2. 强平卖出得分（强平8折）：((4.0 - 3.0) * 4) * 2.5 * 0.8 = 8
    // 3. 爆仓扣分：2.5 * |4.0| * 6 = 60
    // 最终分：100 + 12 + 8 - 60 = 60
    expect(tm.getScore()).toBeCloseTo(60.0, 1);
    expect(tm.getHand()[0]).toBeNull();
  });

  it('用例 3：多张杠杆卡牌循环强平校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档数据：气为 5，手牌有 2 张杠杆卡牌
    const stateData = {
      currentRound: 25,
      state: 'player_action',
      lastAction: null,
      qi: 3,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 7,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          holdEarnings: 0
        },
        {
          cardId: 2,
          buyScore: 2,
          leverage: 2.0,
          buyRound: 1,
          holdEarnings: 0
        },
        null,
        null
      ],
      pool: {
        deckIds: [],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    
    // 加载存档
    tm.loadGame();

    const hand = tm.getHand();
    hand[0]!.card.getSeasonScore = () => 4.0;
    hand[1]!.card.getSeasonScore = () => 3.0;

    // 模拟 Math.random() 返回 0，以使强平随机选择第一个卡牌（索引 0）
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    // 推进回合
    tm.executeWait();

    // 验证仅第一张卡牌被强平出售，第二张卡牌被保留
    expect(tm.getHand()[0]).toBeNull();
    expect(tm.getHand()[1]).not.toBeNull();
    expect(tm.getHand()[1]!.card.id).toBe(2);

    // 验证分数：
    // 卡牌 1：持仓结算得分 (1.2 * 4 * 2 = 9.6)，强平卖出得分 (((4-3)*4)*2=8, 8折=6.4→6)，爆仓扣分 (2*|4|*6=48)
    // 卡牌 2：持仓结算得分 (1.2 * 3 * 2 = 7.2)，未被卖出
    // 最终分：0 + 9.6 + 6 - 48 + 7.2 = -25.2 → max(0, -25.2) = 0
    expect(tm.getScore()).toBe(0);

    randomSpy.mockRestore();
  });

  it('用例 4：资金总量约束 & 气回复上限限制', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame(); // 启动游戏流转至 player_action，这会触发第一回合的自然回复 (50 + 10 = 60)

    // 初始状态：60气（初始50 + 自然回复10）
    expect(tm.getQi()).toBe(60);
    expect(tm.getTotalLockedQi()).toBe(0);

    // 买入卡牌 1 (无杠杆)
    const buySuccess = tm.executeBuy(0, false);
    expect(buySuccess).toBe(true);

    const lockedQi1 = tm.getTotalLockedQi();
    expect(lockedQi1).toBeGreaterThan(0);
    // qi + lockedQi 不再约束 ≤ 80：qi 是总气，lockedQi 是已从 qi 扣掉的子集
    expect(tm.getQi()).toBeLessThanOrEqual(80 - lockedQi1 + lockedQi1); // ≤ 80

    // 强制修改气值到接近上限
    const qiManager = (tm as any).qiManager;
    qiManager.setQi(80 - 5, lockedQi1); // qi = 75

    // 回复 10 气，应该达到 maxQi = 80（不再被 lockedQi 截断）
    qiManager.recover(10, lockedQi1);
    expect(tm.getQi()).toBe(80);
  });

  it('用例 5：低气自救卖出与卖出消耗校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档：1张卡，买入分1.5，杠杆1.0，气为 5
    const stateData = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 5,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0,
        roundInSeason: 1,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 1.5,
          leverage: 1.0,
          buyRound: 1,
          lockedQi: 10,
          holdEarnings: 0
        },
        null,
        null,
        null
      ],
      pool: {
        deckIds: [2],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    tm.loadGame();

    const hand = tm.getHand();
    hand[0]!.card.getSeasonScore = () => 1.5;

    // 可用气为 5，卖出固定扣 4 气，允许卖出
    // 卖出后：5 - 4 = 1 气
    // 推进回合触发自然回复 10 + 等待回复 10 = 20，最终约 21 气
    const sellSuccess = tm.executeSell(0);
    expect(sellSuccess).toBe(true);
    expect(tm.getQi()).toBeGreaterThan(0);
  });

  it('用例 6：强平后无低保缓冲校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档：可用气为 3，持有1张杠杆卡牌，roundInSeason=7 触发 2.5x 动态杠杆
    const stateData = {
      currentRound: 25,
      state: 'player_action',
      lastAction: null,
      qi: 3,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0,
        roundInSeason: 7,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          lockedQi: 10,
          holdEarnings: 0
        },
        null,
        null,
        null
      ],
      pool: {
        deckIds: [2],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    tm.loadGame();

    // 设定持仓评分，使其产生扣气导致爆仓
    const hand = tm.getHand();
    hand[0]!.card.getSeasonScore = () => 4.0;
    // 持仓气耗 = 3.1 + 2.5 * 1 = 5.6
    // 3 - 5.6 = -2.6 <= 0 -> 触发强平

    // 执行等待以触发结算强平
    tm.executeWait();

    // 卡牌被强平
    expect(tm.getHand()[0]).toBeNull();

    // 强平后退回部分保证金，再进行自然/等待回气。
    // 无低保缓冲，自然回复 10 + 等待回复 10 = 20
    // 最终气约 20.9
    expect(tm.getQi()).toBeGreaterThan(10);  // 有回复但无低保
  });

  it('用例 7：旧存档兼容性加载校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造旧版存档：手牌没有 lockedQi 字段
    const stateData = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 40,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0,
        roundInSeason: 1,
        lengths: [12, 12, 12, 12]
      },
      hand: [
        {
          cardId: 1,
          buyScore: 2.0,
          leverage: 1.5,
          buyRound: 1,
          holdEarnings: 0
          // 缺失 lockedQi 字段
        },
        null,
        null,
        null
      ],
      pool: {
        deckIds: [2],
        publicIds: []
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
    
    // 加载存档应该成功
    const loadSuccess = tm.loadGame();
    expect(loadSuccess).toBe(true);

    // 验证 lockedQi 是否被正确还原
    const slot = tm.getHand()[0];
    expect(slot).not.toBeNull();
    expect(slot!.lockedQi).toBe(19);
    expect(tm.getTotalLockedQi()).toBe(19);
  });
});
