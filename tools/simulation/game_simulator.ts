import { TurnManager } from '../../src/core/TurnManager';
import { HandSlot } from '../../src/core/HandSlot';

export interface SimulationResult {
  finalScore: number;
  totalRounds: number;
  seasonSequence: string[];
  qiHistory: number[];
  scoreHistory: number[];
  decisions: string[];
  marginCalls: number;
}

export class GameSimulator {
  private turnManager: TurnManager;
  private result: SimulationResult;

  constructor() {
    this.turnManager = new TurnManager();
    this.result = {
      finalScore: 0,
      totalRounds: 0,
      seasonSequence: [],
      qiHistory: [],
      scoreHistory: [],
      decisions: [],
      marginCalls: 0
    };
  }

  async simulateGame(strategy: 'random' | 'aggressive' | 'conservative'): Promise<SimulationResult> {
    await this.turnManager.initialize();
    this.turnManager.startGame();

    while (this.turnManager.getState() !== 'game_over' && this.turnManager.getCurrentRound() <= 60) {
      const round = this.turnManager.getCurrentRound();
      const season = this.turnManager.getCurrentSeason();
      const qi = this.turnManager.getQi();
      const score = this.turnManager.getScore();

      // 记录历史
      this.result.seasonSequence.push(season);
      this.result.qiHistory.push(qi);
      this.result.scoreHistory.push(score);

      // 根据策略做出决策
      const decision = this.makeDecision(strategy, round, season, qi, score);
      this.result.decisions.push(decision);

      // 执行决策
      let actionSuccess = false;
      switch (decision) {
        case 'buy': {
          const publicCards = this.turnManager.getPublicCards();
          if (publicCards.length > 0) {
            // 选择分数最高或随机选择一张
            const useLeverage = strategy === 'aggressive'; // 激进策略在买入时加杠杆
            actionSuccess = this.turnManager.executeBuy(0, useLeverage);
          }
          break;
        }
        case 'sell': {
          const hand = this.turnManager.getHand();
          const firstCardIndex = hand.findIndex(slot => slot !== null);
          if (firstCardIndex !== -1) {
            actionSuccess = this.turnManager.executeSell(firstCardIndex);
          }
          break;
        }
        case 'wait':
          actionSuccess = this.turnManager.executeWait();
          break;
      }

      // 如果决策执行失败（比如手牌满不能买、无手牌不能卖、气不足），退化为执行 "wait"
      if (!actionSuccess && decision !== 'wait') {
        this.turnManager.executeWait();
      }
    }

    this.result.finalScore = this.turnManager.getScore();
    this.result.totalRounds = this.turnManager.getCurrentRound() - 1; // 60轮结束
    this.result.marginCalls = this.turnManager.getMarginCallCount();

    return this.result;
  }

  private makeDecision(strategy: string, round: number, season: string, qi: number, score: number): 'buy' | 'sell' | 'wait' {
    const hand = this.turnManager.getHand();
    const hasHandCards = hand.some(slot => slot !== null);
    const hasHandSpace = hand.some(slot => slot === null);

    switch (strategy) {
      case 'random': {
        const choices: ('buy' | 'sell' | 'wait')[] = [];
        if (hasHandSpace) choices.push('buy');
        if (hasHandCards) choices.push('sell');
        choices.push('wait');
        return choices[Math.floor(Math.random() * choices.length)];
      }

      case 'aggressive': {
        // 激进策略：只要还有气且有手牌空间，就尽量买入，否则如果手牌有牌就卖，最后等待
        if (qi > 25 && hasHandSpace) {
          return 'buy';
        } else if (hasHandCards) {
          return 'sell';
        } else {
          return 'wait';
        }
      }

      case 'conservative': {
        // 保守策略：气低于40时等待；气高于60且有空间才买；有牌且能盈利就卖
        if (qi < 40) {
          return 'wait';
        }
        
        // 检查是否有盈利的牌
        if (hasHandCards) {
          const profitableCardIndex = hand.findIndex(slot => {
            if (!slot) return false;
            const currentScore = slot.card.getSeasonScore(season);
            return currentScore > slot.buyScore; // 高于买入分数即为盈利
          });
          if (profitableCardIndex !== -1) {
            return 'sell';
          }
        }

        if (qi > 55 && hasHandSpace) {
          return 'buy';
        }

        return 'wait';
      }

      default:
        return 'wait';
    }
  }
}
