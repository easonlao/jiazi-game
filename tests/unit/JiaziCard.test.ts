import { describe, expect, it } from 'vitest';
import { Element, JiaziCard, YinYang } from '../../src/core/JiaziCard';

function makeCard(
  name: string,
  tianGan: string,
  diZhi: string,
  tianGanElement: Element,
  diZhiElement: Element,
  mainElement: Element = tianGanElement,
): JiaziCard {
  return new JiaziCard({
    id: 1,
    name,
    tianGan,
    diZhi,
    tianGanElement,
    diZhiElement,
    mainElement,
    yinYang: YinYang.YANG,
  });
}

describe('JiaziCard seasonal resonance scoring', () => {
  it('uses hidden stems so cards with the same heavenly stem can have different seasonal states', () => {
    const jiaZi = makeCard('甲子', '甲', '子', Element.WOOD, Element.WATER);
    const jiaXu = makeCard('甲戌', '甲', '戌', Element.WOOD, Element.EARTH);

    expect(jiaZi.getSeasonScore('winter')).not.toBeCloseTo(jiaXu.getSeasonScore('winter'));
    expect(jiaZi.getSeasonScore('winter')).toBeGreaterThan(jiaXu.getSeasonScore('winter'));
  });

  it('treats earth as a stable carrier instead of a seasonless zero element', () => {
    const wuChen = makeCard('戊辰', '戊', '辰', Element.EARTH, Element.EARTH);
    const scores = ['spring', 'summer', 'autumn', 'winter'].map(season => wuChen.getSeasonScore(season));

    expect(scores.every(score => score !== 0)).toBe(true);
    // 中心化评分允许弱季出现负分，但不会退化为季节无效的零分。
    expect(Math.max(...scores)).toBeGreaterThan(0);
  });

  it('keeps the visible seasonal rhythm for the four directional elements', () => {
    const jiaZi = makeCard('甲子', '甲', '子', Element.WOOD, Element.WATER);
    const dingMao = makeCard('丁卯', '丁', '卯', Element.FIRE, Element.WOOD);
    const xinYou = makeCard('辛酉', '辛', '酉', Element.METAL, Element.METAL);
    const guiHai = makeCard('癸亥', '癸', '亥', Element.WATER, Element.WATER);

    expect(jiaZi.getSeasonScore('spring')).toBeGreaterThan(jiaZi.getSeasonScore('autumn'));
    expect(dingMao.getSeasonScore('summer')).toBeGreaterThan(dingMao.getSeasonScore('winter'));
    expect(xinYou.getSeasonScore('autumn')).toBeGreaterThan(xinYou.getSeasonScore('summer'));
    expect(guiHai.getSeasonScore('winter')).toBeGreaterThan(guiHai.getSeasonScore('summer'));
  });
});
