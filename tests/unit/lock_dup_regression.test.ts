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
 * 回归测试：bug 源于 `executeBuy` 的 filter 闭包误用。
 * 原代码 `.filter((_, i) => i !== cardIndex && !this.lockedCardIds.includes(card.id))`
 * 里 `card` 是外层闭包变量（要买的牌），不是当前 filter 元素。
 *
 * 当买非锁定牌时，`!lockedCardIds.includes(card.id)` 永远为 true，
 * filter 会把**所有锁定的牌**都加进 remainingCards 并 returnCards 到 deck。
 * 此时该锁定牌既在 publicCards 数组里（executeBuy 未删除），又出现在 deck 里——
 * 下次 drawCards 抽牌时可能正好抽到这张牌的副本，使 publicCards 出现
 * 「两张同 id 的锁定牌」（用户截图中的 bug）。
 */
describe('锁定 + 买入回归测试（2026-08-03 用户报告）', () => {
  it('买非锁定牌：锁定牌不应被错误回牌堆（deck + publicCards 不应同时持有同一张锁定牌）', async () => {
    const tm = await makeTm(1);
    // 锁 0/1
    tm.executeLockCard(0);
    tm.executeLockCard(1);
    const lockedIds = [...tm.getLockedCardIds()];
    expect(lockedIds).toHaveLength(2);
    const deckSizeBefore = (tm as any).cardPoolManager.getDeckSize();

    // 找一个非锁定牌买；如果没有则跳过
    const publicCards = tm.getPublicCards();
    const unlockedIdx = publicCards.findIndex(c => !lockedIds.includes(c.id));
    if (unlockedIdx < 0) throw new Error('测试前提不满足：没有可买的非锁定牌');
    const unlockedId = publicCards[unlockedIdx].id;
    const ok = tm.executeBuy(unlockedIdx, false);
    expect(ok).toBe(true);

    // 关键：所有锁定的牌**必须仍在 publicCards 数组里**（不该被回 deck 再被抽到副本）
    const publicAfter = tm.getPublicCards();
    for (const lockedId of lockedIds) {
      const occurrences = publicAfter.filter(c => c.id === lockedId).length;
      expect(occurrences).toBe(1); // 每张锁定牌只应在公共区出现 1 次
    }

    // 锁定牌不应被错误地放进 deck（会导致 deck 与 publicCards 同时持有同一引用）
    const deck = (tm as any).cardPoolManager.getDeck();
    for (const lockedId of lockedIds) {
      const inDeck = deck.some((c: any) => c.id === lockedId);
      expect(inDeck).toBe(false);
    }

    // 验证 deckSize 变化合理：drawCards 抽了 (3 - lockedCount) 张，所以 deck 减少
    // 锁定牌没回 deck，公共区净增 0 张（被买的牌已删 / 锁定牌保留 / 抽出新牌）
    const deckSizeAfter = (tm as any).cardPoolManager.getDeckSize();
    expect(deckSizeAfter).toBeLessThanOrEqual(deckSizeBefore);
  });

  it('30 回合确定性买/等循环（每回合买一次）：publicCards 不应有重复 id', async () => {
    // 用户场景：玩家长时间玩 + 锁定 + 买入。修复前会在若干回合后出现重复。
    for (let seed = 1; seed <= 5; seed++) {
      const tm = await makeTm(seed);
      for (let r = 1; r <= 30; r++) {
        const publicCards = tm.getPublicCards();
        const qi = tm.getQi();
        // 锁前两张（如果能）
        for (let i = 0; i < 2; i++) {
          const c = publicCards[i];
          if (c && !tm.getLockedCardIds().includes(c.id) && qi > 5) {
            tm.executeLockCard(i);
          }
        }
        // 偶数回合买、奇数回合等（确定性，不依赖 Math.random）
        const canBuy = tm.getHand().filter(s => s).length < 3;
        if (canBuy && r % 2 === 0 && qi > 10) {
          tm.executeBuy(0, false);
        } else {
          tm.executeWait();
        }
        // 每回合后检查 publicCards 数组无重复
        const ids = tm.getPublicCards().map(c => c.id);
        const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(dup, `seed=${seed} round=${tm.getCurrentRound()}: publicCards has duplicates: ${ids.join(',')}`).toEqual([]);
      }
    }
  });

  it('deck 集合在长时间游戏中不丢失牌（不应少于 60 - hand - locked - publicCards）', async () => {
    // 修复前 deck 会随时间"漏"牌（部分牌既不在 deck/hand/publicCards/locked 任何位置）
    const tm = await makeTm(1);
    for (let r = 1; r <= 30; r++) {
      const qi = tm.getQi();
      for (let i = 0; i < 2; i++) {
        const c = tm.getPublicCards()[i];
        if (c && !tm.getLockedCardIds().includes(c.id) && qi > 5) {
          tm.executeLockCard(i);
        }
      }
      const canBuy = tm.getHand().filter(s => s).length < 3;
      if (canBuy && r % 2 === 0 && qi > 10) {
        tm.executeBuy(0, false);
      } else {
        tm.executeWait();
      }
      // 检查牌守恒：deck + hand + publicCards 总和应为 60 张
      const deck = (tm as any).cardPoolManager.getDeck();
      const hand = tm.getHand().filter(s => s);
      const publicCards = tm.getPublicCards();
      const totalCount = deck.length + hand.length + publicCards.length;
      // 也应该没有重复
      const allIds = [
        ...deck.map((c: any) => c.id),
        ...hand.map(s => s!.card.id),
        ...publicCards.map(c => c.id),
      ];
      const allDup = allIds.filter((id, i) => allIds.indexOf(id) !== i);
      if (allDup.length > 0) {
        console.log(`[seed=1 r=${r}] deck=[${deck.map((c: any) => c.id).join(',')}] hand=[${hand.map(s => s!.card.id).join(',')}] public=[${publicCards.map(c => c.id).join(',')}]`);
        console.log(`  totalCount=${totalCount}, allIds=${allIds.join(',')}`);
      }
      expect(allDup, `seed=1 round=${tm.getCurrentRound()}: total cards have duplicates: ${allIds.join(',')}`).toEqual([]);
      // 牌守恒：总数 = 60
      expect(totalCount, `seed=1 round=${tm.getCurrentRound()}: total=${totalCount} (deck=${deck.length}, hand=${hand.length}, public=${publicCards.length})`).toBe(60);
    }
  });
});
