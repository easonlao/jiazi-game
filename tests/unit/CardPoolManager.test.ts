import { describe, it, expect } from 'vitest';
import { CardPoolManager } from '../../src/core/CardPoolManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

describe('CardPoolManager', () => {
  const cards = [
    new JiaziCard({ id: 1, name: '甲子', tianGan: '甲', diZhi: '子', tianGanElement: Element.WOOD, diZhiElement: Element.WATER, mainElement: Element.WOOD, yinYang: YinYang.YANG }),
    new JiaziCard({ id: 2, name: '乙丑', tianGan: '乙', diZhi: '丑', tianGanElement: Element.WOOD, diZhiElement: Element.EARTH, mainElement: Element.WOOD, yinYang: YinYang.YIN }),
    new JiaziCard({ id: 3, name: '丙寅', tianGan: '丙', diZhi: '寅', tianGanElement: Element.FIRE, diZhiElement: Element.WOOD, mainElement: Element.FIRE, yinYang: YinYang.YANG }),
    new JiaziCard({ id: 4, name: '丁卯', tianGan: '丁', diZhi: '卯', tianGanElement: Element.FIRE, diZhiElement: Element.WOOD, mainElement: Element.FIRE, yinYang: YinYang.YIN })
  ];

  it('初始化牌堆', () => {
    const cpm = new CardPoolManager();
    cpm.initialize(cards);
    expect(cpm.getDeckSize()).toBe(4);
    expect(cpm.getPublicCards()).toEqual([]);
  });

  it('从牌堆抽牌', () => {
    const cpm = new CardPoolManager();
    cpm.initialize(cards);
    
    const drawn = cpm.drawCards();
    expect(drawn.length).toBe(2);
    expect(cpm.getPublicCards().length).toBe(2);
    expect(cpm.getDeckSize()).toBe(2);
  });

  it('购买公共牌并回收未选中卡牌', () => {
    const cpm = new CardPoolManager();
    cpm.initialize(cards);
    cpm.drawCards(); // 剩下 2 张在牌堆，2 张在展示池

    const publicCardsBefore = [...cpm.getPublicCards()];
    const bought = cpm.buyCard(0);
    expect(bought).toBe(publicCardsBefore[0]);
    // 未选择的 publicCardsBefore[1] 应该回洗入牌堆
    expect(cpm.getPublicCards().length).toBe(0);
    expect(cpm.getDeckSize()).toBe(3); // 初始4张，买走1张，剩下3张
  });

  it('加载牌堆和牌池状态 (loadState)', () => {
    const cpm = new CardPoolManager();
    const restoredDeck = [cards[0], cards[1]];
    const restoredPublic = [cards[2]];
    
    cpm.loadState(restoredDeck, restoredPublic);
    expect(cpm.getDeckSize()).toBe(2);
    expect(cpm.getPublicCards()).toEqual([cards[2]]);
  });
});
