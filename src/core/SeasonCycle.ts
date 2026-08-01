
/** 季节类型 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

import { MathRandomSource, RandomSource } from './RandomSource';

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

  constructor(random?: RandomSource) {
    this.random = random ?? new MathRandomSource();
    this.generateSeasonLengths();
  }

  /**
   * 生成随机季节长度：每段严格 3-12，总和恰好 totalRounds(60)。
   * 算法：段数 n ∈ [5, 20]（3n ≤ 60 ≤ 12n），先每段铺 3，再从未满（<12）段中
   * 随机选择 +1 分摊剩余，保证每次必成功分配，无需 guard 兜底。
   */
  private generateSeasonLengths(): void {
    const n = this.random.int(5, 21); // [5, 20]
    const lengths = new Array<number>(n).fill(3);
    let remaining = this.totalRounds - 3 * n;

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
