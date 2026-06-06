import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TurnManager } from '../../src/core/TurnManager';
import { GameSimulator } from './game_simulator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock fetch for CardDataBank in Node environment
global.fetch = (async (url: string) => {
  if (url === 'assets/data/jiazi_cards.json' || url.endsWith('jiazi_cards.json')) {
    const filePath = path.resolve(__dirname, '../../assets/data/jiazi_cards.json');
    const data = fs.readFileSync(filePath, 'utf-8');
    return {
      json: async () => JSON.parse(data),
      ok: true
    } as any;
  }
  throw new Error(`Unknown fetch URL: ${url}`);
}) as any;

export interface ScoreEventLog {
  round: number;
  type: 'hold' | 'sell' | 'margin_call';
  cardName: string;
  leverage: number;
  scoreChange: number;
  buyScore?: number;
  sellScore?: number;
  currentTotal: number;
}

export interface GameSampleResult {
  gameIndex: number;
  strategy: 'conservative' | 'aggressive' | 'random';
  finalScore: number;
  totalHoldEarnings: number;
  totalSellEarnings: number;
  totalMarginCallEarnings: number;
  events: ScoreEventLog[];
}

export class ScoreSampler {
  async runSampling(): Promise<GameSampleResult[]> {
    const results: GameSampleResult[] = [];
    const runConfigs: { strategy: 'conservative' | 'aggressive' | 'random' }[] = [
      { strategy: 'conservative' },
      { strategy: 'conservative' },
      { strategy: 'conservative' },
      { strategy: 'conservative' },
      { strategy: 'conservative' },
      { strategy: 'aggressive' },
      { strategy: 'aggressive' },
      { strategy: 'aggressive' },
      { strategy: 'random' },
      { strategy: 'random' }
    ];

    for (let i = 0; i < runConfigs.length; i++) {
      const config = runConfigs[i];
      const tm = new TurnManager();
      await tm.initialize();

      const simulator = new GameSimulator();
      const gameSim = (simulator as any);
      gameSim.turnManager = tm;

      tm.startGame();

      const events: ScoreEventLog[] = [];
      let totalHold = 0;
      let totalSell = 0;
      let totalMargin = 0;

      while (tm.getState() !== 'game_over' && tm.getCurrentRound() <= 60) {
        const round = tm.getCurrentRound();
        const season = tm.getCurrentSeason();
        const qi = tm.getQi();
        const scoreBefore = tm.getScore();

        // 1. 回合开始，读取并记录 settleHoldings 阶段的持仓得分和爆仓得分
        const settleDetail = tm.getLastSettlementDetail();
        if (settleDetail && settleDetail.round === round) {
          // 记录持仓事件
          for (const item of settleDetail.holdItems) {
            if (item.earning > 0) {
              events.push({
                round,
                type: 'hold',
                cardName: item.cardName,
                leverage: item.leverage,
                scoreChange: item.earning,
                currentTotal: tm.getScore()
              });
              totalHold += item.earning;
            }
          }
          // 记录爆仓强平事件
          for (const detail of settleDetail.marginCallDetails) {
            events.push({
              round,
              type: 'margin_call',
              cardName: detail.cardName,
              leverage: 1.0,
              scoreChange: detail.sellScore,
              currentTotal: tm.getScore()
            });
            totalMargin += detail.sellScore;
          }
        }

        // 2. 根据策略做决策
        const decision = gameSim.makeDecision(config.strategy, round, season, qi, scoreBefore);

        // 执行决策并捕捉卖出事件
        let actionSuccess = false;
        switch (decision) {
          case 'buy': {
            const publicCards = tm.getPublicCards();
            if (publicCards.length > 0) {
              const useLeverage = config.strategy === 'aggressive';
              const bestBuyIndex = gameSim.getBestBuyIndex(config.strategy, publicCards, season);
              actionSuccess = tm.executeBuy(bestBuyIndex, useLeverage);
            }
            break;
          }
          case 'sell': {
            const hand = tm.getHand();
            const sellIndex = gameSim.getBestSellIndex(config.strategy, hand, season);
            if (sellIndex !== -1) {
              const slot = hand[sellIndex]!;
              const currentScore = slot.card.getSeasonScore(season);
              const previewScore = tm.previewSellScore(slot);

              actionSuccess = tm.executeSell(sellIndex);
              if (actionSuccess) {
                events.push({
                  round,
                  type: 'sell',
                  cardName: slot.card.name,
                  leverage: slot.leverage,
                  scoreChange: previewScore,
                  buyScore: slot.buyScore,
                  sellScore: currentScore,
                  currentTotal: tm.getScore()
                });
                totalSell += previewScore;
              }
            }
            break;
          }
          case 'wait':
            actionSuccess = tm.executeWait();
            break;
        }

        if (!actionSuccess && decision !== 'wait') {
          tm.executeWait();
        }
      }

      results.push({
        gameIndex: i + 1,
        strategy: config.strategy,
        finalScore: tm.getScore(),
        totalHoldEarnings: totalHold,
        totalSellEarnings: totalSell,
        totalMarginCallEarnings: totalMargin,
        events
      });
    }

    return results;
  }
}

function analyzeResults(results: GameSampleResult[]) {
  console.log('\n--- 详细得分事件诊断指标 ---');
  results.forEach(r => {
    const holdEvents = r.events.filter(e => e.type === 'hold');
    const sellEvents = r.events.filter(e => e.type === 'sell');
    const marginEvents = r.events.filter(e => e.type === 'margin_call');

    const avgHold = holdEvents.length > 0 ? (holdEvents.reduce((sum, e) => sum + e.scoreChange, 0) / holdEvents.length) : 0;
    const avgSell = sellEvents.length > 0 ? (sellEvents.reduce((sum, e) => sum + e.scoreChange, 0) / sellEvents.length) : 0;
    const maxSell = sellEvents.length > 0 ? Math.max(...sellEvents.map(e => e.scoreChange)) : 0;
    
    // 跃迁比例：单次卖出得分占该局最终得分的平均比例
    const avgSellRatio = sellEvents.length > 0 ? (sellEvents.reduce((sum, e) => sum + (e.scoreChange / r.finalScore), 0) / sellEvents.length) * 100 : 0;

    console.log(`第 ${r.gameIndex} 局 | 策略: ${r.strategy.padEnd(12)}`);
    console.log(`  * 持仓事件数: ${holdEvents.length.toString().padEnd(4)} | 次均持仓分: ${avgHold.toFixed(2)}`);
    console.log(`  * 卖出事件数: ${sellEvents.length.toString().padEnd(4)} | 次均卖出分: ${avgSell.toFixed(2)} | 单次最大卖出: ${maxSell.toFixed(2)}`);
    console.log(`  * 强平事件数: ${marginEvents.length.toString().padEnd(4)}`);
    console.log(`  * 卖出跃迁占比 (单次卖出分 / 最终总分): ${avgSellRatio.toFixed(1)}%`);
  });
}

async function main() {
  const sampler = new ScoreSampler();
  console.log('开始对 10 局游戏进行得分事件采样...');
  const results = await sampler.runSampling();
  
  const outputDir = path.resolve(__dirname, '../../production/qa');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'score-events-raw-data.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`得分事件原始数据已成功保存至: ${outputPath}`);

  console.log('\n--- 10 局得分事件汇总 ---');
  results.forEach(r => {
    console.log(`第 ${r.gameIndex} 局 | 策略: ${r.strategy.padEnd(12)} | 最终得分: ${r.finalScore.toFixed(1)}`);
    console.log(`  - 持仓累计收益: ${r.totalHoldEarnings.toFixed(1)}`);
    console.log(`  - 卖出累计收益: ${r.totalSellEarnings.toFixed(1)}`);
    console.log(`  - 强平累计损益: ${r.totalMarginCallEarnings.toFixed(1)}`);
    console.log(`  - 事件总数: ${r.events.length}`);
  });

  analyzeResults(results);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('score_sampler.ts')) {
  main().catch(console.error);
}
