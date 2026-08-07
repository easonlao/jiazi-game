/**
 * 行迹看板数据一致性不变量测试（Issue 01：数据一致性诊断）。
 *
 * 背景（2026-08-07 用户截图）：局终看板「经手 23 张 > 纳灵 18 次」「了结 18 张 > 释灵 15 次」。
 * 诊断结论：引擎层新局不变量成立；破坏路径 = 读档（老存档 roundLog 缺失/不全）后，
 * 手牌卡在 roundLog 无 buy 记录 → 聚合产生「幽灵卡」（buys=0 但有炼化/反噬），
 * 虚增经手数、虚高了结数。修复：importSnapshot 补录缺失 buy 记录。
 *
 * 不变量定义：
 * - 经手卡牌数（aggregateCardSummaries().length）≤ 纳灵次数（totalBuys）
 * - 了结卡牌数（countSettled）≤ 释灵次数（totalSells）+ 反噬次数（marginCallCount）
 *   （了结可能少于卖出+反噬：读档前已卖出的卡无 roundLog 记录，属偏小方向，不破坏）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { aggregateCardSummaries, countSettled } from '../../app/src/lib/cardSummary';

const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { for (const key in localStorageStore) delete localStorageStore[key]; },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

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

/** 断言两个不变量（引擎当前状态 + 聚合结果） */
function expectInvariants(tm: TurnManager): void {
  const summaries = aggregateCardSummaries(tm.getRoundLog() as never);
  expect(summaries.length).toBeLessThanOrEqual(tm.getTotalBuys());
  expect(countSettled(summaries)).toBeLessThanOrEqual(tm.getTotalSells() + tm.getMarginCallCount());
  // 无幽灵卡：每张有炼化/反噬的卡必有买入记录
  for (const s of summaries) {
    if (s.holdEarnings !== 0 || s.penalty !== 0) {
      expect(s.buys, `${s.name} 幽灵卡（无买入但有收益）`).toBeGreaterThan(0);
    }
  }
}

describe('行迹看板数据一致性不变量', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('新局：买入持有后不变量成立', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
    // 买 2 张卡（手牌可容 3 张），持有不卖
    expect(tm.executeBuy(0, false)).toBe(true);
    expect(tm.executeBuy(0, false)).toBe(true);
    // 玩几回合产生炼化
    for (let i = 0; i < 5; i++) tm.executeWait();
    expectInvariants(tm);
  });

  it('新局：买卖循环 + 终局强平后不变量成立（终局无持有中）', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
    let guard = 0;
    while (tm.getState() === 'player_action' && guard++ < 80) {
      const hand = tm.getHand();
      const idx = hand.findIndex((s) => s !== null);
      if (idx !== -1 && Math.random() < 0.4) {
        if (!tm.executeSell(idx)) tm.executeWait();
      } else if (hand.some((s) => s === null)) {
        if (!tm.executeBuy(0, false)) tm.executeWait();
      } else {
        tm.executeWait();
      }
    }
    expect(tm.getState()).toBe('game_over');
    expectInvariants(tm);
    // 终局后全部已了结（终局强平保证无「持有中」残留）
    const summaries = aggregateCardSummaries(tm.getRoundLog() as never);
    expect(summaries.every((s) => !s.holding)).toBe(true);
  });

  it('读档局（老存档 roundLog 缺失）：补录后无幽灵卡，不变量成立', async () => {
    // 第一局：买入一张卡并持有
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
    expect(tm.executeBuy(0, false)).toBe(true);
    for (let i = 0; i < 3; i++) tm.executeWait();

    // 导出快照并清空 roundLog，模拟老版本存档（无回合数据留存）
    const snap = tm.exportSnapshot();
    (snap as any).roundLog = [];
    const totalBuys = snap.totalBuys;

    // 读档继续玩（产生 holdItems）
    const tm2 = new TurnManager();
    await tm2.initialize();
    tm2.importSnapshot(snap);
    for (let i = 0; i < 3; i++) tm2.executeWait();

    // 补录生效：roundLog 中有该卡的 buy 记录，聚合无幽灵卡
    const summaries = aggregateCardSummaries(tm2.getRoundLog() as never);
    const holdCards = summaries.filter((s) => s.holdEarnings !== 0);
    expect(holdCards.length).toBeGreaterThan(0);
    for (const s of holdCards) {
      expect(s.buys).toBeGreaterThan(0);
    }
    // 不变量成立（经手 ≤ 纳灵，读档恢复的纳灵计数同样约束）
    expect(summaries.length).toBeLessThanOrEqual(totalBuys);
    expectInvariants(tm2);
  });

  it('读档局（roundLog 保留的新版本存档）：不变量成立', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame();
    expect(tm.executeBuy(0, false)).toBe(true);
    for (let i = 0; i < 3; i++) tm.executeWait();
    const snap = tm.exportSnapshot(); // roundLog 完整保留

    const tm2 = new TurnManager();
    await tm2.initialize();
    tm2.importSnapshot(snap);
    for (let i = 0; i < 3; i++) tm2.executeWait();
    expectInvariants(tm2);
  });
});
