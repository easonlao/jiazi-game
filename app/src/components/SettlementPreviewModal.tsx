import { useGameStore } from '../store';
import type { SettlementDetail } from '@core/index';
import { Element } from '@core/index';

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/**
 * 行动确认弹窗（账单化，2026-08-05 反噬流程重设计 §4）。
 *
 * 只展示"本回合"的确定信息——玩家知道自己当前有多少可用心神、本次行动花多少：
 * - 本次行动消耗（纳灵成本 / 释灵价差 / 调息）
 * - 本回合持仓已扣耗气（上回合结算已发生的事实，账单回溯）
 * - 行动后当前可用心神
 *
 * 不展示任何"下一回合"预测：持仓炼化、结算后修为、回神、反噬预警全部移除——
 * 设计意图：移除"系统替玩家算未来"，杠杆倍率爬升（耗气增大）回到玩家认知管理，
 * 反噬恢复为真实风险（详见 docs/analysis/game/margin-call-redesign-2026-08-05.md）。
 */
export function SettlementPreviewModal() {
  const preview = useGameStore((s) => s.settlementPreview);
  const lastSettlement = useGameStore((s) => s.lastSettlement);
  const turnManager = useGameStore((s) => s.turnManager);
  const publicCards = useGameStore((s) => s.publicCards);
  const cancel = useGameStore((s) => s.cancelSettlementPreview);
  const confirm = useGameStore((s) => s.confirmSettlementPreview);

  if (!preview) return null;

  const targetLabel = preview.actionCardName ? `：${preview.actionCardName}` : '';
  const actionLabel = preview.action.type === 'buy'
    ? `纳灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
    : preview.action.type === 'sell'
      ? `释灵${targetLabel}${preview.actionUsesLeverage ? '（燃灵）' : ''}`
      : '调息';

  // 买入时：新买牌在当前天时下的炼化属性（买入决策的核心信息，基于当前可知数据；
  // 非下一回合结算预测——天时流转后可能变化，标注说明）
  const boughtHold = preview.action.type === 'buy' && 'cardIndex' in preview.action && turnManager
    ? (() => {
        const card = publicCards[preview.action.cardIndex];
        if (!card) return null;
        const score = turnManager.getCardScore(card, turnManager.getCurrentSeason());
        const leverage = preview.actionUsesLeverage ? turnManager.getSettlementLeverageMultiplier() : 1;
        const earning = turnManager.previewHoldEarning(score, leverage);
        const qiCost = turnManager.previewHoldQiCost(score, leverage, card.tianGanElement === Element.EARTH);
        return { earning, qiCost };
      })()
    : null;

  // 本回合账单数据
  const scoreBeforeAction = preview.scoreAfterAction - preview.actionScoreChange;
  const scoreAfterAction = preview.scoreAfterAction;
  const qiBeforeAction = preview.qiAfterAction - preview.actionQiChange;
  const qiAfterAction = preview.qiAfterAction;
  // 本回合持仓已扣耗气（上回合结算已发生；无持仓或首回合时为空）
  const holdQiSpentThisRound = lastSettlement?.holdQiCost && lastSettlement.holdQiCost > 0
    ? lastSettlement.holdQiCost
    : 0;

  return (
    <div className="modal-backdrop absolute inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm max-h-[90%] overflow-y-auto bg-white rounded-xl shadow-2xl settlement-in">
        <div className="px-4 py-3 bg-ink text-parchment">
          <h3 className="text-base font-bold font-serif">本回合结算预览</h3>
          <p className="text-xs opacity-80 mt-0.5">确认后才会提交行动；返回不会改变当前局面。</p>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm">
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
                  {preview.actionQiChange !== 0 && <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}心神</span>}
                  {preview.actionQiChange !== 0 && preview.actionScoreChange !== 0 && ' · '}
                  {preview.actionScoreChange !== 0 && <span className={preview.actionScoreChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionScoreChange)}修为</span>}
                </span>
              </div>
            )}
            {/* 买入决策：新买牌在当前天时下的炼化属性（非下回合结算预测） */}
            {boughtHold && (
              <div className="mt-1.5 border-t border-wood-light/50 pt-1.5">
                <div className="flex justify-between">
                  <span>炼化预估（当前天时）</span>
                  <span className="flex gap-3">
                    <span className={boughtHold.earning >= 0 ? 'font-bold text-qi-full' : 'font-bold text-qi-critical'}>
                      {signed(boughtHold.earning)}修为/回合
                    </span>
                    <span className="text-qi-critical">-{boughtHold.qiCost.toFixed(1)}心神/回合</span>
                  </span>
                </div>
                <p className="text-[10px] text-ink-light/70 mt-0.5">基于当前天时与燃灵倍率；天时流转后可能变化。</p>
              </div>
            )}
          </div>

          {/* 修为账单：当前 → 行动 → 行动后 */}
          <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
            <div className="space-y-1 text-ink-light">
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
              <div className="flex justify-between border-t border-gold/25 pt-1">
                <span className="font-medium text-ink">行动后修为</span>
                <span className="font-bold tabular-nums text-gold">{scoreAfterAction.toFixed(1)}</span>
              </div>
            </div>
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
              {/* 心神账单：本回合已扣持仓耗气 → 当前 → 行动 → 行动后可用 */}
              <div className="space-y-1 text-xs text-ink-light">
                {holdQiSpentThisRound > 0 && (
                  <div className="flex justify-between">
                    <span>本回合持仓耗气</span>
                    <span className="text-qi-critical">-{holdQiSpentThisRound.toFixed(1)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>当前心神</span>
                  <span className="tabular-nums">{qiBeforeAction.toFixed(1)}</span>
                </div>
                {preview.actionQiChange !== 0 && (
                  <div className="flex justify-between">
                    <span>{preview.action.type === 'sell' ? '释灵流转' : preview.action.type === 'buy' ? '纳灵消耗' : '行动变化'}</span>
                    <span className={preview.actionQiChange > 0 ? 'text-qi-full' : 'text-qi-critical'}>{signed(preview.actionQiChange)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-wood-light/40 pt-1">
                  <span className="font-medium text-ink">行动后可用心神</span>
                  <span className={`font-bold tabular-nums ${qiAfterAction <= 0 ? 'text-qi-critical' : 'text-ink'}`}>
                    {qiAfterAction.toFixed(1)}
                  </span>
                </div>
              </div>

              {preview.action.type === 'buy' && preview.actionUsesLeverage && (
                <p className="text-[11px] text-ink-light/80">顺势参考：当季牌性契合、心神充足时再燃灵。燃灵为可选项。</p>
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
