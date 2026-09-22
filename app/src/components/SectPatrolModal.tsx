import { useGameStore } from '../store';
import { elementBorder, elementScoreColor } from './CardVisual';

export function SectPatrolModal() {
  const pendingBuyback = useGameStore((s) => s.pendingBuyback);
  const acceptSectDemand = useGameStore((s) => s.acceptSectDemand);
  const declineSectDemand = useGameStore((s) => s.declineSectDemand);
  const currentQi = useGameStore((s) => s.qi);

  if (!pendingBuyback) return null;

  const {
    sect,
    card,
    offerPrice,
    qiChange,
    delta,
    curScore,
    buyScore,
    isNegativeYield,
  } = pendingBuyback;

  const elemBorderClass = elementBorder[card.mainElement] ?? 'border-slate-400 bg-slate-50/50';
  const elemColorClass = elementScoreColor[card.mainElement] ?? 'text-slate-700';

  const fullYield = delta > 0 ? Math.round(delta * 6) : 0;
  const retainedBySect = Math.max(0, fullYield - offerPrice);
  const qiDeficit = Math.max(0, 20 - currentQi);
  const backlashScore = qiDeficit * 15;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      data-testid="sect-patrol-modal"
    >
      <div
        className={`relative w-full max-w-md rounded-xl border-2 p-5 text-parchment shadow-2xl ${
          isNegativeYield
            ? 'border-rose-500 bg-gradient-to-b from-stone-950 via-stone-900 to-rose-950/60'
            : 'border-amber-400 bg-gradient-to-b from-stone-950 via-stone-900 to-amber-950/60'
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="text-center">
          <div
            className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border text-2xl shadow-inner ${
              isNegativeYield
                ? 'border-rose-400/50 bg-rose-500/20 text-rose-300'
                : 'border-amber-400/50 bg-amber-500/20 text-amber-300'
            }`}
          >
            {isNegativeYield ? '⚖️' : '⚔️'}
          </div>
          <h3
            className={`font-serif text-lg font-bold ${
              isNegativeYield ? 'text-rose-300' : 'text-amber-300'
            }`}
          >
            【{sect.name}】大能降临 · {isNegativeYield ? '严惩劣气平仓' : '强权低价征辟'}
          </h3>
          <p className="mt-1 text-xs text-stone-300/85 leading-relaxed px-2">
            {isNegativeYield ? (
              <>
                {sect.name}执法长老神念扫过丹田，怒斥你温养的【{card.name}】({sect.elemName})浊气过甚、反噬五行！法旨喝道：
                <span className="text-rose-400 font-bold block mt-0.5">
                  “浊杂之气辱没道统，本座替你强行平仓抹除！扣你账面亏损与神念罚诫！”
                </span>
              </>
            ) : (
              <>
                {sect.name}护法长老神念悍然贯穿你的【活跃丹田】！窥见你正温养天地灵珍【{card.name}】({sect.elemName})，降下天威法旨：
                <span className="text-amber-300 font-bold block mt-0.5">
                  “区区散修，奉交此物，赐你微末仙缘！若敢藏私，必教你道心震荡、神念成灰！”
                </span>
              </>
            )}
          </p>
        </div>

        {/* 搜查命中的卡牌详情 */}
        <div className="mt-3.5 rounded-lg border border-stone-700/80 bg-black/50 p-3 text-xs">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-12 w-10 shrink-0 items-center justify-center rounded border font-serif font-black text-sm shadow ${elemBorderClass} ${elemColorClass}`}
              >
                {card.name}
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-stone-100">
                  {card.name} ({sect.elemName}行 · {card.diZhi}支)
                </span>
                <span
                  className={`text-[11px] font-mono ${
                    delta > 0
                      ? 'text-emerald-400'
                      : delta < 0
                      ? 'text-rose-400'
                      : 'text-stone-300'
                  }`}
                >
                  当季评分: {curScore >= 0 ? '+' : ''}
                  {curScore} (买入: {buyScore} · Δ
                  {delta >= 0 ? `+${delta}` : delta})
                </span>
                <span className="text-[10px] text-amber-300/80">
                  当前槽位：活跃丹田 (气机外泄明牌)
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div
                className={`font-mono text-base font-black ${
                  isNegativeYield ? 'text-rose-400' : 'text-amber-300'
                }`}
              >
                {offerPrice >= 0 ? `+${offerPrice}` : offerPrice} 修为
              </div>
              <div className="text-[10px] text-stone-400">
                {isNegativeYield ? '强制平仓扣除' : '0.6x 强征折价'}
              </div>
            </div>
          </div>

          {/* 处置细则一览 */}
          <div className="mt-2.5 pt-2 border-t border-stone-800 flex flex-col gap-1 text-[11px]">
            {isNegativeYield ? (
              <>
                <div className="flex justify-between text-rose-300">
                  <span>📉 割肉平仓修为变动:</span>
                  <span className="font-mono font-bold text-rose-400">{offerPrice} 修为</span>
                </div>
                <div className="flex justify-between text-rose-300">
                  <span>⚡ 逆气反噬神识惩罚:</span>
                  <span className="font-mono font-bold text-rose-400">{qiChange} 神识</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-stone-300">
                  <span>💰 宗门折算打发:</span>
                  <span className="font-mono font-bold text-amber-300">
                    +{offerPrice} 修为{' '}
                    <span className="text-[10px] text-rose-400/90 font-normal">
                      (被宗门强扣盘剥 -{retainedBySect})
                    </span>
                  </span>
                </div>
                <div className="flex justify-between text-stone-300">
                  <span>🧘 赏赐回神残丹:</span>
                  <span className="font-mono font-bold text-sky-300">+{qiChange} 神识</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 决断操作按钮组 */}
        <div className="mt-4 flex flex-col gap-2">
          {/* 遵从令谕 */}
          <button
            type="button"
            onClick={acceptSectDemand}
            className={`w-full rounded-lg py-2 text-center text-xs font-bold text-white shadow-md transition-all cursor-pointer ${
              isNegativeYield
                ? 'bg-gradient-to-r from-rose-700 to-stone-700 hover:from-rose-600 hover:to-stone-600'
                : 'bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600'
            }`}
          >
            {isNegativeYield
              ? `📉 认罚割肉 · 遵从令谕 (没收卡牌，扣除 ${Math.abs(offerPrice)} 修为与 10 神识)`
              : `🤝 奉交灵牌 · 遵从令谕 (获得 +${offerPrice} 修为，赐 +${qiChange} 神识)`}
          </button>

          {/* 誓死抗命 */}
          <button
            type="button"
            onClick={declineSectDemand}
            className="w-full rounded-lg border border-rose-500/60 bg-stone-950/80 py-2 text-center text-xs font-bold text-rose-300 shadow-md hover:bg-rose-950/40 hover:text-rose-200 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-center gap-1">
              <span>🔥 誓死抗命 · 强留灵牌</span>
            </div>
            <div className="mt-0.5 text-[10px] font-normal text-rose-400/80">
              消耗 20 神识抵御天威
              {qiDeficit > 0 ? (
                <span className="font-bold text-rose-300">
                  （神识仅余 {currentQi}，赤字走火入魔反噬 -{backlashScore} 修为！）
                </span>
              ) : (
                `（当前神识 ${currentQi} 充盈，可安然化解）`
              )}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
