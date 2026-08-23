import type { JiaziCard } from '@core/JiaziCard';
import { Element } from '@core/JiaziCard';
import { CardVisual } from './CardVisual';

/** 神识消耗统一色（2026-08-06 issue 01 P3：神识消耗=资源冷色，修为才用红绿） */
const QI_COST_COLOR = 'text-sky-600';

/** 元素中文名（浓度徽标用，与 core JiaziCard 内部映射一致） */
const ELEMENT_CN: Record<Element, string> = {
  [Element.WOOD]: '木',
  [Element.FIRE]: '火',
  [Element.EARTH]: '土',
  [Element.METAL]: '金',
  [Element.WATER]: '水',
};

interface HandCardProps {
  card: JiaziCard;
  slotIndex: number;
  score: number;
  /** 纳灵时记录的评分，用于和当前评分对应展示。 */
  buyScore: number;
  selected?: boolean;
  onClick?: () => void;
  /** 杠杆信息：当前倍数、下回合结算倍数、是否启用 */
  leverage: number;
  settlementLeverage?: number;
  isLeverage: boolean;
  /** 累计持有收益 */
  holdEarnings: number;
  /** 当前回合每回合持有收益/耗神 */
  holdEarning: number;
  holdQiCost: number;
  /** 浓度信息（V7 生效，count ≥2 时显示元素徽标；V6 及以下恒 0） */
  concentration?: { count: number; premium: number };
  /** 卖出预览（仅选中时传入，未选中传 null） */
  sellPreview: { score: number; qiChange: number } | null;
  /** 反噬崩坏：被反噬的丹田槽位播红闪碎裂效果（issue 04，2026-08-05） */
  shattered?: boolean;
}

/**
 * 手牌：三行信息（炼化/炼耗/累计）+ 燃灵发光特效。
 * 燃灵状态用卡片周边红色发光表达，不显示杠杆文字标识。
 * 释灵预览已移至结算弹窗，不在卡面显示。
 */
export function HandCard({
  card,
  slotIndex,
  score,
  buyScore,
  selected,
  onClick,
  leverage,
  settlementLeverage,
  isLeverage,
  holdEarnings,
  holdEarning,
  holdQiCost,
  concentration,
  sellPreview,
  shattered,
}: HandCardProps) {
  return (
    <div
      data-hand-card-slot={slotIndex}
      data-card-name={card.name}
      className={`rounded-lg ${shattered ? 'mc-shatter-slot' : ''}`}
    >
      <CardVisual
        card={card}
        score={score}
        scoreMode="position"
        buyScore={buyScore}
        selected={selected}
        onClick={onClick}
        badges={isLeverage ? (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-qi-critical text-white" title={`燃灵 ${leverage.toFixed(1)}×`}>
            燃
          </span>
        ) : null}
      >
      {/* 窄卡（grid-cols-3，~128px）适配：三行信息（炼化/炼耗/累计），字号压缩。 */}
      <div className="divide-y divide-wood-light/35 text-[11px] max-md:text-[10px]">
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-ink-light shrink-0">炼化</span>
          <span className="font-bold tabular-nums whitespace-nowrap">
            <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
              {holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}修为
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-ink-light shrink-0">炼耗</span>
          <span className="flex items-center gap-1 min-w-0">
            <span className={`font-bold tabular-nums whitespace-nowrap ${QI_COST_COLOR}`}>
              -{holdQiCost.toFixed(1)}神识
            </span>
            {concentration && concentration.premium > 0 && (
              <span
                className="shrink-0 text-[9px] px-1 py-0.5 rounded font-bold bg-amber-100 text-amber-800"
                title={`元素浓度 ${ELEMENT_CN[card.mainElement]}×${concentration.count}：每张 +${concentration.premium} 神识`}
                data-testid="hand-card-concentration"
              >
                {ELEMENT_CN[card.mainElement]}×{concentration.count}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1 max-md:py-0.5">
          <span className="text-[9px] text-ink-light shrink-0">累计炼化</span>
          <span className={`font-bold tabular-nums whitespace-nowrap ${holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
            {holdEarnings >= 0 ? '+' : ''}{holdEarnings.toFixed(1)}修为
          </span>
        </div>
      </div>

      </CardVisual>
    </div>
  );
}
