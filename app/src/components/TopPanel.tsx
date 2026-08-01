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
    <div className="flex items-center justify-between px-4 py-3 bg-[#faf6ee] border-b border-wood-light">
      <h1 className="text-lg font-bold font-serif text-ink">
        {/* key 变化触发切换动画，提示回合推进 */}
        <span key={currentRound} className="inline-block" style={roundAnimStyle}>
          {seasonDisplay(season)} · 第{roundInSeason}回合
        </span>
      </h1>
      <div className="relative flex items-center">
        <span className="text-base font-bold text-gold tabular-nums">
          {score.toFixed(1)} 分
        </span>
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
