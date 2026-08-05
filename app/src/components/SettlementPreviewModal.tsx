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
    ? `纳灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
    : preview.action.type === 'sell'
      ? `释灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
      : '调息';

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
                <span>{preview.action.type === 'buy' ? '纳灵消耗' : '行动即时变化'}</span>
                <span>
                  {preview.actionQiChange !== 0 && <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}心神</span>}
                  {preview.actionQiChange !== 0 && preview.actionScoreChange !== 0 && ' · '}
                  {preview.actionScoreChange !== 0 && <span className={preview.actionScoreChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}修为</span>}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-ink-light">本回合预计修为增量</span>
              <span className={`font-bold tabular-nums ${estimatedScoreDelta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
                {signed(estimatedScoreDelta)}修为
              </span>
            </div>
            {/* 分层明细：本回合增量 = 行动收益 + 持仓炼化，让玩家看清每一分从哪来 */}
            <div className="mt-1 space-y-0.5 border-t border-gold/20 pt-1 text-[11px] text-ink-light/90">
              <div className="flex justify-between">
                <span>当前修为</span>
                <span className="tabular-nums">{scoreBeforeAction.toFixed(1)}</span>
              </div>
              {preview.actionScoreChange !== 0 && (
                <div className="flex justify-between">
                  <span>{preview.action.type === 'sell' ? '释灵价差' : preview.action.type === 'buy' ? '纳灵即时' : '调息'}</span>
                  <span className={preview.actionScoreChange >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>持仓炼化</span>
                <span className={preview.holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.holdEarnings)}</span>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-gold/25 pt-1">
              <span className="text-ink-light">
                {preview.willMarginCall ? '反噬前修为（含本回合）' : '结算后修为（当前+本回合）'}
              </span>
              <span className="font-bold tabular-nums text-gold">
                {preview.finalScore !== null ? preview.finalScore.toFixed(1) : deterministicTotal.toFixed(1)} 修为
              </span>
            </div>
            {preview.willMarginCall && (
              <p className="mt-1 text-[10px] text-qi-critical">反噬扣修为取决于随机失控的灵气，最终修为将在结算后确定。</p>
            )}
          </div>

          {preview.saleBreakdown && (
            <div className="rounded-lg border border-wood-light bg-[#faf6ee] px-3 py-2 text-xs text-ink-light space-y-1.5">
              <div className="flex items-center justify-between">
                <span>实现价差</span>
                <span className="font-bold tabular-nums">
                  纳灵 {signed(preview.saleBreakdown.buyScore)}
                  <span className="mx-1 text-wood-light">→</span>
                  当前 {signed(preview.saleBreakdown.currentScore)}
                  {preview.saleBreakdown.leverage > 1 && ` · ${preview.saleBreakdown.leverage.toFixed(1)}x`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>价差结算</span>
                <span className={preview.saleBreakdown.scoreChange >= 0 ? 'font-bold text-qi-full' : 'font-bold text-qi-critical'}>
                  {signed(preview.saleBreakdown.scoreChange)}修为
                </span>
              </div>
              <div className="flex justify-between border-t border-wood-light/35 pt-1.5">
                <span>心神流转</span>
                <span className="font-bold tabular-nums">
                  <span className="text-qi-full">归还牵神 +{preview.saleBreakdown.lockedQiReturn.toFixed(1)}</span>
                  <span className="mx-1 text-wood-light">·</span>
                  <span className="text-qi-critical">退出费 -{preview.saleBreakdown.exitCost.toFixed(1)}</span>
                  <span className={preview.saleBreakdown.qiChange >= 0 ? 'ml-1 text-qi-full' : 'ml-1 text-qi-critical'}>
                    净 {signed(preview.saleBreakdown.qiChange)}心神
                  </span>
                </span>
              </div>
            </div>
          )}

          {preview.endsGame ? (
            <div className="rounded-lg border border-qi-critical/40 bg-red-50 px-3 py-2 text-xs text-red-800">
              <p className="font-bold">甲子终了：确认后结束修行</p>
              <p className="mt-1">不会进入下一甲子，也不会再进行炼化结算或回神。</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-ink-light">
                <span>下一回合炼化结算</span>
                {/* 不显示下回合季节名（nextSeason）——会泄露是否换季，破坏信息不完全支柱；只暴露进度与燃灵倍率 */}
                <span>第 {preview.nextRound} 回合 · 季内第 {preview.nextRoundInSeason} 回合 · 燃灵 {preview.settlementLeverage!.toFixed(1)}x</span>
              </div>

              {preview.holdItems.length > 0 && (
                <div>
                  <h4 className="font-bold text-ink mb-1">预计持仓结算</h4>
                  {preview.holdItems.map((item, index) => (
                    <div key={`${item.cardName}-${index}`} className="flex justify-between text-xs text-ink-light py-0.5 border-b border-wood-light/30">
                      <span>{item.cardName}{item.leverage > 1 ? ` (${item.leverage}x)` : ''}</span>
                      <span className="flex gap-2">
                        <span className={item.earning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(item.earning)}修为</span>
                        <span className="text-qi-critical">-{item.qiCost.toFixed(1)}心神</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-bold mt-1">
                    <span>持仓合计</span>
                    <span className="flex gap-2">
                      <span className={preview.holdEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.holdEarnings)}修为</span>
                      <span className="text-qi-critical">-{preview.holdQiCost.toFixed(1)}心神</span>
                    </span>
                  </div>
                </div>
              )}
            {preview.action.type === 'buy' && preview.actionUsesLeverage && (
              <p className="mt-1 text-[11px] text-ink-light/80">顺势参考：下季高于当季，且心神充足时再燃灵。燃灵为可选项。</p>
            )}

              <div className="space-y-1 text-xs text-ink-light">
                <div className="flex justify-between">
                  <span>当前心神</span>
                  <span className="tabular-nums">{preview.qiAfterAction - preview.actionQiChange >= 0 ? (preview.qiAfterAction - preview.actionQiChange).toFixed(1) : '?'}</span>
                </div>
                {preview.actionQiChange !== 0 && (
                  <div className="flex justify-between">
                    <span>{preview.action.type === 'sell' ? '释灵流转' : preview.action.type === 'buy' ? '纳灵消耗' : '行动变化'}</span>
                    <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>行动后</span>
                  <span className="tabular-nums font-medium">{preview.qiAfterAction.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>扣除炼化耗神</span>
                  <span className={preview.holdQiCost > 0 ? 'text-qi-critical' : 'tabular-nums'}>-{preview.holdQiCost.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>炼化耗神后</span>
                  <span className={`tabular-nums ${preview.qiAfterHold! <= 0 ? 'text-qi-critical font-bold' : ''}`}>{preview.qiAfterHold!.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>自然回神（每回合）</span>
                  <span className="text-qi-full">+{preview.baseQiRecover.toFixed(1)}</span>
                </div>
                {preview.waitQiRecover > 0 && (
                  <div className="flex justify-between">
                    <span>调息奖励（下回合）</span>
                    <span className="text-qi-full">+{preview.waitQiRecover.toFixed(1)}</span>
                  </div>
                )}
              </div>

              {preview.willMarginCall ? (
                <div className="rounded-lg border-2 border-qi-critical bg-red-50 px-3 py-2 text-xs text-red-800">
                  <p className="font-bold">⚠️ 将触发反噬</p>
                  <p className="mt-1">扣除炼化耗神后心神归零；燃灵灵气失控反噬（候选：{preview.marginCallCandidateNames.join('、')}），最终心神与修为在行动前无法完全确定。</p>
                  {/* 反噬区间估计：被反噬的燃灵牌其价差结算为负，扣减范围 = 每张候选牌的 |当前评分|×价差系数×倍率（保守宽区间） */}
                  <p className="mt-1 text-[11px] text-red-700/90">预计反噬扣减修为：{preview.marginCallCandidateNames.length} 张候选 · 结算后修为将低于上方数值</p>
                </div>
              ) : (
                <div className="rounded-lg border-2 border-gold/50 bg-gold/10 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">调息后最终</span>
                    <span className="flex gap-4">
                      <span className="tabular-nums font-bold text-ink">
                        心神 <span className={preview.finalQi! <= 0 ? 'text-qi-critical' : 'text-qi-full'}>{preview.finalQi!.toFixed(1)}</span>
                      </span>
                      <span className="tabular-nums font-bold text-ink">
                        修为 <span className="text-gold">{preview.finalScore!.toFixed(1)}</span>
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-light/80">此为回合结束后的状态：已含回神与炼化结算</p>
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
