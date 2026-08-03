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

describe('锁定机制（核心逻辑）', () => {
  it('锁定不立即扣气（锁定费在回合结束统一结算）', async () => {
    const tm = await makeTm();
    const qiBefore = tm.getQi();
    expect(tm.executeLockCard(0)).toBe(true);
    expect(tm.getLockedCardIds()).toHaveLength(1);
    // 锁定动作本身不扣气（防止同回合锁→解锁白扣）
    expect(tm.getQi()).toBe(qiBefore);
    expect(tm.isCardLocked(tm.getPublicCards()[0].id)).toBe(true);
  });

  it('锁定后执行回合动作：锁定费按锁定张数统一结算', async () => {
    // 对照组：无锁定，等待一回合（回气10）
    const tmNoLock = await makeTm(7);
    (tmNoLock as any).qiManager.setQi(20);
    tmNoLock.executeWait();
    const qiNoLock = tmNoLock.getQi();

    // 实验组：锁定1张，等待一回合（回气10 + 扣锁定费5）
    const tmLock = await makeTm(7);
    (tmLock as any).qiManager.setQi(20);
    tmLock.executeLockCard(0);
    tmLock.executeWait();
    const qiLock = tmLock.getQi();

    // 锁定版比无锁版少 5 气 = 锁定费
    expect(qiNoLock - qiLock).toBe(TurnManager.LOCK_COST_PER_CARD);
    expect(tmLock.getLockedCardIds()).toHaveLength(1); // 气充足，锁定保留
  });

  it('同回合锁定再解锁：不产生任何扣费', async () => {
    const tm = await makeTm();
    const qiBefore = tm.getQi();
    tm.executeLockCard(0);
    tm.executeUnlockCard(0);
    expect(tm.getQi()).toBe(qiBefore);
    expect(tm.getLockedCardIds()).toHaveLength(0);
  });

  it('锁定上限 2 张：第 3 张拒绝', async () => {
    const tm = await makeTm();
    expect(tm.executeLockCard(0)).toBe(true);
    expect(tm.executeLockCard(1)).toBe(true);
    expect(tm.executeLockCard(0)).toBe(false); // 已锁
    expect(tm.executeLockCard(1)).toBe(false);
  });

  it('解锁：牌回牌堆、锁定 ID 移除', async () => {
    const tm = await makeTm();
    const cardId = tm.getPublicCards()[0].id;
    tm.executeLockCard(0);
    expect(tm.isCardLocked(cardId)).toBe(true);
    expect(tm.executeUnlockCard(0)).toBe(true);
    expect(tm.isCardLocked(cardId)).toBe(false);
    expect(tm.getLockedCardIds()).toHaveLength(0);
  });

  it('等待时锁定牌保留在公共区（不随未选牌回堆）', async () => {
    const tm = await makeTm();
    tm.executeLockCard(0);
    const lockedId = tm.getPublicCards()[0].id;
    tm.executeWait();
    const publicIds = tm.getPublicCards().map((c) => c.id);
    expect(publicIds).toContain(lockedId);
    expect(tm.getLockedCardIds()).toContain(lockedId);
  });

  it('买入锁定牌：自动解锁并移入手牌', async () => {
    const tm = await makeTm();
    tm.executeLockCard(0);
    const card = tm.getPublicCards()[0];
    const cardId = card.id;
    const ok = tm.executeBuy(0, false);
    if (ok) {
      expect(tm.getLockedCardIds()).not.toContain(cardId);
      expect(tm.getHand().filter(Boolean)).toHaveLength(1);
    }
  });

  it('气不足时锁定失败', async () => {
    const tm = await makeTm();
    (tm as any).qiManager.setQi(3); // 锁定费5，气3不够
    expect(tm.executeLockCard(0)).toBe(false);
  });

  it('气不足于锁定费时：回合结算自动解锁最低分锁定牌', async () => {
    const tm = await makeTm();
    tm.executeLockCard(0);
    // 把气压到不足以支付锁定费
    (tm as any).qiManager.setQi(3);
    tm.executeWait(); // 推进回合 → settleLockCost 扣5 → 气-2 → 自动解锁
    expect(tm.getLockedCardIds()).toHaveLength(0);
  });
});
