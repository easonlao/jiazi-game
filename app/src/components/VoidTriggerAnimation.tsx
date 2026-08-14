import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import {
  createVoidAnimationPlayer,
  VOID_STEP_MS,
  VOID_HOLD_MS,
  type VoidAnimationPlayer,
} from '../lib/voidAnimationPlayer';
import { buildVoidCountdown, type VoidCountdownStep } from '../lib/voidSeasonScroll';

/**
 * V5 空亡触发动画·K 步数字倒数时间线（票 08，2026-08-14 用户拍板重构）。
 *
 * 由 store 的 voidTriggerEvent（id 递增）驱动，空亡牌触发时播「四阶段 + K 步倒数」：
 *   阶段 1「空亡现世」0.9s：暗色覆盖层中央渲染空亡牌卡面（☰ 空亡 + 时间吞噬 · 非交易品，
 *     与 CardVisual 空亡分支一致）+ 下方小字「空亡现世」；
 *   阶段 2「吞噬」0.7s：暗色环从中心向外扩散（voidSwallow），传达「时间被吞」；
 *   阶段 3「K 步倒数」K×0.38s：**剩余 K 大数字逐一扣减（12→11→…→1→0）** + 下方
 *     **当前位置逐回合递增**（季节名 + 季内回合数，如 夏3→夏4→…→夏7→秋1→秋2…，
 *     跨季自动切换季节名）——位置数据来自引擎给的全轨迹 path（每步一个位置）；
 *   阶段 3.5「K 归 0 停留」0.6s：停在最终季节和回合数（剩余 0），让玩家看清落点；
 *   阶段 4「收尾」1s：「现世已易」+ 底部小字，淡出回到游戏。
 * 目的（用户反馈）：旧「季节快进字幕」轮播跨季时跳跃感强；数字倒数让玩家清晰看到
 * 「空亡加速了多少步、从哪到哪」，消除跨季跳跃感。
 *
 * - K 值在动画中展示（用户拍板：空亡动画公布 K；Toast/其他 UI 仍不显示 K）；
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

/** 动画阶段：1 空亡现世 / 2 吞噬 / 3 K 步倒数（含归零停留）/ 4 收尾。 */
type VoidPhase = 1 | 2 | 3 | 4;

export function VoidTriggerAnimation() {
  const voidTriggerEvent = useGameStore((s) => s.voidTriggerEvent);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<VoidPhase>(1);
  /** 阶段 3 倒数序列：每步 { season, roundInSeason, remaining }（长度 = 引擎 path 长度 = K）。 */
  const [countdown, setCountdown] = useState<VoidCountdownStep[]>([]);
  /** 当前倒数步索引（null = 未开始）；每步递增，位置/剩余 K 随步更新。 */
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  /** K 归 0 停留态：剩余 0 + 停在最终季节和回合数（onZero → onFinale 之间的短暂停留）。 */
  const [zeroed, setZeroed] = useState(false);

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
      onStep: (index) => {
        // 阶段 3 倒数：显示第 index 步的位置（季节名 + 季内回合数）与剩余 K（k - index）
        setPhase(3);
        setStepIndex(index);
        setZeroed(false);
      },
      onZero: () => {
        // K 归 0：停在最终季节和回合数（短暂停留后收尾）
        setZeroed(true);
      },
      onFinale: () => setPhase(4),
      onEnd: () => {
        setVisible(false);
        setPhase(1);
        setStepIndex(null);
        setZeroed(false);
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
    // 消费后缓存倒数序列（阶段 3 逐回合渲染「剩余 K + 当前位置」用）；
    // 引擎已给 K 步完整轨迹 path，不再用季节轮播推导跳转段。
    if (voidTriggerEvent) {
      setCountdown(buildVoidCountdown(voidTriggerEvent.path, voidTriggerEvent.k));
    }
    setPhase(1);
    setStepIndex(null);
    setZeroed(false);
    setVisible(true);
    return () => player.cancel();
  }, [voidTriggerEvent]);

  // 卸载兜底：动画被打断（reset / 回到开局界面）时恢复真实状态，不留残留
  useEffect(() => () => {
    useGameStore.getState().endVoidRoundAnimation();
  }, []);

  if (!visible) return null;

  // 阶段 3 渲染数据：剩余 K 与当前位置（归零停留时停在最终位置）。
  // stepIndex 未开始（防御）时取序列首步，避免空指针。
  const lastStep = countdown[countdown.length - 1];
  const currentStep = zeroed
    ? lastStep
    : countdown[Math.min(Math.max(stepIndex ?? 0, 0), Math.max(countdown.length - 1, 0))];
  const remainingK = zeroed ? 0 : (stepIndex !== null && currentStep ? currentStep.remaining : countdown.length);

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

      {/* 阶段 3/4：全屏居中容器（K 步倒数 + 收尾） */}
      <div className="absolute inset-0 flex items-center justify-center select-none">
        <div className="text-center px-6">
          {/* 阶段 3：剩余 K 大数字逐一扣减（12→11→…→1→0）+ 下方当前位置逐回合递增。
              key 随步变化触发跳动动画重播（时长 = VOID_STEP_MS，与步进同步）。 */}
          {phase === 3 && currentStep && (
            <div>
              <div
                key={`k-${zeroed ? 'zero' : stepIndex ?? 0}`}
                className={`void-count-num text-8xl font-bold font-serif leading-none ${
                  zeroed ? 'void-count-zero' : ''
                }`}
                style={{
                  color: VOID_SEASON_COLOR[currentStep.season] ?? '#e2e8f0',
                  animationDuration: `${zeroed ? VOID_HOLD_MS : VOID_STEP_MS}ms`,
                }}
              >
                {remainingK}
              </div>
              <div className="void-count-pos mt-4 text-xs tracking-[0.45em] text-slate-400">
                {zeroed ? '吞噬完成 · 时光定格' : `剩余 ${remainingK} 步`}
              </div>
              {/* 当前位置：季节名（中文）+ 季内回合数，逐回合递增；跨季切换季节名 */}
              <div
                key={`pos-${zeroed ? 'zero' : stepIndex ?? 0}`}
                className="void-count-pos mt-7 text-3xl font-semibold tracking-[0.25em]"
                style={{
                  color: VOID_SEASON_COLOR[currentStep.season] ?? '#e2e8f0',
                  animationDuration: `${VOID_STEP_MS}ms`,
                }}
              >
                {seasonDisplay(currentStep.season)} · {currentStep.roundInSeason}
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
