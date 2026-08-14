import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Element, YinYang } from '@core/index';
import { useGameStore } from '../store';
import { BUY_FLIGHT_MS, BUY_SEQUENCE_TOTAL_MS, prefersReducedMotion } from '../lib/buySettlementFx';
import { elementBorder, elementScoreColor } from './CardVisual';

/** 五行光晕色（与 CardVisual elementBorder 的边框色一致：emerald/red/amber/slate/sky 400）。 */
const ELEMENT_GLOW: Record<Element, string> = {
  [Element.WOOD]: '#34d399', // emerald-400
  [Element.FIRE]: '#f87171', // red-400
  [Element.EARTH]: '#fbbf24', // amber-400
  [Element.METAL]: '#94a3b8', // slate-400
  [Element.WATER]: '#38bdf8', // sky-400
};

/** 神识消耗统一色（与 PublicCard/HandCard 的 QI_COST_COLOR 一致：资源冷色） */
const QI_COST_COLOR = 'text-sky-600';

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

/** 买入飞行卡面快照（字段与 FxBuySettlementEvent 对齐，渲染完整真实卡面）。 */
interface BuyFlight {
  id: number;
  cardName: string;
  tianGan: string;
  diZhi: string;
  tianGanElement: Element;
  diZhiElement: Element;
  mainElement: Element;
  yinYang: YinYang;
  score: number;
  nextScore: number;
  buyCost: number;
  holdEarning: number;
  holdQiCost: number;
  useLeverage: boolean;
  wasLocked: boolean;
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
    // 减少动效偏好或无源几何：不播飞行，直接清事件让目标槽位立即显示手牌
    if (prefersReducedMotion() || (event.sourceX === 0 && event.sourceY === 0)) {
      useGameStore.setState({ buySettlementEvent: null });
      return;
    }

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
        tianGan: event.tianGan,
        diZhi: event.diZhi,
        tianGanElement: event.tianGanElement,
        diZhiElement: event.diZhiElement,
        mainElement: event.mainElement,
        yinYang: event.yinYang,
        score: event.score,
        nextScore: event.nextScore,
        buyCost: event.buyCost,
        holdEarning: event.holdEarning,
        holdQiCost: event.holdQiCost,
        useLeverage: event.useLeverage,
        wasLocked: event.wasLocked,
        startX: event.sourceX,
        startY: event.sourceY,
        deltaX: targetX - event.sourceX,
        deltaY: targetY - event.sourceY,
      });
    });
    const clearTimer = window.setTimeout(() => {
      setBuyFlight(null);
      // 飞行结束：清空事件 → HandCards 目标槽位恢复真实手牌（飞行期间留空，
      // 全程同一张牌视觉；2026-08-14 两层叠加反馈修复）。
      useGameStore.setState({ buySettlementEvent: null });
    }, BUY_FLIGHT_MS);
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
            color: ELEMENT_GLOW[buyFlight.mainElement],
          } as CSSProperties}
          data-testid="buy-card-flight"
          aria-label={`纳灵 ${buyFlight.cardName}`}
        >
          {/* 完整真实卡面（2026-08-14 三轮迭代定稿）：与公共牌/手牌同款视觉——
              干支五行着色、阴阳徽章、评分行「当前评分 → 下季」、三行信息（耗神/炼化/炼耗）。
              落定时真实手牌已就位、两处卡面一致 → 视觉无缝衔接「就是这张牌飞进去了」。 */}
          <div
            className={`relative overflow-hidden rounded-lg border-2 select-none min-w-0 ${elementBorder[buyFlight.mainElement]}`}
            data-testid="buy-flight-face"
          >
            {/* 顶部：干支（天干地支各自按五行着色）+ 阴阳徽章 + 燃灵/锁定徽章 */}
            <div className="flex items-center justify-between gap-1 px-2 pt-1.5 pb-0.5">
              <span className="text-base max-md:text-[15px] leading-none font-bold truncate min-w-0">
                <span className={elementScoreColor[buyFlight.tianGanElement]}>{buyFlight.tianGan}</span>
                <span className={elementScoreColor[buyFlight.diZhiElement]}>{buyFlight.diZhi}</span>
              </span>
              <div className="flex gap-1 shrink-0">
                <span
                  className={`text-[10px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold ${
                    buyFlight.yinYang === YinYang.YANG
                      ? 'bg-orange-500 text-white'
                      : 'bg-violet-500 text-white'
                  }`}
                  title={buyFlight.yinYang === YinYang.YANG ? '阳 · 波动较大' : '阴 · 较稳'}
                >
                  {buyFlight.yinYang === YinYang.YANG ? '阳' : '阴'}
                </span>
                {buyFlight.useLeverage && (
                  <span
                    className="text-[9px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold bg-qi-critical text-white"
                    title="燃灵（杠杆买入）"
                  >
                    燃
                  </span>
                )}
                {buyFlight.wasLocked && (
                  <span
                    className="text-[9px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold border border-amber-500 bg-amber-100 text-amber-700"
                    title="买入前处于锁定状态"
                  >
                    锁
                  </span>
                )}
              </div>
            </div>

            {/* 评分行：当前评分 → 下季评分（与 CardVisual market 模式同结构） */}
            <div className="card-score-trend flex items-end justify-between gap-1 border-y border-wood-light/35 bg-white/35 px-2 py-1.5 max-md:py-1">
              <div className="min-w-0 flex-1">
                <span className="card-score-label block text-[10px] max-md:text-[9px] leading-tight text-ink-light">
                  当前评分
                </span>
                <div className="flex items-baseline gap-1">
                  <span className={`card-score-value text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap ${elementScoreColor[buyFlight.mainElement]}`}>
                    {buyFlight.score >= 0 ? '+' : ''}{buyFlight.score.toFixed(1)}
                    <span className="mx-0.5 text-ink-light/50">→</span>
                    {buyFlight.nextScore >= 0 ? '+' : ''}{buyFlight.nextScore.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* 三行信息：耗神 / 炼化 / 炼耗（与公共牌同口径，落定后与手牌一致） */}
            <div className="divide-y divide-wood-light/35 text-[11px] max-md:text-[10px]">
              <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
                <span className="text-[9px] text-ink-light shrink-0">耗神</span>
                <span className={`font-bold tabular-nums whitespace-nowrap ${QI_COST_COLOR}`}>
                  -{buyFlight.buyCost} 神识
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
                <span className="text-[9px] text-ink-light shrink-0">炼化</span>
                <span className={`font-bold tabular-nums whitespace-nowrap ${buyFlight.holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
                  {buyFlight.holdEarning >= 0 ? '+' : ''}{buyFlight.holdEarning.toFixed(1)}修为
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
                <span className="text-[9px] text-ink-light shrink-0">炼耗</span>
                <span className={`font-bold tabular-nums whitespace-nowrap ${QI_COST_COLOR}`}>
                  -{buyFlight.holdQiCost.toFixed(1)}神识
                </span>
              </div>
            </div>
          </div>
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
