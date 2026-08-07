/**
 * 交易看板「经手卡牌」聚合函数专项测试。
 *
 * 核心断言：
 * 1. 买入/卖出次数按卡名正确聚合
 * 2. 卖出收益 = sellScore 累计；炼化收益 = holdItems[].earning 累计
 * 3. 反噬罚分计入单卡（卖出+炼化-反噬 = 总收益）
 * 4. 持有中判定 = 买入次数 > 卖出次数
 * 5. 排序按最后操作回合倒序
 * 6. 卡牌元数据（五行/阴阳）来自公共牌池快照
 */
import { describe, it, expect } from 'vitest';
import { Element, YinYang, type RoundLogEntry } from '../../src/core/index';
import { aggregateCardSummaries, countSettled } from '../../app/src/lib/cardSummary';

/** 构造一条最小回合记录（测试辅助） */
function entry(partial: Partial<RoundLogEntry> & { round: number }): RoundLogEntry {
  return {
    season: 'spring',
    roundInSeason: 1,
    action: null,
    actionCardName: null,
    actionCardScore: null,
    buyScore: null,
    sellScore: null,
    actionQiChange: 0,
    publicCards: [],
    settlement: {
      round: partial.round,
      season: 'spring',
      holdEarnings: 0,
      holdQiCost: 0,
      holdItems: [],
      baseQiRecover: 10,
      waitQiRecover: 0,
      marginCallTriggered: false,
      marginCallDetails: [],
      finalQi: 80,
      finalScore: 0,
    },
    scoreAfter: 0,
    qiAfter: 80,
    ...partial,
  };
}

describe('aggregateCardSummaries 经手卡牌聚合', () => {
  it('空日志返回空数组', () => {
    expect(aggregateCardSummaries([])).toEqual([]);
  });

  it('买入/卖出次数 + 卖出收益按卡聚合', () => {
    const log: RoundLogEntry[] = [
      entry({
        round: 2,
        action: 'buy',
        actionCardName: '甲子',
        actionCardScore: 10,
        actionQiChange: -5,
        publicCards: [{ id: 1, name: '甲子', mainElement: Element.WOOD, yinYang: YinYang.YANG }],
      }),
      entry({
        round: 3,
        action: 'sell',
        actionCardName: '甲子',
        actionCardScore: 18,
        buyScore: 10,
        sellScore: 32,
        actionQiChange: 0,
      }),
    ];

    const [s] = aggregateCardSummaries(log);
    expect(s.name).toBe('甲子');
    expect(s.buys).toBe(1);
    expect(s.sells).toBe(1);
    expect(s.sellEarnings).toBe(32);
    expect(s.holding).toBe(false);
    // 元数据来自快照
    expect(s.mainElement).toBe(Element.WOOD);
    expect(s.yinYang).toBe(YinYang.YANG);
  });

  it('炼化收益按卡名从结算层聚合（同一张卡多回合持有累加）', () => {
    const log: RoundLogEntry[] = [
      entry({
        round: 2,
        action: 'buy',
        actionCardName: '乙丑',
        settlement: {
          round: 2,
          season: 'spring',
          holdEarnings: 12.5,
          holdQiCost: 3,
          holdItems: [{ cardName: '乙丑', earning: 12.5, qiCost: 3, leverage: 1 }],
          baseQiRecover: 10,
          waitQiRecover: 0,
          marginCallTriggered: false,
          marginCallDetails: [],
          finalQi: 70,
          finalScore: 12.5,
        },
      }),
      entry({
        round: 3,
        action: 'wait',
        settlement: {
          round: 3,
          season: 'spring',
          holdEarnings: 13.2,
          holdQiCost: 3,
          holdItems: [{ cardName: '乙丑', earning: 13.2, qiCost: 3, leverage: 1 }],
          baseQiRecover: 10,
          waitQiRecover: 10,
          marginCallTriggered: false,
          marginCallDetails: [],
          finalQi: 80,
          finalScore: 25.7,
        },
      }),
    ];

    const [s] = aggregateCardSummaries(log);
    expect(s.holdEarnings).toBeCloseTo(25.7);
    expect(s.buys).toBe(1);
    expect(s.sells).toBe(0);
    expect(s.holding).toBe(true);
  });

  it('反噬罚分计入单卡总收益（卖出+炼化-反噬）', () => {
    const log: RoundLogEntry[] = [
      entry({
        round: 2,
        action: 'buy',
        actionCardName: '丙寅',
        settlement: {
          round: 2,
          season: 'spring',
          holdEarnings: 5,
          holdQiCost: 3,
          holdItems: [{ cardName: '丙寅', earning: 5, qiCost: 3, leverage: 2 }],
          baseQiRecover: 10,
          waitQiRecover: 0,
          marginCallTriggered: false,
          marginCallDetails: [],
          finalQi: 70,
          finalScore: 5,
        },
      }),
      entry({
        round: 4,
        action: 'wait',
        settlement: {
          round: 4,
          season: 'spring',
          holdEarnings: 0,
          holdQiCost: 0,
          holdItems: [],
          baseQiRecover: 10,
          waitQiRecover: 0,
          marginCallTriggered: true,
          marginCallDetails: [
            {
              cardName: '丙寅',
              slotIndex: 0,
              penaltyScore: 24,
              leverage: 2,
              cardScore: -12,
              reason: '测试反噬',
            },
          ],
          finalQi: 50,
          finalScore: 5,
        },
      }),
    ];

    const [s] = aggregateCardSummaries(log);
    expect(s.penalty).toBe(24);
    expect(s.holdEarnings).toBe(5);
    expect(s.total).toBe(5 - 24);
    expect(s.holding).toBe(true); // 买 1 卖 0，仍持有（反噬清仓不计入卖出）
  });

  it('排序按最后操作回合倒序', () => {
    const log: RoundLogEntry[] = [
      entry({ round: 2, action: 'buy', actionCardName: '甲子', publicCards: [{ id: 1, name: '甲子', mainElement: Element.WOOD, yinYang: YinYang.YANG }] }),
      entry({ round: 5, action: 'buy', actionCardName: '戊午', publicCards: [{ id: 2, name: '戊午', mainElement: Element.FIRE, yinYang: YinYang.YANG }] }),
      entry({ round: 3, action: 'buy', actionCardName: '癸亥', publicCards: [{ id: 3, name: '癸亥', mainElement: Element.WATER, yinYang: YinYang.YIN }] }),
    ];

    const summaries = aggregateCardSummaries(log);
    expect(summaries.map((s) => s.name)).toEqual(['戊午', '癸亥', '甲子']);
  });

  it('同一张卡多次买卖：次数累计，持有中按净余判定', () => {
    const log: RoundLogEntry[] = [
      entry({ round: 2, action: 'buy', actionCardName: '甲子', sellScore: null }),
      entry({ round: 4, action: 'sell', actionCardName: '甲子', sellScore: 10 }),
      entry({ round: 6, action: 'buy', actionCardName: '甲子' }),
    ];

    const [s] = aggregateCardSummaries(log);
    expect(s.buys).toBe(2);
    expect(s.sells).toBe(1);
    expect(s.holding).toBe(true); // 净持有 1 张
    expect(s.lastRound).toBe(6);
  });

  it('countSettled 统计已了结张数', () => {
    const log: RoundLogEntry[] = [
      entry({ round: 2, action: 'buy', actionCardName: '甲子' }),
      entry({ round: 3, action: 'buy', actionCardName: '戊午' }),
      entry({ round: 4, action: 'sell', actionCardName: '甲子', sellScore: 5 }),
    ];
    const summaries = aggregateCardSummaries(log);
    expect(countSettled(summaries)).toBe(1); // 甲子已了结，戊午持有中
  });

  it('调息/首回合无行动卡不产生聚合', () => {
    const log: RoundLogEntry[] = [
      entry({ round: 1, action: null }),
      entry({ round: 2, action: 'wait' }),
    ];
    expect(aggregateCardSummaries(log)).toEqual([]);
  });
});
