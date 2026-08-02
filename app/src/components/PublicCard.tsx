import type { JiaziCard } from '@core/JiaziCard';
import { CardVisual } from './CardVisual';

interface PublicCardProps {
  card: JiaziCard;
  score: number;
  nextScore?: number;
  selected?: boolean;
  onClick?: () => void;
  buyCost: number;
  canAfford: boolean;
  holdEarning: number;
  holdQiCost: number;
}

/**
 * 公共牌：买入成本 + 每回合持有收益/气耗。
 * 不显示杠杆徽章和卖出预览（那是手牌的职责）。
 */
export function PublicCard({ card, score, nextScore, selected, onClick, buyCost, canAfford, holdEarning, holdQiCost }: PublicCardProps) {
  return (
    <CardVisual
      card={card}
      score={score}
      nextScore={nextScore}
      selected={selected}
      onClick={onClick}
    >
      <div className="grid grid-cols-2 divide-x divide-wood-light/35 text-xs">
        <div className="px-2.5 py-1">
          <span className="block text-[10px] text-ink-light">买入成本</span>
          <span className={`font-bold tabular-nums ${canAfford ? 'text-qi-full' : 'text-qi-critical'}`}>
            -{buyCost} 气
          </span>
        </div>
        <div className="px-2.5 py-1">
          <span className="block text-[10px] text-ink-light">每回合持有</span>
          <span className="whitespace-nowrap font-bold tabular-nums">
            <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}分</span>
            <span className="ml-1 text-qi-critical">-{holdQiCost.toFixed(1)}气</span>
          </span>
        </div>
      </div>
    </CardVisual>
  );
}
