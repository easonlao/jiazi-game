/**
 * 跨回合买入结算动画的共享参数与几何快照助手。
 *
 * 时间轴：买入确认 → 卡牌飞行（BUY_FLIGHT_MS）→ 纳灵耗神文字（BUY_COST_MS）→
 * 既有持仓结算序列（炼化光点 / 耗神 / 反噬 / 回神）。SettlementAnimation 与 QiBar
 * 用 BUY_SEQUENCE_TOTAL_MS 作为启动延迟，避免两段动画抢镜。
 */
export const BUY_FLIGHT_MS = 900;
export const BUY_COST_MS = 650;
export const BUY_SEQUENCE_TOTAL_MS = BUY_FLIGHT_MS + BUY_COST_MS;

/** 是否启用动效（prefers-reduced-motion 用户跳过，结算仍正常展示数字）。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 快照公共牌在行动前的 view 中心坐标。
 *
 * 买入确认后公共牌会被立即移除（新回合渲染时无法再定位它），而手牌状态也
 * 已经更新——因此必须在「执行买入前」捕获源几何。无 DOM 环境（node 测试）返回 null。
 */
export function captureBuySourceGeometry(
  publicCardIndex: number,
): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(
    `[data-public-card-index="${publicCardIndex}"]`,
  );
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
