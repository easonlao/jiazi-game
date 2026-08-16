import type { RandomSource } from './RandomSource.ts';
import { RULES_VERSION_BRANCH_ROLL } from './GameSaveService.ts';

/**
 * V6 地支波动（Branch Roll，docs/mechanics.md §10，2026-08-15 设计定稿）。
 *
 * 机制：每季实例开始时，给 12 个地支的藏干季节响应各 roll 一次随机偏移
 * （δ=2 连续均匀），季内恒定、换季重掷（含空亡 K 步跨季）。
 * 评分只注入地支藏干分支项：score = round(X + roll_coef × (u_S − mean_u))。
 *
 * 与校准基准（scratch/branch-roll-design/tools/jiazi_branch_roll_sim.py /
 * jiazi_roll_bounds.py，用户拍板 δ=2 时依据的数据）同口径：
 * 偏移取连续均匀 [−δ, δ]（= random.next()×2δ − δ，与 Python random.uniform(−δ, δ)
 * 逐字同式）；每个地支一次抽取 4 个季节坐标偏移（顺序 = BRANCH_ROLL_DI_ZHI），
 * 当季坐标偏移 u_S 与四季均值 mean_u 之差参与注入。固定抽取顺序保证同一 seed 下
 * 客户端局与服务端重放的随机消耗序列一致（防随机流分叉）。
 */

/** 12 地支抽取顺序（与 ScoreVolatility 的 DI_ZHI 一致；固定以保证重放确定性）。 */
export const BRANCH_ROLL_DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/** 地支偏移幅度 δ = 2（连续均匀 [−δ, δ]，与 Python 校准脚本 random.uniform(−δ, δ) 同口径）。 */
export const BRANCH_ROLL_DELTA = 2;

/** 非土牌 roll 基数 = 3（藏干权重 0.3 × 评分 ×10 折算 = 3）；再乘阴阳因子（阳 1.1 / 阴 0.9）。 */
export const BRANCH_ROLL_NON_EARTH_BASE_COEF = 3;

/** 土牌（方案 E）roll 系数 = 5 × 0.5（减半，保持「土牌 = 稳定保底」定位）。 */
export const BRANCH_ROLL_EARTH_COEF = 5 * 0.5;

/**
 * 地支波动状态快照（既是运行时状态，也是存档可序列化字段）。
 * schemaVersion 保持 1（与 V5 空亡增量同模式）；仅 rulesVersion=6 存档携带。
 */
export interface BranchRollState {
  /** 自声明所属规则版本（= RULES_VERSION_BRANCH_ROLL）。 */
  rulesVersion: typeof RULES_VERSION_BRANCH_ROLL;
  /**
   * 12 地支当季藏干响应偏移 u_S（连续值，[−δ, δ] 均匀 = random.next()×2δ − δ）。
   * 季内恒定；换季 / 空亡跨季重掷。
   */
  rollByDiZhi: Record<string, number>;
  /**
   * 四季均值 mean_u：该地支 4 个季节坐标偏移的均值（当季 roll 时一次抽取 4 坐标）。
   * 评分注入 = roll_coef × (rollByDiZhi[dz] − meanByDiZhi[dz])。
   * 单独持久化：均值无法从当季偏移恢复，不落档会导致读档后评分漂移。
   */
  meanByDiZhi: Record<string, number>;
}

/**
 * 生成一次新的地支波动状态（构造首季 / 换季 / 空亡跨季时调用）。
 * @param seasonIndex 当前季节段索引（% 4 取季节坐标：春 0 / 夏 1 / 秋 2 / 冬 3）。
 */
export function createBranchRollState(random: RandomSource, seasonIndex: number): BranchRollState {
  const coordinate = ((seasonIndex % 4) + 4) % 4;
  const rollByDiZhi: Record<string, number> = {};
  const meanByDiZhi: Record<string, number> = {};
  for (const diZhi of BRANCH_ROLL_DI_ZHI) {
    // 连续均匀 [−δ, δ]：next() ∈ [0,1) → next()×2δ − δ（与 Python uniform(−δ,δ) 同式）。
    const offsets = [
      random.next() * BRANCH_ROLL_DELTA * 2 - BRANCH_ROLL_DELTA,
      random.next() * BRANCH_ROLL_DELTA * 2 - BRANCH_ROLL_DELTA,
      random.next() * BRANCH_ROLL_DELTA * 2 - BRANCH_ROLL_DELTA,
      random.next() * BRANCH_ROLL_DELTA * 2 - BRANCH_ROLL_DELTA,
    ];
    rollByDiZhi[diZhi] = offsets[coordinate]!;
    meanByDiZhi[diZhi] = (offsets[0]! + offsets[1]! + offsets[2]! + offsets[3]!) / 4;
  }
  return { rulesVersion: RULES_VERSION_BRANCH_ROLL, rollByDiZhi, meanByDiZhi };
}

function isNonNilRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验 BranchRollState 快照完整合法（读档门控用）：
 * - 必须是对象，自声明规则版本 = 6；
 * - rollByDiZhi / meanByDiZhi 的键集合必须精确等于 12 地支全键（缺失 = 读档后该族静默无注入，
 *   与写档评分不一致；多余 = 非引擎导出。两者都拒绝，引擎导出恒为全键，无合法残缺来源）。
 */
export function isValidBranchRollState(value: unknown): value is BranchRollState {
  if (!isNonNilRecord(value)) return false;
  if (value.rulesVersion !== RULES_VERSION_BRANCH_ROLL) return false;
  if (!isNonNilRecord(value.rollByDiZhi) || !isNonNilRecord(value.meanByDiZhi)) return false;
  const exactDiZhiKeys = (r: Record<string, unknown>): boolean => {
    const keys = Object.keys(r);
    if (keys.length !== BRANCH_ROLL_DI_ZHI.length) return false;
    return BRANCH_ROLL_DI_ZHI.every((diZhi) => typeof r[diZhi] === 'number' && Number.isFinite(r[diZhi]));
  };
  return exactDiZhiKeys(value.rollByDiZhi) && exactDiZhiKeys(value.meanByDiZhi);
}
