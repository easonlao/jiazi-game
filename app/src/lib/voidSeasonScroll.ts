/**
 * V5 空亡触发动画·季节跳转信息（票 08，2026-08-14 用户拍板重构）。
 *
 * 纯函数：从一次空亡触发的 {k, prevSeason, nextSeason} 生成跳转信息 VoidJourney：
 * - advanced = K（季节时钟步数）。阶段 3「跳转到最终季节」展示「前进 N 个季节回合」，
 *   N 即此值——用户拍板在空亡动画中公布 K（旧约束「不公布 K」仅保留于 Toast/其他 UI）；
 * - segments = 从 prevSeason 到 nextSeason 沿季节轮的真实转换段序列，**不循环**；
 *   同季未跨季（prev === next）时为空数组（无段可滚，直接展示最终季）。
 *
 * 旧实现 buildVoidSeasonScroll 以 K 张轮播字幕卡表达「时间被吞」，恰逢换季且 K 大时
 * 「秋去·冬来」连续重复造成"一直弹"观感，且与 SeasonTransition 叠加；现改为固定时长
 * 四阶段动画（先展示空亡牌 → 吞噬特效 → 跳转最终季 + 前进 N → 收尾），不再按 K 轮播。
 */

/** 季节轮顺序（固定从春起，与 SeasonCycle.seasonOrder 一致）。 */
export const VOID_SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;

/** 空亡跳转信息。 */
export interface VoidJourney {
  /** 吞噬前的季节（spring/summer/autumn/winter） */
  from: string;
  /** 吞噬后的季节（spring/summer/autumn/winter） */
  to: string;
  /** 季节时钟步数 K（阶段 3「前进 N 个季节回合」，N 即此值；非有限值回退 1） */
  advanced: number;
  /**
   * 从 prevSeason 到 nextSeason 的唯一真实转换段（不循环）。
   * 例：spring→autumn → [{spring,summer},{summer,autumn}]。
   * 同季未跨季（prev === next）时为空数组（无段可滚，直接展示最终季）。
   */
  segments: { from: string; to: string }[];
}

/**
 * 生成空亡跳转信息。
 * @param k 季节时钟步数（K；NaN/Infinity 回退 1）
 * @param prevSeason 吞噬前的季节（spring/summer/autumn/winter）
 * @param nextSeason 吞噬后的季节
 */
export function buildVoidJourney(k: number, prevSeason: string, nextSeason: string): VoidJourney {
  // 防御非有限数值（NaN/±Infinity 会产出非法 advanced）：沿用旧实现回退 1
  const advanced = Number.isFinite(k) ? Math.max(1, Math.floor(k)) : 1;
  const fromIdx = VOID_SEASON_ORDER.indexOf(prevSeason as (typeof VOID_SEASON_ORDER)[number]);
  const toIdx = VOID_SEASON_ORDER.indexOf(nextSeason as (typeof VOID_SEASON_ORDER)[number]);

  // 只含真实转换段，不循环；同季未跨季（两者合法且相等）时为空数组。
  let segments: { from: string; to: string }[] = [];
  if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
    const n = (toIdx - fromIdx + 4) % 4;
    for (let i = 0; i < n; i++) {
      segments.push({
        from: VOID_SEASON_ORDER[(fromIdx + i) % 4],
        to: VOID_SEASON_ORDER[(fromIdx + i + 1) % 4],
      });
    }
  } else if (fromIdx < 0 || toIdx < 0) {
    // 防御：季节名非法时兜底为春→夏（保留旧实现兜底语义）
    segments = [{ from: 'spring', to: 'summer' }];
  }

  return { from: prevSeason, to: nextSeason, advanced, segments };
}
