import { describe, it, expect } from 'vitest';
import { JiaziCard } from '../../src/core/JiaziCard';

describe('土牌方案E评分验证', () => {
  const seasons = ['spring', 'summer', 'autumn', 'winter'];

  function load(name: string) {
    return new JiaziCard({
      id: 1, name, tianGan: '甲', diZhi: '子',
      tianGanElement: 'wood', diZhiElement: 'water', mainElement: 'wood', yinYang: 'yang',
    });
  }

  it('土牌评分应有绝对水平（不再被均值中心化压平）', () => {
    // 戊辰：天干土 + 地支辰(藏戊乙癸)
    const wuchen = new JiaziCard({
      id: 5, name: '戊辰', tianGan: '戊', diZhi: '辰',
      tianGanElement: 'earth', diZhiElement: 'earth', mainElement: 'earth', yinYang: 'yang',
    });
    const scores = seasons.map(s => wuchen.getSeasonScore(s));
    console.log('戊辰评分:', scores.map(s => s.toFixed(2)).join(' '));
    // 方案E：天干保底，评分应显著为正（之前均值中心化接近0）
    expect(Math.max(...scores)).toBeGreaterThan(1.0);
    expect(Math.min(...scores)).toBeGreaterThan(-0.5);
  });

  it('对冲土牌应有季节波动（藏干带来分化）', () => {
    // 戊子：天干土 + 地支子(藏癸水)
    const wuzi = new JiaziCard({
      id: 25, name: '戊子', tianGan: '戊', diZhi: '子',
      tianGanElement: 'earth', diZhiElement: 'water', mainElement: 'earth', yinYang: 'yang',
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
      tianGanElement: 'wood', diZhiElement: 'wood', mainElement: 'wood', yinYang: 'yang',
    });
    const scores = seasons.map(s => jiayin.getSeasonScore(s));
    console.log('甲寅评分:', scores.map(s => s.toFixed(2)).join(' '));
    // 非土牌评分围绕0波动（均值中心化）
    expect(Math.max(...scores)).toBeGreaterThan(1.5);
    expect(Math.min(...scores)).toBeLessThan(-1.5);
  });
});
