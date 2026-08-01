import { useGameStore } from '../store';
import { Card } from './Card';
import type { JiaziCard } from '@core/JiaziCard';

export function PublicCards() {
  const publicCards = useGameStore((s) => s.publicCards);
  const selectedPublicCard = useGameStore((s) => s.selectedPublicCard);
  const selectPublicCard = useGameStore((s) => s.selectPublicCard);
  const gameState = useGameStore((s) => s.gameState);
  const turnManager = useGameStore((s) => s.turnManager);

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
        公共牌池为空
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold font-serif text-ink">公共牌池</h3>
        <span className="text-[11px] text-ink-light">
          {gameState === 'player_action' ? '点击卡牌选择，再按下方按钮操作' : '等待回合...'}
        </span>
      </div>
      {/* 当季提示 */}
      <SeasonHint season={useGameStore((s) => s.season)} />
      {/* 元素图例 */}
      <div className="flex gap-1.5 text-[10px] text-ink-light">
        <span className="flex items-center gap-0.5"><span className="w-3 h-3 rounded border-2 border-emerald-400 bg-emerald-50/50" />木</span>
        <span className="flex items-center gap-0.5"><span className="w-3 h-3 rounded border-2 border-red-400 bg-red-50/50" />火</span>
        <span className="flex items-center gap-0.5"><span className="w-3 h-3 rounded border-2 border-amber-400 bg-amber-50/50" />土</span>
        <span className="flex items-center gap-0.5"><span className="w-3 h-3 rounded border-2 border-slate-400 bg-slate-50/50" />金</span>
        <span className="flex items-center gap-0.5"><span className="w-3 h-3 rounded border-2 border-sky-400 bg-sky-50/50" />水</span>
        <span className="ml-1 text-ink-light/60">= 元素</span>
      </div>
      {/* 评分机制提示 */}
      <p className="text-[10px] text-ink-light/70 leading-relaxed">
        评分越高：每回合收益越高、持仓气耗也越高；杠杆放大收益与气耗，气 ≤ 0 会爆仓强平。
      </p>
      <div className="grid grid-cols-2 gap-2">
        {publicCards.map((card: JiaziCard, i: number) => {
          // 需要从 store 实时读 cost（因为 useLeverage 可能变了）
          return (
            <PublicCardItem
              key={card.id}
              card={card}
              index={i}
              selected={selectedPublicCard === i}
              onSelect={() => selectPublicCard(i)}
              disabled={gameState !== 'player_action'}
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
}: {
  card: JiaziCard;
  index: number;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const previewBuyCost = useGameStore((s) => s.previewBuyCost);
  const previewHoldEarning = useGameStore((s) => s.previewHoldEarning);
  const previewHoldQiCost = useGameStore((s) => s.previewHoldQiCost);
  const useLeverage = useGameStore((s) => s.useLeverage);
  const qi = useGameStore((s) => s.qi);
  const season = useGameStore((s) => s.season);
  const turnManager = useGameStore((s) => s.turnManager);
  const score = turnManager ? turnManager.getCardScore(card, season) : card.getSeasonScore(season);
  const nextScore = turnManager ? turnManager.getCardScore(card, turnManager.getSettlementSeason()) : score;

  const cost = previewBuyCost(index);
  const canAfford = cost <= qi;
  const holdEarning = previewHoldEarning(index);
  const holdQiCost = previewHoldQiCost(index);

  return (
    <Card
      card={card}
      score={score}
      nextScore={nextScore}
      selected={selected}
      onClick={disabled ? undefined : onSelect}
      buyCost={cost}
      canAfford={canAfford}
      holdEarning={holdEarning}
      holdQiCost={holdQiCost}
    />
  );
}

/** 当季元素提示：告诉玩家当前季节哪种元素的牌评分最高 */
function SeasonHint({ season }: { season: string }) {
  const map: Record<string, { element: string; cls: string; text: string }> = {
    spring: { element: '木', cls: 'text-emerald-700', text: '当前是春季，木牌评分最高' },
    summer: { element: '火', cls: 'text-red-600', text: '当前是夏季，火牌评分最高' },
    autumn: { element: '金', cls: 'text-slate-600', text: '当前是秋季，金牌评分最高' },
    winter: { element: '水', cls: 'text-sky-600', text: '当前是冬季，水牌评分最高' },
  };
  const info = map[season];
  if (!info) return null;
  return (
    <div className={`text-xs font-medium ${info.cls} bg-white/60 border border-wood-light rounded px-2 py-1`}>
      {info.text} · 土牌四季稳定
    </div>
  );
}
