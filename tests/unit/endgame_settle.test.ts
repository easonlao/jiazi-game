/**
 * 终局强制平仓专项测试。
 *
 * 设计（2026-08-07 用户确认）：
 * - 结算价格 = 正常卖出公式（当前季评分 vs 买入评分 + 当前动态杠杆）
 * - 收益计入修为（totalSettleEarnings 独立口径），**不计入** totalSells / decisionLog
 * - roundLog 以 action='settle' 归档，看板「出清」徽章
 *
 * 核心断言：
 * 1. 终局时所有未卖出持仓被强平，手牌清空
 * 2. totalSettleEarnings = settle 记录 sellScore 之和
 * 3. 统计口径纯净：主动释灵次数 totalSells 不因强平增加；decisionLog 无 settle
 * 4. 经手卡聚合：settles 计数、holding=false（终局后无「持有中」）
 * 5. 存档往返：totalSettleEarnings 保留；老存档缺字段回退 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { aggregateCardSummaries } from '../../app/src/lib/cardSummary';

// 模拟浏览器 localStorage
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { for (const key in localStorageStore) delete localStorageStore[key]; },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 fetch 返回 60 张卡牌数据（同 smoke.test）
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve(
      Array.from({ length: 60 }, (_, i) => {
        const tianGan = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'][i % 10];
        const diZhi = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'][Math.floor(i / 10)];
        return {
          id: i + 1,
          name: `${tianGan}${diZhi}`,
          tianGan,
          diZhi,
          tianGanElement: ['wood','wood','fire','fire','earth','earth','metal','metal','water','water'][i % 10],
          diZhiElement: ['water','earth','wood','wood','earth','fire','fire','earth','metal','metal','earth','water'][Math.floor(i / 10)],
          mainElement: ['wood','wood','fire','fire','earth','earth','metal','metal','water','water'][i % 10],
          yinYang: i % 2 === 0 ? 'yang' : 'yin',
        };
      })
    ),
  })
) as any;

/** 打完整局：手牌有空位就买第一张（终局必留持仓），否则等待 */
function playToEnd(tm: TurnManager): void {
  tm.startGame();
  let guard = 0;
  while (tm.getState() === 'player_action' && guard++ < 80) {
    const handFull = tm.getHand().every((s) => s !== null);
    if (!handFull) {
      const ok = tm.executeBuy(0, false);
      if (ok) continue;
    }
    tm.executeWait();
  }
}

describe('终局强制平仓', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('终局时所有未卖出持仓被强平，手牌清空，出清收益计入修为', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    playToEnd(tm);

    expect(tm.getState()).toBe('game_over');
    // 1. 手牌清空（全部被强平）
    expect(tm.getHand().every((s) => s === null)).toBe(true);

    // 2. 有 settle 记录（终局回合归档）
    const settleEntries = tm.getRoundLog().filter((e) => e.action === 'settle');
    expect(settleEntries.length).toBeGreaterThan(0);
    // settle 记录在终局回合（61）之后追加
    expect(settleEntries.every((e) => e.round === 61)).toBe(true);

    // 3. 出清收益 = settle 记录 sellScore 之和 = totalSettleEarnings
    const sum = settleEntries.reduce((acc, e) => acc + (e.sellScore ?? 0), 0);
    expect(tm.getTotalSettleEarnings()).toBeCloseTo(sum, 5);
  });

  it('统计口径纯净：强平不计入释灵次数、不写决策日志', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    playToEnd(tm);

    // 本局从未主动卖出 → totalSells 恒 0（终局强平不污染主动行为统计）
    expect(tm.getTotalSells()).toBe(0);
    // 决策日志无 settle（系统行为非玩家决策）
    expect(tm.getDecisionLog().some((d) => d.action === 'settle')).toBe(false);
  });

  it('杠杆持仓按当前动态杠杆出清', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();

    // 尽量买入第一张公共牌（带杠杆），直到手牌满，然后等待至终局
    let guard = 0;
    while (tm.getState() === 'player_action' && guard++ < 80) {
      const handFull = tm.getHand().every((s) => s !== null);
      if (!handFull) {
        const ok = tm.executeBuy(0, true);
        if (ok) continue;
      }
      tm.executeWait();
    }

    const settleEntries = tm.getRoundLog().filter((e) => e.action === 'settle');
    // 至少买到过一张牌并被强平（若整局买入全失败则跳过杠杆断言）
    expect(settleEntries.length).toBeGreaterThanOrEqual(1);
    // 每张出清记录都有买入评分与出清评分（价差可正可负）
    for (const e of settleEntries) {
      expect(e.buyScore).not.toBeNull();
      expect(e.actionCardScore).not.toBeNull();
    }
    // 修为 = 炼化 + 出清 - 反噬（本局有杠杆可能触发反噬，等式用构成恒等验证）
    const { totalHoldEarnings, totalSellEarnings, totalSettleEarnings, totalMarginCallPenalty } = {
      totalHoldEarnings: tm.getTotalHoldEarnings(),
      totalSellEarnings: tm.getTotalSellEarnings(),
      totalSettleEarnings: tm.getTotalSettleEarnings(),
      totalMarginCallPenalty: tm.getTotalMarginCallPenalty(),
    };
    expect(tm.getScore()).toBeCloseTo(totalHoldEarnings + totalSellEarnings + totalSettleEarnings - totalMarginCallPenalty, 5);
  });

  it('经手卡聚合：出清计入 settles、终局后无「持有中」', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    playToEnd(tm);

    const summaries = aggregateCardSummaries(tm.getRoundLog() as never);
    const settledCards = summaries.filter((s) => s.settles > 0);
    expect(settledCards.length).toBeGreaterThan(0);
    // 出清过的卡终局后全部已了结（净持仓 = 买入 - 卖出 - 反噬 - 出清 ≤ 0）
    for (const s of settledCards) {
      expect(s.holding).toBe(false);
      expect(s.settleEarnings).toBeCloseTo(
        tm.getRoundLog().filter((e) => e.action === 'settle' && e.actionCardName === s.name)
          .reduce((acc, e) => acc + (e.sellScore ?? 0), 0),
        5,
      );
    }
  });

  it('存档往返：totalSettleEarnings 保留；老存档缺字段回退 0', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
    // 打几回合后导出快照，手动设置出清收益模拟已结算状态
    for (let i = 0; i < 5; i++) tm.executeWait();
    const snap = tm.exportSnapshot();
    snap.totalSettleEarnings = 123.4;

    const tm2 = new TurnManager();
    await tm2.initialize();
    tm2.importSnapshot(snap);
    expect(tm2.getTotalSettleEarnings()).toBe(123.4);

    // 老存档（无字段）回退 0
    const oldSnap = tm.exportSnapshot();
    delete (oldSnap as any).totalSettleEarnings;
    const tm3 = new TurnManager();
    await tm3.initialize();
    tm3.importSnapshot(oldSnap);
    expect(tm3.getTotalSettleEarnings()).toBe(0);
  });
});
