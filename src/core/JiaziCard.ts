/** 五行元素 */
export enum Element {
  WOOD = 'wood',
  FIRE = 'fire',
  EARTH = 'earth',
  METAL = 'metal',
  WATER = 'water',
}

/** 阴阳 */
export enum YinYang {
  YIN = 'yin',
  YANG = 'yang',
}

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface HiddenStem {
  stem: string;
  weight: number;
}

/** 甲子卡牌数据 */
export interface JiaziCardData {
  id: number;
  name: string;
  tianGan: string;
  diZhi: string;
  tianGanElement: Element;
  diZhiElement: Element;
  mainElement: Element;
  yinYang: YinYang;
}

/** 甲子卡牌 */
export class JiaziCard {
  readonly id: number;
  readonly name: string;
  readonly tianGan: string;
  readonly diZhi: string;
  readonly tianGanElement: Element;
  readonly diZhiElement: Element;
  readonly mainElement: Element;
  readonly yinYang: YinYang;

  constructor(data: JiaziCardData) {
    this.id = data.id;
    this.name = data.name;
    this.tianGan = data.tianGan;
    this.diZhi = data.diZhi;
    this.tianGanElement = data.tianGanElement;
    this.diZhiElement = data.diZhiElement;
    this.mainElement = data.mainElement;
    this.yinYang = data.yinYang;
  }

  /** 获取元素的中文名 */
  getElementString(element: Element): string {
    const map: Record<Element, string> = {
      [Element.WOOD]: '木',
      [Element.FIRE]: '火',
      [Element.EARTH]: '土',
      [Element.METAL]: '金',
      [Element.WATER]: '水',
    };
    return map[element];
  }

  /** 获取卡牌的季节评分 */
  getSeasonScore(season: string): number {
    const seasonElementMap: Record<Season, Element> = {
      spring: Element.WOOD,
      summer: Element.FIRE,
      autumn: Element.METAL,
      winter: Element.WATER,
    };

    if (!this.isSeason(season)) return 0;

    const seasonElement = seasonElementMap[season];
    if (!seasonElement) return 0;

    const stemScore = this.scoreElementInSeason(this.tianGanElement, seasonElement);
    const branchScore = this.scoreHiddenStemsInSeason(seasonElement);
    const relationScore = this.scoreStemBranchRelation();

    return this.roundScore(stemScore * 0.6 + branchScore * 0.3 + relationScore * 0.1);
  }

  private isSeason(season: string): season is Season {
    return season === 'spring' || season === 'summer' || season === 'autumn' || season === 'winter';
  }

  private scoreHiddenStemsInSeason(seasonElement: Element): number {
    const hiddenStems = this.getHiddenStems(this.diZhi);
    if (hiddenStems.length === 0) {
      return this.scoreElementInSeason(this.diZhiElement, seasonElement);
    }

    return hiddenStems.reduce((total, hiddenStem) => {
      const element = this.getStemElement(hiddenStem.stem);
      return total + this.scoreElementInSeason(element, seasonElement) * hiddenStem.weight;
    }, 0);
  }

  private scoreElementInSeason(element: Element, seasonElement: Element): number {
    if (element === Element.EARTH) return 1.2;
    if (element === seasonElement) return 4;
    if (this.generates(seasonElement, element)) return 2;
    if (this.generates(element, seasonElement)) return 1.5;
    if (this.overcomes(seasonElement, element)) return -3;
    if (this.overcomes(element, seasonElement)) return 0.5;
    return 0;
  }

  private scoreStemBranchRelation(): number {
    if (this.tianGanElement === this.diZhiElement) return 2;
    if (this.generates(this.diZhiElement, this.tianGanElement)) return 2;
    if (this.generates(this.tianGanElement, this.diZhiElement)) return 1;
    if (this.overcomes(this.diZhiElement, this.tianGanElement)) return -2;
    if (this.overcomes(this.tianGanElement, this.diZhiElement)) return 0.5;
    return 0;
  }

  private getHiddenStems(diZhi: string): HiddenStem[] {
    const hiddenStemMap: Record<string, HiddenStem[]> = {
      子: [{ stem: '癸', weight: 1.0 }],
      丑: [
        { stem: '己', weight: 0.6 },
        { stem: '癸', weight: 0.3 },
        { stem: '辛', weight: 0.1 },
      ],
      寅: [
        { stem: '甲', weight: 0.6 },
        { stem: '丙', weight: 0.3 },
        { stem: '戊', weight: 0.1 },
      ],
      卯: [{ stem: '乙', weight: 1.0 }],
      辰: [
        { stem: '戊', weight: 0.6 },
        { stem: '乙', weight: 0.3 },
        { stem: '癸', weight: 0.1 },
      ],
      巳: [
        { stem: '丙', weight: 0.6 },
        { stem: '戊', weight: 0.3 },
        { stem: '庚', weight: 0.1 },
      ],
      午: [
        { stem: '丁', weight: 0.7 },
        { stem: '己', weight: 0.3 },
      ],
      未: [
        { stem: '己', weight: 0.6 },
        { stem: '丁', weight: 0.3 },
        { stem: '乙', weight: 0.1 },
      ],
      申: [
        { stem: '庚', weight: 0.6 },
        { stem: '壬', weight: 0.3 },
        { stem: '戊', weight: 0.1 },
      ],
      酉: [{ stem: '辛', weight: 1.0 }],
      戌: [
        { stem: '戊', weight: 0.6 },
        { stem: '辛', weight: 0.3 },
        { stem: '丁', weight: 0.1 },
      ],
      亥: [
        { stem: '壬', weight: 0.7 },
        { stem: '甲', weight: 0.3 },
      ],
    };

    return hiddenStemMap[diZhi] ?? [];
  }

  private getStemElement(stem: string): Element {
    const stemElementMap: Record<string, Element> = {
      甲: Element.WOOD,
      乙: Element.WOOD,
      丙: Element.FIRE,
      丁: Element.FIRE,
      戊: Element.EARTH,
      己: Element.EARTH,
      庚: Element.METAL,
      辛: Element.METAL,
      壬: Element.WATER,
      癸: Element.WATER,
    };

    return stemElementMap[stem] ?? Element.EARTH;
  }

  /** 判断是否相生 (source 生 target) */
  private generates(source: Element, target: Element): boolean {
    const shengMap: Record<Element, Element> = {
      [Element.WOOD]: Element.FIRE,
      [Element.FIRE]: Element.EARTH,
      [Element.EARTH]: Element.METAL,
      [Element.METAL]: Element.WATER,
      [Element.WATER]: Element.WOOD,
    };
    return shengMap[source] === target;
  }

  /** 判断是否相克 (source 克 target) */
  private overcomes(source: Element, target: Element): boolean {
    const keMap: Record<Element, Element> = {
      [Element.WOOD]: Element.EARTH,
      [Element.FIRE]: Element.METAL,
      [Element.EARTH]: Element.WATER,
      [Element.METAL]: Element.WOOD,
      [Element.WATER]: Element.FIRE,
    };
    return keMap[source] === target;
  }

  private roundScore(score: number): number {
    return Math.round(score * 100) / 100;
  }
}
