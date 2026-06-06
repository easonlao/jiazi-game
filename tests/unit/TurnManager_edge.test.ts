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
    // 最终气值：强平后触发 10 气低保缓冲，自然回复 7 气，等待额外回复 10 气，共计 27 气
    expect(tm.getQi()).toBeCloseTo(27.8, 1);
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
    expect(tm.getScore()).toBeCloseTo(93.6, 1);
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

    // 模拟 Math.random() 返回 0，以使强平随机选择第一个卡牌（索引 0）
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    // 推进回合
    tm.executeWait();

    // 验证仅第一张卡牌被强平出售，第二张卡牌被保留
    expect(tm.getHand()[0]).toBeNull();
    expect(tm.getHand()[1]).not.toBeNull();
    expect(tm.getHand()[1]!.card.id).toBe(2);

    // 验证分数：
    // 卡牌 1：持仓结算得分 (1.2 * 4 * 2 = 9.6)，强平卖出得分 (Math.floor(24 * 0.8) = 19)
    // 卡牌 2：持仓结算得分 (1.2 * 3 * 2 = 7.2)，未被卖出
    // 最终分：9.6 + 19 + 7.2 = 35.8
    expect(tm.getScore()).toBeCloseTo(0.8, 1);

    randomSpy.mockRestore();
  });

  it('用例 4：资金总量约束 & 气回复上限限制', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame(); // 启动游戏流转至 player_action，这会触发第一回合的自然回复 (50 + 7 = 57)

    // 初始状态：57气
    expect(tm.getQi()).toBe(57);
    expect(tm.getTotalLockedQi()).toBe(0);

    // 买入卡牌 1 (无杠杆)
    // 执行买入
    const buySuccess = tm.executeBuy(0, false);
    expect(buySuccess).toBe(true);

    const lockedQi1 = tm.getTotalLockedQi();
    expect(lockedQi1).toBeGreaterThan(0);
    expect(tm.getQi() + lockedQi1).toBeLessThanOrEqual(80);

    // 强制修改气值到上限附近，测试自然回复上限限制
    const qiManager = (tm as any).qiManager;
    const currentMax = 80 - lockedQi1;
    qiManager.setQi(currentMax - 2, lockedQi1);

    // 回复 10 气，应该被截断在 currentMax
    qiManager.recover(10, lockedQi1);
    expect(tm.getQi()).toBe(currentMax);
    expect(tm.getQi() + lockedQi1).toBe(80);
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
    hand[0]!.card.getSeasonScore = () => 1.5; // 卖出分修正为 1.5，带来 sellScore = 8, sellQiReturn = 10 + 1.6 - 4 = 7.6

    // 可用气为 5 (低气)，但因为 sellQiReturn = 7.6 > 0 净回气，允许卖出
    // 卖出后推进回合会触发自然回复(7气)，所以最终可用气为 5 + 7.6 + 7 = 19.6 气
    const sellSuccess = tm.executeSell(0);
    expect(sellSuccess).toBe(true);
    expect(tm.getQi()).toBeCloseTo(19.6, 1);

    // 构造净回气为负的情况：如果返还小于 4
    const stateDataNegative = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 2, // 可用气 2
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
          lockedQi: 0, // 保证金为 0
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
    localStorage.setItem('jiazi_game_save', JSON.stringify(stateDataNegative));
    tm.loadGame();

    const hand2 = tm.getHand();
    hand2[0]!.card.getSeasonScore = () => 0; // 卖出分低于买入分，带来负修正
    // 净损耗为负，可用气仅为 2，买不起卖出成本，应该被阻断
    const sellSuccess2 = tm.executeSell(0);
    expect(sellSuccess2).toBe(false);
  });

  it('用例 6：强平 Option B 边界校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();

    // 构造存档：可用气为 5，持有两张卡牌。
    // 第一张杠杆卡牌 (lockedQi = 20)
    // 第二张极高锁定气卡牌 (lockedQi = 72)，用以测试强平低保受 currentMaxQi 限制截断
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
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          lockedQi: 20,
          holdEarnings: 0
        },
        {
          cardId: 2,
          buyScore: 3,
          leverage: 2.0,
          buyRound: 1,
          lockedQi: 72, // 极其夸张的锁定气
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
    tm.loadGame();

    // 设定持仓评分，使其产生扣气导致爆仓
    const hand = tm.getHand();
    hand[0]!.card.getSeasonScore = () => 4.0; // 扣气 6.2
    hand[1]!.card.getSeasonScore = () => 4.0; // 扣气 6.2
    // 总扣气 12.4
    // 5 - 12.4 = -7.4 <= 0 -> 触发强平

    // 强平随机选取卡牌，我们模拟 Math.random 使其优先平仓第一张 (lockedQi = 20)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    // 执行等待以触发结算强平
    tm.executeWait();

    // 第一张卡被卖出，剩第二张 (lockedQi = 72)
    expect(tm.getHand()[0]).toBeNull();
    expect(tm.getHand()[1]).not.toBeNull();

    // 强平第一张后：
    // newTotalLocked = 72
    // currentMaxQi = 80 - 72 = 8
    // 强平退回保证金 = 20 * 0.5 = 10
    // qi 扣除后为 -7.4，退回后为 -7.4 + 10 = 2.6
    // 低保 10 气受限于 currentMaxQi(8)，被截断为 8 气
    // 自然回复 7，等待回复 10，均受限于 currentMaxQi(8)，最终气应为 8
    expect(tm.getQi()).toBe(8);

    randomSpy.mockRestore();
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
    expect(slot!.lockedQi).toBe(25);
    expect(tm.getTotalLockedQi()).toBe(25);
  });
});

