import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from '../store';

interface Flight {
  id: string;
  cardName: string;
  earning: number;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  delay: number;
}

/**
 * 回合结算的视觉路径：丹田炼化收益先飞入顶部修为，再由 QiBar 播放耗神/回神顺序。
 * 引擎状态仍在一次回合结算中原子更新，这里只负责把已发生的结算过程分段呈现给玩家。
 */
export function SettlementAnimation() {
  const roundEvent = useGameStore((s) => s.roundEvent);
  const lastSettlement = useGameStore((s) => s.lastSettlement);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const [flights, setFlights] = useState<Flight[]>([]);
  const lastEventId = useRef(0);

  useLayoutEffect(() => {
    if (!roundEvent || roundEvent.id === lastEventId.current || currentRound > totalRounds) return;
    lastEventId.current = roundEvent.id;

    const items = lastSettlement?.round === currentRound ? lastSettlement.holdItems : [];
    if (items.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;

      const target = document.querySelector('[data-score-panel]')?.getBoundingClientRect();
      const fallbackSource = document.querySelector('[data-hand-card-slot]')?.getBoundingClientRect();
      if (!target || (!fallbackSource && document.querySelectorAll('[data-card-name]').length === 0)) return;

      const targetX = target.left + target.width / 2;
      const targetY = target.top + target.height / 2;
      const nextFlights = items.map((item, index) => {
        const cardSource = Array.from(document.querySelectorAll<HTMLElement>('[data-card-name]'))
          .find((element) => element.dataset.cardName === item.cardName);
        // 反噬会在结算后移除被清仓卡；此时从它原本的丹田槽位起飞，
        // 仍然保留「这张卡参与了炼化结算」的来源感，而不是借用另一张牌的位置。
        const marginCallSlot = lastSettlement?.marginCallDetails.find((detail) => detail.cardName === item.cardName)?.slotIndex;
        const slotSource = marginCallSlot === undefined
          ? undefined
          : document.querySelector<HTMLElement>(`[data-hand-card-slot="${marginCallSlot}"]`);
        const source = cardSource?.getBoundingClientRect()
          ?? slotSource?.getBoundingClientRect()
          ?? fallbackSource!;
        const startX = source.left + source.width / 2;
        const startY = source.top + source.height / 2;

        return {
          id: `${roundEvent.id}-${index}`,
          cardName: item.cardName,
          earning: item.earning,
          startX,
          startY,
          deltaX: targetX - startX,
          deltaY: targetY - startY,
          delay: index * 90,
        };
      });

      setFlights(nextFlights);
    });

    const clearTimer = window.setTimeout(() => setFlights([]), 1_350 + items.length * 90);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
    };
  }, [roundEvent, lastSettlement, currentRound, totalRounds]);

  if (flights.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      aria-hidden="true"
      data-testid="settlement-animation"
    >
      {flights.map((flight) => {
        const style = {
          left: `${flight.startX}px`,
          top: `${flight.startY}px`,
          '--settlement-flight-x': `${flight.deltaX}px`,
          '--settlement-flight-y': `${flight.deltaY}px`,
          animationDelay: `${flight.delay}ms`,
        } as CSSProperties;

        return (
          <span
            key={flight.id}
            className={`settlement-card-flight ${flight.earning >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}
            style={style}
            data-testid="settlement-card-flight"
          >
            {flight.earning >= 0 ? '+' : ''}{flight.earning.toFixed(1)}
          </span>
        );
      })}
    </div>
  );
}
