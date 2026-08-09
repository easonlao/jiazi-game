import { useGameStore } from '../store';
import { PublicCard } from './PublicCard';
import { HelpButton } from './HelpCenter';
import type { JiaziCard } from '@core/JiaziCard';

export function PublicCards({ onHelp }: { onHelp: () => void }) {
  const publicCards = useGameStore((s) => s.publicCards);
  const selectedPublicCard = useGameStore((s) => s.selectedPublicCard);
  const selectPublicCard = useGameStore((s) => s.selectPublicCard);
  const gameState = useGameStore((s) => s.gameState);
  const turnManager = useGameStore((s) => s.turnManager);
  const lockedCardIds = useGameStore((s) => s.lockedCardIds);
  const toggleLockCard = useGameStore((s) => s.toggleLockCard);

  if (gameState === 'init') {
    return (
      <div className="px-4 py-8 text-center text-ink-light text-sm">
        正在加载牌库...
      </div>
    );
  }

  if (publicCards.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-ink-light text-sm">
        周遭暂无灵气浮现
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-4 py-1.5 max-md:py-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold font-serif text-ink">周遭灵气</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-light">
            {gameState === 'player_action' ? '选灵气后操作' : '天时流转中...'}
          </span>
          <HelpButton onClick={onHelp} />
        </div>
      </div>
      {/* 当季提示 */}
      <SeasonHint
        season={useGameStore((s) => s.season)}
        volatilityActive={turnManager?.getScoreVolatilityState() !== null}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {publicCards
          // 2026-08-07 防「影子牌」：同一种牌只渲染一张（重复 id 是底层残留/异常，
          // 直接渲染会出现无法选中操作的幽灵卡——用户实测公共区 4 张、5 张且有重复乙卯）。
          // key 用「位置-名字」复合，避免 React 同 id 冲突导致重复卡渲染异常。
          .filter((card, i, arr) => arr.findIndex((c) => c.id === card.id) === i)
          .map((card: JiaziCard, i: number) => {
          // 需要从 store 实时读 cost（因为 useLeverage 可能变了）
          return (
            <PublicCardItem
              key={`${i}-${card.id}`}
              card={card}
              index={i}
              selected={selectedPublicCard === i}
              onSelect={() => selectPublicCard(i)}
              disabled={gameState !== 'player_action'}
              locked={lockedCardIds.includes(card.id)}
              onToggleLock={gameState === 'player_action' ? () => toggleLockCard(i) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function PublicCardItem({
  card,
  index,
  selected,
  onSelect,
  disabled,
  locked,
  onToggleLock,
}: {
  card: JiaziCard;
  index: number;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  locked: boolean;
  onToggleLock?: () => void;
}) {
  const previewBuyCost = useGameStore((s) => s.previewBuyCost);
  const previewHoldEarning = useGameStore((s) => s.previewHoldEarning);
  const previewHoldQiCost = useGameStore((s) => s.previewHoldQiCost);
  const useLeverage = useGameStore((s) => s.useLeverage);
  const qi = useGameStore((s) => s.qi);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);
  const score = turnManager ? turnManager.getCardScore(card, season) : card.getSeasonScore(season);
  const nextScore = turnManager ? turnManager.getCardScore(card, turnManager.getFollowingSeason()) : score;

  const cost = previewBuyCost(index);
  const canAfford = cost <= qi;
  const holdEarning = previewHoldEarning(index);
  const holdQiCost = previewHoldQiCost(index);
  const volatilityTrend = turnManager?.getCardVolatilityTrend(card) ?? undefined;

  return (
    <PublicCard
      card={card}
      score={score}
      nextScore={nextScore}
      selected={selected}
      onClick={disabled ? undefined : onSelect}
      buyCost={cost}
      canAfford={canAfford}
      holdEarning={holdEarning}
      holdQiCost={holdQiCost}
      volatilityTrend={volatilityTrend}
      locked={locked}
      onToggleLock={onToggleLock}
    />
  );
}

/** 当季元素提示：告诉玩家当前季节哪种元素的牌评分最高 */
function SeasonHint({ season, volatilityActive }: { season: string; volatilityActive: boolean }) {
  const map: Record<string, { element: string; cls: string; text: string }> = {
    spring: { element: '木', cls: 'text-emerald-700', text: '当前是春季，木牌评分最高' },
    summer: { element: '火', cls: 'text-red-600', text: '当前是夏季，火牌评分最高' },
    autumn: { element: '金', cls: 'text-slate-600', text: '当前是秋季，金牌评分最高' },
    winter: { element: '水', cls: 'text-sky-600', text: '当前是冬季，水牌评分最高' },
  };
  const info = map[season];
  if (!info) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      <div className={`text-xs font-medium ${info.cls} bg-white/60 border border-wood-light rounded px-2 py-1`}>
        {info.text} · 土牌四季稳定
      </div>
      {volatilityActive && (
        <span
          data-volatility-experiment
          className="rounded border border-wood-light/70 bg-white/60 px-1.5 py-1 text-[10px] text-ink-light"
        >
          短期波动实验 · 当前分含波动，换季重算
        </span>
      )}
    </div>
  );
}
