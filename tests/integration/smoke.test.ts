/**
 * 端到端冒烟测试：模拟玩家从打开游戏到游戏结束的完整流程
 * 验证：初始化 → 第一回合 → 多回合操作 → 爆仓 → 游戏结束，全链路不报错
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';

// 模拟浏览器环境
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { for (const key in localStorageStore) delete localStorageStore[key]; },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 fetch 返回 60 张卡牌数据
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve(
      Array.from({ length: 60 }, (_, i) => {
        const tianGan = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'][i % 10];
        const diZhi = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'][Math.floor(i / 10)];
        return {
          id: i + 1,
          name: `${tianGan}${diZhi}`,
          tianGan,
          diZhi,
          tianGanElement: ['wood','wood','fire','fire','earth','earth','metal','metal','water','water'][i % 10],
          diZhiElement: ['water','earth','wood','wood','earth','fire','fire','earth','metal','metal','earth','water'][Math.floor(i / 10)],
          mainElement: ['wood','wood','fire','fire','earth','earth','metal','metal','water','water'][i % 10],
          yinYang: i % 2 === 0 ? 'yang' : 'yin',
        };
      })
    ),
  })
) as any;

describe('端到端冒烟测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('完整 60 回合流程：永远等待', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 模拟 60 回合永远等待
    for (let i = 0; i < 70; i++) {
      if (tm.getState() === 'player_action') {
        tm.executeWait();
      } else if (tm.getState() === 'game_over') {
        break;
      }
    }

    // 游戏应该正常结束
    expect(tm.getState()).toBe('game_over');
  });

  it('完整 60 回合流程：随机操作', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 模拟 60 回合随机操作
    for (let i = 0; i < 70; i++) {
      if (tm.getState() !== 'player_action') break;

      const action = Math.random();
      if (action < 0.4) {
        tm.executeWait();
      } else if (action < 0.7) {
        const publicCards = tm.getPublicCards();
        if (publicCards.length > 0) {
          const success = tm.executeBuy(0, Math.random() > 0.5);
          if (!success) tm.executeWait();
        } else {
          tm.executeWait();
        }
      } else {
        const hand = tm.getHand();
        const idx = hand.findIndex(s => s !== null);
        if (idx !== -1) {
          const success = tm.executeSell(idx);
          if (!success) tm.executeWait();
        } else {
          tm.executeWait();
        }
      }
    }

    // 游戏应该正常结束
    expect(tm.getState()).toBe('game_over');
  });

  it('存档 → 读档 → 继续游戏', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 玩几回合
    for (let i = 0; i < 10; i++) {
      if (tm.getState() === 'player_action') {
        tm.executeWait();
      }
    }

    // 存档
    const saveSuccess = tm.saveGame();
    expect(saveSuccess).toBe(true);

    // 记录状态
    const savedRound = tm.getCurrentRound();
    const savedScore = tm.getScore();
    const savedQi = tm.getQi();

    // 创建新实例，读取存档
    const tm2 = new TurnManager();
    await tm2.initialize();
    const loadSuccess = tm2.loadGame();
    expect(loadSuccess).toBe(true);

    // 验证存档恢复正确
    expect(tm2.getCurrentRound()).toBe(savedRound);
    expect(tm2.getScore()).toBeCloseTo(savedScore, 1);
    expect(tm2.getQi()).toBeCloseTo(savedQi, 1);

    // 继续游戏
    for (let i = 0; i < 20; i++) {
      if (tm2.getState() === 'player_action') {
        tm2.executeWait();
      }
    }

    expect(tm2.getCurrentRound()).toBe(savedRound + 20);
  });

  it('极端情况：连续爆仓直到游戏结束', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 模拟足够回合（覆盖 60 回合游戏长度）
    for (let i = 0; i < 200; i++) {
      if (tm.getState() !== 'player_action') break;

      const publicCards = tm.getPublicCards();
      const hand = tm.getHand();
      const hasCard = hand.some(s => s !== null);

      if (publicCards.length > 0 && tm.getQi() > 20) {
        // 尝试买入+杠杆
        const success = tm.executeBuy(0, true);
        if (!success) tm.executeWait();  // 买入失败则等待
      } else if (hasCard) {
        // 尝试卖出
        const idx = hand.findIndex(s => s !== null);
        const success = tm.executeSell(idx);
        if (!success) tm.executeWait();  // 卖出失败则等待
      } else {
        tm.executeWait();
      }
    }

    // 游戏应该正常结束，不崩溃
    expect(tm.getState()).toBe('game_over');
  });
});
