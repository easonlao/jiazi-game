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

/**
 * 回归测试：bug 源于 CardPoolManager.drawCards 的 `[...lockedCards, ...newCards]`。
 * 每次刷新都把锁定牌强制重排到数组最前部，导致锁定牌在公共展示区的位置每回合漂移。
 * 修复：记录锁定牌在公共区的原始索引，新牌只填充非锁定位置，锁定牌原地不动。
 */
describe('锁定牌位置稳定性回归测试', () => {
  it('锁定中间牌（索引1），连续 executeWait 推进多回合，位置保持不变', async () => {
    const tm = await makeTm(3);
    expect(tm.executeLockCard(1)).toEqual({ ok: true });
    const lockedId = tm.getPublicCards()[1].id;
    const origIndex = tm.getPublicCards().findIndex((c) => c.id === lockedId);
    expect(origIndex).toBe(1);

    for (let r = 0; r < 10; r++) {
      expect(tm.executeWait()).toBe(true);
      const idx = tm.getPublicCards().findIndex((c) => c.id === lockedId);
      expect(tm.isCardLocked(lockedId)).toBe(true);
      expect(
        idx,
        `回合 ${tm.getCurrentRound()}: 锁定牌 ${lockedId} 漂移到索引 ${idx}（预期 ${origIndex}）`
      ).toBe(origIndex);
    }
  });

  it('锁定两张牌（索引1、2），连续 executeWait 推进多回合，各自位置保持不变', async () => {
    const tm = await makeTm(7);
    expect(tm.executeLockCard(1)).toEqual({ ok: true });
    expect(tm.executeLockCard(2)).toEqual({ ok: true });
    const lockedId1 = tm.getPublicCards()[1].id;
    const lockedId2 = tm.getPublicCards()[2].id;

    for (let r = 0; r < 8; r++) {
      expect(tm.executeWait()).toBe(true);
      const pub = tm.getPublicCards();
      const i1 = pub.findIndex((c) => c.id === lockedId1);
      const i2 = pub.findIndex((c) => c.id === lockedId2);
      expect(i1, `回合 ${tm.getCurrentRound()}: 锁定牌 ${lockedId1} 漂移到索引 ${i1}`).toBe(1);
      expect(i2, `回合 ${tm.getCurrentRound()}: 锁定牌 ${lockedId2} 漂移到索引 ${i2}`).toBe(2);
      // 锁定牌只应出现 1 次，未被替换/复制
      expect(pub.filter((c) => c.id === lockedId1)).toHaveLength(1);
      expect(pub.filter((c) => c.id === lockedId2)).toHaveLength(1);
    }
  });

  it('买入非锁定牌后（executeBuy 推进），锁定牌位置不变', async () => {
    const tm = await makeTm(5);
    expect(tm.executeLockCard(1)).toEqual({ ok: true });
    const lockedId = tm.getPublicCards()[1].id;

    // 充足气保证买入成功（锁定在索引1，索引0必为非锁定牌）
    (tm as any).qiManager.setQi(80);
    const ok = tm.executeBuy(0, false);
    expect(ok).toBe(true);

    const idx = tm.getPublicCards().findIndex((c) => c.id === lockedId);
    expect(idx).toBe(1);
    expect(tm.isCardLocked(lockedId)).toBe(true);

    // 再推进几回合验证位置持续稳定
    for (let r = 0; r < 5; r++) {
      expect(tm.executeWait()).toBe(true);
      const i = tm.getPublicCards().findIndex((c) => c.id === lockedId);
      expect(i, `回合 ${tm.getCurrentRound()}: 锁定牌 ${lockedId} 漂移到索引 ${i}`).toBe(1);
    }
  });
});
