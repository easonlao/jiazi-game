import { useState, useEffect } from 'react';
import { useGameStore, seasonDisplay } from '../store';

/**
 * 暂停修行弹窗：
 * - 允许玩家在局内主动暂停并安全保存回到开始页；
 * - 提供明确的两步防误触「主动终止本局」入口；
 * - 暂停不改变修行状态（保留为继续中），只有明确确认终止才记为主动终止。
 */
export function PauseModal() {
  const open = useGameStore((s) => s.pauseModalOpen);
  const close = useGameStore((s) => s.closePauseModal);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const terminateGame = useGameStore((s) => s.terminateGame);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const season = useGameStore((s) => s.season);
  const score = useGameStore((s) => s.score);
  const qi = useGameStore((s) => s.qi);
  const hand = useGameStore((s) => s.hand);

  const [confirmTerminating, setConfirmTerminating] = useState(false);

  // 重置确认状态
  useEffect(() => {
    if (open) setConfirmTerminating(false);
  }, [open]);

  // 支持键盘 Esc 键关闭/取消
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmTerminating) {
          setConfirmTerminating(false);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, confirmTerminating, close]);

  if (!open) return null;

  const handCardCount = hand.filter(Boolean).length;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-hidden"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-modal-title"
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-[24px] border border-[#DAC9A8] bg-[#F6EDDC] p-5 shadow-2xl animate-fade-in my-auto"
      >
        <header className="flex items-center justify-between border-b border-[#E6D7B8] pb-3">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-wood-dark">修行中歇</p>
            <h2 id="pause-modal-title" className="mt-0.5 font-serif text-lg font-bold text-ink">
              {confirmTerminating ? '确认终止修行' : '暂停修行'}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="返回游戏"
            className="rounded-full border border-wood-light bg-white px-3 py-1 text-xs font-bold font-serif text-ink transition-colors hover:bg-wood-light/30 active:scale-95 shadow-sm cursor-pointer"
          >
            返回
          </button>
        </header>

        {confirmTerminating ? (
          /* 二次确认终止步骤 */
          <div className="py-4 space-y-4">
            <div className="rounded-2xl border border-qi-critical/30 bg-qi-critical/10 p-3.5 text-xs text-ink leading-relaxed">
              <p className="font-serif font-bold text-qi-critical text-sm mb-1">确定要主动终止本局修行吗？</p>
              <p className="text-[11px] text-ink-light">
                本局将被记为「主动终止」，当前的进度和神识将被清除，不可恢复。该记录不会被误记为意外中断。
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  terminateGame('voluntary_termination');
                }}
                className="w-full py-3 rounded-xl bg-qi-critical text-white text-sm font-serif font-bold hover:bg-red-800 transition-colors active:scale-95 shadow-md cursor-pointer"
              >
                确认终止本局
              </button>
              <button
                onClick={() => setConfirmTerminating(false)}
                className="w-full py-2.5 rounded-xl border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light/30 transition-colors active:scale-95 cursor-pointer"
              >
                返回继续修行
              </button>
            </div>
          </div>
        ) : (
          /* 正常暂停面板 */
          <div className="py-4 space-y-4">
            {/* 当前对局状态摘要 */}
            <div className="rounded-2xl border border-wood-light bg-white/85 p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-xs text-ink-light mb-2">
                <span>{seasonDisplay(season)}天时</span>
                <span className="font-mono text-ink font-bold">第 {currentRound} / {totalRounds} 回合</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-[#FBF8F0] p-2">
                  <div className="text-[10px] text-ink-light">当前修为</div>
                  <div className="font-serif text-base font-black text-ink mt-0.5 tabular-nums">{score.toFixed(1)}</div>
                </div>
                <div className="rounded-xl bg-[#FBF8F0] p-2">
                  <div className="text-[10px] text-ink-light">丹田灵气 / 神识</div>
                  <div className="font-serif text-base font-black text-ink mt-0.5 tabular-nums">{handCardCount} 张 / {qi}</div>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-ink-light leading-relaxed text-center px-1">
              对局进度已自动保存在此设备，暂停后你可在开始页随时继续，不影响修行轨迹。
            </p>

            {/* 操作按钮组 */}
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                onClick={pauseGame}
                className="w-full py-3.5 rounded-xl bg-ink text-parchment text-sm font-serif font-bold hover:bg-wood-dark transition-colors active:scale-95 shadow-md cursor-pointer"
              >
                保存并回到主页
              </button>
              <button
                onClick={close}
                className="w-full py-2.5 rounded-xl border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light/30 transition-colors active:scale-95 cursor-pointer"
              >
                继续修行
              </button>
              <div className="pt-2 border-t border-wood-light/60 text-center">
                <button
                  onClick={() => setConfirmTerminating(true)}
                  className="text-xs text-qi-critical/80 hover:text-qi-critical font-serif font-semibold transition-colors cursor-pointer py-1"
                >
                  终止本局修行 →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
