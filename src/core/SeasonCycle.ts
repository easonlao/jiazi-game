
/** 季节类型 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

import { MathRandomSource, RandomSource } from './RandomSource.ts';

/**
 * V5 懒生成季长加权分布（mechanics.md §9 定稿，2026-08-13）：
 * 4:2.4% / 5:9.4% / 6:18.3% / 7:22.9% / 8:20.3% / 9:14% / 10:7.7% / 11:3.3% / 12:1.9%。
 * 逐项是权重（和 = 100.2，采样时按权重归一化），均值 ≈ 7.5。
 */
export const LAZY_SEASON_LENGTH_DISTRIBUTION: ReadonlyArray<{ length: number; weight: number }> = [
  { length: 4, weight: 2.4 },
  { length: 5, weight: 9.4 },
  { length: 6, weight: 18.3 },
  { length: 7, weight: 22.9 },
  { length: 8, weight: 20.3 },
  { length: 9, weight: 14.0 },
  { length: 10, weight: 7.7 },
  { length: 11, weight: 3.3 },
  { length: 12, weight: 1.9 },
];

/** SeasonCycle 构造选项。 */
export interface SeasonCycleOptions {
  /** 测试/存档恢复用：跳过开局预生成（V1-V4），配合 loadState 覆盖长度避免消耗随机数。 */
  skipGenerate?: boolean;
  /** V5 空亡规则：换季时从种子随机源懒生成下一季长度，不再开局预生成整局表。 */
  lazy?: boolean;
}

/**
 * 季节循环管理器
 * 
 * 负责游戏中四季（春、夏、秋、冬）的推进和交替管理。
 * - V1-V4（默认）：每个季节的长度在初始化时随机生成（4-12回合），总和确保覆盖 60 个回合。
 * - V5（lazy=true）：不再开局预生成整局表；换季时从种子随机源抽下一季长度，
 *   分布沿用定稿形状（LAZY_SEASON_LENGTH_DISTRIBUTION，均值 ≈7.5，每局约 15 季）。
 *   季节时钟**无界**（不按 60 总长 clamp）；游戏总长由 TurnManager 的第 60 游戏回合
 *   终局决定；advanceBy 支持双时钟吞噬（跨季/吞季/连吞，纯算术无保护）。
 * 随机源可注入（测试/模拟器用固定 seed），默认 Math.random。
 * 
 * @see {@link design/gdd/system-season.md} 季节系统设计文档
 */
export class SeasonCycle {
  private seasonOrder: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  private seasonLengths: number[] = [];
  private currentSeasonIndex: number = 0;
  private currentRoundInSeason: number = 1;
  private totalRounds: number = 60;
  private readonly random: RandomSource;
  /** V5 空亡规则：懒生成季长（换季时从种子随机源抽下一季长度）。 */
  private lazy: boolean;

  constructor(random?: RandomSource, options: boolean | SeasonCycleOptions = false) {
    this.random = random ?? new MathRandomSource();
    const opts = typeof options === 'boolean' ? { skipGenerate: options } : options;
    this.lazy = opts.lazy ?? false;
    // skipGenerate：测试/存档恢复用（配合 loadState 覆盖长度，避免 generateSeasonLengths
    // 消耗随机数影响后续牌池序列——见测试对固定 seed 的依赖）
    if (!opts.skipGenerate && !this.lazy) {
      this.generateSeasonLengths();
    }
  }

  /**
   * 生成随机季节长度：每段严格 4-12，总和恰好 totalRounds(60)。
   * 算法：段数 n ∈ {8, 12}（4 的倍数，保证四季均衡），先每段铺 4，再从未满（<12）段中
   * 随机选择 +1 分摊剩余，保证每次必成功分配，无需 guard 兜底。
   *
   * 2026-08-03 调整（方案B）：段数池 {8,12,16,20}→{8,12}、min_len 3→4——
   * 旧算法 n=20 时剩余 0 导致整局全 3 回合（3 回合段占 52%，换季太快无操作空间）。
   * 新分布：3 回合归零、4-7 回合操作带占 81%、9+ 回合保留 11%（爆发窗口）、平均段长 6.0。
   * 注意：段数必须是 4 的倍数——否则季节序列固定从春开始会结构性偏春
   * （如 n=7 时"春夏秋冬春夏秋"冬只有 1 段），长期期望下木火收益天然高于金水。
   * 仅 V1-V4 使用；V5 走懒生成（sampleSeasonLength，无总长 clamp）。
   */
  private generateSeasonLengths(): void {
    const n = this.random.int(2, 3) * 4; // [2,3) → {8, 12}
    const lengths = new Array<number>(n).fill(4);
    let remaining = this.totalRounds - 4 * n;

    // 未满段索引池：只从中选，杜绝指向已满段的无效尝试
    const underfull: number[] = [];
    for (let i = 0; i < n; i++) underfull.push(i);

    while (remaining > 0) {
      const pick = this.random.int(0, underfull.length);
      const idx = underfull[pick];
      lengths[idx]++;
      remaining--;
      if (lengths[idx] >= 12) {
        underfull.splice(pick, 1);
      }
    }
    this.seasonLengths = lengths;

    console.log('[SeasonCycle] 季节长度:', this.seasonLengths);
  }

  /**
   * 按定稿加权分布从随机源抽一季长度（4-12）。供懒生成与分布测试共用。
   * 权重归一化：u = next() * Σweight，落入累积区间取对应长度。
   */
  static sampleSeasonLength(random: RandomSource): number {
    let total = 0;
    for (const { weight } of LAZY_SEASON_LENGTH_DISTRIBUTION) total += weight;
    const u = random.next() * total;
    let acc = 0;
    for (const { length, weight } of LAZY_SEASON_LENGTH_DISTRIBUTION) {
      acc += weight;
      if (u < acc) return length;
    }
    // 浮点精度兜底（u 理论上 < total）
    return LAZY_SEASON_LENGTH_DISTRIBUTION[LAZY_SEASON_LENGTH_DISTRIBUTION.length - 1]!.length;
  }

  /**
   * 懒生成第 index 季长度：直接从定稿分布抽取（4-12），**不做总长预算 clamp**——
   * 季节时钟无界（mechanics.md §9「每局约 15 季」，游戏总长由 TurnManager 的第 60
   * 游戏回合终局决定，季节时钟与游戏回合是两个独立的钟）。
   */
  private generateLazySeasonLength(index: number): number {
    const drawn = SeasonCycle.sampleSeasonLength(this.random);
    this.seasonLengths[index] = drawn;
    return drawn;
  }

  /**
   * 切换懒生成模式（V5 门控随存档声明走）。
   * 读档时由 TurnManager 按存档 rulesVersion 调用：base 构造读 V5 档也要能懒生成，
   * V5 构造 reset 开新局回 V1-V4 也要能预生成完整表。
   */
  setLazy(lazy: boolean): void {
    this.lazy = lazy;
  }

  /**
   * 获取下一回合结算时会处于的季节（用于跨季预览）
   * 若当前是季末，返回下一季节；否则返回当前季节。
   * 季节时钟无界（V5），不存在"总长边界"幻影季问题。
   */
  getNextSeason(): Season {
    if (this.isSeasonEnd()) {
      return this.seasonOrder[(this.currentSeasonIndex + 1) % 4];
    }
    return this.seasonOrder[this.currentSeasonIndex % 4];
  }

  /** 获取季节顺序中的下一季（与回合边界无关，供卡面趋势展示）。 */
  getFollowingSeason(): Season {
    return this.seasonOrder[(this.currentSeasonIndex + 1) % 4];
  }

  /**
   * 获取当前处于第几个季节段
   * @returns 季节段索引
   */
  getCurrentSeasonIndex(): number {
    return this.currentSeasonIndex;
  }

  /**
   * 获取已生成的季节长度数组
   * V1-V4：预生成整局表；V5：已生成的季节长度前缀（懒生成，随推进增长）。
   * @returns 季节长度数组
   */
  getSeasonLengths(): number[] {
    return this.seasonLengths;
  }

  /**
   * 加载保存的季节循环状态（用于存档还原状态）
   * @param index 当前处于的季节段索引
   * @param roundInSeason 当前处于本季节的第几回合
   * @param lengths 已生成的季节长度数组（V5 为前缀，后续季懒生成）
   */
  loadState(index: number, roundInSeason: number, lengths: number[]): void {
    this.currentSeasonIndex = index;
    this.currentRoundInSeason = roundInSeason;
    this.seasonLengths = [...lengths];
  }

  /**
   * 获取当前的季节类型 ('spring' | 'summer' | 'autumn' | 'winter')
   * @returns 当前季节
   */
  getCurrentSeason(): Season {
    return this.seasonOrder[this.currentSeasonIndex % 4];
  }

  /**
   * 获取当前季节内已进行的回合数
   * @returns 当前季节内回合数
   */
  getCurrentRoundInSeason(): number {
    return this.currentRoundInSeason;
  }

  /** 获取下一回合结算所在季节的季内回合数；换季后的第一回合为 1。 */
  getNextRoundInSeason(): number {
    return this.isSeasonEnd() ? 1 : this.currentRoundInSeason + 1;
  }

  /**
   * 获取当前季节的总回合数长度
   * V5 懒生成：首次访问时从种子随机源抽取并缓存；最后一季按剩余预算 clamp。
   * @returns 当前季节长度
   */
  getCurrentSeasonLength(): number {
    const existing = this.seasonLengths[this.currentSeasonIndex];
    if (existing !== undefined) return existing;
    // V1-V4 幻影季兜底与旧行为一致（表外索引返回 12，不触发懒生成）。
    if (!this.lazy) return 12;
    return this.generateLazySeasonLength(this.currentSeasonIndex);
  }

  /**
   * 检查当前季节是否已经结束（是否在最后一回合）
   * @returns 是否是当季最后一回合
   */
  isSeasonEnd(): boolean {
    return this.currentRoundInSeason >= this.getCurrentSeasonLength();
  }

  /**
   * 推进本季的回合数，在超出长度时自动切换至下一个季节并重置当季回合。
   * V5 懒生成：换季时下一季长度在首次访问时生成（getCurrentSeasonLength）。
   * 季节时钟无界：不受 60 上限约束，游戏总长由 TurnManager 的第 60 游戏回合终局决定。
   * @returns 是否在此推进中切换了季节
   */
  advance(): boolean {
    this.currentRoundInSeason++;

    // 只有在超过了当前季节总长度时，才切换季节
    if (this.currentRoundInSeason > this.getCurrentSeasonLength()) {
      this.currentSeasonIndex++;
      this.currentRoundInSeason = 1;
      console.log(`[SeasonCycle] 季节切换: ${this.getCurrentSeason()}`);
      return true;
    }

    return false;
  }

  /**
   * 双时钟吞噬（V5 空亡触发）：季节时钟直接前进 K 回合。
   * 纯算术、无保护、无上限——可吞穿当前季、可吞掉紧邻整季、可连吞两季；
   * 季节时钟无界（不 clamp），游戏仍以第 60 游戏回合终局（TurnManager 回合计数）。
   */
  advanceBy(k: number): void {
    let remaining = Math.max(0, Math.floor(k));
    while (remaining > 0) {
      this.advance();
      remaining--;
    }
  }

  /**
   * 获取季节的中文显示名
   * @param season 季节标识
   * @returns 中文字符
   */
  getSeasonName(season: Season): string {
    const map: Record<Season, string> = {
      spring: '春',
      summer: '夏',
      autumn: '秋',
      winter: '冬',
    };
    return map[season];
  }

  /**
   * 推进当前季节回合的直接入口
   */
  advanceRound(): boolean {
    return this.advance();
  }

  /**
   * 获取当前季节已进行的回合数
   */
  getSeasonRound(): number {
    return this.getCurrentRoundInSeason();
  }

  /**
   * 获取总回合数
   */
  getTotalRounds(): number {
    return this.totalRounds;
  }

  /**
   * 重置季节循环至第 1 回合春季状态。
   * V1-V4：重新生成随机长度；V5（懒生成）：清空已生成前缀，后续访问时再抽。
   */
  reset(): void {
    this.currentSeasonIndex = 0;
    this.currentRoundInSeason = 1;
    if (this.lazy) {
      this.seasonLengths = [];
    } else {
      this.generateSeasonLengths();
    }
  }
}
