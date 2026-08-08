import { describe, it, expect, vi } from 'vitest';

// 模拟浏览器环境（TurnManager 内部用 localStorage）
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

import { TurnManager } from '../../src/core/TurnManager';

describe('卡牌循环：卖出回牌堆验证', () => {
  it('买入后卖出，牌堆数量变化正确', async () => {
    const tm = new TurnManager();
    await tm.initialize();
    tm.startGame(); // 抽 3 张到公共区，deck 60 -> 57

    const deckAfterStart = tm.getDeckSize();
    expect(deckAfterStart).toBe(57);

    // 买入 1 张：
    //   buyCard: 买 1 进手牌，未选 2 张回堆（deck +2 → 59）
    //   advanceTurn → 下回合 drawCards 抽 3（deck -3 → 56）
    const buyOk = tm.executeBuy(0, false);
    expect(buyOk).toBe(true);
    const deckAfterBuy = tm.getDeckSize();
    expect(deckAfterBuy).toBe(56);
    expect(tm.getHand().filter((s) => s !== null).length).toBe(1);

    // 卖出 1 张：
    //   sell: 手牌回堆（deck +1 → 57）+ 公共池未锁定牌回堆（deck +3 → 60）。
    //   （2026-08-08 修复：此前 executeSell 不回堆公共池未锁牌，残留旧牌在
    //     下回合 drawCards 重建时被直接丢弃，每卖一次全局少 3 张——公共池缩水根因。）
    //   advanceTurn → 下回合 drawCards 抽 3（deck -3 → 57）
    const sellOk = tm.executeSell(0);
    expect(sellOk).toBe(true);
    const deckAfterSell = tm.getDeckSize();
    expect(deckAfterSell).toBe(57);
    expect(tm.getHand().filter((s) => s !== null).length).toBe(0);
    // 守恒：deck + 公共池 + 手牌 = 60（甲子牌不增不减）
    expect(deckAfterSell + tm.getPublicCards().length).toBe(60);

    console.log(`deck: 开局后 ${deckAfterStart} → 买入后 ${deckAfterBuy} → 卖出后 ${deckAfterSell}`);
  });
});
