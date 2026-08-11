import { describe, it, expect, beforeEach } from 'vitest';
import { GameSaveService, LeaderboardService, TurnManager, type StorageProvider } from '../../src/core/index';
import type { GameSnapshot } from '../../src/core/GameSaveService';

/** 内存 StorageProvider：验证 core 持久化不依赖浏览器 localStorage */
class MemoryStorage implements StorageProvider {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

describe('StorageProvider 注入', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('GameSaveService 注入内存实现可 save/load/hasSave/clear', () => {
    const svc = new GameSaveService(storage);
    const snap: GameSnapshot = {
      currentRound: 3,
      state: 'player_action',
      lastAction: 'buy',
      qi: 60,
      score: 120,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      totalBuys: 1,
      totalSells: 0,
      totalWaits: 0,
      totalLeverageBuys: 0,
      season: { index: 0, roundInSeason: 3, lengths: [8, 12, 8, 12] },
      hand: [null, null, null],
      pool: { deckIds: [], publicIds: [] },
    };

    expect(svc.hasSave()).toBe(false);
    expect(svc.save(() => snap)).toBe(true);
    expect(svc.hasSave()).toBe(true);
    expect(svc.load(() => {})).toBe(true);
    svc.clear();
    expect(svc.hasSave()).toBe(false);
    // 写入落在注入的存储而非全局 localStorage
    expect(storage.snapshot()).toEqual({});
  });

  it('终局存档不会被当作可继续对局，并会被安全清除', () => {
    const svc = new GameSaveService(storage);
    const snap: GameSnapshot = {
      currentRound: 60,
      state: 'game_over',
      lastAction: 'wait',
      qi: 0,
      score: 120,
      totalHoldEarnings: 0,
      totalSellEarnings: 0,
      totalBuys: 0,
      totalSells: 0,
      totalWaits: 60,
      totalLeverageBuys: 0,
      season: { index: 3, roundInSeason: 12, lengths: [12, 12, 12, 12] },
      hand: [null, null, null],
      pool: { deckIds: [], publicIds: [] },
    };
    svc.save(() => snap);

    expect(svc.load(() => { throw new Error('终局存档不应导入'); })).toBe(false);
    expect(svc.getLastLoadError()).toBe('game_over');
    expect(svc.hasSave()).toBe(false);
  });

  it('LeaderboardService 注入内存实现可记录与读取', () => {
    const lb = new LeaderboardService(storage);
    lb.addEntry(100);
    lb.addEntry(80);
    lb.addEntry(120);
    const entries = lb.getEntries();
    expect(entries.map((e) => e.score)).toEqual([120, 100, 80]);
    lb.clear();
    expect(lb.getEntries()).toEqual([]);
  });

  it('LeaderboardService 按规则版本隔离成绩，并保留旧格式记录', () => {
    storage.setItem('jiazi_leaderboard', JSON.stringify([
      { score: 9999, date: '2026-08-09' },
      { score: 3000, date: '2026-08-10', rulesVersion: 3 },
    ]));
    const v3 = new LeaderboardService(storage, 3);
    const v4 = new LeaderboardService(storage, 4);

    expect(v3.getEntries().map((entry) => entry.score)).toEqual([3000]);
    expect(v4.getEntries()).toEqual([]);

    v4.addEntry(1200);
    expect(v4.getEntries().map((entry) => entry.score)).toEqual([1200]);
    expect(v3.getEntries().map((entry) => entry.score)).toEqual([3000]);
    expect(JSON.parse(storage.snapshot().jiazi_leaderboard)).toContainEqual({
      score: 9999,
      date: '2026-08-09',
    });
  });

  it('TurnManager 注入存储后存档写入注入的存储（而非全局 localStorage）', async () => {
    const tm = new TurnManager(undefined, undefined, { storage });
    await tm.initialize();
    tm.startGame();
    tm.executeWait();
    tm.saveGame();
    expect(Object.keys(storage.snapshot()).length).toBeGreaterThan(0);
  });
});
