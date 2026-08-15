/**
 * 空亡动画编排器（批 2 票 08 / P1-1；票 01 重构为「掷骰 + K 步倒数 + 队列连播」时间线）。
 *
 * 把 VoidTriggerAnimation 的「去重 + 定时器调度 + StrictMode 安全 + 队列连播」从组件里
 * 抽出来，变成可单元测试的控制器：
 * - start(events)：消费触发事件队列并调度动画（每张空亡牌：现世 → 吞噬 → 掷骰 →
 *   K 步倒数 → 归零停留 → 收尾）。同一 id 只消费一次（去重）；当前张播完后若队列仍有
 *   下一张则自动接播（下一张同样掷骰），全部播完才触发一次最终 onEnd。
 * - cancel()：React effect cleanup 语义——清定时器 + 消费锚点归零 + 清残留队列。
 *   StrictMode 开发模式按「setup → cleanup → setup」执行 effect：第一次 setup 消费后，
 *   cleanup 若不归零锚点，第二次 setup 会被去重跳过、不再重排定时器，覆盖层永久卡住
 *   （P1-1 回归：开局首回合被吞噬时组件「带着非空事件挂载」触发）。cancel 归零后
 *   第二次 setup 可重新消费并重排，阶段回调幂等，动画正常播完。
 * - dispose()：卸载兜底，只清定时器。
 *
 * 时间线（2026-08-14 用户拍板数字倒数；2026-08-15 用户追加 v2 掷骰/光点汇入）：
 *   阶段 1 空亡牌展示（0.9s）→ 阶段 2 吞噬特效（0.7s）→ 掷骰（1.2s：大数字飞速轮转
 *   减速停在 K）→ 阶段 3 K 步倒数（每帧 0.38s，帧数 = K+1：起点帧剩余 K 显示触发前位置，
 *   随后每步剩余 -1、位置 +1，直到剩余 0 = 最终位置；每减 1 一个光点飞向季节位置汇入）→
 *   K 归 0 停留（0.6s）→ 阶段 4 收尾「现世已易」（1s，含淡出）。
 *   单张总时长随 K 线性增长（K=8 ≈ 7.4s，K=2 ≈ 5.2s）；多张连触逐张接播（每张完整
 *   四阶段 + 掷骰），总时长 = 各张之和。
 */
import type { FxVoidTriggerEvent } from '../store/fx-events';

/** 阶段 1：空亡牌展示（覆盖层中央渲染虚空风格空亡牌 + 「空亡现世」）。 */
export const VOID_REVEAL_MS = 900;
/** 阶段 2：吞噬特效（暗色扩散/漩涡，从牌位置向外扩散）。 */
export const VOID_SWALLOW_MS = 700;
/**
 * 掷骰阶段（票 01 v2）：K 确定前大数字快速轮转（数字在 2~8 间快速跳动，展示层
 * 独立随机/预设序列，绝不消耗引擎种子随机源），约 1.2s 后减速停在最终 K 值上。
 */
export const VOID_DICE_MS = 1200;
/**
 * 阶段 3 倒数：每帧固定时长（0.38s/帧；帧数 = K+1，起点帧 + K 步）。
 * 每帧触发一次 onStep(index)：显示第 index 帧的位置（season/roundInSeason）与剩余 K。
 */
export const VOID_STEP_MS = 380;
/** K 归 0 后的停留时长：停在最终季节和回合数（短暂停留）再收尾。 */
export const VOID_HOLD_MS = 600;
/** 阶段 4：收尾语「现世已易」（约 1s，含淡出）。 */
export const VOID_FINALE_MS = 1000;

/** 单张总时长：随 K 线性增长（(K+1) × 单帧 + 固定五段/归零停留）。 */
export function voidTotalMs(stepCount: number): number {
  const steps = Number.isFinite(stepCount) ? Math.max(1, Math.floor(stepCount)) : 1;
  return VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_DICE_MS + steps * VOID_STEP_MS + VOID_HOLD_MS + VOID_FINALE_MS;
}

/** 动画各阶段回调（由组件接入 store 动作与 React 状态）。 */
export interface VoidAnimationHandlers {
  /**
   * 阶段 1 开始（每张空亡牌各触发一次）：组件置 visible=true 并调
   * store.beginVoidRoundAnimation（gameState→void_round）；携带该张事件供组件
   * 缓存该张的倒数序列（含起点帧）与掷骰目标 K。
   */
  onReveal: (event: FxVoidTriggerEvent) => void;
  /** 阶段 2 开始：吞噬特效。 */
  onSwallow: () => void;
  /** 掷骰阶段开始：大数字轮转约 VOID_DICE_MS 后减速停在最终 K（展示层渲染）。 */
  onDiceStart: () => void;
  /**
   * 阶段 3 倒数：第 index 帧（0..k，共 k+1 帧 = 起点帧 + K 步推进）。
   * 组件显示第 index 帧的位置与剩余 K（index=0 为起点帧：触发前位置 + 剩余 K）。
   */
  onStep: (index: number) => void;
  /** K 归 0：倒数结束，进入归零停留（显示剩余 0 + 最终位置，短暂停留后收尾）。 */
  onZero: () => void;
  /** 阶段 4 开始：收尾语「现世已易」。 */
  onFinale: () => void;
  /** 队列全部播完的最终结束：组件置 visible=false 并调 store.endVoidRoundAnimation（恢复真实状态）。 */
  onEnd: () => void;
}

export interface VoidAnimationPlayer {
  /**
   * 消费触发事件队列并调度动画；同一 id 去重（已消费/正在消费的不重播）。
   * 返回是否开始了新动画（false = 队列空 / 无未消费事件）。
   */
  start(events: FxVoidTriggerEvent[] | FxVoidTriggerEvent | null | undefined): boolean;
  /** cleanup 语义：清定时器 + 消费锚点归零 + 清残留队列（StrictMode 二次 setup 可重新消费）。 */
  cancel(): void;
  /** 卸载兜底：只清定时器。 */
  dispose(): void;
}

/**
 * 倒数帧数：K + 1（起点帧显示剩余 K + 触发前位置，随后 K 步推进剩余递减到 0）。
 * K 以引擎 path 长度为准（正常 = k）；path 缺失时回退 k（防御，至少 1 帧起点）。
 */
function stepCountOf(event: FxVoidTriggerEvent): number {
  const fromPath = event.path?.length ?? 0;
  const fromK = Number.isFinite(event.k) ? Math.floor(event.k) : 0;
  const k = Math.max(1, fromPath > 0 ? fromPath : fromK);
  return k + 1;
}

export function createVoidAnimationPlayer(handlers: VoidAnimationHandlers): VoidAnimationPlayer {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let lastEventId = 0;
  /** 待播队列（start 时快照未消费事件；当前张播完后自动接播下一张）。 */
  let queue: FxVoidTriggerEvent[] = [];

  function clearTimers(): void {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  /** 编排一张空亡牌的时间线；isLast 为真时在收尾后触发最终 onEnd，否则自动接播下一张。 */
  function scheduleCard(event: FxVoidTriggerEvent, isLast: boolean): void {
    const stepCount = stepCountOf(event);
    const countdownStart = VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_DICE_MS;
    handlers.onReveal(event);
    timers.push(setTimeout(handlers.onSwallow, VOID_REVEAL_MS));
    timers.push(setTimeout(handlers.onDiceStart, VOID_REVEAL_MS + VOID_SWALLOW_MS));
    // K 步倒数：每帧 VOID_STEP_MS，逐步 onStep(index)；归零停留 VOID_HOLD_MS 后收尾。
    for (let i = 0; i < stepCount; i++) {
      timers.push(setTimeout(() => handlers.onStep(i), countdownStart + i * VOID_STEP_MS));
    }
    timers.push(setTimeout(handlers.onZero, countdownStart + stepCount * VOID_STEP_MS));
    timers.push(setTimeout(handlers.onFinale, countdownStart + stepCount * VOID_STEP_MS + VOID_HOLD_MS));
    const cardEndAt = voidTotalMs(stepCount);
    if (isLast) {
      timers.push(setTimeout(() => handlers.onEnd(), cardEndAt));
    } else {
      // 本张完整播完（含收尾）后自动接播下一张（下一张同样从现世/掷骰开始）
      timers.push(setTimeout(() => {
        const next = queue.shift();
        if (next) scheduleCard(next, queue.length === 0);
      }, cardEndAt));
    }
  }

  return {
    start(events) {
      const list = Array.isArray(events) ? events : events ? [events] : [];
      // 去重：只消费 id > lastEventId 的事件（已消费/正在消费的不重播）
      const fresh = list.filter((e) => e.id > lastEventId);
      if (fresh.length === 0) return false;
      // 防御：新事件到来时清掉旧动画残留定时器
      clearTimers();
      queue = [...fresh];
      lastEventId = queue[queue.length - 1]!.id;
      const first = queue.shift()!;
      scheduleCard(first, queue.length === 0);
      return true;
    },
    cancel() {
      clearTimers();
      // StrictMode 语义：锚点归零 + 清残留队列，让二次 setup 能重新消费同一事件
      queue = [];
      lastEventId = 0;
    },
    dispose() {
      clearTimers();
    },
  };
}
