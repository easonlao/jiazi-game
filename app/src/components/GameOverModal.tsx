import { useGameStore } from '../store';
import { evaluateGame, evaluateCeiling } from '../lib/gameReview';

/**
 * 局终总结（游戏结束弹窗）
 *
 * 双层评价（2026-08-08 重写，评价与分数不再脱钩）：
 * - 境界：按最终修为分档（炼气→飞升七档，纯分数结果，运气+实力共同决定）
 * - 上限对齐：六维评价（炼化为本/燃灵进取/燃灵及时/反噬可承/弃浊存清/牵神预置），
 *   每维锚定真引擎 20000 局调参验证过的冲顶机制，度量"行为离上限打法有多近"，
 *   综合分与最终分数强相关（实测 Spearman ρ≥0.7，见 ceiling_validation 测试）
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
  const voidStats = useGameStore((s) => s.voidStats);
  const reset = useGameStore((s) => s.reset);
  const openLeaderboard = useGameStore((s) => s.openLeaderboard);
  const openDashboard = useGameStore((s) => s.openDashboard);
  const verificationState = useGameStore((s) => s.verificationState);
  const telemetryState = useGameStore((s) => s.telemetryState);
  const retryVerification = useGameStore((s) => s.retryVerification);
  const cloudIdentityReady = Boolean(
    telemetryState?.consent?.granted && telemetryState.identity?.leaderboard_eligible,
  );

  // 境界（纯分数结果）
  const review = evaluateGame({
    totalBuys, totalSells, totalWaits, totalLeverageBuys, totalLocks, marginCallCount, score,
    totalHoldEarnings, totalSellEarnings, totalSettleEarnings, totalMarginCallPenalty,
  });
  const { realm } = review;

  // 上限对齐（六维，锚定真引擎调参验证的冲顶机制，与分数强相关）
  const ceiling = evaluateCeiling({
    totalBuys, totalSells, totalWaits, totalLeverageBuys, totalLocks, marginCallCount, score,
    totalHoldEarnings, totalSellEarnings, totalSettleEarnings, totalMarginCallPenalty,
  }, decisionLog);

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

        {/* 本局空亡记录（V5 空亡规则；仅触发过才显示，V1-V4 恒不渲染） */}
        {voidStats.triggers > 0 && (
          <div className="bg-white rounded-xl p-3 mb-3 shadow-sm">
            <div className="text-left text-xs font-bold font-serif text-ink mb-2">本局空亡记录</div>
            <div className="flex justify-between text-[11px] text-ink-light tabular-nums">
              <span>空亡触发 <span className="font-bold text-ink">{voidStats.triggers}</span> 次</span>
              <span>整季吞掉 <span className="font-bold text-ink">{voidStats.swallowedEvents}</span> 次</span>
              <span>最长吞噬 <span className="font-bold text-ink">{voidStats.maxVoidK}</span> 步</span>
            </div>
          </div>
        )}

        {/* 上限对齐：六维（锚定真引擎调参验证的冲顶机制，与分数强相关） */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold font-serif text-ink">巅峰之鉴</span>
            <span className="text-[11px] text-ink-light tabular-nums">
              综合 {ceiling.total}/100
            </span>
          </div>
          <div className="space-y-1.5">
            {ceiling.dims.map((d) => (
              <div key={d.key} className="bg-white rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] text-ink-light w-14 shrink-0">{d.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#E9E1CE] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${d.score >= 0.6 ? 'bg-qi-full' : 'bg-qi-danger'}`}
                      style={{ width: `${Math.round(d.score * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-bold tabular-nums shrink-0 ${d.score >= 0.6 ? 'text-qi-full' : 'text-qi-critical'}`}>
                    {Math.round(d.score * 100)}
                  </span>
                </div>
                <p className="text-[10px] text-ink-light text-left">{d.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 行动统计小字 */}
        <p className="text-[10px] text-ink-light mb-4 tabular-nums">
          纳灵 {totalBuys} · 释灵 {totalSells} · 燃灵 {totalLeverageBuys} · 牵神 {totalLocks}
        </p>

        {/* 云端校验状态：本地修为与本地榜已即时落榜；云端重放校验后台执行。
            校验完成前绝不暗示已上榜。 */}
        {(verificationState || cloudIdentityReady) && (
          <div className="bg-white rounded-xl p-3 mb-3 shadow-sm text-left">
            <div className="text-xs font-bold font-serif text-ink mb-1.5">云端校验</div>
            {!verificationState && cloudIdentityReady && (
              <p className="text-xs text-qi-critical">
                本局未进入云端校验，暂未提交云端榜；请确认使用最新生产入口后再开始新局。
              </p>
            )}
            {verificationState?.status === 'pending' && (
              <p className="text-xs text-ink-light flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
                校验中…（服务端重放验证中，通过后将计入云端榜）
              </p>
            )}
            {verificationState?.status === 'verified' && (
              <p className="text-xs text-qi-full">
                {verificationState.leaderboardSubmitted
                  ? `已校验${verificationState.score !== null ? `，修为 ${verificationState.score.toFixed(1)}` : ''}，已计入云端榜`
                  : '已校验，暂未上榜（设置昵称后方可上榜）'}
              </p>
            )}
            {(verificationState?.status === 'rejected' || verificationState?.status === 'failed') && (
              <div>
                <p className="text-xs text-qi-critical">
                  {verificationState.status === 'rejected' ? '云端校验未通过' : '云端校验失败（网络/服务异常）'}
                  {verificationState.message ? `：${verificationState.message}` : ''}
                </p>
                <button
                  onClick={retryVerification}
                  className="mt-1.5 text-[11px] font-bold text-ink underline underline-offset-2"
                >
                  重试校验
                </button>
              </div>
            )}
          </div>
        )}

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
