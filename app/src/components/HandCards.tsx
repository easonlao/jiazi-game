import { useGameStore } from '../store';
import { Card } from './Card';
import type { HandSlot } from '@core/HandSlot';

export function HandCards() {
  const hand = useGameStore((s) => s.hand);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const selectHandCard = useGameStore((s) => s.selectHandCard);
  const gameState = useGameStore((s) => s.gameState);
  const previewSellInfo = useGameStore((s) => s.previewSellInfo);
  const previewHoldEarning = useGameStore((s) => s.previewHoldEarning);
  const previewHoldQiCost = useGameStore((s) => s.previewHoldQiCost);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);

  const hasCards = hand.some((s) => s !== null);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-sm font-bold font-serif text-ink">
        手牌 {hand.filter((s) => s).length}/{hand.length}
      </h3>

      {!hasCards ? (
        <div className="text-center text-ink-light text-xs py-4 border border-dashed border-wood-light rounded-lg">
          暂无持仓 · 买入公共牌开始游戏
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {hand.map((slot: HandSlot | null, i: number) => {
            if (!slot) return <EmptySlot key={i} />;
            const score = slot.card.getSeasonScore(season);
            const profit = slot.getProfit(season);
            // 仅在选中该手牌时显示卖出预览，未选中时不显示
            const sellPreview = selectedHandCard === i ? previewSellInfo(i) : null;
            // 动态杠杆：买入时开了杠杆的牌，倍数随回合自动增长
            const dynamicLeverage =
              slot.useLeverage
                ? (turnManager ? turnManager.getLeverageMultiplier() : 1)
                : 1;
            const holdEarning = turnManager ? turnManager.previewHoldEarning(score, dynamicLeverage) : 0;
            const holdQiCost = turnManager ? turnManager.previewHoldQiCost(score, dynamicLeverage) : 0;

            return (
              <Card
                key={i}
                card={slot.card}
                score={score}
                selected={selectedHandCard === i}
                onClick={
                  gameState === 'player_action'
                    ? () => selectHandCard(i)
                    : undefined
                }
                handInfo={{
                  buyScore: slot.buyScore,
                  leverage: dynamicLeverage,
                  isLeverage: slot.useLeverage,
                  holdEarnings: slot.holdEarnings,
                  profit,
                }}
                sellPreview={sellPreview}
                holdEarning={holdEarning}
                holdQiCost={holdQiCost}
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
