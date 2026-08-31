import { describe, it, expect, beforeEach } from 'vitest';
import { LeaderboardService, type LeaderboardEntry } from '../../src/core/LeaderboardService';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

describe('Issue 03: 本地排行榜按平衡档案隔离 (LeaderboardService)', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('按 balanceProfileId 严格隔离榜单读取与写入', () => {
    const serviceStandard = new LeaderboardService(storage, 9, 'v9_standard');
    const serviceEaTuned = new LeaderboardService(storage, 9, 'v9_ea_tuned');
    const serviceLegacy = new LeaderboardService(storage, 8);

    serviceStandard.addEntry(100);
    serviceStandard.addEntry(200);

    serviceEaTuned.addEntry(500);

    serviceLegacy.addEntry(300);

    // 标准档案榜单
    const standardEntries = serviceStandard.getEntries();
    expect(standardEntries).toHaveLength(2);
    expect(standardEntries.map((e) => e.score)).toEqual([200, 100]);
    expect(standardEntries.every((e) => e.balanceProfileId === 'v9_standard')).toBe(true);

    // EA 调优档案榜单
    const eaEntries = serviceEaTuned.getEntries();
    expect(eaEntries).toHaveLength(1);
    expect(eaEntries[0].score).toBe(500);
    expect(eaEntries[0].balanceProfileId).toBe('v9_ea_tuned');

    // 旧版无 profile 榜单
    const legacyEntries = serviceLegacy.getEntries();
    expect(legacyEntries).toHaveLength(1);
    expect(legacyEntries[0].score).toBe(300);
  });

  it('保留各平衡档案前 10 条最高分记录，互不挤占名额', () => {
    const profileA = new LeaderboardService(storage, 9, 'profile_a');
    const profileB = new LeaderboardService(storage, 9, 'profile_b');

    // 写入 15 条 A
    for (let i = 1; i <= 15; i++) {
      profileA.addEntry(i * 10);
    }
    // 写入 5 条 B
    for (let i = 1; i <= 5; i++) {
      profileB.addEntry(i * 100);
    }

    expect(profileA.getEntries()).toHaveLength(10);
    expect(profileA.getEntries()[0].score).toBe(150);
    expect(profileA.getEntries()[9].score).toBe(60);

    expect(profileB.getEntries()).toHaveLength(5);
    expect(profileB.getEntries()[0].score).toBe(500);
  });
});

describe('Issue 03: 云端排行榜按平衡档案查询隔离 (fetchLeaderboard)', () => {
  it('向 Supabase 查询时带入 rules_version 与 balance_profile_id 过滤条件', async () => {
    const mockData = [
      {
        public_player_id: 'pid-1',
        score: 350.5,
        created_at: '2026-08-31T08:00:00.000Z',
        rules_version: '9',
        balance_profile_id: 'v9_standard',
      },
    ];

    const mockProfiles = [
      {
        public_player_id: 'pid-1',
        public_code: 'CODE01',
        display_name: '道友甲',
        leaderboard_eligible: true,
      },
    ];

    const eqFilters: Array<[string, string]> = [];
    const client = {
      from: (table: string) => {
        if (table === 'leaderboard_entries') {
          const queryBuilder: any = {
            select: () => queryBuilder,
            eq: (col: string, val: string) => {
              eqFilters.push([col, val]);
              return queryBuilder;
            },
            order: () => queryBuilder,
            limit: () => Promise.resolve({ data: mockData, error: null }),
          };
          return queryBuilder;
        }
        if (table === 'player_profiles') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: mockProfiles, error: null }),
            }),
          };
        }
        return {};
      },
    };

    const backend = new SupabaseAnalyticsBackend(client as any);
    const results = await backend.fetchLeaderboard(50, '9', 'v9_standard');

    expect(eqFilters).toContainEqual(['rules_version', '9']);
    expect(eqFilters).toContainEqual(['balance_profile_id', 'v9_standard']);
    expect(results).toHaveLength(1);
    expect(results[0].display_name).toBe('道友甲');
    expect(results[0].score).toBe(350.5);
    expect(results[0].rules_version).toBe('9');
    expect(results[0].balance_profile_id).toBe('v9_standard');
  });
});
