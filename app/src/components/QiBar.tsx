import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';

/** 神识消耗统一色（2026-08-06 issue 01 P3：神识消耗=资源冷色，修为才用红绿） */
const QI_COST_COLOR = 'text-sky-600';

interface Floater {
  id: number;
  delta: number;
}

type QiSettlementPhase = 'cost' | 'backlash' | 'recovery';

interface QiSettlementAnimation {
  id: number;
  phase: QiSettlementPhase;
  holdQiCost: number;
  recoveryQi: number;
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
  const roundEvent = useGameStore((s) => s.roundEvent);
  const lastSettlement = useGameStore((s) => s.lastSettlement);

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [settlementAnimation, setSettlementAnimation] = useState<QiSettlementAnimation | null>(null);
  const lastEventId = useRef(0);
  const floaterSeq = useRef(0);
  const lastRoundEventId = useRef(0);

  useEffect(() => {
    const hasAnimatedSettlement = Boolean(
      roundEvent
      && lastSettlement?.round === currentRound
      && ((lastSettlement.holdItems.length ?? 0) > 0 || lastSettlement.holdQiCost > 0),
    );
    // 有持仓结算时由下面的分段动画表达「耗神 → 回神」；没有持仓时保留即时气量飘字。
    if (qiDelta && qiDelta.id !== lastEventId.current && qiDelta.delta !== 0 && !hasAnimatedSettlement) {
      lastEventId.current = qiDelta.id;
      const id = ++floaterSeq.current;
      setFloaters((f) => [...f, { id, delta: qiDelta.delta }]);
      const t = setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1350);
      return () => clearTimeout(t);
    }
  }, [qiDelta, roundEvent]);

  useEffect(() => {
    if (!roundEvent || roundEvent.id === lastRoundEventId.current || currentRound > totalRounds) return;
    lastRoundEventId.current = roundEvent.id;

    const settlement = lastSettlement?.round === currentRound ? lastSettlement : null;
    const holdQiCost = settlement?.holdQiCost ?? 0;
    const recoveryQi = (settlement?.baseQiRecover ?? baseRecovery) + (settlement?.waitQiRecover ?? 0);
    const hasHoldingSettlement = (settlement?.holdItems.length ?? 0) > 0;
    const hasMarginCall = settlement?.marginCallTriggered ?? false;
    // 空丹田时保留原有净变化飘字；分段动画只为解释「卡牌炼化 → 耗神」这条气路。
    if (!hasHoldingSettlement && holdQiCost <= 0 && !hasMarginCall) return;
    const animationId = roundEvent.id;
    const timers: number[] = [];

    const setPhase = (phase: QiSettlementPhase) => {
      setSettlementAnimation({ id: animationId, phase, holdQiCost, recoveryQi });
    };

    // 丹田炼化飞行约 0.9 秒完成后，再显示神识扣除；空丹田则立即进入气量结算。
    const hasQiCost = holdQiCost > 0;
    const costDelay = hasHoldingSettlement ? 900 : 0;
    if (hasQiCost) timers.push(window.setTimeout(() => setPhase('cost'), costDelay));
    const backlashDelay = costDelay + (hasQiCost ? 520 : 0);
    const recoveryDelay = backlashDelay + (hasMarginCall ? 500 : 0);
    if (hasMarginCall) timers.push(window.setTimeout(() => setPhase('backlash'), backlashDelay));
    timers.push(window.setTimeout(() => setPhase('recovery'), recoveryDelay));
    timers.push(window.setTimeout(() => setSettlementAnimation(null), recoveryDelay + 650));

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [roundEvent, lastSettlement, currentRound, totalRounds, baseRecovery]);

  const ratio = Math.max(0, Math.min(1, qi / maxQi));
  const { afterQi, holdQiCost, willQiDeplete, willMarginCall } = previewWaitQi();
  const currentHoldQiCost = turnManager?.getCurrentHoldQiCost() ?? 0;
  const waitBonus = turnManager?.getWaitBonus() ?? 0;
  const recoveryQi = baseRecovery + waitBonus;
  // 调息预览使用下回合结算口径；没有持仓时回退到当前耗神值，避免气路信息消失。
  const projectedHoldQiCost = holdQiCost > 0 ? holdQiCost : currentHoldQiCost;
  const isFinalRound = currentRound >= totalRounds;

  // 当前神识归零即显示"神识耗尽"（不依赖反噬事件残留）
  const isBroke = qi <= 0;

  const barColor =
    qi <= 0 ? 'bg-qi-critical qi-breath' :
    ratio < 0.2 ? 'bg-qi-danger' :
    ratio < 0.4 ? 'bg-qi-warn' :
    'bg-qi-full';

  return (
    <div className="px-3 py-1.5 max-md:py-1 bg-[#faf6ee] border-b border-wood-light">
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
          {settlementAnimation && (
            <span
              className={`qi-settlement-fx qi-settlement-${settlementAnimation.phase}`}
              data-testid="settlement-qi-animation"
              aria-label={
                settlementAnimation.phase === 'cost'
                  ? `炼化耗神 ${settlementAnimation.holdQiCost.toFixed(0)}`
                  : settlementAnimation.phase === 'backlash'
                    ? '反噬'
                    : `调息恢复 ${settlementAnimation.recoveryQi.toFixed(0)}`
              }
            >
              <span className="mr-1 text-[10px] font-normal text-ink-light">结算</span>
              {settlementAnimation.phase === 'cost' && settlementAnimation.holdQiCost > 0 && (
                <>−{settlementAnimation.holdQiCost.toFixed(0)} 神识</>
              )}
              {settlementAnimation.phase === 'backlash' && <>⚠ 反噬</>}
              {settlementAnimation.phase === 'recovery' && (
                <>+{settlementAnimation.recoveryQi.toFixed(0)} 神识</>
              )}
            </span>
          )}
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
      ) : projectedHoldQiCost > 0 ? (
        <div className="mb-1.5 space-y-0.5" data-testid="qi-settlement-flow">
          <div className="text-[11px] text-ink-light">下回合气路</div>
          <div
            className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] leading-tight tabular-nums"
            aria-label="下回合神识结算路径"
          >
            <b className="text-ink">{qi.toFixed(0)}</b>
            <span className={QI_COST_COLOR}>−{projectedHoldQiCost.toFixed(0)} 炼化</span>
            <span className="text-wood-light">→</span>
            <b className={willQiDeplete ? 'text-qi-critical' : 'text-ink'}>{(qi - projectedHoldQiCost).toFixed(0)}</b>
            {willMarginCall && <span className="font-bold text-qi-critical">⚠ 反噬</span>}
            <span className="text-wood-light">→</span>
            <span className="font-semibold text-qi-full">+{recoveryQi.toFixed(0)} 调息</span>
            {!willMarginCall && (
              <>
                <span className="text-wood-light">→</span>
                <b className="text-qi-full">{afterQi.toFixed(0)}</b>
              </>
            )}
          </div>
          {willMarginCall && (
            <div className="text-[10px] font-medium text-qi-critical">
              先判反噬，再回气
            </div>
          )}
        </div>
      ) : (
        <div className="mb-1 text-[11px] text-ink-light" data-testid="qi-settlement-flow">
          下回合气路 <b className="text-ink tabular-nums">{qi.toFixed(0)}</b>
          <span className="mx-1 text-wood-light">→</span>
          <span className="font-semibold text-qi-full">+{recoveryQi.toFixed(0)} 调息</span>
          <span className="mx-1 text-wood-light">→</span>
          <b className="text-qi-full tabular-nums">{afterQi.toFixed(0)}</b>
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
