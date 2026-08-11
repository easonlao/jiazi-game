/**
 * 已验证终局的统一规范化口径：先把原始分数按 0.1 舍入，再把负分归零。
 *
 * Edge Function submit-verified-score 的会话 final_score、排行榜 score、
 * 返回响应 score 与 leaderboard_submitted 判定必须共用本函数，否则会出现
 * 「会话按 0 分落库但排行榜不入榜」的负分终局不一致。
 */
export function normalizeVerifiedScore(score: number): number {
  return Math.max(0, Math.round(score * 10) / 10);
}
