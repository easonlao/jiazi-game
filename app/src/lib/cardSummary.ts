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
  /** 反噬次数（marginCallDetails 中该卡出现的次数；反噬会强制清仓离开丹田） */
  marginCalls: number;
  /** 最后操作回合（买入或卖出的最大 round，用于排序） */
  lastRound: number;
  /** 是否仍持有：净持仓 = 买入 - 卖出 - 反噬清仓 > 0 */
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
        marginCalls: 0,
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
    // 结算层：反噬罚分（每出现一次 = 该卡被反噬清仓一次，离开丹田）
    for (const mc of entry.settlement.marginCallDetails) {
      const s = ensure(mc.cardName, entry.round);
      s.penalty += mc.penaltyScore;
      s.marginCalls++;
    }
  }

  const summaries = [...map.values()];
  for (const s of summaries) {
    // 净持仓 = 买入 - 卖出 - 反噬清仓；> 0 才算仍在持有
    s.holding = s.buys - s.sells - s.marginCalls > 0;
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

/** 单卡操作轨迹条目（时间线一行） */
export interface CardTraceItem {
  /** 所在回合 */
  round: number;
  /** 季节英文 */
  season: string;
  /** 条目类型 */
  kind: 'buy' | 'sell' | 'hold' | 'margin';
  /** buy: 买入评分；sell: 卖出评分；hold: 累计炼化；margin: 罚分 */
  value: number;
  /** buy: 耗神（负数，如 -5）；其余 null/0 */
  qiCost: number;
  /** sell: 买入时评分（价差 = value - buyScore） */
  buyScore: number | null;
  /** hold: 起止回合 [start, end]；其余 null */
  holdRange: [number, number] | null;
  /** sell: 卖出收益；hold: 区间内总炼化；其余 0 */
  earnings: number;
}

/**
 * 提取单张卡的操作轨迹（按回合正序），用于点击卡牌展开时间线。
 *
 * 规则：
 * - buy：action === 'buy' 且 actionCardName 匹配 → 一条（评分 + 耗神）
 * - sell：action === 'sell' 且 actionCardName 匹配 → 一条（买入评分 → 卖出评分 + 收益）
 * - hold：settlement.holdItems 含该卡的回合 → 连续回合合并为一条区间（累计炼化）
 * - margin：settlement.marginCallDetails 含该卡 → 一条（罚分）
 * 数据源全部来自 roundLog，已发生事实，无预测字段。
 */
export function cardTrace(roundLog: RoundLogEntry[], name: string): CardTraceItem[] {
  const items: CardTraceItem[] = [];

  for (const entry of roundLog) {
    // 行动层：买入/卖出
    if (entry.action === 'buy' && entry.actionCardName === name) {
      items.push({
        round: entry.round,
        season: entry.season,
        kind: 'buy',
        value: entry.actionCardScore ?? 0,
        qiCost: entry.actionQiChange,
        buyScore: null,
        holdRange: null,
        earnings: 0,
      });
    }
    if (entry.action === 'sell' && entry.actionCardName === name) {
      items.push({
        round: entry.round,
        season: entry.season,
        kind: 'sell',
        value: entry.actionCardScore ?? 0,
        qiCost: 0,
        buyScore: entry.buyScore ?? 0,
        holdRange: null,
        earnings: entry.sellScore ?? 0,
      });
    }
    // 结算层：持有炼化（每回合一条，之后按连续回合合并）
    const held = entry.settlement.holdItems.find((h) => h.cardName === name);
    if (held) {
      items.push({
        round: entry.round,
        season: entry.season,
        kind: 'hold',
        value: held.earning,
        qiCost: 0,
        buyScore: null,
        holdRange: null,
        earnings: held.earning,
      });
    }
    // 结算层：反噬罚分
    const mc = entry.settlement.marginCallDetails.find((d) => d.cardName === name);
    if (mc) {
      items.push({
        round: entry.round,
        season: entry.season,
        kind: 'margin',
        value: mc.penaltyScore,
        qiCost: 0,
        buyScore: null,
        holdRange: null,
        earnings: -mc.penaltyScore,
      });
    }
  }

  // 按回合排序（同回合内：buy/sell 行动在前，hold/margin 结算在后）
  items.sort((a, b) => a.round - b.round || (a.kind === 'hold' || a.kind === 'margin' ? 1 : -1) - (b.kind === 'hold' || b.kind === 'margin' ? 1 : -1));

  // 合并连续持有回合为区间（hold 相邻回合合并，累计炼化）
  const merged: CardTraceItem[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (item.kind === 'hold' && last && last.kind === 'hold' && item.round === (last.holdRange?.[1] ?? last.round) + 1) {
      last.holdRange = [last.holdRange?.[0] ?? last.round, item.round];
      last.value += item.value;
      last.earnings += item.earnings;
    } else {
      merged.push(item);
      if (item.kind === 'hold') item.holdRange = [item.round, item.round];
    }
  }
  return merged;
}
