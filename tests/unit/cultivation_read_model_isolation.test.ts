import { describe, it, expect } from 'vitest';
import {
  summarizeCultivationLedger,
  type CultivationLedgerRecord,
  type CultivationLedgerSummarySource,
} from '../../app/src/lib/cultivationLedger';
import {
  buildCultivationProfileSnapshot,
  calculatePerseveranceSummary,
  type CultivationProfileRecord,
} from '../../app/src/lib/cultivationProfile';

describe('Issue 04: 修行档案独立数据口径与行为事实隔离', () => {
  it('跨平衡档案只累计完成、坚持和连胜等行为事实，不依赖分数尺度', () => {
    const records: CultivationProfileRecord[] = [
      {
        id: 'rec-v4-1',
        rulesVersion: 4,
        balanceProfileId: 'v4_standard',
        startedAt: '2026-08-01T10:00:00.000Z',
        endedAt: '2026-08-01T10:30:00.000Z',
        outcome: 'completed',
        finalScore: 100, // V4 尺度
        source: 'verified_session',
        sourceLabel: '云端校验',
      },
      {
        id: 'rec-v5-1',
        rulesVersion: 5,
        balanceProfileId: 'v5_standard',
        startedAt: '2026-08-10T10:00:00.000Z',
        endedAt: '2026-08-10T10:30:00.000Z',
        outcome: 'completed',
        finalScore: 300, // V5 尺度
        source: 'verified_session',
        sourceLabel: '云端校验',
      },
      {
        id: 'rec-v9-ea-1',
        rulesVersion: 9,
        balanceProfileId: 'v9_ea_tuned',
        startedAt: '2026-08-20T10:00:00.000Z',
        endedAt: '2026-08-20T10:30:00.000Z',
        outcome: 'abandoned',
        finalScore: null,
        source: 'verified_session',
        sourceLabel: '云端校验',
      },
      {
        id: 'rec-v9-ea-2',
        rulesVersion: 9,
        balanceProfileId: 'v9_ea_tuned',
        startedAt: '2026-08-21T10:00:00.000Z',
        endedAt: '2026-08-21T10:30:00.000Z',
        outcome: 'completed',
        finalScore: 800, // 试验参数高分
        source: 'verified_session',
        sourceLabel: '云端校验',
      },
    ];

    const perseverance = calculatePerseveranceSummary(records);
    expect(perseverance.completedGames).toBe(3);
    expect(perseverance.abandonedGames).toBe(1);
    expect(perseverance.terminalGames).toBe(4);
    expect(perseverance.perseveranceRate).toBe(75); // 3/4 = 75%
    expect(perseverance.currentStreak).toBe(1);
    expect(perseverance.bestStreak).toBe(2);
  });

  it('当前平衡档案的均分、最高分与走势不会混入其他或旧平衡档案数据', () => {
    const summarySources: CultivationLedgerSummarySource[] = [
      {
        rulesVersion: 4,
        balanceProfileId: 'v4_standard',
        outcome: 'completed',
        finalScore: 50,
      },
      {
        rulesVersion: 9,
        balanceProfileId: 'v9_standard',
        outcome: 'completed',
        finalScore: 200,
      },
      {
        rulesVersion: 9,
        balanceProfileId: 'v9_standard',
        outcome: 'completed',
        finalScore: 300,
      },
      {
        rulesVersion: 9,
        balanceProfileId: 'v9_ea_tuned',
        outcome: 'completed',
        finalScore: 9999, // 极端试验高分，绝不能混入 v9_standard
      },
    ];

    // 查询当前 v9_standard 档案的汇总
    const summary = summarizeCultivationLedger(summarySources, 'v9_standard');

    // 总体完成局数包含所有
    expect(summary.totalGames).toBe(4);
    expect(summary.completedGames).toBe(4);

    // 按平衡档案隔离明细
    const v9Standard = summary.byBalanceProfile.find((p) => p.profileId === 'v9_standard');
    expect(v9Standard).toBeDefined();
    expect(v9Standard?.completedGames).toBe(2);
    expect(v9Standard?.averageScore).toBe(250); // (200 + 300) / 2
    expect(v9Standard?.highestScore).toBe(300);
    expect(v9Standard?.lowestScore).toBe(200);

    const v9Ea = summary.byBalanceProfile.find((p) => p.profileId === 'v9_ea_tuned');
    expect(v9Ea).toBeDefined();
    expect(v9Ea?.completedGames).toBe(1);
    expect(v9Ea?.averageScore).toBe(9999);

    // currentProfileSummary 指向 v9_standard
    expect(summary.currentProfileSummary?.profileId).toBe('v9_standard');
    expect(summary.currentProfileSummary?.averageScore).toBe(250);
  });

  it('个人最高纪录里程碑基于当前生效平衡档案，旧试验数据不污染当前档案记录', () => {
    const cloudEntries = [
      {
        player_id: 'p-1',
        local_game_id: 'g-v8',
        game_session_id: 's-v8',
        rules_version: 8,
        balance_profile_id: 'v8_standard',
        started_at: '2026-08-25T10:00:00.000Z',
        ended_at: '2026-08-25T10:30:00.000Z',
        outcome: 'completed' as const,
        final_score: 999,
        record_source: 'verified_session' as const,
        created_at: '2026-08-25T10:30:00.000Z',
        updated_at: '2026-08-25T10:30:00.000Z',
      },
      {
        player_id: 'p-1',
        local_game_id: 'g-v9-1',
        game_session_id: 's-v9-1',
        rules_version: 9,
        balance_profile_id: 'v9_standard',
        started_at: '2026-08-30T10:00:00.000Z',
        ended_at: '2026-08-30T10:30:00.000Z',
        outcome: 'completed' as const,
        final_score: 240,
        record_source: 'verified_session' as const,
        created_at: '2026-08-30T10:30:00.000Z',
        updated_at: '2026-08-30T10:30:00.000Z',
      },
    ];

    const snapshot = buildCultivationProfileSnapshot(
      [],
      cloudEntries,
      9,
      true,
      'v9_standard',
    );

    const recordMilestone = snapshot.milestones.find((m) => m.key === 'current_rule_record');
    expect(recordMilestone).toBeDefined();
    expect(recordMilestone?.title).toBe('当前境界个人最佳');
    expect(recordMilestone?.progress).toBe('最好 240.0 修为'); // 240 而不是旧档案的 999
  });
});
