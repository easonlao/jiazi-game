import { JiaziCard } from './JiaziCard.ts';

/** 手牌槽位 */
export class HandSlot {
  readonly card: JiaziCard;
  readonly buyScore: number;
  readonly useLeverage: boolean;
  readonly leverage: number;
  readonly buyRound: number;
  readonly lockedQi: number;
  holdEarnings: number;

  constructor(card: JiaziCard, buyScore: number, useLeverage: boolean, leverage: number, buyRound: number, lockedQi: number) {
    this.card = card;
    this.buyScore = buyScore;
    this.useLeverage = useLeverage;
    this.leverage = leverage;
    this.buyRound = buyRound;
    this.lockedQi = lockedQi;
    this.holdEarnings = 0;
  }

  /** 获取当前评分 */
  getCurrentScore(currentSeason: string): number {
    return this.card.getSeasonScore(currentSeason);
  }

  /** 获取盈亏差价 */
  getProfit(currentSeason: string): number {
    return this.getCurrentScore(currentSeason) - this.buyScore;
  }

  /** 重置 */
  reset(): void {
    this.holdEarnings = 0;
  }
}
