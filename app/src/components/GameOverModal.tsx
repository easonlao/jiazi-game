import { useGameStore } from '../store';

/**
 * 游戏结束弹窗：展示最终修为 + 排行榜/重新开始按钮。
 * 修为已由 store 在游戏结束时自动记录到排行榜。
 */
export function GameOverModal() {
  const score = useGameStore((s) => s.score);
  const reset = useGameStore((s) => s.reset);
  const openLeaderboard = useGameStore((s) => s.openLeaderboard);

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6 text-center">
        <h2 className="text-xl font-bold font-serif text-ink mb-4">游戏结束</h2>
        <p className="text-3xl font-bold text-gold mb-6">
          {score.toFixed(1)} 修为
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={openLeaderboard}
            className="w-full py-3 rounded-xl border-2 border-wood-mid text-ink text-base font-bold font-serif hover:bg-wood-light transition-colors"
          >
            排行榜
          </button>
          <button
            onClick={reset}
            className="w-full py-3 rounded-xl bg-ink text-parchment text-base font-bold font-serif hover:bg-wood-dark transition-colors"
          >
            重新开始
          </button>
        </div>
      </div>
    </div>
  );
}