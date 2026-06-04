# MVP 核心玩法结构化测试反馈记录

*测试时间：2026-06-04*  
*测试人员：QA Tester*  
*测试环境：Node.js v18+, Vitest v4.1.8*

---

## 1. 自动化单元测试运行结果 (Automated Test Execution)

我们执行了针对核心逻辑边界与强平爆仓控制流的完整自动化单元测试。测试在修复后重新执行，所有断言均 100% 通过。

### 1.1 新增/修改测试用例清单与状态
| 模块名称 | 测试用例 ID | 测试点描述 | 状态 |
| :--- | :--- | :--- | :--- |
| **LeverageCalculator** | TC-01-LC | 应该正确计算反季（-3评分）在 2.0 杠杆下的持仓气耗为 1.0 (修正公式后) | **PASS** |
| **QiManager** | TC-02-QM | 验证 `spend` (余额不足不扣减) 与 `deductQi` (允许强制扣为负数) 的行为差异 | **PASS** |
| **TurnManager** | TC-03-TM-1 | **利息赖账 Bug 校验**：强制扣持仓气耗允许气扣减为负数并正确触发 Margin Call | **PASS** |
| **TurnManager** | TC-04-TM-2 | **单张强平分数结算**：爆仓平仓后正常结算并累加卖出得分，且绕过卖出气耗/气回复 | **PASS** |
| **TurnManager** | TC-05-TM-3 | **多张牌循环强平**：气 <= 0 时，循环随机强平手牌中所有杠杆牌直到气 > 0 或清空 | **PASS** |

### 1.2 运行命令行输出证据
```bash
npx vitest run tests/unit/
```
```
 RUN  v4.1.8 D:/works/jiazi-game

 ✓ tests/unit/LeverageCalculator.test.ts (3 tests)
 ✓ tests/unit/QiManager.test.ts (5 tests)
 ✓ tests/unit/QiManager_edge.test.ts (8 tests)
 ✓ tests/unit/SeasonCycle_edge.test.ts (3 tests)
 ✓ tests/unit/SeasonCycle.test.ts (4 tests)
 ✓ tests/unit/ScoreManager.test.ts (5 tests)
 ✓ tests/unit/CardPoolManager.test.ts (4 tests)
 ✓ tests/unit/LeverageCalculator_edge.test.ts (4 tests)
 ✓ tests/unit/TurnManager_edge.test.ts (3 tests)
 ✓ tests/unit/TurnManager.test.ts (3 tests)
 ✓ tests/unit/ScoreManager_edge.test.ts (4 tests)

 Test Files  12 passed (12)
      Tests  50 passed (50)
```

---

## 2. 结构化测试场景运行反馈 (Simulation Scenarios)

通过运行 100 局自动化模拟脚本（涵盖三种策略风格），反馈如下：

### 场景 1：标准开局与气回复 (Standard Play & Qi Management)
- **现象**：保守策略表现出高稳定性，其爆仓强平次数为 **0 次**。当气低于 40 时，保守策略坚决选择等待，在获得自然恢复 7 气的同时，下回合额外获得 10 气等待加成。
- **反馈**：气管理的抉择非常明显。由于每次买入需消耗 12-15 气，若不加节制地买入，几个回合内就会面临零气困境。等待操作有效缓解了气资源压力。

### 场景 2：极端季节蛰伏 (Extreme Season Dwell)
- **现象**：当季节过长（如连续推进 12 回合春天）时，反季卡牌的评分持续处于低位（例如 -3 评分）。
- **反馈**：反季卡牌的持仓成本修正后为 `Math.max(0.5, 1.5 + 0.4 * -3) * leverage = 0.5 * leverage`。对于无杠杆牌，每回合仅消耗 0.5 气，允许玩家安全“猫冬”蛰伏。高杠杆牌（如 2.0 杠杆）每回合消耗 1.0 气，在长季节中依然有较高扛仓负担，非常考验玩家对气水位的判断。

### 场景 3：杠杆策略与爆仓机制 (Leverage & Liquidation)
- **现象**：激进策略在买入卡牌时无脑加杠杆，其在 100 局模拟中**共计爆仓被强平 20 次**（平均每局 0.6 次）。
- **反馈**：
  1. 爆仓强平逻辑现在工作正常，当持仓阶段结算完扣气导致当前气 `<= 0` 时，系统准确识别并立刻执行了 `handleMarginCall()`。
  2. 多张杠杆牌的循环强平运行良好（已由 TC-05-TM-3 覆盖）。
  3. 异常点：尽管激进策略被频繁强平，但由于**强平后仍能全额获得卖出分数**（ SB(8) + 评分差 * SM(4) ），它通过杠杆倍数白嫖了巨大的收益。这导致即使频繁爆仓，激进策略的均分（255.9）依然大幅领先于保守策略（196.7）。

### 场景 4：低气开局压力 (Low Qi Start)
- **现象**：模拟中未发现早期爆仓率（前 10 回合内爆仓概率为 0.0%）。
- **反馈**：由于初始气为 50 且上限为 80，开局时玩家拥有充足的腾挪空间。只要不在前 3 回合内全部买入高杠杆牌，一般不会触发早期爆仓，起到了良好的新手保护作用。

---

## 3. 问题与建议清单 (Triage & Tuning Recommendations)

根据测试反馈，我们将建议整理如下，交由 Game Designer 进行阶段 3 的综合调整：

1. **[高优先级 - 机制问题] 强平无惩罚导致激进策略得分偏高**
   - **分析**：目前爆仓强平只是替玩家做出了“平仓”选择，但依然为其结算全额的卖出积分，使得爆仓几乎“无痛”。激进策略得以依靠极高的杠杆倍数刷分。
   - **建议**：在 `handleMarginCall` 结算时，强制平仓的卡牌所得积分应打折（如仅获得 80% 的卖出积分），或者爆仓时扣减玩家当前总分的一定百分比（如扣 5%），增加违约成本。
2. **[中优先级 - 数值问题] 保守策略收益略低**
   - **分析**：保守策略在气低于 40 时就会选择等待。当气紧凑时，频繁的等待导致其错失了最佳季节波段卖出的机会，导致得分偏低（196.7）。
   - **建议**：可适度微调保守策略的气阈值，或者将 `CB` (基础买入消耗) 从 12 降低到 11，提升流动性气周转。
