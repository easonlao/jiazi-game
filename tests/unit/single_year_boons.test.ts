import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager, calculateAnnualQuota, type TribulationResult } from '../../src/core/TurnManager';
import { SINGLE_YEAR_BOONS, type SingleYearBoonId } from '../../src/core/SingleYearBoon';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

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

function createCard(id: number, name: string, mainElement: Element, diZhi: string): JiaziCard {
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

describe('Single-Year Boons and Soft-Cap Lifecycle (单岁护航造化 3 选 1 与岁末重置软超限闭环)', () => {
  let turnManager: TurnManager;

  beforeEach(() => {
    localStorageMock.clear();
    turnManager = new TurnManager();
    turnManager.startGame();
  });

  describe('1. 单岁造化配置与 3 选 1 效果注入', () => {
    it('造化静态配置完整包含须弥芥子、太乙金丹与欺天灵符', () => {
      expect(SINGLE_YEAR_BOONS.xumi.name).toBe('须弥芥子');
      expect(SINGLE_YEAR_BOONS.taiyi.name).toBe('太乙金丹');
      expect(SINGLE_YEAR_BOONS.qitian.name).toBe('欺天灵符');
    });

    it('【须弥芥子】：当岁地脉上限扩至 3 格', () => {
      // 初始首年：maxLeyline = 2
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(2);
      expect(turnManager.getActiveBoon()).toBe('none');

      // 渡过首年天劫并选择须弥芥子
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      const advanced = turnManager.advanceToNextYear('xumi');

      expect(advanced).toBe(true);
      expect(turnManager.getYear()).toBe(2);
      expect(turnManager.getActiveBoon()).toBe('xumi');
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(3);
    });

    it('【太乙金丹】：当岁神识上限提至 130，每轮回神额外 +5', () => {
      const baseMaxQi = turnManager.getBalanceConfig().maxQi;
      expect(turnManager.getQiManager().getMaxQi()).toBe(baseMaxQi);
      expect(turnManager.getQiManager().getBaseRecovery()).toBe(10);
      expect(turnManager.getExtraRegen()).toBe(0);

      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('taiyi');

      expect(turnManager.getActiveBoon()).toBe('taiyi');
      expect(turnManager.getQiManager().getMaxQi()).toBe(130);
      expect(turnManager.getExtraRegen()).toBe(5);
      expect(turnManager.getQiManager().getBaseRecovery()).toBe(15); // 10 + 5
    });

    it('【欺天灵符】：当岁天劫门槛直接减免 20%（0.8x 折扣）', () => {
      // 首年过劫，基准 650 * 1.95 = 1268
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('qitian');

      expect(turnManager.getActiveBoon()).toBe('qitian');
      expect(turnManager.getQuotaDiscount()).toBe(0.8);
      expect(turnManager.getBaseQuota()).toBe(1268);
      expect(turnManager.getQuota()).toBe(1014); // 1268 * 0.8 = 1014.4 -> 1014
    });
  });

  describe('2. 新岁开始前强制重置上一岁造化（Anti-Snowballing 严禁永久累加）', () => {
    it('跨年造化轮换时，上一岁所有加成严格重置复原', () => {
      // Y1 -> Y2: 选择【须弥芥子】
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('xumi');

      expect(turnManager.getYear()).toBe(2);
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(3);
      expect(turnManager.getActiveBoon()).toBe('xumi');

      // Y2 -> Y3: 改选【太乙金丹】
      // 必须验证：地脉上限复位回 2，神识上限升至 130
      turnManager.getScoreManager().setScore(2000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('taiyi');

      expect(turnManager.getYear()).toBe(3);
      expect(turnManager.getActiveBoon()).toBe('taiyi');
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(2); // 须弥芥子注销复位！
      expect(turnManager.getQiManager().getMaxQi()).toBe(130);
      expect(turnManager.getExtraRegen()).toBe(5);

      // Y3 -> Y4: 改选【欺天灵符】
      // 必须验证：太乙金丹注销复位（神识上限回 100，回神回 10），天劫门槛折扣生效
      turnManager.getScoreManager().setScore(3000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('qitian');

      expect(turnManager.getYear()).toBe(4);
      expect(turnManager.getActiveBoon()).toBe('qitian');
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(2);
      expect(turnManager.getQiManager().getMaxQi()).toBe(turnManager.getBalanceConfig().maxQi); // 太乙金丹注销！
      expect(turnManager.getExtraRegen()).toBe(0); // 额外回神注销！
      expect(turnManager.getQuotaDiscount()).toBe(0.8);

      // Y4 -> Y5: 不选任何机缘 (none)
      // 必须验证：欺天灵符注销，天劫折扣复原 1.0
      turnManager.getScoreManager().setScore(5000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('none');

      expect(turnManager.getYear()).toBe(5);
      expect(turnManager.getActiveBoon()).toBe('none');
      expect(turnManager.getQuotaDiscount()).toBe(1.0); // 欺天灵符注销！
      expect(turnManager.getHandManager().getMaxLeyline()).toBe(2);
      expect(turnManager.getQiManager().getMaxQi()).toBe(turnManager.getBalanceConfig().maxQi);
    });
  });

  describe('3. 地脉 3 缩 2 软超限（Soft Cap）完整生命周期闭环', () => {
    it('须弥芥子失效缩槽时：已有 3 张牌平滑保留，拦截迁入新购，直到牌数低于 2 张', () => {
      const hm = turnManager.getHandManager();

      // 1. 在 Y1 渡劫选择须弥芥子 -> Y2 maxLeyline = 3
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('xumi');
      expect(hm.getMaxLeyline()).toBe(3);

      // 2. 在 Y2 中，往地脉填入 3 张卡牌
      const card1 = createCard(101, '甲子', Element.WATER, '子');
      const card2 = createCard(102, '壬申', Element.WATER, '申');
      const card3 = createCard(103, '戊辰', Element.WATER, '辰');

      expect(hm.buyToLeyline(card1, 10, false, 1, 1, 10)).toBe(0);
      expect(hm.buyToLeyline(card2, 10, false, 1, 1, 10)).toBe(1);
      expect(hm.buyToLeyline(card3, 10, false, 1, 1, 10)).toBe(2);
      expect(hm.getLeylineCards().length).toBe(3);

      // 3. Y2 岁末渡劫成功（3 张地脉暗牌安全跨年留存，Q1=A）
      turnManager.getScoreManager().setScore(3000);
      turnManager.evaluateTribulation();

      // 4. 进入 Y3，选择太乙金丹（须弥芥子注销失效，maxLeyline 缩回 2）
      turnManager.advanceToNextYear('taiyi');
      expect(turnManager.getYear()).toBe(3);
      expect(hm.getMaxLeyline()).toBe(2);

      // 5. 验证软超限状态（Q2=A）：
      // - 3 张牌完好无损留存，不强行丢弃或爆牌！
      expect(hm.getLeylineCards().length).toBe(3);
      expect(hm.getLeylineCards()[0].card.name).toBe('甲子');
      expect(hm.getLeylineCards()[1].card.name).toBe('壬申');
      expect(hm.getLeylineCards()[2].card.name).toBe('戊辰');

      // - 触发严格溢出超限与软超限拦截
      expect(turnManager.isLeylineSoftCapped()).toBe(true);
      expect(turnManager.isLeylineOverCapacity()).toBe(true);
      expect(hm.canAddToLeyline()).toBe(false);

      // - 拦截任何新牌直接购入地脉
      expect(turnManager.canBuyToLeyline()).toBe(false);
      expect(turnManager.executeBuyToLeyline(0, false)).toBe(false);

      // - 拦截丹田下沉地脉
      const dantianCard = createCard(201, '丙寅', Element.FIRE, '寅');
      hm.buy(dantianCard, 10, false, 1, 1, 10);
      expect(turnManager.canMoveToLeyline()).toBe(false);
      expect(turnManager.executeMoveToLeyline(0)).toBe(false);

      // 6. 验证已有超限卡牌依然完全合法：可读、可卖、可成局！
      // 测试三合成局直接消解这 3 张超限地脉牌（申子辰三合水局）
      const triadClaim = turnManager.claimTriad('water');
      expect(triadClaim).not.toBeNull();

      // 3 张卡牌功德圆满消解腾槽回归牌池
      expect(hm.getLeylineCards().length).toBe(0);
      expect(turnManager.isLeylineSoftCapped()).toBe(false);
      expect(turnManager.isLeylineOverCapacity()).toBe(false);
      expect(hm.canAddToLeyline()).toBe(true);
      expect(turnManager.canBuyToLeyline()).toBe(true);
    });

    it('卖出一张后降为 2 张（2/2）依然拦截，卖出第二张降至 1 张（1/2）方才解除拦截', () => {
      const hm = turnManager.getHandManager();

      // 选须弥芥子
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('xumi');

      // 填满 3 张
      hm.buyToLeyline(createCard(1, 'A', Element.WOOD, '子'), 10, false, 1, 1, 10);
      hm.buyToLeyline(createCard(2, 'B', Element.WOOD, '丑'), 10, false, 1, 1, 10);
      hm.buyToLeyline(createCard(3, 'C', Element.WOOD, '寅'), 10, false, 1, 1, 10);

      // Y3 换成太乙金丹 -> maxLeyline 缩回 2
      turnManager.getScoreManager().setScore(2000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('taiyi');

      expect(hm.getLeylineCards().length).toBe(3);
      expect(hm.getMaxLeyline()).toBe(2);
      expect(turnManager.isLeylineOverCapacity()).toBe(true);

      // 卖出第一张 -> 剩 2 张
      const sold1 = hm.sellLeyline(0);
      expect(sold1).not.toBeNull();
      expect(hm.getLeylineCards().length).toBe(2);
      expect(turnManager.isLeylineOverCapacity()).toBe(false);
      // 2/2: 依然不能进（canAddToLeyline 为 false）
      expect(hm.canAddToLeyline()).toBe(false);
      expect(turnManager.canBuyToLeyline()).toBe(false);

      // 卖出第二张 -> 剩 1 张
      const sold2 = hm.sellLeyline(0);
      expect(sold2).not.toBeNull();
      expect(hm.getLeylineCards().length).toBe(1);
      // 1/2: 解除拦截！可正常进牌
      expect(hm.canAddToLeyline()).toBe(true);
      expect(turnManager.canBuyToLeyline()).toBe(true);
    });
  });

  describe('4. 存档快照保存与跨会话状态还原', () => {
    it('快照正确导出与还原 activeBoon 及对应属性', () => {
      // 激活太乙金丹
      turnManager.getScoreManager().setScore(1000);
      turnManager.evaluateTribulation();
      turnManager.advanceToNextYear('taiyi');

      expect(turnManager.getActiveBoon()).toBe('taiyi');

      // 导出快照
      const snapshot = turnManager.exportSnapshot();
      expect(snapshot.activeBoon).toBe('taiyi');

      // 新建实例并导入快照
      const newTurnManager = new TurnManager();
      newTurnManager.importSnapshot(snapshot);

      expect(newTurnManager.getActiveBoon()).toBe('taiyi');
      expect(newTurnManager.getQiManager().getMaxQi()).toBe(130);
      expect(newTurnManager.getExtraRegen()).toBe(5);
    });
  });
});
