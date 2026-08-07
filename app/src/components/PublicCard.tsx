import type { JiaziCard } from '@core/JiaziCard';
import { CardVisual } from './CardVisual';

/** 神识消耗统一色（2026-08-06 issue 01 P3：神识消耗=资源冷色，修为才用红绿） */
const QI_COST_COLOR = 'text-sky-600';

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
  /** 是否处于锁定状态 */
  locked?: boolean;
  /** 锁定回调（点击锁按钮触发） */
  onToggleLock?: () => void;
}

/**
 * 公共牌：纳灵消耗 + 每回合炼化收益/耗神 + 锁定按钮。
 * 不显示杠杆徽章和卖出预览（那是手牌的职责）。
 */
export function PublicCard({
  card, score, nextScore, selected, onClick, buyCost, canAfford,
  holdEarning, holdQiCost, locked, onToggleLock,
}: PublicCardProps) {
  return (
    <CardVisual
      card={card}
      score={score}
      nextScore={nextScore}
      selected={selected}
      onClick={onClick}
      badges={
        onToggleLock ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
            title={locked ? '点击解锁（灵气回灵流，停止耗神）' : '点击锁定（留住灵气，每回合 -5 神识）'}
            aria-label={locked ? '解锁此卡牌' : '锁定此卡牌'}
            className={`
              lock-btn relative flex h-6 w-6 items-center justify-center rounded-full
              border transition-all duration-200 active:scale-90
              ${locked
                ? 'border-amber-500 bg-amber-100 text-amber-700 shadow-sm'
                : 'border-wood-light/40 bg-white/70 text-ink-light hover:border-amber-400 hover:text-amber-600'
              }
            `}
          >
            {/* 锁图标：锁定=实心锁，未锁定=开锁（简单 SVG） */}
            <svg
              viewBox="0 0 20 20"
              className={`lock-svg h-3.5 w-3.5 ${locked ? 'lock-svg-active' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4.5" y="8.5" width="11" height="7" rx="1.5" />
              <path d={locked ? 'M7 8.5V6a3 3 0 0 1 6 0v2.5' : 'M7 8.5V6a3 3 0 0 1 5.5-1.8'} />
              {locked && <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />}
            </svg>
          </button>
        ) : undefined
      }
    >
      {/* 窄卡（grid-cols-3，~128px）适配：三行信息（耗神/炼化/炼耗），字号压缩。 */}
      <div className="divide-y divide-wood-light/35 text-[11px]">
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[9px] text-ink-light shrink-0">耗神</span>
          <span className={`font-bold tabular-nums whitespace-nowrap ${canAfford ? QI_COST_COLOR : 'text-ink-light/40'}`}>
            -{buyCost} 神识
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[9px] text-ink-light shrink-0">炼化</span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
              {holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}修为
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[9px] text-ink-light shrink-0">炼耗</span>
          <span className={`font-bold tabular-nums whitespace-nowrap ${QI_COST_COLOR}`}>
            -{holdQiCost.toFixed(1)}神识
          </span>
        </div>
        {locked && (
          <div className="flex items-center justify-between gap-1 px-2 py-1 bg-amber-50/60">
            <span className="text-[9px] text-amber-700 shrink-0">锁定中</span>
            <span className="font-bold tabular-nums whitespace-nowrap text-amber-700">
              每回合 -5 神识
            </span>
          </div>
        )}
      </div>
    </CardVisual>
  );
}
