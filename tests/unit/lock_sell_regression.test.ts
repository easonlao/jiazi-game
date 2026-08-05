import { describe, it, expect, vi } from 'vitest';
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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed));
  await tm.initialize();
  (tm as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
  tm.startGame();
  return tm;
}

describe('卖出与锁定回归：气充足不解锁，气不足解锁必须通知', () => {
  it('场景1：气充足时卖出牌，锁定牌保持锁定且无自动解锁通知', async () => {
    const tm = await makeTm(42);
    const autoUnlockSpy = vi.fn();
    tm.setOnLockAutoUnlocked(autoUnlockSpy);

    // 锁定一张公共牌
    expect(tm.executeLockCard(0)).toEqual({ ok: true });
    const lockedId = tm.getPublicCards()[0].id;

    // 买入另一张手牌作为待卖对象（买入会推进回合，锁定牌在结算后仍须保留）
    expect(tm.executeBuy(1, false)).toBe(true);
    expect(tm.getHand().filter(Boolean)).toHaveLength(1);

    // 气充足路径：把气抬到安全水位再卖出，模拟"气够付卖出费+锁定费"
    (tm as any).qiManager.setQi(40);
    expect(tm.executeSell(0)).toBe(true);
    expect(tm.getHand().filter(Boolean)).toHaveLength(0);

    // 锁定牌未被误解锁：仍在锁定列表、仍在公共区
    expect(tm.getLockedCardIds()).toContain(lockedId);
    expect(tm.getPublicCards().some((c) => c.id === lockedId)).toBe(true);
    // 结算后气为正（否则会触发自动解锁），且未发出解锁通知
    expect(tm.getQi()).toBeGreaterThan(0);
    expect(autoUnlockSpy).not.toHaveBeenCalled();
  });

  it('场景2：气不足付锁定费时回合末自动解锁，并发出明确通知', async () => {
    const tm = await makeTm(42);
    const autoUnlockSpy = vi.fn();
    tm.setOnLockAutoUnlocked(autoUnlockSpy);

    expect(tm.executeLockCard(0)).toEqual({ ok: true });
    const lockedId = tm.getPublicCards()[0].id;

    // 压低气量，使回合末锁定费（5 气）结算后 qi <= 0 → 触发自动解锁
    (tm as any).qiManager.setQi(3);
    tm.executeWait();

    // 锁定被自动解锁
    expect(tm.getLockedCardIds()).toHaveLength(0);
    // 通知被触发，且携带被解锁的牌 ID
    expect(autoUnlockSpy).toHaveBeenCalledTimes(1);
    expect(autoUnlockSpy.mock.calls[0][0]).toEqual([lockedId]);
    // 被解锁牌回牌堆，不再出现在公共区
    expect(tm.getPublicCards().some((c) => c.id === lockedId)).toBe(false);
  });

  it('场景2b：多张锁定牌时，气不足只自动解锁评分最低的一张', async () => {
    const tm = await makeTm(42);
    const autoUnlockSpy = vi.fn();
    tm.setOnLockAutoUnlocked(autoUnlockSpy);

    expect(tm.executeLockCard(0)).toEqual({ ok: true });
    const cardA = tm.getPublicCards()[0];
    expect(tm.executeLockCard(1)).toEqual({ ok: true });
    const cardB = tm.getPublicCards()[1];

    // 两张锁定费共 10 气：气 7 只够解 1 张（解锁后 +5 → 2 > 0 停止）
    (tm as any).qiManager.setQi(7);
    tm.executeWait();

    // 与 settleLockCost 同规则（同分优先解锁定列表靠前的）：先解评分最低的
    const season = tm.getCurrentSeason();
    const scoreA = tm.getCardScore(cardA, season);
    const scoreB = tm.getCardScore(cardB, season);
    const shouldUnlockFirst = scoreA <= scoreB ? cardA : cardB;
    const shouldRemain = shouldUnlockFirst === cardA ? cardB : cardA;

    expect(autoUnlockSpy).toHaveBeenCalledTimes(1);
    expect(autoUnlockSpy.mock.calls[0][0]).toEqual([shouldUnlockFirst.id]);
    expect(tm.getLockedCardIds()).toEqual([shouldRemain.id]);
  });
});
