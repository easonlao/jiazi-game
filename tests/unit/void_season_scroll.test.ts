/**
 * 空亡跳转信息生成（buildVoidJourney）单元测试。
 *
 * 覆盖：唯一转换段序列不循环、同季未跨季空数组、advanced=k、k 非有限回退 1、
 * 票 08 示例 spring→autumn 段序列正确、季节轮顺序与 SeasonCycle 一致。
 */
import { describe, it, expect } from 'vitest';
import { buildVoidJourney, VOID_SEASON_ORDER } from '../../app/src/lib/voidSeasonScroll';

describe('buildVoidJourney（空亡季节跳转信息）', () => {
  it('票 08 示例 prev=spring → next=autumn：唯一转换段 [春→夏, 夏→秋]，advanced=k', () => {
    const j = buildVoidJourney(2, 'spring', 'autumn');
    expect(j).toEqual({
      from: 'spring',
      to: 'autumn',
      advanced: 2,
      segments: [
        { from: 'spring', to: 'summer' },
        { from: 'summer', to: 'autumn' },
      ],
    });
  });

  it('segments 不循环：K=12 时段序列仍只有真实跨段，不随 K 翻倍（换季且 K 大不再重复轮播）', () => {
    const j = buildVoidJourney(12, 'spring', 'winter');
    expect(j.advanced).toBe(12);
    expect(j.segments).toEqual([
      { from: 'spring', to: 'summer' },
      { from: 'summer', to: 'autumn' },
      { from: 'autumn', to: 'winter' },
    ]);
  });

  it('同季未跨季（prev=next=spring）：segments 为空数组（无段可滚，直接展示最终季）', () => {
    const j = buildVoidJourney(5, 'spring', 'spring');
    expect(j.advanced).toBe(5);
    expect(j.segments).toEqual([]);
  });

  it('相邻季节（spring → summer）：单段', () => {
    const j = buildVoidJourney(1, 'spring', 'summer');
    expect(j.segments).toEqual([{ from: 'spring', to: 'summer' }]);
  });

  it('winter → spring：真实转换段只有 [冬→春]（跨年回绕，不循环展开）', () => {
    const j = buildVoidJourney(4, 'winter', 'spring');
    expect(j.segments).toEqual([{ from: 'winter', to: 'spring' }]);
  });

  it('advanced 保留 k 原值（floor；0/负/非整数取整后至少 1，防御）', () => {
    expect(buildVoidJourney(2.9, 'spring', 'summer').advanced).toBe(2);
    expect(buildVoidJourney(2, 'spring', 'summer').advanced).toBe(2);
    expect(buildVoidJourney(0, 'spring', 'summer').advanced).toBe(1);
    expect(buildVoidJourney(-3, 'spring', 'summer').advanced).toBe(1);
  });

  it('k 为 NaN/±Infinity：advanced 回退 1，不抛错（P2-3 防御保留）', () => {
    expect(buildVoidJourney(Number.NaN, 'spring', 'summer').advanced).toBe(1);
    expect(buildVoidJourney(Number.POSITIVE_INFINITY, 'spring', 'summer').advanced).toBe(1);
    expect(buildVoidJourney(Number.NEGATIVE_INFINITY, 'spring', 'summer').advanced).toBe(1);
  });

  it('季节名非法：防御兜底为春→夏段', () => {
    const j = buildVoidJourney(2, 'nope', 'summer');
    expect(j.segments).toEqual([{ from: 'spring', to: 'summer' }]);
    expect(buildVoidJourney(2, 'nope', 'nope').segments).toEqual([{ from: 'spring', to: 'summer' }]);
  });

  it('季节轮顺序与 SeasonCycle 一致（spring→summer→autumn→winter 循环）', () => {
    expect(VOID_SEASON_ORDER).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });
});
