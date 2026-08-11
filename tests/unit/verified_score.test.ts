/**
 * submit-verified-score 规范化口径回归测试。
 *
 * 背景（生产事故 31508641886 失败/run 31508641864）：
 * 负分终局下，game_sessions.final_score 已按 Math.max(0, score) 归零，
 * 但排行榜 insert / leaderboard_submitted 仍按原始负分判定，导致
 * 「会话归零 0 分、leaderboard_eligible=true 却无排行榜条目」。
 *
 * 修复后 Edge Function 的会话 final_score、排行榜 score、返回 score
 * 与 leaderboard_submitted 判定全部共用 normalizeVerifiedScore。
 */
import { describe, expect, it } from 'vitest';
import { normalizeVerifiedScore } from '../../src/core';

describe('normalizeVerifiedScore', () => {
  it('负分终局归零：合法已验证的负分对局以 0 分进入排行榜', () => {
    expect(normalizeVerifiedScore(-3.2)).toBe(0);
    expect(normalizeVerifiedScore(-0.5)).toBe(0);
  });

  it('按 0.1 舍入（与历史 game_sessions.final_score 口径一致）', () => {
    expect(normalizeVerifiedScore(12.34)).toBe(12.3);
    expect(normalizeVerifiedScore(12.35)).toBe(12.4);
  });

  it('先舍入后归零：负分不会变成非零值', () => {
    expect(normalizeVerifiedScore(-0.04)).toBe(0);
    expect(normalizeVerifiedScore(-1.44)).toBe(0);
  });

  it('正分与非负分保持不变', () => {
    expect(normalizeVerifiedScore(0)).toBe(0);
    expect(normalizeVerifiedScore(1200)).toBe(1200);
    expect(normalizeVerifiedScore(1)).toBe(1);
  });

  it('幂等：对已规范化值再次规范化结果不变（重试修复路径可安全复用）', () => {
    expect(normalizeVerifiedScore(normalizeVerifiedScore(-3.2))).toBe(0);
    expect(normalizeVerifiedScore(normalizeVerifiedScore(12.34))).toBe(12.3);
  });
});
