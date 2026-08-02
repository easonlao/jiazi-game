import { useGameStore } from '../store';

/**
 * 本地排行榜弹窗：展示历史最高分记录（按分数降序，最多 10 条）。
 */
export function LeaderboardModal() {
  const entries = useGameStore((s) => s.leaderboardEntries);
  const closeLeaderboard = useGameStore((s) => s.closeLeaderboard);

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6">
        <h2 className="text-xl font-bold font-serif text-ink mb-4 text-center">排行榜</h2>

        {entries.length === 0 ? (
          <p className="text-sm text-ink-light text-center py-8">暂无记录</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {entries.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#faf6ee] text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0 ? 'bg-gold text-white' :
                    i === 1 ? 'bg-wood-mid text-white' :
                    i === 2 ? 'bg-amber-700 text-white' :
                    'bg-wood-light text-ink-light'
                  }`}>
                    {i + 1}
                  </span>
                  <span className="font-medium text-ink">{entry.date}</span>
                </div>
                <span className="font-bold text-gold">{entry.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={closeLeaderboard}
          className="w-full mt-4 py-3 rounded-xl bg-ink text-parchment text-base font-bold font-serif hover:bg-wood-dark transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  );
}