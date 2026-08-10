import { useEffect } from 'react';
import { useGameStore } from '../store';

/**
 * 排行榜弹窗：
 * - 本地榜：展示历史最高分记录（按分数降序，最多 10 条）。
 * - 云端娱乐榜：展示已设置用户名玩家的公开成绩（用户名 + 唯一公开编码 + 分数）。
 *   该榜单分数由服务端重放校验后写入；历史未校验数据由服务端查询规则过滤。
 */
export function LeaderboardModal() {
  const entries = useGameStore((s) => s.leaderboardEntries);
  const cloudEntries = useGameStore((s) => s.cloudLeaderboard);
  const cloudStatus = useGameStore((s) => s.cloudLeaderboardStatus);
  const cloudError = useGameStore((s) => s.cloudLeaderboardError);
  const verificationState = useGameStore((s) => s.verificationState);
  const refreshCloudLeaderboard = useGameStore((s) => s.refreshCloudLeaderboard);
  const closeLeaderboard = useGameStore((s) => s.closeLeaderboard);

  useEffect(() => {
    void refreshCloudLeaderboard();
  }, [refreshCloudLeaderboard]);

  return (
    <div className="modal-backdrop absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs bg-parchment rounded-xl shadow-2xl p-6">
        <h2 className="text-xl font-bold font-serif text-ink mb-4 text-center">排行榜</h2>

        <section>
          <h3 className="text-sm font-serif font-bold text-ink mb-2">本地榜</h3>
          {entries.length === 0 ? (
            <p className="text-sm text-ink-light text-center py-4">暂无记录</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
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
        </section>

        <section className="mt-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-serif font-bold text-ink">云端榜</h3>
            <span className="text-[10px] text-ink-light">服务端校验</span>
          </div>
          {verificationState?.status === 'pending' && (
            <p className="mb-2 text-[10px] leading-relaxed text-gold">
              本局正在校验，校验完成后会自动刷新云端榜。
            </p>
          )}
          {cloudStatus === 'loading' || cloudStatus === 'idle' ? (
            <p className="text-sm text-ink-light text-center py-4">正在读取云端榜…</p>
          ) : cloudStatus === 'error' ? (
            <p className="text-sm text-qi-critical text-center py-4">{cloudError ?? '云端榜暂时无法刷新'}</p>
          ) : cloudEntries.length === 0 ? (
            <p className="text-sm text-ink-light text-center py-4">暂无云端记录/未配置数据记录</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {cloudEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#faf6ee] text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                      i === 0 ? 'bg-gold text-white' :
                      i === 1 ? 'bg-wood-mid text-white' :
                      i === 2 ? 'bg-amber-700 text-white' :
                      'bg-wood-light text-ink-light'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {entry.display_name || '未命名玩家'}
                      </div>
                      <div className="font-mono text-[10px] tracking-wider text-ink-light">
                        ID {entry.public_code}
                      </div>
                    </div>
                  </div>
                  <span className="font-bold text-gold shrink-0">{entry.score.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-light">
            云端榜分数经服务端重放校验，仅校验通过的完整 60 回合对局上榜。
          </p>
        </section>

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
