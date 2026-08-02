/**
 * 气平衡模拟器
 *
 * 自动运行多局游戏，测试不同 BalanceConfig 方案对气经济的影响。
 * 运行方式：cd repo && npx tsx tests/balance/qi_balance_simulation.ts
 */

// ============================================================
// 1. 环境模拟（mock fetch / localStorage）
// ============================================================

// 模拟 localStorage
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { for (const key in localStorageStore) delete localStorageStore[key]; },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 fetch 返回 60 张甲子卡牌数据
const tianGanList = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const diZhiList = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const tianGanElementMap: Record<string, string> = {
  '甲': 'wood', '乙': 'wood', '丙': 'fire', '丁': 'fire',
  '戊': 'earth', '己': 'earth', '庚': 'metal', '辛': 'metal', '壬': 'water', '癸': 'water',
};
const diZhiElementMap: Record<string, string> = {
  '子': 'water', '丑': 'earth', '寅': 'wood', '卯': 'wood',
  '辰': 'earth', '巳': 'fire', '午': 'fire', '未': 'earth',
  '申': 'metal', '酉': 'metal', '戌': 'earth', '亥': 'water',
};

const mockCards = Array.from({ length: 60 }, (_, i) => {
  const tg = tianGanList[i % 10];
  const dz = diZhiList[Math.floor(i / 10)];
  return {
    id: i + 1,
    name: `${tg}${dz}`,
    tianGan: tg,
    diZhi: dz,
    tianGanElement: tianGanElementMap[tg],
    diZhiElement: diZhiElementMap[dz],
    mainElement: tianGanElementMap[tg],
    yinYang: i % 2 === 0 ? 'yang' : 'yin',
  };
});

(global as any).fetch = async () => ({
  json: async () => mockCards,
});

// ============================================================
// 2. 导入核心模块
// ============================================================

import { TurnManager, SeededRandomSource } from '../../src/core';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import type { BalanceConfig } from '../../src/core/BalanceConfig';

// ============================================================
// 3. 配置方案定义
// ============================================================

const GAMES_PER_CONFIG = 40;
const SEEDS = Array.from({ length: GAMES_PER_CONFIG }, (_, i) => 1000 + i * 7);

interface ConfigDef {
  name: string;
  description: string;
  buildConfig: (base: BalanceConfig) => BalanceConfig;
  /** 是否需要 lockedQi 回气上限修正 */
  patchLockedQiCap: boolean;
}

const CONFIGS: ConfigDef[] = [
  {
    name: 'Default',
    description: '当前线上配置（基线）',
    buildConfig: (base) => ({ ...base }),
    patchLockedQiCap: false,
  },
  {
    name: 'A',
    description: 'baseRecovery=6, waitBonus=6',
    buildConfig: (base) => ({ ...base, baseRecovery: 6, waitBonus: 6 }),
    patchLockedQiCap: false,
  },
  {
    name: 'B',
    description: 'leverageQiCostPerX=2',
    buildConfig: (base) => ({ ...base, leverageQiCostPerX: 2 }),
    patchLockedQiCap: false,
  },
  {
    name: 'C',
    description: 'lockedQi 降低有效回气上限',
    buildConfig: (base) => ({ ...base }),
    patchLockedQiCap: true,
  },
  {
    name: 'D',
    description: 'A+B+C 组合',
    buildConfig: (base) => ({ ...base, baseRecovery: 6, waitBonus: 6, leverageQiCostPerX: 2 }),
    patchLockedQiCap: true,
  },
];

// ============================================================
// 4. AI 策略定义
// ============================================================

type Strategy = 'aggressive' | 'balanced' | 'conservative';

interface StrategyStats {
  finalScore: number;
  marginCallCount: number;
  qiHistory: number[];
  handSizeHistory: number[];
  leverageCount: number;
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  roundsPlayed: number;
  scoreAtRound: { round: number; score: number }[];
}

function playGame(tm: TurnManager, strategy: Strategy): StrategyStats {
  const qiHistory: number[] = [];
  const handSizeHistory: number[] = [];
  const scoreAtRound: { round: number; score: number }[] = [];
  let leverageCount = 0;
  let lastRecordedRound = 0;

  for (let i = 0; i < 200; i++) {
    if (tm.getState() !== 'player_action') break;

    const qi = tm.getQi();
    const hand = tm.getHand();
    const cards = tm.getPublicCards();
    const currentRound = tm.getCurrentRound();
    const currentQi = qi;

    // 记录快照
    if (currentRound !== lastRecordedRound) {
      qiHistory.push(currentQi);
      const handSize = hand.filter(s => s !== null).length;
      handSizeHistory.push(handSize);
      scoreAtRound.push({ round: currentRound, score: tm.getScore() });
      lastRecordedRound = currentRound;
    }

    const handCount = hand.filter(s => s !== null).length;
    const canBuy = handCount < 3 && cards.length > 0;
    const maxQi = tm.getMaxQi();
    const sellCost = tm.getSellCost();

    // 计算买入成本（取第一张公共牌）
    let buyCost = Infinity;
    let buyCostLeverage = Infinity;
    if (cards.length > 0) {
      // 使用内部方法估算成本
      const dummyCard = cards[0];
      const score = (dummyCard as any).getSeasonScore(tm.getCurrentSeason());
      const qiMgr = (tm as any).qiManager;
      buyCost = qiMgr.calculateBuyCost(score, false);
      buyCostLeverage = qiMgr.calculateBuyCost(score, true);
    }

    let actionTaken = false;

    switch (strategy) {
      case 'aggressive': {
        // 激进策略：尽可能用杠杆买，只在被迫时卖
        if (canBuy && currentQi > buyCostLeverage + 5) {
          actionTaken = tm.executeBuy(0, true);
          if (actionTaken) {
            leverageCount++;
            break;
          }
        }
        // 手牌满了或气极低时卖
        if (handCount >= 3 || currentQi < 5) {
          const idx = hand.findIndex(s => s !== null);
          if (idx >= 0) {
            // 先尝试卖表现最差的（评分最低的）
            const currentSeason = tm.getCurrentSeason();
            const scoredSlots = hand
              .map((slot, index) => ({ slot, index }))
              .filter(({ slot }) => slot !== null)
              .sort((a, b) => {
                const scoreA = a.slot!.card.getSeasonScore(currentSeason);
                const scoreB = b.slot!.card.getSeasonScore(currentSeason);
                return scoreA - scoreB;
              });
            for (const { index } of scoredSlots) {
              if (tm.executeSell(index)) {
                actionTaken = true;
                break;
              }
            }
            if (actionTaken) break;
          }
        }
        // 兜底：等待
        if (tm.executeWait()) actionTaken = true;
        break;
      }

      case 'balanced': {
        // 平衡策略：气充裕时用杠杆，气紧张时控制
        if (canBuy && currentQi > 40 && currentQi > buyCostLeverage) {
          actionTaken = tm.executeBuy(0, true);
          if (actionTaken) { leverageCount++; break; }
        }
        if (canBuy && currentQi > 25 && currentQi > buyCost) {
          actionTaken = tm.executeBuy(0, false);
          if (actionTaken) break;
        }
        // 气低或手牌满时卖
        if (handCount >= 3 || (currentQi < 15 && handCount > 0)) {
          const idx = hand.findIndex(s => s !== null);
          if (idx >= 0 && tm.executeSell(idx)) { actionTaken = true; break; }
        }
        // 等待
        if (tm.executeWait()) actionTaken = true;
        break;
      }

      case 'conservative': {
        // 保守策略：不用杠杆，气不高不买，频繁卖
        if (canBuy && currentQi > 35 && currentQi > buyCost) {
          actionTaken = tm.executeBuy(0, false);
          if (actionTaken) break;
        }
        // 手牌≥2或气低时卖
        if (handCount >= 2 || currentQi < 20) {
          const idx = hand.findIndex(s => s !== null);
          if (idx >= 0 && tm.executeSell(idx)) { actionTaken = true; break; }
        }
        // 等待
        if (tm.executeWait()) actionTaken = true;
        break;
      }
    }

    if (!actionTaken) {
      // 兜底：如果所有操作都失败，尝试等待
      try { tm.executeWait(); } catch { break; }
    }
  }

  return {
    finalScore: tm.getScore(),
    marginCallCount: tm.getMarginCallCount(),
    qiHistory,
    handSizeHistory,
    leverageCount,
    totalBuys: tm.getTotalBuys(),
    totalSells: tm.getTotalSells(),
    totalWaits: tm.getTotalWaits(),
    totalLeverageBuys: tm.getTotalLeverageBuys(),
    roundsPlayed: tm.getCurrentRound(),
    scoreAtRound,
  };
}

// ============================================================
// 5. lockedQi 回气上限修正（方案 C/D）
// ============================================================

function patchTurnManagerForLockedQiCap(tm: TurnManager): void {
  const qiManager = (tm as any).qiManager;
  const originalRecover = qiManager.recover.bind(qiManager);
  qiManager.recover = function (amount: number, totalLockedQi: number = 0) {
    const effectiveMax = Math.max(0, qiManager.getMaxQi() - totalLockedQi);
    const newQi = Math.min(effectiveMax, qiManager.getQi() + amount);
    // 直接设置 qi，绕过 setQi 的 maxQi 硬上限
    qiManager.setQi(Math.min(qiManager.getMaxQi(), newQi));
  };
}

// ============================================================
// 6. 运行模拟
// ============================================================

interface AggregatedStats {
  configName: string;
  strategy: string;
  avgFinalScore: number;
  medianFinalScore: number;
  stdFinalScore: number;
  avgMarginCalls: number;
  marginCallRate: number;         // 至少一次爆仓的比例
  severeMarginCallRate: number;   // 多次爆仓的比例
  avgQiAtEnd: number;
  avgQiMidgame: number;           // 中期（回合 20-40）平均气量
  avgQiLowPoint: number;          // 平均最低气量
  avgHandSize: number;
  avgLeverageCards: number;
  avgBuys: number;
  avgSells: number;
  avgWaits: number;
  avgLeverageBuys: number;
  avgScoreAtRound20: number;
  avgScoreAtRound40: number;
  finalScoreAtRound20: number;
  finalScoreAtRound40: number;
  gamesCompleted: number;
}

async function runSimulation(): Promise<AggregatedStats[]> {
  const results: AggregatedStats[] = [];

  for (const configDef of CONFIGS) {
    for (const strategy of ['aggressive', 'balanced', 'conservative'] as Strategy[]) {
      const gameResults: StrategyStats[] = [];

      for (const seed of SEEDS) {
        const config = configDef.buildConfig(DEFAULT_BALANCE_CONFIG);
        const tm = new TurnManager(config, new SeededRandomSource(seed));
        await tm.initialize();
        tm.startGame();

        // 方案 C/D：应用 lockedQi 修正
        if (configDef.patchLockedQiCap) {
          patchTurnManagerForLockedQiCap(tm);
        }

        const stats = playGame(tm, strategy);
        gameResults.push(stats);
      }

      // 聚合统计
      const scores = gameResults.map(r => r.finalScore).sort((a, b) => a - b);
      const marginCalls = gameResults.map(r => r.marginCallCount);
      const marginCallRate = marginCalls.filter(c => c > 0).length / gameResults.length;
      const severeRate = marginCalls.filter(c => c >= 2).length / gameResults.length;
      const avgQiEnd = avg(gameResults.map(r => r.qiHistory.length > 0 ? r.qiHistory[r.qiHistory.length - 1] : 0));
      const avgQiMid = avg(gameResults.map(r => {
        const mid = r.qiHistory.slice(Math.floor(r.qiHistory.length * 0.3), Math.floor(r.qiHistory.length * 0.7));
        return mid.length > 0 ? avg(mid) : 0;
      }));
      const avgQiLow = avg(gameResults.map(r => r.qiHistory.length > 0 ? Math.min(...r.qiHistory) : 0));
      const avgHand = avg(gameResults.map(r => avg(r.handSizeHistory)));
      const avgLevCards = avg(gameResults.map(r => r.leverageCount));
      const scoreAt20 = gameResults.filter(r => r.scoreAtRound.length > 0).map(r => {
        const entry = r.scoreAtRound.find(s => s.round >= 20);
        return entry ? entry.score : r.finalScore;
      });
      const scoreAt40 = gameResults.filter(r => r.scoreAtRound.length > 0).map(r => {
        const entry = r.scoreAtRound.find(s => s.round >= 40);
        return entry ? entry.score : r.finalScore;
      });

      results.push({
        configName: configDef.name,
        strategy,
        avgFinalScore: round1(avg(scores)),
        medianFinalScore: round1(scores[Math.floor(scores.length / 2)]),
        stdFinalScore: round1(std(scores)),
        avgMarginCalls: round2(avg(marginCalls)),
        marginCallRate: round2(marginCallRate),
        severeMarginCallRate: round2(severeRate),
        avgQiAtEnd: round1(avgQiEnd),
        avgQiMidgame: round1(avgQiMid),
        avgQiLowPoint: round1(avgQiLow),
        avgHandSize: round2(avgHand),
        avgLeverageCards: round2(avgLevCards),
        avgBuys: round1(avg(gameResults.map(r => r.totalBuys))),
        avgSells: round1(avg(gameResults.map(r => r.totalSells))),
        avgWaits: round1(avg(gameResults.map(r => r.totalWaits))),
        avgLeverageBuys: round1(avg(gameResults.map(r => r.totalLeverageBuys))),
        avgScoreAtRound20: round1(avg(scoreAt20)),
        avgScoreAtRound40: round1(avg(scoreAt40)),
        finalScoreAtRound20: round1(scoreAt20.length > 0 ? Math.max(...scoreAt20) : 0),
        finalScoreAtRound40: round1(scoreAt40.length > 0 ? Math.max(...scoreAt40) : 0),
        gamesCompleted: gameResults.length,
      });
    }
  }

  return results;
}

// ============================================================
// 7. 辅助函数
// ============================================================

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ============================================================
// 8. 输出格式化
// ============================================================

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function printDivider(char: string = '─'): void {
  console.log(char.repeat(150));
}

function printResults(results: AggregatedStats[]): void {
  const configs = [...new Set(results.map(r => r.configName))];
  const strategies = ['aggressive', 'balanced', 'conservative'];

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                      Qi 平衡模拟结果                                                                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n每方案 × 每策略 = ${GAMES_PER_CONFIG} 局，共 ${configs.length * strategies.length * GAMES_PER_CONFIG} 局模拟\n`);

  // 指标说明
  console.log('指标说明：');
  console.log('  FinalScore    = 最终总分（越高越好）');
  console.log('  Std           = 分数标准差（越大说明策略波动越大）');
  console.log('  MarginCalls   = 平均爆仓次数（越高说明气管理压力越大）');
  console.log('  MarginRate    = 至少爆仓一次的比例（0=从不爆仓，1=每次都爆）');
  console.log('  SevereRate    = 多次爆仓比例');
  console.log('  MidQi(30-70)  = 中期（30%-70%进度）平均气量（越低说明压力越大）');
  console.log('  LowQi         = 全局最低平均气量');
  console.log('  EndQi         = 游戏结束时平均气量');
  console.log('  HandSize      = 平均手牌数');
  console.log('  LevCards      = 开杠杆卡次数');
  console.log('  Buy/Sell/Wait = 操作次数分布');
  console.log('  Score@20/@40  = 第20/40回合平均分\n');

  for (const configName of configs) {
    const configDesc = CONFIGS.find(c => c.name === configName)!.description;
    printDivider();
    console.log(`  ${configName}: ${configDesc}`);
    printDivider('─');

    // 表头
    console.log(
      pad('策略', 14) +
      pad('FinalScore', 14) +
      pad('Std', 10) +
      pad('MarginCalls', 14) +
      pad('MarginRate', 12) +
      pad('SevereRate', 12) +
      pad('MidQi(30-70)', 14) +
      pad('LowQi', 8) +
      pad('EndQi', 8) +
      pad('Hand', 6) +
      pad('LevCards', 10) +
      pad('Buy', 6) +
      pad('Sell', 6) +
      pad('Wait', 6) +
      pad('Score@20', 10) +
      pad('Score@40', 10)
    );

    for (const strategy of strategies) {
      const r = results.find(r => r.configName === configName && r.strategy === strategy)!;
      const strategyLabel = strategy === 'aggressive' ? '激进' : strategy === 'balanced' ? '平衡' : '保守';
      console.log(
        pad(strategyLabel, 14) +
        pad(String(r.avgFinalScore), 14) +
        pad(String(r.stdFinalScore), 10) +
        pad(String(r.avgMarginCalls), 14) +
        pad(String(r.marginCallRate), 12) +
        pad(String(r.severeMarginCallRate), 12) +
        pad(String(r.avgQiMidgame), 14) +
        pad(String(r.avgQiLowPoint), 8) +
        pad(String(r.avgQiAtEnd), 8) +
        pad(String(r.avgHandSize), 6) +
        pad(String(r.avgLeverageCards), 10) +
        pad(String(r.avgBuys), 6) +
        pad(String(r.avgSells), 6) +
        pad(String(r.avgWaits), 6) +
        pad(String(r.avgScoreAtRound20), 10) +
        pad(String(r.avgScoreAtRound40), 10)
      );
    }
    console.log('');
  }

  // ============================================================
  // 9. 对比分析
  // ============================================================

  printDivider('═');
  console.log('  对比分析\n');

  // 对每个策略，对比不同配置的效果
  for (const strategy of strategies) {
    const strategyLabel = strategy === 'aggressive' ? '激进' : strategy === 'balanced' ? '平衡' : '保守';
    console.log(`  --- ${strategyLabel}策略 ---`);
    console.log(
      pad('配置', 10) +
      pad('FinalScore', 14) +
      pad('Score变化', 12) +
      pad('MarginCalls', 14) +
      pad('MarginRate', 12) +
      pad('MidQi', 8) +
      pad('LowQi', 8) +
      pad('LevCards', 10)
    );

    const defaultR = results.find(r => r.configName === 'Default' && r.strategy === strategy)!;
    console.log(
      pad('Default', 10) +
      pad(String(defaultR.avgFinalScore), 14) +
      pad('—', 12) +
      pad(String(defaultR.avgMarginCalls), 14) +
      pad(String(defaultR.marginCallRate), 12) +
      pad(String(defaultR.avgQiMidgame), 8) +
      pad(String(defaultR.avgQiLowPoint), 8) +
      pad(String(defaultR.avgLeverageCards), 10)
    );

    for (const configName of ['A', 'B', 'C', 'D']) {
      const r = results.find(r => r.configName === configName && r.strategy === strategy)!;
      const scoreChange = r.avgFinalScore - defaultR.avgFinalScore;
      const scoreChangeStr = scoreChange >= 0 ? `+${scoreChange.toFixed(1)}` : scoreChange.toFixed(1);
      console.log(
        pad(configName, 10) +
        pad(String(r.avgFinalScore), 14) +
        pad(scoreChangeStr, 12) +
        pad(String(r.avgMarginCalls), 14) +
        pad(String(r.marginCallRate), 12) +
        pad(String(r.avgQiMidgame), 8) +
        pad(String(r.avgQiLowPoint), 8) +
        pad(String(r.avgLeverageCards), 10)
      );
    }
    console.log('');
  }

  // ============================================================
  // 10. 结论
  // ============================================================

  printDivider('═');
  console.log('  结论与推荐\n');

  // 分析每个方案的效果
  for (const configName of ['A', 'B', 'C', 'D']) {
    const configDesc = CONFIGS.find(c => c.name === configName)!.description;
    const defaultAgg = results.find(r => r.configName === 'Default' && r.strategy === 'aggressive')!;
    const configAgg = results.find(r => r.configName === configName && r.strategy === 'aggressive')!;
    const defaultBal = results.find(r => r.configName === 'Default' && r.strategy === 'balanced')!;
    const configBal = results.find(r => r.configName === configName && r.strategy === 'balanced')!;

    const aggScoreDrop = ((configAgg.avgFinalScore - defaultAgg.avgFinalScore) / defaultAgg.avgFinalScore * 100).toFixed(1);
    const balScoreDrop = ((configBal.avgFinalScore - defaultBal.avgFinalScore) / defaultBal.avgFinalScore * 100).toFixed(1);
    const aggMcChange = configAgg.avgMarginCalls - defaultAgg.avgMarginCalls;
    const balMcChange = configBal.avgMarginCalls - defaultBal.avgMarginCalls;

    console.log(`  ${configName}: ${configDesc}`);
    console.log(`    - 激进策略：分数 ${aggScoreDrop}%（${defaultAgg.avgFinalScore} → ${configAgg.avgFinalScore}），爆仓次数 ${aggMcChange > 0 ? '+' : ''}${aggMcChange.toFixed(1)}`);
    console.log(`    - 平衡策略：分数 ${balScoreDrop}%（${defaultBal.avgFinalScore} → ${configBal.avgFinalScore}），爆仓次数 ${balMcChange > 0 ? '+' : ''}${balMcChange.toFixed(1)}`);
    console.log(`    - 激进 vs 平衡分数差：${(configAgg.avgFinalScore - configBal.avgFinalScore).toFixed(1)}`);

    // 判断是否产生了有效的抉择压力
    const hasPressure = configAgg.avgMarginCalls > defaultAgg.avgMarginCalls * 1.3 && configAgg.marginCallRate > 0.3;
    const hasTradeoff = configAgg.avgFinalScore > configBal.avgFinalScore * 1.15 && configAgg.avgMarginCalls > configBal.avgMarginCalls * 1.5;
    console.log(`    - 抉择压力：${hasPressure ? '✅ 有效，激进策略爆仓风险显著上升' : '❌ 不足，激进策略仍可无风险操作'}`);
    console.log(`    - 收益/风险权衡：${hasTradeoff ? '✅ 有效，高收益对应高风险' : '❌ 不足，收益与风险不成正比'}`);
    console.log('');
  }
}

// ============================================================
// 11. 主入口
// ============================================================

async function main() {
  console.log('🚀 开始气平衡模拟...');
  console.log(`  配置方案: ${CONFIGS.map(c => c.name).join(', ')}`);
  console.log(`  策略: 激进, 平衡, 保守`);
  console.log(`  每组合: ${GAMES_PER_CONFIG} 局\n`);

  const startTime = Date.now();
  const results = await runSimulation();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`  模拟完成，耗时 ${elapsed}s\n`);

  printResults(results);
}

main().catch(console.error);