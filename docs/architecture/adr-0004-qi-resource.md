# ADR-0004: 气资源管理与恢复规则

## 状态
已接受

## 日期
2026-05-04

## 引擎兼容性

| 字段 | 值 |
|-------|-------|
| **引擎** | Phaser 3.90.0 |
| **领域** | 核心 / 游戏玩法 |
| **知识风险** | 低（纯逻辑，无引擎特定渲染/物理） |
| **参考文档** | 无（标准 TypeScript） |
| **后续版本 API** | 无 |
| **验证需求** | 确保 JSON 加载优雅地处理缺失字段 |

## ADR 依赖关系

| 字段 | 值 |
|-------|-------|
| **依赖** | 无 |
| **启用** | TurnManager（花费/恢复）、HandManager（买入/卖出成本）、LeverageCalculator（强制平仓） |
| **阻塞** | 无 |
| **顺序说明** | 无 |

## 背景

### 问题陈述
甲子纪需要一个"气"资源管理系统，作为玩家的主要行动货币。气用于购买和出售卡牌，每回合自然恢复或等待时恢复。如果持有杠杆牌时气归零，必须触发强制平仓。

### 约束条件
- 最大气：80
- 初始气：50
- 自然恢复：每回合 7
- 等待额外恢复：每回合 10（如果上回合等待，总共 17）
- 买入基础成本：12 * (1 + 0.05 * 评分)
- 杠杆额外成本：10 (LQC)
- 卖出成本：3
- 卖出恢复：8（立即）
- 持仓成本：max(0.5, 1.5 + 0.4 * 评分) * 杠杆

### 需求
- 管理气状态（当前、最大）
- 强制执行花费/恢复规则
- 触发强制平仓机制
- Notify UI of changes via events

## Decision

### QiManager as Singleton

`QiManager` will be a global singleton to provide easy access
from all game systems (TurnFlow, HandManagement, UI).

### Public Interface

```typescript
// QiManager.ts
import { EventEmitter } from 'events';

export interface QiManagerEvents {
  qiChanged: (newQi: number, oldQi: number) => void;
  qiDepleted: () => void;
  marginCallTriggered: (cardName: string, slot: number) => void;
}

export class QiManager extends EventEmitter {
  static readonly MAX_QI: number = 80;
  static readonly START_QI: number = 50;
  static readonly BASE_RECOVERY: number = 7;
  static readonly WAIT_BONUS: number = 10;
  static readonly SELL_COST: number = 3;
  static readonly SELL_RECOVERY: number = 8;
  static readonly LEVERAGE_EXTRA_COST: number = 10;

  private currentQi: number = QiManager.START_QI;

  getQi(): number {
    return this.currentQi;
  }

  getMaxQi(): number {
    return QiManager.MAX_QI;
  }

  spend(amount: number): boolean {
    if (this.currentQi >= amount) {
      const oldQi = this.currentQi;
      this.currentQi -= amount;
      this.emit('qiChanged', this.currentQi, oldQi);
      if (this.currentQi === 0) {
        this.emit('qiDepleted');
      }
      return true;
    }
    return false;
  }

  recover(amount: number): void {
    const oldQi = this.currentQi;
    this.currentQi = Math.min(QiManager.MAX_QI, this.currentQi + amount);
    if (this.currentQi !== oldQi) {
      this.emit('qiChanged', this.currentQi, oldQi);
    }
  }

  canAfford(amount: number): boolean {
    return this.currentQi >= amount;
  }

  getBuyCost(cardScore: number, useLeverage: boolean): number {
    let cost = 12 * (1 + 0.05 * cardScore);
    if (useLeverage) {
      cost += QiManager.LEVERAGE_EXTRA_COST;
    }
    return Math.round(cost);
  }

  getHoldCost(cardScore: number, leverage: number): number {
    const base = Math.max(0.5, 1.5 + 0.4 * cardScore);
    return base * leverage;
  }
}
```

### Margin Call Logic

While QiManager tracks Qi, it does NOT directly modify hand state.
It emits `qiDepleted` and `marginCallTriggered` events.
TurnFlow listens and coordinates the forced sell.

```typescript
// TurnFlow.ts (after deducting hold costs)
private checkMarginCall(): void {
  while (this.qiManager.getQi() === 0 && this.handManager.hasLeverageCards()) {
    const slot = this.handManager.getRandomLeverageSlot();
    const handSlot = this.handManager.getCardAt(slot);
    this.qiManager.emit('marginCallTriggered', handSlot.card.name, slot);
    // Calculate sell score
    const sellScore = this.scoring.calculateSellScore(
      handSlot.card,
      handSlot.buyScore,
      this.season.getCurrentSeason()
    );
    this.scoring.addScore(sellScore);
    this.handManager.sell(slot);
    // Note: Sell cost (3) is NOT deducted for forced sells
    // Note: Sell recovery (8) is NOT applied for forced sells
  }
}
```

## Alternatives Considered

### Alternative 1: QiManager handles margin calls directly

- **Description**: QiManager calls HandManager methods directly.
- **Pros**: Centralized error handling.
- **Cons**: Creates circular dependency (QiManager -> HandManager -> QiManager).
- **Rejection Reason**: Violates separation of concerns; TurnFlow is the orchestrator.

## Consequences

### Positive
- Centralized resource management.
- Clear, testable interface.
- Events decouple Qi state from UI and other systems.

### Negative
- Margin call logic is split between QiManager and TurnFlow.
- Potential for forgetting to check margin call after Qi changes.

### Risks
- **Integer rounding**: GDD formulas use decimals; continuous rounding could drift.
  Mitigation: Store Qi as `number` internally, expose via getter.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-qi-resource.md | Max 80, start 50 | `MAX_QI`, `START_QI` constants |
| system-qi-resource.md | Recovery 7 per turn | `BASE_RECOVERY` in `recoverTurn` |
| system-qi-resource.md | Wait recovers 10 | `WAIT_BONUS` |
| system-qi-resource.md | Buy cost formula | `getBuyCost` |
| system-qi-resource.md | Sell cost 3, recovery 8 | `SELL_COST`, `SELL_RECOVERY` |
| system-qi-resource.md | Hold cost formula | `getHoldCost` |
| system-leverage.md | Margin call at Qi=0 | `qiDepleted` event + TurnFlow logic |

## Performance Implications
- **CPU**: Negligible (basic arithmetic).
- **Memory**: Negligible.

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] Unit tests for spend/recover boundaries.
- [ ] Unit tests for cost calculations.
- [ ] Integration test: Qi reaches 0 with leverage card -> margin call triggers.
- [ ] Integration test: Qi reaches 0 without leverage -> game over.

## Related Decisions
- ADR-0004: Card data and scoring (provides score values for cost calculations)
