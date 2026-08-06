import type { JiaziCard } from '@core/JiaziCard';
import { CardVisual } from './CardVisual';

interface HandCardProps {
  card: JiaziCard;
  score: number;
  nextScore?: number;
  selected?: boolean;
  onClick?: () => void;
  /** 杠杆信息：当前倍数、下回合结算倍数、是否启用 */
  leverage: number;
  settlementLeverage?: number;
  isLeverage: boolean;
  /** 累计持有收益 */
  holdEarnings: number;
  /** 当前回合每回合持有收益/气耗 */
  holdEarning: number;
  holdQiCost: number;
  /** 卖出预览（仅选中时传入，未选中传 null） */
  sellPreview: { score: number; qiChange: number } | null;
  /** 反噬崩坏：被反噬的丹田槽位播红闪碎裂效果（issue 04，2026-08-05） */
  shattered?: boolean;
}

/**
 * 手牌：燃灵徽章 + 每回合炼化 + 累计炼化 + 释灵预览。
 * 不显示买入成本（那是公共牌的职责）。
 */
export function HandCard({
  card,
  score,
  nextScore,
  selected,
  onClick,
  leverage,
  settlementLeverage,
  isLeverage,
  holdEarnings,
  holdEarning,
  holdQiCost,
  sellPreview,
  shattered,
}: HandCardProps) {
  const leverageBadge = (
    <span
      className={`text-[9px] px-1 py-0.5 rounded font-bold whitespace-nowrap ${isLeverage ? 'bg-qi-critical text-white' : 'bg-white/75 text-ink-light border border-wood-light'}`}
      title={isLeverage ? `当前燃灵 ${leverage.toFixed(1)}×；若继续本季，杠杆将爬升至 ${settlementLeverage !== undefined ? settlementLeverage.toFixed(1) : leverage.toFixed(1)}×（提醒）` : '未燃灵，按 1.0× 结算'}
      aria-label={isLeverage
        ? `燃灵 ${leverage.toFixed(1)}×${settlementLeverage !== undefined && settlementLeverage > leverage ? `，若继续本季 ${settlementLeverage.toFixed(1)}×（提醒）` : ''}`
        : '燃灵未启用，当前按 1.0× 结算'}
    >
      杆 {leverage.toFixed(1)}×
      {isLeverage && settlementLeverage !== undefined && settlementLeverage > leverage && (
        <span className="ml-0.5">→{settlementLeverage.toFixed(1)}×</span>
      )}
    </span>
  );

  return (
    <div className={shattered ? 'mc-shatter-slot' : undefined}>
      <CardVisual
        card={card}
        score={score}
        nextScore={nextScore}
        selected={selected}
        onClick={onClick}
        badges={leverageBadge}
      >
      {/* 上下堆叠：每行 label + 值独享整行，避免窄屏文字被截断。 */}
      <div className="divide-y divide-wood-light/35 text-xs">
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[10px] text-ink-light shrink-0">每回合炼化</span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
              {holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}分
            </span>
            <span className="ml-1.5 text-qi-critical">-{holdQiCost.toFixed(1)}神识</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <span className="text-[10px] text-ink-light shrink-0">累计炼化</span>
          <span className={`font-bold tabular-nums whitespace-nowrap ${holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
            {holdEarnings >= 0 ? '+' : ''}{holdEarnings.toFixed(1)}分
          </span>
        </div>
      </div>

      {/* 只有选中手牌时才展示释灵结果，保持日常牌面干净 */}
      {sellPreview && (
        <div className="mx-2 mb-1.5 mt-1 flex items-center justify-between rounded bg-white/60 px-2 py-1 text-[10px]">
          <span className="text-ink-light">释灵结算</span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            <span className={sellPreview.score >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
              {sellPreview.score >= 0 ? '+' : ''}{sellPreview.score.toFixed(1)}分
            </span>
            <span className="ml-1.5 text-ink-light">神识{sellPreview.qiChange >= 0 ? '+' : ''}{sellPreview.qiChange.toFixed(1)}</span>
          </span>
        </div>
      )}
      </CardVisual>
    </div>
  );
}
