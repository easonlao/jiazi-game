import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import { BRANCH_ROLL_DI_ZHI, ALL_SECTS, SEASON_ACTIVE_SECTS, SINGLE_YEAR_BOONS } from '@core/index';

const roundAnimStyle = {
  animation: 'roundPop 0.4s ease-out',
} as const;

interface Floater {
  id: number;
  delta: number;
}

const SEASON_THEME: Record<string, { text: string; bar: string }> = {
  spring: { text: 'text-emerald-700', bar: 'bg-emerald-500/80' },
  summer: { text: 'text-red-700', bar: 'bg-red-500/80' },
  autumn: { text: 'text-amber-700', bar: 'bg-amber-500/80' },
  winter: { text: 'text-sky-700', bar: 'bg-sky-500/80' },
};

/** 分数变化飘字：金色 +X.X / 红色 -X.X */
export function TopPanel() {
  const season = useGameStore((s) => s.season);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const roundInSeason = useGameStore((s) => s.roundInSeason);
  const year = useGameStore((s) => s.year);
  const turn = useGameStore((s) => s.turn);
  const quota = useGameStore((s) => s.quota);
  const activeBoon = useGameStore((s) => s.activeBoon);
  const score = useGameStore((s) => s.score);
  const scoreDelta = useGameStore((s) => s.scoreDelta);
  // V6 地支偏移条（票 03）：12 地支效果值；非 V6 为 null → 整条不渲染（V5 零回归）
  const branchRollDeltas = useGameStore((s) => s.branchRollDeltas);
  const sectCountdowns = useGameStore((s) => s.sectCountdowns);
  const activeSectIds = (SEASON_ACTIVE_SECTS as Record<string, readonly string[]>)[season] ?? [];
  const seasonTheme = SEASON_THEME[season] ?? SEASON_THEME.spring;
  const openDashboard = useGameStore((s) => s.openDashboard);
  const openCultivationProfile = useGameStore((s) => s.openCultivationProfile);
  const openPauseModal = useGameStore((s) => s.openPauseModal);
  const gameState = useGameStore((s) => s.gameState);

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const lastEventId = useRef(0);
  const floaterSeq = useRef(0);

  useEffect(() => {
    if (scoreDelta && scoreDelta.id !== lastEventId.current && scoreDelta.delta !== 0) {
      lastEventId.current = scoreDelta.id;
      const id = ++floaterSeq.current;
      setFloaters((f) => [...f, { id, delta: scoreDelta.delta }]);
      const t = setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1350);
      return () => clearTimeout(t);
    }
  }, [scoreDelta]);

  return (
    <div className="flex flex-col bg-[#faf6ee] border-b border-wood-light">
      {/* 行 1：主要状态、天时、年岁与操作、修为 */}
      <div className="flex items-center justify-between gap-1.5 px-3 pt-1.5 pb-1 max-md:py-1">
        {/* 左侧：天时 + 年岁轮次 + 机缘 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <h1 className={`text-base sm:text-lg font-bold font-serif ${seasonTheme.text} leading-none whitespace-nowrap`}>
            {/* key 变化触发切换动画，提示回合推进 */}
            <span key={currentRound} className="inline-block" style={roundAnimStyle}>
              {seasonDisplay(season)} · 天时
            </span>
          </h1>
          <span className="text-[11px] font-bold text-amber-900 bg-amber-100/90 px-1.5 py-0.5 rounded-full border border-amber-300 shadow-2xs tabular-nums whitespace-nowrap">
            第 {year} 年 · {turn}/20 轮
          </span>
          {activeBoon && activeBoon !== 'none' && SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS] && (
            <span
              className="text-[10px] font-bold text-teal-800 bg-teal-100/90 px-1.5 py-0.5 rounded-full border border-teal-300/80 shadow-xs whitespace-nowrap"
              title={SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS]?.description}
              data-testid="active-boon-badge"
            >
              ✨【{SINGLE_YEAR_BOONS[activeBoon as keyof typeof SINGLE_YEAR_BOONS]?.name}】
            </span>
          )}
        </div>

        {/* 右侧：功能按钮 + 修为面板 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {gameState === 'player_action' && (
            <div className="flex items-center gap-1">
              <button
                onClick={openDashboard}
                className="px-1.5 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="打开交易看板"
              >
                行迹
              </button>
              <button
                onClick={openCultivationProfile}
                className="px-1.5 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="打开修行档案"
              >
                档案
              </button>
              <button
                onClick={openPauseModal}
                className="px-1.5 py-0.5 rounded bg-white/90 border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-serif hover:bg-wood-light/20 transition-all cursor-pointer shadow-2xs"
                aria-label="暂停修行"
              >
                暂停
              </button>
            </div>
          )}
          <div data-score-panel className="score-panel relative shrink-0 rounded-lg border border-gold/40 bg-gold/10 px-2 py-0.5 text-right">
            <div className="text-base sm:text-lg font-black leading-tight text-gold tabular-nums font-mono">
              {score.toFixed(1)} <span className="text-[10px] font-serif font-bold text-wood-dark">修为</span>
            </div>
            {scoreDelta && (
              <div className={`mt-0.5 whitespace-nowrap text-[9px] font-bold leading-none tabular-nums absolute right-1 top-full ${scoreDelta.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
                {scoreDelta.delta >= 0 ? '+' : ''}{scoreDelta.delta.toFixed(1)}
              </div>
            )}
            {/* 分数飘字 */}
            {floaters.map((f, idx) => (
              <span
                key={f.id}
                className={`float-up absolute right-0 top-full mt-0.5 text-xs font-bold pointer-events-none whitespace-nowrap ${
                  f.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'
                }`}
                style={{ right: `${idx * 20}px` }}
              >
                {f.delta >= 0 ? '+' : ''}{f.delta.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 行 2：季内回合与天劫道基大考进度条（独占一行，绝不重叠折行） */}
      <div className="flex items-center justify-between gap-2 px-3 py-0.5 border-t border-wood-light/30 text-[11px]">
        <span className="font-serif text-ink whitespace-nowrap">
          季内第 <strong className="font-mono font-bold text-ink">{roundInSeason}</strong> 回合
        </span>
        <div className="flex items-center gap-1.5 flex-1 max-w-[200px] justify-end" title={`天劫门槛目标: ${score.toFixed(0)} / ${quota}`}>
          <span className="text-[10px] text-wood-dark font-serif font-medium whitespace-nowrap">天劫道基:</span>
          <div className="h-1.5 flex-1 rounded-full bg-wood-light/60 overflow-hidden min-w-[50px]">
            <div
              className={`h-full rounded-full transition-all duration-300 ${score >= quota ? 'bg-emerald-500' : 'bg-gold'}`}
              style={{ width: `${Math.min(100, Math.max(0, (score / quota) * 100))}%` }}
            />
          </div>
          <span className={`text-[10px] font-mono font-bold whitespace-nowrap ${score >= quota ? 'text-emerald-700' : 'text-amber-800'}`}>
            {score.toFixed(0)}/{quota}
          </span>
        </div>
      </div>

      {/* V6 地支偏移条 */}
      {branchRollDeltas && (
        <div
          className="grid grid-cols-12 gap-0.5 px-3 pb-0.5 pt-0.5 text-center border-t border-wood-light/40"
          aria-label="本季地支偏移"
          data-testid="branch-roll-bar"
        >
          {BRANCH_ROLL_DI_ZHI.map((dz) => {
            const v = branchRollDeltas[dz] ?? 0;
            return (
              <div key={dz}>
                <div className="text-[9px] leading-none text-ink-light/80 font-serif">{dz}</div>
                <div
                  className={`text-[9px] font-bold leading-tight tabular-nums ${
                    v > 0 ? 'text-red-600' : v < 0 ? 'text-sky-600' : 'text-gray-400'
                  }`}
                >
                  {v > 0 ? `+${v}` : v}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* V11 古宗巡视倒计时警示栏 */}
      {activeSectIds.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-0.5 bg-[#faf6ee] text-[10px] border-t border-wood-light/40"
          data-testid="sect-patrol-bar"
        >
          <div className="flex items-center gap-1.5 font-serif text-wood-dark">
            <span className="font-bold text-[10px]">古宗巡视:</span>
            {activeSectIds.map((sid: string) => {
              const sect = ALL_SECTS[sid];
              if (!sect) return null;
              const cd = sectCountdowns?.[sid] ?? '-';
              const isUrgent = typeof cd === 'number' && cd <= 1;
              return (
                <span
                  key={sid}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[9px] font-serif ${
                    isUrgent
                      ? 'bg-rose-50 border-rose-400 text-rose-800 font-bold animate-pulse'
                      : 'bg-white/80 border-wood-light text-ink'
                  }`}
                >
                  <span>{sect.name}</span>
                  <span className="font-mono">{cd}轮</span>
                </span>
              );
            })}
          </div>
          <span className="text-[9px] text-wood-mid/80 font-serif whitespace-nowrap">地脉暗牌避灾</span>
        </div>
      )}
    </div>
  );
}
