import { JiaziCard, Element, YinYang } from '@core/JiaziCard';

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

interface CardProps {
  card: JiaziCard;
  score: number;
  nextScore?: number;
  selected?: boolean;
  onClick?: () => void;
  handInfo?: {
    buyScore: number;
    leverage: number;
    isLeverage: boolean;
    holdEarnings: number;
    profit: number;
  };
  buyCost?: number;
  canAfford?: boolean;
  sellPreview?: { score: number; qiChange: number } | null;
  highlight?: boolean;
  holdEarning?: number;
  holdQiCost?: number;
}

export function Card({ card, score, nextScore, selected, onClick, handInfo, buyCost, canAfford, sellPreview, highlight, holdEarning, holdQiCost }: CardProps) {
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
      <div className="flex items-center justify-between gap-1 px-2.5 pt-2 pb-1">
        <span className="text-lg leading-none font-bold truncate">
          <span className={elementScoreColor[card.tianGanElement]}>{card.tianGan}</span>
          <span className={elementScoreColor[card.diZhiElement]}>{card.diZhi}</span>
        </span>
        <div className="flex gap-1 shrink-0">
          <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${
            card.yinYang === YinYang.YANG
              ? 'bg-orange-500 text-white'
              : 'bg-violet-500 text-white'
          }`}>
            {yinYangChar} · {card.yinYang === YinYang.YANG ? '波动较大' : '较稳'}
          </span>
        </div>
      </div>

      {/* 当前→下季价值：与结算预览使用同一评分口径 */}
      <div className="flex items-end justify-between gap-2 border-y border-wood-light/35 bg-white/35 px-2.5 py-1.5">
        <div>
          <span className="block text-[10px] leading-none text-ink-light">当季 → 下季评分</span>
          <span className={`text-xl leading-tight font-bold tabular-nums ${elementScoreColor[card.mainElement]}`}>
            {score >= 0 ? '+' : ''}{score.toFixed(1)}
            {nextScore !== undefined && <><span className="mx-1 text-ink-light/50">→</span>{nextScore >= 0 ? '+' : ''}{nextScore.toFixed(1)}</>}
          </span>
        </div>
        {handInfo && (
          <div className="flex flex-col items-end gap-1 text-[10px] leading-none text-ink-light">
            {handInfo.isLeverage && (
              <span className="rounded bg-qi-critical/10 px-1.5 py-1 text-qi-critical font-bold tabular-nums">
                杠杆 ×{handInfo.leverage.toFixed(1)}
              </span>
            )}
            <span>买入评分 {handInfo.buyScore.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* 公共牌：把买入与持有后的结果并排，方便做选择 */}
      {!handInfo && (buyCost !== undefined || (holdEarning !== undefined && holdQiCost !== undefined)) && (
        <div className="grid grid-cols-2 divide-x divide-wood-light/35 text-xs">
          <div className="px-2.5 py-1.5">
            <span className="block text-[10px] text-ink-light">买入成本</span>
            {buyCost !== undefined && (
              <span className={`font-bold tabular-nums ${canAfford ? 'text-qi-full' : 'text-qi-critical'}`}>
                -{buyCost} 气
              </span>
            )}
          </div>
          <div className="px-2.5 py-1.5">
            <span className="block text-[10px] text-ink-light">每回合持有</span>
            {holdEarning !== undefined && holdQiCost !== undefined && (
              <span className="whitespace-nowrap font-bold tabular-nums">
                <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}分</span>
                <span className="ml-1 text-qi-critical">-{holdQiCost.toFixed(1)}气</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 手牌：持有结果与累计收益分栏，不再与买入参考值混排 */}
      {handInfo && (
        <div className="grid grid-cols-2 divide-x divide-wood-light/35 text-xs">
          <div className="px-2.5 py-1.5">
            <span className="block text-[10px] text-ink-light">每回合持有</span>
            {holdEarning !== undefined && holdQiCost !== undefined && (
              <span className="whitespace-nowrap font-bold tabular-nums">
                <span className={holdEarning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{holdEarning >= 0 ? '+' : ''}{holdEarning.toFixed(1)}分</span>
                <span className="ml-1 text-qi-critical">-{holdQiCost.toFixed(1)}气</span>
              </span>
            )}
          </div>
          <div className="px-2.5 py-1.5">
            <span className="block text-[10px] text-ink-light">累计持有</span>
            <span className={handInfo.holdEarnings >= 0 ? 'font-bold tabular-nums text-qi-full' : 'font-bold tabular-nums text-qi-critical'}>
              {handInfo.holdEarnings >= 0 ? '+' : ''}{handInfo.holdEarnings.toFixed(1)}分
            </span>
          </div>
        </div>
      )}

      {/* 只有选中手牌时才展示卖出结果，保持日常牌面干净 */}
      {sellPreview && (
        <div className="mx-2.5 mb-2 mt-1.5 flex items-center justify-between rounded bg-white/60 px-2 py-1 text-[10px]">
          <span className="text-ink-light">卖出结算</span>
          <span className="font-bold tabular-nums">
            <span className={sellPreview.score >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{sellPreview.score >= 0 ? '+' : ''}{sellPreview.score.toFixed(1)}分</span>
            <span className="ml-1.5 text-ink-light">气{sellPreview.qiChange >= 0 ? '+' : ''}{sellPreview.qiChange.toFixed(1)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
