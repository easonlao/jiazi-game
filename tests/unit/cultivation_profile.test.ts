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

    expect(snapshot.combinedSummary.totalGames).toBe(2);
    expect(snapshot.combinedSummary.completedGames).toBe(2);
    expect(snapshot.combinedSummary.abandonedGames).toBe(0);
    expect(snapshot.combinedSummary.byRulesVersion).toHaveLength(1);
    expect(snapshot.combinedSummary.byRulesVersion.find((group) => group.rulesVersion === 7)).toMatchObject({
      rulesVersion: 7,
      completedGames: 2,
      highestScore: 120.4,
      lowestScore: 101.2,
    });
    expect(snapshot.combinedSummary.byRulesVersion.find((group) => group.rulesVersion === 7)?.averageScore).toBeCloseTo(110.8, 6);

    expect(snapshot.sourceBreakdown).toEqual({
      localOnly: 0,
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
      sourceLabel: '本机认领',
    });
    expect(snapshot.milestones[1]).toMatchObject({
      title: '首次完成一甲子',
      achieved: true,
      sourceLabel: '本机认领',
    });
    expect(snapshot.milestones[2]).toMatchObject({
      title: '累计完成局数',
      achieved: true,
      progress: '已完成 2 局',
    });
    expect(snapshot.milestones[3]).toMatchObject({
      title: '当前境界个人最佳',
      achieved: true,
      sourceLabel: '云端校验',
      progress: '最好 120.4 修为',
    });
  });

  it('游客模式（未立档）下，本地试玩局不计入账号统计与里程碑，且无云端记录时展示初始状态', () => {
    const localRecords = [
      {
        id: 'guest-active',
        rulesVersion: 7,
        startedAt: '2026-08-01T09:00:00.000Z',
        endedAt: null,
        outcome: 'active' as const,
        finalScore: null,
      },
      {
        id: 'guest-completed',
        rulesVersion: 7,
        startedAt: '2026-08-01T09:00:00.000Z',
        endedAt: '2026-08-01T09:45:00.000Z',
        outcome: 'completed' as const,
        finalScore: 99.5,
      },
    ];

    const snapshot = buildCultivationProfileSnapshot(localRecords, null, 7, false);

    expect(snapshot.combinedSummary).toEqual({
      totalGames: 0,
      completedGames: 0,
      abandonedGames: 0,
      byRulesVersion: [],
    });
    expect(snapshot.records).toHaveLength(0);
    expect(snapshot.milestones.every((m) => !m.achieved)).toBe(true);
  });

  it('游客模式（未立档）下，若存在既有云端记录，既有云端记录保持可见，但新试玩局不混入', () => {
    const localRecords = [
      {
        id: 'guest-trial',
        rulesVersion: 7,
        startedAt: '2026-08-05T09:00:00.000Z',
        endedAt: '2026-08-05T09:45:00.000Z',
        outcome: 'completed' as const,
        finalScore: 150.0,
      },
    ];

    const cloudRecords = [
      {
        player_id: 'player-1',
        local_game_id: 'cloud-v7-legacy',
        game_session_id: 'session-legacy',
        rules_version: 7,
        started_at: '2026-08-04T09:00:00.000Z',
        ended_at: '2026-08-04T09:35:00.000Z',
        outcome: 'completed' as const,
        final_score: 110.0,
        record_source: 'verified_session' as const,
        created_at: '2026-08-04T09:35:00.000Z',
        updated_at: '2026-08-04T09:35:00.000Z',
      },
    ];

    const snapshot = buildCultivationProfileSnapshot(localRecords, cloudRecords, 7, false);

    expect(snapshot.combinedSummary.totalGames).toBe(1);
    expect(snapshot.combinedSummary.completedGames).toBe(1);
    expect(snapshot.combinedSummary.byRulesVersion[0]).toMatchObject({
      rulesVersion: 7,
      completedGames: 1,
      highestScore: 110.0,
    });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]?.id).toBe('cloud-v7-legacy');
  });

  it('已注册账号在云端账本未加载或为空时，不统计本机未上云记录', () => {
    const localRecords = [
      {
        id: 'local-unclaimed',
        rulesVersion: 7,
        startedAt: '2026-08-05T09:00:00.000Z',
        endedAt: '2026-08-05T09:45:00.000Z',
        outcome: 'completed' as const,
        finalScore: 130.0,
      },
    ];

    // 云端未加载（null）
    const snapshotNull = buildCultivationProfileSnapshot(localRecords, null, 7, true);
    expect(snapshotNull.combinedSummary.totalGames).toBe(0);
    expect(snapshotNull.records).toHaveLength(0);
    expect(snapshotNull.milestones.every((m) => !m.achieved)).toBe(true);

    // 云端为空（[]）
    const snapshotEmpty = buildCultivationProfileSnapshot(localRecords, [], 7, true);
    expect(snapshotEmpty.combinedSummary.totalGames).toBe(0);
    expect(snapshotEmpty.records).toHaveLength(0);
    expect(snapshotEmpty.milestones.every((m) => !m.achieved)).toBe(true);
  });
});
