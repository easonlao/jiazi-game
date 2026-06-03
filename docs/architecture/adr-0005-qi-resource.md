# ADR-0005: 资源管理 (Qi) 与恢复规则

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Phaser 3 |
| **Domain** | Core / Gameplay |
| **Knowledge Risk** | LOW (pure logic, no engine-specific rendering/physics) |
| **References Consulted** | None (standard TypeScript) |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Ensure JSON loading handles missing fields gracefully |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | None |
| **Enables** | TurnFlow (spending/recovery), HandManagement (buy/sell costs), Leverage (margin call) |
| **Blocks** | None |
| **Ordering Note** | None |

## Context

### Problem Statement
甲子纪 requires a resource management system for "Qi", the player's primary action currency.
It is spent to buy cards and sell them, and recovered naturally each turn or when waiting.
If Qi reaches zero while holding leveraged cards, a margin call (forced sell) must occur.

### Constraints
- Max Qi: 80
- Starting Qi: 50
- Natural recovery: 7 per turn
- Wait extra recovery: 10 per turn (total 17 if waited previous turn)
- Buy base cost: 12 * (1 + 0.05 * score)
- Leverage extra cost: 10 (LQC)
- Sell cost: 3
- Sell recovery: 8 (immediate)
- Holding cost: max(0.5, 1.5 + 0.4 * score) * leverage

### Requirements
- Manage Qi state (current, max)
- Enforce spend/recovery rules
- Trigger margin call mechanism
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
