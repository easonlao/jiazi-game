/**
 * 回归测试（草案）：反噬/卖出后公共池不应缩水到 2 张。
 * 复现路径：卖出后公共池残留 → 下回合 drawCards 丢弃旧牌不回堆 → deck 流失。
 */
import { describe, it, expect } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

async function makeTm(seed = 42) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  const tm = new TurnManager(undefined, new SeededRandomSource(seed));
  await tm.initialize();
  (tm as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
  tm.startGame();
  return tm;
}

function totalCards(tm: TurnManager): number {
  const deck = (tm as any).cardPoolManager.getDeck().length;
  const pub = tm.getPublicCards().length;
  const hand = tm.getHand().filter(Boolean).length;
  return deck + pub + hand;
}

describe('公共池守恒回归：买入→卖出循环后公共池恒 3 张', () => {
  it('连续买卖 10 轮：公共池始终 3 张、总牌数守恒 60', async () => {
    const tm = await makeTm(7);
    expect(totalCards(tm)).toBe(60);

    for (let i = 0; i < 10; i++) {
      const pub = tm.getPublicCards();
      expect(pub.length).toBe(3);
      expect(tm.executeBuy(0, true)).toBe(true);
      expect(tm.executeSell(0)).toBe(true);
      // 卖出后公共池 + deck + hand 总和必须守恒（60 张甲子牌不增不减）
      expect(totalCards(tm)).toBe(60);
    }
    expect(tm.getPublicCards().length).toBe(3);
  });

  it('卖出后公共池立即清空（未锁定牌回堆），下回合重新抽满 3 张', async () => {
    const tm = await makeTm(42);
    expect(tm.executeBuy(0, false)).toBe(true);
    expect(tm.executeSell(0)).toBe(true);
    // 修复点：卖出后公共池非锁定牌必须回堆，不能残留
    expect(tm.getPublicCards().length).toBe(3); // 下回合已重抽
    expect(totalCards(tm)).toBe(60);
  });

  it('反噬（强平）后公共池仍为 3 张且总牌守恒', async () => {
    const tm = await makeTm(7);
    // 买入一张杠杆牌（高消耗，拉低气）
    expect(tm.executeBuy(0, true)).toBe(true);
    // 把气打到 0，触发下一回合结算时的强平
    (tm as any).qiManager.setQi(0);
    expect(tm.executeWait()).toBe(true);
    // 强平触发后：被反噬牌回堆 + 公共池重抽，总量守恒
    expect(tm.getMarginCallCount()).toBeGreaterThan(0);
    expect(tm.getPublicCards().length).toBe(3);
    expect(totalCards(tm)).toBe(60);
  });

  it('卖出+锁定混合：锁定牌保留在公共区、未锁定牌回堆，总量守恒', async () => {
    const tm = await makeTm(99);
    // 锁定第一张公共牌
    expect(tm.executeLockCard(0)).toEqual({ ok: true });
    const lockedId = tm.getPublicCards()[0].id;
    // 买入第二张
    expect(tm.executeBuy(1, false)).toBe(true);
    // 锁定牌必须仍在公共区
    expect(tm.getPublicCards().some((c) => c.id === lockedId)).toBe(true);
    // 卖出 → 公共池中锁定牌保留、其余回堆，总量守恒
    expect(tm.executeSell(0)).toBe(true);
    expect(tm.getPublicCards().some((c) => c.id === lockedId)).toBe(true);
    expect(tm.getPublicCards().length).toBe(3);
    expect(totalCards(tm)).toBe(60);
  });
});
