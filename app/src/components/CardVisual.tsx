import { type JiaziCard, Element, YinYang } from '@core/JiaziCard';
import type { VolatilityTrend } from '@core/index';

const elementBorder: Record<Element, string> = {
  [Element.WOOD]: 'border-emerald-400 bg-emerald-50/50',
  [Element.FIRE]: 'border-red-400 bg-red-50/50',
  [Element.EARTH]: 'border-amber-400 bg-amber-50/50',
  [Element.METAL]: 'border-slate-400 bg-slate-50/50',
  [Element.WATER]: 'border-sky-400 bg-sky-50/50',
};

const elementScoreColor: Record<Element, string> = {
  [Element.WOOD]: 'text-emerald-700',
  [Element.FIRE]: 'text-red-700',
  [Element.EARTH]: 'text-amber-700',
  [Element.METAL]: 'text-slate-700',
  [Element.WATER]: 'text-sky-700',
};

export { elementBorder, elementScoreColor };

interface CardVisualProps {
  card: JiaziCard;
  score: number;
  nextScore?: number;
  selected?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  /** 右上角徽章区域，由 PublicCard/HandCard 各自填充 */
  badges?: React.ReactNode;
  /** 评分标签行右侧徽章（如杠杆倍率），由 HandCard 注入 */
  scoreBadge?: React.ReactNode;
  /** 实验模式下的季内短期趋势；只显示方向，不显示幅度。 */
  volatilityTrend?: VolatilityTrend;
  /** 底部信息区域，由 PublicCard/HandCard 各自填充 */
  children?: React.ReactNode;
}

/**
 * 卡牌共用视觉层：牌名（干支按五行着色）、阴阳徽章、评分与短期波动提示。
 * 公共牌和手牌的差异（买入成本 vs 累计收益等）通过 badges 和 children 注入。
 */
export function CardVisual({ card, score, nextScore, selected, highlight, onClick, badges, scoreBadge, volatilityTrend, children }: CardVisualProps) {
  const yinYangChar = card.yinYang === YinYang.YANG ? '阳' : '阴';
  const baseBorder = elementBorder[card.mainElement];
  const volatilityActive = volatilityTrend !== undefined;
  const trendMeta = volatilityTrend === 'rising'
    ? { text: '波动↑', label: '短期波动上行', className: 'text-qi-full' }
    : volatilityTrend === 'falling'
      ? { text: '波动↓', label: '短期波动下行', className: 'text-qi-critical' }
      : volatilityTrend === 'steady'
        ? { text: '波动稳', label: '短期波动平稳', className: 'text-ink-light' }
        : null;

  return (
    <div
      onClick={onClick}
      className={`
        card-in relative overflow-hidden rounded-lg border-2 cursor-pointer select-none
        transition-all duration-150 min-w-0
        ${selected
          ? 'border-ink shadow-lg scale-[1.02] -translate-y-0.5 bg-parchment'
          : highlight
            ? 'border-qi-full bg-green-50 shadow-sm'
            : `${baseBorder} hover:shadow-sm`
        }
      `}
    >
      {/* 牌名本身编码干支五行：天干、地支各自按所属元素着色 */}
      <div className="flex items-center justify-between gap-1 px-2 pt-1.5 pb-0.5">
        <span className="text-base max-md:text-[15px] leading-none font-bold truncate min-w-0">
          <span className={elementScoreColor[card.tianGanElement]}>{card.tianGan}</span>
          <span className={elementScoreColor[card.diZhiElement]}>{card.diZhi}</span>
        </span>
        <div className="flex gap-1 shrink-0">
          <span className={`text-[10px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold ${
            card.yinYang === YinYang.YANG
              ? 'bg-orange-500 text-white'
              : 'bg-violet-500 text-white'
          }`} title={card.yinYang === YinYang.YANG ? '阳 · 波动较大' : '阴 · 较稳'}>
            {yinYangChar}
          </span>
          {badges}
        </div>
      </div>

      {/* 普通模式显示确定的季节基准变化；波动模式只显示已含短期波动的当前分，
          避免把未来基础分和当前波动方向拼成一条误导性的“预测箭头”。 */}
      <div className="card-score-trend flex items-end justify-between gap-1 border-y border-wood-light/35 bg-white/35 px-2 py-1.5 max-md:py-1">
        <div className="min-w-0 flex-1">
          <span
            className="card-score-label block text-[10px] max-md:text-[9px] leading-tight text-ink-light"
            data-volatility-score={volatilityActive ? 'current' : undefined}
            title={volatilityActive ? '当前评分已包含短期波动；换季后会重新计算' : undefined}
          >
            {volatilityActive ? '当前评分' : '当季 → 下季评分'}
          </span>
          <div className="flex items-baseline gap-1">
            <span className={`card-score-value text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap ${elementScoreColor[card.mainElement]}`}>
              {score >= 0 ? '+' : ''}{score.toFixed(1)}
              {!volatilityActive && nextScore !== undefined && <><span className="mx-0.5 text-ink-light/50">→</span>{nextScore >= 0 ? '+' : ''}{nextScore.toFixed(1)}</>}
            </span>
            {volatilityActive && trendMeta && (
              <span
                data-volatility-trend={volatilityTrend}
                aria-label={trendMeta.label}
                title={trendMeta.label}
                className={`text-[10px] max-md:text-[9px] font-bold leading-none whitespace-nowrap ${trendMeta.className}`}
              >
                {trendMeta.text}
              </span>
            )}
            {scoreBadge}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
