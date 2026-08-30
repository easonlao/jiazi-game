import { useGameStore } from '../store';

/**
 * 跨设备终止/受损冲突弹窗：
 * 当玩家在当前设备离线终止或触发受损恢复，而另一设备已在线继续产生更新进度时触发。
 *
 * 根据 conflict.kind 细分：
 * 1. voluntary_termination（主动终止冲突）：
 *    - 「继续最新云端对局」：撤销本机待同步终止，恢复云端最新对局继续游玩；
 *    - 「确认终止最新对局」：按云端最新进度落库 abandoned，并清理待同步记录。
 * 2. corrupted_recovery（受损恢复冲突）：
 *    - 「尝试继续云端对局」：恢复云端最新对局；
 *    - 「安全重置该对局（免惩罚）」：走服务端重放验证后写入 corrupted_recovery（绝不计为 abandoned）。
 */
export function TerminationConflictModal() {
  const telemetryState = useGameStore((s) => s.telemetryState);
  const conflict = telemetryState?.terminationConflict ?? null;
  const resolveTerminationConflict = useGameStore((s) => s.resolveTerminationConflict);

  if (!conflict) return null;

  const { localTermination, cloudSession, kind } = conflict;
  const isCorrupted = kind === 'corrupted_recovery';
  const cloudRounds = cloudSession.rounds_completed;
  const cloudActionsCount = cloudSession.actions?.length ?? 0;
  const localRounds = localTermination.roundsCompleted;
  const localActionsCount = localTermination.clientActionCount ?? 0;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="termination-conflict-title"
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm overflow-hidden"
    >
      <div
        role="document"
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-[24px] border border-[#DAC9A8] bg-[#F6EDDC] p-5 shadow-2xl animate-fade-in my-auto"
      >
        <header className="border-b border-[#E6D7B8] pb-3">
          <p className="text-[11px] font-bold tracking-wide text-wood-dark">跨设备同步提示</p>
          <h2 id="termination-conflict-title" className="mt-0.5 font-serif text-lg font-bold text-ink">
            {isCorrupted ? '受损对局跨设备冲突' : '对局进度冲突'}
          </h2>
        </header>

        <div className="py-4 space-y-3.5">
          <div className="rounded-2xl border border-wood-mid/40 bg-white/80 p-3.5 text-xs text-ink leading-relaxed space-y-2">
            <p className="font-serif font-bold text-ink text-sm">
              {isCorrupted
                ? '检测到该对局在其他设备中有更新的有效行动'
                : '检测到其他设备在此局中有更新的修行进度'}
            </p>
            <div className="space-y-1 text-[11px] text-ink-light">
              <p>
                <span className="font-semibold text-wood-dark">云端最新进度：</span>
                第 {cloudRounds} 回合（共 {cloudActionsCount} 步行动）
              </p>
              <p>
                <span className="font-semibold text-ink-light">
                  {isCorrupted ? '本机受损检测：' : '本机离线终止：'}
                </span>
                第 {localRounds} 回合（共 {localActionsCount} 步行动）
              </p>
            </div>
            <p className="text-[11px] text-ink-light pt-1 border-t border-wood-light/40">
              {isCorrupted
                ? '若云端对局实际健康，可尝试继续游玩；若云端对局同样异常，可执行免惩罚安全重置：'
                : '为防止意外丢失新进度，请选择如何处理这局修行：'}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            <button
              onClick={() => {
                void resolveTerminationConflict('resume_cloud');
              }}
              className="w-full py-3 rounded-xl bg-gold text-ink text-sm font-serif font-bold hover:bg-gold-light transition-colors active:scale-95 shadow-md cursor-pointer border border-[#C29D55]"
            >
              {isCorrupted ? '尝试继续云端对局' : '继续最新云端对局'}
            </button>
            {isCorrupted ? (
              <button
                onClick={() => {
                  void resolveTerminationConflict('reset_corrupted');
                }}
                className="w-full py-2.5 rounded-xl border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light/30 transition-colors active:scale-95 cursor-pointer"
              >
                安全重置该对局（免惩罚）
              </button>
            ) : (
              <button
                onClick={() => {
                  void resolveTerminationConflict('terminate_latest');
                }}
                className="w-full py-2.5 rounded-xl border border-wood-mid bg-white text-ink text-xs font-serif font-bold hover:bg-wood-light/30 transition-colors active:scale-95 cursor-pointer"
              >
                确认终止该对局
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
