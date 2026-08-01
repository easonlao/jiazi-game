import { useGameStore } from '../store';

export function ActionBar() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPublicCard = useGameStore((s) => s.selectedPublicCard);
  const selectedHandCard = useGameStore((s) => s.selectedHandCard);
  const useLeverage = useGameStore((s) => s.useLeverage);
  const leverageMultiplier = useGameStore((s) => s.leverageMultiplier);
  const currentRound = useGameStore((s) => s.currentRound);
  const roundInSeason = useGameStore((s) => s.roundInSeason);
  const seasonLength = useGameStore((s) => s.seasonLength);
  const deckSize = useGameStore((s) => s.deckSize);
  const hand = useGameStore((s) => s.hand);
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
        {gameState === 'game_over' ? '游戏结束' : '结算中...'}
      </div>
    );
  }

  // 最后一回合（totalRounds）核心禁止买入，前端同步禁用并提示
  const isFinalRound = currentRound >= totalRounds;
  const canBuy = !isFinalRound && selectedPublicCard >= 0 && hand.filter((s) => s).length < hand.length;
  const canSell = selectedHandCard >= 0;
  const buyCost = canBuy ? previewBuyCost(selectedPublicCard) : 0;
  const affordBuy = buyCost <= qi;

  // 杠杆 ON 时的实际倍数；OFF 时固定 1.0
  const effectiveMultiplier = useLeverage ? leverageMultiplier : 1.0;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-[#faf6ee] border-t border-wood-light">
      {/* 信息行 */}
      <div className="flex items-center justify-between text-[11px] text-ink-light">
        <span>牌堆剩余 {deckSize} 张</span>
        <span className={useLeverage ? 'text-qi-critical font-bold' : ''}>
          杠杆 {effectiveMultiplier.toFixed(1)}x
          {useLeverage && leverageMultiplier > 1 && (
            <span className="ml-1 opacity-70">(本季第{roundInSeason}/{seasonLength}回合)</span>
          )}
          {useLeverage && leverageMultiplier === 1 && (
            <span className="ml-1 opacity-70 text-qi-critical">(预埋杠杆)</span>
          )}
        </span>
      </div>

      {/* 杠杆预埋提示 */}
      {useLeverage && leverageMultiplier === 1 && (
        <div className="text-[11px] text-qi-critical bg-qi-critical/10 px-2 py-1 rounded">
          预埋杠杆仓位 · 当前 1.0x · 季内第 3 回合升至 1.5x，之后每 3 回合升档（换季重置）
        </div>
      )}

      {/* 最后一回合提示：核心禁止买入，需明确告知 */}
      {isFinalRound && (
        <div className="text-[11px] text-qi-critical bg-qi-critical/10 px-2 py-1 rounded">
          最后一回合：只能卖出或等待，买入已禁用（买入的牌没有下一回合结算）
        </div>
      )}

      {/* 按钮行 */}
      <div className="grid grid-cols-4 gap-2">
        {/* 买入 */}
        <button
          onClick={requestBuyPreview}
          disabled={!canBuy || !affordBuy}
          className={`
            py-2 rounded-lg text-sm font-bold transition-all duration-150
            ${canBuy && affordBuy
              ? 'bg-qi-full text-white hover:bg-green-600 hover:shadow-md hover:-translate-y-0.5 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          买入
        </button>

        {/* 卖出 */}
        <button
          onClick={requestSellPreview}
          disabled={!canSell}
          className={`
            py-2 rounded-lg text-sm font-bold transition-all duration-150
            ${canSell
              ? 'bg-qi-critical text-white hover:bg-red-600 hover:shadow-md hover:-translate-y-0.5 active:scale-95'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          卖出
        </button>

        {/* 杠杆开关 */}
        <button
          onClick={toggleLeverage}
          className={`
            py-2 rounded-lg text-sm font-bold transition-all duration-150 relative
            ${useLeverage
              ? 'bg-qi-danger text-white ring-2 ring-qi-critical'
              : 'bg-white border border-wood-mid text-wood-dark hover:bg-wood-light/20 hover:shadow-sm hover:-translate-y-0.5 active:scale-95'
            }
          `}
        >
          杠杆{useLeverage ? ' ON' : ' OFF'}
          {useLeverage && (
            <span className="block text-[10px] font-normal">
              {leverageMultiplier > 1 ? `${leverageMultiplier}x` : '预埋 1.0x'}
            </span>
          )}
        </button>

        {/* 等待：最后一回合 = 结束游戏，不产生结算/回气 */}
        <button
          onClick={requestWaitPreview}
          className="py-2 rounded-lg text-sm font-bold bg-white border border-wood-mid text-wood-dark hover:bg-wood-light/20 hover:shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
        >
          {isFinalRound ? '结束游戏' : '等待'}
          {!isFinalRound && (
            <span className="block text-[10px] font-normal leading-tight">
              <span className="text-qi-full">+{baseRecovery}</span>自然+<span className="text-sky-600">{waitBonus}</span>奖励
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
