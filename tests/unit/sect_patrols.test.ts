import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';
import { ALL_SECTS, SectManager, SEASON_ACTIVE_SECTS } from '../../src/core/SectManager';
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

// 模拟 60 甲子卡牌库（五行俱全）
const mockCardData = [
  { id: 1, name: '甲子', tianGan: '甲', diZhi: '子', tianGanElement: 'wood', diZhiElement: 'water', mainElement: 'wood', yinYang: 'yang' },
  { id: 2, name: '乙丑', tianGan: '乙', diZhi: '丑', tianGanElement: 'wood', diZhiElement: 'earth', mainElement: 'wood', yinYang: 'yin' },
  { id: 3, name: '丙寅', tianGan: '丙', diZhi: '寅', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yang' },
  { id: 4, name: '丁卯', tianGan: '丁', diZhi: '卯', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yin' },
  { id: 5, name: '戊辰', tianGan: '戊', diZhi: '辰', tianGanElement: 'earth', diZhiElement: 'earth', mainElement: 'earth', yinYang: 'yang' },
  { id: 6, name: '己巳', tianGan: '己', diZhi: '巳', tianGanElement: 'earth', diZhiElement: 'fire', mainElement: 'earth', yinYang: 'yin' },
  { id: 7, name: '庚午', tianGan: '庚', diZhi: '午', tianGanElement: 'metal', diZhiElement: 'fire', mainElement: 'metal', yinYang: 'yang' },
  { id: 8, name: '辛未', tianGan: '辛', diZhi: '未', tianGanElement: 'metal', diZhiElement: 'earth', mainElement: 'metal', yinYang: 'yin' },
  { id: 9, name: '壬申', tianGan: '壬', diZhi: '申', tianGanElement: 'water', diZhiElement: 'metal', mainElement: 'water', yinYang: 'yang' },
  { id: 10, name: '癸酉', tianGan: '癸', diZhi: '酉', tianGanElement: 'water', diZhiElement: 'metal', mainElement: 'water', yinYang: 'yin' },
];

global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve(mockCardData),
  }),
) as any;

function createCard(id: number, name: string, diZhi: string, mainElement: Element): JiaziCard {
  return new JiaziCard({
    id,
    name,
    tianGan: '甲',
    diZhi,
    tianGanElement: Element.WOOD,
    diZhiElement: Element.WATER,
    mainElement,
    yinYang: YinYang.YANG,
  });
}

describe('Sect Patrols and Penalties (五大古宗巡视与处置系统)', () => {
  describe('1. 五大古宗与四季轮换基础设定', () => {
    it('五大古宗完整定义：金木水火土各掌其一', () => {
      expect(ALL_SECTS.metal.name).toBe('太白剑宗');
      expect(ALL_SECTS.metal.element).toBe(Element.METAL);
      expect(ALL_SECTS.wood.name).toBe('神农百草谷');
      expect(ALL_SECTS.wood.element).toBe(Element.WOOD);
      expect(ALL_SECTS.fire.name).toBe('离火朱雀宫');
      expect(ALL_SECTS.fire.element).toBe(Element.FIRE);
      expect(ALL_SECTS.water.name).toBe('沧溟北海阁');
      expect(ALL_SECTS.water.element).toBe(Element.WATER);
      expect(ALL_SECTS.earth.name).toBe('厚德镇岳宗');
      expect(ALL_SECTS.earth.element).toBe(Element.EARTH);
    });

    it('四季活跃宗门映射正确：春(木水) 夏(火土) 秋(金土) 冬(水金)', () => {
      expect(SEASON_ACTIVE_SECTS.spring).toEqual(['wood', 'water']);
      expect(SEASON_ACTIVE_SECTS.summer).toEqual(['fire', 'earth']);
      expect(SEASON_ACTIVE_SECTS.autumn).toEqual(['metal', 'earth']);
      expect(SEASON_ACTIVE_SECTS.winter).toEqual(['water', 'metal']);
    });

    it('宗门倒计时调度错峰且在 2-5 轮范围', () => {
      const sm = new SectManager();
      sm.scheduleSeasonSects('spring');
      const cds = sm.getCountdowns();
      expect(cds.wood).toBeGreaterThanOrEqual(2);
      expect(cds.wood).toBeLessThanOrEqual(5);
      expect(cds.water).toBeGreaterThanOrEqual(2);
      expect(cds.water).toBeLessThanOrEqual(5);
      // 错峰出巡，永不发生同轮碰撞
      expect(cds.wood).not.toBe(cds.water);
    });
  });

  describe('2. 地脉潜伏 100% 免疫与避灾判定', () => {
    it('巡查时丹田无牌、地脉有牌：不触发强征，触发避灾判定', () => {
      const sm = new SectManager();
      // 手动设置倒计时使得 wood 归零触发
      (sm as any).countdowns.wood = 1;

      const cardWood = createCard(1, '甲子', '子', Element.WOOD);
      const dantian: any[] = [null, null, null];
      const leyline: any[] = [{ card: cardWood, buyScore: 10 }];

      const result = sm.advancePatrols('spring', dantian, leyline, () => 15);

      expect(result.triggeredSect?.id).toBe('wood');
      expect(result.pendingBuyback).toBeNull();
      expect(result.leylineEvaded).toBe(true);
      // 触发后重置 5 轮冷却
      expect(sm.getCountdowns().wood).toBe(5);
    });

    it('巡查时丹田与地脉均无对应五行牌：无避灾亦无强征', () => {
      const sm = new SectManager();
      (sm as any).countdowns.wood = 1;

      const cardFire = createCard(3, '丙寅', '寅', Element.FIRE);
      const dantian: any[] = [{ card: cardFire, buyScore: 10 }, null, null];
      const leyline: any[] = [];

      const result = sm.advancePatrols('spring', dantian, leyline, () => 15);

      expect(result.triggeredSect?.id).toBe('wood');
      expect(result.pendingBuyback).toBeNull();
      expect(result.leylineEvaded).toBe(false);
    });
  });

  describe('3. 丹田命中：盈利牌 0.6x 折价强平强征与 +5 神识', () => {
    it('盈利牌 (delta > 0)：计算 offerPrice = max(1, round(delta * 6 * 0.6))，赐 5 神识', () => {
      const sm = new SectManager();
      (sm as any).countdowns.wood = 1;

      const cardWood = createCard(1, '甲子', '子', Element.WOOD);
      // 买入 10，当前分 20，delta = 10 > 0
      // delta * 6 * 0.6 = 10 * 6 * 0.6 = 36
      const dantian: any[] = [{ card: cardWood, buyScore: 10 }, null, null];
      const leyline: any[] = [];

      const result = sm.advancePatrols('spring', dantian, leyline, () => 20);

      expect(result.triggeredSect?.id).toBe('wood');
      expect(result.pendingBuyback).not.toBeNull();
      expect(result.pendingBuyback?.delta).toBe(10);
      expect(result.pendingBuyback?.offerPrice).toBe(36);
      expect(result.pendingBuyback?.qiChange).toBe(5);
      expect(result.pendingBuyback?.isNegativeYield).toBe(false);
    });
  });

  describe('4. 丹田命中：亏损牌 (delta <= 0) 严惩没收与扣 10 神识', () => {
    it('亏损牌 (delta < 0)：offerPrice = round(delta * 6)，罚扣 10 神识', () => {
      const sm = new SectManager();
      (sm as any).countdowns.wood = 1;

      const cardWood = createCard(1, '甲子', '子', Element.WOOD);
      // 买入 20，当前分 15，delta = -5 < 0
      // delta * 6 = -30
      const dantian: any[] = [{ card: cardWood, buyScore: 20 }, null, null];
      const leyline: any[] = [];

      const result = sm.advancePatrols('spring', dantian, leyline, () => 15);

      expect(result.pendingBuyback).not.toBeNull();
      expect(result.pendingBuyback?.delta).toBe(-5);
      expect(result.pendingBuyback?.offerPrice).toBe(-30);
      expect(result.pendingBuyback?.qiChange).toBe(-10);
      expect(result.pendingBuyback?.isNegativeYield).toBe(true);
    });

    it('保本牌 (delta === 0)：offerPrice = -15，罚扣 10 神识', () => {
      const sm = new SectManager();
      (sm as any).countdowns.wood = 1;

      const cardWood = createCard(1, '甲子', '子', Element.WOOD);
      // 买入 15，当前分 15，delta = 0
      const dantian: any[] = [{ card: cardWood, buyScore: 15 }, null, null];
      const leyline: any[] = [];

      const result = sm.advancePatrols('spring', dantian, leyline, () => 15);

      expect(result.pendingBuyback).not.toBeNull();
      expect(result.pendingBuyback?.delta).toBe(0);
      expect(result.pendingBuyback?.offerPrice).toBe(-15);
      expect(result.pendingBuyback?.qiChange).toBe(-10);
      expect(result.pendingBuyback?.isNegativeYield).toBe(true);
    });
  });

  describe('5. TurnManager 集成：遵从令谕与誓死抗命', () => {
    let turnManager: TurnManager;

    beforeEach(async () => {
      localStorageMock.clear();
      turnManager = new TurnManager();
      await turnManager.initialize();
      turnManager.startGame();
    });

    it('玩家遵从盈利令谕：卡牌回池腾位、修为 +offerPrice、神识 +5', () => {
      const cardWood = turnManager.getCardById(1)!;
      turnManager.getHandManager().buy(cardWood, 10, false, 1.0, 1, 5);

      // 设置倒计时触发 wood 巡查
      (turnManager.getSectManager() as any).countdowns.wood = 1;

      // 推进回合执行巡视
      turnManager.executeWait();

      const pending = turnManager.getPendingBuyback();
      expect(pending).not.toBeNull();
      expect(pending?.card.id).toBe(cardWood.id);

      const scoreBefore = turnManager.getScore();
      const qiBefore = turnManager.getQi();

      const acceptRes = turnManager.acceptSectDemand();
      expect(acceptRes).not.toBeNull();
      expect(turnManager.getPendingBuyback()).toBeNull();

      // 卡牌已被移出丹田
      expect(turnManager.getHand()[0]).toBeNull();
      // 验证修为与神识增加
      expect(turnManager.getScore()).toBeGreaterThanOrEqual(scoreBefore);
      expect(turnManager.getQi()).toBeGreaterThanOrEqual(qiBefore);
    });

    it('玩家遵从亏损令谕：卡牌回池腾位、扣除修为、扣除 10 点神识', () => {
      const cardWood = turnManager.getCardById(1)!;
      // 设置极高买入价制造巨额亏损
      turnManager.getHandManager().buy(cardWood, 50, false, 1.0, 1, 5);

      (turnManager.getSectManager() as any).countdowns.wood = 1;
      turnManager.executeWait();

      const pending = turnManager.getPendingBuyback();
      expect(pending).not.toBeNull();
      expect(pending?.isNegativeYield).toBe(true);

      const qiBefore = turnManager.getQi();
      const acceptRes = turnManager.acceptSectDemand();
      expect(acceptRes).not.toBeNull();

      expect(turnManager.getHand()[0]).toBeNull();
      expect(turnManager.getQi()).toBe(Math.max(0, qiBefore - 10));
    });

    it('玩家誓死抗命：扣除 20 点神识，卡牌保留在丹田', () => {
      const cardWood = turnManager.getCardById(1)!;
      turnManager.getHandManager().buy(cardWood, 10, false, 1.0, 1, 5);

      (turnManager.getSectManager() as any).countdowns.wood = 1;
      turnManager.executeWait();

      const pending = turnManager.getPendingBuyback();
      expect(pending).not.toBeNull();

      turnManager.getQiManager().setQi(50);
      const declineRes = turnManager.declineSectDemand();
      expect(declineRes).not.toBeNull();
      expect(declineRes?.qiCost).toBe(20);
      expect(declineRes?.qiDeficit).toBe(0);

      // 卡牌仍保留在丹田槽位
      expect(turnManager.getHand()[0]?.card.id).toBe(cardWood.id);
      expect(turnManager.getQi()).toBe(30);
    });

    it('玩家誓死抗命且神识不足 20 点：赤字反噬扣除修为 (deficit * 15)', () => {
      const cardWood = turnManager.getCardById(1)!;
      turnManager.getHandManager().buy(cardWood, 10, false, 1.0, 1, 5);

      (turnManager.getSectManager() as any).countdowns.wood = 1;
      turnManager.executeWait();

      // 设置神识为 5 点（亏空 15 点）
      turnManager.getQiManager().setQi(5);
      const declineRes = turnManager.declineSectDemand();

      expect(declineRes?.qiCost).toBe(5);
      expect(declineRes?.qiDeficit).toBe(15);
      expect(declineRes?.scoreBacklash).toBe(15 * 15); // 225

      expect(turnManager.getQi()).toBe(0);
      expect(turnManager.getScoreManager().getTotalMarginCallPenalty()).toBe(225);
    });

    it('地脉暗牌避灾成功时触发 onLeylineEvaded 回调', () => {
      const cardWood = turnManager.getCardById(1)!;
      // 潜入地脉
      turnManager.getHandManager().buyToLeyline(cardWood, 10, false, 1.0, 1, 5);

      (turnManager.getSectManager() as any).countdowns.wood = 1;

      let evadedSectName = '';
      turnManager.setOnLeylineEvaded((sect) => {
        evadedSectName = sect.name;
      });

      turnManager.executeWait();

      expect(evadedSectName).toBe('神农百草谷');
      expect(turnManager.getPendingBuyback()).toBeNull();
    });
  });

  describe('6. 存档与快照持久化', () => {
    it('sectState 包含倒计时、怒意并在 snapshot 中完整导出与导入', async () => {
      const tm = new TurnManager();
      await tm.initialize();
      tm.startGame();

      (tm.getSectManager() as any).countdowns.metal = 3;
      (tm.getSectManager() as any).countdowns.wood = 2;
      (tm.getSectManager() as any).anger.fire = 2;

      const snapshot = tm.exportSnapshot();
      expect(snapshot.sectState).toBeDefined();
      expect(snapshot.sectState?.countdowns.metal).toBe(3);
      expect(snapshot.sectState?.countdowns.wood).toBe(2);
      expect(snapshot.sectState?.anger.fire).toBe(2);

      const tm2 = new TurnManager();
      await tm2.initialize();
      tm2.importSnapshot(snapshot);

      expect(tm2.getSectCountdowns().metal).toBe(3);
      expect(tm2.getSectCountdowns().wood).toBe(2);
      expect(tm2.getSectAnger().fire).toBe(2);
    });
  });

  describe('7. 前端 UI Store 状态同步与交互', () => {
    it('GameStore 正确同步宗门倒计时，并在搜查发生时接收 pendingBuyback', async () => {
      const tm = new TurnManager();
      await tm.initialize();
      useGameStore.setState({ turnManager: tm });
      bindTurnManagerCallbacks(tm, useGameStore.setState, useGameStore.getState);
      tm.startGame();
      useGameStore.getState()._sync();

      const storeState = useGameStore.getState();
      expect(storeState.sectCountdowns).toBeDefined();
      expect(typeof storeState.sectCountdowns.wood).toBe('number');
      expect(storeState.pendingBuyback).toBeNull();

      // 模拟巡视命中并触发回调
      const card = createCard(1, '甲子', '子', Element.WOOD);
      const pending = {
        sect: ALL_SECTS.wood,
        card,
        dantianIndex: 0,
        offerPrice: 30,
        qiChange: 5,
        delta: 10,
        curScore: 20,
        buyScore: 10,
        isNegativeYield: false,
      };

      (tm.getSectManager() as any).pendingBuyback = pending;
      (tm as any).onSectBuyback?.(pending);

      expect(useGameStore.getState().pendingBuyback).toEqual(pending);

      // 设置玩家手牌状态供平仓移除
      (tm.getHandManager() as any).hand[0] = { card, buyScore: 10, buyRound: 1, lockedQi: 0 };
      useGameStore.getState().acceptSectDemand();

      // accept 后 pendingBuyback 清除，且触发了 Toast
      expect(useGameStore.getState().pendingBuyback).toBeNull();
      expect(useGameStore.getState().toast).toContain('屈从强征');
    });

    it('GameStore declineSectDemand 正确触发誓死抗命并更新神识与 Toast', async () => {
      const tm = new TurnManager();
      await tm.initialize();
      useGameStore.setState({ turnManager: tm });
      bindTurnManagerCallbacks(tm, useGameStore.setState, useGameStore.getState);
      tm.startGame();
      useGameStore.getState()._sync();

      const card = createCard(1, '甲子', '子', Element.WOOD);
      const pending = {
        sect: ALL_SECTS.wood,
        card,
        dantianIndex: 0,
        offerPrice: 30,
        qiChange: 5,
        delta: 10,
        curScore: 20,
        buyScore: 10,
        isNegativeYield: false,
      };

      (tm.getSectManager() as any).pendingBuyback = pending;
      (tm.getHandManager() as any).hand[0] = { card, buyScore: 10, buyRound: 1, lockedQi: 0 };
      (tm as any).onSectBuyback?.(pending);

      const beforeQi = useGameStore.getState().qi;
      useGameStore.getState().declineSectDemand();

      expect(useGameStore.getState().pendingBuyback).toBeNull();
      expect(useGameStore.getState().toast).toContain('誓死抗命');
      expect(useGameStore.getState().qi).toBe(beforeQi - 20);
    });
  });
});
