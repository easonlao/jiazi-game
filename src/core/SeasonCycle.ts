
/** 季节类型 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * 季节循环管理器
 * 
 * 负责游戏中四季（春、夏、秋、冬）的推进和交替管理。
 * 每个季节的长度在初始化时随机生成（3-12回合），总和确保覆盖 60 个回合。
 * 
 * @see {@link design/gdd/system-season.md} 季节系统设计文档
 */
export class SeasonCycle {
  private seasonOrder: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  private seasonLengths: number[] = [];
  private currentSeasonIndex: number = 0;
  private currentRoundInSeason: number = 1;
  private totalRounds: number = 60;

  constructor() {
    this.generateSeasonLengths();
  }

  /**
   * 生成随机季节长度，确保总和 >= totalRounds
   */
  private generateSeasonLengths(): void {
    this.seasonLengths = [];
    let remaining = this.totalRounds;

    while (remaining > 0) {
      for (const _ of this.seasonOrder) {
        if (remaining <= 0) break;
        const length = Math.min(remaining, Math.floor(Math.random() * 10) + 3); // 3-12
        this.seasonLengths.push(length);
        remaining -= length;
      }
    }

    console.log('[SeasonCycle] 季节长度:', this.seasonLengths);
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
   * 重置季节循环至第 1 回合春季状态，并重新生成随机长度
   */
  reset(): void {
    this.currentSeasonIndex = 0;
    this.currentRoundInSeason = 1;
    this.generateSeasonLengths();
  }
}
