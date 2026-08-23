import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { HandCard } from './HandCard';
import type { HandSlot } from '@core/HandSlot';
import { Element } from '@core/JiaziCard';

export function HandCards() {
  const hand = useGameStore((s) => s.hand);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const selectHandCard = useGameStore((s) => s.selectHandCard);
  const gameState = useGameStore((s) => s.gameState);
  const previewSellInfo = useGameStore((s) => s.previewSellInfo);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);
  const buySettlementEvent = useGameStore((s) => s.buySettlementEvent);
  const currentRound = useGameStore((s) => s.currentRound);
  // 跨回合买入飞行：目标槽位在飞行期间留空（飞行卡面从公共位飞入空槽位，
  // 到达后手牌显示）——全程只有「一张牌」，避免飞行卡面与真实手牌重叠成两层
  // （2026-08-14 用户反馈：两层叠加让玩家不觉得是同一张牌）。
  const flyingSlot = buySettlementEvent?.round === currentRound
    ? buySettlementEvent.slotIndex
    : null;

  // 反噬来源感：被反噬的丹田槽位（slotIndex）在反噬动画期间播"崩坏"效果，
  // 与中央反噬大卡片同屏——玩家看到"丹田第 N 格崩了"→ 中央弹出惩罚数字的因果链（issue 04）。
  const [shatteredSlots, setShatteredSlots] = useState<Set<number>>(new Set());
  const lastMarginCallId = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (marginCallEvent && marginCallEvent.id !== lastMarginCallId.current) {
      lastMarginCallId.current = marginCallEvent.id;
      const idxs = new Set<number>(
        (marginCallEvent.detail?.marginCallDetails ?? []).map((d) => d.slotIndex),
      );
      setShatteredSlots(idxs);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        setShatteredSlots(new Set());
        clearTimer.current = null;
      }, 3200);
    }
  }, [marginCallEvent]);

  const hasCards = hand.some((s) => s !== null);

  return (
    <div className="flex flex-col gap-1 px-4 py-1.5 max-md:py-1">
      <h3 className="text-sm font-bold font-serif text-ink">
        丹田 {hand.filter((s) => s).length}/{hand.length}
      </h3>

      {!hasCards ? (
        <div
          className="relative flex min-h-24 items-center justify-center text-center text-ink-light text-xs border border-dashed border-wood-light rounded-lg"
        >
          三丹田空置 · 纳灵公共灵气开始炼化
          {marginCallEvent?.detail?.marginCallDetails.length ? (
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 grid h-24 -translate-y-1/2 grid-cols-3 gap-1.5"
              aria-hidden="true"
            >
              {hand.map((_, index) => <span key={index} data-hand-card-slot={index} />)}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {hand.map((slot: HandSlot | null, i: number) => {
            // 买入飞行期间目标槽位留空：飞行卡面从公共位飞入，到达后手牌显示——
            // 同一张牌全程只有一个视觉（2026-08-14 两层叠加反馈修复）。
            if (flyingSlot === i) return <EmptySlot key={i} slotIndex={i} shattered={false} />;
            if (!slot) return <EmptySlot key={i} slotIndex={i} shattered={shatteredSlots.has(i)} />;
            const score = turnManager ? turnManager.getCardScore(slot.card, season) : slot.card.getSeasonScore(season);
            // 仅在选中该手牌时显示卖出预览，未选中时不显示
            const sellPreview = selectedHandCard === i ? previewSellInfo(i) : null;
            // 持仓卡面展示当前回合已经生效的收益/耗神；"→下回合倍数"箭头用
            // 假设不换季的推演口径（getNextLeverageNoSeasonChange）——仅作提醒，
            // 不泄露换季（信息边界契约第三类口径）。
            const currentLeverage =
              slot.useLeverage
                ? (turnManager ? turnManager.getLeverageMultiplier() : 1)
                : 1;
            const settlementLeverage =
              slot.useLeverage
                ? (turnManager ? turnManager.getNextLeverageNoSeasonChange() : 1)
                : 1;
            const holdEarning = turnManager ? turnManager.previewHoldEarning(score, currentLeverage) : 0;
            // 浓度溢价：单卡耗神显示含浓度总价（与实际扣费一致）；徽标暗示来源（V7 生效，V6 及以下 premium=0）。
            const concentration = turnManager ? turnManager.getConcentrationInfo(slot.card) : undefined;
            const holdQiCost = turnManager ? turnManager.previewHoldQiCost(
              score,
              currentLeverage,
              slot.card.tianGanElement === Element.EARTH,
              concentration?.count ?? 0,
              turnManager.getConcentrationPremiumFactor(),
            ) : 0;

            return (
              <HandCard
                key={i}
                card={slot.card}
                slotIndex={i}
                score={score}
                buyScore={slot.buyScore}
                selected={selectedHandCard === i}
                onClick={
                  gameState === 'player_action'
                    ? () => selectHandCard(i)
                    : undefined
                }
                leverage={currentLeverage}
                settlementLeverage={settlementLeverage}
                isLeverage={slot.useLeverage}
                holdEarnings={slot.holdEarnings}
                holdEarning={holdEarning}
                holdQiCost={holdQiCost}
                concentration={concentration}
                sellPreview={sellPreview}
                shattered={shatteredSlots.has(i)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptySlot({ slotIndex, shattered = false }: { slotIndex: number; shattered?: boolean }) {
  return (
    <div
      data-hand-card-slot={slotIndex}
      className={`flex items-center justify-center rounded-lg border-2 border-dashed border-wood-light bg-white/50 h-24 ${
        shattered ? 'mc-shatter-slot' : 'slot-breathe'
      }`}
    >
      <span className="text-xs text-wood-light">{shattered ? '崩坏' : '空位'}</span>
    </div>
  );
}
