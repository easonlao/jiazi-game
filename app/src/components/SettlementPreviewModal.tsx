import { useGameStore } from '../store';
import { buildProjectedHoldings } from '@core/index';

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/**
 * 行动确认弹窗（本回合/下回合双层结构，2026-08-06 恢复信息量）。
 *
 * 信息边界契约（docs/ui-information-boundary.md）"结算窗口双层结构"：
 * - 本回合账单层（上半）：上一结算的持仓炼化 +X/-Y、回气、锁定费、本次行动消耗，
 *   全部是确定值（来自 lastSettlement + 当前行动）。
 * - 下回合一览层（下半）：下回合推演——持仓炼化/耗神（假设不换季口径）、下回合回气、反噬候选，
 *   固定标注"推演"；不触碰 isSeasonEnd，不泄露换季。
 */
export function SettlementPreviewModal() {
  const preview = useGameStore((s) => s.settlementPreview);
  const turnManager = useGameStore((s) => s.turnManager);
  const publicCards = useGameStore((s) => s.publicCards);
  const lastSettlement = useGameStore((s) => s.lastSettlement);
  const hand = useGameStore((s) => s.hand);
  const cancel = useGameStore((s) => s.cancelSettlementPreview);
  const confirm = useGameStore((s) => s.confirmSettlementPreview);

  if (!preview) return null;

  const targetLabel = preview.actionCardName ? `：${preview.actionCardName}` : '';
  const actionLabel = preview.action.type === 'buy'
    ? `纳灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
    : preview.action.type === 'sell'
      ? `释灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
      : '调息';

  // ── 本回合账单（来自上一结算）──────────────────────────────────

  // 本回合账单数据
  const scoreBeforeAction = preview.scoreAfterAction - preview.actionScoreChange;
  const scoreAfterAction = preview.scoreAfterAction;
  const qiBeforeAction = preview.qiAfterAction - preview.actionQiChange;
  const qiAfterAction = preview.qiAfterAction;

  // 上一结算的持仓明细
  const factHoldItems = lastSettlement?.holdItems ?? [];
  const factHoldEarnings = lastSettlement?.holdEarnings ?? 0;
  const factHoldQiCost = lastSettlement?.holdQiCost ?? 0;
  const factBaseQiRecover = lastSettlement?.baseQiRecover ?? 0;
  const factWaitQiRecover = lastSettlement?.waitQiRecover ?? 0;

  // ── 下回合一览（假设不换季推演）──────────────────────────
  // 预期手牌投影（含纳灵预览将入手的新牌、剔除释灵预览将卖出的牌），由 core 层
  // buildProjectedHoldings 统一计算（单一来源，避免与 previewSettlement 的 virtualHand 漂移）。
  const projectedHold = turnManager
    ? buildProjectedHoldings(turnManager, hand, preview.action, publicCards, preview.actionUsesLeverage)
    : [];
  const projectedEarnings = projectedHold.reduce((sum, s) => sum + s.earning, 0);
  const projectedQiCost = projectedHold.reduce((sum, s) => sum + s.qiCost, 0);
  const projectedLeverageCount = projectedHold.filter((s) => s.isLeverage).length;

  const hasProjection =
    projectedHold.length > 0 || preview.action.type === 'wait';

  // 调息预览：手牌结构无变化，本回合与下回合一览持仓明细语义重复——
  // 推演层只显示总额与"与本回合一致"标注，隐藏重复明细；保留反噬预警与回气推演。
  const isWaitUnchangedHoldings =
    preview.action.type === 'wait' &&
    factHoldItems.length > 0 &&
    factHoldItems.length === projectedHold.length;

  return (
    <div className="modal-backdrop absolute inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm max-h-[90%] overflow-y-auto bg-white rounded-xl shadow-2xl settlement-in">
        <div className="px-4 py-3 bg-ink text-parchment">
          <h3 className="text-base font-bold font-serif">结算预览</h3>
          <p className="text-xs opacity-80 mt-0.5">上半为上一结算账单，下半为下回合一览。返回不会改变局面。</p>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm">
          {/* ═══ 本回合账单 ═══ */}
          <div className="rounded-lg border border-green-600/30 bg-green-50/60 px-3 py-2 text-xs text-ink-light">
            <div className="flex items-center justify-between">
              <span className="font-bold text-green-800">本回合账单</span>
              {factHoldQiCost > 0 && (
                <span className="font-bold tabular-nums">
                  <span className={factHoldEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
                    {signed(factHoldEarnings)}修为
                  </span>
                  <span className="text-sky-600 ml-1">-{factHoldQiCost.toFixed(1)}神识</span>
                </span>
              )}
            </div>

            {/* 持仓炼化明细（已入账） */}
            {factHoldItems.length > 0 ? (
              <div className="mt-1 space-y-0.5 border-t border-green-600/15 pt-1">
                {factHoldItems.map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="truncate pr-2">{item.cardName}{item.leverage > 1 ? ` · ${item.leverage.toFixed(1)}x` : ''}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      <span className={item.earning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
                        {signed(item.earning)}修为
                      </span>
                      <span className="text-sky-600 ml-1">-{item.qiCost.toFixed(1)}神识</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 回气（已入账） */}
            {(factBaseQiRecover > 0 || factWaitQiRecover > 0) && (
              <div className="mt-1 flex justify-between border-t border-green-600/15 pt-1">
                <span>回神（{factWaitQiRecover > 0 ? '含上回合调息奖励' : '自然'}）</span>
                <span className="font-bold tabular-nums text-qi-full">
                  +{(factBaseQiRecover + factWaitQiRecover).toFixed(1)} 神识
                </span>
              </div>
            )}
          </div>

          {/* 本次行动 */}
          <div className="rounded-lg bg-[#faf6ee] border border-wood-light px-3 py-2 text-xs text-ink-light">
            <div className="flex justify-between">
              <span>本次行动</span>
              <span className="font-bold text-ink">{actionLabel}</span>
            </div>
            {!preview.saleBreakdown && (preview.actionQiChange !== 0 || preview.actionScoreChange !== 0) && (
              <div className="flex justify-between mt-1">
                <span>{preview.action.type === 'buy' ? '纳灵消耗' : '行动即时变化'}</span>
                <span>
                  {preview.actionQiChange !== 0 && <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}神识</span>}
                  {preview.actionQiChange !== 0 && preview.actionScoreChange !== 0 && ' · '}
                  {preview.actionScoreChange !== 0 && <span className={preview.actionScoreChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}修为</span>}
                </span>
              </div>
            )}
          </div>

          {/* 修为账单：仅在修为有变化时显示 */}
          {preview.actionScoreChange !== 0 && (
            <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
              <div className="space-y-1 text-ink-light">
                <div className="flex justify-between">
                  <span>当前修为</span>
                  <span className="tabular-nums">{scoreBeforeAction.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{preview.action.type === 'sell' ? '释灵价差' : '行动即时'}</span>
                  <span className={preview.actionScoreChange >= 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}</span>
                </div>
                <div className="flex justify-between border-t border-gold/25 pt-1">
                  <span className="font-medium text-ink">行动后修为</span>
                  <span className="font-bold tabular-nums text-gold">{scoreAfterAction.toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}

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
                <span>神识流转</span>
                <span className="font-bold tabular-nums">
                  <span className="text-qi-full">归还牵神 +{preview.saleBreakdown.lockedQiReturn.toFixed(1)}</span>
                  <span className={preview.saleBreakdown.qiChange >= 0 ? 'ml-1 text-qi-full' : 'ml-1 text-qi-critical'}>
                    净 {signed(preview.saleBreakdown.qiChange)}神识
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
              {/* 神识账单：当前可用 → 扣出本回合使用 → 剩余 */}
              <div className="space-y-1 text-xs text-ink-light">
                <div className="flex justify-between">
                  <span>当前可用神识</span>
                  <span className="tabular-nums">{qiBeforeAction.toFixed(1)}</span>
                </div>
                {preview.actionQiChange !== 0 && (
                  <div className="flex justify-between">
                    <span>{preview.action.type === 'sell' ? '本回合流转（释灵）' : preview.action.type === 'buy' ? '本回合使用（纳灵）' : '行动变化'}</span>
                    <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-wood-light/40 pt-1">
                  <span className="font-medium text-ink">剩余神识</span>
                  <span className={`font-bold tabular-nums ${qiAfterAction <= 0 ? 'text-qi-critical' : 'text-ink'}`}>
                    {qiAfterAction.toFixed(1)}
                  </span>
                </div>
              </div>

              {preview.action.type === 'buy' && preview.actionUsesLeverage && (
                <p className="text-[11px] text-ink-light/80">顺势参考：当季牌性契合、神识充足时再燃灵。燃灵为可选项。</p>
              )}
            </>
          )}

          {/* ═══ 下回合一览 ═══ */}
          {!preview.endsGame && hasProjection && (
            <div className="rounded-lg border border-blue-600/30 bg-blue-50/60 px-3 py-2 text-xs text-ink-light">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-800">下回合一览</span>
                {projectedHold.length > 0 && (
                  <span className="font-bold tabular-nums">
                    <span className={projectedEarnings >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
                      {signed(projectedEarnings)}修为
                    </span>
                    <span className="text-qi-critical ml-1">-{projectedQiCost.toFixed(1)}神识</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-blue-700/70">下回合起每回合结算（按本季延续推演，实际以天时流转为准）。</p>

              {isWaitUnchangedHoldings ? (
                <p className="mt-1 text-[11px] text-blue-700/80">持仓结构与本回合一致，详见上方账单。</p>
              ) : (
                /* 持仓明细（假设不换季；调息无结构变化时折叠，避免与本回合账单重复） */
                projectedHold.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-blue-600/15 pt-1">
                    {projectedHold.map((s, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="truncate pr-2">
                          {s.name}{s.isLeverage ? '（燃灵）' : ''}
                          {s.isNewBuy && <span className="ml-1 text-[10px] text-blue-700 font-bold">新</span>}
                        </span>
                        <span className="tabular-nums whitespace-nowrap">
                          <span className={s.earning >= 0 ? 'text-qi-full' : 'text-qi-critical'}>
                            {signed(s.earning)}修为
                          </span>
                          <span className="text-qi-critical ml-1">-{s.qiCost.toFixed(1)}神识</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* 反噬知情提示（候选 + 构成，不替玩家规避） */}
              {projectedLeverageCount > 0 && (
                <div className="mt-1 border-t border-blue-600/15 pt-1 text-[11px]">
                  <span className="text-blue-700">燃灵持仓 {projectedLeverageCount} 张：神识不足时可能被反噬</span>
                  <span className="text-ink-light/70"> · 反噬扣修为 = 杠杆 × |评分| × 3，被反噬牌无释灵收益</span>
                </div>
              )}

              {/* 下回合回气推演 */}
              <div className="mt-1 flex justify-between border-t border-blue-600/15 pt-1">
                <span>下回合回神（推演）</span>
                <span className="font-bold tabular-nums text-qi-full">
                  +{preview.baseQiRecover.toFixed(1)}{preview.waitQiRecover > 0 ? `（调息再 +${preview.waitQiRecover.toFixed(1)}）` : ''} 神识
                </span>
              </div>
            </div>
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
