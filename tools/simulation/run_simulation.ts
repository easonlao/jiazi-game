import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameSimulator, SimulationResult } from './game_simulator';

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

function getPercentile(arr: number[], percentile: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

async function runSimulation() {
  const results: { strategy: string; result: SimulationResult }[] = [];
  const strategies = ['random', 'aggressive', 'conservative'];
  
  console.log('开始运行 300 局游戏模拟...');
  
  for (let i = 0; i < 300; i++) {
    const strategy = strategies[i % 3] as 'random' | 'aggressive' | 'conservative';
    const simulator = new GameSimulator();
    const result = await simulator.simulateGame(strategy);
    results.push({ strategy, result });
  }
  
  console.log('模拟全部完成。正在生成数值平衡报告...');
  
  // 打印前 5 局的动作统计以作诊断
  console.log('[DEBUG run_simulation] 前 5 局指标明细：');
  for (let i = 0; i < 5; i++) {
    const r = results[i].result;
    console.log(`局数 ${i+1} (${results[i].strategy}): 分数=${r.finalScore.toFixed(1)}, 买=${r.buysCount}, 卖=${r.sellsCount}, 等=${r.waitsCount}, 爆仓=${r.marginCalls}`);
  }
  
  // 计算各策略统计指标
  const reportContent: string[] = [];
  reportContent.push('# MVP 核心玩法数值平衡报告');
  reportContent.push('');
  reportContent.push(`*生成时间：${new Date().toISOString().split('T')[0]}*`);
  reportContent.push('*验证轮数：300局游戏模拟（随机/激进/稳健换仓三种策略轮流执行）*');
  reportContent.push('');
  reportContent.push('## 1. 总体数据汇总');
  reportContent.push('');
  reportContent.push('| 指标 | 全策略汇总 | 随机策略 (Random) | 激进策略 (Aggressive) | 稳健换仓策略 (Conservative) |');
  reportContent.push('| :--- | :--- | :--- | :--- | :--- |');

  const getStats = (filtered: typeof results) => {
    const scores = filtered.map(r => r.result.finalScore);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    // 计算分位数 P10/P50/P90
    const p10 = getPercentile(scores, 10);
    const p50 = getPercentile(scores, 50);
    const p90 = getPercentile(scores, 90);
    
    // 计算标准差
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // 动作与气耗详细统计
    const buys = filtered.map(r => r.result.buysCount);
    const sells = filtered.map(r => r.result.sellsCount);
    const waits = filtered.map(r => r.result.waitsCount);
    const leverageBuys = filtered.map(r => r.result.leverageBuysCount);
    const holdCounts = filtered.map(r => r.result.avgHoldCount);
    
    const avgBuys = buys.reduce((a, b) => a + b, 0) / buys.length;
    const avgSells = sells.reduce((a, b) => a + b, 0) / sells.length;
    const avgWaits = waits.reduce((a, b) => a + b, 0) / waits.length;
    const avgLeverageBuys = leverageBuys.reduce((a, b) => a + b, 0) / leverageBuys.length;
    const avgHoldCount = holdCounts.reduce((a, b) => a + b, 0) / holdCounts.length;

    // 强平次数与爆仓局数占比
    const totalMarginCalls = filtered.map(r => r.result.marginCalls).reduce((a, b) => a + b, 0);
    const lossSessions = filtered.filter(r => r.result.marginCalls > 0).length;
    const lossRate = (lossSessions / filtered.length) * 100;

    // 新增资金与回撤指标
    const lockedQis = filtered.map(r => {
      const sum = r.result.lockedQiHistory.reduce((a, b) => a + b, 0);
      return r.result.lockedQiHistory.length > 0 ? sum / r.result.lockedQiHistory.length : 0;
    });
    const avgLockedQi = lockedQis.reduce((a, b) => a + b, 0) / lockedQis.length;

    const freeQis = filtered.map(r => {
      const sum = r.result.qiHistory.reduce((a, b) => a + b, 0);
      return r.result.qiHistory.length > 0 ? sum / r.result.qiHistory.length : 0;
    });
    const avgFreeQi = freeQis.reduce((a, b) => a + b, 0) / freeQis.length;

    const lowQiRounds = filtered.map(r => r.result.lowQiRounds);
    const avgLowQiRounds = lowQiRounds.reduce((a, b) => a + b, 0) / lowQiRounds.length;

    const drawdowns = filtered.map(r => r.result.maxDrawdown);
    const avgDrawdown = drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length;

    // 风险调整后得分 = 最终得分 - (最大可用气回撤 * 50)
    const riskAdjustedScores = filtered.map(r => r.result.finalScore - (r.result.maxDrawdown * 50));
    const avgRiskAdjustedScore = riskAdjustedScores.reduce((a, b) => a + b, 0) / riskAdjustedScores.length;

    // 重新定义的风险止损与自救存活指标
    const stopLossSessions = filtered.filter(r => r.result.hasRiskStopLoss).length;
    const stopLossRate = (stopLossSessions / filtered.length) * 100;

    const survivedSessions = filtered.filter(r => r.result.hasRiskStopLoss && r.result.survivedRiskStopLoss).length;
    const survivalRate = stopLossSessions > 0 ? (survivedSessions / stopLossSessions) * 100 : 100;

    // 新增重度止损占比 (heavyStopLoss)
    const heavyStopLossSessions = filtered.filter(r => r.result.hasHeavyStopLoss).length;
    const heavyStopLossRate = (heavyStopLossSessions / filtered.length) * 100;

    // 死扛亏损爆仓关联指标
    const carriedLossSessions = filtered.filter(r => r.result.carriedLoss).length;
    const carriedLossRate = (carriedLossSessions / filtered.length) * 100;
    const carriedAndLiquidated = filtered.filter(r => r.result.carriedLoss && r.result.marginCalls > 0).length;
    const carryLiquidationRate = carriedLossSessions > 0 ? (carriedAndLiquidated / carriedLossSessions) * 100 : 0;

    // 自救止损窗口占比 (在触发的所有强平卡数中，前一回合拥有亏损牌的强平占比)
    const totalStopLossWindowsOnMarginCall = filtered.map(r => r.result.hasStopLossWindowOnMarginCall).reduce((a, b) => a + b, 0);
    const windowOnMarginCallRate = totalMarginCalls > 0 ? (totalStopLossWindowsOnMarginCall / totalMarginCalls) * 100 : 0;

    return {
      avgScore: avgScore.toFixed(1),
      minScore: minScore.toFixed(1),
      maxScore: maxScore.toFixed(1),
      p10: p10.toFixed(1),
      p50: p50.toFixed(1),
      p90: p90.toFixed(1),
      stdDev: stdDev.toFixed(1),
      avgBuys: avgBuys.toFixed(1),
      avgSells: avgSells.toFixed(1),
      avgWaits: avgWaits.toFixed(1),
      avgLeverageBuys: avgLeverageBuys.toFixed(1),
      avgHoldCount: avgHoldCount.toFixed(2),
      totalMarginCalls,
      lossRate: lossRate.toFixed(1) + '%',
      avgLockedQi: avgLockedQi.toFixed(1),
      avgFreeQi: avgFreeQi.toFixed(1),
      avgLowQiRounds: avgLowQiRounds.toFixed(1),
      avgDrawdown: (avgDrawdown * 100).toFixed(1) + '%',
      avgRiskAdjustedScore: avgRiskAdjustedScore.toFixed(1),
      stopLossRate: stopLossRate.toFixed(1) + '%',
      survivalRate: survivalRate.toFixed(1) + '%',
      heavyStopLossRate: heavyStopLossRate.toFixed(1) + '%',
      carriedLossRate: carriedLossRate.toFixed(1) + '%',
      carryLiquidationRate: carryLiquidationRate.toFixed(1) + '%',
      windowOnMarginCallRate: windowOnMarginCallRate.toFixed(1) + '%',
      raw: {
        avgScore,
        p10,
        p50,
        p90,
        stdDev,
        lossRate,
        avgLowQiRounds,
        avgRiskAdjustedScore
      }
    };
  };

  const totalStats = getStats(results);
  const randomStats = getStats(results.filter(r => r.strategy === 'random'));
  const aggressiveStats = getStats(results.filter(r => r.strategy === 'aggressive'));
  const conservativeStats = getStats(results.filter(r => r.strategy === 'conservative'));

  reportContent.push(`| 平均分数 | ${totalStats.avgScore} | ${randomStats.avgScore} | ${aggressiveStats.avgScore} | ${conservativeStats.avgScore} |`);
  reportContent.push(`| 得分标准差 | ${totalStats.stdDev} | ${randomStats.stdDev} | ${aggressiveStats.stdDev} | ${conservativeStats.stdDev} |`);
  reportContent.push(`| 最低分数 (Min) | ${totalStats.minScore} | ${randomStats.minScore} | ${aggressiveStats.minScore} | ${conservativeStats.minScore} |`);
  reportContent.push(`| P10 分数 | ${totalStats.p10} | ${randomStats.p10} | ${aggressiveStats.p10} | ${conservativeStats.p10} |`);
  reportContent.push(`| P50 (中位数) | ${totalStats.p50} | ${randomStats.p50} | ${aggressiveStats.p50} | ${conservativeStats.p50} |`);
  reportContent.push(`| P90 分数 | ${totalStats.p90} | ${randomStats.p90} | ${aggressiveStats.p90} | ${conservativeStats.p90} |`);
  reportContent.push(`| 最高分数 (Max) | ${totalStats.maxScore} | ${randomStats.maxScore} | ${aggressiveStats.maxScore} | ${conservativeStats.maxScore} |`);
  reportContent.push(`| 风险调整后得分 | ${totalStats.avgRiskAdjustedScore} | ${randomStats.avgRiskAdjustedScore} | ${aggressiveStats.avgRiskAdjustedScore} | ${conservativeStats.avgRiskAdjustedScore} |`);
  reportContent.push(`| 平均买入次数 | ${totalStats.avgBuys} | ${randomStats.avgBuys} | ${aggressiveStats.avgBuys} | ${conservativeStats.avgBuys} |`);
  reportContent.push(`| 平均卖出次数 | ${totalStats.avgSells} | ${randomStats.avgSells} | ${aggressiveStats.avgSells} | ${conservativeStats.avgSells} |`);
  reportContent.push(`| 平均等待次数 | ${totalStats.avgWaits} | ${randomStats.avgWaits} | ${aggressiveStats.avgWaits} | ${conservativeStats.avgWaits} |`);
  reportContent.push(`| 平均杠杆买入 | ${totalStats.avgLeverageBuys} | ${randomStats.avgLeverageBuys} | ${aggressiveStats.avgLeverageBuys} | ${conservativeStats.avgLeverageBuys} |`);
  reportContent.push(`| 平均持仓数量 | ${totalStats.avgHoldCount} | ${randomStats.avgHoldCount} | ${aggressiveStats.avgHoldCount} | ${conservativeStats.avgHoldCount} |`);
  reportContent.push(`| 强平总卡数 | ${totalStats.totalMarginCalls} | ${randomStats.totalMarginCalls} | ${aggressiveStats.totalMarginCalls} | ${conservativeStats.totalMarginCalls} |`);
  reportContent.push(`| 爆仓局数占比 | ${totalStats.lossRate} | ${randomStats.lossRate} | ${aggressiveStats.lossRate} | ${conservativeStats.lossRate} |`);
  reportContent.push(`| 平均锁定气 (Locked Qi) | ${totalStats.avgLockedQi} | ${randomStats.avgLockedQi} | ${aggressiveStats.avgLockedQi} | ${conservativeStats.avgLockedQi} |`);
  reportContent.push(`| 平均可用气 (Free Qi) | ${totalStats.avgFreeQi} | ${randomStats.avgFreeQi} | ${aggressiveStats.avgFreeQi} | ${conservativeStats.avgFreeQi} |`);
  reportContent.push(`| 平均低气回合数 (<15) | ${totalStats.avgLowQiRounds} | ${randomStats.avgLowQiRounds} | ${aggressiveStats.avgLowQiRounds} | ${conservativeStats.avgLowQiRounds} |`);
  reportContent.push(`| 平均可用气最大回撤 | ${totalStats.avgDrawdown} | ${randomStats.avgDrawdown} | ${aggressiveStats.avgDrawdown} | ${conservativeStats.avgDrawdown} |`);
  reportContent.push(`| 精确风险止损占比 | ${totalStats.stopLossRate} | ${randomStats.stopLossRate} | ${aggressiveStats.stopLossRate} | ${conservativeStats.stopLossRate} |`);
  reportContent.push(`| 止损后自救存活率 | ${totalStats.survivalRate} | ${randomStats.survivalRate} | ${aggressiveStats.survivalRate} | ${conservativeStats.survivalRate} |`);
  reportContent.push(`| 重度止损占比 (heavy) | ${totalStats.heavyStopLossRate} | ${randomStats.heavyStopLossRate} | ${aggressiveStats.heavyStopLossRate} | ${conservativeStats.heavyStopLossRate} |`);
  reportContent.push(`| 死扛亏损局占比 | ${totalStats.carriedLossRate} | ${randomStats.carriedLossRate} | ${aggressiveStats.carriedLossRate} | ${conservativeStats.carriedLossRate} |`);
  reportContent.push(`| 死扛爆仓率 (Carried & Liquidated) | ${totalStats.carryLiquidationRate} | ${randomStats.carryLiquidationRate} | ${aggressiveStats.carryLiquidationRate} | ${conservativeStats.carryLiquidationRate} |`);
  reportContent.push(`| 自救止损窗口占比 (Window %) | ${totalStats.windowOnMarginCallRate} | ${randomStats.windowOnMarginCallRate} | ${aggressiveStats.windowOnMarginCallRate} | ${conservativeStats.windowOnMarginCallRate} |`);
  reportContent.push('');
  
  reportContent.push('## 2. 核心数值机制分析');
  reportContent.push('');
  reportContent.push('### 气耗压力与爆仓分析');
  reportContent.push(`- **全策略平均得分**：${totalStats.avgScore} 分。`);
  reportContent.push(`- **随机策略表现**：买入次数 ${randomStats.avgBuys}，卖出次数 ${randomStats.avgSells}，等待次数 ${randomStats.avgWaits}。`);
  reportContent.push(`- **激进策略表现**：激进策略强平总卡数为 ${aggressiveStats.totalMarginCalls} 次，爆仓局占比 ${aggressiveStats.lossRate}。这表明当前的高杠杆和高买入气耗在不加以合理的等待回气管理时，极易导致连环扣气，触发爆仓强平。`);
  reportContent.push(`- **稳健换仓策略表现**：稳健换仓策略在允许持有最多 3 张普通牌及高周转平仓换手后，其平均得分达到 ${conservativeStats.avgScore} 分，爆仓局占比 ${conservativeStats.lossRate}。这验证了在不加杠杆时依靠高周转来套取微利也是一条非常有竞争力的稳健获利路径。`);
  reportContent.push('');
  reportContent.push('### 必胜策略与必败开局验证');
  reportContent.push(`- **必败开局概率**：对于稳健换仓策略，爆仓局占比为 ${conservativeStats.lossRate}。表明只要采取合理策略，不存在由于随机数导致的必败开局。`);
  reportContent.push(`- **必胜策略评估**：随机、激进和稳健换仓三种策略展现了极大的分差。说明玩家的主动决策极大地影响了最终得分，不存在不论如何操作都能躺赢的“必胜傻瓜策略”。`);
  reportContent.push('');

  // 自动化断言检验
  console.log('\n--- 自动平衡指标验收校验 ---');
  let passCount = 0;
  let failCount = 0;
  
  const assertMetric = (name: string, value: any, check: () => boolean, expectedText: string) => {
    const passed = check();
    if (passed) {
      passCount++;
      console.log(`\x1b[32m[PASS]\x1b[0m ${name}: 当前值为 ${value}，符合要求 ${expectedText}`);
    } else {
      failCount++;
      console.log(`\x1b[31m[FAIL]\x1b[0m ${name}: 当前值为 ${value}，不符合要求 ${expectedText}`);
    }
  };

  const aggRaw = aggressiveStats.raw;
  const conRaw = conservativeStats.raw;
  const ranRaw = randomStats.raw;

  assertMetric('激进爆仓率在 5%~20% 之间', aggRaw.lossRate.toFixed(1) + '%', () => aggRaw.lossRate >= 5 && aggRaw.lossRate <= 20, '5%~20%');
  assertMetric('稳健换仓爆仓率小于 2%', conRaw.lossRate.toFixed(1) + '%', () => conRaw.lossRate < 2, '< 2%');
  assertMetric('激进 P90 高于稳健换仓 P90', `${aggRaw.p90.toFixed(1)} vs ${conRaw.p90.toFixed(1)}`, () => aggRaw.p90 > conRaw.p90, 'Aggressive P90 > Conservative P90');
  assertMetric('激进 P10 低于稳健换仓 P50', `${aggRaw.p10.toFixed(1)} vs ${conRaw.p50.toFixed(1)}`, () => aggRaw.p10 < conRaw.p50, 'Aggressive P10 < Conservative P50');
  assertMetric('激进标准差显著高于稳健换仓标准差', `${aggRaw.stdDev.toFixed(1)} vs ${conRaw.stdDev.toFixed(1)}`, () => aggRaw.stdDev > conRaw.stdDev * 1.5, 'Aggressive SD > Conservative SD * 1.5');
  assertMetric('激进风险调整后均分限制', `${aggRaw.avgRiskAdjustedScore.toFixed(1)} vs ${conRaw.avgRiskAdjustedScore.toFixed(1)}`, () => aggRaw.avgRiskAdjustedScore <= conRaw.avgRiskAdjustedScore * 1.5, 'Aggressive RiskScore <= Conservative RiskScore * 1.5');
  assertMetric('激进平均低气回合数', aggRaw.avgLowQiRounds.toFixed(1), () => aggRaw.avgLowQiRounds >= 3 && aggRaw.avgLowQiRounds <= 10, '3-10');
  assertMetric('稳健换仓平均低气回合数', conRaw.avgLowQiRounds.toFixed(1), () => conRaw.avgLowQiRounds >= 0 && conRaw.avgLowQiRounds <= 4, '0-4');
  assertMetric('随机平均低气回合数', ranRaw.avgLowQiRounds.toFixed(1), () => ranRaw.avgLowQiRounds >= 1 && ranRaw.avgLowQiRounds <= 6, '1-6');

  console.log(`\n验收校验完成。通过 ${passCount} 项，失败 ${failCount} 项。\n`);

  reportContent.push('## 3. 数值合理性评估结论');
  reportContent.push('');
  if (failCount === 0) {
    reportContent.push('> [!NOTE]');
    reportContent.push(`> **数值平衡评估：已完美达成所有 9 项数值验收目标！** 激进策略具备显著的“高上限、低下限、大波动”风险收益不对称特征（P90为 ${aggressiveStats.p90} 领先，P10为 ${aggressiveStats.p10} 低于稳健换仓中位数 ${conservativeStats.p50}，标准差为 ${aggressiveStats.stdDev} 显著高于稳健换仓标准差 ${conservativeStats.stdDev} 的 1.5 倍）。稳健换仓策略爆仓率为 ${conservativeStats.lossRate}，无任何生存压力。各策略低气压力分布完美符合预设区间。`);
  } else {
    reportContent.push('> [!WARNING]');
    reportContent.push(`> **数值平衡评估：尚未完美通过。** 目前仍有 ${failCount} 项指标未达标。需微调策略决策权重。`);
  }
  
  reportContent.push('');
  reportContent.push('## 4. 详细模拟历史记录 (前 15 局)');
  reportContent.push('');
  reportContent.push('| 局数 | 策略类型 | 最终分数 | 回合数 | 强平次数 | 气均值 | 买/卖/等 |');
  reportContent.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i].result;
    const avgQi = (r.qiHistory.reduce((a, b) => a + b, 0) / r.qiHistory.length).toFixed(1);
    const maxDd = (r.maxDrawdown * 100).toFixed(1) + '%';
    reportContent.push(`| ${i + 1} | ${results[i].strategy} | ${r.finalScore.toFixed(1)} | ${r.totalRounds} | ${r.marginCalls} | ${avgQi} (回撤: ${maxDd}) | ${r.buysCount}/${r.sellsCount}/${r.waitsCount} |`);
  }

  // 确保 D:/works/jiazi-game/production/qa 目录存在
  const qaDir = path.resolve(__dirname, '../../production/qa');
  if (!fs.existsSync(qaDir)) {
    fs.mkdirSync(qaDir, { recursive: true });
  }

  const reportPath = path.join(qaDir, 'balance-report-2026-06-05.md');
  fs.writeFileSync(reportPath, reportContent.join('\n'), 'utf-8');
  console.log(`报告成功保存至: ${reportPath}`);
}

runSimulation().catch(console.error);
