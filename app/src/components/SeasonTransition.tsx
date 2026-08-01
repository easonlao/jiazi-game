import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';

/**
 * 季节转换动画："春去夏来"文字提示。
 * 由 store 的 seasonEvent（id 递增）驱动，跨季时触发一次（约 2.2s）。
 * 普通回合不再使用全屏过渡，仪式感仅保留给换季。
 */
const SEASON_META: Record<string, { text: string; sub: string }> = {
  spring: { text: '#047857', sub: '万物生发 · 木气正旺' },
  summer: { text: '#b91c1c', sub: '烈日当空 · 火气正旺' },
  autumn: { text: '#b45309', sub: '金秋肃杀 · 金气正旺' },
  winter: { text: '#0369a1', sub: '天寒地冻 · 水气正旺' },
};

export function SeasonTransition() {
  const seasonEvent = useGameStore((s) => s.seasonEvent);
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [data, setData] = useState<{ from: string; to: string } | null>(null);
  const lastEventId = useRef(0);

  useEffect(() => {
    if (seasonEvent && seasonEvent.id !== lastEventId.current) {
      lastEventId.current = seasonEvent.id;
      // 爆仓轮：让位给 MarginCallOverlay，不播季节转换
      if (marginCallEvent && marginCallEvent.id > seasonEvent.id) return;
      setData({ from: seasonEvent.prevSeason, to: seasonEvent.season });
      setAnimKey((k) => k + 1);
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2300);
      return () => clearTimeout(t);
    }
  }, [seasonEvent, marginCallEvent]);

  if (!visible || !data) return null;

  const meta = SEASON_META[data.to] ?? SEASON_META.spring;

  return (
    <div key={animKey} className="absolute inset-0 z-[65] pointer-events-none overflow-hidden" aria-hidden>
      {/* 中央大字：春去 · 夏来 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center px-6">
          <div
            className="season-word text-5xl font-bold font-serif tracking-[0.2em]"
            style={{ color: meta.text }}
          >
            {seasonDisplay(data.from)}去 · {seasonDisplay(data.to)}来
          </div>
          <div className="season-word text-base mt-3 text-ink font-medium tracking-widest" style={{ animationDelay: '0.35s' }}>
            {meta.sub}
          </div>
        </div>
      </div>
    </div>
  );
}
