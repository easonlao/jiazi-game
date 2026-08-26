import { describe, expect, it } from 'vitest';
import { buildCultivationProfileSnapshot } from '../../app/src/lib/cultivationProfile';

describe('cultivation profile snapshot', () => {
  it('keeps current-rule statistics isolated from historical rules', () => {
    const localRecords = [
      {
        id: 'local-active',
        rulesVersion: 7,
        startedAt: '2026-08-01T09:00:00.000Z',
        endedAt: null,
        outcome: 'active' as const,
        finalScore: null,
      },
      {
        id: 'local-v6',
        rulesVersion: 6,
        startedAt: '2026-08-02T09:00:00.000Z',
        endedAt: '2026-08-02T09:50:00.000Z',
        outcome: 'completed' as const,
        finalScore: 88.8,
      },
    ];

    const cloudRecords = [
      {
        player_id: 'player-1',
        local_game_id: 'cloud-v7-a',
        game_session_id: null,
        rules_version: 7,
        started_at: '2026-08-03T09:00:00.000Z',
        ended_at: '2026-08-03T09:40:00.000Z',
        outcome: 'completed' as const,
        final_score: 101.2,
        record_source: 'local_claim' as const,
        created_at: '2026-08-03T09:40:00.000Z',
        updated_at: '2026-08-03T09:40:00.000Z',
      },
      {
        player_id: 'player-1',
        local_game_id: 'cloud-v7-b',
        game_session_id: 'session-2',
        rules_version: 7,
        started_at: '2026-08-04T09:00:00.000Z',
        ended_at: '2026-08-04T09:35:00.000Z',
        outcome: 'completed' as const,
        final_score: 120.4,
        record_source: 'verified_session' as const,
        created_at: '2026-08-04T09:35:00.000Z',
        updated_at: '2026-08-04T09:35:00.000Z',
      },
    ];

    const snapshot = buildCultivationProfileSnapshot(localRecords, cloudRecords, 7);

    expect(snapshot.localSummary).toEqual({
      totalGames: 2,
      completedGames: 1,
      abandonedGames: 0,
      byRulesVersion: [
        {
          rulesVersion: 6,
          completedGames: 1,
          averageScore: 88.8,
          highestScore: 88.8,
          lowestScore: 88.8,
        },
      ],
    });

    expect(snapshot.combinedSummary.totalGames).toBe(4);
    expect(snapshot.combinedSummary.completedGames).toBe(3);
    expect(snapshot.combinedSummary.abandonedGames).toBe(0);
    expect(snapshot.combinedSummary.byRulesVersion).toHaveLength(2);
    expect(snapshot.combinedSummary.byRulesVersion.find((group) => group.rulesVersion === 7)).toMatchObject({
      rulesVersion: 7,
      completedGames: 2,
      highestScore: 120.4,
      lowestScore: 101.2,
    });
    expect(snapshot.combinedSummary.byRulesVersion.find((group) => group.rulesVersion === 7)?.averageScore).toBeCloseTo(110.8, 6);
    expect(snapshot.combinedSummary.byRulesVersion.find((group) => group.rulesVersion === 6)).toMatchObject({
      completedGames: 1,
      averageScore: 88.8,
    });

    expect(snapshot.sourceBreakdown).toEqual({
      localOnly: 2,
      localClaim: 1,
      verifiedSession: 1,
    });

    expect(snapshot.milestones.map((item) => item.key)).toEqual([
      'first_start',
      'first_completion',
      'completion_count',
      'current_rule_record',
    ]);
    expect(snapshot.milestones[0]).toMatchObject({
      title: '首次开局',
      achieved: true,
      sourceLabel: '本机进行中',
    });
    expect(snapshot.milestones[1]).toMatchObject({
      title: '首次完成一甲子',
      achieved: true,
      sourceLabel: '本机记录',
    });
    expect(snapshot.milestones[2]).toMatchObject({
      title: '累计完成局数',
      achieved: true,
      progress: '已完成 3 局',
    });
    expect(snapshot.milestones[3]).toMatchObject({
      title: '当前规则个人纪录',
      achieved: true,
      sourceLabel: '云端校验',
      progress: '最好 120.4 修为',
    });
  });
});
