import { type JiaziCard, Element, YinYang } from '@core/JiaziCard';
import { isVoidCard } from '@core/VoidCard';
import type { VolatilityTrend } from '@core/ScoreVolatility';

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

type ScoreDisplayMode = 'market' | 'position';

interface CardVisualProps {
  card: JiaziCard;
  score: number;
  nextScore?: number;
  /** market=公共牌的季节/实际波动视图；position=手牌的纳灵/当前评分视图。 */
  scoreMode?: ScoreDisplayMode;
  /** 手牌纳灵时记录的评分；仅 position 模式使用。 */
  buyScore?: number;
  selected?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  /** 右上角徽章区域，由 PublicCard/HandCard 各自填充 */
  badges?: React.ReactNode;
  /** 评分标签行右侧徽章（如杠杆倍率），由 HandCard 注入 */
  scoreBadge?: React.ReactNode;
  /** 实验模式下当前相对基础评分的实际波动值；只用于公共牌。 */
  volatilityDelta?: number;
  /** 趋势窗口方向（rising/falling/steady）；只用于公共牌。 */
  volatilityTrend?: VolatilityTrend;
  /** 底部信息区域，由 PublicCard/HandCard 各自填充 */
  children?: React.ReactNode;
}

/**
 * 卡牌共用视觉层：牌名（干支按五行着色）、阴阳徽章、评分与实际波动提示。
 * 公共牌和手牌的评分口径通过 scoreMode 区分，底部持有信息仍由 children 注入。
 */
export function CardVisual({ card, score, nextScore, scoreMode = 'market', buyScore, selected, highlight, onClick, badges, scoreBadge, volatilityDelta, volatilityTrend, children }: CardVisualProps) {
  const yinYangChar = card.yinYang === YinYang.YANG ? '阳' : '阴';
  const baseBorder = elementBorder[card.mainElement];
  const positionView = scoreMode === 'position' && buyScore !== undefined;
  const volatilityActive = !positionView && volatilityDelta !== undefined;
  const volatilityDeltaMeta = volatilityDelta === undefined
    ? null
    : {
        text: `${volatilityDelta >= 0 ? '+' : ''}${volatilityDelta.toFixed(0)}`,
        className: volatilityDelta > 0
          ? 'text-qi-full'
          : volatilityDelta < 0
            ? 'text-qi-critical'
            : 'text-ink-light',
      };
  const trendMeta = volatilityTrend === undefined || volatilityTrend === null
    ? null
    : volatilityTrend === 'rising'
      ? { symbol: '↑', className: 'text-emerald-600', title: '趋势上升' }
      : volatilityTrend === 'falling'
        ? { symbol: '↓', className: 'text-red-500', title: '趋势下降' }
        : { symbol: '—', className: 'text-ink-light/50', title: '趋势平稳' };

  // V5 空亡牌专属视觉（票 07）：暗色虚空风格，一眼区分于五行元素牌。
  // 纯事件牌——不显示评分（恒为 0）、不显示耗神/炼化/炼耗等持有信息（不可买入），
  // 仅保留牌名 + 虚空标记 + 锁定按钮（LockManager 按 id 操作，锁定保留期不重复触发）。
  if (isVoidCard(card)) {
    return (
      <div
        onClick={onClick}
        data-selected={selected ? 'true' : 'false'}
        className={`
          card-in card-void relative overflow-hidden rounded-lg border-2 cursor-pointer select-none
          transition-all duration-150 min-w-0
          border-slate-700 bg-slate-900/90 text-parchment
          ${selected
            ? 'border-slate-300 shadow-lg scale-[1.02] -translate-y-0.5'
            : 'hover:shadow-sm hover:border-slate-500'
          }
        `}
      >
        {/* 牌名：空亡（虚空暗色，不按五行着色） */}
        <div className="flex items-center justify-between gap-1 px-2 pt-1.5 pb-1">
          <span className="text-base max-md:text-[15px] leading-none font-bold truncate min-w-0 text-slate-100">
            {card.name}
          </span>
          <div className="flex gap-1 shrink-0">
            <span
              className="text-[10px] max-md:text-[9px] px-1.5 py-0.5 rounded font-bold bg-slate-700 text-slate-300"
              title="空亡 · 纯事件牌"
            >
              ☰ 空亡
            </span>
            {badges}
          </div>
        </div>

        {/* 虚空体：隐藏评分与持有信息，只传达「时间吞噬」意象 */}
        <div className="border-y border-slate-700/70 bg-slate-800/50 px-2 py-2 text-center">
          <span className="text-[10px] max-md:text-[9px] font-bold tracking-widest text-slate-400">
            时间吞噬 · 非交易品
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      data-selected={selected ? 'true' : 'false'}
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

      {/* 公共牌显示市场当前分与实际波动值；手牌改显示纳灵评分与当前评分，
          让两类卡片分别服务于“要不要纳灵”和“要不要释灵”。 */}
      <div className="card-score-trend flex items-end justify-between gap-1 border-y border-wood-light/35 bg-white/35 px-2 py-1.5 max-md:py-1">
        <div className="min-w-0 flex-1">
          <span
            className="card-score-label block text-[10px] max-md:text-[9px] leading-tight text-ink-light"
            data-volatility-score={volatilityActive ? 'current' : undefined}
            title={positionView ? '手牌对应显示纳灵时评分与当前评分' : volatilityActive ? '当前评分已包含短期波动；换季后会重新计算' : undefined}
          >
            {positionView ? '纳灵评分 → 当前评分' : volatilityActive ? '当前评分' : '当季 → 下季评分'}
          </span>
          {positionView ? (
            <div
              className="flex items-baseline gap-1"
              data-position-score
              aria-label={`纳灵评分 ${buyScore! >= 0 ? '+' : ''}${buyScore!.toFixed(1)}，当前评分 ${score >= 0 ? '+' : ''}${score.toFixed(1)}`}
              title={`纳灵评分 ${buyScore! >= 0 ? '+' : ''}${buyScore!.toFixed(1)} → 当前评分 ${score >= 0 ? '+' : ''}${score.toFixed(1)}；释灵收益请查看结算预览`}
            >
              <span className="card-score-value text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap text-ink">
                {buyScore! >= 0 ? '+' : ''}{buyScore!.toFixed(1)}
              </span>
              <span className="mx-0.5 text-ink-light/50">→</span>
              <span className={`card-score-value text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap ${elementScoreColor[card.mainElement]}`}>
                {score >= 0 ? '+' : ''}{score.toFixed(1)}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className={`card-score-value text-[14px] max-md:text-[13px] leading-tight font-bold tabular-nums whitespace-nowrap ${elementScoreColor[card.mainElement]}`}>
                {score >= 0 ? '+' : ''}{score.toFixed(1)}
                {!volatilityActive && nextScore !== undefined && <><span className="mx-0.5 text-ink-light/50">→</span>{nextScore >= 0 ? '+' : ''}{nextScore.toFixed(1)}</>}
              </span>
              {volatilityActive && volatilityDeltaMeta && (
                <span
                  data-volatility-delta
                  aria-label={`相对基础评分 ${volatilityDeltaMeta.text}`}
                  title="相对基础评分的实际变化"
                  className={`text-[10px] max-md:text-[9px] font-bold leading-none whitespace-nowrap ${volatilityDeltaMeta.className}`}
                >
                  ({volatilityDeltaMeta.text})
                </span>
              )}
              {volatilityActive && trendMeta && (
                <span
                  data-volatility-trend
                  title={trendMeta.title}
                  className={`text-[11px] max-md:text-[10px] font-bold leading-none ${trendMeta.className}`}
                >
                  {trendMeta.symbol}
                </span>
              )}
              {scoreBadge}
            </div>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
