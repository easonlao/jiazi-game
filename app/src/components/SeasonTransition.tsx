import { useEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';

/**
 * 季节转换动画："春去夏来"文字提示。
 * 由 store 的 seasonEvent（id 递增）驱动，跨季时触发一次（约 2.2s）。
 * 普通回合不再使用全屏过渡，仪式感仅保留给换季。
 * sub 为换季四字对仗（2026-08-06 玩家体验 issue 01 P1 定稿）：
 * 当令者旺，被当令所克者衰（夏火旺则水伏、秋金旺则木衰、冬水旺则火敛、春木旺则金藏）。
 */
const SEASON_META: Record<string, { text: string; sub: string }> = {
  spring: { text: '#047857', sub: '春木生发，金气归藏' },
  summer: { text: '#b91c1c', sub: '夏火升腾，水气伏藏' },
  autumn: { text: '#b45309', sub: '秋金肃敛，木气式微' },
  winter: { text: '#0369a1', sub: '冬水潜藏，火气敛息' },
};

export function SeasonTransition() {
  const seasonEvent = useGameStore((s) => s.seasonEvent);
  const marginCallEvent = useGameStore((s) => s.marginCallEvent);
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [data, setData] = useState<{ from: string; to: string } | null>(null);
  const lastEventId = useRef(0);
  // 隐藏定时器独立于 effect 生命周期：若挂在 effect cleanup 上，
  // marginCallEvent 等无关依赖变化会清掉定时器且不再重新调度，动画将永久卡住。
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (seasonEvent && seasonEvent.id !== lastEventId.current) {
      lastEventId.current = seasonEvent.id;
      // 爆仓轮：让位给 MarginCallOverlay，不播季节转换
      if (marginCallEvent && marginCallEvent.id > seasonEvent.id) return;
      setData({ from: seasonEvent.prevSeason, to: seasonEvent.season });
      setAnimKey((k) => k + 1);
      setVisible(true);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      // 卸载时机必须晚于副标题动画结束：主标题 0s+2.2s=2.2s，副标题 animationDelay 0.35s+2.2s=2.55s。
      // 若提前（如 2.3s）卸载，副标题在淡出途中（opacity≈0.76）被硬切 → 换季交互闪烁（2026-08-06 用户反馈）。
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setVisible(false);
      }, 2600);
    }
  }, [seasonEvent, marginCallEvent]);

  // 仅组件卸载时清理隐藏定时器
  useEffect(() => () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
  }, []);

  if (!visible || !data) return null;

  const meta = SEASON_META[data.to] ?? SEASON_META.spring;

  return (
    <div key={animKey} className="absolute inset-0 z-20 pointer-events-none overflow-hidden" aria-hidden>
      {/* 中央大字：春去 · 夏来 */}
      {/* z-20：低于 ActionBar（z-10/z-30），换季动画不覆盖底部操作栏——
          玩家在动画期间仍能看到并操作纳灵/释灵/调息/燃灵，点击反馈不被吞，
          也不存在"动画期间点按钮没反馈→可探测换季"的信息泄露窗口（2026-08-05） */}
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
