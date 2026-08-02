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

export interface ScoreConfig {
  scoreBeta: number;
  yangPolarityFactor: number;
  yinPolarityFactor: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  scoreBeta: 0.02,
  yangPolarityFactor: 1.1,
  yinPolarityFactor: 0.9,
};

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

  /** 获取卡牌未校准的季节原始评分。 */
  getRawSeasonScore(season: string): number {
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

    return this.roundScore(stemScore * 0.5 + branchScore * 0.3 + relationScore * 0.2);
  }

  /**
   * 获取最终季节评分。
   *
   * 土牌（方案E）：天干保底 + 藏干波动——天干部分保留绝对水平（稳定收益），
   * 藏干部分中心化保留波动（优势季节分化），让土牌有"择时加杠杆"的操作选择。
   * 非土牌：以四季原始均值为中心，再施加阴阳波动系数（原逻辑）。
   *
   * 评分基线/系数从 BalanceConfig 传入；不传时使用默认配置，保证 UI 与核心一致。
   */
  getSeasonScore(season: string, config: ScoreConfig = DEFAULT_SCORE_CONFIG): number {
    if (!this.isSeason(season)) return 0;
    const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
    const seasonElementMap: Record<Season, Element> = {
      spring: Element.WOOD,
      summer: Element.FIRE,
      autumn: Element.METAL,
      winter: Element.WATER,
    };
    const seasonElement = seasonElementMap[season];

    // 土牌：天干保底(0.5权重,恒定) + 藏干波动(中心化,权重0.5) + 关系分(0.2)
    if (this.tianGanElement === Element.EARTH) {
      const stemScore = this.scoreElementInSeason(this.tianGanElement, seasonElement);
      const branchScore = this.scoreHiddenStemsInSeason(seasonElement);
      const branchScores = seasons.map((s) => this.scoreHiddenStemsInSeason(seasonElementMap[s]));
      const branchMean = branchScores.reduce((sum, value) => sum + value, 0) / branchScores.length;
      const relationScore = this.scoreStemBranchRelation();
      return this.roundScore(stemScore * 0.5 + (branchScore - branchMean) * 0.5 + relationScore * 0.2);
    }

    // 非土牌：原均值中心化逻辑
    const rawScores = seasons.map((item) => this.getRawSeasonScore(item));
    const rawMean = rawScores.reduce((sum, value) => sum + value, 0) / rawScores.length;
    const factor = this.yinYang === YinYang.YANG
      ? config.yangPolarityFactor
      : config.yinPolarityFactor;
    return this.roundScore(config.scoreBeta + factor * (this.getRawSeasonScore(season) - rawMean));
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
    // 土牌：承接当前季节旺气，幅度为旺气的0.4倍（环境镜像设计）
    if (element === Element.EARTH) return 1.6;

    // 当季：+4
    if (element === seasonElement) return 4.0;

    // 分组：木火组 / 金水组
    const woodFireGroup = [Element.WOOD, Element.FIRE];
    const metalWaterGroup = [Element.METAL, Element.WATER];

    // 同组：+2
    if (woodFireGroup.includes(element) && woodFireGroup.includes(seasonElement)) return 2.0;
    if (metalWaterGroup.includes(element) && metalWaterGroup.includes(seasonElement)) return 2.0;

    // 对立：-4（木↔金，火↔水）
    const oppositePairs = [[Element.WOOD, Element.METAL], [Element.FIRE, Element.WATER]];
    for (const [a, b] of oppositePairs) {
      if ((element === a && seasonElement === b) || (element === b && seasonElement === a)) {
        return -4.0;
      }
    }

    // 跨组：-2
    return -2.0;
  }

  private scoreStemBranchRelation(): number {
    if (this.tianGanElement === this.diZhiElement) return 2;

    // 分组：木火组 / 金水组
    const woodFireGroup = [Element.WOOD, Element.FIRE];
    const metalWaterGroup = [Element.METAL, Element.WATER];

    const tgInWoodFire = woodFireGroup.includes(this.tianGanElement);
    const dzInWoodFire = woodFireGroup.includes(this.diZhiElement);
    const tgInMetalWater = metalWaterGroup.includes(this.tianGanElement);
    const dzInMetalWater = metalWaterGroup.includes(this.diZhiElement);

    // 同组：+1.5
    if ((tgInWoodFire && dzInWoodFire) || (tgInMetalWater && dzInMetalWater)) return 1.5;

    // 对立：-2（木↔金，火↔水）
    const oppositePairs = [[Element.WOOD, Element.METAL], [Element.FIRE, Element.WATER]];
    for (const [a, b] of oppositePairs) {
      if ((this.tianGanElement === a && this.diZhiElement === b) ||
          (this.tianGanElement === b && this.diZhiElement === a)) {
        return -2.0;
      }
    }

    // 跨组：0
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

  private roundScore(score: number): number {
    return Math.round(score * 100) / 100;
  }
}
