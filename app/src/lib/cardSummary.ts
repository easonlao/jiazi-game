import { Element, YinYang, type RoundLogEntry } from '@core/index';

/**
 * 交易看板「经手卡牌」聚合——整局操作过的卡片总结。
 *
 * 数据源全部来自 roundLog（已发生事实快照），纯前端聚合，不改核心引擎、
 * 不引入任何预测字段，天然满足 docs/ui-information-boundary.md。
 *
 * 每张卡聚合：
 * - 买入次数：action === 'buy' 且 actionCardName 匹配
 * - 卖出次数：action === 'sell' 且 actionCardName 匹配
 * - 卖出收益：sellScore 累计
 * - 炼化收益：settlement.holdItems 中该卡 earning 累计（每回合持仓炼化）
 * - 反噬罚分：settlement.marginCallDetails 中该卡 penaltyScore 累计
 * - 单卡总收益 = 卖出收益 + 炼化收益 - 反噬罚分
 */
export interface CardSummary {
  /** 卡名（干支） */
  name: string;
  /** 五行（色点/徽章显示用） */
  mainElement: Element;
  /** 阴阳 */
  yinYang: YinYang;
  /** 买入次数 */
  buys: number;
  /** 卖出次数 */
  sells: number;
  /** 卖出收益累计（sellScore） */
  sellEarnings: number;
  /** 炼化收益累计（settlement.holdItems[].earning） */
  holdEarnings: number;
  /** 反噬罚分累计（marginCallDetails[].penaltyScore） */
  penalty: number;
  /** 最后操作回合（买入或卖出的最大 round，用于排序） */
  lastRound: number;
  /** 是否仍持有：买入次数 > 卖出次数 */
  holding: boolean;
  /** 单卡总收益 = 卖出 + 炼化 - 反噬罚分 */
  total: number;
}

/**
 * 从回合日志聚合「经手卡牌」总结。
 * 按最后操作回合倒序返回（最近操作的卡在前）。
 */
export function aggregateCardSummaries(roundLog: RoundLogEntry[]): CardSummary[] {
  // 卡牌元数据（五行/阴阳）从全部回合的公共牌池快照收集：
  // 一张卡被买入时必在其买入回合的快照中出现（买到的牌必在当回合快照），
  // 卖出的卡必然曾被买入过——因此全局快照映射覆盖所有操作过的卡。
  const metaByCard = new Map<string, { mainElement: Element; yinYang: YinYang }>();
  for (const entry of roundLog) {
    for (const c of entry.publicCards) {
      if (!metaByCard.has(c.name)) {
        metaByCard.set(c.name, { mainElement: c.mainElement, yinYang: c.yinYang });
      }
    }
  }
  const metaFor = (name: string) =>
    metaByCard.get(name) ?? { mainElement: Element.EARTH, yinYang: YinYang.YIN };

  const map = new Map<string, CardSummary>();

  const ensure = (name: string, round: number): CardSummary => {
    let s = map.get(name);
    if (!s) {
      const meta = metaFor(name);
      s = {
        name,
        mainElement: meta.mainElement,
        yinYang: meta.yinYang,
        buys: 0,
        sells: 0,
        sellEarnings: 0,
        holdEarnings: 0,
        penalty: 0,
        lastRound: round,
        holding: false,
        total: 0,
      };
      map.set(name, s);
    }
    s.lastRound = Math.max(s.lastRound, round);
    return s;
  };

  for (const entry of roundLog) {
    // 行动层：买入/卖出
    if (entry.action === 'buy' && entry.actionCardName) {
      const s = ensure(entry.actionCardName, entry.round);
      s.buys++;
    }
    if (entry.action === 'sell' && entry.actionCardName) {
      const s = ensure(entry.actionCardName, entry.round);
      s.sells++;
      s.sellEarnings += entry.sellScore ?? 0;
    }
    // 结算层：持仓炼化收益（可能不匹配行动层，单独按卡名聚合）
    for (const item of entry.settlement.holdItems) {
      ensure(item.cardName, entry.round).holdEarnings += item.earning;
    }
    // 结算层：反噬罚分
    for (const mc of entry.settlement.marginCallDetails) {
      ensure(mc.cardName, entry.round).penalty += mc.penaltyScore;
    }
  }

  const summaries = [...map.values()];
  for (const s of summaries) {
    s.holding = s.buys > s.sells;
    s.total = s.sellEarnings + s.holdEarnings - s.penalty;
  }
  // 最后操作回合倒序（最近操作的卡在前）
  summaries.sort((a, b) => b.lastRound - a.lastRound);
  return summaries;
}

/** 经手卡牌统计：已了结（不持有）的张数 */
export function countSettled(summaries: CardSummary[]): number {
  return summaries.filter((s) => !s.holding).length;
}
