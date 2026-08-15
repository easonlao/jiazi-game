/**
 * V5 空亡触发动画·倒数序列生成（2026-08-14 用户拍板：季节快进字幕 → 数字倒数）。
 *
 * 引擎（TurnManager.processVoidRound）已给出 K 步推进的完整轨迹 path（每步一个位置
 * { season, roundInSeason }，长度 = k，终点 = nextSeason 当前季内回合）。本模块据此生成
 * 动画倒数序列：每步「剩余 K 数（从 k 倒数）+ 当前位置（季节名 + 季内回合数）」，
 * 供 VoidTriggerAnimation 阶段 3「K 步倒数」逐回合渲染。
 *
 * 旧实现 buildVoidJourney（from/to/advanced/segments）由 prev/next 两季推导「跳转最终季 +
 * 前进 N」阶段所需的跳转段；引擎给 path 后无需再推导，该函数已删除（无引用，见
 * 2026-08-14 重构说明）。
 */
import type { VoidStep } from '@core/index';

/** 倒数序列中的一步：第 index 步展示的位置与剩余 K。 */
export interface VoidCountdownStep {
  /** 第 index 步推进后所在的季节（spring/summer/autumn/winter） */
  season: string;
  /** 第 index 步推进后的季内回合数（1 起） */
  roundInSeason: number;
  /** 本步展示的剩余 K（从 k 倒数到 1；K 归 0 停留步由组件以剩余 0 显示最终位置） */
  remaining: number;
}

/**
 * 从引擎 path 生成动画倒数序列。
 *
 * 票 01（空亡动画队列重构）：在 path 前插入**起点帧**
 * `{ season: prevSeason, roundInSeason: prevRoundInSeason, remaining: k }`——
 * 倒数大数字从 K 开始、位置从该张触发前（当前回合）开始，随后每步推进 1 回合、
 * 剩余 K 递减到 0。序列长度 = k + 1（起点帧 + path 的 k 步；旧实现只从 path[0]
 * （已走 1 步后）开始，玩家看到起点跳跃）。
 *
 * @param path K 步推进的完整轨迹（引擎给出，每步一个位置，长度 = k）
 * @param k 本次吞噬的季节步数 K（NaN/Infinity 回退 1；正常与 path.length 一致）
 * @param prevSeason 该张吞噬前的季节（起点帧位置；缺省则省略起点帧，仅用于无 prev 数据的防御）
 * @param prevRoundInSeason 该张吞噬前的季内回合数（与 prevSeason 配套）
 */
export function buildVoidCountdown(
  path: VoidStep[],
  k: number,
  prevSeason?: string,
  prevRoundInSeason?: number,
): VoidCountdownStep[] {
  // 防御非有限数值（沿用旧 buildVoidJourney 的 advanced 回退语义）
  const steps = Number.isFinite(k) ? Math.max(1, Math.floor(k)) : 1;
  const hasStartFrame = prevSeason !== undefined && prevRoundInSeason !== undefined;
  const frames: VoidCountdownStep[] = [];
  // 起点帧：倒数大数字从 k 开始、位置从触发前（当前回合）开始（票 01 起点跳跃修复）
  if (hasStartFrame) {
    frames.push({ season: prevSeason, roundInSeason: prevRoundInSeason, remaining: steps });
  }
  // path 每步：位置逐回合递增、剩余 K 逐 1 递减（有起点帧时递减到 0；防御无起点帧时
  // 保持旧语义递减到 1，K 归 0 停留步由组件以剩余 0 显示最终位置）
  (path ?? []).forEach((p, index) => {
    frames.push({
      season: p.season,
      roundInSeason: p.roundInSeason,
      remaining: hasStartFrame
        ? Math.max(0, steps - (index + 1))
        : Math.max(1, steps - index),
    });
  });
  return frames;
}
