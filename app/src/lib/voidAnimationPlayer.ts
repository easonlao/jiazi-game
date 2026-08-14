/**
 * 空亡动画编排器（批 2 票 08 / P1-1；2026-08-14 用户拍板重构为四阶段固定时间线）。
 *
 * 把 VoidTriggerAnimation 的「去重 + 定时器调度 + StrictMode 安全」从组件里抽出来，
 * 变成可单元测试的控制器：
 * - start(event)：消费一个触发事件并调度四阶段动画（展示空亡牌 → 吞噬 → 跳转最终季 →
 *   收尾 → 结束）。同一 id 只消费一次（去重）。
 * - cancel()：React effect cleanup 语义——清定时器并把消费锚点归零。
 *   StrictMode 开发模式按「setup → cleanup → setup」执行 effect：第一次 setup 消费后，
 *   cleanup 若不归零锚点，第二次 setup 会被去重跳过、不再重排定时器，覆盖层永久卡住
 *   （P1-1 回归：开局首回合被吞噬时组件「带着非空事件挂载」触发）。cancel 归零后
 *   第二次 setup 可重新消费并重排，阶段回调幂等，动画正常播完。
 * - dispose()：卸载兜底，只清定时器。
 *
 * 时间线固定四阶段，总时长不随 K 变化（K 只影响阶段 3 展示的「前进 N」数字）：
 *   阶段 1 空亡牌展示（0.9s）→ 阶段 2 吞噬特效（0.7s）→ 阶段 3 跳转最终季（1.5s）
 *   → 阶段 4 收尾「现世已易」（1s，含淡出）。
 */
import type { FxVoidTriggerEvent } from '../store/fx-events';

/** 阶段 1：空亡牌展示（覆盖层中央渲染虚空风格空亡牌 + 「空亡现世」）。 */
export const VOID_REVEAL_MS = 900;
/** 阶段 2：吞噬特效（暗色扩散/漩涡，从牌位置向外扩散）。 */
export const VOID_SWALLOW_MS = 700;
/** 阶段 3：跳转到最终季节（大字号最终季 + 「前进 N 个季节回合」，N = K）。 */
export const VOID_JUMP_MS = 1500;
/** 阶段 4：收尾语「现世已易」（约 1s，含淡出）。 */
export const VOID_FINALE_MS = 1000;
/** 总时长：固定约 4.1s，不随 K 变化。 */
export const VOID_TOTAL_MS = VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_JUMP_MS + VOID_FINALE_MS;

/** 动画各阶段回调（由组件接入 store 动作与 React 状态）。 */
export interface VoidAnimationHandlers {
  /** 阶段 1 开始：组件置 visible=true 并调 store.beginVoidRoundAnimation（gameState→void_round）。 */
  onReveal: () => void;
  /** 阶段 2 开始：吞噬特效。 */
  onSwallow: () => void;
  /** 阶段 3 开始：跳转到最终季节 + 「前进 N 个季节回合」。 */
  onJump: () => void;
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
      timers.push(setTimeout(handlers.onSwallow, VOID_REVEAL_MS));
      timers.push(setTimeout(handlers.onJump, VOID_REVEAL_MS + VOID_SWALLOW_MS));
      timers.push(setTimeout(handlers.onFinale, VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_JUMP_MS));
      timers.push(setTimeout(handlers.onEnd, VOID_TOTAL_MS));
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
