# MVP 核心玩法验证实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证五行季节涨跌 + 气资源博弈的决策循环是否有趣，通过数据分析和结构化测试发现数值失衡问题

**Architecture:** 采用混合验证方法：先用扩展单元测试和数值模拟验证数学平衡，再用结构化测试验证游戏感受

**Tech Stack:** TypeScript, Vitest, Node.js (模拟脚本)

---

## 文件结构

### 测试文件
- `tests/unit/SeasonCycle_edge.test.ts` — 极端季节序列测试
- `tests/unit/LeverageCalculator_edge.test.ts` — 杠杆策略边界测试
- `tests/unit/QiManager_edge.test.ts` — 气耗管理边界测试
- `tests/unit/ScoreManager_edge.test.ts` — 分数计算边界测试

### 模拟脚本
- `tools/simulation/game_simulator.ts` — 游戏模拟器
- `tools/simulation/run_simulation.ts` — 运行模拟并输出报告

### 报告文件
- `production/qa/balance-report-2026-06-04.md` — 数值平衡报告
- `production/qa/test-feedback-2026-06-04.md` — 测试反馈记录
- `production/qa/parameter-adjustments-2026-06-04.md` — 参数调整清单

---

## 阶段 1：数据分析验证（第 1-2 天）

### Task 1: 极端季节序列测试

**Files:**
- Create: `tests/unit/SeasonCycle_edge.test.ts`

- [ ] **Step 1: 创建极端季节序列测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { SeasonCycle } from '../../src/core/SeasonCycle';

describe('SeasonCycle - 极端季节序列测试', () => {
  it('应该处理连续12回合的长季节', () => {
    const seasonCycle = new SeasonCycle();
    
    // 模拟连续12回合春天
    for (let i = 0; i < 12; i++) {
      seasonCycle.advanceRound();
    }
    
    expect(seasonCycle.getCurrentSeason()).toBe('spring');
    expect(seasonCycle.getSeasonRound()).toBe(12);
  });

  it('应该处理连续3回合的短季节', () => {
    const seasonCycle = new SeasonCycle();
    
    // 模拟连续3回合春天
    for (let i = 0; i < 3; i++) {
      seasonCycle.advanceRound();
    }
    
    // 第4回合应该切换到夏天
    seasonCycle.advanceRound();
    expect(seasonCycle.getCurrentSeason()).toBe('summer');
  });

  it('应该处理60回合的完整游戏', () => {
    const seasonCycle = new SeasonCycle();
    
    // 模拟60回合
    for (let i = 0; i < 60; i++) {
      seasonCycle.advanceRound();
    }
    
    // 验证季节循环正常
    expect(seasonCycle.getTotalRounds()).toBe(60);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/SeasonCycle_edge.test.ts`
Expected: FAIL with "SeasonCycle not found" or similar

- [ ] **Step 3: 实现测试通过所需的代码**

检查 `SeasonCycle.ts` 是否已有所需方法，如果没有，添加必要的方法：
- `getSeasonRound()`: 获取当前季节已进行的回合数
- `getTotalRounds()`: 获取总回合数

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/SeasonCycle_edge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/SeasonCycle_edge.test.ts
git commit -m "test: add edge case tests for SeasonCycle"
```

---

### Task 2: 杠杆策略边界测试

**Files:**
- Create: `tests/unit/LeverageCalculator_edge.test.ts`

- [ ] **Step 1: 创建杠杆策略边界测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';

describe('LeverageCalculator - 杠杆策略边界测试', () => {
  it('应该正确计算不同季节进度的杠杆倍数', () => {
    const calculator = new LeverageCalculator();
    
    // 季节第1-3回合：1.0x
    expect(calculator.getLeverage(1)).toBe(1.0);
    expect(calculator.getLeverage(2)).toBe(1.0);
    expect(calculator.getLeverage(3)).toBe(1.0);
    
    // 季节第4-6回合：1.5x
    expect(calculator.getLeverage(4)).toBe(1.5);
    expect(calculator.getLeverage(5)).toBe(1.5);
    expect(calculator.getLeverage(6)).toBe(1.5);
    
    // 季节第7-9回合：2.0x
    expect(calculator.getLeverage(7)).toBe(2.0);
    expect(calculator.getLeverage(8)).toBe(2.0);
    expect(calculator.getLeverage(9)).toBe(2.0);
    
    // 季节第10-11回合：2.5x
    expect(calculator.getLeverage(10)).toBe(2.5);
    expect(calculator.getLeverage(11)).toBe(2.5);
    
    // 季节第12回合：3.0x
    expect(calculator.getLeverage(12)).toBe(3.0);
  });

  it('应该处理边界值（0和负数）', () => {
    const calculator = new LeverageCalculator();
    
    // 边界值应该返回默认值1.0
    expect(calculator.getLeverage(0)).toBe(1.0);
    expect(calculator.getLeverage(-1)).toBe(1.0);
  });

  it('应该处理超大值', () => {
    const calculator = new LeverageCalculator();
    
    // 超大值应该返回最大杠杆3.0
    expect(calculator.getLeverage(13)).toBe(3.0);
    expect(calculator.getLeverage(100)).toBe(3.0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/LeverageCalculator_edge.test.ts`
Expected: FAIL with "LeverageCalculator not found" or similar

- [ ] **Step 3: 实现测试通过所需的代码**

检查 `LeverageCalculator.ts` 是否已有所需方法，如果没有，添加必要的方法。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/LeverageCalculator_edge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/LeverageCalculator_edge.test.ts
git commit -m "test: add edge case tests for LeverageCalculator"
```

---

### Task 3: 气耗管理边界测试

**Files:**
- Create: `tests/unit/QiManager_edge.test.ts`

- [ ] **Step 1: 创建气耗管理边界测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { QiManager } from '../../src/core/QiManager';

describe('QiManager - 气耗管理边界测试', () => {
  it('应该处理低气开局（10气）', () => {
    const qiManager = new QiManager(10); // 初始10气
    
    // 第一回合自然回复7气
    qiManager.applyNaturalRecovery();
    expect(qiManager.getQi()).toBe(17);
  });

  it('应该处理高气开局（80气）', () => {
    const qiManager = new QiManager(80); // 初始80气
    
    // 第一回合自然回复7气，但不能超过上限
    qiManager.applyNaturalRecovery();
    expect(qiManager.getQi()).toBe(80); // 不能超过上限
  });

  it('应该正确计算买入消耗', () => {
    const qiManager = new QiManager(50);
    
    // 买入消耗 = 12 * (1 + 0.05 * 评分)
    // 评分4.0时：12 * (1 + 0.05 * 4.0) = 12 * 1.2 = 14.4
    const cost = qiManager.calculateBuyCost(4.0);
    expect(cost).toBeCloseTo(14.4, 1);
  });

  it('应该正确计算持仓气耗', () => {
    const qiManager = new QiManager(50);
    
    // 持仓气耗 = max(0.5, 1.5 + 0.4 * 评分) * 杠杆
    // 评分4.0，杠杆1.0时：max(0.5, 1.5 + 0.4 * 4.0) * 1.0 = max(0.5, 3.1) * 1.0 = 3.1
    const cost = qiManager.calculateHoldCost(4.0, 1.0);
    expect(cost).toBeCloseTo(3.1, 1);
  });

  it('应该正确计算卖出即时回复', () => {
    const qiManager = new QiManager(50);
    
    // 卖出即时回复8气
    qiManager.applySellRecovery();
    expect(qiManager.getQi()).toBe(58);
  });

  it('应该正确计算等待额外回复', () => {
    const qiManager = new QiManager(50);
    
    // 等待额外回复10气
    qiManager.applyWaitRecovery();
    expect(qiManager.getQi()).toBe(60);
  });

  it('应该处理气耗后气为负数的情况', () => {
    const qiManager = new QiManager(5);
    
    // 气耗后气为负数，应该触发爆仓检查
    qiManager.deductQi(10);
    expect(qiManager.getQi()).toBeLessThanOrEqual(0);
    expect(qiManager.isMarginCall()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/QiManager_edge.test.ts`
Expected: FAIL with "QiManager not found" or similar

- [ ] **Step 3: 实现测试通过所需的代码**

检查 `QiManager.ts` 是否已有所需方法，如果没有，添加必要的方法：
- `calculateBuyCost(score: number)`: 计算买入消耗
- `calculateHoldCost(score: number, leverage: number)`: 计算持仓气耗
- `applySellRecovery()`: 应用卖出即时回复
- `applyWaitRecovery()`: 应用等待额外回复
- `isMarginCall()`: 检查是否爆仓

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/QiManager_edge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/QiManager_edge.test.ts
git commit -m "test: add edge case tests for QiManager"
```

---

### Task 4: 分数计算边界测试

**Files:**
- Create: `tests/unit/ScoreManager_edge.test.ts`

- [ ] **Step 1: 创建分数计算边界测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { ScoreManager } from '../../src/core/ScoreManager';

describe('ScoreManager - 分数计算边界测试', () => {
  it('应该正确计算持仓收益', () => {
    const scoreManager = new ScoreManager();
    
    // 持仓收益 = HOLD_BONUS(1.2) * 评分 * 杠杆
    // 评分4.0，杠杆1.0时：1.2 * 4.0 * 1.0 = 4.8
    const earning = scoreManager.calculateHoldEarning(4.0, 1.0);
    expect(earning).toBeCloseTo(4.8, 1);
  });

  it('应该正确计算卖出得分', () => {
    const scoreManager = new ScoreManager();
    
    // 卖出得分 = (SELL_BASE(8.0) + (当前评分 - 买入评分) * SPREAD_MULTIPLIER(4.0)) * 杠杆
    // 当前评分4.0，买入评分-3.0，杠杆1.0时：
    // (8.0 + (4.0 - (-3.0)) * 4.0) * 1.0 = (8.0 + 7.0 * 4.0) * 1.0 = (8.0 + 28.0) * 1.0 = 36.0
    const score = scoreManager.calculateSellScore(4.0, -3.0, 1.0);
    expect(score).toBeCloseTo(36.0, 1);
  });

  it('应该处理负评分的卖出得分', () => {
    const scoreManager = new ScoreManager();
    
    // 负评分卖出：当前评分-3.0，买入评分4.0，杠杆1.0时：
    // (8.0 + (-3.0 - 4.0) * 4.0) * 1.0 = (8.0 + (-7.0) * 4.0) * 1.0 = (8.0 - 28.0) * 1.0 = -20.0
    const score = scoreManager.calculateSellScore(-3.0, 4.0, 1.0);
    expect(score).toBeCloseTo(-20.0, 1);
  });

  it('应该处理杠杆对分数的影响', () => {
    const scoreManager = new ScoreManager();
    
    // 杠杆2.0时，收益应该翻倍
    const earning = scoreManager.calculateHoldEarning(4.0, 2.0);
    expect(earning).toBeCloseTo(9.6, 1); // 4.8 * 2.0
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/ScoreManager_edge.test.ts`
Expected: FAIL with "ScoreManager not found" or similar

- [ ] **Step 3: 实现测试通过所需的代码**

检查 `ScoreManager.ts` 是否已有所需方法，如果没有，添加必要的方法：
- `calculateHoldEarning(score: number, leverage: number)`: 计算持仓收益
- `calculateSellScore(currentScore: number, buyScore: number, leverage: number)`: 计算卖出得分

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/ScoreManager_edge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/ScoreManager_edge.test.ts
git commit -m "test: add edge case tests for ScoreManager"
```

---

### Task 5: 游戏模拟器实现

**Files:**
- Create: `tools/simulation/game_simulator.ts`
- Create: `tools/simulation/run_simulation.ts`

- [ ] **Step 1: 创建游戏模拟器**

```typescript
// tools/simulation/game_simulator.ts
import { TurnManager, GameState } from '../../src/core';

export interface SimulationResult {
  finalScore: number;
  totalRounds: number;
  seasonSequence: string[];
  qiHistory: number[];
  scoreHistory: number[];
  decisions: string[];
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
      decisions: []
    };
  }

  async simulateGame(strategy: 'random' | 'aggressive' | 'conservative'): Promise<SimulationResult> {
    await this.turnManager.initialize();
    this.turnManager.startGame();

    while (this.turnManager.getState() !== 'game_over') {
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
      switch (decision) {
        case 'buy':
          const publicCards = this.turnManager.getPublicCards();
          if (publicCards.length > 0) {
            this.turnManager.executeBuy(0, false); // 买第一张，无杠杆
          }
          break;
        case 'sell':
          const hand = this.turnManager.getHand();
          const firstCardIndex = hand.findIndex(slot => slot !== null);
          if (firstCardIndex !== -1) {
            this.turnManager.executeSell(firstCardIndex);
          }
          break;
        case 'wait':
          this.turnManager.executeWait();
          break;
      }
    }

    this.result.finalScore = this.turnManager.getScore();
    this.result.totalRounds = this.turnManager.getCurrentRound();

    return this.result;
  }

  private makeDecision(strategy: string, round: number, season: string, qi: number, score: number): string {
    switch (strategy) {
      case 'random':
        return this.randomDecision();
      case 'aggressive':
        return this.aggressiveDecision(round, season, qi, score);
      case 'conservative':
        return this.conservativeDecision(round, season, qi, score);
      default:
        return 'wait';
    }
  }

  private randomDecision(): string {
    const decisions = ['buy', 'sell', 'wait'];
    return decisions[Math.floor(Math.random() * 3)];
  }

  private aggressiveDecision(round: number, season: string, qi: number, score: number): string {
    // 激进策略：尽量买入，高杠杆
    if (qi > 30 && this.turnManager.getHand().some(slot => slot === null)) {
      return 'buy';
    } else if (this.turnManager.getHand().some(slot => slot !== null)) {
      return 'sell';
    } else {
      return 'wait';
    }
  }

  private conservativeDecision(round: number, season: string, qi: number, score: number): string {
    // 保守策略：等待为主，低杠杆
    if (qi < 40) {
      return 'wait';
    } else if (this.turnManager.getHand().some(slot => slot !== null) && score > 0) {
      return 'sell';
    } else if (qi > 60 && this.turnManager.getHand().some(slot => slot === null)) {
      return 'buy';
    } else {
      return 'wait';
    }
  }
}
```

- [ ] **Step 2: 创建模拟运行脚本**

```typescript
// tools/simulation/run_simulation.ts
import { GameSimulator, SimulationResult } from './game_simulator';

async function runSimulation() {
  const simulator = new GameSimulator();
  
  console.log('开始运行游戏模拟...');
  console.log('策略: random');
  
  const result = await simulator.simulateGame('random');
  
  console.log('\n=== 模拟结果 ===');
  console.log(`最终分数: ${result.finalScore.toFixed(1)}`);
  console.log(`总回合数: ${result.totalRounds}`);
  console.log(`季节序列: ${result.seasonSequence.join(', ')}`);
  console.log(`决策序列: ${result.decisions.join(', ')}`);
  
  // 输出气的历史
  console.log('\n气的历史 (前10回合):');
  for (let i = 0; i < Math.min(10, result.qiHistory.length); i++) {
    console.log(`  回合 ${i + 1}: ${result.qiHistory[i]}`);
  }
  
  // 输出分数的历史
  console.log('\n分数的历史 (前10回合):');
  for (let i = 0; i < Math.min(10, result.scoreHistory.length); i++) {
    console.log(`  回合 ${i + 1}: ${result.scoreHistory[i].toFixed(1)}`);
  }
}

runSimulation().catch(console.error);
```

- [ ] **Step 3: 运行模拟脚本**

Run: `npx ts-node tools/simulation/run_simulation.ts`
Expected: 模拟运行并输出结果

- [ ] **Step 4: 提交**

```bash
git add tools/simulation/
git commit -m "feat: add game simulator for balance testing"
```

---

### Task 6: 运行数值模拟并生成报告

**Files:**
- Create: `production/qa/balance-report-2026-06-04.md`

- [ ] **Step 1: 运行100局模拟**

修改 `run_simulation.ts` 运行100局模拟：

```typescript
// tools/simulation/run_simulation.ts
import { GameSimulator, SimulationResult } from './game_simulator';

async function runSimulation() {
  const results: SimulationResult[] = [];
  const strategies = ['random', 'aggressive', 'conservative'];
  
  console.log('开始运行100局游戏模拟...');
  
  for (let i = 0; i < 100; i++) {
    const simulator = new GameSimulator();
    const strategy = strategies[i % 3]; // 轮流使用三种策略
    const result = await simulator.simulateGame(strategy);
    results.push(result);
    
    if (i % 10 === 0) {
      console.log(`已完成 ${i} 局...`);
    }
  }
  
  console.log('\n=== 模拟统计 ===');
  
  // 计算统计信息
  const scores = results.map(r => r.finalScore);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const stdDev = Math.sqrt(scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length);
  
  console.log(`平均分数: ${avgScore.toFixed(1)}`);
  console.log(`最低分数: ${minScore.toFixed(1)}`);
  console.log(`最高分数: ${maxScore.toFixed(1)}`);
  console.log(`标准差: ${stdDev.toFixed(1)}`);
  
  // 分析必胜策略
  const winningGames = results.filter(r => r.finalScore > 0).length;
  console.log(`胜率: ${(winningGames / results.length * 100).toFixed(1)}%`);
  
  // 分析必败开局
  const earlyLosses = results.filter(r => r.qiHistory[5] <= 0).length;
  console.log(`早期爆仓率: ${(earlyLosses / results.length * 100).toFixed(1)}%`);
  
  // 输出详细结果
  console.log('\n详细结果 (前10局):');
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`局 ${i + 1}: 分数=${r.finalScore.toFixed(1)}, 回合=${r.totalRounds}, 策略=${['random', 'aggressive', 'conservative'][i % 3]}`);
  }
}

runSimulation().catch(console.error);
```

- [ ] **Step 2: 运行模拟并生成报告**

Run: `npx ts-node tools/simulation/run_simulation.ts > production/qa/balance-report-2026-06-04.md`
Expected: 生成数值平衡报告

- [ ] **Step 3: 提交**

```bash
git add production/qa/balance-report-2026-06-04.md
git commit -m "docs: add balance report from 100-game simulation"
```

---

## 阶段 2：结构化测试验证（第 3-5 天）

### Task 7: 创建测试反馈记录模板

**Files:**
- Create: `production/qa/test-feedback-2026-06-04.md`

- [ ] **Step 1: 创建测试反馈记录模板**

```markdown
# 测试反馈记录

*测试时间：2026-06-04*  
*测试人员：[姓名]*  
*测试目标：验证核心玩法是否有趣*

---

## 测试场景 1：标准开局

### 测试设置
- 初始气：50
- 季节序列：随机
- 策略：正常游戏

### 测试记录

| 回合 | 决策 | 气 | 分数 | 感受 |
|------|------|-----|------|------|
| 1 | 买木牌 | 38 | +12 | 紧张 |
| 2 | 等待 | 45 | +8 | 遗憾 |
| 3 | 卖木牌 | 53 | +20 | 满足 |
| ... | ... | ... | ... | ... |

### 关键发现
- [ ] 决策是否有意义？
- [ ] 是否感受到紧张感？
- [ ] 是否感受到交易乐趣？

---

## 测试场景 2：极端季节

### 测试设置
- 初始气：50
- 季节序列：故意触发长季节/短季节
- 策略：观察体验

### 测试记录

| 回合 | 决策 | 气 | 分数 | 感受 |
|------|------|-----|------|------|
| 1 | 买木牌 | 38 | +12 | 紧张 |
| 2 | 等待 | 45 | +8 | 遗憾 |
| 3 | 卖木牌 | 53 | +20 | 满足 |
| ... | ... | ... | ... | ... |

### 关键发现
- [ ] 长季节是否无聊？
- [ ] 短季节是否紧张？
- [ ] 季节变化是否明显？

---

## 测试场景 3：杠杆策略

### 测试设置
- 初始气：50
- 季节序列：随机
- 策略：高杠杆 vs 低杠杆

### 测试记录

| 回合 | 决策 | 气 | 分数 | 感受 |
|------|------|-----|------|------|
| 1 | 买木牌（杠杆2.0） | 28 | +24 | 高风险高回报 |
| 2 | 等待 | 35 | +16 | 焦虑 |
| 3 | 卖木牌 | 43 | +40 | 兴奋 |
| ... | ... | ... | ... | ... |

### 关键发现
- [ ] 杠杆是否有吸引力？
- [ ] 风险回报是否合理？
- [ ] 爆仓是否频繁？

---

## 测试场景 4：气耗压力

### 测试设置
- 初始气：20（低气开局）
- 季节序列：随机
- 策略：管理气资源

### 测试记录

| 回合 | 决策 | 气 | 分数 | 感受 |
|------|------|-----|------|------|
| 1 | 等待 | 27 | +0 | 无奈 |
| 2 | 等待 | 37 | +0 | 焦虑 |
| 3 | 买木牌 | 25 | +12 | 终于能买了 |
| ... | ... | ... | ... | ... |

### 关键发现
- [ ] 低气是否压力过大？
- [ ] 等待是否有意义？
- [ ] 气回复是否合理？

---

## 综合评估

### 决策深度
- [ ] 每回合决策是否有意义？
- [ ] 是否有"最佳选择"？
- [ ] 是否有"困难选择"？

### 数值平衡
- [ ] 气、分数、杠杆是否合理？
- [ ] 是否有必胜策略？
- [ ] 是否有必败开局？

### 上手体验
- [ ] 游戏是否在第1分钟就能吸引玩家？
- [ ] 规则是否容易理解？
- [ ] 反馈是否及时？

### 交易感觉
- [ ] 是否感受到"低买高卖"的乐趣？
- [ ] 是否感受到紧张感？
- [ ] 是否愿意再玩一局？

---

## 问题清单

1. [问题1]
2. [问题2]
3. [问题3]

---

## 建议调整

1. [建议1]
2. [建议2]
3. [建议3]
```

- [ ] **Step 2: 提交**

```bash
git add production/qa/test-feedback-2026-06-04.md
git commit -m "docs: add test feedback template"
```

---

### Task 8: 进行结构化测试

**Files:**
- Modify: `production/qa/test-feedback-2026-06-04.md`

- [ ] **Step 1: 进行测试场景 1（标准开局）**

按照模板进行测试，记录每回合的数据和感受。

- [ ] **Step 2: 进行测试场景 2（极端季节）**

按照模板进行测试，记录每回合的数据和感受。

- [ ] **Step 3: 进行测试场景 3（杠杆策略）**

按照模板进行测试，记录每回合的数据和感受。

- [ ] **Step 4: 进行测试场景 4（气耗压力）**

按照模板进行测试，记录每回合的数据和感受。

- [ ] **Step 5: 填写综合评估**

根据测试结果，填写综合评估部分。

- [ ] **Step 6: 提交**

```bash
git add production/qa/test-feedback-2026-06-04.md
git commit -m "docs: update test feedback with actual test results"
```

---

## 阶段 3：综合调整（第 6-7 天）

### Task 9: 创建参数调整清单

**Files:**
- Create: `production/qa/parameter-adjustments-2026-06-04.md`

- [ ] **Step 1: 创建参数调整清单**

```markdown
# 参数调整清单

*创建时间：2026-06-04*  
*依据：数值平衡报告 + 测试反馈记录*

---

## 调整依据

### 数值平衡报告发现的问题
1. [问题1]
2. [问题2]
3. [问题3]

### 测试反馈发现的问题
1. [问题1]
2. [问题2]
3. [问题3]

---

## 参数调整

### 1. MAX_QI（气上限）
- **当前值**：80
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 2. QR（自然回气）
- **当前值**：7
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 3. WR（等待额外回气）
- **当前值**：10
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 4. CB（基础买入消耗）
- **当前值**：12
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 5. CS（卖出即时回气）
- **当前值**：8
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 6. LQC（杠杆固定消耗）
- **当前值**：10
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 7. HOLD_BONUS（持仓收益系数）
- **当前值**：1.2
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 8. SELL_BASE（卖出得分基础）
- **当前值**：8.0
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 9. SPREAD_MULTIPLIER（差价乘数）
- **当前值**：4.0
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

### 10. CANG_GAN_WEIGHT（地支藏干权重）
- **当前值**：0.5
- **建议值**：[待定]
- **调整原因**：[原因]
- **预期效果**：[效果]

---

## 调整优先级

1. [高优先级调整]
2. [中优先级调整]
3. [低优先级调整]

---

## 验证计划

- [ ] 调整后重新运行数值模拟
- [ ] 调整后重新进行结构化测试
- [ ] 验证调整效果是否符合预期
```

- [ ] **Step 2: 提交**

```bash
git add production/qa/parameter-adjustments-2026-06-04.md
git commit -m "docs: add parameter adjustment plan"
```

---

### Task 10: 执行参数调整并验证

**Files:**
- Modify: `src/data/constants.ts`（如果存在）
- Modify: `src/core/QiManager.ts`
- Modify: `src/core/ScoreManager.ts`
- Modify: `production/qa/parameter-adjustments-2026-06-04.md`

- [ ] **Step 1: 执行参数调整**

根据参数调整清单，修改相应的代码文件。

- [ ] **Step 2: 重新运行数值模拟**

Run: `npx ts-node tools/simulation/run_simulation.ts > production/qa/balance-report-2026-06-04-v2.md`
Expected: 生成新的数值平衡报告

- [ ] **Step 3: 重新运行单元测试**

Run: `npx vitest run`
Expected: 所有测试通过

- [ ] **Step 4: 更新参数调整清单**

更新 `production/qa/parameter-adjustments-2026-06-04.md`，记录调整后的验证结果。

- [ ] **Step 5: 提交**

```bash
git add src/data/constants.ts src/core/QiManager.ts src/core/ScoreManager.ts production/qa/balance-report-2026-06-04-v2.md production/qa/parameter-adjustments-2026-06-04.md
git commit -m "feat: adjust game parameters based on balance testing"
```

---

### Task 11: 更新 GDD 调参旋钮表

**Files:**
- Modify: `design/gdd/master_gdd.md`

- [ ] **Step 1: 更新 GDD 调参旋钮表**

根据参数调整清单，更新 `design/gdd/master_gdd.md` 中的调参旋钮表。

- [ ] **Step 2: 提交**

```bash
git add design/gdd/master_gdd.md
git commit -m "docs: update tuning knobs table in master GDD"
```

---

## 自查清单

- [ ] 所有测试场景都已覆盖
- [ ] 数值平衡报告已生成
- [ ] 测试反馈记录已填写
- [ ] 参数调整清单已确定
- [ ] 参数调整已执行并验证
- [ ] GDD 已更新
- [ ] 所有文件已提交
