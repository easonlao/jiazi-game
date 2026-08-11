
/** 季节类型 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

import { MathRandomSource, RandomSource } from './RandomSource.ts';

/**
 * 季节循环管理器
 * 
 * 负责游戏中四季（春、夏、秋、冬）的推进和交替管理。
 * 每个季节的长度在初始化时随机生成（3-12回合），总和确保覆盖 60 个回合。
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

  constructor(random?: RandomSource, skipGenerate: boolean = false) {
    this.random = random ?? new MathRandomSource();
    // skipGenerate：测试/存档恢复用（配合 loadState 覆盖长度，避免 generateSeasonLengths
    // 消耗随机数影响后续牌池序列——见测试对固定 seed 的依赖）
    if (!skipGenerate) {
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
   * 获取下一回合结算时会处于的季节（用于跨季预览）
   * 若当前是季末，返回下一季节；否则返回当前季节。
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
   * 获取预生成的全部季节长度数组
   * @returns 季节长度数组
   */
  getSeasonLengths(): number[] {
    return this.seasonLengths;
  }

  /**
   * 加载保存的季节循环状态（用于存档还原状态）
   * @param index 当前处于的季节段索引
   * @param roundInSeason 当前处于本季节的第几回合
   * @param lengths 预先生成的全部季节长度数组
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
   * @returns 当前季节长度
   */
  getCurrentSeasonLength(): number {
    return this.seasonLengths[this.currentSeasonIndex] || 12;
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
   * 重置季节循环至第 1 回合春季状态，并重新生成随机长度
   */
  reset(): void {
    this.currentSeasonIndex = 0;
    this.currentRoundInSeason = 1;
    this.generateSeasonLengths();
  }
}
