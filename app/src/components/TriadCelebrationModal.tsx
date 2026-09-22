import { useGameStore } from '../store';

export function TriadCelebrationModal() {
  const lastTriadClaim = useGameStore((s) => s.lastTriadClaim);
  const clearLastTriadClaim = useGameStore((s) => s.clearLastTriadClaim);

  if (!lastTriadClaim) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-xl border-2 border-amber-400 bg-gradient-to-b from-stone-900 via-stone-900 to-amber-950 p-5 text-parchment shadow-2xl">
        {/* 顶部天象光环 */}
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-amber-400/50 bg-amber-500/20 text-2xl shadow-inner">
            ⚡
          </div>
          <h3 className="font-serif text-lg font-bold text-amber-300">
            天象共鸣 · 三合大成
          </h3>
          <p className="mt-0.5 text-xs text-amber-200/70">
            功德圆满 · 大阵融道归元
          </p>
        </div>

        {/* 阵法核心详情 */}
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-black/40 p-3 text-xs">
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5">
            <span className="text-stone-400">引动合局</span>
            <span className="font-bold text-amber-300">
              {lastTriadClaim.triad.name} ({lastTriadClaim.triad.branches.join('·')})
            </span>
          </div>

          <div className="flex flex-col gap-1 border-b border-amber-500/20 pb-1.5">
            <span className="text-stone-400">融道神符 (槽位已腾空)</span>
            <div className="flex flex-wrap gap-1.5">
              {lastTriadClaim.dissolvedCards.map((c) => (
                <span
                  key={c.id}
                  className="rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-200 border border-amber-400/30"
                >
                  {c.name} ({c.diZhi})
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5">
            <span className="text-stone-400">大阵修为</span>
            <span className="font-mono font-bold text-qi-full">
              +{lastTriadClaim.bonus.toLocaleString()} 修为
            </span>
          </div>

          <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5">
            <span className="text-stone-400">神识补益</span>
            <span className="font-bold text-sky-400">
              满溢灌顶 (回满上限)
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-stone-400">道基专精</span>
            <span className="font-bold text-amber-300">
              【{lastTriadClaim.element}行】增益至 {(lastTriadClaim.newMultiplier * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* 混元大圆满触发奖励 */}
        {lastTriadClaim.isGrandCycle && (
          <div className="mt-3 rounded-lg border border-amber-400 bg-gradient-to-r from-amber-600/30 to-purple-600/30 p-2.5 text-xs shadow-md animate-pulse">
            <div className="font-bold text-amber-200 flex items-center gap-1">
              <span>🎆</span>
              <span>四象融汇 · 混元大圆满！</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-100/90 leading-relaxed">
              水火金木四象悉数成局，天降混元祥瑞！狂揽额外 +{lastTriadClaim.grandBonus.toLocaleString()} 修为，【土行真元】承托万物永久激活 (+{Math.round((lastTriadClaim.earthMultiplier - 1.0) * 100)}%)！
            </p>
          </div>
        )}

        {/* 领纳功德按钮 */}
        <button
          type="button"
          onClick={clearLastTriadClaim}
          className="mt-4 w-full rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 py-2 text-center text-xs font-bold text-white shadow-md hover:from-amber-500 hover:to-amber-600 active:scale-98 transition-all cursor-pointer"
        >
          领纳功德
        </button>
      </div>
    </div>
  );
}
