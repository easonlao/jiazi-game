import { beforeEach, describe, expect, it } from 'vitest';
import {
  CultivationLedgerService,
} from '../../app/src/lib/cultivationLedger';
import type { StorageProvider } from '../../src/core/index';

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

describe('CultivationLedgerService', () => {
  let storage: MemoryStorage;
  let ledger: CultivationLedgerService;

  beforeEach(() => {
    storage = new MemoryStorage();
    ledger = new CultivationLedgerService(storage);
  });

  it('从账本启用后开始记，不回填旧存档，并且续局不会重复建档', () => {
    storage.setItem('jiazi_game_save', JSON.stringify({ currentRound: 12, state: 'player_action' }));

    expect(ledger.getSummary()).toEqual({
      totalGames: 0,
      completedGames: 0,
      abandonedGames: 0,
      byRulesVersion: [],
    });

    const first = ledger.startNewGame(7);
    const resumed = ledger.resumeActiveGame(7);
    expect(resumed.id).toBe(first.id);

    const raw = JSON.parse(storage.snapshot().jiazi_cultivation_ledger) as {
      activeGameId: string | null;
      records: Array<{ id: string; outcome: string }>;
    };
    expect(raw.activeGameId).toBe(first.id);
    expect(raw.records).toHaveLength(1);
    expect(raw.records[0]?.outcome).toBe('active');
  });

  it('完成、中断与重复调用都保持幂等，并按规则集分组统计完成局', () => {
    const first = ledger.startNewGame(7);
    expect(ledger.resumeActiveGame(7).id).toBe(first.id);

    ledger.completeActiveGame(100.04);
    expect(ledger.completeActiveGame(120.5)).toBeNull();
    expect(ledger.abandonActiveGame()).toBeNull();

    const second = ledger.startNewGame(6);
    expect(second.id).not.toBe(first.id);
    ledger.completeActiveGame(200.06);

    ledger.startNewGame(7);
    ledger.abandonActiveGame();

    const summary = ledger.getSummary();
    expect(summary).toEqual({
      totalGames: 3,
      completedGames: 2,
      abandonedGames: 1,
      byRulesVersion: [
        {
          rulesVersion: 7,
          completedGames: 1,
          averageScore: 100.0,
          highestScore: 100.0,
          lowestScore: 100.0,
        },
        {
          rulesVersion: 6,
          completedGames: 1,
          averageScore: 200.1,
          highestScore: 200.1,
          lowestScore: 200.1,
        },
      ],
    });
  });

  it('完成后不会被后续重试改写成中断', () => {
    ledger.startNewGame(7);
    ledger.completeActiveGame(88.88);
    expect(ledger.abandonActiveGame()).toBeNull();
    expect(ledger.completeActiveGame(99)).toBeNull();

    expect(ledger.getSummary()).toEqual({
      totalGames: 1,
      completedGames: 1,
      abandonedGames: 0,
      byRulesVersion: [
        {
          rulesVersion: 7,
          completedGames: 1,
          averageScore: 88.9,
          highestScore: 88.9,
          lowestScore: 88.9,
        },
      ],
    });
  });

  it('存在旧版排行榜记录时，自动迁移为本机修行账本并正确统计', () => {
    storage.setItem('jiazi_leaderboard', JSON.stringify([
      { score: 2460.0, date: '2026-08-23', rulesVersion: 7 },
      { score: 1800.5, date: '2026-08-20', rulesVersion: 6 },
    ]));

    const freshLedger = new CultivationLedgerService(storage);
    const summary = freshLedger.getSummary();
    expect(summary.totalGames).toBe(2);
    expect(summary.completedGames).toBe(2);
    expect(summary.byRulesVersion).toEqual([
      {
        rulesVersion: 7,
        completedGames: 1,
        averageScore: 2460.0,
        highestScore: 2460.0,
        lowestScore: 2460.0,
      },
      {
        rulesVersion: 6,
        completedGames: 1,
        averageScore: 1800.5,
        highestScore: 1800.5,
        lowestScore: 1800.5,
      },
    ]);

    const records = freshLedger.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.finalScore).toBe(2460.0);
    expect(records[0]?.rulesVersion).toBe(7);
    expect(records[0]?.outcome).toBe('completed');
  });

  it('旧版排行榜在账本为空时补充迁移，且多次构造保持幂等', () => {
    storage.setItem('jiazi_cultivation_ledger', JSON.stringify({
      version: 1,
      activeGameId: null,
      records: [],
    }));
    storage.setItem('jiazi_leaderboard', JSON.stringify([
      { score: 2460.0, date: '2026-08-23', rulesVersion: 7 },
    ]));

    const ledger1 = new CultivationLedgerService(storage);
    expect(ledger1.getSummary().totalGames).toBe(1);

    const ledger2 = new CultivationLedgerService(storage);
    expect(ledger2.getSummary().totalGames).toBe(1);
    expect(ledger2.getRecords()).toHaveLength(1);
  });
});
