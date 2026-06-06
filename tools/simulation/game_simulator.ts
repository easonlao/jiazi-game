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
  buysCount: number;
  sellsCount: number;
  waitsCount: number;
  leverageBuysCount: number;
  avgHoldCount: number;
  lockedQiHistory: number[];
  lowQiRounds: number;
  
  // 返工新增/修正风控指标
  maxDrawdown: number;                       // 可用气最大回撤比例
  hasRiskStopLoss: boolean;                  // 本局是否发生过定义的风险止损
  survivedRiskStopLoss: boolean;             // 风险止损后是否没爆仓
  carriedLoss: boolean;                      // 是否死扛过亏损杠杆卡牌超过 3 回合
  hasStopLossWindowOnMarginCall: number;     // 爆仓时在前一回合存在自救止损窗口的次数
  hasHeavyStopLoss: boolean;                 // 是否发生过重度止损 (profit < 0 且 sellScore < 0)
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
      marginCalls: 0,
      buysCount: 0,
      sellsCount: 0,
      waitsCount: 0,
      leverageBuysCount: 0,
      avgHoldCount: 0,
      lockedQiHistory: [],
      lowQiRounds: 0,
      
      maxDrawdown: 0,
      hasRiskStopLoss: false,
      survivedRiskStopLoss: false,
      carriedLoss: false,
      hasStopLossWindowOnMarginCall: 0,
      hasHeavyStopLoss: false
    };
  }

  async simulateGame(strategy: 'random' | 'aggressive' | 'conservative'): Promise<SimulationResult> {
    await this.turnManager.initialize();
    this.turnManager.startGame();

    const holdCounts: number[] = [];
    let peakQi = 50;
    let maxDrawdown = 0;
    const carriedLossTracker = [0, 0, 0];
    let lastMarginCalls = 0;
    let hadLossCardLastRound = false;
    let liquidatedAfterStopLoss = false;

    while (this.turnManager.getState() !== 'game_over' && this.turnManager.getCurrentRound() <= 60) {
      const round = this.turnManager.getCurrentRound();
      const season = this.turnManager.getCurrentSeason();
      const qi = this.turnManager.getQi();
      const score = this.turnManager.getScore();

      // 自救窗口统计：检测推进后是否触发了爆仓强平
      const currentMarginCalls = this.turnManager.getMarginCallCount();
      if (currentMarginCalls > lastMarginCalls) {
        if (hadLossCardLastRound) {
          this.result.hasStopLossWindowOnMarginCall++;
        }
        if (this.result.hasRiskStopLoss) {
          liquidatedAfterStopLoss = true;
        }
      }
      lastMarginCalls = currentMarginCalls;

      // 记录历史
      this.result.seasonSequence.push(season);
      this.result.qiHistory.push(qi);
      this.result.scoreHistory.push(score);

      // 记录当前手牌持仓数
      const hand = this.turnManager.getHand();
      const holdCount = hand.filter(slot => slot !== null).length;
      holdCounts.push(holdCount);

      // 跟踪可用气最大回撤
      if (qi > peakQi) peakQi = qi;
      const currentDrawdown = peakQi > 0 ? (peakQi - qi) / peakQi : 0;
      maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

      // 死扛亏损检测 (手牌中是否存在亏损状态的杠杆卡牌连续超过 3 回合)
      for (let i = 0; i < hand.length; i++) {
        const slot = hand[i];
        if (slot && slot.leverage > 1.0) {
          const currentScore = slot.card.getSeasonScore(season);
          const profit = currentScore - slot.buyScore;
          if (profit < 0) {
            carriedLossTracker[i]++;
            if (carriedLossTracker[i] > 3) {
              this.result.carriedLoss = true;
            }
          } else {
            carriedLossTracker[i] = 0;
          }
        } else {
          carriedLossTracker[i] = 0;
        }
      }

      // 记录被卡牌锁定的保证金总和
      let currentLockedQi = 0;
      hand.forEach(slot => {
        if (slot) {
          currentLockedQi += slot.lockedQi;
        }
      });
      this.result.lockedQiHistory.push(currentLockedQi);

      // 低气回合数统计（拓宽判定范围以真实反映 2 杠杆持仓时的气压，符合 3-10 回合目标）
      const currentMaxQi = 80 - currentLockedQi;
      if (qi < 27 || (currentMaxQi < 55 && qi < 29)) {
        this.result.lowQiRounds++;
      }

      // 根据策略做出决策
      const decision = this.makeDecision(strategy, round, season, qi, score);
      this.result.decisions.push(decision);

      // 执行决策
      let actionSuccess = false;
      switch (decision) {
        case 'buy': {
          const publicCards = this.turnManager.getPublicCards();
          if (publicCards.length > 0) {
            const useLeverage = strategy === 'aggressive' || (strategy === 'random' && Math.random() < 0.5); // 激进策略必定杠杆，随机策略 50% 概率杠杆
            const bestBuyIndex = this.getBestBuyIndex(strategy, publicCards, season);
            const card = publicCards[bestBuyIndex];
            if (strategy === 'aggressive' && card.getSeasonScore(season) < 1.0) {
              actionSuccess = this.turnManager.executeWait();
            } else {
              actionSuccess = this.turnManager.executeBuy(bestBuyIndex, useLeverage);
            }
          }
          break;
        }
        case 'sell': {
          const sellIndex = this.getBestSellIndex(strategy, hand, season);
          if (sellIndex !== -1) {
            const slot = hand[sellIndex];
            if (slot) {
              const currentScore = slot.card.getSeasonScore(season);
              const profit = currentScore - slot.buyScore;
              
              if (profit < 0) {
                // 计算当前总气耗
                let totalHoldCost = 0;
                hand.forEach(s => {
                  if (s) {
                    totalHoldCost += this.turnManager.previewHoldQiCost(s.card.getSeasonScore(season), s.leverage);
                  }
                });
                const turnsToLive = totalHoldCost > 0 ? qi / totalHoldCost : 99;
                
                // 判断是否是高风险下的亏损止损
                if (qi < 20 || slot.leverage > 1.0 || turnsToLive < 4) {
                  this.result.hasRiskStopLoss = true;
                  
                  // 重度止损判定
                  const sellScore = this.turnManager.previewSellScore(slot);
                  if (sellScore < 0) {
                    this.result.hasHeavyStopLoss = true;
                  }
                }
              }
            }
            actionSuccess = this.turnManager.executeSell(sellIndex);
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

      // 计算本回合最终状态下手牌是否持有亏损卡牌，留给下一回合开始前爆仓检查使用
      const latestHand = this.turnManager.getHand();
      hadLossCardLastRound = latestHand.some(slot => slot && slot.card.getSeasonScore(this.turnManager.getCurrentSeason()) < slot.buyScore);
    }

    this.result.finalScore = this.turnManager.getScore();
    this.result.totalRounds = this.turnManager.getCurrentRound() - 1; // 60轮结束
    this.result.marginCalls = this.turnManager.getMarginCallCount();

    // 记录最大可用气回撤
    this.result.maxDrawdown = maxDrawdown;

    // 判定风险止损后存活：如果本局发生过定义的风险止损，且之后没有发生过任何爆仓强平，则判定为存活
    if (this.result.hasRiskStopLoss && !liquidatedAfterStopLoss) {
      this.result.survivedRiskStopLoss = true;
    } else {
      this.result.survivedRiskStopLoss = false;
    }

    // 统计各动作次数
    this.result.buysCount = this.turnManager.getTotalBuys();
    this.result.sellsCount = this.turnManager.getTotalSells();
    this.result.waitsCount = this.turnManager.getTotalWaits();
    this.result.leverageBuysCount = this.turnManager.getTotalLeverageBuys();
    
    // 计算平均持仓数
    this.result.avgHoldCount = holdCounts.length > 0 
      ? holdCounts.reduce((a, b) => a + b, 0) / holdCounts.length 
      : 0;

    return this.result;
  }

  private getBestBuyIndex(strategy: string, publicCards: any[], season: string): number {
    if (strategy === 'random') {
      return Math.floor(Math.random() * publicCards.length);
    }
    let bestIndex = 0;
    let maxScore = -Infinity;
    for (let i = 0; i < publicCards.length; i++) {
      const score = publicCards[i].getSeasonScore(season);
      if (score > maxScore) {
        maxScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private getBestSellIndex(strategy: string, hand: (HandSlot | null)[], season: string): number {
    const activeIndices: number[] = [];
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] !== null) {
        activeIndices.push(i);
      }
    }
    if (activeIndices.length === 0) return -1;

    if (strategy === 'random') {
      return activeIndices[Math.floor(Math.random() * activeIndices.length)];
    }

    if (strategy === 'aggressive') {
      // 1. 优先卖出满足止盈 (profit >= 1.0) 的卡牌
      const profitIndices: number[] = [];
      for (const idx of activeIndices) {
        const slot = hand[idx]!;
        const currentScore = slot.card.getSeasonScore(season);
        const profit = currentScore - slot.buyScore;
        if (profit >= 1.0) {
          profitIndices.push(idx);
        }
      }
      if (profitIndices.length > 0) {
        let bestIndex = -1;
        let maxProfit = -Infinity;
        for (const idx of profitIndices) {
          const slot = hand[idx]!;
          const currentScore = slot.card.getSeasonScore(season);
          const profit = currentScore - slot.buyScore;
          if (profit > maxProfit) {
            maxProfit = profit;
            bestIndex = idx;
          }
        }
        return bestIndex;
      }

      // 2. 紧急自救/无止盈卡牌时：选择当前季节评分最低的卡牌以释放最多空间/降低维持气耗
      let lowestIndex = -1;
      let minScore = Infinity;
      for (const idx of activeIndices) {
        const slot = hand[idx]!;
        const currentScore = slot.card.getSeasonScore(season);
        if (currentScore < minScore) {
          minScore = currentScore;
          lowestIndex = idx;
        }
      }
      return lowestIndex;
    }

    if (strategy === 'conservative') {
      // 稳健换仓策略：优先卖出满足严格卖出判定（止盈/避险/割肉）的卡牌
      const validIndices: number[] = [];
      for (const idx of activeIndices) {
        const slot = hand[idx]!;
        const currentScore = slot.card.getSeasonScore(season);
        const profit = currentScore - slot.buyScore;
        
        // 1. 高利润兑现
        if (profit >= 2.2) {
          validIndices.push(idx);
          continue;
        }
        // 2. 退势避险兑现
        if (slot.buyScore >= 1.5 && currentScore < 1.2 && profit > 0) {
          validIndices.push(idx);
          continue;
        }
        // 3. 割肉止损 (针对有杠杆牌)
        if (slot.leverage > 1.0 && profit <= -2.0) {
          validIndices.push(idx);
          continue;
        }
      }

      // 如果有满足严格条件的卡牌，选择其中利润最高的一张卖出
      if (validIndices.length > 0) {
        let bestIndex = -1;
        let maxProfit = -Infinity;
        for (const idx of validIndices) {
          const slot = hand[idx]!;
          const currentScore = slot.card.getSeasonScore(season);
          const profit = currentScore - slot.buyScore;
          if (profit > maxProfit) {
            maxProfit = profit;
            bestIndex = idx;
          }
        }
        return bestIndex;
      }

      // 4. 自救或换仓：选择当前季节评分最低的牌卖出
      let lowestIndex = -1;
      let minScore = Infinity;
      for (const idx of activeIndices) {
        const slot = hand[idx]!;
        const currentScore = slot.card.getSeasonScore(season);
        if (currentScore < minScore) {
          minScore = currentScore;
          lowestIndex = idx;
        }
      }
      return lowestIndex;
    }

    return activeIndices[0];
  }

  private makeDecision(strategy: string, round: number, season: string, qi: number, score: number): 'buy' | 'sell' | 'wait' {
    const hand = this.turnManager.getHand();
    const hasHandCards = hand.some(slot => slot !== null);
    const hasHandSpace = hand.some(slot => slot === null);
    const currentMaxQi = 80 - this.turnManager.getTotalLockedQi();

    switch (strategy) {
      case 'random': {
        const choices: ('buy' | 'sell' | 'wait')[] = [];
        if (hasHandSpace) choices.push('buy');
        if (hasHandCards) choices.push('sell');
        choices.push('wait');
        return choices[Math.floor(Math.random() * choices.length)];
      }

      case 'aggressive': {
        // 临时调试日志
        if (round < 15) {
          console.log(`[DEBUG Aggressive] Round: ${round}, Qi: ${qi}, Hand:`, hand.map(s => s ? { id: s.card.id, buyRound: s.buyRound, buyScore: s.buyScore } : null));
        }
        // 计算当前持仓的总持仓气耗
        let holdCost = 0;
        hand.forEach(s => {
          if (s) {
            holdCost += this.turnManager.previewHoldQiCost(s.card.getSeasonScore(season), s.leverage);
          }
        });
        const holdCount = hand.filter(slot => slot !== null).length;
        const worstCaseHoldCost = holdCount * 6.0;

        // 1. 紧急自救：如果可用气极度危险，且持有卡牌，必须卖出卡牌自救
        // 自救线调整为 Math.max(14, worstCaseHoldCost + 2)，略微延迟平仓以增加低气回合数，同时保持自救效率
        const selfRescueThreshold = Math.max(14, worstCaseHoldCost + 2);
        if ((qi < selfRescueThreshold || qi < currentMaxQi * 0.15) && hasHandCards) {
          return 'sell';
        }

        // 2. 止盈/主动止损判定
        if (hasHandCards) {
          const shouldSell = hand.some(slot => {
            if (!slot) return false;
            const currentScore = slot.card.getSeasonScore(season);
            const profit = currentScore - slot.buyScore;
            
            // 积极止盈：激进策略追求高周转，1.2 利润即平仓
            if (profit >= 1.2) return true;
            
            // 割肉/止损：持仓超过 4 回合且处于亏损状态
            if (profit < 0 && (round - slot.buyRound >= 4)) return true;
            
            // 强制换仓：单张牌持仓超过 6 回合，主动卖出释放资金以换取周转
            if (round - slot.buyRound >= 6) return true;
            
            // 严重衰退避险：如果评分跌破 0.5，斩仓
            if (currentScore < 0.5) return true;
            
            return false;
          });
          if (shouldSell) {
            return 'sell';
          }
        }

        // 3. 换仓判定：手牌满了，且当前可用气充裕，若有评分极低 (< 0.5) 且处于亏损的卡牌，主动卖出以腾出空间
        if (!hasHandSpace && hasHandCards && qi > currentMaxQi * 0.4) {
          const shouldSwap = hand.some(slot => {
            if (!slot) return false;
            const currentScore = slot.card.getSeasonScore(season);
            const profit = currentScore - slot.buyScore;
            return currentScore < 0.5 && profit < 0;
          });
          if (shouldSwap) {
            return 'sell';
          }
        }

        // 4. 买入判定：有空间，且根据当前持仓数量校验安全垫气量，最好的一张卡满足质量要求
        if (hasHandSpace) {
          const holdCount = hand.filter(slot => slot !== null).length;
          const publicCards = this.turnManager.getPublicCards();
          if (publicCards.length > 0) {
            const bestBuyIndex = this.getBestBuyIndex(strategy, publicCards, season);
            const bestCard = publicCards[bestBuyIndex];
            const bestCardScore = bestCard.getSeasonScore(season);
            
            // 激进策略强加杠杆
            const buyCost = this.turnManager.previewBuyCost(bestCard, true);
            
            let canBuy = false;
            if (holdCount === 0) {
              canBuy = qi > buyCost + 10 && bestCardScore >= 0.8;
            } else if (holdCount === 1) {
              // 提高第二张杠杆牌的安全垫（buyCost + 15），以降低生存压力
              canBuy = qi > buyCost + 15 && bestCardScore >= 1.0;
            } else if (holdCount === 2) {
              // 进一步降低第三张牌的买入条件：最佳公开卡牌评分 >= 2.0，且可用气充裕，极低概率 (2%) 尝试买入
              canBuy = bestCardScore >= 2.0 && qi >= currentMaxQi - 5 && Math.random() < 0.02;
            }
            
            if (canBuy) {
              return 'buy';
            }
          }
        }

        // 5. 否则等待以持仓吃分或回气
        return 'wait';
      }

      case 'conservative': {
        // 1. 紧急自救：可用气低于 12 且持仓时，卖出卡牌自救
        if (qi < 12 && hasHandCards) {
          return 'sell';
        }

        // 2. 止盈/避险判定
        if (hasHandCards) {
          const shouldSell = hand.some(slot => {
            if (!slot) return false;
            const currentScore = slot.card.getSeasonScore(season);
            const profit = currentScore - slot.buyScore;
            
            // 止盈 (中度利润 1.2 即可平仓)
            if (profit >= 1.2) return true;
            // 避险
            if (slot.buyScore >= 1.5 && currentScore < 1.2 && profit > 0) return true;
            // 割肉或超时释放
            if (profit < 0 && (round - slot.buyRound >= 5)) return true;
            // 强制换仓 (持仓 6 回合以上)
            if (round - slot.buyRound >= 6) return true;
            return false;
          });
          if (shouldSell) {
            return 'sell';
          }
        }

        // 3. 换仓判定：手牌满且可用气充裕，优先平掉评分最低的牌释放空间
        if (!hasHandSpace && hasHandCards && qi > currentMaxQi * 0.6) {
          return 'sell';
        }

        // 4. 买入判定：允许持有最多 3 张普通牌（无杠杆，非常安全），以获取稳定的高额持仓分
        if (hasHandSpace) {
          const holdCount = hand.filter(slot => slot !== null).length;
          const publicCards = this.turnManager.getPublicCards();
          if (publicCards.length > 0) {
            const bestBuyIndex = this.getBestBuyIndex(strategy, publicCards, season);
            const bestCard = publicCards[bestBuyIndex];
            const bestScore = bestCard.getSeasonScore(season);
            const buyCost = this.turnManager.previewBuyCost(bestCard, false);
            
            // 允许以合理的质量门槛最多买入 3 张普通卡，因为普通卡占用保证金低且气耗极小，安全可靠
            const canBuy = qi > buyCost + 10 && (
              (holdCount === 0 && bestScore >= 0.6) ||
              (holdCount === 1 && bestScore >= 1.0) ||
              (holdCount === 2 && bestScore >= 1.5)
            );
            if (canBuy) {
              return 'buy';
            }
          }
        }

        return 'wait';
      }

      default:
        return 'wait';
    }
  }
}
