import { describe, it, expect } from 'vitest';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

describe('土牌方案E评分验证', () => {
  const seasons = ['spring', 'summer', 'autumn', 'winter'];

  function load(name: string) {
    return new JiaziCard({
      id: 1, name, tianGan: '甲', diZhi: '子',
      tianGanElement: Element.WOOD, diZhiElement: Element.WATER, mainElement: Element.WOOD, yinYang: YinYang.YANG,
    });
  }

  it('土牌评分应有绝对水平（不再被均值中心化压平）', () => {
    // 戊辰：天干土 + 地支辰(藏戊乙癸)
    const wuchen = new JiaziCard({
      id: 5, name: '戊辰', tianGan: '戊', diZhi: '辰',
      tianGanElement: Element.EARTH, diZhiElement: Element.EARTH, mainElement: Element.EARTH, yinYang: YinYang.YANG,
    });
    const scores = seasons.map(s => wuchen.getSeasonScore(s));
    console.log('戊辰评分:', scores.map(s => s.toFixed(2)).join(' '));
    // 方案E：天干保底，评分应有明显正向水平（四季总和显著 > 0）
    // 2026-08-05 移除关系分后：天干保底 0.4/季 + 藏干波动（辰藏乙木春夏旺/癸水冬旺），
    // 四季 9/5/-1/3，总和 16 恒正；min=-1 是藏干波动（非均值中心化压平）
    expect(scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(5.0);
    expect(Math.max(...scores)).toBeGreaterThan(5.0);
  });

  it('对冲土牌应有季节波动（藏干带来分化）', () => {
    // 戊子：天干土 + 地支子(藏癸水)
    const wuzi = new JiaziCard({
      id: 25, name: '戊子', tianGan: '戊', diZhi: '子',
      tianGanElement: Element.EARTH, diZhiElement: Element.WATER, mainElement: Element.EARTH, yinYang: YinYang.YANG,
    });
    const scores = seasons.map(s => wuzi.getSeasonScore(s));
    console.log('戊子评分:', scores.map(s => s.toFixed(2)).join(' '));
    const spread = Math.max(...scores) - Math.min(...scores);
    // 纯水对冲应有明显波动
    expect(spread).toBeGreaterThan(2.0);
  });

  it('非土牌保持原均值中心化逻辑', () => {
    // 甲寅：木 + 木，高波动
    const jiayin = new JiaziCard({
      id: 51, name: '甲寅', tianGan: '甲', diZhi: '寅',
      tianGanElement: Element.WOOD, diZhiElement: Element.WOOD, mainElement: Element.WOOD, yinYang: YinYang.YANG,
    });
    const scores = seasons.map(s => jiayin.getSeasonScore(s));
    console.log('甲寅评分:', scores.map(s => s.toFixed(2)).join(' '));
    // 非土牌评分围绕0波动（均值中心化）
    expect(Math.max(...scores)).toBeGreaterThan(1.5);
    expect(Math.min(...scores)).toBeLessThan(-1.5);
  });
});
