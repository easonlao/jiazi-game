import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from '../store';
import { BUY_FLIGHT_MS, BUY_SEQUENCE_TOTAL_MS, prefersReducedMotion } from '../lib/buySettlementFx';

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

interface BuyFlight {
  id: number;
  cardName: string;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

/**
 * 回合结算的视觉路径：丹田炼化收益先飞入顶部修为，再由 QiBar 播放耗神/回神顺序。
 * 引擎状态仍在一次回合结算中原子更新，这里只负责把已发生的结算过程分段呈现给玩家。
 *
 * 跨回合买入（纳灵）时：先播「公共灵气入丹田 + 纳灵耗神」，
 * 本组件的炼化光点等 BUY_SEQUENCE_TOTAL_MS 后再登场，避免两段动画抢镜。
 */
export function SettlementAnimation() {
  const roundEvent = useGameStore((s) => s.roundEvent);
  const lastSettlement = useGameStore((s) => s.lastSettlement);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const buySettlementEvent = useGameStore((s) => s.buySettlementEvent);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [buyFlight, setBuyFlight] = useState<BuyFlight | null>(null);
  const lastEventId = useRef(0);
  const lastBuyEventId = useRef(0);

  useLayoutEffect(() => {
    const event = buySettlementEvent;
    if (!event || event.id === lastBuyEventId.current || event.round !== currentRound) return;
    lastBuyEventId.current = event.id;
    if (prefersReducedMotion() || (event.sourceX === 0 && event.sourceY === 0)) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>(`[data-hand-card-slot="${event.slotIndex}"]`);
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;
      setBuyFlight({
        id: event.id,
        cardName: event.cardName,
        startX: event.sourceX,
        startY: event.sourceY,
        deltaX: targetX - event.sourceX,
        deltaY: targetY - event.sourceY,
      });
    });
    const clearTimer = window.setTimeout(() => setBuyFlight(null), BUY_FLIGHT_MS);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
    };
  }, [buySettlementEvent, currentRound]);

  useLayoutEffect(() => {
    if (!roundEvent || roundEvent.id === lastEventId.current || currentRound > totalRounds) return;
    lastEventId.current = roundEvent.id;

    const items = lastSettlement?.round === currentRound ? lastSettlement.holdItems : [];
    if (items.length === 0) return;
    if (prefersReducedMotion()) return;

    // 本轮是确认纳灵后的新回合：让位给买入动画（卡牌飞行 + 纳灵耗神），再播炼化光点。
    const buyPending = buySettlementEvent?.round === currentRound && !prefersReducedMotion();
    const startDelay = buyPending ? BUY_SEQUENCE_TOTAL_MS : 0;

    let cancelled = false;
    const frame = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
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
    }, startDelay);

    const clearTimer = window.setTimeout(() => setFlights([]), startDelay + 1_350 + items.length * 90);
    return () => {
      cancelled = true;
      window.clearTimeout(frame);
      window.clearTimeout(clearTimer);
    };
  }, [roundEvent, lastSettlement, currentRound, totalRounds, buySettlementEvent]);

  if (flights.length === 0 && !buyFlight) return null;

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      aria-hidden="true"
      data-testid="settlement-animation"
    >
      {buyFlight && (
        <div
          className="buy-card-flight"
          style={{
            left: `${buyFlight.startX}px`,
            top: `${buyFlight.startY}px`,
            '--buy-flight-x': `${buyFlight.deltaX}px`,
            '--buy-flight-y': `${buyFlight.deltaY}px`,
          } as CSSProperties}
          data-testid="buy-card-flight"
          aria-label={`纳灵 ${buyFlight.cardName}`}
        >
          {buyFlight.cardName}
        </div>
      )}
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
            aria-label={flight.earning >= 0 ? '炼化收益' : '炼化反噬'}
          />
        );
      })}
    </div>
  );
}
