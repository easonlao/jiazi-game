import { describe, it, expect } from 'vitest';
import { HandManager } from '../../src/core/HandManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';
import { HandSlot } from '../../src/core/HandSlot';

describe('HandManager', () => {
  const mockCard = new JiaziCard({
    id: 1,
    name: '甲子',
    tianGan: '甲',
    diZhi: '子',
    tianGanElement: Element.WOOD,
    diZhiElement: Element.WATER,
    mainElement: Element.WOOD,
    yinYang: YinYang.YANG
  });

  it('初始手牌应为空位', () => {
    const hm = new HandManager();
    expect(hm.getHand()).toEqual([null, null, null]);
    expect(hm.getHandSize()).toBe(0);
    expect(hm.canBuy()).toBe(true);
    expect(hm.canSell()).toBe(false);
  });

  it('买入卡牌且手牌满仓限制', () => {
    const hm = new HandManager();
    
    // 买入第一张
    const index1 = hm.buy(mockCard, 3, 1.0, 1);
    expect(index1).toBe(0);
    expect(hm.getHandSize()).toBe(1);
    expect(hm.canSell()).toBe(true);

    // 买入第二张和第三张
    hm.buy(mockCard, 3, 1.0, 1);
    hm.buy(mockCard, 3, 1.0, 1);
    expect(hm.getHandSize()).toBe(3);
    expect(hm.canBuy()).toBe(false);

    // 第四张买入应该失败
    const index4 = hm.buy(mockCard, 3, 1.0, 1);
    expect(index4).toBe(-1);
  });

  it('卖出卡牌及强置槽位', () => {
    const hm = new HandManager();
    hm.buy(mockCard, 3, 1.0, 1);

    const slot = hm.sell(0);
    expect(slot).not.toBeNull();
    expect(slot!.card.name).toBe('甲子');
    expect(hm.getHandSize()).toBe(0);
    expect(hm.getHand()[0]).toBeNull();
  });

  it('加载外部手牌数据 (loadHand)', () => {
    const hm = new HandManager();
    const restoredSlots = [
      new HandSlot(mockCard, 3, 1.5, 1),
      null,
      new HandSlot(mockCard, 2, 1.0, 2)
    ];
    hm.loadHand(restoredSlots);
    
    expect(hm.getHandSize()).toBe(2);
    expect(hm.getSlot(0)!.leverage).toBe(1.5);
    expect(hm.getSlot(1)).toBeNull();
    expect(hm.getSlot(2)!.buyRound).toBe(2);
  });
});
