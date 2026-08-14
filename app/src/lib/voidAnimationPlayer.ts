/**
 * 空亡动画编排器（批 2 票 08 / P1-1；2026-08-14 用户拍板重构为 K 步数字倒数时间线）。
 *
 * 把 VoidTriggerAnimation 的「去重 + 定时器调度 + StrictMode 安全」从组件里抽出来，
 * 变成可单元测试的控制器：
 * - start(event)：消费一个触发事件并调度动画（空亡牌现身 → 吞噬 → K 步倒数 → 归零停留 →
 *   收尾 → 结束）。同一 id 只消费一次（去重）。
 * - cancel()：React effect cleanup 语义——清定时器并把消费锚点归零。
 *   StrictMode 开发模式按「setup → cleanup → setup」执行 effect：第一次 setup 消费后，
 *   cleanup 若不归零锚点，第二次 setup 会被去重跳过、不再重排定时器，覆盖层永久卡住
 *   （P1-1 回归：开局首回合被吞噬时组件「带着非空事件挂载」触发）。cancel 归零后
 *   第二次 setup 可重新消费并重排，阶段回调幂等，动画正常播完。
 * - dispose()：卸载兜底，只清定时器。
 *
 * 时间线（2026-08-14 用户拍板：数字倒数替代季节快进字幕轮播）：
 *   阶段 1 空亡牌展示（0.9s）→ 阶段 2 吞噬特效（0.7s）→ 阶段 3 K 步倒数（每步 0.38s：
 *   剩余 K 大数字逐一扣减 + 下方当前位置逐回合递增，步数 = 引擎 path 长度 = K）→
 *   K 归 0 停留（0.6s，停在最终季节和回合数）→ 阶段 4 收尾「现世已易」（1s，含淡出）。
 *   总时长随 K 线性增长（K=12 ≈ 7.8s，K=2 ≈ 4.0s）——玩家清晰看到「空亡加速了多少步」。
 */
import type { FxVoidTriggerEvent } from '../store/fx-events';

/** 阶段 1：空亡牌展示（覆盖层中央渲染虚空风格空亡牌 + 「空亡现世」）。 */
export const VOID_REVEAL_MS = 900;
/** 阶段 2：吞噬特效（暗色扩散/漩涡，从牌位置向外扩散）。 */
export const VOID_SWALLOW_MS = 700;
/**
 * 阶段 3 倒数：每步固定时长（0.38s/步；K=12 约 4.6s，K=2 约 0.8s）。
 * 每步触发一次 onStep(index)：显示第 index 步的位置（season/roundInSeason）与剩余 K。
 */
export const VOID_STEP_MS = 380;
/** K 归 0 后的停留时长：停在最终季节和回合数（短暂停留）再收尾。 */
export const VOID_HOLD_MS = 600;
/** 阶段 4：收尾语「现世已易」（约 1s，含淡出）。 */
export const VOID_FINALE_MS = 1000;

/** 总时长：随 K 线性增长（K × 单步时长 + 固定四阶段/归零停留）。 */
export function voidTotalMs(stepCount: number): number {
  const steps = Number.isFinite(stepCount) ? Math.max(1, Math.floor(stepCount)) : 1;
  return VOID_REVEAL_MS + VOID_SWALLOW_MS + steps * VOID_STEP_MS + VOID_HOLD_MS + VOID_FINALE_MS;
}

/** 动画各阶段回调（由组件接入 store 动作与 React 状态）。 */
export interface VoidAnimationHandlers {
  /** 阶段 1 开始：组件置 visible=true 并调 store.beginVoidRoundAnimation（gameState→void_round）。 */
  onReveal: () => void;
  /** 阶段 2 开始：吞噬特效。 */
  onSwallow: () => void;
  /**
   * 阶段 3 倒数：第 index 步（index 0..stepCount-1，步数 = path.length = k）。
   * 组件显示第 index 步的位置（path[index] 的 season/roundInSeason）与剩余 K（k - index）。
   */
  onStep: (index: number) => void;
  /** K 归 0：倒数结束，进入归零停留（显示剩余 0 + 最终位置，短暂停留后收尾）。 */
  onZero: () => void;
  /** 阶段 4 开始：收尾语「现世已易」。 */
  onFinale: () => void;
  /** 动画结束：组件置 visible=false 并调 store.endVoidRoundAnimation（恢复真实状态）。 */
  onEnd: () => void;
}

export interface VoidAnimationPlayer {
  /** 消费一个触发事件并调度动画；同一 id 去重。返回是否开始了新动画。 */
  start(event: FxVoidTriggerEvent | null | undefined): boolean;
  /** cleanup 语义：清定时器 + 消费锚点归零（StrictMode 二次 setup 可重新消费）。 */
  cancel(): void;
  /** 卸载兜底：只清定时器。 */
  dispose(): void;
}

/** 倒数步数：以引擎 path 长度为准（正常 = k）；path 缺失时回退 k（防御，至少 1 步）。 */
function stepCountOf(event: FxVoidTriggerEvent): number {
  const fromPath = event.path?.length ?? 0;
  const fromK = Number.isFinite(event.k) ? Math.floor(event.k) : 0;
  return Math.max(1, fromPath > 0 ? fromPath : fromK);
}

export function createVoidAnimationPlayer(handlers: VoidAnimationHandlers): VoidAnimationPlayer {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let lastEventId = 0;

  function clearTimers(): void {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  return {
    start(event) {
      if (!event || event.id === lastEventId) return false;
      lastEventId = event.id;
      // 防御：新事件到来时清掉旧动画残留定时器
      clearTimers();
      handlers.onReveal();
      const stepCount = stepCountOf(event);
      const countdownStart = VOID_REVEAL_MS + VOID_SWALLOW_MS;
      timers.push(setTimeout(handlers.onSwallow, VOID_REVEAL_MS));
      // K 步倒数：每步 VOID_STEP_MS，逐步 onStep(index)；归零停留 VOID_HOLD_MS 后收尾。
      for (let i = 0; i < stepCount; i++) {
        timers.push(setTimeout(() => handlers.onStep(i), countdownStart + i * VOID_STEP_MS));
      }
      timers.push(setTimeout(handlers.onZero, countdownStart + stepCount * VOID_STEP_MS));
      timers.push(setTimeout(handlers.onFinale, countdownStart + stepCount * VOID_STEP_MS + VOID_HOLD_MS));
      timers.push(setTimeout(handlers.onEnd, voidTotalMs(stepCount)));
      return true;
    },
    cancel() {
      clearTimers();
      // StrictMode 语义：锚点归零，让二次 setup 能重新消费同一事件
      lastEventId = 0;
    },
    dispose() {
      clearTimers();
    },
  };
}
