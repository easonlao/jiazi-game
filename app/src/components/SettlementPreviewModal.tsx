import { useGameStore, seasonDisplay } from '../store';

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function SettlementPreviewModal() {
  const preview = useGameStore((s) => s.settlementPreview);
  const cancel = useGameStore((s) => s.cancelSettlementPreview);
  const confirm = useGameStore((s) => s.confirmSettlementPreview);

  if (!preview) return null;

  const targetLabel = preview.actionCardName ? `：${preview.actionCardName}` : '';
  const scoreBeforeAction = preview.scoreAfterAction - preview.actionScoreChange;
  const estimatedScoreDelta = preview.actionScoreChange + preview.holdEarnings;
  const deterministicTotal = scoreBeforeAction + estimatedScoreDelta;
  const actionLabel = preview.action.type === 'buy'
    ? `买入${targetLabel}${preview.actionUsesLeverage ? '（杠杆仓位）' : ''}`
    : preview.action.type === 'sell'
      ? `卖出${targetLabel}${preview.actionUsesLeverage ? '（杠杆仓位）' : ''}`
      : '等待';

  return (
    <div className="modal-backdrop absolute inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm max-h-[90%] overflow-y-auto bg-white rounded-xl shadow-2xl settlement-in">
        <div className="px-4 py-3 bg-ink text-parchment">
          <h3 className="text-base font-bold font-serif">本回合结算预览</h3>
          <p className="text-xs opacity-80 mt-0.5">确认后才会提交行动；返回不会改变当前局面。</p>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm">
          <div className="rounded-lg bg-[#faf6ee] border border-wood-light px-3 py-2 text-xs text-ink-light">
            <div className="flex justify-between">
              <span>本次行动</span>
              <span className="font-bold text-ink">{actionLabel}</span>
            </div>
            {!preview.saleBreakdown && (preview.actionQiChange !== 0 || preview.actionScoreChange !== 0) && (
              <div className="flex justify-between mt-1">
                <span>{preview.action.type === 'buy' ? '买入消耗' : '行动即时变化'}</span>
                <span>
                  {preview.actionQiChange !== 0 && <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}气</span>}
                  {preview.actionQiChange !== 0 && preview.actionScoreChange !== 0 && ' · '}
                  {preview.actionScoreChange !== 0 && <span className={preview.actionScoreChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}分</span>}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-ink-light">本回合预计得分增量</span>
              <span className={`font-bold tabular-nums ${estimatedScoreDelta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
                {signed(estimatedScoreDelta)}分
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-gold/20 pt-1">
              <span className="text-ink-light">{preview.willMarginCall ? '强平前累计总分' : '预计累计总分'}</span>
              <span className="font-bold tabular-nums text-gold">
                {preview.finalScore !== null ? preview.finalScore.toFixed(1) : deterministicTotal.toFixed(1)} 分
              </span>
            </div>
            {preview.willMarginCall && (
              <p className="mt-1 text-[10px] text-qi-critical">强平扣分取决于随机平仓仓位，最终总分将在结算后确定。</p>
            )}
          </div>

          {preview.saleBreakdown && (
            <div className="rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2 text-xs text-ink-light space-y-1.5">
              <div className="flex items-center justify-between">
                <span>实现价差</span>
                <span className="font-bold tabular-nums">
                  买入 {signed(preview.saleBreakdown.buyScore)}
                  <span className="mx-1 text-wood-light">→</span>
                  当前 {signed(preview.saleBreakdown.currentScore)}
                  {preview.saleBreakdown.leverage > 1 && ` · ${preview.saleBreakdown.leverage.toFixed(1)}x`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>价差结算</span>
                <span className={preview.saleBreakdown.scoreChange >= 0 ? 'font-bold text-qi-full' : 'font-bold text-qi-critical'}>
                  {signed(preview.saleBreakdown.scoreChange)}分
                </span>
              </div>
              <div className="flex justify-between border-t border-wood-light/35 pt-1.5">
                <span>气量流转</span>
                <span className="font-bold tabular-nums">
                  <span className="text-qi-full">保证金 +{preview.saleBreakdown.lockedQiReturn.toFixed(1)}</span>
                  <span className="mx-1 text-wood-light">·</span>
                  <span className="text-qi-critical">退出费 -{preview.saleBreakdown.exitCost.toFixed(1)}</span>
                  <span className={preview.saleBreakdown.qiChange >= 0 ? 'ml-1 text-qi-full' : 'ml-1 text-qi-critical'}>
                    净 {signed(preview.saleBreakdown.qiChange)}气
                  </span>
                </span>
              </div>
            </div>
          )}

          {preview.endsGame ? (
            <div className="rounded-lg border border-qi-critical/40 bg-red-50 px-3 py-2 text-xs text-red-800">
              <p className="font-bold">第 60 回合：确认后结束游戏</p>
              <p className="mt-1">不会进入下一回合，也不会再进行持仓结算或回气。</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-ink-light">
                <span>下一回合结算</span>
                <span>第 {preview.nextRound} 回合 · {seasonDisplay(preview.nextSeason!)}季内第 {preview.nextRoundInSeason} 回合 · 杠杆 {preview.settlementLeverage!.toFixed(1)}x</span>
              </div>

              {preview.holdItems.length > 0 && (
                <div>
                  <h4 className="font-bold text-ink mb-1">预计持仓结算</h4>
                  {preview.holdItems.map((item, index) => (
                    <div key={`${item.cardName}-${index}`} className="flex justify-between text-xs text-ink-light py-0.5 border-b border-wood-light/30">
                      <span>{item.cardName}{item.leverage > 1 ? ` (${item.leverage}x)` : ''}</span>
                      <span className="flex gap-2">
                        <span className={item.earning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(item.earning)}分</span>
                        <span className="text-qi-critical">-{item.qiCost.toFixed(1)}气</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-bold mt-1">
                    <span>持仓合计</span>
                    <span className="flex gap-2">
                      <span className={preview.holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.holdEarnings)}分</span>
                      <span className="text-qi-critical">-{preview.holdQiCost.toFixed(1)}气</span>
                    </span>
                  </div>
                </div>
              )}
            {preview.action.type === 'buy' && preview.actionUsesLeverage && (
              <p className="mt-1 text-[11px] text-ink-light/80">顺势参考：下季高于当季，且气量充足时再开。杠杆为可选项。</p>
            )}

              <div className="space-y-1 text-xs text-ink-light">
                <div className="flex justify-between"><span>行动后气</span><span>{preview.qiAfterAction.toFixed(1)}气</span></div>
                <div className="flex justify-between"><span>扣除持仓气耗后</span><span className={preview.qiAfterHold! <= 0 ? 'text-qi-critical font-bold' : ''}>{preview.qiAfterHold!.toFixed(1)}气</span></div>
                <div className="flex justify-between"><span>自然回气（每回合）</span><span className="text-qi-full">+{preview.baseQiRecover.toFixed(1)}气</span></div>
                {preview.waitQiRecover > 0 && (
                  <div className="flex justify-between"><span>等待奖励（下回合）</span><span className="text-qi-full">+{preview.waitQiRecover.toFixed(1)}气</span></div>
                )}
              </div>

              {preview.willMarginCall ? (
                <div className="rounded-lg border-2 border-qi-critical bg-red-50 px-3 py-2 text-xs text-red-800">
                  <p className="font-bold">⚠️ 将触发强平</p>
                  <p className="mt-1">扣除持仓气耗后气量归零；系统会随机强平一张杠杆仓位，因此最终气与分数无法在行动前确定。</p>
                  <p className="mt-1">强平候选：{preview.marginCallCandidateNames.join('、')}</p>
                </div>
              ) : (
                <div className="flex justify-between border-t border-wood-light/50 pt-2 text-sm font-bold">
                  <span>预计结算后</span>
                  <span className="flex gap-3"><span>气 {preview.finalQi!.toFixed(1)}</span><span>分 {preview.finalScore!.toFixed(1)}</span></span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <button onClick={cancel} className="py-2 rounded-lg border border-wood-mid text-wood-dark text-sm font-bold hover:bg-wood-light/20 transition-colors">返回修改</button>
          <button onClick={confirm} className="py-2 rounded-lg bg-ink text-parchment text-sm font-bold hover:bg-wood-dark transition-colors">确认结束本回合</button>
        </div>
      </div>
    </div>
  );
}
