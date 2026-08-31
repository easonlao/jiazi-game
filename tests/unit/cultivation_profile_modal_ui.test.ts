import { describe, it, expect, beforeEach } from 'vitest';
import { buildCultivationProfileSnapshot } from '../../app/src/lib/cultivationProfile';
import { type CultivationLedgerEntry } from '../../app/src/lib/analyticsBackend';

describe('Issue 05: 面向玩家的修行档案展示口径与防泄漏', () => {
  it('档案读模型收敛为修行历程与当前修为，不展示内部试验名称或旧跨档案历史分数', () => {
    const cloudRecords: CultivationLedgerEntry[] = [
      {
        player_id: 'p-1',
        local_game_id: 'g-v8-1',
        game_session_id: 's-v8-1',
        rules_version: 8,
        balance_profile_id: 'v8_standard',
        started_at: '2026-08-20T10:00:00.000Z',
        ended_at: '2026-08-20T10:30:00.000Z',
        outcome: 'completed',
        final_score: 999.0, // 历史旧参数成绩
        record_source: 'verified_session',
        created_at: '2026-08-20T10:30:00.000Z',
        updated_at: '2026-08-20T10:30:00.000Z',
      },
      {
        player_id: 'p-1',
        local_game_id: 'g-v9-1',
        game_session_id: 's-v9-1',
        rules_version: 9,
        balance_profile_id: 'v9_standard',
        started_at: '2026-08-30T10:00:00.000Z',
        ended_at: '2026-08-30T10:30:00.000Z',
        outcome: 'completed',
        final_score: 210.0,
        record_source: 'verified_session',
        created_at: '2026-08-30T10:30:00.000Z',
        updated_at: '2026-08-30T10:30:00.000Z',
      },
      {
        player_id: 'p-1',
        local_game_id: 'g-v9-2',
        game_session_id: 's-v9-2',
        rules_version: 9,
        balance_profile_id: 'v9_standard',
        started_at: '2026-08-31T10:00:00.000Z',
        ended_at: '2026-08-31T10:30:00.000Z',
        outcome: 'completed',
        final_score: 250.0,
        record_source: 'verified_session',
        created_at: '2026-08-31T10:30:00.000Z',
        updated_at: '2026-08-31T10:30:00.000Z',
      },
    ];

    const snapshot = buildCultivationProfileSnapshot(
      [],
      cloudRecords,
      9,
      true,
      'v9_standard',
    );

    // 1. 修行历程：全周期成长累积
    expect(snapshot.combinedSummary.totalGames).toBe(3);
    expect(snapshot.combinedSummary.completedGames).toBe(3);
    expect(snapshot.perseverance.completedGames).toBe(3);
    expect(snapshot.perseverance.perseveranceRate).toBe(100);

    // 2. 当前修为表现：仅包含 v9_standard
    const currentStats = snapshot.combinedSummary.currentProfileSummary;
    expect(currentStats).toBeDefined();
    expect(currentStats?.completedGames).toBe(2);
    expect(currentStats?.highestScore).toBe(250.0);
    expect(currentStats?.averageScore).toBe(230.0); // (210 + 250) / 2
    expect(currentStats?.lowestScore).toBe(210.0);

    // 3. 里程碑：个人最高纪录属于当前平衡档案（250.0，而非旧规则的 999.0）
    const recordMilestone = snapshot.milestones.find((m) => m.key === 'current_rule_record');
    expect(recordMilestone?.progress).toBe('最好 250.0 修为');
  });

  it('无记录初始状态与切换平衡档案后的表现隔离', () => {
    // 空记录状态
    const emptySnapshot = buildCultivationProfileSnapshot([], null, 9, false, 'v9_standard');
    expect(emptySnapshot.combinedSummary.totalGames).toBe(0);
    expect(emptySnapshot.combinedSummary.currentProfileSummary).toBeNull();
    expect(emptySnapshot.perseverance.evalStatus).toBe('accumulating');

    // 切换到全新平衡档案（如试验档案）
    const recordsWithStandardOnly: CultivationLedgerEntry[] = [
      {
        player_id: 'p-1',
        local_game_id: 'g-v9-std',
        game_session_id: 's-v9-std',
        rules_version: 9,
        balance_profile_id: 'v9_standard',
        started_at: '2026-08-30T10:00:00.000Z',
        ended_at: '2026-08-30T10:30:00.000Z',
        outcome: 'completed',
        final_score: 220.0,
        record_source: 'verified_session',
        created_at: '2026-08-30T10:30:00.000Z',
        updated_at: '2026-08-30T10:30:00.000Z',
      },
    ];

    // 当前处于 v9_ea_test 试验档案中
    const eaSnapshot = buildCultivationProfileSnapshot(
      [],
      recordsWithStandardOnly,
      9,
      true,
      'v9_ea_test',
    );

    // 修行历程依然保留了总局数 1
    expect(eaSnapshot.combinedSummary.totalGames).toBe(1);
    // 但在 v9_ea_test 下暂无完成局，不会显示标准档案的 220.0 分
    expect(eaSnapshot.combinedSummary.currentProfileSummary).toBeNull();
  });
});
