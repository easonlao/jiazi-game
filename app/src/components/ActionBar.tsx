import { useGameStore } from '../store';
import { isVoidCard } from '@core/VoidCard';

export function ActionBar() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPublicCard = useGameStore((s) => s.selectedPublicCard);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const useLeverage = useGameStore((s) => s.useLeverage);
  const leverageMultiplier = useGameStore((s) => s.leverageMultiplier);
  const currentRound = useGameStore((s) => s.currentRound);
  const hand = useGameStore((s) => s.hand);
  const publicCards = useGameStore((s) => s.publicCards);
  const qi = useGameStore((s) => s.qi);
  // 数值一律来自核心配置，禁止硬编码
  const baseRecovery = useGameStore((s) => s.baseRecovery);
  const waitBonus = useGameStore((s) => s.waitBonus);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const previewBuyCost = useGameStore((s) => s.previewBuyCost);

  const requestBuyPreview = useGameStore((s) => s.requestBuyPreview);
  const requestSellPreview = useGameStore((s) => s.requestSellPreview);
  const requestWaitPreview = useGameStore((s) => s.requestWaitPreview);
  const toggleLeverage = useGameStore((s) => s.toggleLeverage);

  if (gameState !== 'player_action') {
    return (
      <div className="px-4 py-3 text-center text-sm text-ink-light">
        {gameState === 'game_over' ? '游戏结束' : gameState === 'void_round' ? '空亡吞噬中...' : '结算中...'}
      </div>
    );
  }

  // 最后一回合（totalRounds）核心禁止买入，前端同步禁用并提示
  const isFinalRound = currentRound >= totalRounds;
  const selectedCard = selectedPublicCard >= 0 ? publicCards[selectedPublicCard] : null;
  // P2-3：空亡牌是纯事件牌不可买入，选中空亡牌时纳灵按钮不启用
  const isSelectedVoidCard = selectedCard ? isVoidCard(selectedCard) : false;
  const canBuy = !isFinalRound && !isSelectedVoidCard && selectedPublicCard >= 0 && hand.filter((s) => s).length < hand.length;
  const canSell = selectedHandCard >= 0;
  const buyCost = canBuy ? previewBuyCost(selectedPublicCard) : 0;
  // P2-3：previewBuyCost 对空亡牌返回 -1 哨兵，buyCost < 0 一律视为不可负担（按钮禁用）
  const affordBuy = buyCost >= 0 && buyCost <= qi;

  return (
    <div className="z-10 flex flex-col gap-1 px-4 py-1.5 max-md:py-1 bg-[#faf6ee] border-t border-wood-light md:sticky md:bottom-0 max-md:fixed max-md:left-0 max-md:right-0 max-md:bottom-0 max-md:z-30 max-md:max-w-[428px] max-md:mx-auto">
      {/* 最后一回合提示：核心禁止纳灵，需明确告知 */}
      {isFinalRound && (
        <div className="text-[11px] text-qi-critical bg-qi-critical/10 px-2 py-1 rounded">
          最后一回合：只能释灵或调息，纳灵已禁用（纳灵入体的灵气没有下一回合炼化）
        </div>
      )}

      {/* 按钮行 */}
      <div className="grid grid-cols-4 gap-2">
        {/* 纳灵（买入） */}
        <button
          onClick={requestBuyPreview}
          disabled={!canBuy || !affordBuy}
          className={`
            py-2 max-md:py-1.5 rounded-lg text-sm font-bold transition-all duration-150
            ${canBuy && affordBuy
              ? 'bg-qi-full text-white hover:bg-green-600 hover:shadow-md hover:-translate-y-0.5 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          纳灵
        </button>

        {/* 释灵（卖出） */}
        <button
          onClick={requestSellPreview}
          disabled={!canSell}
          className={`
            py-2 max-md:py-1.5 rounded-lg text-sm font-bold transition-all duration-150
            ${canSell
              ? 'bg-qi-critical text-white hover:bg-red-600 hover:shadow-md hover:-translate-y-0.5 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          释灵
        </button>

        {/* 燃灵开关（杠杆） */}
        <button
          onClick={toggleLeverage}
          className={`
            py-2 max-md:py-1.5 rounded-lg text-sm font-bold transition-all duration-150 relative
            ${useLeverage
              ? 'bg-qi-danger text-white ring-2 ring-qi-critical'
              : 'bg-white border border-wood-mid text-wood-dark hover:bg-wood-light/20 hover:shadow-sm hover:-translate-y-0.5 active:scale-95'
            }
          `}
        >
          燃灵{useLeverage ? ' ON' : ' OFF'}
          {useLeverage && (
            <span className="block text-[10px] font-normal">
              {`${leverageMultiplier.toFixed(1)}x`}
            </span>
          )}
        </button>

        {/* 调息（等待）：最后一回合 = 结束游戏，不产生结算/回气 */}
        <button
          onClick={requestWaitPreview}
          className="py-2 max-md:py-1.5 rounded-lg text-sm font-bold bg-white border border-wood-mid text-wood-dark hover:bg-wood-light/20 hover:shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
        >
          {isFinalRound ? '结束游戏' : '调息'}
          {!isFinalRound && (
            <span className="block text-[10px] max-md:text-[9px] font-normal leading-tight whitespace-nowrap">
              <span className="text-qi-full">+{baseRecovery}</span>自然+<span className="text-sky-600">{waitBonus}</span>奖励
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
