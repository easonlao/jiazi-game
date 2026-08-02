import { useGameStore } from '../store';

/**
 * 游戏结束弹窗：展示最终得分 + 重新开始按钮。
 * 通过 store.reset() 走正式重置流程，不直接调 TurnManager.reset 绕过 store。
 */
export function GameOverModal() {
  const score = useGameStore((s) => s.score);
  const reset = useGameStore((s) => s.reset);

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6 text-center">
        <h2 className="text-xl font-bold font-serif text-ink mb-4">游戏结束</h2>
        <p className="text-3xl font-bold text-gold mb-6">
          {score.toFixed(1)} 分
        </p>
        <button
          onClick={reset}
          className="w-full py-3 rounded-xl bg-ink text-parchment text-base font-bold font-serif hover:bg-wood-dark transition-colors"
        >
          重新开始
        </button>
      </div>
    </div>
  );
}
