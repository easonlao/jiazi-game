import { useGameStore } from '../store';
import { HandCard } from './HandCard';
import type { HandSlot } from '@core/HandSlot';

export function HandCards() {
  const hand = useGameStore((s) => s.hand);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const selectHandCard = useGameStore((s) => s.selectHandCard);
  const gameState = useGameStore((s) => s.gameState);
  const previewSellInfo = useGameStore((s) => s.previewSellInfo);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);

  const hasCards = hand.some((s) => s !== null);

  return (
    <div className="flex flex-col gap-1 px-4 py-1.5">
      <h3 className="text-sm font-bold font-serif text-ink">
        手牌 {hand.filter((s) => s).length}/{hand.length}
      </h3>

      {!hasCards ? (
        <div className="text-center text-ink-light text-xs py-4 border border-dashed border-wood-light rounded-lg">
          暂无持仓 · 买入公共牌开始游戏
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {hand.map((slot: HandSlot | null, i: number) => {
            if (!slot) return <EmptySlot key={i} />;
            const score = turnManager ? turnManager.getCardScore(slot.card, season) : slot.card.getSeasonScore(season);
            const nextScore = turnManager ? turnManager.getCardScore(slot.card, turnManager.getFollowingSeason()) : score;
            // 仅在选中该手牌时显示卖出预览，未选中时不显示
            const sellPreview = selectedHandCard === i ? previewSellInfo(i) : null;
            // 持仓卡面展示当前回合已经生效的收益/气耗；下一回合倍率只通过杠杆箭头提示，
            // 点击「等待」后的实际变化统一放在结算确认弹窗中展示。
            const currentLeverage =
              slot.useLeverage
                ? (turnManager ? turnManager.getLeverageMultiplier() : 1)
                : 1;
            const settlementLeverage =
              slot.useLeverage
                ? (turnManager ? turnManager.getSettlementLeverageMultiplier() : 1)
                : 1;
            const holdEarning = turnManager ? turnManager.previewHoldEarning(score, currentLeverage) : 0;
            const holdQiCost = turnManager ? turnManager.previewHoldQiCost(score, currentLeverage) : 0;

            return (
              <HandCard
                key={i}
                card={slot.card}
                score={score}
                nextScore={nextScore}
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
                sellPreview={sellPreview}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="slot-breathe flex items-center justify-center rounded-lg border-2 border-dashed border-wood-light bg-white/50 h-24">
      <span className="text-xs text-wood-light">空位</span>
    </div>
  );
}
