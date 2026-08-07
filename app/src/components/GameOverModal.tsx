import { useGameStore } from '../store';

/**
 * 局终总结（游戏结束弹窗）
 *
 * 展示最终修为 + 修为构成（炼化/卖出/反噬比例）+ 三维度判定（风格/风控/择时）。
 * 数据源全部来自真实字段：score / totalHoldEarnings / totalSellEarnings /
 * marginCallCount / totalBuys / totalSells——不引入任何虚构统计。
 *
 * 维度判定规则（纯派生，可复算）：
 * - 风格：炼化收益 > 卖出收益 → 持有流；反之 → 差价流
 * - 风控：反噬 0 次 → 稳健；1 次 → 审慎；≥2 次 → 激进
 * - 择时：本局亏损（score < 0）→ 逆天；盈利 → 顺天
 */
export function GameOverModal() {
  const score = useGameStore((s) => s.score);
  const totalHoldEarnings = useGameStore((s) => s.totalHoldEarnings);
  const totalSellEarnings = useGameStore((s) => s.totalSellEarnings);
  const marginCallCount = useGameStore((s) => s.marginCallCount);
  const totalBuys = useGameStore((s) => s.totalBuys);
  const totalSells = useGameStore((s) => s.totalSells);
  const reset = useGameStore((s) => s.reset);
  const openLeaderboard = useGameStore((s) => s.openLeaderboard);
  const openDashboard = useGameStore((s) => s.openDashboard);

  // 修为构成：炼化 + 卖出 是正向来源，反噬是惩罚（不参与占比，单独标红）
  const positive = Math.abs(totalHoldEarnings) + Math.abs(totalSellEarnings);
  const holdPct = positive > 0 ? Math.round((Math.abs(totalHoldEarnings) / positive) * 100) : 0;
  const sellPct = positive > 0 ? Math.round((Math.abs(totalSellEarnings) / positive) * 100) : 0;

  // 三维度判定
  const style = totalHoldEarnings > totalSellEarnings ? '持有流' : '差价流';
  const risk = marginCallCount === 0 ? '稳健' : marginCallCount === 1 ? '审慎' : '激进';
  const timing = score >= 0 ? '顺天' : '逆天';
  const riskColor = marginCallCount === 0 ? 'text-qi-full' : marginCallCount === 1 ? 'text-qi-danger' : 'text-qi-critical';

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6 text-center max-h-[92%] overflow-y-auto">
        <h2 className="text-lg font-bold font-serif text-ink mb-1">一甲子终了</h2>
        <p className="text-xs text-ink-light mb-3">汝之修为几何</p>

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
              卖出 {totalSellEarnings >= 0 ? '+' : ''}{totalSellEarnings.toFixed(1)}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-qi-critical inline-block" />
              反噬 ×{marginCallCount}
            </span>
          </div>
        </div>

        {/* 三维度判定 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-[#FAF6EE] rounded-lg py-2">
            <div className="text-[10px] text-ink-light">风格</div>
            <div className="text-sm font-bold font-serif text-ink">{style}</div>
          </div>
          <div className="bg-[#FAF6EE] rounded-lg py-2">
            <div className="text-[10px] text-ink-light">风控</div>
            <div className={`text-sm font-bold font-serif ${riskColor}`}>{risk}</div>
          </div>
          <div className="bg-[#FAF6EE] rounded-lg py-2">
            <div className="text-[10px] text-ink-light">择时</div>
            <div className="text-sm font-bold font-serif text-ink">{timing}</div>
          </div>
        </div>

        {/* 行动统计小字 */}
        <p className="text-[10px] text-ink-light mb-4 tabular-nums">
          纳灵 {totalBuys} 次 · 释灵 {totalSells} 次
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
