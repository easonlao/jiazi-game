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
    const seasonElementMap: Record<string, Element> = {
      spring: Element.WOOD,
      summer: Element.FIRE,
      autumn: Element.METAL,
      winter: Element.WATER,
    };

    const seasonElement = seasonElementMap[season];
    if (!seasonElement) return 0;

    // 当季元素匹配：+3，相生：+1，相克：-1，其他：0
    if (this.mainElement === seasonElement) return 3;
    if (this.isSheng(seasonElement)) return 1;
    if (this.isKe(seasonElement)) return -1;
    return 0;
  }

  /** 判断是否相生 (this 生 target) */
  private isSheng(target: Element): boolean {
    const shengMap: Record<Element, Element> = {
      [Element.WOOD]: Element.FIRE,
      [Element.FIRE]: Element.EARTH,
      [Element.EARTH]: Element.METAL,
      [Element.METAL]: Element.WATER,
      [Element.WATER]: Element.WOOD,
    };
    return shengMap[this.mainElement] === target;
  }

  /** 判断是否相克 (this 克 target) */
  private isKe(target: Element): boolean {
    const keMap: Record<Element, Element> = {
      [Element.WOOD]: Element.EARTH,
      [Element.FIRE]: Element.METAL,
      [Element.EARTH]: Element.WATER,
      [Element.METAL]: Element.WOOD,
      [Element.WATER]: Element.FIRE,
    };
    return keMap[this.mainElement] === target;
  }
}
