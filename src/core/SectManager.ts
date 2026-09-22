import { Element, type JiaziCard } from './JiaziCard.ts';
import type { HandSlot } from './HandSlot.ts';
import type { RandomSource } from './RandomSource.ts';
import type { Season } from './SeasonCycle.ts';

/**
 * 五大古宗定义接口
 */
export interface SectInfo {
  readonly id: string;
  readonly name: string;
  readonly element: Element;
  readonly elemName: string;
  readonly color: string;
  readonly dot: string;
  readonly maxCountdown: number;
  readonly intentDesc: string;
}

/**
 * 五大古宗定义（天地五大古宗 - 5轮巡回基准）
 */
export const ALL_SECTS: Record<string, SectInfo> = {
  metal: {
    id: 'metal',
    name: '太白剑宗',
    element: Element.METAL,
    elemName: '金',
    color: 'text-slate-200',
    dot: 'bg-slate-300',
    maxCountdown: 5,
    intentDesc: '强征天下【金】灵，搜查活跃丹田！',
  },
  wood: {
    id: 'wood',
    name: '神农百草谷',
    element: Element.WOOD,
    elemName: '木',
    color: 'text-emerald-300',
    dot: 'bg-emerald-400',
    maxCountdown: 5,
    intentDesc: '求购天下【木】灵炼丹，神念扫荡丹田！',
  },
  fire: {
    id: 'fire',
    name: '离火朱雀宫',
    element: Element.FIRE,
    elemName: '火',
    color: 'text-rose-400',
    dot: 'bg-rose-500',
    maxCountdown: 5,
    intentDesc: '引九天真火，强令征辟【火】灵入宫！',
  },
  water: {
    id: 'water',
    name: '沧溟北海阁',
    element: Element.WATER,
    elemName: '水',
    color: 'text-sky-400',
    dot: 'bg-sky-400',
    maxCountdown: 5,
    intentDesc: '掀玄渊潮汐，勒令征调丹田【水】灵！',
  },
  earth: {
    id: 'earth',
    name: '厚德镇岳宗',
    element: Element.EARTH,
    elemName: '土',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    maxCountdown: 5,
    intentDesc: '铸不朽灵岳，强权搜求天下【土】灵！',
  },
};

/**
 * 四季对应的活跃宗门列表
 * 春: 木(wood), 水(water)
 * 夏: 火(fire), 土(earth)
 * 秋: 金(metal), 土(earth)
 * 冬: 水(water), 金(metal)
 */
export const SEASON_ACTIVE_SECTS: Record<Season, readonly [string, string]> = {
  spring: ['wood', 'water'],
  summer: ['fire', 'earth'],
  autumn: ['metal', 'earth'],
  winter: ['water', 'metal'],
};

/**
 * 待决断的宗门征辟/严惩事件
 */
export interface PendingBuyback {
  readonly sect: SectInfo;
  readonly card: JiaziCard;
  /** 丹田中的插槽索引 (0-2) */
  readonly dantianIndex: number;
  /** 遵从令谕时获得的修为变动（盈利为正，亏损为负） */
  readonly offerPrice: number;
  /** 遵从令谕时的神识变动（盈利为 +5，亏损为 -10） */
  readonly qiChange: number;
  /** 当季评分与买入评分价差 delta */
  readonly delta: number;
  readonly curScore: number;
  readonly buyScore: number;
  /** 是否为劣质杂气严惩（delta <= 0） */
  readonly isNegativeYield: boolean;
}

/**
 * 巡视推进结果
 */
export interface PatrolAdvanceResult {
  /** 本轮触发巡查的宗门（若有） */
  triggeredSect: SectInfo | null;
  /** 是否发生了地脉避灾（丹田无此属性但地脉有） */
  leylineEvaded: boolean;
  /** 产生的待决断事件（若命中丹田卡牌） */
  pendingBuyback: PendingBuyback | null;
}

/**
 * 遵从令谕结果
 */
export interface AcceptDemandResult {
  readonly sect: SectInfo;
  readonly card: JiaziCard;
  readonly offerPrice: number;
  readonly qiChange: number;
  readonly isNegativeYield: boolean;
}

/**
 * 誓死抗命结果
 */
export interface DeclineDemandResult {
  readonly sect: SectInfo;
  readonly card: JiaziCard;
  readonly qiCost: number;
  readonly qiDeficit: number;
  readonly scoreBacklash: number;
}

/**
 * 宗门状态快照（供存档与读档）
 */
export interface SectStateSnapshot {
  countdowns: Record<string, number>;
  anger: Record<string, number>;
  pendingBuyback: {
    sectId: string;
    cardId: number;
    dantianIndex: number;
    offerPrice: number;
    qiChange: number;
    delta: number;
    curScore: number;
    buyScore: number;
    isNegativeYield: boolean;
  } | null;
}

/**
 * 五大古宗巡视与执法惩戒管理器 (SectManager)
 */
export class SectManager {
  private countdowns: Record<string, number> = {
    metal: 5,
    wood: 2,
    fire: 5,
    water: 4,
    earth: 5,
  };
  private anger: Record<string, number> = {
    metal: 0,
    wood: 0,
    fire: 0,
    water: 0,
    earth: 0,
  };
  private pendingBuyback: PendingBuyback | null = null;

  constructor() {
    this.reset();
  }

  /**
   * 重置宗门状态
   */
  reset(): void {
    this.countdowns = {
      metal: 5,
      wood: 2,
      fire: 5,
      water: 4,
      earth: 5,
    };
    this.anger = {
      metal: 0,
      wood: 0,
      fire: 0,
      water: 0,
      earth: 0,
    };
    this.pendingBuyback = null;
  }

  /** 清除所有宗门怒意（新岁渡劫成功后调用） */
  clearAnger(): void {
    this.anger = {
      metal: 0,
      wood: 0,
      fire: 0,
      water: 0,
      earth: 0,
    };
  }

  /**
   * 季节切换或新局启动时，调度当季两宗门的巡视倒计时
   * 错峰出巡，永不发生同轮碰撞
   */
  scheduleSeasonSects(season: Season, randomSource?: RandomSource): void {
    const fids = SEASON_ACTIVE_SECTS[season];
    if (!fids) return;

    const r = randomSource ? randomSource.next() : Math.random();
    const r1 = randomSource ? randomSource.next() : Math.random();
    const r2 = randomSource ? randomSource.next() : Math.random();

    // 随机决定先后顺序 (50% 概率翻转)
    const firstFid = r < 0.5 ? fids[0] : fids[1];
    const secondFid = firstFid === fids[0] ? fids[1] : fids[0];

    // 首位出动宗门：第 2 或第 3 轮巡查
    const cd1 = r1 < 0.5 ? 2 : 3;
    // 次席出动宗门：严格错开在第 4 或第 5 轮巡查
    const cd2 = cd1 === 2 ? (r2 < 0.5 ? 4 : 5) : 5;

    this.countdowns[firstFid] = cd1;
    this.countdowns[secondFid] = cd2;
  }

  /**
   * 获取所有宗门巡查倒计时
   */
  getCountdowns(): Record<string, number> {
    return { ...this.countdowns };
  }

  /**
   * 获取宗门怒意值
   */
  getAnger(): Record<string, number> {
    return { ...this.anger };
  }

  /**
   * 获取当前待决断事件
   */
  getPendingBuyback(): PendingBuyback | null {
    return this.pendingBuyback;
  }

  /**
   * 每回合周天推演时步进宗门倒计时，并执行丹田巡检与地脉避灾判定
   * 
   * @param currentSeason 当前季节
   * @param dantianSlots 丹田明牌插槽
   * @param leylineSlots 地脉潜伏插槽
   * @param getCardScore 计算卡牌评分函数
   */
  advancePatrols(
    currentSeason: Season,
    dantianSlots: (HandSlot | null)[],
    leylineSlots: HandSlot[],
    getCardScore: (card: JiaziCard, season: Season) => number,
  ): PatrolAdvanceResult {
    const activeFids = SEASON_ACTIVE_SECTS[currentSeason] || [];
    let triggeredSect: SectInfo | null = null;

    for (const fid of activeFids) {
      const sect = ALL_SECTS[fid];
      if (!sect) continue;

      const currentCd = this.countdowns[fid] !== undefined ? this.countdowns[fid] : 4;
      const nextCd = currentCd - 1;

      if (nextCd <= 0) {
        if (!triggeredSect) {
          triggeredSect = sect;
          this.countdowns[fid] = 5; // 触发后重置 5 轮冷却
        } else {
          // 防撞保护：若两宗门不幸同期归零，次席宗门强制延后 1 轮
          this.countdowns[fid] = 1;
        }
      } else {
        this.countdowns[fid] = nextCd;
      }
    }

    if (!triggeredSect) {
      return { triggeredSect: null, leylineEvaded: false, pendingBuyback: null };
    }

    // 1. 严格只扫描活跃丹田明牌 (dantianSlots)
    let matchDantianIdx = -1;
    let matchSlot: HandSlot | null = null;

    for (let i = 0; i < dantianSlots.length; i++) {
      const slot = dantianSlots[i];
      if (slot && slot.card.mainElement === triggeredSect.element) {
        matchDantianIdx = i;
        matchSlot = slot;
        break;
      }
    }

    if (matchDantianIdx !== -1 && matchSlot) {
      const card = matchSlot.card;
      const curScore = getCardScore(card, currentSeason);
      const buyScore = matchSlot.buyScore !== undefined ? matchSlot.buyScore : curScore;
      const delta = curScore - buyScore;

      let offerPrice = 0;
      let qiChange = 0;
      let isNegativeYield = false;

      if (delta > 0) {
        // 盈利牌：0.6x 折价强平强征，打发 +5 点神识
        offerPrice = Math.max(1, Math.round(delta * 6 * 0.6));
        qiChange = 5;
        isNegativeYield = false;
      } else {
        // 亏损牌：没收卡牌，扣除账面差价亏损，追加扣除 10 点神识惩诫
        offerPrice = delta < 0 ? Math.round(delta * 6) : -15;
        qiChange = -10;
        isNegativeYield = true;
      }

      this.pendingBuyback = {
        sect: triggeredSect,
        card,
        dantianIndex: matchDantianIdx,
        offerPrice,
        qiChange,
        delta,
        curScore,
        buyScore,
        isNegativeYield,
      };

      return {
        triggeredSect,
        leylineEvaded: false,
        pendingBuyback: this.pendingBuyback,
      };
    }

    // 2. 丹田无命中时，检查地脉潜伏牌是否成功避灾！
    const matchLeyline = leylineSlots.some((slot) => slot.card.mainElement === triggeredSect.element);

    return {
      triggeredSect,
      leylineEvaded: matchLeyline,
      pendingBuyback: null,
    };
  }

  /**
   * 玩家选择遵从令谕 (Accept Demand)
   */
  resolveAcceptDemand(): AcceptDemandResult | null {
    if (!this.pendingBuyback) return null;

    const pb = this.pendingBuyback;
    this.pendingBuyback = null;

    // 怒意平息
    if (this.anger[pb.sect.id]) {
      this.anger[pb.sect.id] = Math.max(0, this.anger[pb.sect.id] - 1);
    }

    return {
      sect: pb.sect,
      card: pb.card,
      offerPrice: pb.offerPrice,
      qiChange: pb.qiChange,
      isNegativeYield: pb.isNegativeYield,
    };
  }

  /**
   * 玩家选择誓死抗命 (Decline Demand)
   * 遭受 20 神识/修为震荡
   */
  resolveDeclineDemand(currentQi: number): DeclineDemandResult | null {
    if (!this.pendingBuyback) return null;

    const pb = this.pendingBuyback;
    this.pendingBuyback = null;

    // 宗门怒意提升
    this.anger[pb.sect.id] = (this.anger[pb.sect.id] || 0) + 1;

    let qiCost = 0;
    let qiDeficit = 0;
    let scoreBacklash = 0;

    if (currentQi >= 20) {
      qiCost = 20;
    } else {
      qiCost = currentQi;
      qiDeficit = 20 - currentQi;
      scoreBacklash = qiDeficit * 15;
    }

    return {
      sect: pb.sect,
      card: pb.card,
      qiCost,
      qiDeficit,
      scoreBacklash,
    };
  }

  /**
   * 导出快照
   */
  exportSnapshot(): SectStateSnapshot {
    return {
      countdowns: { ...this.countdowns },
      anger: { ...this.anger },
      pendingBuyback: this.pendingBuyback
        ? {
            sectId: this.pendingBuyback.sect.id,
            cardId: this.pendingBuyback.card.id,
            dantianIndex: this.pendingBuyback.dantianIndex,
            offerPrice: this.pendingBuyback.offerPrice,
            qiChange: this.pendingBuyback.qiChange,
            delta: this.pendingBuyback.delta,
            curScore: this.pendingBuyback.curScore,
            buyScore: this.pendingBuyback.buyScore,
            isNegativeYield: this.pendingBuyback.isNegativeYield,
          }
        : null,
    };
  }

  /**
   * 导入快照
   */
  importSnapshot(
    snapshot: SectStateSnapshot | undefined,
    getCardById: (id: number) => JiaziCard | undefined,
  ): void {
    if (!snapshot) {
      this.reset();
      return;
    }

    this.countdowns = { ...snapshot.countdowns };
    this.anger = { ...snapshot.anger };

    if (snapshot.pendingBuyback) {
      const sect = ALL_SECTS[snapshot.pendingBuyback.sectId];
      const card = getCardById(snapshot.pendingBuyback.cardId);
      if (sect && card) {
        this.pendingBuyback = {
          sect,
          card,
          dantianIndex: snapshot.pendingBuyback.dantianIndex,
          offerPrice: snapshot.pendingBuyback.offerPrice,
          qiChange: snapshot.pendingBuyback.qiChange,
          delta: snapshot.pendingBuyback.delta,
          curScore: snapshot.pendingBuyback.curScore,
          buyScore: snapshot.pendingBuyback.buyScore,
          isNegativeYield: snapshot.pendingBuyback.isNegativeYield,
        };
      } else {
        this.pendingBuyback = null;
      }
    } else {
      this.pendingBuyback = null;
    }
  }
}
