import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { HandManager } from '../../src/core/HandManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';
import { HandSlot } from '../../src/core/HandSlot';

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
  }
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 Fetch 卡牌 JSON 数据
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () =>
      Promise.resolve([
        { id: 1, name: '甲子', tianGan: '甲', diZhi: '子', tianGanElement: 'wood', diZhiElement: 'water', mainElement: 'wood', yinYang: 'yang' },
        { id: 2, name: '乙丑', tianGan: '乙', diZhi: '丑', tianGanElement: 'wood', diZhiElement: 'earth', mainElement: 'wood', yinYang: 'yin' },
        { id: 3, name: '丙寅', tianGan: '丙', diZhi: '寅', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yang' },
        { id: 4, name: '丁卯', tianGan: '丁', diZhi: '卯', tianGanElement: 'fire', diZhiElement: 'wood', mainElement: 'fire', yinYang: 'yin' },
        { id: 5, name: '戊辰', tianGan: '戊', diZhi: '辰', tianGanElement: 'earth', diZhiElement: 'earth', mainElement: 'earth', yinYang: 'yang' },
        { id: 6, name: '己巳', tianGan: '己', diZhi: '巳', tianGanElement: 'earth', diZhiElement: 'fire', mainElement: 'earth', yinYang: 'yin' },
      ])
  })
) as any;

describe('HandManager - 5 槽位体系 (3 活跃丹田 + 2 潜伏地脉)', () => {
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

  it('初始状态：3 丹田位为空，2 地脉位为空，默认容量 maxLeyline=2', () => {
    const hm = new HandManager();
    expect(hm.getHand()).toEqual([null, null, null]);
    expect(hm.getDantian()).toEqual([null, null, null]);
    expect(hm.getHandSize()).toBe(0);
    expect(hm.getDantianSize()).toBe(0);
    expect(hm.getLeylineCards()).toEqual([]);
    expect(hm.getLeylineSize()).toBe(0);
    expect(hm.getMaxLeyline()).toBe(2);
    expect(hm.canBuy()).toBe(true);
    expect(hm.canAddToLeyline()).toBe(true);
    expect(hm.isLeylineSoftCapped()).toBe(false);
  });

  it('丹田与地脉的直接购入与容量限制', () => {
    const hm = new HandManager();

    // 购入 3 张丹田牌
    expect(hm.buy(mockCard, 10, false, 1.0, 1, 5)).toBe(0);
    expect(hm.buy(mockCard, 10, false, 1.0, 1, 5)).toBe(1);
    expect(hm.buy(mockCard, 10, false, 1.0, 1, 5)).toBe(2);
    expect(hm.canBuy()).toBe(false);
    expect(hm.buy(mockCard, 10, false, 1.0, 1, 5)).toBe(-1); // 满仓拦截

    // 购入 2 张地脉牌
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(0);
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(1);
    expect(hm.canAddToLeyline()).toBe(false);
    expect(hm.isLeylineSoftCapped()).toBe(true);
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(-1); // 软超限拦截

    // 总持牌数应为 5
    expect(hm.getAllCards().length).toBe(5);
  });

  it('槽位流转：moveToLeyline 与 moveToDantian', () => {
    const hm = new HandManager();
    hm.buy(mockCard, 10, false, 1.0, 1, 5); // 丹田 slot 0
    expect(hm.getHandSize()).toBe(1);
    expect(hm.getLeylineSize()).toBe(0);

    // 丹田移入地脉
    const moveDownSuccess = hm.moveToLeyline(0);
    expect(moveDownSuccess).toBe(true);
    expect(hm.getHandSize()).toBe(0);
    expect(hm.getHand()[0]).toBeNull();
    expect(hm.getLeylineSize()).toBe(1);
    expect(hm.getLeylineCards()[0].card.name).toBe('甲子');

    // 地脉升入丹田
    const moveUpSuccess = hm.moveToDantian(0);
    expect(moveUpSuccess).toBe(true);
    expect(hm.getHandSize()).toBe(1);
    expect(hm.getHand()[0]).not.toBeNull();
    expect(hm.getLeylineSize()).toBe(0);
  });

  it('软超限（Soft Cap）边界机制：须弥芥子单岁扩槽与缩回存续', () => {
    const hm = new HandManager();
    // 选定须弥芥子：临时扩至 3 格
    hm.setMaxLeyline(3);
    expect(hm.getMaxLeyline()).toBe(3);

    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(0);
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(1);
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(2);
    expect(hm.getLeylineSize()).toBe(3);

    // 岁末机缘注销，缩回 2 格
    hm.setMaxLeyline(2);
    expect(hm.getMaxLeyline()).toBe(2);
    expect(hm.isLeylineSoftCapped()).toBe(true);
    expect(hm.canAddToLeyline()).toBe(false);

    // 软超限保障：既有 3 张牌完好存留，未被强行丢弃
    expect(hm.getLeylineSize()).toBe(3);
    expect(hm.getLeylineCards().length).toBe(3);

    // 丹田有牌尝试下沉，应被严格拦截
    hm.buy(mockCard, 10, false, 1.0, 1, 5);
    expect(hm.moveToLeyline(0)).toBe(false);

    // 尝试直接纳灵入地脉，应被严格拦截
    expect(hm.buyToLeyline(mockCard, 10, false, 1.0, 1, 5)).toBe(-1);

    // 既有牌可释灵卖出：卖出 1 张后变为 2 张（2 >= 2 依然处于软超限）
    const sold = hm.sellLeyline(0);
    expect(sold).not.toBeNull();
    expect(hm.getLeylineSize()).toBe(2);
    expect(hm.canAddToLeyline()).toBe(false);

    // 再卖出 1 张后变为 1 张（1 < 2，自然恢复迁入资格）
    hm.sellLeyline(0);
    expect(hm.getLeylineSize()).toBe(1);
    expect(hm.canAddToLeyline()).toBe(true);
    expect(hm.moveToLeyline(0)).toBe(true); // 此时丹田牌成功下沉
    expect(hm.getLeylineSize()).toBe(2);
  });
});

describe('TurnManager - 地脉集成推进、耗神与释灵', () => {
  let tm: TurnManager;

  beforeEach(async () => {
    localStorage.clear();
    tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
  });

  it('moveToLeyline: 下沉地脉消耗 5 神识并推进 1 回合', () => {
    // 先买入丹田 0 号位
    expect(tm.executeBuy(0, false)).toBe(true);
    const roundAfterBuy = tm.getCurrentRound();
    const qiAfterBuy = tm.getQi();
    expect(tm.getHand().filter(s => s !== null).length).toBe(1);
    expect(tm.getLeylineCards().length).toBe(0);

    // 丹田下沉地脉
    const successMove = tm.moveToLeyline(0);
    expect(successMove).toBe(true);

    // 验证：推进了 1 回合
    expect(tm.getCurrentRound()).toBe(roundAfterBuy + 1);
    // 验证：丹田已空，地脉已有 1 张卡
    expect(tm.getHand().filter(s => s !== null).length).toBe(0);
    expect(tm.getLeylineCards().length).toBe(1);
    // 验证：消耗 5 点神识（扣除 5 神识后经历一轮自然回神）
    // 自然回神为 12 点，所以下沉后神识净变化约为 +7 ( -5 消耗 + 12 自然回气 )
    expect(tm.getQi()).toBe(qiAfterBuy - 5 + tm.getBaseRecovery());
  });

  it('moveToLeyline: 神识不足 5 点时拦截下沉', () => {
    expect(tm.executeBuy(0, false)).toBe(true);
    // 强制抽干神识至 3
    (tm as any).qiManager.setQi(3);
    expect(tm.getQi()).toBe(3);

    const success = tm.moveToLeyline(0);
    expect(success).toBe(false);
    expect(tm.getLeylineCards().length).toBe(0);
  });

  it('moveToDantian: 地脉升入丹田消耗 0 神识并推进 1 回合', () => {
    // 先下沉入地脉
    tm.executeBuy(0, false);
    tm.moveToLeyline(0);
    expect(tm.getLeylineCards().length).toBe(1);
    expect(tm.getHand().filter(s => s !== null).length).toBe(0);

    const roundBefore = tm.getCurrentRound();
    const qiBefore = tm.getQi();

    // 升腾入丹田
    const success = tm.moveToDantian(0);
    expect(success).toBe(true);

    // 验证：推进 1 回合
    expect(tm.getCurrentRound()).toBe(roundBefore + 1);
    // 验证：地脉移出，丹田出现
    expect(tm.getLeylineCards().length).toBe(0);
    expect(tm.getHand().filter(s => s !== null).length).toBe(1);
    // 验证：消耗 0 神识，进入丹田后结算自然回气减去该卡在丹田的维持耗神
    const settlement = (tm as any).lastSettlementDetail;
    const holdQiCost = settlement?.holdQiCost ?? 0;
    expect(tm.getQi()).toBe(qiBefore + tm.getBaseRecovery() - holdQiCost);
  });

  it('moveToDantian: 丹田已满 3 槽时拦截升入', () => {
    // 先放 1 张在地脉
    tm.executeBuy(0, false);
    tm.moveToLeyline(0);
    expect(tm.getLeylineCards().length).toBe(1);

    // 丹田买满 3 张
    tm.executeBuy(0, false);
    tm.executeBuy(0, false);
    tm.executeBuy(0, false);
    expect(tm.getHand().filter(s => s !== null).length).toBe(3);

    // 升腾入丹田应被拦截
    const success = tm.moveToDantian(0);
    expect(success).toBe(false);
    expect(tm.getLeylineCards().length).toBe(1);
  });

  it('buyToLeyline: 直接纳灵入地脉，消耗 基础耗神+5封印费 并推进 1 轮', () => {
    const roundBefore = tm.getCurrentRound();
    const qiBefore = tm.getQi();

    const success = tm.buyToLeyline(0, false);
    expect(success).toBe(true);

    expect(tm.getCurrentRound()).toBe(roundBefore + 1);
    expect(tm.getLeylineCards().length).toBe(1);
    expect(tm.getHand().filter(s => s !== null).length).toBe(0);

    // 验证地脉卡牌的 lockedQi 包含在总锁定气中
    expect(tm.getTotalLockedQi()).toBeGreaterThan(0);
  });

  it('buyToLeyline: 软超限拦截，地脉满时拒绝新购', () => {
    expect(tm.buyToLeyline(0, false)).toBe(true);
    expect(tm.buyToLeyline(0, false)).toBe(true);
    expect(tm.getLeylineCards().length).toBe(2);

    // 第 3 张直接购买入地脉应被拦截
    const failBuy = tm.buyToLeyline(0, false);
    expect(failBuy).toBe(false);
    expect(tm.getLeylineCards().length).toBe(2);
  });

  it('executeSellLeyline: 在地脉上直接释灵变现，按正统 Delta Trading 结算', () => {
    tm.buyToLeyline(0, false);
    expect(tm.getLeylineCards().length).toBe(1);
    const lockedBefore = tm.getTotalLockedQi();
    expect(lockedBefore).toBeGreaterThan(0);

    const roundBefore = tm.getCurrentRound();
    const scoreBefore = tm.getScore();

    // 在地脉上执行释灵
    const successSell = tm.sellLeyline(0);
    expect(successSell).toBe(true);

    expect(tm.getCurrentRound()).toBe(roundBefore + 1);
    expect(tm.getLeylineCards().length).toBe(0);
    // 锁定气已退回
    expect(tm.getTotalLockedQi()).toBe(0);
    // 结算收益已累加至总修为
    expect(tm.getTotalSells()).toBe(1);
  });

  it('0 维持费验证：地脉暗牌不扣除任何周天持仓耗神，亦不产生炼化收益', () => {
    // 丹田持牌 vs 地脉持牌
    tm.executeBuy(0, false); // 丹田牌
    const qiWithDantian = tm.getQi();

    // 让丹田牌下沉到地脉
    tm.moveToLeyline(0);
    expect(tm.getHand().filter(s => s !== null).length).toBe(0);
    expect(tm.getLeylineCards().length).toBe(1);

    const qiBeforeWait = tm.getQi();
    // 执行调息推进 1 轮
    tm.executeWait();

    // 因为丹田为空，地脉牌 0 维持费，当前回合不扣任何持仓耗神（holdQiCost === 0）
    expect(tm.getCurrentHoldQiCost()).toBe(0);
  });

  it('游戏存档与读档完整还原地脉卡牌与上限', async () => {
    tm.buyToLeyline(0, false);
    expect(tm.getLeylineCards().length).toBe(1);
    const leylineCardName = tm.getLeylineCards()[0].card.name;

    // 保存存档
    tm.saveGame();

    // 创建全新 TurnManager 实例读取存档
    const tmNew = new TurnManager();
    await tmNew.initialize();
    tmNew.loadGame();

    expect(tmNew.getLeylineCards().length).toBe(1);
    expect(tmNew.getLeylineCards()[0].card.name).toBe(leylineCardName);
    expect(tmNew.getMaxLeyline()).toBe(2);
  });
});
