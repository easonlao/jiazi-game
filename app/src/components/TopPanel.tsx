import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';

const roundAnimStyle = {
  animation: 'roundPop 0.4s ease-out',
} as const;

interface Floater {
  id: number;
  delta: number;
}

/** 分数变化飘字：金色 +X.X / 红色 -X.X */
export function TopPanel() {
  const season = useGameStore((s) => s.season);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const roundInSeason = useGameStore((s) => s.roundInSeason);
  const score = useGameStore((s) => s.score);
  const scoreDelta = useGameStore((s) => s.scoreDelta);

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
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#faf6ee] border-b border-wood-light">
      <div className="min-w-0">
        <h1 className="text-lg font-bold font-serif text-ink">
        {/* key 变化触发切换动画，提示回合推进 */}
        <span key={currentRound} className="inline-block" style={roundAnimStyle}>
          {seasonDisplay(season)}季
        </span>
        </h1>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-light tabular-nums">
          <span className="font-bold text-ink">第 {currentRound}/{totalRounds} 回合</span>
          <span>本季第 {roundInSeason} 回合</span>
        </div>
        <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-wood-light/50" aria-label={`游戏进度 ${currentRound}/${totalRounds}`}>
          <div className="h-full rounded-full bg-gold/80" style={{ width: `${Math.min(100, (currentRound / totalRounds) * 100)}%` }} />
        </div>
      </div>
      <div className="relative shrink-0 text-right">
        <div className="text-base font-bold text-gold tabular-nums">
          {score.toFixed(1)} 分
        </div>
        <div className="text-[10px] text-ink-light">累计总分</div>
        {scoreDelta && (
          <div className={`text-[11px] font-bold tabular-nums ${scoreDelta.delta >= 0 ? 'text-qi-full' : 'text-qi-critical'}`}>
            本回合 {scoreDelta.delta >= 0 ? '+' : ''}{scoreDelta.delta.toFixed(1)} 分
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
  );
}
