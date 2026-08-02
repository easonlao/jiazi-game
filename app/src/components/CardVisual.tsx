import { type JiaziCard, Element, YinYang } from '@core/JiaziCard';

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
  /** 底部信息区域，由 PublicCard/HandCard 各自填充 */
  children?: React.ReactNode;
}

/**
 * 卡牌共用视觉层：牌名（干支按五行着色）、阴阳徽章、当季→下季评分趋势。
 * 公共牌和手牌的差异（买入成本 vs 累计收益等）通过 badges 和 children 注入。
 */
export function CardVisual({ card, score, nextScore, selected, highlight, onClick, badges, children }: CardVisualProps) {
  const yinYangChar = card.yinYang === YinYang.YANG ? '阳' : '阴';
  const baseBorder = elementBorder[card.mainElement];

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
        <span className="text-base leading-none font-bold truncate">
          <span className={elementScoreColor[card.tianGanElement]}>{card.tianGan}</span>
          <span className={elementScoreColor[card.diZhiElement]}>{card.diZhi}</span>
        </span>
        <div className="flex gap-1 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            card.yinYang === YinYang.YANG
              ? 'bg-orange-500 text-white'
              : 'bg-violet-500 text-white'
          }`} title={card.yinYang === YinYang.YANG ? '阳 · 波动较大' : '阴 · 较稳'}>
            {yinYangChar}
          </span>
          {badges}
        </div>
      </div>

      {/* 当前→下季价值：与结算预览使用同一评分口径。
          字号按视口宽度响应：小屏 text-base、防换行；中屏 text-lg；宽屏 text-xl 强调。 */}
      <div className="card-score-trend flex items-end justify-between gap-1 border-y border-wood-light/35 bg-white/35 px-2 py-1">
        <div className="min-w-0 flex-1">
          <span className="card-score-label block text-[10px] leading-none text-ink-light">当季 → 下季评分</span>
          <span className={`card-score-value text-base sm:text-lg md:text-xl leading-tight font-bold tabular-nums whitespace-nowrap ${elementScoreColor[card.mainElement]}`}>
            {score >= 0 ? '+' : ''}{score.toFixed(1)}
            {nextScore !== undefined && <><span className="mx-0.5 text-ink-light/50">→</span>{nextScore >= 0 ? '+' : ''}{nextScore.toFixed(1)}</>}
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}
