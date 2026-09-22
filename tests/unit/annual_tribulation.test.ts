import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager, calculateAnnualQuota, type TribulationResult } from '../../src/core/TurnManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';
import { useGameStore, bindTurnManagerCallbacks } from '../../app/src/store';

// 模拟 localStorage
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
  },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 60 甲子卡牌库
const mockCardData = [
  { id: 1, name: '甲子', tianGan: '甲', diZhi: '子', tianGanElement: 'wood', diZhiElement: 'water', mainElement: 'wood', yinYang: 'yang' },
  { id: 2, name: '乙丑', tianGan: '乙', diZhi: '丑', tianGanElement: 'wood', diZhiElement: 'earth', mainElement: 'wood', yinYang: 'yin' },
  { id: 3, name: '丙寅', tianGan: '丙', diZhi: '寅', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yang' },
  { id: 4, name: '丁卯', tianGan: '丁', diZhi: '卯', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yin' },
  { id: 5, name: '戊辰', tianGan: '戊', diZhi: '辰', tianGanElement: 'earth', diZhiElement: 'earth', mainElement: 'earth', yinYang: 'yang' },
];

global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve(mockCardData),
  }),
) as any;

function createCard(id: number, name: string, mainElement: Element): JiaziCard {
  return new JiaziCard({
    id,
    name,
    tianGan: '甲',
    diZhi: '子',
    tianGanElement: Element.WOOD,
    diZhiElement: Element.WATER,
    mainElement,
    yinYang: YinYang.YANG,
  });
}

describe('Annual Tribulation and Carryover (年岁大考、天劫雷火出清与 35% 结转道基)', () => {
  let turnManager: TurnManager;

  beforeEach(() => {
    localStorageMock.clear();
    turnManager = new TurnManager();
    turnManager.startGame();
  });

  describe('1. 每年 1.95x 门槛递增与天劫数学计算', () => {
    it('门槛阶梯精确匹配需求基准：Y1: 650, Y2: 1268, Y3: 2473, Y4: 4822', () => {
      const y1 = calculateAnnualQuota(1);
      expect(y1.baseQuota).toBe(650);
      expect(y1.quota).toBe(650);

      const y2 = calculateAnnualQuota(2);
      expect(y2.baseQuota).toBe(1268);
      expect(y2.quota).toBe(1268);

      const y3 = calculateAnnualQuota(3);
      expect(y3.baseQuota).toBe(2473);
      expect(y3.quota).toBe(2473);

      const y4 = calculateAnnualQuota(4);
      expect(y4.baseQuota).toBe(4822);
      expect(y4.quota).toBe(4822);
    });

    it('欺天机缘折扣率 0.8x 正确减免天劫门槛', () => {
      const y1 = calculateAnnualQuota(1, 0.8);
      expect(y1.baseQuota).toBe(650);
      expect(y1.quota).toBe(520); // 650 * 0.8 = 520

      const y2 = calculateAnnualQuota(2, 0.8);
      expect(y2.baseQuota).toBe(1268);
      expect(y2.quota).toBe(1014); // 1268 * 0.8 = 1014.4 -> 1014

      turnManager.setQuotaDiscount(0.8);
      expect(turnManager.getQuotaDiscount()).toBe(0.8);
      expect(turnManager.getQuota()).toBe(520);
    });
  });

  describe('2. 20 回合年岁推进与大考触发流程', () => {
    it('确立 20 回合为一岁：turn 范围严格在 1~20', () => {
      expect(turnManager.getYear()).toBe(1);
      expect(turnManager.getTurn()).toBe(1);

      // 推进 5 回合
      for (let i = 1; i <= 5; i++) {
        turnManager.executeWait();
      }
      expect(turnManager.getTurn()).toBe(6);
      expect(turnManager.getYear()).toBe(1);
    });

    it('第 20 回合推演结束时，自动引动天劫大考并触发回调', () => {
      let tribulationCalled = false;
      let callbackResult: TribulationResult | null = null;
      turnManager.setOnTribulation((res) => {
        tribulationCalled = true;
        callbackResult = res;
      });

      // 连续推演至第 19 回合结束，进入第 20 回合操作阶段
      for (let i = 1; i < 20; i++) {
        turnManager.executeWait();
        expect(tribulationCalled).toBe(false);
      }

      expect(turnManager.getTurn()).toBe(20);
      expect(turnManager.getState()).toBe('player_action');

      // 注入足够分数保证渡劫成功
      turnManager.getScoreManager().setScore(1000);

      // 在第 20 回合执行行动，周天结算推演完毕引动天劫
      turnManager.executeWait();

      expect(tribulationCalled).toBe(true);
      expect(callbackResult).not.toBeNull();
      expect(callbackResult!.year).toBe(1);
      expect(callbackResult!.quota).toBe(650);
      expect(callbackResult!.success).toBe(true);
      expect(turnManager.getState()).toBe('tribulation');
    });
  });

  describe('3. 天劫雷火出清丹田明牌与地脉暗牌安全留存 (Q5=B, Q1=A)', () => {
    it('天劫降临时，丹田明牌全部按冬季当季评分变现并清空丹田，地脉暗牌完好存留跨年', () => {
      const cardA = createCard(1, '甲子', Element.WOOD);
      const cardB = createCard(2, '乙丑', Element.EARTH);
      const cardLeyline = createCard(3, '丙寅', Element.FIRE);

      const handManager = turnManager.getHandManager();

      // 丹田放入 2 张明牌
      handManager.buy(cardA, 10, false, 1, 1, 10);
      handManager.buy(cardB, 15, false, 1, 1, 10);
      expect(handManager.getDantianSize()).toBe(2);

      // 地脉放入 1 张暗牌
      handManager.buyToLeyline(cardLeyline, 5, false, 1, 1, 5);
      expect(handManager.getLeylineSize()).toBe(1);

      // 给予基准分数 500
      turnManager.getScoreManager().setScore(500);

      // 手动引动天劫大考
      const result = turnManager.evaluateTribulation();

      // 丹田 2 张明牌必须被雷火出清并变现
      expect(result.dantianClearedCards.length).toBe(2);
      expect(result.dantianClearedCards.map(c => c.card.name)).toContain('甲子');
      expect(result.dantianClearedCards.map(c => c.card.name)).toContain('乙丑');

      // 丹田必须全部清空为空槽位
      expect(handManager.getDantianSize()).toBe(0);
      expect(handManager.getHand().every(slot => slot === null)).toBe(true);

      // 地脉暗牌必须完好无损存留！
      expect(handManager.getLeylineSize()).toBe(1);
      expect(handManager.getLeylineCards()[0].card.name).toBe('丙寅');
    });
  });

  describe('4. 达标成功与 35% 结转道基精确数学 (Carryover)', () => {
    it('渡劫达标：消耗当岁基准真元，溢出部分的 35% 四舍五入结转为新岁初始修为', () => {
      // 初始基准门槛 650
      expect(turnManager.getQuota()).toBe(650);

      // 设定当前积攒修为为 1000
      turnManager.getScoreManager().setScore(1000);

      const result = turnManager.evaluateTribulation();
      expect(result.success).toBe(true);
      expect(result.quota).toBe(650);
      expect(result.finalScore).toBe(1000);

      // 溢出真元 surplus = 1000 - 650 = 350
      expect(result.surplus).toBe(350);
      // 结转道基 carryover = round(350 * 0.35) = 122.5 -> 123
      expect(result.carryover).toBe(123);

      expect(turnManager.getState()).toBe('tribulation');

      // 玩家迈入新岁
      const advanced = turnManager.advanceToNextYear();
      expect(advanced).toBe(true);

      // 新岁验证
      expect(turnManager.getYear()).toBe(2);
      expect(turnManager.getTurn()).toBe(1);
      expect(turnManager.getTotalYearsSurvived()).toBe(1);

      // 新岁初始修为必须严格等于结转道基 123
      expect(turnManager.getScore()).toBe(123);

      // 新岁门槛提升为 1268
      expect(turnManager.getBaseQuota()).toBe(1268);
      expect(turnManager.getQuota()).toBe(1268);

      expect(turnManager.getState()).toBe('player_action');
    });

    it('第三年门槛提升至 2473 且结转运算正确', () => {
      // Year 1 渡劫
      turnManager.getScoreManager().setScore(650);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear();
      expect(turnManager.getYear()).toBe(2);
      expect(turnManager.getQuota()).toBe(1268);

      // Year 2 积攒 1800 修为渡劫
      turnManager.getScoreManager().setScore(1800);
      const res2 = turnManager.evaluateTribulation();
      expect(res2.success).toBe(true);
      // surplus = 1800 - 1268 = 532
      expect(res2.surplus).toBe(532);
      // carryover = round(532 * 0.35) = 186.2 -> 186
      expect(res2.carryover).toBe(186);

      turnManager.advanceToNextYear();
      expect(turnManager.getYear()).toBe(3);
      expect(turnManager.getScore()).toBe(186);
      expect(turnManager.getQuota()).toBe(2473);
    });
  });

  describe('5. 未达门槛身死道消 Permadeath 终局判定 (Q4=A)', () => {
    it('修为低于天劫门槛：判定身死道消，游戏即刻终局，无法进入新岁', () => {
      // 门槛 650，修为仅 500
      turnManager.getScoreManager().setScore(500);

      const result = turnManager.evaluateTribulation();
      expect(result.success).toBe(false);
      expect(result.finalScore).toBe(500);
      expect(result.surplus).toBe(0);
      expect(result.carryover).toBe(0);

      // 身死道消终局
      expect(turnManager.getState()).toBe('game_over');

      // 拒绝进入新岁
      const advanced = turnManager.advanceToNextYear();
      expect(advanced).toBe(false);
      expect(turnManager.getYear()).toBe(1);
    });
  });

  describe('6. 存档与快照持久化', () => {
    it('GameSnapshot 完整导出并还原 year, turn, quota, baseQuota, totalYearsSurvived', () => {
      // 设定跨岁后状态
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear({ quotaDiscount: 0.8 });

      // 在 Year 2 走了 3 回合
      turnManager.executeWait();
      turnManager.executeWait();
      turnManager.executeWait();

      expect(turnManager.getYear()).toBe(2);
      expect(turnManager.getTurn()).toBe(4);
      expect(turnManager.getQuotaDiscount()).toBe(0.8);
      expect(turnManager.getTotalYearsSurvived()).toBe(1);

      // 导出快照
      const snapshot = turnManager.exportSnapshot();
      expect(snapshot.year).toBe(2);
      expect(snapshot.turn).toBe(4);
      expect(snapshot.baseQuota).toBe(1268);
      expect(snapshot.quota).toBe(1014); // 1268 * 0.8
      expect(snapshot.quotaDiscount).toBe(0.8);
      expect(snapshot.totalYearsSurvived).toBe(1);

      // 还原至全新 TurnManager
      const newTurnManager = new TurnManager();
      newTurnManager.importSnapshot(snapshot);

      expect(newTurnManager.getYear()).toBe(2);
      expect(newTurnManager.getTurn()).toBe(4);
      expect(newTurnManager.getBaseQuota()).toBe(1268);
      expect(newTurnManager.getQuota()).toBe(1014);
      expect(newTurnManager.getQuotaDiscount()).toBe(0.8);
      expect(newTurnManager.getTotalYearsSurvived()).toBe(1);
    });
  });

  describe('7. 前端 UI Store 状态同步与交互', () => {
    it('GameStore 正确同步年岁状态，天劫降临时自动弹出大考弹窗', async () => {
      const tm = new TurnManager();
      await tm.initialize();
      useGameStore.setState({ turnManager: tm });
      bindTurnManagerCallbacks(tm, useGameStore.setState, useGameStore.getState);
      tm.startGame();
      useGameStore.getState()._sync();

      // 模拟第 20 回合前夕
      tm.getScoreManager().setScore(1000);

      // 触发大考
      tm.evaluateTribulation();

      const updatedStore = useGameStore.getState();
      expect(updatedStore.isTribulationModalOpen).toBe(true);
      expect(updatedStore.tribulationResult).not.toBeNull();
      expect(updatedStore.tribulationResult!.success).toBe(true);
      expect(updatedStore.tribulationResult!.carryover).toBe(123);

      // 点击进阶
      const advanced = updatedStore.advanceToNextYear();
      expect(advanced).toBe(true);

      const afterStore = useGameStore.getState();
      expect(afterStore.isTribulationModalOpen).toBe(false);
      expect(afterStore.year).toBe(2);
      expect(afterStore.turn).toBe(1);
      expect(afterStore.score).toBe(123);
      expect(afterStore.quota).toBe(1268);
    });
  });
});
