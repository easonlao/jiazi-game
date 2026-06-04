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
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 5,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 1,
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
    expect(tm.getQi()).toBe(5);

    // 动态拦截卡牌的 getSeasonScore，使其返回 4.0
    // 持仓气耗计算公式（修正后）：Math.max(0.5, 1.5 + 0.4 * 4.0) * 2.0 = 3.1 * 2.0 = 6.2
    const hand = tm.getHand();
    expect(hand[0]).not.toBeNull();
    hand[0]!.card.getSeasonScore = () => 4.0;

    // 执行等待动作，推进回合。这会触发结算，由于扣除气耗(6.2)导致气变为负数(5 - 6.2 = -1.2)，爆仓强平卡牌被卖出。
    const actionSuccess = tm.executeWait();
    expect(actionSuccess).toBe(true);

    // 验证卡牌已被卖出
    expect(tm.getHand()[0]).toBeNull();
    // 最终气值：-1.2 + 7 (自然回复) + 10 (等待奖励) = 15.8
    expect(tm.getQi()).toBeCloseTo(15.8, 1);
  });

  it('用例 2：单张牌强平分数结算与气扣除绕过校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档数据：气为 5，初始分 100，手牌有 1 张杠杆卡牌 (leverage = 2.0, buyScore = 3.0)
    const stateData = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 5,
      score: 100,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 1,
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
    // 1. 持仓结算得分：1.2 * 4.0 * 2.0 = 9.6
    // 2. 强平卖出得分（强平8折）：Math.floor(((8 + (4.0 - 3.0) * 4) * 2.0) * 0.8) = Math.floor(24 * 0.8) = 19
    // 最终分：100 + 9.6 + 19 = 128.6
    expect(tm.getScore()).toBeCloseTo(128.6, 1);
    expect(tm.getHand()[0]).toBeNull();
  });

  it('用例 3：多张杠杆卡牌循环强平校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档数据：气为 5，手牌有 2 张杠杆卡牌
    const stateData = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 5,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0, // spring
        roundInSeason: 1,
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

    // 推进回合
    tm.executeWait();

    // 验证两张牌都被强平出售
    expect(tm.getHand()[0]).toBeNull();
    expect(tm.getHand()[1]).toBeNull();

    // 验证分数：
    // 卡牌 1：持仓 (1.2 * 4 * 2 = 9.6)，卖出 (Math.floor(24 * 0.8) = 19)
    // 卡牌 2：持仓 (1.2 * 3 * 2 = 7.2)，卖出 (Math.floor(24 * 0.8) = 19)
    // 最终分：9.6 + 19 + 7.2 + 19 = 54.8
    expect(tm.getScore()).toBeCloseTo(54.8, 1);
  });
});
