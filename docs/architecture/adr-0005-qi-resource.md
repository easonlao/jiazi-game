# ADR-0005: 资源管理 (Qi) 与恢复规则

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core / Gameplay |
| **Knowledge Risk** | LOW (pure logic, no engine-specific rendering/physics) |
| **References Consulted** | None (standard GDScript) |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Ensure JSON loading handles missing fields gracefully |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0002 (Singleton vs Node design) |
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
- Notify UI of changes via signals

## Decision

### QiManager as Autoload

`QiManager` will be a global singleton (Autoload) to provide easy access
from all game systems (TurnFlow, HandManagement, UI).

### Public Interface

```gdscript
# QiManager.gd
extends Node

signal qi_changed(new_qi: int, old_qi: int)
signal qi_depleted()
signal margin_call_triggered(card_name: String, slot: int)

const MAX_QI: int = 80
const START_QI: int = 50
const BASE_RECOVERY: int = 7
const WAIT_BONUS: int = 10
const SELL_COST: int = 3
const SELL_RECOVERY: int = 8
const LEVERAGE_EXTRA_COST: int = 10

var current_qi: int = START_QI

func get_qi() -> int:
    return current_qi

func get_max_qi() -> int:
    return MAX_QI

func spend(amount: int) -> bool:
    if current_qi >= amount:
        var old_qi = current_qi
        current_qi -= amount
        qi_changed.emit(current_qi, old_qi)
        if current_qi == 0:
            qi_depleted.emit()
        return true
    return false

func recover(amount: int) -> void:
    var old_qi = current_qi
    current_qi = min(MAX_QI, current_qi + amount)
    if current_qi != old_qi:
        qi_changed.emit(current_qi, old_qi)

func can_afford(amount: int) -> bool:
    return current_qi >= amount

func get_buy_cost(card_score: float, use_leverage: bool) -> int:
    var cost = 12 * (1 + 0.05 * card_score)
    if use_leverage:
        cost += LEVERAGE_EXTRA_COST
    return int(round(cost))

func get_hold_cost(card_score: float, leverage: float) -> float:
    var base = max(0.5, 1.5 + 0.4 * card_score)
    return base * leverage
```

### Margin Call Logic

While QiManager tracks Qi, it does NOT directly modify hand state.
It emits `qi_depleted` and `margin_call_triggered` signals.
TurnFlow listens and coordinates the forced sell.

```gdscript
# TurnFlow.gd (after deducting hold costs)
func _check_margin_call() -> void:
    while qi_manager.get_qi() == 0 and hand_manager.has_leverage_cards():
        var slot = hand_manager.get_random_leverage_slot()
        var card = hand_manager.get_card(slot)
        qi_manager.margin_call_triggered.emit(card.name, slot)
        # Calculate sell score
        var sell_score = score_manager.calculate_sell_score(card.card, card.buy_score, season_cycle.get_current_season(), card.leverage)
        score_manager.add_score(sell_score)
        hand_manager.sell(slot)
        # Note: Sell cost (3) is NOT deducted for forced sells
        # Note: Sell recovery (8) is NOT applied for forced sells
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
- Signals decouple Qi state from UI and other systems.

### Negative
- Margin call logic is split between QiManager and TurnFlow.
- Potential for forgetting to check margin call after Qi changes.

### Risks
- **Integer rounding**: GDD formulas use decimals; continuous rounding could drift.
  Mitigation: Store Qi as `float` internally, expose `int` via getter.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-qi-resource.md | Max 80, start 50 | `MAX_QI`, `START_QI` constants |
| system-qi-resource.md | Recovery 7 per turn | `BASE_RECOVERY` in `recover_turn` |
| system-qi-resource.md | Wait recovers 10 | `WAIT_BONUS` |
| system-qi-resource.md | Buy cost formula | `get_buy_cost` |
| system-qi-resource.md | Sell cost 3, recovery 8 | `SELL_COST`, `SELL_RECOVERY` |
| system-qi-resource.md | Hold cost formula | `get_hold_cost` |
| system-leverage.md | Margin call at Qi=0 | `qi_depleted` signal + TurnFlow logic |

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
- ADR-0002: Singleton vs Node design (QiManager as Autoload)
- ADR-0004: Card data and scoring (provides score values for cost calculations)