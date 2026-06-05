import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';

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
        { id: 2, name: "乙丑", tianGan: "乙", diZhi: "丑", tianGanElement: "wood", diZhiElement: "earth", mainElement: "wood", yinYang: "yin" },
        { id: 3, name: "丙寅", tianGan: "丙", diZhi: "寅", tianGanElement: "fire", diZhiElement: "wood", mainElement: "fire", yinYang: "yang" }
      ])
  })
) as any;

describe('TurnManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始化及流程控制正常', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    
    expect(tm.getState()).toBe('init');
    expect(tm.getCurrentRound()).toBe(1);
    expect(tm.getQi()).toBe(50);
    expect(tm.getScore()).toBe(0);

    tm.startGame();
    expect(tm.getState()).toBe('player_action');
    // 第一回合开始已自动抽牌
    expect(tm.getPublicCards().length).toBeGreaterThan(0);
  });

  it('执行买入、卖出和等待流程', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 1. 等待操作
    const successWait = tm.executeWait();
    expect(successWait).toBe(true);
    expect(tm.getCurrentRound()).toBe(2);

    // 2. 买入操作 (因为有 3 张卡，第一回合买入 publicCards[0])
    const publicCards = tm.getPublicCards();
    expect(publicCards.length).toBeGreaterThan(0);
    
    const successBuy = tm.executeBuy(0, false);
    expect(successBuy).toBe(true);
    expect(tm.getCurrentRound()).toBe(3);
    expect(tm.getHand().filter(slot => slot !== null).length).toBe(1);

    // 3. 卖出操作
    const successSell = tm.executeSell(0); // 卖出插槽 0
    expect(successSell).toBe(true);
    expect(tm.getCurrentRound()).toBe(4);
    expect(tm.getHand().filter(slot => slot !== null).length).toBe(0);
  });

  it('游戏存档与读档功能验证', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 改变一些游戏状态
    tm.executeWait(); // 推进到第 2 回合
    tm.executeBuy(0, false); // 推进到第 3 回合，买入一张牌
    
    const savedScore = tm.getScore();
    const savedQi = tm.getQi();
    const savedRound = tm.getCurrentRound();
    const savedHandSize = tm.getHand().filter(slot => slot !== null).length;

    // 1. 触发存档
    expect(tm.hasSave()).toBe(false);
    const saveResult = tm.saveGame();
    expect(saveResult).toBe(true);
    expect(tm.hasSave()).toBe(true);

    // 2. 重置并改变原始状态
    const newTm = new TurnManager();
    await newTm.initialize();
    newTm.startGame();
    expect(newTm.getCurrentRound()).toBe(1);

    // 3. 触发读档还原
    const loadResult = newTm.loadGame();
    expect(loadResult).toBe(true);

    // 4. 断言所有状态恢复无误
    expect(newTm.getCurrentRound()).toBe(savedRound);
    expect(newTm.getQi()).toBe(savedQi);
    expect(newTm.getScore()).toBeCloseTo(savedScore);
    expect(newTm.getHand().filter(slot => slot !== null).length).toBe(savedHandSize);
  });

  it('异常坏档防御性拦截校验', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    const initialQi = tm.getQi();
    const initialRound = tm.getCurrentRound();

    // 1. 模拟写入坏档数据 (Round 1, 无手牌，气 qi <= 0)
    const badSaveData = {
      currentRound: 1,
      state: 'player_action',
      lastAction: null,
      qi: 0,
      score: 0,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      season: {
        index: 0,
        roundInSeason: 1,
        lengths: [5, 9, 9, 8]
      },
      hand: [null, null, null],
      pool: {
        deckIds: [1, 2, 3],
        publicIds: [1, 2]
      }
    };
    localStorage.setItem('jiazi_game_save', JSON.stringify(badSaveData));

    // 2. 调用读档应被拦截，拒绝加载返回 false
    const loadResult = tm.loadGame();
    expect(loadResult).toBe(false);

    // 3. 检查存档是否已被自动清除
    expect(tm.hasSave()).toBe(false);

    // 4. 断言游戏内的数据未被坏档污染
    expect(tm.getQi()).toBe(initialQi);
    expect(tm.getCurrentRound()).toBe(initialRound);
  });
});
