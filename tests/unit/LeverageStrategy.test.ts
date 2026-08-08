/**
 * 玩家加杠杆策略纯函数测试。
 * 覆盖：高分牌判定阈值、杠杆槽位统计、加杠杆决策（高分必加 / 控制数量 / 少数情况第二张）。
 */
import { describe, it, expect } from 'vitest';
import {
  isHighScoreCard,
  countLeverageSlots,
  shouldUseLeverage,
  HIGH_SCORE_THRESHOLD,
  MAX_LEVERAGE_SLOTS,
  SECOND_LEVERAGE_MIN_QI,
} from '../../src/core/LeverageStrategy';
import { HandSlot } from '../../src/core/HandSlot';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

function mkSlot(useLeverage: boolean): HandSlot {
  const card = new JiaziCard({
    id: 1, name: 'x', tianGan: '甲', diZhi: '子',
    tianGanElement: Element.WOOD, diZhiElement: Element.WATER,
    mainElement: Element.WOOD, yinYang: YinYang.YANG,
  });
  return new HandSlot(card, 10, useLeverage, 1, 1, 0);
}

describe('isHighScoreCard', () => {
  it('边界：19 不算高分，20 算，21 算', () => {
    expect(isHighScoreCard(19)).toBe(false);
    expect(isHighScoreCard(20)).toBe(true);
    expect(isHighScoreCard(21)).toBe(true);
  });
});

describe('countLeverageSlots', () => {
  it('统计已启用杠杆的槽位（忽略空位与非杠杆牌）', () => {
    expect(countLeverageSlots([mkSlot(true), mkSlot(false), null, mkSlot(true)])).toBe(2);
    expect(countLeverageSlots([mkSlot(false), null])).toBe(0);
    expect(countLeverageSlots([])).toBe(0);
  });
});

describe('shouldUseLeverage', () => {
  const base = { candidateScore: 25, currentLeverageSlots: 0, qi: 80, maxQi: 80, isSeasonEnd: false };

  it('非高分牌 → 不加杠杆', () => {
    expect(shouldUseLeverage({ ...base, candidateScore: 15 })).toBe(false);
  });

  it('高分牌 + 0 杠杆 → 加（常态第一张）', () => {
    expect(shouldUseLeverage({ ...base, currentLeverageSlots: 0 })).toBe(true);
  });

  it('高分牌 + 1 杠杆 + 气足非季末 → 少数情况开第二张', () => {
    expect(shouldUseLeverage({ ...base, currentLeverageSlots: 1, qi: 60 })).toBe(true);
  });

  it('高分牌 + 1 杠杆 + 气不足 → 不加（守住 1 张）', () => {
    expect(shouldUseLeverage({ ...base, currentLeverageSlots: 1, qi: 30 })).toBe(false);
  });

  it('高分牌 + 1 杠杆 + 季末 → 不加（避开季末风险）', () => {
    expect(shouldUseLeverage({ ...base, currentLeverageSlots: 1, qi: 60, isSeasonEnd: true })).toBe(false);
  });

  it('高分牌 + 已达上限 2 张 → 不加', () => {
    expect(shouldUseLeverage({ ...base, currentLeverageSlots: 2 })).toBe(false);
  });

  it('常量符合玩家规则（上限 2、高分阈值 20、第二张气门槛 55）', () => {
    expect(MAX_LEVERAGE_SLOTS).toBe(2);
    expect(HIGH_SCORE_THRESHOLD).toBe(20);
    expect(SECOND_LEVERAGE_MIN_QI).toBe(55);
  });
});
