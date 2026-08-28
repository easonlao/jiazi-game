import { describe, expect, it } from 'vitest';
import {
  buildCultivationProfileSnapshot,
  calculatePerseveranceSummary,
} from '../../app/src/lib/cultivationProfile';
import type { CultivationLedgerRecord } from '../../app/src/lib/cultivationLedger';
import type { CultivationLedgerEntry } from '../../app/src/lib/analyticsBackend';

describe('04 修行坚持度与里程碑测试', () => {
  it('坚持度只按「完整完成 ÷（完整完成 + 主动终止）」计算，进行中对局不进入分母', () => {
    const records = [
      { id: '1', rulesVersion: 7, startedAt: '2026-08-01', endedAt: '2026-08-01', outcome: 'completed' as const, finalScore: 100, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '2', rulesVersion: 7, startedAt: '2026-08-02', endedAt: '2026-08-02', outcome: 'completed' as const, finalScore: 110, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '3', rulesVersion: 7, startedAt: '2026-08-03', endedAt: '2026-08-03', outcome: 'abandoned' as const, finalScore: null, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '4', rulesVersion: 7, startedAt: '2026-08-04', endedAt: '2026-08-04', outcome: 'completed' as const, finalScore: 90, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '5', rulesVersion: 7, startedAt: '2026-08-05', endedAt: null, outcome: 'active' as const, finalScore: null, source: 'local' as const, sourceLabel: '本机进行中' },
    ];

    const summary = calculatePerseveranceSummary(records);
    expect(summary.completedGames).toBe(3);
    expect(summary.abandonedGames).toBe(1);
    expect(summary.activeGames).toBe(1);
    expect(summary.terminalGames).toBe(4);
    // 3 / (3 + 1) = 75.0%
    expect(summary.perseveranceRate).toBe(75.0);
    expect(summary.evalStatus).toBe('evaluated');
    expect(summary.ratingLabel).toBe('持之以恒');
  });

  it('样本不足（终态局数少于 3 局）时不作评价，保护新手体验', () => {
    const records = [
      { id: '1', rulesVersion: 7, startedAt: '2026-08-01', endedAt: '2026-08-01', outcome: 'completed' as const, finalScore: 100, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '2', rulesVersion: 7, startedAt: '2026-08-02', endedAt: '2026-08-02', outcome: 'abandoned' as const, finalScore: null, source: 'local' as const, sourceLabel: '本机记录' },
    ];

    const summary = calculatePerseveranceSummary(records);
    expect(summary.terminalGames).toBe(2);
    expect(summary.perseveranceRate).toBe(null);
    expect(summary.evalStatus).toBe('accumulating');
    expect(summary.ratingLabel).toBe('道心初启');
    expect(summary.description).toContain('正在积累道心样本（需满 3 局）');
  });

  it('正确统计历史最高连续完整修行与当前连续完整修行，主动终止会清空当前连胜', () => {
    const records = [
      { id: '1', rulesVersion: 7, startedAt: '2026-08-01', endedAt: '2026-08-01', outcome: 'completed' as const, finalScore: 100, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '2', rulesVersion: 7, startedAt: '2026-08-02', endedAt: '2026-08-02', outcome: 'completed' as const, finalScore: 105, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '3', rulesVersion: 7, startedAt: '2026-08-03', endedAt: '2026-08-03', outcome: 'completed' as const, finalScore: 110, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '4', rulesVersion: 7, startedAt: '2026-08-04', endedAt: '2026-08-04', outcome: 'abandoned' as const, finalScore: null, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '5', rulesVersion: 7, startedAt: '2026-08-05', endedAt: '2026-08-05', outcome: 'completed' as const, finalScore: 95, source: 'local' as const, sourceLabel: '本机记录' },
      { id: '6', rulesVersion: 7, startedAt: '2026-08-06', endedAt: '2026-08-06', outcome: 'completed' as const, finalScore: 98, source: 'local' as const, sourceLabel: '本机记录' },
    ];

    const summary = calculatePerseveranceSummary(records);
    expect(summary.bestStreak).toBe(3); // 局 1, 2, 3
    expect(summary.currentStreak).toBe(2); // 局 5, 6
    expect(summary.perseveranceRate).toBeCloseTo((5 / 6) * 100, 1);
  });

  it('buildCultivationProfileSnapshot 输出完整的坚持度与温和文案', () => {
    const cloudRecords: import('../../app/src/lib/analyticsBackend').CultivationLedgerEntry[] = [
      { player_id: 'p1', local_game_id: 'l1', game_session_id: 's1', rules_version: 7, started_at: '2026-08-01T00:00:00.000Z', ended_at: '2026-08-01T00:30:00.000Z', outcome: 'completed', final_score: 120, record_source: 'verified_session', created_at: '', updated_at: '' },
      { player_id: 'p1', local_game_id: 'l2', game_session_id: 's2', rules_version: 7, started_at: '2026-08-02T00:00:00.000Z', ended_at: '2026-08-02T00:30:00.000Z', outcome: 'completed', final_score: 130, record_source: 'verified_session', created_at: '', updated_at: '' },
      { player_id: 'p1', local_game_id: 'l3', game_session_id: 's3', rules_version: 7, started_at: '2026-08-03T00:00:00.000Z', ended_at: '2026-08-03T00:30:00.000Z', outcome: 'completed', final_score: 125, record_source: 'verified_session', created_at: '', updated_at: '' },
    ];

    const snapshot = buildCultivationProfileSnapshot([], cloudRecords, 7, true);
    expect(snapshot.perseverance.evalStatus).toBe('evaluated');
    expect(snapshot.perseverance.perseveranceRate).toBe(100.0);
    expect(snapshot.perseverance.ratingLabel).toBe('道心恒固');
    expect(snapshot.perseverance.currentStreak).toBe(3);
    expect(snapshot.perseverance.bestStreak).toBe(3);
  });
});
