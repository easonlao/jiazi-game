import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { HandManager } from '../../src/core/HandManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';
import { TRIADS, TriadManager } from '../../src/core/TriadManager';
import { ScoreManager } from '../../src/core/ScoreManager';

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

// 模拟 60 甲子卡牌库（包含关键三合地支）
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
  { id: 11, name: '甲戌', tianGan: '甲', diZhi: '戌', tianGanElement: 'wood', diZhiElement: 'earth', mainElement: 'wood', yinYang: 'yang' },
  { id: 12, name: '乙亥', tianGan: '乙', diZhi: '亥', tianGanElement: 'wood', diZhiElement: 'water', mainElement: 'wood', yinYang: 'yin' },
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

describe('TriadManager & Elemental Specialization', () => {
  // 水局：申子辰
  const cardShen = createCard(9, '壬申', '申', Element.WATER);
  const cardZi = createCard(1, '甲子', '子', Element.WATER);
  const cardChen = createCard(5, '戊辰', '辰', Element.EARTH);

  // 火局：寅午戌
  const cardYin = createCard(3, '丙寅', '寅', Element.FIRE);
  const cardWu = createCard(7, '庚午', '午', Element.FIRE);
  const cardXu = createCard(11, '甲戌', '戌', Element.FIRE);

  // 金局：巳酉丑
  const cardSi = createCard(6, '己巳', '巳', Element.METAL);
  const cardYou = createCard(10, '癸酉', '酉', Element.METAL);
  const cardChou = createCard(2, '乙丑', '丑', Element.METAL);

  // 木局：亥卯未
  const cardHai = createCard(12, '乙亥', '亥', Element.WOOD);
  const cardMao = createCard(4, '丁卯', '卯', Element.WOOD);
  const cardWei = createCard(8, '辛未', '未', Element.WOOD);

  describe('1. 四大正统合局定义与跨丹田/地脉检测', () => {
    it('四大合局定义正确：申子辰水、寅午戌火、巳酉丑金、亥卯未木', () => {
      expect(TRIADS).toHaveLength(4);
      expect(TRIADS.find((t) => t.element === Element.WATER)?.branches).toEqual(['申', '子', '辰']);
      expect(TRIADS.find((t) => t.element === Element.FIRE)?.branches).toEqual(['寅', '午', '戌']);
      expect(TRIADS.find((t) => t.element === Element.METAL)?.branches).toEqual(['巳', '酉', '丑']);
      expect(TRIADS.find((t) => t.element === Element.WOOD)?.branches).toEqual(['亥', '卯', '未']);
    });

    it('跨丹田与地脉自动检索：2 丹田 + 1 地脉可成局', () => {
      const tm = new TriadManager();
      // 申、子在丹田，辰在地脉
      const cards = [cardShen, cardZi, cardChen];
      const candidates = tm.checkTriads(cards);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].element).toBe(Element.WATER);
      expect(candidates[0].name).toBe('申子辰合水局');
      expect(candidates[0].bonus).toBe(450);
      expect(candidates[0].nextMultiplier).toBe(1.25);
    });

    it('缺少一支时无法成局', () => {
      const tm = new TriadManager();
      const candidates = tm.checkTriads([cardShen, cardZi]);
      expect(candidates).toHaveLength(0);
    });

    it('绝杀成局检测：持有两支时，卡池第三支被标记为绝杀成局', () => {
      const tm = new TriadManager();
      // 手牌持有 申、子
      const owned = [cardShen, cardZi];
      // 辰为第三支
      const match = tm.canCompleteTriad(cardChen, owned);
      expect(match).not.toBeNull();
      expect(match?.name).toBe('申子辰合水局');

      // 其它不相关牌（如 寅）不是绝杀牌
      expect(tm.canCompleteTriad(cardYin, owned)).toBeNull();
    });
  });

  describe('2. 引动成局：消解腾槽、神识补满、大阵修为与永久专精', () => {
    let turnManager: TurnManager;

    beforeEach(async () => {
      localStorageMock.clear();
      turnManager = new TurnManager();
      await turnManager.initialize();
      turnManager.startGame();
    });

    it('引动三合大阵：功德圆满回归牌池，槽位立刻腾空', () => {
      const cShen = turnManager.getCardById(9)!;
      const cZi = turnManager.getCardById(1)!;
      const cChen = turnManager.getCardById(5)!;

      // 丹田放入 申、子，地脉放入 辰
      turnManager.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buyToLeyline(cChen, 10, false, 1.0, 1, 5);

      expect(turnManager.getHandManager().getHandSize()).toBe(2);
      expect(turnManager.getHandManager().getLeylineSize()).toBe(1);

      // 检测成局
      expect(turnManager.canClaimTriad(Element.WATER)).toBe(true);

      // 引动成局
      const claimResult = turnManager.claimTriad(Element.WATER);
      expect(claimResult).not.toBeNull();
      expect(claimResult?.element).toBe(Element.WATER);
      expect(claimResult?.bonus).toBe(450);
      expect(claimResult?.newMultiplier).toBe(1.25);
      expect(claimResult?.dissolvedCards).toHaveLength(3);

      // 验证槽位腾空：丹田清空为 0，地脉清空为 0
      expect(turnManager.getHandManager().getHandSize()).toBe(0);
      expect(turnManager.getHandManager().getLeylineSize()).toBe(0);
      expect(turnManager.getHandManager().canBuy()).toBe(true);
      expect(turnManager.getHandManager().canAddToLeyline()).toBe(true);
    });

    it('引动成局：神识立即回满上限 (qi = maxQi)', () => {
      const cShen = turnManager.getCardById(9)!;
      const cZi = turnManager.getCardById(1)!;
      const cChen = turnManager.getCardById(5)!;

      // 消耗部分神识
      turnManager.getQiManager().deductQi(50);
      expect(turnManager.getQi()).toBeLessThan(turnManager.getMaxQi());

      // 放入成局牌
      turnManager.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buyToLeyline(cChen, 10, false, 1.0, 1, 5);

      turnManager.claimTriad(Element.WATER);

      // 神识回满
      expect(turnManager.getQi()).toBe(turnManager.getMaxQi());
    });

    it('消解神符回归牌池：牌池守恒律严格保持', () => {
      // 从牌库获取水三合 3 张牌
      const cShen = turnManager.getCardById(9)!;
      const cZi = turnManager.getCardById(1)!;
      const cChen = turnManager.getCardById(5)!;

      // 模拟放入丹田与地脉
      turnManager.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buyToLeyline(cChen, 10, false, 1.0, 1, 5);

      // 剩余卡牌严格分配至 publicCards 与 deck，确保初始无交叉重叠
      const removeIds = new Set([9, 1, 5]);
      const remainingCards = turnManager.getCardDataBank().getAllCards().filter(c => !removeIds.has(c.id));
      const newPublicCards = remainingCards.slice(0, 3);
      const newDeck = remainingCards.slice(3);
      turnManager.getCardPoolManager().loadState(newDeck, newPublicCards);

      expect(turnManager.validateCardPoolIntegrity()).toBe(true);

      const deckBefore = turnManager.getCardPoolManager().getDeck().length;
      turnManager.claimTriad(Element.WATER);
      const deckAfter = turnManager.getCardPoolManager().getDeck().length;

      // 3 张牌回洗牌堆
      expect(deckAfter).toBe(deckBefore + 3);
      expect(turnManager.validateCardPoolIntegrity()).toBe(true);
    });

    it('五行属性专精倍率永久累加，解除四象硬锁（可单属性自由深耕）', () => {
      const cShen = turnManager.getCardById(9)!;
      const cZi = turnManager.getCardById(1)!;
      const cChen = turnManager.getCardById(5)!;

      // 第 1 次水合成局
      turnManager.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buyToLeyline(cChen, 10, false, 1.0, 1, 5);
      turnManager.claimTriad(Element.WATER);

      expect(turnManager.getElementMultiplier(Element.WATER)).toBe(1.25);
      expect(turnManager.getTriadCounts()[Element.WATER]).toBe(1);

      // 第 2 次水合成局（单修深耕）
      turnManager.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buyToLeyline(cChen, 10, false, 1.0, 1, 5);
      turnManager.claimTriad(Element.WATER);

      expect(turnManager.getElementMultiplier(Element.WATER)).toBe(1.50);
      expect(turnManager.getTriadCounts()[Element.WATER]).toBe(2);
    });
  });

  describe('3. 四象融汇 · 混元大圆满', () => {
    let turnManager: TurnManager;

    beforeEach(async () => {
      localStorageMock.clear();
      turnManager = new TurnManager();
      await turnManager.initialize();
      turnManager.startGame();
    });

    it('当水、火、金、木皆至少成局 1 次时，触发混元大圆满并激活土行真元 (+25%)', () => {
      // 1. 水局成
      turnManager.getHandManager().buy(turnManager.getCardById(9)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(1)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(5)!, 10, false, 1.0, 1, 5);
      const r1 = turnManager.claimTriad(Element.WATER);
      expect(r1?.isGrandCycle).toBe(false);
      expect(turnManager.getElementMultiplier(Element.EARTH)).toBe(1.0);

      // 2. 火局成
      turnManager.getHandManager().buy(turnManager.getCardById(3)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(7)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(11)!, 10, false, 1.0, 1, 5);
      const r2 = turnManager.claimTriad(Element.FIRE);
      expect(r2?.isGrandCycle).toBe(false);

      // 3. 金局成
      turnManager.getHandManager().buy(turnManager.getCardById(6)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(10)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(2)!, 10, false, 1.0, 1, 5);
      const r3 = turnManager.claimTriad(Element.METAL);
      expect(r3?.isGrandCycle).toBe(false);

      // 4. 木局成 -> 触发四象大圆满！
      turnManager.getHandManager().buy(turnManager.getCardById(12)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(4)!, 10, false, 1.0, 1, 5);
      turnManager.getHandManager().buy(turnManager.getCardById(8)!, 10, false, 1.0, 1, 5);
      const r4 = turnManager.claimTriad(Element.WOOD);

      expect(r4?.isGrandCycle).toBe(true);
      expect(r4?.grandBonus).toBe(Math.round(450 * 1.5)); // 675
      expect(r4?.earthMultiplier).toBe(1.25);
      expect(turnManager.getElementMultiplier(Element.EARTH)).toBe(1.25);
      expect(turnManager.getGrandCycles()).toBe(1);

      // 验证修为累加：4 次基础 450 + 混元 675 = 2475
      expect(turnManager.getScoreManager().getTotalTriadEarnings()).toBe(450 * 4 + 675);
    });
  });

  describe('4. ScoreManager 持仓炼化与波段释灵乘数应用', () => {
    it('正向持仓炼化乘以对应五行专精倍率，负向炼化不予放大惩罚', () => {
      const sm = new ScoreManager();

      // 基准：评分 10，杠杆 1.0 -> 12
      expect(sm.calculateHoldEarnings(10, 1.0, 1.0)).toBeCloseTo(12.0);
      // 专精 1.25x (+25%) -> 15.0
      expect(sm.calculateHoldEarnings(10, 1.0, 1.25)).toBeCloseTo(15.0);
      // 专精 1.50x (+50%) -> 18.0
      expect(sm.calculateHoldEarnings(10, 1.0, 1.50)).toBeCloseTo(18.0);

      // 负向逆季评分：评分 -10，杠杆 1.0 -> -12，无论专精多少都不放大亏损
      expect(sm.calculateHoldEarnings(-10, 1.0, 1.50)).toBeCloseTo(-12.0);
    });

    it('正向波段释灵乘以对应五行专精倍率，割肉亏损不予放大', () => {
      const sm = new ScoreManager({ sellMultiplier: 6 });

      // 正价差 Δ+5，杠杆 1.0 -> 30
      expect(sm.calculateSellScore(15, 10, 1.0, 1.0)).toBeCloseTo(30.0);
      // 专精 1.25x -> 37.5
      expect(sm.calculateSellScore(15, 10, 1.0, 1.25)).toBeCloseTo(37.5);

      // 逆势割肉 Δ-5，杠杆 1.0 -> -30，不扩大割肉亏损
      expect(sm.calculateSellScore(5, 10, 1.0, 1.25)).toBeCloseTo(-30.0);
    });
  });

  describe('5. 存档快照保存与深度还原', () => {
    it('三合专精倍率、成局计数、混元重数在 snapshot 中完整持久化与还原', async () => {
      const tm = new TurnManager();
      await tm.initialize();
      tm.startGame();

      const cShen = tm.getCardById(9)!;
      const cZi = tm.getCardById(1)!;
      const cChen = tm.getCardById(5)!;

      // 引动水局
      tm.getHandManager().buy(cShen, 10, false, 1.0, 1, 5);
      tm.getHandManager().buy(cZi, 10, false, 1.0, 1, 5);
      tm.getHandManager().buy(cChen, 10, false, 1.0, 1, 5);
      tm.claimTriad(Element.WATER);

      const snapshot = tm.createSnapshot();
      expect(snapshot.elemMultipliers?.water).toBe(1.25);
      expect(snapshot.triadCounts?.water).toBe(1);
      expect(snapshot.totalTriadEarnings).toBe(450);

      // 恢复至全新 TurnManager
      const freshTm = new TurnManager();
      await freshTm.initialize();
      freshTm.importSnapshot(snapshot);

      expect(freshTm.getElementMultiplier(Element.WATER)).toBe(1.25);
      expect(freshTm.getTriadCounts()[Element.WATER]).toBe(1);
      expect(freshTm.getScoreManager().getTotalTriadEarnings()).toBe(450);
    });
  });
});
