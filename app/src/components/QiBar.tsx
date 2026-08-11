import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { BUY_COST_MS, BUY_FLIGHT_MS } from '../lib/buySettlementFx';

interface Floater {
  id: number;
  delta: number;
}

type QiSettlementPhase = 'buy-cost' | 'cost' | 'backlash' | 'recovery';

interface QiSettlementAnimation {
  id: number;
  phase: QiSettlementPhase;
  holdQiCost: number;
  recoveryQi: number;
}

interface QueuedQiSettlement {
  buyQiCost: number;
  hasBuyAnimation: boolean;
  holdQiCost: number;
  recoveryQi: number;
  holdItemCount: number;
  hasMarginCall: boolean;
}

export function QiBar() {
  const qi = useGameStore((s) => s.qi);
  const maxQi = useGameStore((s) => s.maxQi);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const baseRecovery = useGameStore((s) => s.baseRecovery);
  const qiDelta = useGameStore((s) => s.qiDelta);
  const roundEvent = useGameStore((s) => s.roundEvent);
  const buyEvent = useGameStore((s) => s.buySettlementEvent);
  const lastSettlement = useGameStore((s) => s.lastSettlement);

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [settlementAnimation, setSettlementAnimation] = useState<QiSettlementAnimation | null>(null);
  const lastEventId = useRef(0);
  const floaterSeq = useRef(0);
  const lastRoundEventId = useRef(0);
  const settlementQueue = useRef<QueuedQiSettlement[]>([]);
  const settlementRunning = useRef(false);
  const settlementTimer = useRef<number | null>(null);

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
    const hasBuyAnimation = buyEvent?.round === currentRound;
    const buyQiCost = hasBuyAnimation ? (buyEvent?.buyCost ?? 0) : 0;
    const holdQiCost = settlement?.holdQiCost ?? 0;
    const recoveryQi = (settlement?.baseQiRecover ?? baseRecovery) + (settlement?.waitQiRecover ?? 0);
    const holdItemCount = settlement?.holdItems.length ?? 0;
    const hasMarginCall = settlement?.marginCallTriggered ?? false;
    // 空丹田时保留原有净变化飘字；有持仓时将炼化耗神与修为飞点置于同一阶段，随后才回神。
    if (!hasBuyAnimation && holdItemCount === 0 && holdQiCost <= 0 && !hasMarginCall) return;
    settlementQueue.current.push({ buyQiCost, hasBuyAnimation, holdQiCost, recoveryQi, holdItemCount, hasMarginCall });

    // 不让下一回合的状态更新取消上一回合尚未到达的回神阶段。
    if (!settlementRunning.current) {
      settlementRunning.current = true;
      const runNext = () => {
        const next = settlementQueue.current.shift();
        if (!next) {
          settlementRunning.current = false;
          settlementTimer.current = null;
          return;
        }

        const startPhases = () => {
          const hasQiCost = next.holdQiCost > 0;
          const phases: QiSettlementPhase[] = [];
          if (next.buyQiCost > 0) phases.push('buy-cost');
          if (hasQiCost) phases.push('cost');
          if (next.hasMarginCall) phases.push('backlash');
          phases.push('recovery');
          let index = 0;

          const showNextPhase = () => {
            const phase = phases[index++];
            if (!phase) {
              setSettlementAnimation(null);
              runNext();
              return;
            }
            setSettlementAnimation({ id: roundEvent.id, phase, holdQiCost: next.holdQiCost, recoveryQi: next.recoveryQi });
            // 与修为光点 0.9s 动画对齐：耗神阶段先与炼化同时出现，
            // 多张牌错峰时等最后一个光点结束后再进入回神阶段。
            const phaseDuration = phase === 'buy-cost'
              ? BUY_COST_MS
              : phase === 'cost'
                ? Math.max(900, 900 + Math.max(0, next.holdItemCount - 1) * 90)
                : phase === 'recovery' ? 650 : 520;
            settlementTimer.current = window.setTimeout(showNextPhase, phaseDuration);
          };
          showNextPhase();
        };
        if (next.hasBuyAnimation) {
          settlementTimer.current = window.setTimeout(startPhases, BUY_FLIGHT_MS);
        } else {
          startPhases();
        }
      };
      runNext();
    }
  }, [roundEvent, buyEvent]);

  useEffect(() => () => {
    if (settlementTimer.current !== null) window.clearTimeout(settlementTimer.current);
    settlementQueue.current = [];
    settlementRunning.current = false;
  }, []);

  const ratio = Math.max(0, Math.min(1, qi / maxQi));
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
              key={`${settlementAnimation.id}-${settlementAnimation.phase}`}
              className={`qi-settlement-fx qi-settlement-${settlementAnimation.phase}`}
              data-testid="settlement-qi-animation"
              aria-label={
                settlementAnimation.phase === 'buy-cost'
                  ? `纳灵耗神 ${buyEvent?.buyCost?.toFixed(0) ?? '0'}`
                  : settlementAnimation.phase === 'cost'
                  ? `炼化耗神 ${settlementAnimation.holdQiCost.toFixed(0)}`
                  : settlementAnimation.phase === 'backlash'
                    ? '反噬'
                    : `回神 ${settlementAnimation.recoveryQi.toFixed(0)}`
              }
            >
              <span className="mr-1 text-[10px] font-normal text-ink-light">结算</span>
              {settlementAnimation.phase === 'buy-cost' && buyEvent && buyEvent.round === currentRound && (
                <>纳灵 −{buyEvent.buyCost.toFixed(0)} 神识</>
              )}
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

      {/* 最后一回合：不再结算持仓 */}
      {isFinalRound && (
        <div className="mb-1.5 text-xs text-ink-light">
          结束游戏，不再进行持仓结算
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
