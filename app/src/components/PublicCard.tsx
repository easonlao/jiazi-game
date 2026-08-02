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
      {/* 上下堆叠而非两列：每行 label + 值，独享整行宽度，
          避免 "每回合持有 +2.0分 -2.2气" 在窄屏被截断。 */}
      <div className="divide-y divide-wood-light/35 text-xs">
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[10px] text-ink-light shrink-0">买入成本</span>
          <span className={`font-bold tabular-nums whitespace-nowrap ${canAfford ? 'text-qi-full' : 'text-qi-critical'}`}>
            -{buyCost} 气
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[10px] text-ink-light shrink-0">每回合持有</span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
              {holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}分
            </span>
            <span className="ml-1.5 text-qi-critical">-{holdQiCost.toFixed(1)}气</span>
          </span>
        </div>
      </div>
    </CardVisual>
  );
}
