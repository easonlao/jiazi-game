/** 季节类型 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 季节循环管理器 */
export class SeasonCycle {
  private seasonOrder: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  private seasonLengths: number[] = [];
  private currentSeasonIndex: number = 0;
  private currentRoundInSeason: number = 1;
  private totalRounds: number = 60;

  constructor() {
    this.generateSeasonLengths();
  }

  /** 生成随机季节长度，确保总和 >= totalRounds */
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

  /** 获取当前季节 */
  getCurrentSeason(): Season {
    return this.seasonOrder[this.currentSeasonIndex % 4];
  }

  /** 获取当前季节内回合数 */
  getCurrentRoundInSeason(): number {
    return this.currentRoundInSeason;
  }

  /** 获取当前季节总长度 */
  getCurrentSeasonLength(): number {
    return this.seasonLengths[this.currentSeasonIndex] || 12;
  }

  /** 检查当前季节是否结束 */
  isSeasonEnd(): boolean {
    return this.currentRoundInSeason >= this.getCurrentSeasonLength();
  }

  /** 推进回合，返回是否切换了季节 */
  advance(): boolean {
    this.currentRoundInSeason++;

    if (this.isSeasonEnd()) {
      this.currentSeasonIndex++;
      this.currentRoundInSeason = 1;
      console.log(`[SeasonCycle] 季节切换: ${this.getCurrentSeason()}`);
      return true;
    }

    return false;
  }

  /** 获取季节的中文名 */
  getSeasonName(season: Season): string {
    const map: Record<Season, string> = {
      spring: '春',
      summer: '夏',
      autumn: '秋',
      winter: '冬',
    };
    return map[season];
  }

  /** 重置 */
  reset(): void {
    this.currentSeasonIndex = 0;
    this.currentRoundInSeason = 1;
    this.generateSeasonLengths();
  }
}
