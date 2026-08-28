import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import { BRANCH_ROLL_DI_ZHI } from '@core/index';

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
  const score = useGameStore((s) => s.score);
  const scoreDelta = useGameStore((s) => s.scoreDelta);
  // V6 地支偏移条（票 03）：12 地支效果值；非 V6 为 null → 整条不渲染（V5 零回归）
  const branchRollDeltas = useGameStore((s) => s.branchRollDeltas);
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
      <div className="flex items-start gap-2 px-3 sm:px-4 py-2 max-md:py-1.5">
        <div className="min-w-0 flex-1">
          <h1 className={`text-lg font-bold font-serif ${seasonTheme.text}`}>
            {/* key 变化触发切换动画，提示回合推进 */}
            <span key={currentRound} className="inline-block" style={roundAnimStyle}>
              {seasonDisplay(season)} · 天时
            </span>
          </h1>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-light tabular-nums">
            <span className="font-bold text-ink">第 {currentRound} 回合 / {totalRounds}</span>
            <span>季内第 {roundInSeason} 回合</span>
          </div>
          <div className="mt-0.5 h-1 w-32 overflow-hidden rounded-full bg-wood-light/50" aria-label={`甲子进度 ${currentRound}/${totalRounds}`}>
            <div className={`h-full rounded-full ${seasonTheme.bar}`} style={{ width: `${Math.min(100, (currentRound / totalRounds) * 100)}%` }} />
          </div>
        </div>
        {gameState === 'player_action' && (
          <div className="flex shrink-0 items-center gap-1 my-auto">
            <button
              onClick={openDashboard}
              className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-white border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-bold font-serif hover:bg-wood-light/20 hover:shadow-sm transition-all cursor-pointer"
              aria-label="打开交易看板"
            >
              行迹
            </button>
            <button
              onClick={openCultivationProfile}
              className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-white border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-bold font-serif hover:bg-wood-light/20 hover:shadow-sm transition-all cursor-pointer"
              aria-label="打开修行档案"
            >
              档案
            </button>
            <button
              onClick={openPauseModal}
              className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg bg-white border border-wood-mid text-wood-dark text-[10px] sm:text-[11px] font-bold font-serif hover:bg-wood-light/20 hover:shadow-sm transition-all cursor-pointer"
              aria-label="暂停修行"
            >
              暂停
            </button>
          </div>
        )}
        <div data-score-panel className="score-panel relative shrink-0 rounded-lg border border-gold/35 bg-gold/5 px-2 py-1 text-right">
          <div className="text-xl font-black leading-6 text-gold tabular-nums">
            {score.toFixed(1)} 修为
          </div>
          {scoreDelta && (
            <div className={`mt-0.5 whitespace-nowrap text-[10px] font-bold leading-none tabular-nums ${scoreDelta.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
              本回合 {scoreDelta.delta >= 0 ? '+' : ''}{scoreDelta.delta.toFixed(1)} 修为
            </div>
          )}
          {/* 分数飘字：多个同时出现时横向错开，避免叠字 */}
          {floaters.map((f, idx) => (
            <span
              key={f.id}
              className={`float-up absolute right-0 top-full mt-0.5 text-sm font-bold pointer-events-none whitespace-nowrap ${
                f.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'
              }`}
              style={{ right: `${idx * 24}px` }}
            >
              {f.delta >= 0 ? '+' : ''}{f.delta.toFixed(1)}
            </span>
          ))}
        </div>
      </div>
      {/* V6 地支偏移条：12 地支横排常驻（位置稳定防换季闪跳）；效果值 = 该族阳干非土卡
          实际注入分差（与卡面分同语言）；偏旺暖色/偏弱冷色/0 灰（Q2-A/Q3-A/Q5-A 拍板）。 */}
      {branchRollDeltas && (
        <div
          className="grid grid-cols-12 gap-0.5 px-3 pb-1 pt-0.5 text-center border-t border-wood-light/50"
          aria-label="本季地支偏移"
          data-testid="branch-roll-bar"
        >
          {BRANCH_ROLL_DI_ZHI.map((dz) => {
            const v = branchRollDeltas[dz] ?? 0;
            return (
              <div key={dz}>
                <div className="text-[10px] leading-none text-ink-light/80 font-serif">{dz}</div>
                <div
                  className={`text-[10px] font-bold leading-tight tabular-nums ${
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
    </div>
  );
}
