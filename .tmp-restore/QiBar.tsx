import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';

/** 神识消耗统一色（2026-08-06 issue 01 P3：神识消耗=资源冷色，修为才用红绿） */
const QI_COST_COLOR = 'text-sky-600';

interface Floater {
  id: number;
  delta: number;
}

export function QiBar() {
  const qi = useGameStore((s) => s.qi);
  const maxQi = useGameStore((s) => s.maxQi);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const baseRecovery = useGameStore((s) => s.baseRecovery);
  const turnManager = useGameStore((s) => s.turnManager);
  const previewWaitQi = useGameStore((s) => s.previewWaitQi);
  const qiDelta = useGameStore((s) => s.qiDelta);

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const lastEventId = useRef(0);
  const floaterSeq = useRef(0);

  useEffect(() => {
    if (qiDelta && qiDelta.id !== lastEventId.current && qiDelta.delta !== 0) {
      lastEventId.current = qiDelta.id;
      const id = ++floaterSeq.current;
      setFloaters((f) => [...f, { id, delta: qiDelta.delta }]);
      const t = setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1350);
      return () => clearTimeout(t);
    }
  }, [qiDelta]);

  const ratio = Math.max(0, Math.min(1, qi / maxQi));
  const { afterQi, holdQiCost, willQiDeplete, willMarginCall } = previewWaitQi();
  const currentHoldQiCost = turnManager?.getCurrentHoldQiCost() ?? 0;
  const isFinalRound = currentRound >= totalRounds;

  // 当前神识归零即显示"神识耗尽"（不依赖反噬事件残留）
  const isBroke = qi <= 0;

  const barColor =
    qi <= 0 ? 'bg-qi-critical qi-breath' :
    ratio < 0.2 ? 'bg-qi-danger' :
    ratio < 0.4 ? 'bg-qi-warn' :
    'bg-qi-full';

  return (
    <div className="px-3 py-1.5 bg-[#faf6ee] border-b border-wood-light">
      {/* 当前气量 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 relative">
          <span className="font-bold font-serif text-ink text-sm">神识</span>
          <span
            className={`px-2.5 py-0.5 rounded-lg text-2xl font-bold font-serif tabular-nums leading-none ${
              isBroke ? 'bg-qi-critical text-white animate-pulse' : 'bg-ink text-parchment'
            }`}
          >
            {qi.toFixed(0)}
          </span>
          <span className="text-sm text-ink-light">/ {maxQi}</span>
          {/* 气量飘字：多个同时出现时横向错开 */}
          {floaters.map((f, idx) => (
            <span
              key={f.id}
              className={`float-up absolute left-0 top-full mt-0.5 text-sm font-bold pointer-events-none whitespace-nowrap ${
                f.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'
              }`}
              style={{ left: `${idx * 26}px` }}
            >
              {f.delta >= 0 ? '+' : ''}{f.delta.toFixed(0)}神识
            </span>
          ))}
        </div>
        {isBroke && (
          <span className="text-xs font-bold text-qi-critical bg-qi-critical/10 px-2 py-0.5 rounded animate-pulse">
            💥 神识耗尽
          </span>
        )}
      </div>

      {/* 最后一回合：不再结算持仓，与"暂无持仓"区分 */}
      {isFinalRound ? (
        <div className="mb-1.5 text-xs text-ink-light">
          结束游戏，不再进行持仓结算
        </div>
      ) : currentHoldQiCost > 0 ? (
        <div className="mb-1 space-y-0.5">
          <div className="text-xs text-ink-light">
            本回合炼化耗神 <span className={`${QI_COST_COLOR} font-bold`}>-{currentHoldQiCost.toFixed(1)} 神识</span>
          </div>

          {holdQiCost > 0 && Math.abs(holdQiCost - currentHoldQiCost) >= 0.05 && (
            <div className="text-[11px] text-ink-light">
              下回合炼化耗神（推演） <span className={`${QI_COST_COLOR} font-bold`}>-{holdQiCost.toFixed(1)} 神识</span>
              <span className="mx-1 text-wood-light">·</span>
              调息后（推演） <b className="text-qi-full tabular-nums">{afterQi.toFixed(1)} 神识</b>
            </div>
          )}

          {willMarginCall ? (
            <>
              {/* 推演口径下的强平提醒：afterQi 是不确定值，不能作为确定剩余气展示 */}
              <div className="text-xs font-medium text-qi-critical">
                若神识不足，可能触发反噬；最终神识取决于被反噬的灵气
              </div>
              <div className="text-[11px] text-qi-critical font-bold bg-qi-critical/10 px-2 py-1 rounded">
                ⚠️ 神识难以为继！回合结束可能反噬，燃灵灵气会被强行释出
              </div>
            </>
          ) : willQiDeplete ? (
            <>
              <div className="text-xs font-medium text-qi-critical">
                扣除炼化耗神后神识将归零；没有燃灵灵气，因此不会触发反噬
              </div>
              <div className="text-xs font-medium text-qi-full">
                点「调息」后预计（推演） <b className="tabular-nums">{afterQi.toFixed(1)}</b> 神识
              </div>
            </>
          ) : holdQiCost > 0 && Math.abs(holdQiCost - currentHoldQiCost) >= 0.05 ? null : (
            <div className="text-xs font-medium text-qi-full">
              点「调息」后剩余（推演） <b className="tabular-nums">{afterQi.toFixed(1)}</b> 神识
            </div>
          )}
        </div>
      ) : (
        <div className="mb-1 text-xs text-ink-light">
          暂无炼化 · 点「调息」后剩余 <b className="text-qi-full tabular-nums">{afterQi.toFixed(1)}</b> 神识
        </div>
      )}

      {/* 进度条 */}
      <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}
