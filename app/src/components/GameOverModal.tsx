import { useGameStore } from '../store';
import { evaluateGame, evaluateDecisions, decisionQualityScore } from '../lib/gameReview';

/**
 * 局终总结（游戏结束弹窗）
 *
 * 双层评价（2026-08-07 用户方向，分数与行为解耦）：
 * - 境界：按最终修为分档（炼气→飞升七档，纯分数结果，运气+实力共同决定）
 * - 决策质量：五维画像（择机/止损/预判/避险/进取），数据定义最优动作，
 *   统计玩家每类情境的做对率，反向给出后续行动建议
 *
 * 修为构成：炼化 + 卖出（正向来源），反噬是惩罚（不参与占比，单独标红）。
 */
export function GameOverModal() {
  const score = useGameStore((s) => s.score);
  const totalHoldEarnings = useGameStore((s) => s.totalHoldEarnings);
  const totalSellEarnings = useGameStore((s) => s.totalSellEarnings);
  const totalSettleEarnings = useGameStore((s) => s.totalSettleEarnings);
  const totalMarginCallPenalty = useGameStore((s) => s.totalMarginCallPenalty);
  const marginCallCount = useGameStore((s) => s.marginCallCount);
  const totalBuys = useGameStore((s) => s.totalBuys);
  const totalSells = useGameStore((s) => s.totalSells);
  const totalLocks = useGameStore((s) => s.totalLocks);
  const totalLeverageBuys = useGameStore((s) => s.totalLeverageBuys);
  const totalWaits = useGameStore((s) => s.totalWaits);
  const decisionLog = useGameStore((s) => s.decisionLog);
  const reset = useGameStore((s) => s.reset);
  const openLeaderboard = useGameStore((s) => s.openLeaderboard);
  const openDashboard = useGameStore((s) => s.openDashboard);

  // 境界（纯分数结果）
  const review = evaluateGame({
    totalBuys, totalSells, totalWaits, totalLeverageBuys, totalLocks, marginCallCount, score,
  });
  const { realm } = review;

  // 决策质量（数据定义最优，五维做对率）
  const quality = evaluateDecisions(decisionLog);
  const qualityScore = decisionQualityScore(quality);

  // 修为构成：炼化 + 释灵 + 出清 是正向来源，反噬是惩罚（不参与占比，单独标红）
  const positive = Math.abs(totalHoldEarnings) + Math.abs(totalSellEarnings) + Math.abs(totalSettleEarnings);
  const holdPct = positive > 0 ? Math.round((Math.abs(totalHoldEarnings) / positive) * 100) : 0;
  const sellPct = positive > 0 ? Math.round((Math.abs(totalSellEarnings) / positive) * 100) : 0;
  const settlePct = positive > 0 ? Math.round((Math.abs(totalSettleEarnings) / positive) * 100) : 0;

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6 text-center max-h-[92%] overflow-y-auto">
        {/* 境界（分数结果分档） */}
        <p className="text-3xl font-black font-serif text-gold mb-1">{realm.name}境</p>
        <p className="text-xs text-ink-light mb-2">{realm.desc}</p>

        {/* 最终修为 */}
        <p className="text-4xl font-black text-gold mb-1 tabular-nums">
          {score.toFixed(1)}
        </p>
        <p className="text-xs text-ink-light mb-4">最终修为</p>

        {/* 修为构成：比例条 + 图例 */}
        <div className="bg-white rounded-xl p-3 mb-3 shadow-sm">
          <div className="text-left text-xs font-bold font-serif text-ink mb-2">修为构成</div>
          <div className="flex h-2 rounded-full overflow-hidden mb-2">
            {positive > 0 && (
              <>
                <div className="bg-qi-full" style={{ width: `${holdPct}%` }} />
                <div className="bg-gold" style={{ width: `${sellPct}%` }} />
                {totalSettleEarnings !== 0 && <div className="bg-amber-500" style={{ width: `${settlePct}%` }} />}
              </>
            )}
            {positive === 0 && <div className="bg-wood-light/50 w-full" />}
          </div>
          <div className="flex justify-between text-[10px] text-ink-light tabular-nums">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-qi-full inline-block" />
              炼化 {totalHoldEarnings >= 0 ? '+' : ''}{totalHoldEarnings.toFixed(1)}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-gold inline-block" />
              释灵 {totalSellEarnings >= 0 ? '+' : ''}{totalSellEarnings.toFixed(1)}
            </span>
            {totalSettleEarnings !== 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />
                出清 {totalSettleEarnings >= 0 ? '+' : ''}{totalSettleEarnings.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-qi-critical inline-block" />
              反噬 ×{marginCallCount}
              {totalMarginCallPenalty > 0 && (
                <span className="text-qi-critical font-bold">（扣 {totalMarginCallPenalty.toFixed(1)}）</span>
              )}
            </span>
          </div>
        </div>

        {/* 决策质量：五维做对率（数据定义最优，反向给建议） */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold font-serif text-ink">决策质量</span>
            <span className="text-[11px] text-ink-light tabular-nums">
              综合 {qualityScore}/100
            </span>
          </div>
          {quality.length === 0 ? (
            <div className="text-[11px] text-ink-light py-2 text-center bg-white rounded-lg">本局未触发关键决策情境</div>
          ) : (
            <div className="space-y-1.5">
              {quality.map((q) => (
                <div key={q.scenario} className="bg-white rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-[11px] text-ink-light w-8 shrink-0">{q.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#E9E1CE] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${q.rate >= 0.6 ? 'bg-qi-full' : 'bg-qi-danger'}`}
                      style={{ width: `${Math.round(q.rate * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-bold tabular-nums shrink-0 ${q.rate >= 0.6 ? 'text-qi-full' : 'text-qi-critical'}`}>
                    {Math.round(q.rate * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 行动统计小字 */}
        <p className="text-[10px] text-ink-light mb-4 tabular-nums">
          纳灵 {totalBuys} · 释灵 {totalSells} · 燃灵 {totalLeverageBuys} · 牵神 {totalLocks}
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={openDashboard}
            className="w-full py-2.5 rounded-xl border border-wood-mid text-ink text-sm font-bold font-serif hover:bg-wood-light/20 transition-colors"
          >
            查看行迹
          </button>
          <button
            onClick={openLeaderboard}
            className="w-full py-2.5 rounded-xl border-2 border-wood-mid text-ink text-sm font-bold font-serif hover:bg-wood-light transition-colors"
          >
            排行榜
          </button>
          <button
            onClick={reset}
            className="w-full py-2.5 rounded-xl bg-ink text-parchment text-sm font-bold font-serif hover:bg-wood-dark transition-colors"
          >
            再入轮回
          </button>
        </div>
      </div>
    </div>
  );
}
