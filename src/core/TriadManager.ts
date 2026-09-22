import { Element, type JiaziCard } from './JiaziCard.ts';
import type { HandSlot } from './HandSlot.ts';

/**
 * 地支三合局定义
 */
export interface TriadDefinition {
  element: Element;
  name: string;
  branches: readonly [string, string, string];
  baseBonus: number;
  effect: string;
}

/**
 * 四大正统地支三合局
 * 申子辰水局、寅午戌火局、巳酉丑金局、亥卯未木局
 */
export const TRIADS: readonly TriadDefinition[] = [
  {
    element: Element.WATER,
    name: '申子辰合水局',
    branches: ['申', '子', '辰'],
    baseBonus: 450,
    effect: '神识满溢并引动万水归渊',
  },
  {
    element: Element.FIRE,
    name: '寅午戌合火局',
    branches: ['寅', '午', '戌'],
    baseBonus: 450,
    effect: '神识满溢并焚尽虚妄业障',
  },
  {
    element: Element.METAL,
    name: '巳酉丑合金局',
    branches: ['巳', '酉', '丑'],
    baseBonus: 450,
    effect: '神识满溢并铸就庚辛法相',
  },
  {
    element: Element.WOOD,
    name: '亥卯未合木局',
    branches: ['亥', '卯', '未'],
    baseBonus: 450,
    effect: '神识满溢并演化青元万象',
  },
] as const;

/**
 * 可引动成局的候选信息
 */
export interface TriadCandidate {
  triad: TriadDefinition;
  element: Element;
  name: string;
  bonus: number;
  effect: string;
  nextMultiplier: number;
  nextCount: number;
}

/**
 * 三合成局引动结果
 */
export interface TriadClaimResult {
  triad: TriadDefinition;
  element: Element;
  bonus: number;
  newMultiplier: number;
  triadCount: number;
  isGrandCycle: boolean;
  grandBonus: number;
  earthMultiplier: number;
  grandCycles: number;
}

/**
 * 地支三合局与五行自由专精管理器
 * 
 * 职责：
 * 1. 跨 3 活跃丹田与 2/3 潜伏地脉检测四大正统合局；
 * 2. 引动成局：增加随年岁递增的大阵修为，永久叠加 +25% 对应属性专精倍率（无四象死锁）；
 * 3. 四象大圆满检测与混元巨赏（1.5x）及土行真元激活（+25%）；
 * 4. 检测公共牌“绝杀成局”机缘。
 */
export class TriadManager {
  private triadCounts: Record<Element, number>;
  private elemMultipliers: Record<Element, number>;
  private grandCycles: number;

  constructor() {
    this.triadCounts = {
      [Element.WOOD]: 0,
      [Element.FIRE]: 0,
      [Element.EARTH]: 0,
      [Element.METAL]: 0,
      [Element.WATER]: 0,
    };
    this.elemMultipliers = {
      [Element.WOOD]: 1.0,
      [Element.FIRE]: 1.0,
      [Element.EARTH]: 1.0,
      [Element.METAL]: 1.0,
      [Element.WATER]: 1.0,
    };
    this.grandCycles = 0;
  }

  /** 获取全部五行属性专精倍率 */
  getMultipliers(): Record<Element, number> {
    return { ...this.elemMultipliers };
  }

  /** 获取指定属性专精倍率 */
  getMultiplier(element: Element): number {
    return this.elemMultipliers[element] ?? 1.0;
  }

  /** 获取各属性三合成局次数 */
  getTriadCounts(): Record<Element, number> {
    return { ...this.triadCounts };
  }

  /** 获取四象混元大圆满重数 */
  getGrandCycles(): number {
    return this.grandCycles;
  }

  /**
   * 随年岁递增的大阵修为
   * Math.round(450 * 1.80^(year - 1))
   */
  getTriadBonus(year: number = 1): number {
    const factor = Math.pow(1.80, Math.max(1, year) - 1);
    return Math.round(450 * factor);
  }

  /**
   * 四象大圆满混元巨赏 (1.5x 大阵修为)
   */
  getGrandBonus(year: number = 1): number {
    return Math.round(this.getTriadBonus(year) * 1.5);
  }

  /**
   * 跨丹田与地脉检索所有可成局的三合大阵
   * @param cards 持有的卡牌或卡槽列表
   * @param year 当前年岁（默认 1）
   */
  checkTriads(cards: readonly (JiaziCard | HandSlot | null | undefined)[], year: number = 1): TriadCandidate[] {
    const branches = new Set<string>();
    for (const item of cards) {
      if (!item) continue;
      const card = 'card' in item ? item.card : item;
      if (card && card.diZhi) {
        branches.add(card.diZhi);
      }
    }

    const available: TriadCandidate[] = [];
    const bonus = this.getTriadBonus(year);

    for (const triad of TRIADS) {
      const hasAll = triad.branches.every((b) => branches.has(b));
      if (hasAll) {
        const curMult = this.elemMultipliers[triad.element] ?? 1.0;
        const curCount = this.triadCounts[triad.element] ?? 0;
        available.push({
          triad,
          element: triad.element,
          name: triad.name,
          bonus,
          effect: triad.effect,
          nextMultiplier: Math.round((curMult + 0.25) * 100) / 100,
          nextCount: curCount + 1,
        });
      }
    }

    return available;
  }

  /**
   * 判断卡池中的某张公共牌是否为“绝杀成局”牌：
   * 即玩家已持有该合局的另外 2 个地支，且纳灵该牌将直接达成三合大阵。
   */
  canCompleteTriad(
    targetCard: JiaziCard,
    ownedCards: readonly (JiaziCard | HandSlot | null | undefined)[],
  ): TriadDefinition | null {
    if (!targetCard || !targetCard.diZhi) return null;

    const ownedBranches = new Set<string>();
    for (const item of ownedCards) {
      if (!item) continue;
      const card = 'card' in item ? item.card : item;
      if (card && card.diZhi) {
        ownedBranches.add(card.diZhi);
      }
    }

    for (const triad of TRIADS) {
      if (triad.branches.includes(targetCard.diZhi)) {
        const otherBranches = triad.branches.filter((b) => b !== targetCard.diZhi);
        const hasOthers = otherBranches.every((b) => ownedBranches.has(b));
        if (hasOthers) {
          return triad;
        }
      }
    }

    return null;
  }

  /**
   * 引动成局结算数值与专精倍率
   * @param element 成局五行属性
   * @param year 当前年岁（默认 1）
   */
  claimTriad(element: Element, year: number = 1): TriadClaimResult {
    const triad = TRIADS.find((t) => t.element === element);
    if (!triad) {
      throw new Error(`找不到元素为 ${element} 的三合局定义`);
    }

    const bonus = this.getTriadBonus(year);
    this.triadCounts[element] = (this.triadCounts[element] || 0) + 1;
    this.elemMultipliers[element] = Math.round(((this.elemMultipliers[element] || 1.0) + 0.25) * 100) / 100;

    // 四象大圆满检测：水火金木皆至少成局 1 次
    const minFourSymbols = Math.min(
      this.triadCounts[Element.WATER] || 0,
      this.triadCounts[Element.FIRE] || 0,
      this.triadCounts[Element.METAL] || 0,
      this.triadCounts[Element.WOOD] || 0,
    );

    let isGrandCycle = false;
    let grandBonus = 0;

    if (minFourSymbols > this.grandCycles) {
      this.grandCycles = minFourSymbols;
      isGrandCycle = true;
      grandBonus = this.getGrandBonus(year);
      // 土行真元永久承托激活 (+25%)
      this.elemMultipliers[Element.EARTH] = Math.round(((this.elemMultipliers[Element.EARTH] || 1.0) + 0.25) * 100) / 100;
    }

    return {
      triad,
      element,
      bonus,
      newMultiplier: this.elemMultipliers[element],
      triadCount: this.triadCounts[element],
      isGrandCycle,
      grandBonus,
      earthMultiplier: this.elemMultipliers[Element.EARTH],
      grandCycles: this.grandCycles,
    };
  }

  /**
   * 载入保存的专精状态
   */
  loadState(saved: {
    elemMultipliers?: Record<string, number>;
    triadCounts?: Record<string, number>;
    grandCycles?: number;
  }): void {
    if (saved.elemMultipliers) {
      this.elemMultipliers = {
        [Element.WOOD]: saved.elemMultipliers.wood ?? 1.0,
        [Element.FIRE]: saved.elemMultipliers.fire ?? 1.0,
        [Element.EARTH]: saved.elemMultipliers.earth ?? 1.0,
        [Element.METAL]: saved.elemMultipliers.metal ?? 1.0,
        [Element.WATER]: saved.elemMultipliers.water ?? 1.0,
      };
    }
    if (saved.triadCounts) {
      this.triadCounts = {
        [Element.WOOD]: saved.triadCounts.wood ?? 0,
        [Element.FIRE]: saved.triadCounts.fire ?? 0,
        [Element.EARTH]: saved.triadCounts.earth ?? 0,
        [Element.METAL]: saved.triadCounts.metal ?? 0,
        [Element.WATER]: saved.triadCounts.water ?? 0,
      };
    }
    if (saved.grandCycles !== undefined) {
      this.grandCycles = saved.grandCycles;
    }
  }

  /** 重置专精系统 */
  reset(): void {
    this.triadCounts = {
      [Element.WOOD]: 0,
      [Element.FIRE]: 0,
      [Element.EARTH]: 0,
      [Element.METAL]: 0,
      [Element.WATER]: 0,
    };
    this.elemMultipliers = {
      [Element.WOOD]: 1.0,
      [Element.FIRE]: 1.0,
      [Element.EARTH]: 1.0,
      [Element.METAL]: 1.0,
      [Element.WATER]: 1.0,
    };
    this.grandCycles = 0;
  }
}
