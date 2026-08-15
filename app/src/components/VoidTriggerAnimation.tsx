import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, seasonDisplay } from '../store';
import {
  createVoidAnimationPlayer,
  VOID_DICE_MS,
  VOID_STEP_MS,
  VOID_HOLD_MS,
  type VoidAnimationPlayer,
} from '../lib/voidAnimationPlayer';
import { buildVoidCountdown, type VoidCountdownStep } from '../lib/voidSeasonScroll';
import type { FxVoidTriggerEvent } from '../store/fx-events';

/**
 * V5 空亡触发动画·掷骰 + K 步倒数 + 队列连播（票 08 重构 + 票 01 队列化/掷骰/光点）。
 *
 * 由 store 的 voidTriggerQueue（id 递增事件队列）驱动。每张空亡牌完整播：
 *   阶段 1「空亡现世」0.9s：暗色覆盖层中央渲染空亡牌卡面（☰ 空亡 + 时间吞噬 · 非交易品，
 *     与 CardVisual 空亡分支一致）+ 下方小字「空亡现世」；
 *   阶段 2「吞噬」0.7s：暗色环从中心向外扩散（voidSwallow），传达「时间被吞」；
 *   阶段 3「掷骰」1.2s：大数字飞速轮转（2~8 展示层独立随机，绝不消耗引擎种子随机源），
 *     约 1.2s 后减速停在最终 K 值上（掷骰感）；
 *   阶段 4「K 步倒数」K+1 帧 × 0.38s：起点帧显示剩余 K + 该张触发前位置（当前回合），
 *     随后每帧剩余 -1、位置 +1（跨季自动切换季节名）；每减 1 一个光点从数字处飞向
 *     季节位置汇入（光点到达时位置切换 + 微光脉冲）；
 *   阶段 4.5「K 归 0 停留」0.6s：停在最终季节和回合数（剩余 0）；
 *   阶段 5「收尾」1s：「现世已易」+ 底部小字，淡出回到游戏。
 * 阶段 3/4 共用同一「数字面板」（大数字 + 文案行 + 位置行 + 光点），背景自阶段 3 起
 * 统一暗化；掷骰停定（K）与倒数起点帧（剩余 K、同一位置）共用渲染 key 且无动画类，
 * 数字静态承接不重播——掷骰 → 倒数过渡连贯无闪断（2026-08-15 用户反馈「割裂」修复）。
 * 多张连触：队列逐张消费，第一张完整播完自动接播第二张（第二张同样掷骰），全部播完
 * 才 endVoidRoundAnimation 恢复游戏状态——无覆盖、无同屏叠加、无起点跳跃。
 *
 * - K 值在动画中展示（用户拍板：空亡动画公布 K；Toast/其他 UI 仍不显示 K）；
 * - 复用 SeasonTransition 的季节色语言，但用暗色虚空主题（与 CardVisual 空亡牌一致）；
 * - 本覆盖层默认指针拦截，动画期间玩家操作全部被吞（吞噬回合不可行动）。
 *
 * P1-1（StrictMode）：开局首回合被吞噬时组件「带着非空事件挂载」，StrictMode 开发模式
 * 按 setup→cleanup→setup 重放 effect。编排逻辑集中在 createVoidAnimationPlayer：
 * 动画 effect 的 cleanup 调 player.cancel()（清定时器 + 消费锚点归零 + 清残留队列），
 * 二次 setup 重新消费并重排定时器；`[]` 兜底 effect 只负责恢复 gameState，不留残留。
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

/** 掷骰阶段轮转数字范围（与 K 一致：当前上限 8；目标 K 更大时扩到 K，保证停在 K 上是轮转域内）。 */
const VOID_DICE_MIN = 2;
const VOID_DICE_MAX = 8;
/** 掷骰阶段减速节奏：起始间隔 / 每次增长 / 封顶间隔（间隔递增 → 视觉减速）。 */
const VOID_DICE_START_DELAY = 40;
const VOID_DICE_DELAY_GROWTH = 1.16;
const VOID_DICE_DELAY_STEP = 4;
const VOID_DICE_MAX_DELAY = 220;
/** 掷骰轮转数字的随机闪烁色（四季节色循环，与倒数的季节色区分——未定感）。 */
const VOID_DICE_ROLL_COLORS = ['#fca5a5', '#fcd34d', '#7dd3fc', '#6ee7b7'];

/** 动画阶段：1 空亡现世 / 2 吞噬 / 3 掷骰 / 4 K 步倒数（含归零停留）/ 5 收尾。 */
type VoidPhase = 1 | 2 | 3 | 4 | 5;

export function VoidTriggerAnimation() {
  const voidTriggerQueue = useGameStore((s) => s.voidTriggerQueue);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<VoidPhase>(1);
  /**
   * 阶段 4 倒数序列（当前张）：每步 { season, roundInSeason, remaining }，
   * 长度 = K+1（起点帧 = 触发前位置 + 剩余 K，随后递减到 0）。onReveal 时按当前张重建。
   */
  const [countdown, setCountdown] = useState<VoidCountdownStep[]>([]);
  /** 当前倒数帧索引（null = 未开始）；每帧递增，位置/剩余 K 随帧更新。 */
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  /** K 归 0 停留态：剩余 0 + 停在最终季节和回合数（onZero → onFinale 之间的短暂停留）。 */
  const [zeroed, setZeroed] = useState(false);
  /** 掷骰阶段当前展示数字（飞速轮转 → 减速停在最终 K）。 */
  const [diceValue, setDiceValue] = useState(0);
  /** 掷骰阶段目标 = 当前张的 K（onReveal 时更新）。 */
  const [diceTarget, setDiceTarget] = useState(0);
  /**
   * 掷骰已停定（数字停在 K）：倒数的起点帧与停定值同 K、位置同当前回合，
   * 共用一个渲染 key 不重播动画——掷骰 → 倒数过渡连贯（无闪断/重浮）。
   */
  const [diceSettled, setDiceSettled] = useState(false);

  // 动画编排器单例（去重 + 定时器 + 队列连播 + StrictMode 安全，逻辑可单测）
  const playerRef = useRef<VoidAnimationPlayer | null>(null);
  if (playerRef.current === null) {
    playerRef.current = createVoidAnimationPlayer({
      onReveal: (event: FxVoidTriggerEvent) => {
        useGameStore.getState().beginVoidRoundAnimation();
        // 当前张倒数序列（含起点帧：剩余 K + 触发前位置）与掷骰目标 K
        setCountdown(buildVoidCountdown(event.path, event.k, event.prevSeason, event.prevRoundInSeason));
        setDiceTarget(event.k);
      },
      onSwallow: () => {
        setPhase(2);
        // 进入吞噬阶段：空亡牌自身播放溶解动画并从牌位扩散吞噬环（VoidPoolCard 内）
        useGameStore.setState({ voidSwallowing: true });
      },
      onDiceStart: () => {
        setPhase(3);
        setStepIndex(null);
        setZeroed(false);
        setDiceSettled(false); // 新一轮掷骰：重新轮转
      },
      onStep: (index) => {
        // 阶段 4 倒数：显示第 index 帧的位置（季节名 + 季内回合数）与剩余 K
        setPhase(4);
        setStepIndex(index);
        setZeroed(false);
      },
      onZero: () => {
        // K 归 0：停在最终季节和回合数（短暂停留后收尾）
        setZeroed(true);
      },
      onFinale: () => setPhase(5),
      onEnd: () => {
        setVisible(false);
        setPhase(1);
        setStepIndex(null);
        setZeroed(false);
        // 队列全部播完：先清空队列（下一张事件从空队列重新累积），再恢复真实状态——
        // 全部播完才 endVoidRoundAnimation（票 01：多张连触期间玩家操作被吞）。
        useGameStore.setState({ voidTriggerQueue: [] });
        useGameStore.getState().endVoidRoundAnimation();
      },
    });
  }

  // 动画启动 effect：队列变化（非空）时启动/重启动画。cleanup 交给 player.cancel()——
  // StrictMode 二次 setup 依赖 cancel 把消费锚点归零才能重新调度（P1-1）。
  // 用 useLayoutEffect（paint 前同步）：终局被吞噬时若用 useEffect，首帧会先渲染
  // game_over + GameOverModal，下一帧才切 void_round 覆盖层（单帧闪现，P2-5）；
  // layout 阶段同步 begin 覆盖后，首帧即 void_round，GameOverModal 不再闪现。
  useLayoutEffect(() => {
    const player = playerRef.current!;
    const started = player.start(voidTriggerQueue);
    if (!started) return undefined;
    setPhase(1);
    setStepIndex(null);
    setZeroed(false);
    setVisible(true);
    return () => player.cancel();
  }, [voidTriggerQueue]);

  // 掷骰阶段：大数字飞速轮转 → 间隔递增（减速）→ 停在最终 K。
  // 展示层独立随机（Math.random 只驱动视觉轮转，绝不消耗引擎种子随机源，重放确定性不受影响）。
  useEffect(() => {
    if (phase !== 3) return;
    const min = VOID_DICE_MIN;
    const max = Math.max(VOID_DICE_MAX, diceTarget);
    const randomValue = () => min + Math.floor(Math.random() * (max - min + 1));
    setDiceValue(randomValue());
    let delay = VOID_DICE_START_DELAY;
    let elapsed = 0;
    let timer = 0;
    const tick = () => {
      elapsed += delay;
      if (elapsed >= VOID_DICE_MS) {
        setDiceValue(diceTarget); // 减速停在最终 K 值上
        setDiceSettled(true); // 停定：倒数的起点帧与停定值同 K，共用 key 不重播，过渡连贯
        return;
      }
      setDiceValue(randomValue());
      delay = Math.min(delay * VOID_DICE_DELAY_GROWTH + VOID_DICE_DELAY_STEP, VOID_DICE_MAX_DELAY);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
    return () => window.clearTimeout(timer);
  }, [phase, diceTarget]);

  // 卸载兜底：动画被打断（reset / 回到开局界面）时恢复真实状态，不留残留
  useEffect(() => () => {
    useGameStore.getState().endVoidRoundAnimation();
  }, []);

  if (!visible) return null;

  // 阶段 4 渲染数据：剩余 K 与当前位置（归零停留时停在最终位置）。
  // stepIndex 未开始（防御）时取序列首帧，避免空指针。
  const lastStep = countdown[countdown.length - 1];
  const currentStep = zeroed
    ? lastStep
    : countdown[Math.min(Math.max(stepIndex ?? 0, 0), Math.max(countdown.length - 1, 0))];
  const remainingK = zeroed ? 0 : (stepIndex !== null && currentStep ? currentStep.remaining : countdown.length);
  /** 光点：每减 1（帧 >= 1）一个光点从数字处飞向季节位置汇入（与数字递减同步）。 */
  const showDot = !zeroed && (stepIndex ?? 0) >= 1 && currentStep !== undefined;
  /** 掷骰阶段下方显示的「当前位置」= 起点帧（该张触发前位置，与倒数起点一致）。 */
  const dicePos = countdown[0] ?? lastStep;

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
          牌位中心扩散（天然对齐）。本覆盖层透明，阶段 3/4/5 才全屏暗化聚焦。 */}

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

      {/* 阶段 3/4 统一数字面板：掷骰（数字轮转）→ 停定 → 倒数（逐帧递减）。
          同一布局（大数字 + 文案行 + 位置行 + 光点），阶段切换只更新内容、不重建 DOM：
          - 数字 key：轮转中随值快闪（void-dice-num）；停定与倒数起点帧共 'settled'
            且无动画类（同 K 静态承接，不重播不闪断）；递减帧随帧重播（void-count-num）；
          - 位置行：掷骰/停定/起点帧共 'pos-dice'（不重播）；递减帧随帧切换 + 光点到达微光。 */}
      {(phase === 3 || phase === 4) && (
        <div className="absolute inset-0 flex items-center justify-center select-none">
          <div className="text-center px-6">
            <div
              key={phase === 3
                ? (diceSettled ? 'settled' : `dice-${diceValue}`)
                : zeroed
                  ? 'zero'
                  : (stepIndex ?? 0) === 0
                    ? 'settled'
                    : `k-${stepIndex ?? 0}`}
              className={`${phase === 3 && !diceSettled ? 'text-6xl' : 'text-8xl'} font-bold font-serif leading-none ${
                zeroed
                  ? 'void-count-zero'
                  : phase === 3
                    ? (diceSettled ? '' : 'void-dice-num')
                    : (stepIndex ?? 0) === 0
                      ? ''
                      : 'void-count-num'
              }`}
              style={{
                // 掷骰轮转：小一号 + 随机色闪烁（未定感）；停定/倒数：季节色（确定性）。
                color: phase === 3 && !diceSettled
                  ? VOID_DICE_ROLL_COLORS[diceValue % VOID_DICE_ROLL_COLORS.length]
                  : (VOID_SEASON_COLOR[(phase === 3 ? dicePos : currentStep)?.season ?? ''] ?? '#e2e8f0'),
                // 轮转快闪用 CSS 定值 0.14s（voidDiceIn）；倒数/归零与帧进同步。
                animationDuration: `${zeroed ? VOID_HOLD_MS : phase === 3 ? 140 : VOID_STEP_MS}ms`,
              }}
            >
              {phase === 3 ? diceValue : remainingK}
            </div>
            {/* 文案行：静态随阶段切换（无重播动画——用户反馈「位置/文字闪烁」修复，
                动感只由数字跳动 + 光球飞入承担）。 */}
            <div className="mt-4 text-xs tracking-[0.45em] text-slate-400">
              {phase === 3
                ? '掷骰 · 天数将定'
                : zeroed
                  ? '吞噬完成 · 时光定格'
                  : `剩余 ${remainingK} 步`}
            </div>
            {/* 当前位置：**静态渲染不重播**（值随帧更新，无浮现/到达动画——位置不闪）。
                光点渲染在位置行容器内（relative）：从位置行上方（数字区）垂直飞入，
                落点 = 位置行自身中心，精确对齐。 */}
            <div
              className="relative mt-7 text-3xl font-semibold tracking-[0.25em]"
              style={{
                color: VOID_SEASON_COLOR[(phase === 3 ? dicePos : currentStep)?.season ?? ''] ?? '#e2e8f0',
              }}
            >
              {phase === 3
                ? (dicePos ? `${seasonDisplay(dicePos.season)} · ${dicePos.roundInSeason}` : '')
                : `${seasonDisplay(currentStep.season)} · ${currentStep.roundInSeason}`}
              {phase === 4 && showDot && (
                <span
                  key={`dot-${stepIndex ?? 0}`}
                  className="void-count-dot"
                  style={{
                    color: VOID_SEASON_COLOR[currentStep.season] ?? '#e2e8f0',
                    animationDuration: `${VOID_STEP_MS}ms`,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 阶段 5：收尾语 + 底部小字 */}
      {phase === 5 && (
        <div className="absolute inset-0 flex items-center justify-center select-none">
          <div className="text-center px-6">
            <div className="void-finale-word text-4xl font-bold font-serif tracking-[0.25em] text-slate-200">
              现世已易
            </div>
            <div className="mt-7 text-xs tracking-widest text-slate-500">时光流尽 · 万物更替</div>
          </div>
        </div>
      )}
    </div>
  );
}
