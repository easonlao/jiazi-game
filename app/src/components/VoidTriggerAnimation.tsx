import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import {
  createVoidAnimationPlayer,
  type VoidAnimationPlayer,
} from '../lib/voidAnimationPlayer';
import { buildVoidJourney, type VoidJourney } from '../lib/voidSeasonScroll';

/**
 * V5 空亡触发动画·四阶段固定时间线（票 08，2026-08-14 用户拍板）。
 *
 * 由 store 的 voidTriggerEvent（id 递增）驱动，空亡牌触发时播固定四阶段（总长 ~4.1s，
 * 不随 K 变化）：
 *   阶段 1「空亡现世」0.9s：暗色覆盖层中央渲染空亡牌卡面（☰ 空亡 + 时间吞噬 · 非交易品，
 *     与 CardVisual 空亡分支一致）+ 下方小字「空亡现世」；
 *   阶段 2「吞噬」0.7s：暗色环从中心向外扩散（voidSwallow），传达「时间被吞」；
 *   阶段 3「跳转」1.5s：大字号最终季节名（复用 VOID_SEASON_COLOR 季节色，如「至 · 冬」）
 *     + 「前进 N 个季节回合」（N = K，用户拍板：空亡动画中公布 K 数值）；
 *   阶段 4「收尾」1s：「现世已易」+ 底部小字，淡出回到游戏。
 * 不播逐季字幕轮播（旧实现 K 张轮播在换季且 K 大时「秋去·冬来」连续重复，观感"一直弹"，
 * 且与 SeasonTransition 叠加）。
 *
 * - K 值仅在动画阶段 3 展示（Toast/其他 UI 仍不显示 K，mechanics.md §9 变更记录）；
 * - 复用 SeasonTransition 的季节色语言，但用暗色虚空主题（与 CardVisual 空亡牌一致）；
 * - 与 SeasonTransition 的 pointer-events-none 不同：本覆盖层默认指针拦截，
 *   动画期间玩家操作全部被吞（吞噬回合不可行动，验收：动画期间不响应玩家操作）。
 *
 * P1-1（StrictMode）：开局首回合被吞噬时组件「带着非空事件挂载」，StrictMode 开发模式
 * 按 setup→cleanup→setup 重放 effect。编排逻辑集中在 createVoidAnimationPlayer：
 * 动画 effect 的 cleanup 调 player.cancel()（清定时器 + 消费锚点归零），二次 setup 重新
 * 消费并重排定时器；`[]` 兜底 effect 只负责恢复 gameState，不留残留。
 *
 * P2-4：动画期间通过 store.beginVoidRoundAnimation 覆盖 gameState 为 void_round
 * （PublicCards「空亡吞噬中...」、ActionBar 禁用），结束 endVoidRoundAnimation 恢复。
 */

/** 空亡主题季节色（暗底亮色，可读性优于 SEASON_META 的深色系）。 */
const VOID_SEASON_COLOR: Record<string, string> = {
  spring: '#6ee7b7',
  summer: '#fca5a5',
  autumn: '#fcd34d',
  winter: '#7dd3fc',
};

/** 动画阶段：1 空亡现世 / 2 吞噬 / 3 跳转 / 4 收尾。 */
type VoidPhase = 1 | 2 | 3 | 4;

export function VoidTriggerAnimation() {
  const voidTriggerEvent = useGameStore((s) => s.voidTriggerEvent);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<VoidPhase>(1);
  const [journey, setJourney] = useState<VoidJourney | null>(null);

  // 动画编排器单例（去重 + 定时器 + StrictMode 安全，逻辑可单测）
  const playerRef = useRef<VoidAnimationPlayer | null>(null);
  if (playerRef.current === null) {
    playerRef.current = createVoidAnimationPlayer({
      onReveal: () => {
        useGameStore.getState().beginVoidRoundAnimation();
      },
      onSwallow: () => {
        setPhase(2);
        // 进入吞噬阶段：空亡牌自身播放溶解动画并从牌位扩散吞噬环（VoidPoolCard 内）
        useGameStore.setState({ voidSwallowing: true });
      },
      onJump: () => {
        setPhase(3);
        // 吞噬完成：空亡牌从公共牌池移除（真实牌回位），进入跳转聚焦阶段
        useGameStore.setState({ voidPoolSlot: null, voidSwallowing: false });
      },
      onFinale: () => setPhase(4),
      onEnd: () => {
        setVisible(false);
        setPhase(1);
        useGameStore.getState().endVoidRoundAnimation();
      },
    });
  }

  // 动画启动 effect：事件变化时启动/重启动画。cleanup 交给 player.cancel()——
  // StrictMode 二次 setup 依赖 cancel 把消费锚点归零才能重新调度（P1-1）。
  // 用 useLayoutEffect（paint 前同步）：终局被吞噬时若用 useEffect，首帧会先渲染
  // game_over + GameOverModal，下一帧才切 void_round 覆盖层（单帧闪现，P2-5）；
  // layout 阶段同步 begin 覆盖后，首帧即 void_round，GameOverModal 不再闪现。
  useLayoutEffect(() => {
    const player = playerRef.current!;
    const started = player.start(voidTriggerEvent);
    if (!started) return undefined;
    // 消费后缓存跳转信息（阶段 3 渲染最终季与「前进 N」用）
    if (voidTriggerEvent) {
      setJourney(buildVoidJourney(voidTriggerEvent.k, voidTriggerEvent.prevSeason, voidTriggerEvent.nextSeason));
    }
    setPhase(1);
    setVisible(true);
    return () => player.cancel();
  }, [voidTriggerEvent]);

  // 卸载兜底：动画被打断（reset / 回到开局界面）时恢复真实状态，不留残留
  useEffect(() => () => {
    useGameStore.getState().endVoidRoundAnimation();
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`absolute inset-0 z-[70] overflow-hidden ${
        phase >= 3 ? 'bg-slate-950/80 backdrop-blur-sm' : ''
      }`}
      role="status"
      aria-label="时间吞噬动画"
      // 默认 pointer-events 即 auto：全屏吞掉点击，动画期间玩家操作不响应
    >
      {/* 阶段 1/2：空亡牌已渲染在真实公共牌池（PublicCards 按 voidPoolSlot 并列展示，
          与真实公共牌同时出现、同骨架同尺寸）；吞噬环在 VoidPoolCard 自身容器内从
          牌位中心扩散（天然对齐）。本覆盖层透明，阶段 3/4 才全屏暗化聚焦。 */}

      {/* 阶段 1/2 文案：牌池下方小字（透明覆盖层上直接可见，深色胶囊保证浅底可读） */}
      {(phase === 1 || phase === 2) && (
        <div className="absolute inset-x-0 top-[52%] text-center select-none">
          {phase === 1 ? (
            <div className="inline-block rounded-full bg-violet-900/80 px-4 py-1.5 text-xs tracking-[0.3em] text-violet-100">
              空亡现世 · 灵池异动
            </div>
          ) : (
            <div className="inline-block rounded-full bg-slate-900/80 px-4 py-1.5 text-xs tracking-[0.35em] text-slate-200">
              时间被吞噬
            </div>
          )}
        </div>
      )}

      {/* 阶段 3/4：全屏居中容器（跳转最终季 + 收尾） */}
      <div className="absolute inset-0 flex items-center justify-center select-none">
        <div className="text-center px-6">
          {/* 阶段 3：最终季节大字号 + 「前进 N 个季节回合」（N = K，用户拍板公布） */}
          {phase === 3 && journey && (
            <div>
              <div
                className="void-jump-word text-6xl font-bold font-serif tracking-[0.2em]"
                style={{ color: VOID_SEASON_COLOR[journey.to] ?? '#e2e8f0' }}
              >
                至 · {seasonDisplay(journey.to)}
              </div>
              <div className="void-jump-sub mt-5 text-sm tracking-widest text-slate-300">
                前进 {journey.advanced} 个季节回合
              </div>
            </div>
          )}

          {/* 阶段 4：收尾语 + 底部小字 */}
          {phase === 4 && (
            <div>
              <div className="void-finale-word text-4xl font-bold font-serif tracking-[0.25em] text-slate-200">
                现世已易
              </div>
              <div className="mt-7 text-xs tracking-widest text-slate-500">时光流尽 · 万物更替</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
