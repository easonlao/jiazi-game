import { useState } from 'react';
import { useGameStore } from '../store';
import { type SingleYearBoonId, SINGLE_YEAR_BOONS } from '@core/index';

export function TribulationModal() {
  const isTribulationModalOpen = useGameStore((s) => s.isTribulationModalOpen);
  const tribulationResult = useGameStore((s) => s.tribulationResult);
  const closeTribulationModal = useGameStore((s) => s.closeTribulationModal);
  const advanceToNextYear = useGameStore((s) => s.advanceToNextYear);
  const totalYearsSurvived = useGameStore((s) => s.totalYearsSurvived);

  const [selectedBoon, setSelectedBoon] = useState<Exclude<SingleYearBoonId, 'none'>>('xumi');

  if (!isTribulationModalOpen || !tribulationResult) return null;

  const {
    success,
    year,
    quota,
    scoreBeforeEvaluation,
    dantianClearedCards,
    dantianSellTotal,
    finalScore,
    surplus,
    carryover,
    message,
  } = tribulationResult;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      data-testid="tribulation-modal"
    >
      <div
        className={`relative w-full max-w-lg rounded-2xl border-2 p-6 text-stone-100 shadow-2xl ${
          success
            ? 'border-emerald-500/80 bg-gradient-to-b from-stone-950 via-stone-900 to-emerald-950/60'
            : 'border-rose-500/80 bg-gradient-to-b from-stone-950 via-stone-900 to-rose-950/60'
        }`}
      >
        {/* 图标与标题 */}
        <div className="text-center">
          <div
            className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border text-3xl shadow-inner ${
              success
                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
                : 'border-rose-400/60 bg-rose-500/20 text-rose-300'
            }`}
          >
            {success ? '⚡' : '💥'}
          </div>
          <h2
            className={`font-serif text-xl font-black tracking-wide ${
              success ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {success ? `渡劫成功！突破第 ${year} 劫！` : `道消身陨！未渡过第 ${year} 劫！`}
          </h2>
          <p className="mt-1 text-xs text-stone-300/80">
            甲子历 第 {year} 年岁末 · 九霄玄雷天劫大考
          </p>
        </div>

        {/* 丹田明牌雷火出清展示 (Q5=B) */}
        {dantianClearedCards.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-left text-xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-300">
              <span>⚡【天劫雷火炼体】</span>
            </div>
            <p className="mt-1 text-amber-200/90 leading-relaxed">
              活跃丹田明牌【{dantianClearedCards.map((c) => c.card.name).join('、')}】受玄雷雷火淬炼出清，化作真元变现{' '}
              <strong className={dantianSellTotal >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {dantianSellTotal >= 0 ? `+${dantianSellTotal}` : dantianSellTotal}
              </strong>{' '}
              修为并入大考！（丹田已空，唯地脉暗牌存留）
            </p>
          </div>
        )}

        {/* 大考数值明细 */}
        <div className="mt-4 space-y-2 rounded-xl border border-stone-800 bg-stone-900/90 p-4 text-xs">
          <div className="flex items-center justify-between text-stone-300">
            <span>出清前本年修为:</span>
            <span className="font-mono">{scoreBeforeEvaluation.toLocaleString()}</span>
          </div>
          {dantianSellTotal !== 0 && (
            <div className="flex items-center justify-between text-amber-300/90">
              <span>丹田雷火变现:</span>
              <span className="font-mono font-bold">
                {dantianSellTotal >= 0 ? `+${dantianSellTotal}` : dantianSellTotal}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-stone-800 pt-1.5 font-semibold text-stone-200">
            <span>大考总修为:</span>
            <strong className={`font-mono text-sm ${success ? 'text-emerald-400' : 'text-rose-400'}`}>
              {finalScore.toLocaleString()}
            </strong>
          </div>
          <div className="flex items-center justify-between text-stone-400">
            <span>天劫门槛要求:</span>
            <span className="font-mono font-bold text-stone-200">{quota.toLocaleString()}</span>
          </div>

          {success ? (
            <div className="mt-2 border-t border-emerald-900/60 pt-2 space-y-1 text-emerald-300/90">
              <div className="flex items-center justify-between">
                <span>天劫溢出真元:</span>
                <strong className="font-mono text-amber-300">+{surplus.toLocaleString()}</strong>
              </div>
              <div className="flex items-center justify-between font-bold">
                <span>新岁结转道基 (35%):</span>
                <strong className="font-mono text-base text-emerald-300">+{carryover.toLocaleString()}</strong>
              </div>
            </div>
          ) : (
            <div className="mt-2 border-t border-rose-900/60 pt-2 text-rose-400 font-medium">
              <div className="flex items-center justify-between">
                <span>修为差额缺口:</span>
                <strong className="font-mono text-rose-400">
                  -{(quota - finalScore).toLocaleString()}
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* 判词说明 */}
        <div
          className={`mt-4 rounded-lg p-3 text-left text-xs font-serif leading-relaxed ${
            success
              ? 'border border-emerald-700/40 bg-emerald-950/20 text-emerald-200/90'
              : 'border border-rose-700/40 bg-rose-950/20 text-rose-200/90'
          }`}
        >
          {success ? (
            <>
              ⚡ <span className="font-bold">天道酬勤：</span>九道九霄玄雷消解当岁基准真元，唯存 35% 溢出底蕴化作新岁道基！潜伏地脉中未露锋芒之暗牌完好无损，助你开启下一岁无尽征途！
            </>
          ) : (
            <>
              💥 <span className="font-bold">身死道消：</span>天雷浩荡，真元不足！你在岁末天劫中化为飞灰。累计存活了 {totalYearsSurvived || year} 年。仙路漫漫，且待来世再争甲子机锋！
            </>
          )}
        </div>

        {/* 单岁造化三选一选择区 (V11) */}
        {success && (
          <div className="mt-4 text-left" data-testid="boon-selection-section">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                <span>✨ 择取新岁护航机缘（三选一 · 仅限新岁有效）</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(SINGLE_YEAR_BOONS) as (keyof typeof SINGLE_YEAR_BOONS)[]).map((key) => {
                const boon = SINGLE_YEAR_BOONS[key];
                const isSelected = selectedBoon === boon.id;
                return (
                  <button
                    key={boon.id}
                    type="button"
                    onClick={() => setSelectedBoon(boon.id)}
                    data-testid={`boon-option-${boon.id}`}
                    className={`flex flex-col justify-between p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      isSelected
                        ? 'border-emerald-400 bg-emerald-950/80 shadow-md shadow-emerald-900/50 ring-2 ring-emerald-400/80'
                        : 'border-stone-800 bg-stone-900/70 hover:border-stone-700 text-stone-300'
                    }`}
                  >
                    <div>
                      <div className={`font-serif text-xs font-bold flex items-center justify-between ${isSelected ? 'text-emerald-300' : 'text-stone-200'}`}>
                        <span>{boon.name}</span>
                        {isSelected && <span className="text-[11px] text-emerald-400">✓</span>}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold text-amber-300/90 leading-tight">
                        {boon.shortDesc}
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-stone-400 leading-snug line-clamp-3">
                      {boon.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 底部交互按键 */}
        <div className="mt-5 flex gap-3">
          {success ? (
            <button
              onClick={() => advanceToNextYear(selectedBoon)}
              className="w-full cursor-pointer rounded-lg border border-emerald-500 bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 font-serif text-sm font-bold text-white shadow-lg shadow-emerald-950/50 hover:brightness-110 active:scale-98 transition-all"
              data-testid="tribulation-advance-btn"
            >
              承载【{SINGLE_YEAR_BOONS[selectedBoon]?.name}】· 迈入新岁 ➔
            </button>
          ) : (
            <button
              onClick={() => closeTribulationModal()}
              className="w-full cursor-pointer rounded-lg border border-rose-600 bg-gradient-to-r from-rose-700 to-red-800 py-2.5 font-serif text-sm font-bold text-white shadow-lg shadow-rose-950/50 hover:brightness-110 active:scale-98 transition-all"
              data-testid="tribulation-close-btn"
            >
              身死道消 · 封存战绩
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
